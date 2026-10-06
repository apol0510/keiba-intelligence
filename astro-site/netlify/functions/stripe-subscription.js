/**
 * stripe-subscription — マイページ用: 契約状態の取得と「解約予約の取り消し」
 *
 * 正本: docs/RETENTION_2026_10.md
 *
 * POST body:
 *   { "action": "status" }  → { state, renewsAt, endsAt, daysLeft }
 *   { "action": "resume" }  → 解約予約を取り消し、取り消し後の状態を返す
 *
 * 🔴 安全契約（stripe-portal.js と同じ）:
 *   - POST のみ・**ログイン必須**（セッション Cookie の email だけを使う）
 *   - Stripe 顧客はセッションの email で検索する。**クライアントの申告を使わない**
 *     （本文の subscription ID 等は受け取らない＝他人の契約を操作できない）
 *   - 秘密鍵未設定は 503 / Stripe 例外は 502（内容を返さない）
 *   - 返すのは **状態と日付だけ**（顧客 ID・email・解約理由は返さない）
 *
 * 🔴 「いつでも解約できる」は変えない。解約はこれまでどおりカスタマーポータルで行う。
 *    この関数は **解約の取り消し（継続）** だけを書き込む。解約・プラン変更・値引きはしない。
 *
 * 🔴 取り消しは冪等。予約が無ければ書き込まずに現在の状態を返す（二重押しで壊れない）。
 *    Stripe 側にも idempotency key を付ける（同じ予約に対する再送は 1 回の更新になる）。
 *    会員権限（Airtable）は webhook の `customer.subscription.updated` が従来どおり反映する。
 */

import Stripe from 'stripe';
import { hasStripeSecret, STRIPE_ENV } from '../../src/lib/billing/plans.js';
import { resolveEntitlement } from '../../src/lib/auth/entitlement.js';
import { normalizeSiteOrigin } from '../../src/lib/http/siteOrigin.js';
import { pickSubscription, summarizeSubscription, resumeParams, SUB_STATE } from '../../src/lib/billing/subscriptionState.js';

const ALLOWED_ORIGINS = [
  'https://keiba-intelligence.jp',
  'https://www.keiba-intelligence.jp',
  'https://keiba-intelligence.netlify.app',
  'http://localhost:4321',
  'http://localhost:3000',
];

const ACTIONS = new Set(['status', 'resume']);

function parseAction(body) {
  try {
    const parsed = JSON.parse(body || '{}');
    return typeof parsed?.action === 'string' && ACTIONS.has(parsed.action) ? parsed.action : null;
  } catch {
    return null;
  }
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
  const reply = (statusCode, payload) => ({ statusCode, headers, body: JSON.stringify(payload) });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'method_not_allowed' });

  const action = parseAction(event.body);
  if (!action) return reply(400, { error: 'invalid_action' });

  const ent = resolveEntitlement({
    cookieHeader: event.headers.cookie || null,
    env: process.env,
    nowMs: Date.now(),
  });
  if (!ent.authenticated || !ent.email) return reply(401, { error: 'login_required' });

  if (!hasStripeSecret(process.env)) return reply(503, { error: 'billing_not_configured' });

  const stripe = new Stripe(process.env[STRIPE_ENV.SECRET_KEY]);

  try {
    const found = await stripe.customers.list({ email: ent.email, limit: 1 });
    const customer = found?.data?.[0];
    // 🔴 顧客が無い（銀行振込・未加入）は「契約なし」として返す。エラーにしない
    if (!customer) return reply(200, summarizeSubscription(null));

    const subs = await stripe.subscriptions.list({ customer: customer.id, status: 'all', limit: 10 });
    const sub = pickSubscription(subs?.data);

    if (action === 'status') return reply(200, summarizeSubscription(sub));

    // ---- resume ----
    const params = resumeParams(sub);
    if (!params) {
      // 予約が無い（既に取り消し済み・契約なし）。書き込まずに現状を返す
      return reply(200, { ...summarizeSubscription(sub), resumed: false });
    }
    // 🔴 二重押し・再送で別の更新にならないよう、予約の時刻ごとに 1 キー
    const updated = await stripe.subscriptions.update(sub.id, params, {
      idempotencyKey: `ki-resume-${sub.id}-${sub.cancel_at || 'period_end'}`,
    });
    const summary = summarizeSubscription(updated);
    if (summary.state !== SUB_STATE.ACTIVE) {
      console.error('❌ stripe-subscription: resume did not clear the cancellation');
      return reply(502, { error: 'resume_failed' });
    }
    console.log('✅ stripe-subscription: cancellation withdrawn');
    return reply(200, { ...summary, resumed: true });
  } catch {
    console.error(`❌ stripe-subscription: ${action} failed`);
    return reply(502, { error: 'subscription_unavailable' });
  }
}
