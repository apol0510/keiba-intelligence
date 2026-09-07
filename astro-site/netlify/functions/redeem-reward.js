/**
 * redeem-reward — プレゼント交換・継続記念品の申込を受ける
 *
 * 正本: docs/MEMBERSHIP_REWARDS.md §7.9（発送先住所）／§7.8（品目）
 *
 * 🔴 安全契約:
 *   - POST のみ・**ログイン必須**。会員はセッション Cookie の email だけで識別する。
 *   - **クライアントの email / ポイント数 / 必要ポイント / 資格は一切見ない。**
 *   - 判定・保存は `redeemHandler.js`（I/O 抜きでテスト済み）に委ねる。
 *   - 🔴 **住所をログへ出さない。** 失敗時も符号だけを出す。
 */

import { resolveEntitlement } from '../../src/lib/auth/entitlement.js';
import { resolveMembershipStore } from '../../src/lib/membership/store.js';
import { handleRedeem } from '../../src/lib/membership/redeemHandler.js';
import { normalizeSiteOrigin } from '../../src/lib/http/siteOrigin.js';
import catalogSource from '../../src/data/membership/rewardCatalog.json' with { type: 'json' };

const DEFAULT_ORIGIN = 'https://keiba-intelligence.jp';

export async function handler(event) {
  const allowOrigin = normalizeSiteOrigin(event.headers?.origin || '') || DEFAULT_ORIGIN;
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
    cookieHeader: event.headers?.cookie || null,
    env: process.env,
    nowMs: Date.now(),
  });
  if (!ent.authenticated || !ent.email) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'login_required' }) };
  }

  let input = {};
  try {
    input = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid_body' }) };
  }

  try {
    const store = resolveMembershipStore({ env: process.env });
    const result = await handleRedeem({
      store,
      catalogSource,
      // 🔴 session の email のみ。input.email があっても使わない。
      email: ent.email,
      input,
      config: process.env,
      nowMs: Date.now(),
    });
    return { statusCode: result.statusCode, headers, body: JSON.stringify(result.body) };
  } catch {
    // 🔴 例外の中身を出さない（住所・メールが混ざりうる）
    console.error('❌ redeem-reward failed');
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'redeem_failed' }) };
  }
}
