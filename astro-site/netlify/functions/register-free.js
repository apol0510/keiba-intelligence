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
    // 🚨 重要: Sourceフィールドでフィルタリング（keiba-intelligence登録者のみ）
    const filterFormula = `AND({Email} = "${email}", OR({Source} = "keiba-intelligence", {Source} = BLANK()))`;
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

    // Step 2: 既存ユーザーチェック（メールアドレスで検索）
    const searchParams = new URLSearchParams({
      access_token: accessToken,
      format: 'json',
      c15: email  // メールアドレスで検索
    });
    const searchUrl = `https://api.bme.jp/rest/1.0/contact/list?${searchParams.toString()}`;

    const searchResponse = await fetch(searchUrl, {
      method: 'GET'
    });

    let existingContact = null;
    if (searchResponse.ok) {
      const searchData = await searchResponse.json();
      console.log('🔍 BlastMail search response:', JSON.stringify(searchData));
      if (searchData.contacts && searchData.contacts.length > 0) {
        existingContact = searchData.contacts[0];
        console.log('ℹ️ BlastMail existing contact found:', email, 'ContactID:', existingContact.contactID, 'Current c19:', existingContact.c19);
      } else {
        console.log('ℹ️ BlastMail existing contact not found, will create new');
      }
    } else {
      const errorText = await searchResponse.text();
      console.error('⚠️ BlastMail search failed:', searchResponse.status, errorText);
    }

    // Step 3: 既存ユーザーの場合は registration_source を追加更新
    if (existingContact) {
      const registrationSource = 'keiba-intelligence';
      const currentSource = existingContact.c19 || '';
      const sources = currentSource.split(',').map(s => s.trim()).filter(s => s);

      // 既に含まれている場合はスキップ
      if (sources.includes(registrationSource)) {
        console.log('ℹ️ Registration source already includes:', registrationSource);
        return existingContact;
      }

      // 新しいsourceを追加
      sources.push(registrationSource);
      const newSource = sources.join(',');

      // 既存ユーザーを更新
      const updateUrl = 'https://api.bme.jp/rest/1.0/contact/detail/update';
      const updateParams = new URLSearchParams({
        access_token: accessToken,
        format: 'json',
        contact_id: existingContact.contactID,
        c19: newSource  // カンマ区切りで追加
      });

      const updateResponse = await fetch(updateUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: updateParams.toString()
      });

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        console.error('⚠️ BlastMail update failed:', errorText);
        // BlastMail更新失敗でも処理は継続（マジックリンク送信を優先）
        return existingContact;
      }

      console.log('✅ BlastMail registration_source updated:', email, 'New sources:', newSource);
      return existingContact;
    }

    // Step 4: 新規ユーザー登録
    const registerUrl = 'https://api.bme.jp/rest/1.0/contact/detail/create';
    const registerParams = new URLSearchParams({
      access_token: accessToken,
      format: 'json',
      c15: email,                           // E-Mail（必須フィールド）
      c19: 'keiba-intelligence'             // 登録元サイト（registration_source: c19）
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
      console.log('⚠️ BlastMail registration response (not ok):', registerResponse.status, errorText);
      throw new Error(`BlastMail reader registration failed: ${registerResponse.status} - ${errorText}`);
    }

    const registerData = await registerResponse.json();
    console.log('✅ BlastMail reader registered:', email, 'ContactID:', registerData.contactID, 'registration_source: keiba-intelligence');
    return registerData;

  } catch (error) {
    console.error('❌ BlastMail registration error:', error);
    // BlastMailエラーでも処理は続行（登録は継続）
    return null;
  }
}

