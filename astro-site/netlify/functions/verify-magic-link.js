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
import { customerSessionTier } from '../../src/lib/auth/paidEntitlement.js';
import { canSeeBetting } from '../../src/lib/auth/tiers.js';
import { signSession, serializeSessionCookie, SESSION_TTL_SECONDS } from '../../src/lib/auth/session.js';
import { readRevocation, tierForNewSession } from '../../src/lib/auth/revocation.js';
import { escapeFormulaString } from '../../src/lib/airtable/formula.js';
import { isValidMagicLinkToken } from '../../src/lib/auth/magicLinkToken.js';
// 🔴 メールアドレスはログへ平文で出さない（src/lib/log/maskEmail.cjs）
import { redactEmails } from '../../src/lib/log/maskEmail.cjs';

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

    // 🔴 発行側が作る形式以外は Airtable へ問い合わせずに 400（式インジェクション対策・registry 5a5dd591）
    if (!isValidMagicLinkToken(token)) {
      console.error('❌ Token format invalid');
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid token' }) };
    }

    console.log('🔐 Verifying token: [redacted]');

    // 1. トークン検証
    const tokens = await authTokensTable
      .select({ filterByFormula: `{Token} = "${escapeFormulaString(token)}"`, maxRecords: 1 })
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
      .select({ filterByFormula: `{Email} = "${escapeFormulaString(tokenData.Email)}"`, maxRecords: 1 })
      .firstPage();

    if (customers.length === 0) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Customer not found' }) };
    }

    const customer = customers[0].fields;
    const planExpiresAt = customer.ExpirationDate || customer['有効期限'] || null;

    // 3.5. 顧客ステータス更新（PlanType は上書きしない＝有料プランが消えるバグ防止）
    // 🔴 本人確認の完了（pending → active）だけを書く。契約終了（inactive）・決済失敗（payment_failed）の
    //    記録は消さない（loginEligibility.js）。有料プランの申込で入金確認前（pending）の人も
    //    active にしない（入金確認は運営の操作）。tier は下の customerSessionTier で別に決める。
    const currentPlanType = customer.PlanType || 'free-registered';
    const { verifiedCustomerUpdate } = await import('../../src/lib/auth/loginEligibility.js');
    const updateFields = verifiedCustomerUpdate(customer);
    if (updateFields) {
      await customersTable.update([{ id: customers[0].id, fields: updateFields }]);
    }
    console.log('✅ Customer verified. status updated:', updateFields ? 'yes' : 'no', '| PlanType:', currentPlanType);

    // 4. tier を決めて署名付きセッションを発行
    const nowMs = Date.now();
    // 🔴 退会直後で webhook の反映前（Airtable がまだ premium）なら有料を出さない
    //    （docs/WITHDRAWAL_2026_10.md §4）
    const { revocation } = await readRevocation(customer.Email, { event });
    // 🔴 ログインできること（loginEligibility.js）と有料が見られることは別に判定する。
    //    有料は PlanType が有料・Status が active / payment_failed・有効期限が読めて切れていない
    //    ときだけ（paidEntitlement.js）。Status は **認証で書き換える前** の値で判定する。
    const tier = tierForNewSession(customerSessionTier(customer, nowMs), revocation);

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
    // 🔴 ログインできた人は tier を問わずマイページへ（2026-09-02）。
    //    無料会員も「自分の状態（プラン・KI 会員クラブ）」をまず見せる。
    //    以前は無料だけ /free-prediction へ送っていたため、
    //    ログイン直後に自分の状態を確認できなかった。
    let redirectTo = '/mypage';

    // 🔴 購入導線から来た場合は購入の続きへ戻す（登録→認証→Checkout を 1 本に繋ぐ）。
    //    受け取るのは **プラン id だけ**で、戻り先のパスは
    //    `resumePathFor` が固定文字列で組み立てる（open redirect を作らない）。
    //    未知・空・URL 等はすべて無視され、従来の戻り先のままになる。
    const { resumePathFor, normalizeIntent } = await import('../../src/lib/billing/purchaseIntent.js');
    // 🔴 ログイン前に見ていたページへ戻す（許可リストの相対パスだけ・src/lib/auth/returnTo.js）。
    //    不正・未指定は従来の /mypage。購入意図があれば resumePathFor が購入の続きを優先する。
    //    買い目を見られる会員が無料ページから来た場合は、対応する有料ページへ戻す
    //    （未ログインの有料ページは無料ページへ 302 するため。権限の判定は有料ページ自身が Cookie で行う）。
    const { normalizeReturnTo, returnToKind, paidEquivalentPath } = await import('../../src/lib/auth/returnTo.js');
    const rawNext = event.queryStringParameters?.next;
    const nextPath = normalizeReturnTo(rawNext);
    redirectTo = (nextPath && canSeeBetting(tier) && paidEquivalentPath(nextPath)) || nextPath || redirectTo;
    const rawIntent = event.queryStringParameters?.intent;
    redirectTo = resumePathFor(rawIntent, redirectTo);
    // 🔴 値そのものは出さない（受け取ったか / 有効だったかだけ）
    console.log('↩︎ redirect:', redirectTo,
      '| intent received:', rawIntent ? 'yes' : 'no',
      '| intent valid:', normalizeIntent(rawIntent) ? 'yes' : 'no',
      '| return_to:', returnToKind(rawNext));

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
    console.error('❌ Verify magic link error:', redactEmails(error));
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal Server Error' }),
    };
  }
}
