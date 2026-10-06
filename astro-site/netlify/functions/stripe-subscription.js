/**
 * stripe-subscription — マイページ用: 契約状態の取得と「退会（即時終了）」
 *
 * 正本: docs/WITHDRAWAL_2026_10.md（2026-10-06 MK 確定）
 *
 * POST body:
 *   { "action": "status" }                    → { state, renewsAt, endsAt, daysLeft }
 *   { "action": "withdraw", "confirm": true } → 契約を即時終了し、有料権限を即時停止する
 *
 * 🔴 退会は **即時のみ**。期間末キャンセル（予約）は作らない。予約の取り消し機能も無い。
 *    退会後は契約上の利用期間・請求期間が残っていても有料機能を使えない。
 *
 * 🔴 安全契約（stripe-portal.js と同じ）:
 *   - POST のみ・**ログイン必須**（セッション Cookie の email だけを使う）
 *   - Stripe 顧客はセッションの email で検索する。**クライアントの申告を使わない**
 *     （本文の subscription ID 等は受け取らない＝他人の契約を操作できない）
 *   - さらにサブスクの `metadata.ki_email` がセッションの email と一致することを確かめる
 *   - 有効な契約が複数・持ち主が一致しない → **終了しない**（409。fail-closed）
 *   - 秘密鍵未設定は 503 / Stripe 例外は 502（内容を返さない）
 *   - 返すのは **状態と日付だけ**（顧客 ID・email は返さない）
 *
 * 🔴 冪等:
 *   - Stripe へは契約ごとの idempotency key（`ki-withdraw-<sub>`）を付ける
 *   - 二重押しの 2 回目は「すでに KI の退会で終了済み」を検出して成功を返す（書き込まない）
 *
 * 🔴 状態遷移（どこか 1 か所だけが先に変わる状態を作らない）:
 *   1. Stripe の契約を即時終了（ここが成功しなければ何も変えない）
 *   2. 退会記録（Blobs）を書く → 他の端末の有料セッションも即時に free 扱い
 *   3. この端末の Cookie を free で出し直す（降格のみ）
 *   4. 会員状態（Airtable）は従来どおり webhook（customer.subscription.deleted）が反映する
 *      （反映前にログイン・refresh しても、退会記録が有料の発行を止める）
 */

import Stripe from 'stripe';
import { hasStripeSecret, STRIPE_ENV } from '../../src/lib/billing/plans.js';
import { resolveEntitlement } from '../../src/lib/auth/entitlement.js';
import { TIER } from '../../src/lib/auth/tiers.js';
import { signSession, serializeSessionCookie } from '../../src/lib/auth/session.js';
import { updateRevocation } from '../../src/lib/auth/revocation.js';
import { normalizeSiteOrigin } from '../../src/lib/http/siteOrigin.js';
import {
  pickSubscription, summarizeSubscription, withdrawalTarget,
  withdrawCancelParams, withdrawIdempotencyKey, SUB_STATE,
} from '../../src/lib/billing/subscriptionState.js';

const ALLOWED_ORIGINS = [
  'https://keiba-intelligence.jp',
  'https://www.keiba-intelligence.jp',
  'https://keiba-intelligence.netlify.app',
  'http://localhost:4321',
  'http://localhost:3000',
];

const ACTIONS = new Set(['status', 'withdraw']);

function parseBody(body) {
  try {
    const parsed = JSON.parse(body || '{}');
    const action = typeof parsed?.action === 'string' && ACTIONS.has(parsed.action) ? parsed.action : null;
    return { action, confirm: parsed?.confirm === true };
  } catch {
    return { action: null, confirm: false };
  }
}

function isLocalHost(event) {
  const host = event?.headers?.host || '';
  return host.startsWith('localhost') || host.startsWith('127.0.0.1');
}

/**
 * セッションの email で見つかる Stripe 顧客すべてのサブスク。
 * 🔴 同じ email の顧客が複数あっても取りこぼさない（取りこぼすと二重契約を見落とす）。
 */
async function subscriptionsForEmail(stripe, email) {
  const customers = await stripe.customers.list({ email, limit: 10 });
  const out = [];
  for (const c of customers?.data || []) {
    const subs = await stripe.subscriptions.list({ customer: c.id, status: 'all', limit: 10 });
    out.push(...(subs?.data || []));
  }
  return out;
}

