/**
 * セッション確認API
 *
 * Netlify Blobsからセッション情報を取得
 */

const { getStore } = require('@netlify/blobs');

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
    // Cookieからセッションid取得
    const cookies = event.headers.cookie || '';
    const sessionIdMatch = cookies.match(/session_id=([^;]+)/);

    if (!sessionIdMatch) {
      console.warn('⚠️ No session cookie found');
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Not authenticated' }),
      };
    }

    const sessionId = sessionIdMatch[1];
    const store = getStore('sessions');

    // セッション取得
    const sessionData = await store.get(sessionId);

    if (!sessionData) {
      console.warn('⚠️ Session not found or expired:', sessionId);
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Session not found or expired' }),
      };
    }

    const session = JSON.parse(sessionData);

    console.log('✅ Session found:', sessionId, 'for:', session.email);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        user: session,
      }),
    };
  } catch (error) {
    console.error('❌ Get session error:', error);
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
