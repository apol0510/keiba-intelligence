/**
 * ログアウトAPI
 *
 * Netlify Blobsからセッションを削除
 */

const { getStore } = require('@netlify/blobs');

/**
 * メインハンドラー
 */
exports.handler = async (event) => {
  // CORS設定（セキュリティ強化：特定ドメインのみ許可）
  const allowedOrigins = [
    'https://keiba-intelligence.netlify.app',
    'https://keiba-intelligence.keiba.link',
    'http://localhost:4321',
    'http://localhost:3000'
  ];

  const origin = event.headers.origin || '';
  const allowOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

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
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  try {
    // Cookieからセッションid取得
    const cookies = event.headers.cookie || '';
    const sessionIdMatch = cookies.match(/session_id=([^;]+)/);

    if (sessionIdMatch) {
      const sessionId = sessionIdMatch[1];
      const store = getStore('sessions');

      // セッション削除
      await store.delete(sessionId);

      console.log('✅ Session deleted:', sessionId);
    }

    // セッションCookieを削除してリダイレクト
    return {
      statusCode: 302,
      headers: {
        'Set-Cookie': 'session_id=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
        'Location': '/login',
      },
      body: '',
    };
  } catch (error) {
    console.error('❌ Logout error:', error);
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
