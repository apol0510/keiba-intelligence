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
    // BlastMail REST API v1.0: /contact/detail/search
    const searchUrl = 'https://api.bme.jp/rest/1.0/contact/detail/search';
    const searchParams = new URLSearchParams({
      access_token: accessToken,
      format: 'json',
      c15: email,  // E-Mail検索（c15 = E-Mailフィールド）
      limit: '10',
      offset: '0'
    });

    console.log('🔍 Searching with URL:', searchUrl);
    console.log('🔍 Search params:', searchParams.toString());

    const searchResponse = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: searchParams.toString()
    });

    console.log('📡 Search response status:', searchResponse.status);

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      console.error('❌ Search error response:', errorText);
      throw new Error(`BlastMail search failed: ${searchResponse.status} - ${errorText}`);
    }

    const searchData = await searchResponse.json();

    console.log('✅ BlastMail search result:', JSON.stringify(searchData, null, 2));

    // 結果を返す
    const contacts = searchData.contacts || searchData.contact || [];
    const count = searchData.totalCount || searchData.count || contacts.length;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        email: email,
        found: count > 0,
        count: count,
        readers: contacts,
        rawResponse: searchData,
        message: count > 0
          ? `Found ${count} reader(s)`
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
