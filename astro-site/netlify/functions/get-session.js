/**
 * セッション確認API
 *
 * 🔴 2026-08-28 変更（docs/RENEWAL_2026_08.md §7 / 監査 A-4 の是正）:
 *   旧実装は Netlify Blobs の `session_id` を読む前提だったが、
 *   `verify-magic-link` が Blobs もその Cookie も作っていなかったため常に 401 になっていた。
 *
 *   本実装は `ki_session`（HMAC 署名付き Cookie）を検証して返す。
 *   返すのは **tier と表示フラグのみ**。email 以外の顧客情報は返さない。
 *
 * 🔴 これは「現在の権限を UI へ知らせる」ための補助 API である。
 *    ページ側の認可はサーバー描画時の entitlement で行われており、
 *    この API の応答を書き換えても有料コンテンツは出てこない。
 */

import { resolveEntitlement } from '../../src/lib/auth/entitlement.js';

const ALLOWED_ORIGINS = [
  'https://keiba-intelligence.jp',
  'https://www.keiba-intelligence.jp',
  'https://keiba-intelligence.netlify.app',
  'http://localhost:4321',
  'http://localhost:3000',
];

export async function handler(event) {
  const origin = event.headers.origin || '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  const headers = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
    'Cache-Control': 'private, no-store',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const ent = resolveEntitlement({
    cookieHeader: event.headers.cookie || null,
    env: process.env,
    nowMs: Date.now(),
  });

  if (!ent.authenticated) {
    // 🔴 失敗理由は返さない（内部区分を外部へ出さない）
    return { statusCode: 401, headers, body: JSON.stringify({ success: false, authenticated: false }) };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      // `success` は既存クライアント（AuthCheck.astro）との互換のため維持する
      success: true,
      authenticated: true,
      user: { email: ent.email },
      tier: ent.tier,
      tierLabel: ent.tierLabel,
      venueAccess: ent.venueAccess,
      showMarks: ent.showMarks,
      showBetting: ent.showBetting,
      showPremiumExtras: ent.showPremiumExtras,
      expiresAt: ent.expiresAtMs ? new Date(ent.expiresAtMs).toISOString() : null,
    }),
  };
}
