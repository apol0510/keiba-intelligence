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
import { CUSTOMER_FIELDS, toAirtableDate } from '../../src/lib/membership/airtableStore.js';

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
 *
 * 🔴 **ただし黙って諦めない。** 失敗は必ず 1 行ログに残す（`logBlobsFailure`）。
 *    引数なしの `catch {}` で握りつぶすと、冪等性が失われても応答にもログにも
 *    痕跡が出ず、「再送しても `duplicate:true` にならない」原因を切り分けられない
 *    （2026-09-03 の Test Mode E2E で実際に切り分け不能になった）。
 */

/**
 * Blobs の失敗理由を 1 行だけ残す。
 *
 * 🔴 **値は出さない。** エラーの種別と文言だけを出し、トークン・顧客情報は混ぜない。
 *    これで次の 2 つを切り分けられる。
 *      - `MissingBlobsEnvironmentError` → Blobs の環境が関数に渡っていない
 *      - `ERR_MODULE_NOT_FOUND` 等      → バンドルに `@netlify/blobs` が載っていない
 */
function logBlobsFailure(where, err) {
  console.error(
    `🔴 stripe-webhook: Blobs ${where} failed — idempotency degraded (at-least-once):`,
    err?.name || 'Error',
    err?.message || ''
  );
}

/**
 * 🔴 **この関数は v1（Lambda 互換）なので `connectLambda(event)` が要る。**
 *
 *    v1 では Blobs の環境が `process.env` に入らない。`siteID` / `token` は
 *    **リクエストの `event.blobs`（base64）と `x-nf-site-id` / `x-nf-deploy-id`
 *    ヘッダー**で渡ってくる。`connectLambda(event)` がそれを環境へ展開する。
 *
 *    呼ばないと `getEnvironmentContext()` が `{}` を返し、`getStore()` は
 *    `getClientOptions` の中で **`MissingBlobsEnvironmentError(["siteID","token"])`**
 *    を投げる。旧実装はこれを引数なしの `catch {}` で握りつぶしていたため、
 *    `hasProcessed()` が常に `false` を返し、**再送しても `duplicate:true` に
 *    ならなかった**（2026-09-04 の Test Mode 再送 2 回で実測。両方 `{"received":true}`）。
 *
 * 🔴 **ストアをキャッシュしない。** 一度成功した store を使い回すと、
 *    あとから Blobs が壊れた状態を検出できなくなる（テストの broken 状態も再現できない）。
 *    `import()` はモジュールキャッシュが効くので、毎回呼んでも実質的な負荷は無い。
 */
async function eventStore(event) {
  try {
    const { getStore, connectLambda } = await import('@netlify/blobs');
    // `event.blobs` が無い環境（単体テスト等）では何もしない。
    if (event?.blobs && typeof connectLambda === 'function') connectLambda(event);
    return getStore('stripe-events');
  } catch (err) {
    logBlobsFailure('getStore', err);
    return null;
  }
}

async function hasProcessed(event, eventId) {
  try {
    const store = await eventStore(event);
    if (!store) return false;
    return !!(await store.get(eventId));
  } catch (err) {
    logBlobsFailure('get', err);
    return false;
  }
}

