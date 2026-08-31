/**
 * stripe-create-checkout — Stripe Checkout Session を作る
 *
 * 正本: docs/RENEWAL_2026_08.md §6.2
 *
 * 🔴 安全契約:
 *   - POST のみ（GET による課金開始を禁止）
 *   - **ログイン必須**。署名付きセッション Cookie から email を取る。
 *     クライアントが送ってきた email を信用しない（他人のプランを買い替えられないため）。
 *   - 秘密鍵 / Price ID が未設定なら **503**（推測で課金しない）
 *   - metadata に `ki_plan` と `ki_email` を入れ、webhook 側で tier を復元する
 *   - Stripe のエラー内容を呼び出し元へ返さない
 */

import Stripe from 'stripe';
import { planById, priceIdFor, hasStripeSecret, STRIPE_ENV } from '../../src/lib/billing/plans.js';
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

  // ── 認証（ログイン必須） ──
  const ent = resolveEntitlement({
    cookieHeader: event.headers.cookie || null,
    env: process.env,
    nowMs: Date.now(),
  });
  if (!ent.authenticated || !ent.email) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'login_required' }) };
  }

  // ── 入力 ──
  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid_body' }) };
  }

  const plan = planById(typeof body.plan === 'string' ? body.plan : '');
  if (!plan) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'unknown_plan' }) };
  }

  // ── 設定 ──
  if (!hasStripeSecret(process.env)) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'billing_not_configured' }) };
  }
  const priceId = priceIdFor(plan, process.env);
  if (!priceId) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'plan_not_configured' }) };
  }

  const base = siteBase(event);
  const stripe = new Stripe(process.env[STRIPE_ENV.SECRET_KEY]);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      // 🔴 email はサーバー側セッション由来のものだけを使う
      customer_email: ent.email,
      client_reference_id: ent.email,
      allow_promotion_codes: true,
      success_url: `${base}/mypage?checkout=success`,
      cancel_url: `${base}/pricing?checkout=cancelled`,
      metadata: { ki_plan: plan.id, ki_email: ent.email },
      subscription_data: {
        metadata: { ki_plan: plan.id, ki_email: ent.email },
      },
    });

    if (!session?.url) {
      console.error('❌ checkout session created without url');
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'checkout_unavailable' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    // 🔴 Stripe のメッセージを返さない（内部情報の露出防止）
    console.error('❌ stripe checkout create failed');
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'checkout_unavailable' }) };
  }
}
