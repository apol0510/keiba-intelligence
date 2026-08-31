/**
 * stripe-portal — Stripe カスタマーポータル（解約・カード変更）へのリンクを作る
 *
 * 正本: docs/RENEWAL_2026_08.md §6.2
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

const ALLOWED_ORIGINS = [
  'https://keiba-intelligence.jp',
  'https://www.keiba-intelligence.jp',
  'https://keiba-intelligence.netlify.app',
  'http://localhost:4321',
  'http://localhost:3000',
];

function siteBase(event) {
  const origin = event.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  const host = event.headers.host || '';
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) return `http://${host}`;
  return 'https://keiba-intelligence.jp';
}

export async function handler(event) {
  const origin = event.headers.origin || '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
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
    const portal = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: returnUrl,
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
