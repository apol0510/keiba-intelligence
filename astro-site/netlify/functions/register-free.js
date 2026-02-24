/**
 * 無料会員登録 Netlify Function
 *
 * 処理フロー:
 * 1. Airtableに登録 (plan: free-registered, status: pending)
 * 2. BlastMailに登録 (登録元: keiba-intelligence, 隠しパラメータ使用)
 * 3. マジックリンク送信 (既存のsend-magic-link.js流用)
 */

const https = require('https');

// SendGrid APIでメール送信 (nankan-analytics方式: fetchを使用)
async function sendEmail(to, subject, body) {
  const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
  // Use Domain Authenticated subdomain instead of root domain
  const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'noreply@em8410.keiba-intelligence.jp';

  if (!SENDGRID_API_KEY) {
    console.error('❌ SENDGRID_API_KEY is not set');
    throw new Error('SendGrid API key is not configured');
  }

  console.log('📧 Sending email to:', to);
  console.log('📧 From:', FROM_EMAIL);
  console.log('📧 Subject:', subject);

  // SendGrid requires from email to be a verified sender
  // SendGrid API v3 format (nankan-analytics compatible)
  const payload = {
    personalizations: [
      {
        to: [
          {
            email: to
          }
        ],
        subject: subject
      }
    ],
    from: {
      email: FROM_EMAIL,
      name: 'KEIBA Intelligence'
    },
    content: [
      {
        type: 'text/html',
        value: body
      }
    ]
  };

  console.log('📧 SendGrid payload (partial):', JSON.stringify({
    to: to,
    from: FROM_EMAIL,
    subject: subject,
    contentType: 'text/html',
    bodyLength: body.length
  }));

  // Debug: Full payload (without body content for readability)
  console.log('📧 SendGrid full payload structure:', JSON.stringify({
    personalizations: payload.personalizations,
    from: payload.from,
    content: [{ type: payload.content[0].type, valueLength: payload.content[0].value.length }]
  }, null, 2));

  // Use fetch instead of https.request (nankan-analytics方式)
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ SendGrid error:', response.status, errorText);
    throw new Error(`SendGrid error: ${response.status} ${errorText}`);
  }

  console.log('✅ SendGrid email sent successfully (status:', response.status, ')');
}

