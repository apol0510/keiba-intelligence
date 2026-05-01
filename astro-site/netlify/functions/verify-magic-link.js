/**
 * トークン検証・セッション作成API
 *
 * マジックリンクのトークンを検証し、セッションを作成
 */

const { v4: uuidv4 } = require('uuid');
const Airtable = require('airtable');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);
const authTokensTable = base('AuthTokens');
const customersTable = base('Customers');

/**
 * メインハンドラー
 */
exports.handler = async (event) => {
  // CORS設定（セキュリティ強化：特定ドメインのみ許可）
  const allowedOrigins = [
    'https://keiba-intelligence.netlify.app',
    'https://keiba-intelligence.netlify.app',
    'http://localhost:4321',
    'http://localhost:3000'
  ];

  const origin = event.headers.origin || '';
  const allowOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

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
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  try {
    const { token } = event.queryStringParameters || {};

    if (!token) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Token is required' }),
      };
    }

    console.log('🔐 Verifying token:', token);

    // 1. トークン検証
    const tokens = await authTokensTable
      .select({
        filterByFormula: `{Token} = "${token}"`,
        maxRecords: 1,
      })
      .firstPage();

    if (tokens.length === 0) {
      console.error('❌ Token not found:', token);
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Token not found' }),
      };
    }

    const tokenRecord = tokens[0];
    const tokenData = tokenRecord.fields;

    // 使用済みチェック
    if (tokenData.Used) {
      console.error('❌ Token already used:', token);
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Token already used' }),
      };
    }

    // 有効期限チェック
    if (new Date() > new Date(tokenData.ExpiresAt)) {
      console.error('❌ Token expired:', token);
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Token expired' }),
      };
    }

    // 2. トークンを使用済みに更新
    await authTokensTable.update([
      {
        id: tokenRecord.id,
        fields: {
          Used: true,
        },
      },
    ]);

    console.log('✅ Token marked as used:', token);

    // 3. 顧客情報を取得
    const customers = await customersTable
      .select({
        filterByFormula: `{Email} = "${tokenData.Email}"`,
        maxRecords: 1,
      })
      .firstPage();

    if (customers.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Customer not found' }),
      };
    }

    const customer = customers[0].fields;
    const venueAccess = customer.VenueAccess || 'all';
    const planExpiresAt = customer.ExpirationDate || customer['有効期限'] || null;

    // 3.5. 顧客ステータスを更新（pending → active, AccessEnabled → true）
    // ※ PlanTypeは上書きしない（有料プランが消えるバグ防止）
    const currentPlanType = customer.PlanType || 'free-registered';
    const updateFields = {
      Status: 'active',
      AccessEnabled: true,
    };
    // PlanTypeが未設定の場合のみ free-registered をセット
    if (!customer.PlanType) {
      updateFields.PlanType = 'free-registered';
    }

    await customersTable.update([
      {
        id: customers[0].id,
        fields: updateFields,
      },
    ]);

    console.log('✅ Customer status updated to active:', customer.Email, 'PlanType:', currentPlanType);

    // 4. セッション作成（簡易実装: Cookieのみ、Blobsは不使用）
    const sessionId = uuidv4();

    // セッションデータをJSON化してCookieに保存
    const sessionData = {
      email: customer.Email,
      plan_type: currentPlanType,
      created_at: new Date().toISOString(),
    };

    console.log('✅ Session created:', sessionId, 'for:', customer.Email);

    // 5. JSONレスポンスでセッション情報を返す（クライアント側でsessionStorageに保存）
    const planType = currentPlanType.toLowerCase();
    let redirectTo = '/free-prediction'; // デフォルト: 無料予想ページ
    if (planType === 'pro' || planType === 'pro-plus' || planType === 'light') {
      // 会場別リダイレクト
      if (venueAccess === 'jra') {
        redirectTo = '/prediction/jra';
      } else if (venueAccess === 'nankan') {
        redirectTo = '/prediction/nankan';
      } else {
        // 'all' など両会場アクセス可: マイページから選ばせる（JRAへ辿りやすくする）
        redirectTo = '/mypage';
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        redirectTo,
        session: {
          user: { email: customer.Email, name: customer.Name || '' },
          plan: currentPlanType,
          venueAccess: venueAccess,
          planExpiresAt: planExpiresAt,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        },
      }),
    };
  } catch (error) {
    console.error('❌ Verify magic link error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Internal Server Error',
        details: error.message,
      }),
    };
  }
};
