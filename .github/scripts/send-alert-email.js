#!/usr/bin/env node

/**
 * SendGrid Web API v3を使用してアラートメールを送信
 *
 * 環境変数:
 * - SENDGRID_API_KEY: SendGrid APIキー
 * - SENDGRID_FROM_EMAIL: 送信元メールアドレス
 * - ALERT_EMAIL: 送信先メールアドレス
 * - EMAIL_SUBJECT: メール件名
 * - EMAIL_BODY: メール本文
 */

const https = require('https');

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL;
const TO_EMAIL = process.env.ALERT_EMAIL;
const SUBJECT = process.env.EMAIL_SUBJECT;
const BODY = process.env.EMAIL_BODY;

if (!SENDGRID_API_KEY || !FROM_EMAIL || !TO_EMAIL || !SUBJECT || !BODY) {
  console.error('❌ 必須環境変数が設定されていません');
  console.error(`SENDGRID_API_KEY: ${SENDGRID_API_KEY ? '✓' : '✗'}`);
  console.error(`SENDGRID_FROM_EMAIL: ${FROM_EMAIL ? '✓' : '✗'}`);
  console.error(`ALERT_EMAIL: ${TO_EMAIL ? '✓' : '✗'}`);
  console.error(`EMAIL_SUBJECT: ${SUBJECT ? '✓' : '✗'}`);
  console.error(`EMAIL_BODY: ${BODY ? '✓' : '✗'}`);
  process.exit(1);
}

const data = JSON.stringify({
  personalizations: [
    {
      to: [{ email: TO_EMAIL }],
      subject: SUBJECT
    }
  ],
  from: { email: FROM_EMAIL },
  content: [
    {
      type: 'text/plain',
      value: BODY
    }
  ]
});

const options = {
  hostname: 'api.sendgrid.com',
  port: 443,
  path: '/v3/mail/send',
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${SENDGRID_API_KEY}`,
    'Content-Type': 'application/json; charset=utf-8',
    // 日本語・絵文字を含むとバイト長 > 文字数になるため、必ずUTF-8バイト長を渡す
    // （data.length=文字数だとボディがマルチバイト境界で切れて 415 Invalid UTF8 になる）
    'Content-Length': Buffer.byteLength(data, 'utf8')
  }
};

console.log(`📧 Sending alert email...`);
console.log(`   From: ${FROM_EMAIL}`);
console.log(`   To: ${TO_EMAIL}`);
console.log(`   Subject: ${SUBJECT}`);

const req = https.request(options, (res) => {
  console.log(`   Status: ${res.statusCode}`);

  let responseBody = '';
  res.on('data', (chunk) => {
    responseBody += chunk;
  });

  res.on('end', () => {
    if (res.statusCode === 202) {
      console.log('✅ Alert email sent successfully');
      process.exit(0);
    } else {
      console.error(`❌ Failed to send alert email: ${res.statusCode}`);
      console.error(`Response: ${responseBody}`);
      process.exit(1);
    }
  });
});

req.on('error', (error) => {
  console.error(`❌ Request error: ${error.message}`);
  process.exit(1);
});

req.write(data, 'utf8');
req.end();
