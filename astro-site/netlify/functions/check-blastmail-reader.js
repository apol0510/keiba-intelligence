/**
 * BlastMail読者確認デバッグAPI
 *
 * 使い方:
 * GET /.netlify/functions/check-blastmail-reader?email=apolone_bkm@yahoo.co.jp
 */

exports.handler = async (event) => {
  const BLASTMAIL_USERNAME = process.env.BLASTMAIL_USERNAME;
  const BLASTMAIL_PASSWORD = process.env.BLASTMAIL_PASSWORD;
  const BLASTMAIL_API_KEY = process.env.BLASTMAIL_API_KEY;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  try {
    const { email } = event.queryStringParameters || {};

    if (!email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email parameter required' }),
      };
    }

    console.log('🔍 Checking BlastMail reader:', email);

    // Step 1: ログイン（access_token取得）
    const loginUrl = 'https://api.bme.jp/rest/1.0/authenticate/login';
    const loginParams = new URLSearchParams({
      username: BLASTMAIL_USERNAME,
      password: BLASTMAIL_PASSWORD,
      api_key: BLASTMAIL_API_KEY,
      format: 'json'
    });

    const loginResponse = await fetch(loginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: loginParams.toString()
    });

    if (!loginResponse.ok) {
      throw new Error(`BlastMail login failed: ${loginResponse.status}`);
    }

    const loginData = await loginResponse.json();
    const accessToken = loginData.accessToken;

    console.log('✅ BlastMail login successful');

    // Step 2: 読者検索（E-Mailで検索）
    const searchUrl = 'https://api.bme.jp/rest/1.0/contact/search';
    const searchParams = new URLSearchParams({
      access_token: accessToken,
      format: 'json',
      c15: email,  // E-Mail検索（c15 = E-Mailフィールド）
    });

    const searchResponse = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: searchParams.toString()
    });

    if (!searchResponse.ok) {
      throw new Error(`BlastMail search failed: ${searchResponse.status}`);
    }

    const searchData = await searchResponse.json();

    console.log('✅ BlastMail search result:', JSON.stringify(searchData, null, 2));

    // 結果を返す
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        email: email,
        found: searchData.count > 0,
        count: searchData.count,
        readers: searchData.contact || [],
        message: searchData.count > 0
          ? `Found ${searchData.count} reader(s)`
          : 'Reader not found in BlastMail',
      }, null, 2),
    };

  } catch (error) {
    console.error('❌ Error:', error);
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
