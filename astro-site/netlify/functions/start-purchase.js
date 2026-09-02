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

/*
 * 🔴 委譲は **同一デプロイへの HTTP** で行う。プロセス内 import ではない。
 *
 *    `send-magic-link.js` / `register-free.js` は `exports.handler` 形式だが、
 *    `package.json` が `"type": "module"` のため esbuild は ESM として扱う。
 *    そのため他の関数から取り込むと `exports` がバンドル側の変数に化け、
 *    `require('./send-magic-link.js').handler` が undefined になる
 *    （2026-09-02 に 502 send_failed として発生。バンドル再現で確認済み）。
 *    それらのファイルは本番のログイン・登録経路そのものなので、
 *    この作業では書き換えない。
 *
 * 🔴 委譲先は **自分と同じデプロイ**に固定する。
 *    Netlify がビルド時に注入する `DEPLOY_PRIME_URL` / `URL` を優先し、
 *    無い場合だけリクエスト由来の origin（許可ホストのみ）へ落とす。
 *    Host ヘッダーだけを信じると、ブランチデプロイの申し込みが
 *    本番のマジックリンクを送ってしまう。
 */

import { normalizeIntent } from '../../src/lib/billing/purchaseIntent.js';
import { normalizeSiteOrigin, resolveSiteOrigin } from '../../src/lib/http/siteOrigin.js';

/** 自分自身（同一デプロイ）の origin。 */
function selfOrigin(event) {
  return normalizeSiteOrigin(process.env.DEPLOY_PRIME_URL)
    || normalizeSiteOrigin(process.env.URL)
    || resolveSiteOrigin(event.headers);
}

const ALLOWED_ORIGINS = [
  'https://keiba-intelligence.jp',
  'https://www.keiba-intelligence.jp',
  'http://localhost:4321',
  'http://localhost:3000',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * email の会員状態を返す。`null` は「判断できない」。
 *
 * 🔴 ここで見るのは **どの既存関数へ委譲するか** を決めるためだけ。
 *    認可の判断には使わない（Checkout は従来どおりセッションを見る）。
 */
async function lookupCustomerStatus(email) {
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
  const rec = (data.records || [])[0];
  if (!rec) return { exists: false, status: null };
  return { exists: true, status: rec.fields && rec.fields.Status ? String(rec.fields.Status) : null };
}

export async function handler(event) {
  const origin = event.headers.origin || '';
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
    const found = await lookupCustomerStatus(email);
    if (found === null) {
      return { statusCode: 503, headers, body: JSON.stringify({ error: 'not_configured' }) };
    }

    /*
     * 🔴 既存の関数へそのまま委譲する（Airtable への書き込み・メール文面を二重管理しない）
     *
     *    `send-magic-link` は Status が active でない会員を 403 で止める。
     *    登録したがまだ認証を終えていない人（Status: pending）は
     *    そのままだと購入導線で行き止まりになり、やり直しもできない。
     *    その場合は `register-free` を通す。これは本人が `/register` で
     *    同じアドレスを入力したときと **まったく同じ経路**であり、
     *    重複レコードも作らない（既存レコードをそのまま返す実装）。
     *
     *    active / pending 以外（inactive・payment_failed 等）の扱いは変えない。
     *    従来どおり `send-magic-link` の判断に委ねる。
     */
    const useRegister = !found.exists || found.status === 'pending';
    const path = useRegister ? 'register-free' : 'send-magic-link';
    const res = await fetch(`${selfOrigin(event)}/.netlify/functions/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, intent }),
    });

    // 🔴 会員かどうかで応答を変えない（存在判定に使わせない）
    const ok = res.ok;
    if (!ok) console.error(`❌ start-purchase: ${path} responded ${res.status}`);
    return {
      statusCode: ok ? 200 : 502,
      headers,
      body: JSON.stringify(ok
        ? { sent: true }
        : { error: 'send_failed' }),
    };
  } catch (err) {
    console.error('❌ start-purchase failed:', err && err.message);
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'send_failed' }) };
  }
}
