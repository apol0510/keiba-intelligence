/**
 * マジックリンク送信API
 *
 * SendGrid経由でマジックリンクを送信
 */

const { v4: uuidv4 } = require('uuid');
const Airtable = require('airtable');
const sgMail = require('@sendgrid/mail');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;

// SendGrid初期化
sgMail.setApiKey(SENDGRID_API_KEY);

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);
const customersTable = base('Customers');
const authTokensTable = base('AuthTokens');

/**
 * メインハンドラー
 */
exports.handler = async (event) => {
  // CORS設定（セキュリティ強化：特定ドメインのみ許可）
  const allowedOrigins = [
    'https://keiba-intelligence.netlify.app',
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
    const { email } = JSON.parse(event.body);

    if (!email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email is required' }),
      };
    }

    console.log('📧 Sending magic link to:', email);

    // 1. Customersテーブル確認
    const customers = await customersTable
      .select({
        filterByFormula: `{Email} = "${email}"`,
        maxRecords: 1,
      })
      .firstPage();

    if (customers.length === 0) {
      console.error('❌ Customer not found:', email);
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Customer not found' }),
      };
    }

    const customer = customers[0].fields;

    // ステータス確認
    if (customer.Status !== 'active') {
      console.error('❌ Account is not active:', email);
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Account is not active' }),
      };
    }

    // 2. トークン生成
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15分後

    // 3. AuthTokensテーブルに挿入
    await authTokensTable.create([
      {
        fields: {
          Token: token,
          Email: email,
          CreatedAt: new Date().toISOString(),
          ExpiresAt: expiresAt.toISOString(),
          Used: false,
          Ip_Address: event.headers['x-forwarded-for'] || 'unknown',
          User_Agent: event.headers['user-agent'] || 'unknown',
        },
      },
    ]);

    console.log('✅ Token created:', token);

    // 4. SendGrid経由でマジックリンク送信
    const magicLink = `https://keiba-intelligence.netlify.app/auth/verify?token=${token}`;

    const msg = {
      to: email,
      from: process.env.SENDGRID_FROM_EMAIL || 'noreply@keiba-intelligence.netlify.app',
      subject: '【KEIBA Intelligence】ログインリンク',
      html: `
<div style="font-family: 'Noto Sans JP', sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #3b82f6;">ログインリンク</h2>

  <p>${customer.Name || 'お客様'} 様</p>

  <p>以下のボタンをクリックしてログインしてください。</p>

  <a href="${magicLink}" style="display: inline-block; background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 24px 0;">
    ログインする
  </a>

  <p style="color: #64748b; font-size: 14px;">
    ボタンが動作しない場合は、以下のリンクをコピーしてブラウザに貼り付けてください。<br>
    <a href="${magicLink}">${magicLink}</a>
  </p>

  <p style="color: #ef4444; font-size: 14px;">
    ⚠️ このリンクは15分間有効です。<br>
    心当たりがない場合は、このメールを無視してください。
  </p>

  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">

  <p style="color: #64748b; font-size: 14px;">
    KEIBA Intelligence チーム
  </p>
</div>
      `,
    };

    await sgMail.send(msg);

    console.log('✅ Magic link sent to:', email);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'ログインリンクを送信しました。メールをご確認ください。',
      }),
    };
  } catch (error) {
    console.error('❌ Send magic link error:', error);
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
