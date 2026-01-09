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
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
