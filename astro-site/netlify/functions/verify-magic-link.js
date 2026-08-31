/**
 * トークン検証・セッション作成API
 *
 * マジックリンクのトークンを検証し、**サーバーが検証できる署名付きセッション Cookie** を発行する。
 *
 * 🔴 2026-08-28 変更（docs/RENEWAL_2026_08.md §7 / 監査 A-4 の是正）:
 *   旧実装は Cookie を発行せず、セッションを JSON で返してクライアントの sessionStorage に
 *   保存させていた。そのためサーバー側で権限を検証できず、有料コンテンツの認可が
 *   クライアントの自己申告に依存していた。
 *
 *   本実装は `ki_session`（HttpOnly / Secure / SameSite=Lax / HMAC-SHA256 署名）を発行する。
 *   JSON レスポンスは **表示補助のため互換維持**するが、**権限判定の根拠にはならない**。
 *
 * 🔴 `SESSION_SIGNING_SECRET` 未設定時は Cookie を発行しない（fail-closed）。
 *    この場合、閲覧者は guest 扱いとなり、印・買い目は表示されない。
 */

import Airtable from 'airtable';
import { planTypeToTier, applyExpiry, TIER } from '../../src/lib/auth/tiers.js';
import { signSession, serializeSessionCookie, SESSION_TTL_SECONDS } from '../../src/lib/auth/session.js';

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);
const authTokensTable = base('AuthTokens');
const customersTable = base('Customers');

/** 本番ドメインを含む（2026-08-17 監査 A-8 の是正）。 */
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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { token } = event.queryStringParameters || {};
    if (!token) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Token is required' }) };
    }

    console.log('🔐 Verifying token: [redacted]');

    // 1. トークン検証
    const tokens = await authTokensTable
      .select({ filterByFormula: `{Token} = "${token}"`, maxRecords: 1 })
      .firstPage();

    if (tokens.length === 0) {
      console.error('❌ Token not found');
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Token not found' }) };
    }

    const tokenRecord = tokens[0];
    const tokenData = tokenRecord.fields;

    if (tokenData.Used) {
      console.error('❌ Token already used');
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Token already used' }) };
    }

    if (new Date() > new Date(tokenData.ExpiresAt)) {
      console.error('❌ Token expired');
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Token expired' }) };
    }

    // 2. トークンを使用済みに更新
    await authTokensTable.update([{ id: tokenRecord.id, fields: { Used: true } }]);
    console.log('✅ Token marked as used');

    // 3. 顧客情報を取得
    const customers = await customersTable
      .select({ filterByFormula: `{Email} = "${tokenData.Email}"`, maxRecords: 1 })
      .firstPage();

    if (customers.length === 0) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Customer not found' }) };
    }

    const customer = customers[0].fields;
    const planExpiresAt = customer.ExpirationDate || customer['有効期限'] || null;

    // 3.5. 顧客ステータス更新（PlanType は上書きしない＝有料プランが消えるバグ防止）
    const currentPlanType = customer.PlanType || 'free-registered';
    const updateFields = { Status: 'active', AccessEnabled: true };
    if (!customer.PlanType) updateFields.PlanType = 'free-registered';
    await customersTable.update([{ id: customers[0].id, fields: updateFields }]);
    console.log('✅ Customer status updated to active. PlanType:', currentPlanType);

    // 4. tier を決めて署名付きセッションを発行
    const nowMs = Date.now();
    const tier = applyExpiry(planTypeToTier(currentPlanType), planExpiresAt, nowMs);

    const signed = signSession({
      email: customer.Email,
      tier,
      secret: process.env.SESSION_SIGNING_SECRET,
      nowMs,
      ttlSeconds: SESSION_TTL_SECONDS,
    });

    const responseHeaders = { ...headers };
    if (signed.ok) {
      responseHeaders['Set-Cookie'] = serializeSessionCookie(signed.token, {
        maxAgeSeconds: SESSION_TTL_SECONDS,
        secure: !isLocalHost(event),
      });
      console.log('✅ Signed session cookie issued. tier:', tier);
    } else {
      // 🔴 secret 未設定等。Cookie を出さない＝閲覧者は guest のまま（fail-closed）。
      console.error('⚠️ Session cookie NOT issued:', signed.reason);
    }

    // 5. リダイレクト先
    // 🔴 会場では分けない（2026-08-30 に「ライト＝南関」を廃止）
    let redirectTo = '/free-prediction';
    if (tier === TIER.LIGHT || tier === TIER.PREMIUM) redirectTo = '/mypage';

    return {
      statusCode: 200,
      headers: responseHeaders,
      body: JSON.stringify({
        success: true,
        redirectTo,
        // ⚠️ 表示補助のみ。権限判定の根拠にしない（サーバーは Cookie を見る）
        session: {
          user: { email: customer.Email, name: customer.Name || '' },
          plan: currentPlanType,
          tier,
          planExpiresAt,
          expiresAt: new Date(nowMs + SESSION_TTL_SECONDS * 1000).toISOString(),
        },
      }),
    };
  } catch (error) {
    console.error('❌ Verify magic link error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal Server Error' }),
    };
  }
}
