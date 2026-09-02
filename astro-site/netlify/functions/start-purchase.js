/**
 * start-purchase — 未ログインの購入を「1本の導線」として受ける
 *
 * 正本: docs/RENEWAL_2026_08.md §6（課金）/ §7（認可）
 *
 * 背景:
 *   未ログインで「このプランを申し込む」を押すと Checkout が 401 になり、
 *   `/login` へ飛ばされて購入導線が途切れていた。
 *   ここは **購入手続きの入口**であって「無料会員登録の入口」ではない。
 *
 * やること:
 *   1. プラン id をサーバー側で検証（`plans.js` にあるものだけ）
 *   2. その email が会員かどうかで、**既存の関数へそのまま委譲**する
 *      - 会員        → `send-magic-link`（既存のログイン経路）
 *      - 未登録      → `register-free`（既存の無料登録経路。Airtable の値も従来どおり）
 *   3. どちらの経路でも **購入意図（プラン id）をマジックリンクへ持ち越す**
 *
 * 🔴 認証・認可の契約は変えない:
 *   - ここでは **セッションを発行しない**。認証は従来どおりマジックリンクのみ
 *   - Stripe Checkout は引き続き **セッションのある利用者だけ**（`stripe-create-checkout`）
 *   - email は Checkout 実行時に **セッション由来**のものが使われる（ここの入力は使わない）
 *   - 戻り先は受け取らない。**プラン id だけ**を持ち越す（open redirect を作らない）
 *
 * 🔴 応答は「会員かどうか」で変えない。
 *    変えると、任意のアドレスで会員の有無を判定できてしまう。
 */

import { normalizeIntent } from '../../src/lib/billing/purchaseIntent.js';

const ALLOWED_ORIGINS = [
  'https://keiba-intelligence.jp',
  'https://www.keiba-intelligence.jp',
  'http://localhost:4321',
  'http://localhost:3000',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** email が Customers に存在するか（存在有無だけを返す）。 */
async function isExistingCustomer(email) {
  const key = process.env.AIRTABLE_API_KEY;
  const base = process.env.AIRTABLE_BASE_ID;
  if (!key || !base) return null; // 判断できない

  const formula = encodeURIComponent(`{Email} = "${String(email).replace(/"/g, '\\"')}"`);
  const res = await fetch(
    `https://api.airtable.com/v0/${base}/Customers?maxRecords=1&filterByFormula=${formula}`,
    { headers: { Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) return null;
  const data = await res.json();
  return (data.records || []).length > 0;
}

export async function handler(event) {
  const origin = event.headers.origin || '';
  const { normalizeSiteOrigin } = await import('../../src/lib/http/siteOrigin.js');
  const headers = {
    'Access-Control-Allow-Origin': normalizeSiteOrigin(origin) || ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
    'Cache-Control': 'no-store',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'method_not_allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid_body' }) };
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!EMAIL_RE.test(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid_email' }) };
  }

  // 🔴 プランはサーバー側で検証する。未知・保留中の id は受け付けない
  const intent = normalizeIntent(body.plan);
  if (!intent) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid_plan' }) };
  }

  try {
    const existing = await isExistingCustomer(email);
    if (existing === null) {
      return { statusCode: 503, headers, body: JSON.stringify({ error: 'not_configured' }) };
    }

    // 🔴 既存の関数へそのまま委譲する（Airtable への書き込み・メール文面を二重管理しない）
    const target = existing ? './send-magic-link.js' : './register-free.js';
    const { handler: delegate } = await import(target);
    const res = await delegate({
      ...event,
      httpMethod: 'POST',
      body: JSON.stringify({ email, intent }),
    });

    // 🔴 会員かどうかで応答を変えない（存在判定に使わせない）
    const ok = res && res.statusCode >= 200 && res.statusCode < 300;
    return {
      statusCode: ok ? 200 : 502,
      headers,
      body: JSON.stringify(ok
        ? { sent: true }
        : { error: 'send_failed' }),
    };
  } catch {
    console.error('❌ start-purchase failed');
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'send_failed' }) };
  }
}
