/**
 * refresh-session — 決済直後などに、いまの権限で Cookie を出し直す
 *
 * 正本: docs/RENEWAL_2026_08.md §7（認可）
 *
 * 背景:
 *   `ki_session` は **発行時点の tier を署名して固定**している。
 *   そのため Stripe の決済が通って Airtable が premium になっても、
 *   手元の Cookie は free のままで、マイページも予想ページも無料会員として描画される
 *   （2026-09-02 に発生。決済後もマイページが「無料会員」だった）。
 *   再ログインするまで直らないので、決済後にここで出し直す。
 *
 * 🔴 これは **認証の入口ではない**。
 *   - 有効な `ki_session` が無ければ 401。ここでログインはできない
 *   - email は **セッション由来**のみ。リクエストの中身は一切見ない
 *   - tier は **Airtable の PlanType / ExpirationDate からだけ**決める。
 *     `verify-magic-link` とまったく同じ関数を使う
 *   - premium を与えるのは従来どおり **Stripe の webhook** だけ。ここでは何も書かない
 *
 * 🔴 セッションの寿命は延ばさない。
 *   元の `expiresAtMs` までの残り時間をそのまま引き継ぐ。
 *   ここで満了を先送りできると、再認証なしにセッションを延命できてしまう。
 */

import Airtable from 'airtable';
import { planTypeToTier, applyExpiry } from '../../src/lib/auth/tiers.js';
import { signSession, serializeSessionCookie } from '../../src/lib/auth/session.js';
import { resolveEntitlement } from '../../src/lib/auth/entitlement.js';
import { resolveSiteOrigin } from '../../src/lib/http/siteOrigin.js';

function isLocalHost(event) {
  const host = event?.headers?.host || '';
  return host.startsWith('localhost') || host.startsWith('127.0.0.1');
}

export async function handler(event) {
  const headers = {
    'Access-Control-Allow-Origin': resolveSiteOrigin(event.headers),
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
    'Cache-Control': 'private, no-store',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'method_not_allowed' }) };
  }

  const nowMs = Date.now();
  const ent = resolveEntitlement({
    cookieHeader: event.headers.cookie || null,
    env: process.env,
    nowMs,
  });

  // 🔴 ここでログインはできない。有効なセッションが無ければ何もしない
  if (!ent.authenticated || !ent.email) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'login_required' }) };
  }

  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) {
    // 判断できないときは **いまの Cookie をそのまま残す**（fail-closed）
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'not_configured' }) };
  }

  try {
    const customersTable = new Airtable({ apiKey }).base(baseId)('Customers');
    const escaped = String(ent.email).replace(/"/g, '\\"');
    const customers = await customersTable
      .select({ filterByFormula: `{Email} = "${escaped}"`, maxRecords: 1 })
      .firstPage();

    if (customers.length === 0) {
      // レコードが無い＝判断材料が無い。降格も昇格もしない
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ tier: ent.tier, changed: false }),
      };
    }

    const customer = customers[0].fields;
    const tier = applyExpiry(
      planTypeToTier(customer.PlanType || 'free-registered'),
      customer.ExpirationDate || customer['有効期限'] || null,
      nowMs,
    );

    if (tier === ent.tier) {
      return { statusCode: 200, headers, body: JSON.stringify({ tier, changed: false }) };
    }

    // 🔴 残り時間だけを引き継ぐ（満了を先送りしない）
    const remainingSeconds = Math.floor((ent.expiresAtMs - nowMs) / 1000);
    if (!Number.isFinite(remainingSeconds) || remainingSeconds <= 0) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'login_required' }) };
    }

    const signed = signSession({
      email: ent.email,
      tier,
      secret: process.env.SESSION_SIGNING_SECRET,
      nowMs,
      ttlSeconds: remainingSeconds,
    });

    if (!signed.ok) {
      // secret が無い等。Cookie は差し替えず、いまのまま
      console.error('⚠️ refresh-session: cookie NOT reissued:', signed.reason);
      return { statusCode: 200, headers, body: JSON.stringify({ tier: ent.tier, changed: false }) };
    }

    console.log('🔄 refresh-session:', ent.tier, '→', tier);

    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Set-Cookie': serializeSessionCookie(signed.token, {
          maxAgeSeconds: remainingSeconds,
          secure: !isLocalHost(event),
        }),
      },
      body: JSON.stringify({ tier, changed: true }),
    };
  } catch (err) {
    console.error('❌ refresh-session failed:', err && err.message);
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'lookup_failed' }) };
  }
}
