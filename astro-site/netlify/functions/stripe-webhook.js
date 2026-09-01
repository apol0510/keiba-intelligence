/**
 * stripe-webhook — Stripe のサブスク状態を Airtable の会員状態へ反映する
 *
 * 正本: docs/RENEWAL_2026_08.md §6.2
 *
 * 🔴 安全契約:
 *   - **署名検証必須**。`STRIPE_WEBHOOK_SECRET` 未設定なら 503 で止める（無検証で書き込まない）。
 *   - **冪等**。同じ `event.id` を二度処理しない（Netlify Blobs に処理済みを記録）。
 *     🔴 記録は **処理が成功したあと**に行う。先に記録すると、失敗して 500 を返した
 *     イベントが再送時に無視され、更新が永久に失われる（2026-09-01 修正）。
 *     Blobs が使えない環境では記録をあきらめて処理を続ける（at-least-once）。
 *   - プラン付与で書き込むのは **既存フィールドだけ**（PlanType / Status / AccessEnabled）。
 *     🔴 `VenueAccess` は書かない（2026-08-30 に会場で分ける概念を廃止）。
 *     🔴 会員継続制度の列（`MembershipStartedAt` / `CancelledAt` / `ContractPrice*`）は
 *     **`MEMBERSHIP_WRITE_ENABLED=true` のときだけ、別リクエストで**書く。
 *     プラン付与と同じ update に混ぜてはいけない。列がまだ無い環境では Airtable が
 *     **リクエストごと 422 で失敗**するため、混ぜると **プラン付与まで巻き添えで落ちる**。
 *   - 顧客レコードが無い場合は**作らない**。ログに区分だけ残す。
 *   - Stripe / Airtable のエラー内容を応答へ返さない。
 *
 * 扱うイベント:
 *   checkout.session.completed      → プラン付与
 *   customer.subscription.updated   → 状態に応じて付与 / 剥奪
 *   customer.subscription.deleted   → free へ戻す
 *   invoice.payment_succeeded       → 🔴 リワードの付与（**支払いが成功した期間だけ**）
 *   invoice.payment_failed          → Status を payment_failed に（アクセスは即時停止しない）
 *
 * 🔴 **認可とリワードを混同しない**（docs/MEMBERSHIP_REWARDS.md §7.7）:
 *   - 支払い失敗時の **認可は現行のまま**（`Status` だけ変更。`PlanType` / `AccessEnabled` は触らない）
 *   - **継続月数とポイントの付与だけ**を支払い成功まで保留する
 *     （付与を `invoice.payment_succeeded` で駆動しているので、失敗した期間には付かない）
 */

import Stripe from 'stripe';
import Airtable from 'airtable';
import { planFromMetadata, hasStripeSecret, STRIPE_ENV } from '../../src/lib/billing/plans.js';
import { TIER } from '../../src/lib/auth/tiers.js';
import { notifyKma, buildEventId } from '../../src/lib/kma/client.js';
import { resolveMembershipStore, isWriteEnabled } from '../../src/lib/membership/store.js';
import { contractPriceFromCheckoutSession } from '../../src/lib/membership/priceLock.js';
import { buildPaidPeriodEntry, PERIOD_MONTHS } from '../../src/lib/membership/rewards.js';
import { CUSTOMER_FIELDS } from '../../src/lib/membership/airtableStore.js';

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

/** 有効とみなすサブスク状態。 */
const ACTIVE_STATUSES = new Set(['active', 'trialing']);

function customersTable() {
  const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);
  return base('Customers');
}

