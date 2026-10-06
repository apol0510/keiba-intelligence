/**
 * stripe-portal — Stripe カスタマーポータル（カード変更・請求履歴）へのリンクを作る
 *
 * 正本: docs/RENEWAL_2026_08.md §6.2 / docs/WITHDRAWAL_2026_10.md §5
 *
 * 🔴 ポータルからは **解約できない**（2026-10-06 MK 確定）。退会はマイページの「退会する」だけ。
 *    セッションは必ず KI 管理の構成（`portalConfig.js`。解約・プラン変更が無効）で作る。
 *    構成を用意・確認できなければ **ポータルを開かない**（502。fail-closed）。
 *    アカウント既定の構成（解約が有効かもしれない）で開くことはしない。
 *
 * 🔴 安全契約:
 *   - POST のみ・**ログイン必須**（セッション Cookie の email だけを使う）
 *   - Stripe 顧客はセッションの email で検索する。**クライアントの申告を使わない**
 *   - 顧客が見つからない場合は 404（他人の顧客を開けないようにする）
 *   - 秘密鍵未設定は 503
 */

import Stripe from 'stripe';
import { hasStripeSecret, STRIPE_ENV } from '../../src/lib/billing/plans.js';
import { resolveEntitlement } from '../../src/lib/auth/entitlement.js';
import { resolveSiteOrigin, normalizeSiteOrigin } from '../../src/lib/http/siteOrigin.js';
import { ensurePortalConfiguration } from '../../src/lib/billing/portalConfig.js';

const ALLOWED_ORIGINS = [
  'https://keiba-intelligence.jp',
  'https://www.keiba-intelligence.jp',
  'https://keiba-intelligence.netlify.app',
  'http://localhost:4321',
  'http://localhost:3000',
];

/** ポータルからの戻り先。`siteOrigin.js` の共有ポリシー（許可外は本番へ倒す）。 */
function siteBase(event) {
  return resolveSiteOrigin(event.headers);
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

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'method_not_allowed' }) };
  }

  const ent = resolveEntitlement({
    cookieHeader: event.headers.cookie || null,
    env: process.env,
    nowMs: Date.now(),
  });
  if (!ent.authenticated || !ent.email) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'login_required' }) };
  }

  if (!hasStripeSecret(process.env)) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'billing_not_configured' }) };
  }

  const stripe = new Stripe(process.env[STRIPE_ENV.SECRET_KEY]);

  try {
    const found = await stripe.customers.list({ email: ent.email, limit: 1 });
    const customer = found?.data?.[0];
    if (!customer) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'no_subscription' }) };
    }

    const returnUrl = process.env[STRIPE_ENV.PORTAL_RETURN_URL] || `${siteBase(event)}/mypage`;
    // 🔴 解約できない構成でだけ開く（取得・作成に失敗したら例外 → 502）
    const configuration = await ensurePortalConfiguration(stripe);
    const portal = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: returnUrl,
      configuration: configuration.id,
    });

    if (!portal?.url) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'portal_unavailable' }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ url: portal.url }) };
  } catch {
    console.error('❌ stripe portal create failed');
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'portal_unavailable' }) };
  }
}