async function markProcessed(event, eventId) {
  try {
    const store = await eventStore(event);
    if (!store) return;
    await store.set(eventId, new Date().toISOString());
  } catch (err) {
    // 記録できなくても処理そのものは成功している。次の再送で二重反映しうるが
    // 書き込む値は同じなので状態は壊れない。ただし黙って失わない。
    logBlobsFailure('set', err);
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

   🔴 **プラン付与（認可）とは分離する。**
      - 既定（`MEMBERSHIP_WRITE_ENABLED` 未設定）では **一切実行されない**
      - membership 側の失敗で **プラン付与を巻き戻さない**
      - 列がまだ無ければアダプタが `schema_missing` を返して書きに行かない

   🔴 **ただし「失敗を成功扱い」にはしない。**
      以前は例外を握りつぶして 200 を返し、そのあと `markProcessed()` が走っていた。
      その結果、**Stripe が再送しても `duplicate` で無視され、付与が永久に失われた**
      （2026-09-02 の Test Mode E2E で実際に発生。RewardLedger が 0 行のまま）。
      いまは結果を戻り値で受け取り、**本当に失敗したイベントは processed にせず 500 を返す**。
      プラン付与は同じ値で冪等に上書きされるので、再送で認可が壊れることはない。

   正本: docs/MEMBERSHIP_REWARDS.md §7.1 / docs/MEMBERSHIP_DATA_MIGRATION.md
   ------------------------------------------------------------------ */

/**
 * membership 反映の結果。`FAILED` のときだけ再送が必要。
 *
 * 🔴 **契約（2026-09-02 改訂）**
 *
 * | 状況 | 結果 | 応答 | processed |
 * |---|---|---|---|
 * | `MEMBERSHIP_WRITE_ENABLED` が true でない | SKIPPED | 200 | する |
 * | 付与の前提が揃わない（間隔不明・`paid_at` 欠落・JPY 以外 等） | SKIPPED | 200 | する |
 * | 書き込めた（`applied`）/ 既にある（`already`） | OK | 200 | する |
 * | 🔴 **フラグが true なのに書き込めない** | FAILED | 500 | **しない** |
 *
 * 🔴 フラグが true の時点で `schema_missing` / `not_configured` /
 *    `adapter_missing` / `read_failed` / `write_failed` は
 *    「やることが無い」ではなく **書き込み不能**である。
 *    これを 200 で通すと `markProcessed` が走り、**再送しても
 *    duplicate で無視され付与を永久に取りこぼす**（2026-09-02 に実際に発生）。
 */
const MEMBERSHIP_RESULT = Object.freeze({
  /** フラグ未設定 / 前提が揃わない（想定内。再送しても同じ） */
  SKIPPED: 'skipped',
  /** 反映できた（already を含む） */
  OK: 'ok',
  /** 🔴 反映すべきだったが書き込めなかった。processed にせず再送させる */
  FAILED: 'failed',
});

/**
 * store の戻り値を結果へ写す。
 * 🔴 `applied` / `already` **以外はすべて FAILED**。
 *    ここへ来た時点で `MEMBERSHIP_WRITE_ENABLED` は true なので、
 *    書けない理由が何であれ「書き込み不能」として扱う。
 */
/**
 * 会員制度側の書き込みが「なぜ通らなかったか」を残す。
 *
 * 🔴 ここに入れるのは **内部の状態名だけ**（`schema_missing` 等）。
 *    メールアドレス・token・秘密値は入れない。
 *    Stripe の配信結果に出して、ダッシュボードだけで切り分けられるようにする。
 */
/** 🔴 呼び出しごとに空にする（コンテナが再利用されると前回の分が残るため）。 */
const membershipNotes = [];
function note(label, status, reason) {
  const line = `${label}: ${status || 'unknown'}${reason ? `/${reason}` : ''}`;
  if (!membershipNotes.includes(line)) membershipNotes.push(line);
  return line;
}

function membershipResultFromStore(r, label) {
  const status = r && r.status;
  if (status === 'applied' || status === 'already') return MEMBERSHIP_RESULT.OK;
  console.warn(`⚠️ stripe-webhook: ${note(label, status, r && r.reason)}`);
  return MEMBERSHIP_RESULT.FAILED;
}

/** 契約時の価格を記録する（M-1 継続価格ロック）。既に入っていれば上書きしない。 */
async function recordContractPrice(email, session) {
  if (!isWriteEnabled(process.env)) {
    note('contract price', 'skipped', 'write_disabled');
    return MEMBERSHIP_RESULT.SKIPPED;
  }
  try {
    // 🔴 契約時刻も Stripe が持つ値を使う（受信時刻で代用しない）。
    //    取れなければ記録しない（あとから正しい値で入れ直せる）。
    const createdSec = session?.created;
    if (!Number.isFinite(createdSec) || createdSec <= 0) {
      console.warn('⚠️ stripe-webhook:', note('contract price', 'held', 'session_created_missing'));
      return MEMBERSHIP_RESULT.SKIPPED;
    }
    const contract = contractPriceFromCheckoutSession(session, {
      nowIso: new Date(Math.floor(createdSec) * 1000).toISOString(),
    });
    if (!contract) {
      console.warn('⚠️ stripe-webhook:', note('contract price', 'held', 'contract_not_derivable'));
      return MEMBERSHIP_RESULT.SKIPPED;
    }

    const store = resolveMembershipStore({ env: process.env });
    // 🔴 フラグは true なのに store が使えない＝書き込み不能。SKIPPED にしない
    if (!store.enabled) {
      console.warn('⚠️ stripe-webhook: membership store unavailable:', store.reason);
      return MEMBERSHIP_RESULT.FAILED;
    }
    return membershipResultFromStore(await store.saveContractPrice(email, contract), 'contract price');
  } catch {
    // 🔴 プラン付与は巻き戻さない。ただし成功扱いにもしない（再送で復旧させる）
    console.warn('⚠️ stripe-webhook: contract price not recorded');
    return MEMBERSHIP_RESULT.FAILED;
  }
}

/**
 * 解約日を記録する（解約後 90 日でポイント失効 / 旧価格ロック復活の起点）。
 * 🔴 再開時は null に戻す。
 */
async function recordCancellation(email, cancelledAtIso) {
  if (!isWriteEnabled(process.env)) return MEMBERSHIP_RESULT.SKIPPED;
  try {
    const record = await findCustomer(email);
    // 🔴 会員レコードが無ければ書けない＝書き込み不能（再送で拾えるようにする）
    if (!record) {
      console.warn('⚠️ stripe-webhook: cancellation date not written (customer not found)');
      return MEMBERSHIP_RESULT.FAILED;
    }
    await customersTable().update([{
      id: record.id,
      // 🔴 CancelledAt は日付だけの列。日時を送ると 422 になる
      fields: { [CUSTOMER_FIELDS.CANCELLED_AT]: cancelledAtIso ? toAirtableDate(cancelledAtIso) : null },
    }]);
    return MEMBERSHIP_RESULT.OK;
  } catch {
    // 🔴 プラン付与は巻き戻さない。ただし成功扱いにもしない（再送で復旧させる）
    console.warn('⚠️ stripe-webhook: cancellation date not recorded');
    return MEMBERSHIP_RESULT.FAILED;
  }
}

/**
 * 請求期間の長さ（月数）を Stripe の price から決める。
 *
 * 🔴 **判定できなければ null を返す＝付与しない（fail-closed）。**
 *    月額へ fallback すると、四半期払い等の請求で **付与量と継続月数が過少になる**。
 *    また未知の interval を勝手に月額とみなすと、実態と食い違った月数が積み上がる。
 *    「分からないなら付けない」（保留）方が、あとから正しく付け直せる。
 *
 * 🔴 **`interval_count` が無いときも 1 で補わない。**
 *    Stripe は通常この値を返すので、欠けているのは想定外の状態である。
 *    そこで 1 を仮定すると、実際が四半期・半年払いだった場合に
 *    **付与量と継続月数が過少なまま確定してしまう**（あとから気づけない）。
 */
export function periodMonthsFromRecurring(recurring) {
  if (!recurring) return null;

  // 🔴 `interval_count` が無いときに 1 を補わない。
  //    「前提が欠けたら付与しない」（§7.7）と矛盾するため、推測せず保留する。
  const count = recurring.interval_count;
  if (!Number.isInteger(count) || count <= 0) return null;

  switch (recurring.interval) {
    case 'month': return PERIOD_MONTHS.MONTHLY * count;
    case 'year': return PERIOD_MONTHS.ANNUAL * count;
    // 🔴 day / week は月数へ換算できない。unknown も含めて付与しない
    default: return null;
  }
}

/**
 * 請求明細から price の情報を取り出す。
 *
 * 🔴 Stripe の invoice 明細は API 版で形が違う。
 *    旧: `lines.data[0].price.recurring`（そのまま読める）
 *    新: `lines.data[0].pricing.price_details.price`（**id だけ**で recurring が無い）
 *    新しい形のときは id を返し、呼び出し側が Price を取りに行く。
 *    ここで `period.start` / `period.end` の差から月数を推測してはいけない
 *    （28〜31 日の揺れがあり、四半期・半年払いと区別が付かない）。
 */
export function priceRefFromInvoice(invoice) {
  const line = invoice?.lines?.data?.[0];
  if (!line) return null;

  const recurring = line.price?.recurring;
  if (recurring) return { recurring, priceId: line.price?.id || null };

  const priceId = line.pricing?.price_details?.price
    || (typeof line.price === 'string' ? line.price : null);
  if (typeof priceId === 'string' && priceId) return { recurring: null, priceId };

  return null;
}

/**
 * invoice から会員のメールアドレスを取る。
 *
 * 🔴 ここも API 版で場所が違う。
 *    旧: `invoice.subscription_details.metadata`
 *    新: `invoice.parent.subscription_details.metadata`
 *    どちらも無ければ `customer_email`（Stripe 側の請求先）へ落とす。
 */
export function emailFromInvoice(invoice) {
  const meta = invoice?.parent?.subscription_details?.metadata
    || invoice?.subscription_details?.metadata
    || null;
  const fromMeta = meta?.ki_email;
  if (typeof fromMeta === 'string' && fromMeta.trim()) return fromMeta.trim();
  const fallback = invoice?.customer_email;
  return typeof fallback === 'string' && fallback.trim() ? fallback.trim() : null;
}

/** 旧形（`price.recurring` が展開済み）のときだけ月数を返す。 */
export function periodMonthsFromInvoice(invoice) {
  const ref = priceRefFromInvoice(invoice);
  return ref && ref.recurring ? periodMonthsFromRecurring(ref.recurring) : null;
}

/**
 * 支払いが成功した時刻を **Stripe が持つ値**から取る。
 *
 * 🔴 **`Date.now()` を使わない。** webhook は遅延・再送されるので、
 *    受信時刻を付与日時にすると「今月の積み上げ」が実際の支払い月とずれる。
 *    正本は `status_transitions.paid_at`（支払いが成立した時刻）。
 * 🔴 取得できなければ **null を返す＝付与しない（保留）**。推測しない。
 */
export function paidAtMsFromInvoice(invoice) {
  const sec = invoice?.status_transitions?.paid_at;
  if (!Number.isFinite(sec) || sec <= 0) return null;
  return Math.floor(sec) * 1000;
}

/**
 * 支払いが成功した請求期間に対してリワードを付与する（TBD-10・§7.7）。
 *
 * 🔴 呼ぶのは `invoice.payment_succeeded` のときだけ。
 *    失敗（`payment_failed`）では呼ばない＝その期間には付与しない。
 *    再決済が成功すればここへ来るので、**保留していた分が 1 回だけ**反映される。
 * 🔴 冪等キーは invoice id。Stripe の再送でも二重付与しない。
 * 🔴 期間の長さ・支払い時刻のどちらかが取れなければ **付与しない**（fail-closed）。
 */
async function recordPaidPeriod(email, invoice, stripe) {
  if (!isWriteEnabled(process.env)) {
    note('reward accrual', 'skipped', 'write_disabled');
    return MEMBERSHIP_RESULT.SKIPPED;
  }
  try {
    const invoiceRef = typeof invoice?.id === 'string' ? invoice.id : null;
    if (!invoiceRef) return MEMBERSHIP_RESULT.SKIPPED;

    const ref = priceRefFromInvoice(invoice);
    let recurring = ref?.recurring || null;

    // 🔴 新しい API 形では明細に recurring が入らないので Price を取りに行く。
    //    取れなかったら **FAILED**（再送で復旧させる）。推測はしない。
    if (!recurring && ref?.priceId && stripe) {
      try {
        const price = await stripe.prices.retrieve(ref.priceId);
        recurring = price?.recurring || null;
      } catch (err) {
        console.error('❌ stripe-webhook:', note('reward accrual', 'failed', 'price_lookup_failed'), err && err.message);
        return MEMBERSHIP_RESULT.FAILED;
      }
    }

    const periodMonths = periodMonthsFromRecurring(recurring);
    if (periodMonths == null) {
      // 🔴 月額へ fallback しない。付けずに保留する（再送しても同じなので SKIPPED）
      console.warn('⚠️ stripe-webhook:', note('reward accrual', 'held', 'unknown_interval'));
      return MEMBERSHIP_RESULT.SKIPPED;
    }

    const occurredAtMs = paidAtMsFromInvoice(invoice);
    if (occurredAtMs == null) {
      // 🔴 受信時刻（Date.now）で代用しない。付けずに保留する
      console.warn('⚠️ stripe-webhook: paid_at missing — accrual held');
      return MEMBERSHIP_RESULT.SKIPPED;
    }

    const entry = buildPaidPeriodEntry({ email, invoiceRef, periodMonths, occurredAtMs });
    if (!entry) return MEMBERSHIP_RESULT.SKIPPED;

    const store = resolveMembershipStore({ env: process.env });
    // 🔴 フラグは true なのに store が使えない＝書き込み不能。SKIPPED にしない
    if (!store.enabled) {
      console.warn('⚠️ stripe-webhook: membership store unavailable:', store.reason);
      return MEMBERSHIP_RESULT.FAILED;
    }
    // `already` は冪等（既に積んである）ので成功扱い
    return membershipResultFromStore(await store.appendEntry(email, entry), 'reward accrual');
  } catch {
    // 🔴 認可は巻き戻さない。ただし成功扱いにもしない（再送で復旧させる）
    console.warn('⚠️ stripe-webhook: reward accrual not recorded');
    return MEMBERSHIP_RESULT.FAILED;
  }
}

/**
 * イベントの発生時刻（Stripe 側の時計）。
 * 🔴 webhook の受信時刻ではなく **イベントが起きた時刻**を使う。
 *    再送・遅延で 90 日の起算がずれないようにするため。
 */
function stripeEventTimeIso(stripeEvent) {
  const sec = stripeEvent?.created;
  if (!Number.isFinite(sec) || sec <= 0) return null;
  return new Date(Math.floor(sec) * 1000).toISOString();
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

  if (await hasProcessed(event, stripeEvent.id)) {
    console.log('ℹ️ stripe-webhook: duplicate event ignored:', stripeEvent.type);
    return { statusCode: 200, headers, body: JSON.stringify({ received: true, duplicate: true }) };
  }

  /**
   * 🔴 membership 反映の結果を集める。1 つでも FAILED があれば
   *    **processed にせず 500 を返し、Stripe に再送させる**。
   */
  const membershipResults = [];
  membershipNotes.length = 0; // 🔴 前回の呼び出しの残りを持ち越さない
  const track = (r) => { membershipResults.push(r); return r; };

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
        track(await recordContractPrice(email, session));
        track(await recordCancellation(email, null));

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
          track(await recordCancellation(email, null)); // 再開したので解約日を消す
        } else if (sub.status === 'canceled' || sub.status === 'unpaid' || sub.status === 'incomplete_expired') {
          await applyPlan(email, {
            planType: TIER.FREE,
            status: 'inactive',
            accessEnabled: false,
          });
          console.log('✅ stripe-webhook: subscription ended, downgraded to free');
          track(await recordCancellation(email, stripeEventTimeIso(stripeEvent)));
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
        track(await recordCancellation(email, stripeEventTimeIso(stripeEvent)));

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
        const email = emailFromInvoice(invoice);
        if (!email) {
          console.warn('⚠️ stripe-webhook: payment_succeeded without email (skipped)');
          break;
        }
        // 🔴 認可は触らない。ここで行うのはリワードの付与だけ
        track(await recordPaidPeriod(email, invoice, stripe));
        console.log('✅ stripe-webhook: paid period recorded');
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = stripeEvent.data.object;
        const email = emailFromInvoice(invoice);
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

  // 🔴 membership の反映に失敗していたら **processed にしない**。
  //    ここで 200 を返して記録してしまうと、Stripe が再送しても `duplicate` で
  //    無視され、付与が永久に失われる（2026-09-02 に実際に発生）。
  //    認可（プラン付与）は既に完了しており、再送時は同じ値で冪等に上書きされる。
  if (membershipResults.includes(MEMBERSHIP_RESULT.FAILED)) {
    console.error('❌ stripe-webhook: membership not recorded — will retry:', stripeEvent.type);
    return {
      statusCode: 500,
      headers,
      // 🔴 内部の状態名だけ。個人情報・秘密値は載せない
      body: JSON.stringify({ error: 'membership_not_recorded', membership: membershipNotes }),
    };
  }

  // 🔴 成功したあとに記録する（失敗したイベントを握りつぶさないため）
  await markProcessed(event, stripeEvent.id);

  // 🔴 保留（SKIPPED）の理由も返す。ダッシュボードだけで切り分けられるように
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(membershipNotes.length
      ? { received: true, membership: membershipNotes }
      : { received: true }),
  };
}