/** この端末の Cookie を free で出し直す（降格のみ・寿命は延ばさない）。 */
function downgradedCookie(event, ent, nowMs) {
  const remainingSeconds = Math.floor((ent.expiresAtMs - nowMs) / 1000);
  if (!Number.isFinite(remainingSeconds) || remainingSeconds <= 0) return null;
  const signed = signSession({
    email: ent.email,
    tier: TIER.FREE,
    secret: process.env.SESSION_SIGNING_SECRET,
    nowMs,
    ttlSeconds: remainingSeconds,
  });
  if (!signed.ok) return null;
  return serializeSessionCookie(signed.token, { maxAgeSeconds: remainingSeconds, secure: !isLocalHost(event) });
}

export async function handler(event) {
  const origin = event.headers.origin || '';
  const allowOrigin = normalizeSiteOrigin(origin) || ALLOWED_ORIGINS[0];
  const headers = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
    'Cache-Control': 'no-store',
  };
  const reply = (statusCode, payload, extra = {}) => ({
    statusCode, headers: { ...headers, ...extra }, body: JSON.stringify(payload),
  });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'method_not_allowed' });

  const { action, confirm } = parseBody(event.body);
  if (!action) return reply(400, { error: 'invalid_action' });

  const nowMs = Date.now();
  const ent = resolveEntitlement({
    cookieHeader: event.headers.cookie || null,
    env: process.env,
    nowMs,
  });
  if (!ent.authenticated || !ent.email) return reply(401, { error: 'login_required' });

  // 🔴 確認画面を経ていない退会要求は受け付けない（1 回押しただけで確定させない）
  if (action === 'withdraw' && !confirm) return reply(400, { error: 'confirmation_required' });

  if (!hasStripeSecret(process.env)) return reply(503, { error: 'billing_not_configured' });

  const stripe = new Stripe(process.env[STRIPE_ENV.SECRET_KEY]);

  let subs;
  try {
    subs = await subscriptionsForEmail(stripe, ent.email);
  } catch {
    console.error(`❌ stripe-subscription: ${action} lookup failed`);
    return reply(502, { error: 'subscription_unavailable' });
  }

  if (action === 'status') return reply(200, summarizeSubscription(pickSubscription(subs), nowMs));

  // ---- withdraw ----
  const target = withdrawalTarget(subs, ent.email);
  if (!target.ok) {
    if (target.already) {
      // 二重押し・再送。Stripe には書かず、この端末の降格だけ確実にする
      const cookie = downgradedCookie(event, ent, nowMs);
      return reply(200, { state: SUB_STATE.NONE, withdrawn: true, already: true }, cookie ? { 'Set-Cookie': cookie } : {});
    }
    // 🔴 識別できない・契約が無い → 何も終了しない
    console.warn('⚠️ stripe-subscription: withdraw refused:', target.error);
    return reply(409, { error: target.error });
  }

  let canceled;
  try {
    canceled = await stripe.subscriptions.cancel(target.sub.id, withdrawCancelParams(), {
      idempotencyKey: withdrawIdempotencyKey(target.sub),
    });
  } catch {
    console.error('❌ stripe-subscription: withdraw cancel failed');
    return reply(502, { error: 'withdraw_failed' });
  }
  if (canceled?.status !== 'canceled') {
    console.error('❌ stripe-subscription: withdraw did not end the subscription');
    return reply(502, { error: 'withdraw_failed' });
  }

  // 2. 退会記録（他の端末の有料セッションを止める）。失敗しても Stripe は終了済みなので成功を返す。
  //    webhook（customer.subscription.deleted）が同じ記録を書くので、そこで補完される。
  try {
    await updateRevocation(ent.email, { kind: 'withdraw', nowMs, subscriptionId: target.sub.id }, { event });
  } catch (err) {
    console.error('❌ stripe-subscription: revocation not recorded (webhook will retry):', err?.name || 'error');
  }

  // 3. この端末は即時に free
  const cookie = downgradedCookie(event, ent, nowMs);
  console.log('✅ stripe-subscription: withdrawn (immediate)');
  return reply(200, { state: SUB_STATE.NONE, withdrawn: true }, cookie ? { 'Set-Cookie': cookie } : {});
}