// トークンをAirtable AuthTokensテーブルに保存
async function saveAuthToken(email, token) {
  const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
  const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    console.log('⚠️ Airtable環境変数未設定（トークン保存スキップ）');
    return null;
  }

  try {
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15分後
    const createUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/AuthTokens`;
    const createPayload = {
      records: [{
        fields: {
          Token: token,
          Email: email,
          ExpiresAt: expiresAt.toISOString(),
          Used: false,
          CreatedAt: new Date().toISOString()
        }
      }]
    };

    const response = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(createPayload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AuthTokens save error:', errorText);
      throw new Error(`AuthTokens save failed: ${response.status}`);
    }

    const data = await response.json();
    console.log('✅ AuthToken saved:', token.substring(0, 8) + '...');
    return data.records[0];

  } catch (error) {
    console.error('❌ AuthToken save error:', error);
    throw error;
  }
}

// マジックリンク生成とメール送信
async function sendMagicLink(email) {
  const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  const magicLink = `https://keiba-intelligence.netlify.app/auth/verify?token=${token}&email=${encodeURIComponent(email)}`;

  const subject = '【KEIBA Intelligence】無料会員登録ありがとうございます！';
  const body = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: 'Noto Sans JP', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc;">
  <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
    <h1 style="color: #ffffff; margin: 0; font-size: 28px;">KEIBA Intelligence</h1>
    <p style="color: rgba(255,255,255,0.95); margin: 10px 0 0 0; font-size: 16px;">AI競馬予想サービス</p>
  </div>

  <div style="background: #ffffff; padding: 32px; border-radius: 0 0 12px 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <h2 style="color: #1e40af; margin-top: 0; font-size: 22px;">無料会員登録ありがとうございます！</h2>

    <p style="color: #334155; font-size: 16px; line-height: 1.6;">以下のボタンをクリックして、登録を完了してください。</p>

    <div style="text-align: center; margin: 32px 0;">
      <a href="${magicLink}" style="display: inline-block; background-color: #3b82f6; color: #ffffff !important; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 18px; border: 2px solid #3b82f6;">
        登録を完了する
      </a>
    </div>

    <div style="background-color: #f1f5f9; border-left: 4px solid #3b82f6; padding: 16px; margin: 24px 0; border-radius: 4px;">
      <p style="color: #475569; font-size: 14px; margin: 0 0 8px 0; line-height: 1.6;">
        ボタンが機能しない場合は、以下のURLをコピーしてブラウザに貼り付けてください：
      </p>
      <p style="margin: 0;">
        <a href="${magicLink}" style="color: #3b82f6; word-break: break-all; font-size: 13px;">${magicLink}</a>
      </p>
    </div>

    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0;">

    <h3 style="color: #1e40af; margin-top: 0; font-size: 18px;">無料会員の特典</h3>
    <ul style="padding-left: 20px; color: #334155; line-height: 1.8;">
      <li style="margin-bottom: 8px;">✅ 全12レースの全頭予想が見られる</li>
      <li style="margin-bottom: 8px;">✅ 本命・対抗・単穴・連下最上位の買い目表示</li>
      <li style="margin-bottom: 8px;">✅ AI分析データが見られる</li>
      <li style="margin-bottom: 8px;">✅ メールマガジン配信</li>
    </ul>

    <h3 style="color: #1e40af; font-size: 18px;">有料会員になると...</h3>
    <ul style="padding-left: 20px; color: #334155; line-height: 1.8;">
      <li style="margin-bottom: 8px;">🎯 全買い目（本線+抑え）が見られる</li>
      <li style="margin-bottom: 8px;">🎯 全期間の的中実績が見られる</li>
      <li style="margin-bottom: 8px;">🎯 永久アクセス（買い切り¥88,000）</li>
    </ul>

    <div style="text-align: center; margin-top: 32px;">
      <a href="https://keiba-intelligence.netlify.app/pricing" style="display: inline-block; background-color: #10b981; color: #ffffff !important; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; border: 2px solid #10b981;">
        料金プランを見る →
      </a>
    </div>

    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0;">

    <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 16px; margin: 24px 0; border-radius: 4px;">
      <p style="color: #991b1b; font-size: 14px; margin: 0; line-height: 1.6;">
        このメールに心当たりがない場合は、このメールを無視してください。<br>
        リンクの有効期限は15分です。
      </p>
    </div>

    <p style="font-size: 14px; color: #64748b; margin-top: 32px; line-height: 1.6;">
      KEIBA Intelligence<br>
      <a href="https://keiba-intelligence.netlify.app" style="color: #3b82f6; text-decoration: none;">https://keiba-intelligence.netlify.app</a>
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

    // 4. AuthTokensテーブルにトークン保存
    try {
      await saveAuthToken(email, token);
      console.log('✅ AuthToken保存完了');
    } catch (error) {
      console.error('⚠️ AuthToken保存エラー:', error.message);
      // トークン保存失敗は警告のみ（メールは既に送信済み）
    }

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
