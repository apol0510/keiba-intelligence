/**
 * stripe-prices — 公開する価格を Stripe から取得して返す
 *
 * 正本: docs/RENEWAL_2026_08.md §6.1
 *
 * 🔴 金額をコードに書かない。**Stripe の Price が金額の正本**である。
 *    取得に失敗した場合は金額を返さない（推測価格・仮の金額を出さない）。
 *
 * 読み取り専用・認証不要（公開価格のため）。副作用ゼロ。
 */

import Stripe from 'stripe';
import { PLANS, priceIdFor, hasStripeSecret, STRIPE_ENV } from '../../src/lib/billing/plans.js';

const ALLOWED_ORIGINS = [
  'https://keiba-intelligence.jp',
  'https://www.keiba-intelligence.jp',
  'https://keiba-intelligence.netlify.app',
  'http://localhost:4321',
  'http://localhost:3000',
];

/** Stripe の recurring interval → 日本語。 */
function intervalLabel(recurring) {
  if (!recurring) return null;
  const n = recurring.interval_count || 1;
  switch (recurring.interval) {
    case 'month': return n === 1 ? '月' : `${n}か月`;
    case 'year': return n === 1 ? '年' : `${n}年`;
    case 'week': return n === 1 ? '週' : `${n}週`;
    case 'day': return n === 1 ? '日' : `${n}日`;
    default: return null;
  }
}

export async function handler(event) {
  const origin = event.headers.origin || '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  const headers = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, max-age=300',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // 秘密鍵が無ければ「準備中」を返す（500 にしない。価格表は他の情報を出せる）
  if (!hasStripeSecret(process.env)) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ready: false, plans: PLANS.map((p) => ({ id: p.id, available: false })) }),
    };
  }

  const stripe = new Stripe(process.env[STRIPE_ENV.SECRET_KEY]);
  const out = [];

  for (const plan of PLANS) {
    const priceId = priceIdFor(plan, process.env);
    if (!priceId) {
      out.push({ id: plan.id, available: false });
      continue;
    }
    try {
      const price = await stripe.prices.retrieve(priceId);
      out.push({
        id: plan.id,
        available: price.active !== false,
        amount: typeof price.unit_amount === 'number' ? price.unit_amount : null,
        currency: price.currency || null,
        interval: intervalLabel(price.recurring),
      });
    } catch (err) {
      // 🔴 失敗理由（Stripe のメッセージ）を外へ返さない
      console.error('❌ stripe price retrieve failed for plan:', plan.id);
      out.push({ id: plan.id, available: false });
    }
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ready: out.some((p) => p.available), plans: out }),
  };
}
