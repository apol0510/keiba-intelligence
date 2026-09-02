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
    // `intent` は任意。購入導線から来たときだけ入る（従来の /login は送らない）
    const { email, intent } = JSON.parse(event.body);

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
    // 🔴 送信先は既定で本番（従来どおり）。`MAGIC_LINK_BASE_URL` が
    //    許可リストに載った origin のときだけ、そこへ向ける（Deploy Preview /
    //    ブランチデプロイで通常のログイン経路を通すため）。
    //    未設定・壊れた値・許可外ホストは **すべて本番へ倒す**（fail-closed）。
    //    認証の意味・有効期限・認可条件は変わらない。
    const { buildMagicLinkUrl } = await import('../../src/lib/auth/magicLinkBase.js');
    // 🔴 購入意図（プラン id）を持ち越す。URL は運ばない（open redirect を作らない）。
    //    受け付けるのは plans.js に定義のある id だけ。未知・空は意図なしとして無視する。
    const { intentQuery } = await import('../../src/lib/billing/purchaseIntent.js');
    const magicLink = buildMagicLinkUrl(token, process.env) + intentQuery(intent);

    const msg = {
      to: email,
      from: process.env.SENDGRID_FROM_EMAIL || 'noreply@em8410.keiba-intelligence.jp',
      subject: '【KEIBA Intelligence】ログインリンク',
      html: `
<div style="font-family: 'Noto Sans JP', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc;">
  <div style="background-color: #ffffff; border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <h2 style="color: #1e40af; margin-top: 0; font-size: 24px;">ログインリンク</h2>

    <p style="color: #334155; font-size: 16px; line-height: 1.6;">${customer.Name || 'お客様'} 様</p>

    <p style="color: #334155; font-size: 16px; line-height: 1.6;">以下のボタンをクリックしてログインしてください。</p>

    <div style="text-align: center; margin: 32px 0;">
      <a href="${magicLink}" style="display: inline-block; background-color: #3b82f6; color: #ffffff !important; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; border: 2px solid #3b82f6;">
        ログインする
      </a>
    </div>

    <div style="background-color: #f1f5f9; border-left: 4px solid #3b82f6; padding: 16px; margin: 24px 0; border-radius: 4px;">
      <p style="color: #475569; font-size: 14px; margin: 0; line-height: 1.6;">
        ボタンが動作しない場合は、以下のリンクをコピーしてブラウザに貼り付けてください。
      </p>
      <p style="margin: 8px 0 0 0;">
        <a href="${magicLink}" style="color: #3b82f6; word-break: break-all; font-size: 13px;">${magicLink}</a>
      </p>
    </div>

    <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 16px; margin: 24px 0; border-radius: 4px;">
      <p style="color: #991b1b; font-size: 14px; margin: 0; line-height: 1.6;">
        ⚠️ このリンクは15分間有効です。<br>
        心当たりがない場合は、このメールを無視してください。
      </p>
    </div>

    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">

    <p style="color: #64748b; font-size: 14px; margin: 0;">
      KEIBA Intelligence チーム
    </p>
  </div>
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