// Airtableに登録 (重複チェック付き)
async function registerToAirtable(email) {
  const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
  const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    console.log('⚠️ Airtable環境変数未設定（スキップ）');
    return null;
  }

  try {
    // Step 1: 既存レコード確認（重複登録防止）
    const filterFormula = `{Email} = "${email}"`;
    const searchUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Customers?filterByFormula=${encodeURIComponent(filterFormula)}`;

    const searchResponse = await fetch(searchUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`
      }
    });

    if (!searchResponse.ok) {
      throw new Error(`Airtable search failed: ${searchResponse.status}`);
    }

    const searchData = await searchResponse.json();

    if (searchData.records && searchData.records.length > 0) {
      console.log('ℹ️ Airtable customer already exists:', email);
      return searchData.records[0];
    }

    // Step 2: 新規レコード作成
    const createUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Customers`;
    const createPayload = {
      records: [{
        fields: {
          Email: email,
          PlanType: 'free-registered',
          Status: 'pending',
          AccessEnabled: false,
          CreatedAt: new Date().toISOString(),
          Source: 'keiba-intelligence'
        }
      }]
    };

    const createResponse = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(createPayload)
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error('Airtable create error:', errorText);
      throw new Error(`Airtable create failed: ${createResponse.status}`);
    }

    const createData = await createResponse.json();
    console.log('✅ Airtable customer created:', email);
    return createData.records[0];

  } catch (error) {
    console.error('❌ Airtable error:', error);
    throw error;
  }
}

// BlastMailに登録 (nankan-analytics方式: REST API v1.0使用)
async function registerToBlastMail(email) {
  const BLASTMAIL_USERNAME = process.env.BLASTMAIL_USERNAME;
  const BLASTMAIL_PASSWORD = process.env.BLASTMAIL_PASSWORD;
  const BLASTMAIL_API_KEY = process.env.BLASTMAIL_API_KEY;

  if (!BLASTMAIL_USERNAME || !BLASTMAIL_PASSWORD || !BLASTMAIL_API_KEY) {
    console.log('⚠️ BlastMail credentials not configured, skipping reader registration');
    return null;
  }

  try {
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

    if (!accessToken) {
      throw new Error('BlastMail access token not returned');
    }

    console.log('✅ BlastMail login successful, access_token obtained');

    // Step 2: 読者登録 (c16 = registration_source カスタムフィールド)
    const registerUrl = 'https://api.bme.jp/rest/1.0/contact/detail/create';
    const registerParams = new URLSearchParams({
      access_token: accessToken,
      format: 'json',
      c15: email,                           // E-Mail（必須フィールド）
      c16: 'keiba-intelligence'             // 登録元サイト（カスタムフィールド）
    });

    const registerResponse = await fetch(registerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: registerParams.toString()
    });

    if (!registerResponse.ok) {
      const errorText = await registerResponse.text();

      // 重複登録エラーは成功として扱う
      if (errorText.includes('Has already been registered')) {
        console.log('ℹ️ BlastMail reader already registered:', email);
        return null;
      } else {
        throw new Error(`BlastMail reader registration failed: ${registerResponse.status} - ${errorText}`);
      }
    }

    const registerData = await registerResponse.json();
    console.log('✅ BlastMail reader registered:', email, 'ContactID:', registerData.contactID);
    return registerData;

  } catch (error) {
    console.error('❌ BlastMail registration error:', error);
    // BlastMailエラーでも処理は続行（登録は継続）
    return null;
  }
}

// マジックリンク生成とメール送信
async function sendMagicLink(email) {
  const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  const magicLink = `https://keiba-intelligence.jp/auth/verify?token=${token}&email=${encodeURIComponent(email)}`;

  const subject = '【KEIBA Intelligence】無料会員登録ありがとうございます！';
  const body = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0;">KEIBA Intelligence</h1>
    <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">AI競馬予想サービス</p>
  </div>

  <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 12px 12px;">
    <h2 style="color: #1e3a8a; margin-top: 0;">無料会員登録ありがとうございます！</h2>

    <p>以下のボタンをクリックして、登録を完了してください。</p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${magicLink}" style="display: inline-block; background: #3b82f6; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold;">
        登録を完了する
      </a>
    </div>

    <p style="font-size: 0.9em; color: #666;">
      ボタンが機能しない場合は、以下のURLをコピーしてブラウザに貼り付けてください：<br>
      <a href="${magicLink}" style="color: #3b82f6; word-break: break-all;">${magicLink}</a>
    </p>

    <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">

    <h3 style="color: #1e3a8a;">無料会員の特典</h3>
    <ul style="padding-left: 20px;">
      <li>✅ 全12レースの全頭予想が見られる</li>
      <li>✅ 本命・対抗・単穴・連下最上位の買い目表示</li>
      <li>✅ AI分析データが見られる</li>
      <li>✅ メールマガジン配信</li>
    </ul>

    <h3 style="color: #1e3a8a;">有料会員になると...</h3>
    <ul style="padding-left: 20px;">
      <li>🎯 全買い目（本線+抑え）が見られる</li>
      <li>🎯 全期間の的中実績が見られる</li>
      <li>🎯 永久アクセス（買い切り¥88,000）</li>
    </ul>

    <div style="text-align: center; margin-top: 30px;">
      <a href="https://keiba-intelligence.jp/pricing" style="display: inline-block; background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
        料金プランを見る →
      </a>
    </div>

    <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">

    <p style="font-size: 0.85em; color: #666;">
      このメールに心当たりがない場合は、このメールを無視してください。<br>
      リンクの有効期限は15分です。
    </p>

    <p style="font-size: 0.85em; color: #666; margin-top: 30px;">
      ---<br>
      KEIBA Intelligence<br>
      <a href="https://keiba-intelligence.jp" style="color: #3b82f6;">https://keiba-intelligence.jp</a><br>
      お問い合わせ: <a href="mailto:support@keiba-intelligence.jp" style="color: #3b82f6;">support@keiba-intelligence.jp</a>
    </p>
  </div>
</body>
</html>
  `;

  await sendEmail(email, subject, body);

  return token;
}

// メインハンドラー
exports.handler = async (event) => {
  // CORS headers
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
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const { email } = JSON.parse(event.body);

    if (!email || !email.includes('@')) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: '有効なメールアドレスを入力してください' }),
      };
    }

    console.log('📧 無料会員登録:', email);

    // 1. Airtableに登録
    try {
      await registerToAirtable(email);
      console.log('✅ Airtable登録完了');
    } catch (error) {
      console.error('⚠️ Airtable登録エラー:', error.message);
      // Airtable失敗は警告のみ（登録は継続）
    }

    // 2. BlastMailに登録
    try {
      await registerToBlastMail(email);
      console.log('✅ BlastMail登録完了');
    } catch (error) {
      console.error('⚠️ BlastMail登録エラー:', error.message);
      // BlastMail失敗は警告のみ（登録は継続）
    }

    // 3. マジックリンク送信
    const token = await sendMagicLink(email);
    console.log('✅ マジックリンク送信完了');

    // TODO: AuthTokensテーブルにトークン保存（後で実装）

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: '登録完了メールを送信しました',
        email: email
      }),
    };
  } catch (error) {
    console.error('❌ エラー:', error);
    console.error('❌ エラースタック:', error.stack);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: error.message || '登録処理に失敗しました',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }),
    };
  }
};