/** Airtable のフォーミュラ用に " をエスケープする。 */
function escapeFormulaValue(v) {
  return String(v).replace(/"/g, '\\"');
}

/**
 * 処理済みイベントの記録（best-effort）。
 *
 * 🔴 **確認と記録を分ける。** 記録は「処理が成功したあと」に行うこと。
 *    先に記録すると、処理が失敗して 500 を返したあと Stripe が再送しても
 *    「処理済み」として無視され、**その更新が永久に失われる**
 *    （2026-09-01 の E2E で検出）。
 *
 * Blobs が使えない場合は冪等性をあきらめて処理する（at-least-once）。
 * 二重反映しても書き込む値は同じなので状態は壊れない。
 */
async function eventStore() {
  try {
    const { getStore } = await import('@netlify/blobs');
    return getStore('stripe-events');
  } catch {
    return null;
  }
}

async function hasProcessed(eventId) {
  try {
    const store = await eventStore();
    if (!store) return false;
    return !!(await store.get(eventId));
  } catch {
    return false;
  }
}

async function markProcessed(eventId) {
  try {
    const store = await eventStore();
    if (!store) return;
    await store.set(eventId, new Date().toISOString());
  } catch {
    // 記録できなくても処理そのものは成功している。次の再送で二重反映しうるが
    // 書き込む値は同じなので状態は壊れない。
  }
}

/** email から顧客レコードを引く。 */
async function findCustomer(email) {
  if (!email) return null;
  const rows = await customersTable()
    .select({ filterByFormula: `{Email} = "${escapeFormulaValue(email)}"`, maxRecords: 1 })
    .firstPage();
  return rows.length ? rows[0] : null;
}

async function applyPlan(email, { planType, status, accessEnabled }) {
  const record = await findCustomer(email);
  if (!record) {
    console.warn('⚠️ stripe-webhook: customer record not found (skipped)');
    return false;
  }
  const fields = {};
  if (planType != null) fields.PlanType = planType;
  if (status != null) fields.Status = status;
  if (accessEnabled != null) fields.AccessEnabled = accessEnabled;

  if (!Object.keys(fields).length) return false;
  await customersTable().update([{ id: record.id, fields }]);
  return true;
}

/* ------------------------------------------------------------------
   会員継続制度（KI リワード / 価格ロック）への反映

   🔴 **プラン付与とは完全に分離する。**
      - 既定（`MEMBERSHIP_WRITE_ENABLED` 未設定）では **一切実行されない**
      - 失敗しても握りつぶす。プラン付与の成否に影響させない
      - 列がまだ無ければアダプタが `schema_missing` を返して書きに行かない
   正本: docs/MEMBERSHIP_REWARDS.md §7.1 / docs/MEMBERSHIP_DATA_MIGRATION.md
   ------------------------------------------------------------------ */

/** 契約時の価格を記録する（M-1 継続価格ロック）。既に入っていれば上書きしない。 */
async function recordContractPrice(email, session) {
  if (!isWriteEnabled(process.env)) return;
  try {
    const contract = contractPriceFromCheckoutSession(session, { nowIso: new Date().toISOString() });
    if (!contract) return;
    const store = resolveMembershipStore({ env: process.env });
    if (!store.enabled) return;
    await store.saveContractPrice(email, contract);
  } catch {
    // 🔴 プラン付与には影響させない
    console.warn('⚠️ stripe-webhook: contract price not recorded (ignored)');
  }
}

/**
 * 解約日を記録する（解約後 90 日でポイント失効 / 旧価格ロック復活の起点）。
 * 🔴 再開時は null に戻す。
 */
async function recordCancellation(email, cancelledAtIso) {
  if (!isWriteEnabled(process.env)) return;
  try {
    const record = await findCustomer(email);
    if (!record) return;
    await customersTable().update([{
      id: record.id,
      fields: { [CUSTOMER_FIELDS.CANCELLED_AT]: cancelledAtIso },
    }]);
  } catch {
    // 🔴 列が無い環境ではここで失敗する。プラン付与は既に済んでいるので握りつぶす
    console.warn('⚠️ stripe-webhook: cancellation date not recorded (ignored)');
  }
}

/**
 * 支払いが成功した請求期間に対してリワードを付与する（TBD-10・§7.7）。
 *
 * 🔴 呼ぶのは `invoice.payment_succeeded` のときだけ。
 *    失敗（`payment_failed`）では呼ばない＝その期間には付与しない。
 *    再決済が成功すればここへ来るので、**保留していた分が 1 回だけ**反映される。
 * 🔴 冪等キーは invoice id。Stripe の再送でも二重付与しない。
 */
async function recordPaidPeriod(email, invoice) {
  if (!isWriteEnabled(process.env)) return;
  try {
    const invoiceRef = typeof invoice?.id === 'string' ? invoice.id : null;
    if (!invoiceRef) return;

    // 年払い（12 か月ぶん）か月額（1 か月ぶん）か。判定できなければ月額として扱う
    const interval = invoice?.lines?.data?.[0]?.price?.recurring?.interval;
    const periodMonths = interval === 'year' ? PERIOD_MONTHS.ANNUAL : PERIOD_MONTHS.MONTHLY;

    const entry = buildPaidPeriodEntry({
      email, invoiceRef, periodMonths, occurredAtMs: Date.now(),
    });
    if (!entry) return;

    const store = resolveMembershipStore({ env: process.env });
    if (!store.enabled) return;
    await store.appendEntry(email, entry);
  } catch {
    // 🔴 認可には影響させない
    console.warn('⚠️ stripe-webhook: reward accrual not recorded (ignored)');
  }
}

/** サブスクから email / plan を取り出す（metadata が正）。 */
function identityFromSubscription(sub) {
  const md = sub?.metadata || {};
  const plan = planFromMetadata(md);
  const email = typeof md.ki_email === 'string' && md.ki_email ? md.ki_email : null;
  return { plan, email };
}

export async function handler(event) {
  const headers = { 'Cache-Control': 'no-store' };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'method_not_allowed' }) };
  }

  const webhookSecret = process.env[STRIPE_ENV.WEBHOOK_SECRET];
  if (!hasStripeSecret(process.env) || !webhookSecret) {
    // 🔴 無検証で書き込まない
    console.error('❌ stripe-webhook: not configured');
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'not_configured' }) };
  }

  const stripe = new Stripe(process.env[STRIPE_ENV.SECRET_KEY]);
  const signature = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64')
    : Buffer.from(event.body || '', 'utf8');

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    // 🔴 署名不正は理由を返さない
    console.error('❌ stripe-webhook: signature verification failed');
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid_signature' }) };
  }

  if (await hasProcessed(stripeEvent.id)) {
    console.log('ℹ️ stripe-webhook: duplicate event ignored:', stripeEvent.type);
    return { statusCode: 200, headers, body: JSON.stringify({ received: true, duplicate: true }) };
  }

  try {
    switch (stripeEvent.type) {
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;
        const plan = planFromMetadata(session.metadata);
        const email = session.metadata?.ki_email || session.customer_email || session.client_reference_id;
        if (!plan || !email) {
          console.warn('⚠️ stripe-webhook: checkout without plan/email metadata (skipped)');
          break;
        }
        await applyPlan(email, {
          planType: plan.id,
          status: 'active',
          accessEnabled: true,
        });
        console.log('✅ stripe-webhook: plan granted:', plan.id);

        // 🔴 ここから下は会員継続制度。既定では実行されない（フラグ off）
        await recordContractPrice(email, session);
        await recordCancellation(email, null);

        await notifyKma({
          kind: 'subscription-started',
          identity: email,
          eventId: buildEventId({
            kind: 'subscription-started',
            identityKey: session.id,
            occurredAt: new Date().toISOString(),
          }),
          env: process.env,
        });
        break;
      }

      case 'customer.subscription.updated': {
        const sub = stripeEvent.data.object;
        const { plan, email } = identityFromSubscription(sub);
        if (!email) {
          console.warn('⚠️ stripe-webhook: subscription without ki_email metadata (skipped)');
          break;
        }
        if (ACTIVE_STATUSES.has(sub.status) && plan) {
          await applyPlan(email, {
            planType: plan.id,
            status: 'active',
            accessEnabled: true,
          });
          console.log('✅ stripe-webhook: subscription active:', plan.id);
          await recordCancellation(email, null); // 再開したので解約日を消す
        } else if (sub.status === 'canceled' || sub.status === 'unpaid' || sub.status === 'incomplete_expired') {
          await applyPlan(email, {
            planType: TIER.FREE,
            status: 'inactive',
            accessEnabled: false,
          });
          console.log('✅ stripe-webhook: subscription ended, downgraded to free');
          await recordCancellation(email, new Date().toISOString());
        } else {
          console.log('ℹ️ stripe-webhook: subscription status ignored:', sub.status);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = stripeEvent.data.object;
        const { email } = identityFromSubscription(sub);
        if (!email) {
          console.warn('⚠️ stripe-webhook: deleted subscription without ki_email (skipped)');
          break;
        }
        await applyPlan(email, {
          planType: TIER.FREE,
          status: 'inactive',
          accessEnabled: false,
        });
        console.log('✅ stripe-webhook: downgraded to free');
        await recordCancellation(email, new Date().toISOString());

        await notifyKma({
          kind: 'subscription-cancelled',
          identity: email,
          eventId: buildEventId({
            kind: 'subscription-cancelled',
            identityKey: sub.id,
            occurredAt: new Date().toISOString(),
          }),
          env: process.env,
        });
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = stripeEvent.data.object;
        const email = invoice?.subscription_details?.metadata?.ki_email
          || invoice?.customer_email
          || null;
        if (!email) {
          console.warn('⚠️ stripe-webhook: payment_succeeded without email (skipped)');
          break;
        }
        // 🔴 認可は触らない。ここで行うのはリワードの付与だけ
        await recordPaidPeriod(email, invoice);
        console.log('✅ stripe-webhook: paid period recorded');
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = stripeEvent.data.object;
        const email = invoice?.subscription_details?.metadata?.ki_email
          || invoice?.customer_email
          || null;
        if (!email) {
          console.warn('⚠️ stripe-webhook: payment_failed without email (skipped)');
          break;
        }
        // 🔴 アクセスは即時停止しない。猶予は Stripe 側の設定（dunning）に従う。
        //    認可の挙動は **一切変更しない**（TBD-10・§7.7）。
        await applyPlan(email, { status: 'payment_failed' });
        // 🔴 リワードは付与しない（保留）。再決済が成功したときに
        //    invoice.payment_succeeded 側で 1 回だけ反映される。
        console.log('⚠️ stripe-webhook: payment failed recorded (reward accrual held)');
        break;
      }

      default:
        console.log('ℹ️ stripe-webhook: unhandled event type:', stripeEvent.type);
    }
  } catch {
    // 🔴 内部エラーの詳細を返さない。Stripe には 500 を返して再送させる。
    console.error('❌ stripe-webhook: handler failed for type:', stripeEvent.type);
    // 🔴 処理済みとして記録しない。Stripe の再送で復旧させる。
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'handler_failed' }) };
  }

  // 🔴 成功したあとに記録する（失敗したイベントを握りつぶさないため）
  await markProcessed(stripeEvent.id);

  return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
}
