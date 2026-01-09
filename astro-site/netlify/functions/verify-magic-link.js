/**
 * トークン検証・セッション作成API
 *
 * マジックリンクのトークンを検証し、セッションを作成
 */

const { v4: uuidv4 } = require('uuid');
const Airtable = require('airtable');
const { getStore } = require('@netlify/blobs');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);
const authTokensTable = base('AuthTokens');
const customersTable = base('Customers');

/**
 * メインハンドラー
 */
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
        filterByFormula: `{token} = "${token}"`,
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
    if (tokenData.used) {
      console.error('❌ Token already used:', token);
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Token already used' }),
      };
    }

    // 有効期限チェック
    if (new Date() > new Date(tokenData.expires_at)) {
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
          used: true,
          used_at: new Date().toISOString(),
        },
      },
    ]);

    console.log('✅ Token marked as used:', token);

    // 3. 顧客情報を取得
    const customers = await customersTable
      .select({
        filterByFormula: `{Email} = "${tokenData.email}"`,
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

    // 4. セッション作成（Netlify Blobs）
    const sessionId = uuidv4();
    const store = getStore('sessions');

    const sessionData = {
      email: customer.Email,
      name: customer.Name,
      plan: customer.Plan,
      plan_type: customer.plan_type,
      created_at: new Date().toISOString(),
    };

    await store.set(sessionId, JSON.stringify(sessionData), {
      metadata: {
        ttl: 7 * 24 * 60 * 60, // 7日間（秒）
      },
    });

    console.log('✅ Session created:', sessionId, 'for:', customer.Email);

    // 5. セッションIDをCookieに設定してリダイレクト
    return {
      statusCode: 302,
      headers: {
        'Set-Cookie': `session_id=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${7 * 24 * 60 * 60}`,
        'Location': '/admin/newsletter',
      },
      body: '',
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
