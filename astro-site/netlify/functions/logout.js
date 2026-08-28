/**
 * ログアウトAPI
 *
 * 🔴 2026-08-28 変更（docs/RENEWAL_2026_08.md §7）:
 *   署名付きセッション Cookie `ki_session` を失効させる。
 *   旧 `session_id` Cookie も併せて消す（残っていても無害だが掃除する）。
 *   Netlify Blobs は使わない（セッションは署名付き Cookie に自己完結している）。
 */

import { clearSessionCookie } from '../../src/lib/auth/session.js';

const ALLOWED_ORIGINS = [
  'https://keiba-intelligence.jp',
  'https://www.keiba-intelligence.jp',
  'https://keiba-intelligence.netlify.app',
  'http://localhost:4321',
  'http://localhost:3000',
];

function isLocalHost(event) {
  const host = event?.headers?.host || '';
  return host.startsWith('localhost') || host.startsWith('127.0.0.1');
}

export async function handler(event) {
  const origin = event.headers.origin || '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  const headers = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const secure = !isLocalHost(event);
  const legacy = `session_id=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;

  return {
    statusCode: 302,
    multiValueHeaders: {
      'Set-Cookie': [clearSessionCookie({ secure }), legacy],
    },
    headers: { Location: '/login' },
    body: '',
  };
}
