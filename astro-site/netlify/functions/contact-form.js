/**
 * お問い合わせフォーム処理
 * SendGrid経由で管理者にメール通知
 */

exports.handler = async (event, context) => {
  const allowedOrigins = [
    'https://keiba-intelligence.netlify.app',
    'https://keiba-intelligence.jp',
    'http://localhost:4321',
    'http://localhost:3000'
  ];

  const origin = event.headers.origin || '';
  const allowOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

  const headers = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { name, email, category, message } = JSON.parse(event.body);

    if (!name || !email || !category || !message) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: '必須項目が入力されていません' })
      };
    }

    const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
    const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'noreply@keiba-intelligence.netlify.app';
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL || process.env.ALERT_EMAIL;

    if (!SENDGRID_API_KEY) {
      throw new Error('SendGrid API key not configured');
    }

    const japanTime = new Date().toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    // 管理者向けメール
    const adminEmailData = {
      personalizations: [{
        to: [{ email: ADMIN_EMAIL }],
        subject: `【お問い合わせ】${category} - ${name}`
      }],
      from: { email: FROM_EMAIL, name: 'KEIBA Intelligence' },
      reply_to: { email: email, name: name },
      content: [{
        type: 'text/html',
        value: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: 'Hiragino Sans', sans-serif; line-height: 1.8; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
      <h2 style="margin: 0;">📩 お問い合わせ通知</h2>
    </div>
    <div style="background: #f8fafc; padding: 20px; border-radius: 8px; border-left: 4px solid #3b82f6;">
      <div style="padding: 10px 0; border-bottom: 1px solid #e2e8f0;">
        <strong>受信日時:</strong> ${japanTime}
      </div>
      <div style="padding: 10px 0; border-bottom: 1px solid #e2e8f0;">
        <strong>お名前:</strong> ${name}
      </div>
      <div style="padding: 10px 0; border-bottom: 1px solid #e2e8f0;">
        <strong>メールアドレス:</strong> <a href="mailto:${email}">${email}</a>
      </div>
      <div style="padding: 10px 0; border-bottom: 1px solid #e2e8f0;">
        <strong>種別:</strong> ${category}
      </div>
      <div style="padding: 10px 0;">
        <strong>お問い合わせ内容:</strong>
        <div style="margin-top: 10px; white-space: pre-wrap; background: white; padding: 15px; border-radius: 6px; border: 1px solid #e2e8f0;">${message}</div>
      </div>
    </div>
    <p style="color: #64748b; font-size: 0.9rem; text-align: center; margin-top: 20px;">このメールに返信すると ${email} に送信されます</p>
  </div>
</body>
</html>`
      }],
      tracking_settings: { click_tracking: { enable: false }, open_tracking: { enable: false } }
    };

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(adminEmailData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('SendGrid admin email error:', errorText);
      throw new Error(`SendGrid error: ${response.status}`);
    }

    // ユーザー向け控えメール
    const userEmailData = {
      personalizations: [{
        to: [{ email: email }],
        subject: `【お問い合わせ受付】KEIBA Intelligence`
      }],
      from: { email: FROM_EMAIL, name: 'KEIBA Intelligence' },
      content: [{
        type: 'text/html',
        value: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: 'Hiragino Sans', sans-serif; line-height: 1.8; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; text-align: center;">
      <h2 style="margin: 0;">お問い合わせを受け付けました</h2>
    </div>
    <p>${name} 様</p>
    <p>この度はお問い合わせいただき、ありがとうございます。<br>以下の内容で受け付けいたしました。内容を確認のうえ、折り返しご連絡いたします。</p>
    <div style="background: #f8fafc; padding: 20px; border-radius: 8px; border-left: 4px solid #10b981; margin: 20px 0;">
      <div style="padding: 10px 0; border-bottom: 1px solid #e2e8f0;">
        <strong>受付日時:</strong> ${japanTime}
      </div>
      <div style="padding: 10px 0; border-bottom: 1px solid #e2e8f0;">
        <strong>お問い合わせ種別:</strong> ${category}
      </div>
      <div style="padding: 10px 0;">
        <strong>お問い合わせ内容:</strong>
        <div style="margin-top: 10px; white-space: pre-wrap; background: white; padding: 15px; border-radius: 6px; border: 1px solid #e2e8f0;">${message}</div>
      </div>
    </div>
    <p style="color: #64748b; font-size: 0.9rem;">※このメールは自動送信です。本メールに返信いただいてもお応えできない場合がございます。</p>
    <div style="text-align: center; color: #64748b; font-size: 0.9rem; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
      <p><strong>KEIBA Intelligence</strong></p>
      <p><a href="https://keiba-intelligence.jp" style="color: #3b82f6; text-decoration: none;">https://keiba-intelligence.jp</a></p>
    </div>
  </div>
</body>
</html>`
      }],
      tracking_settings: { click_tracking: { enable: false }, open_tracking: { enable: false } }
    };

    const userResponse = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(userEmailData)
    });

    if (!userResponse.ok) {
      console.error('SendGrid user email error:', await userResponse.text());
      // ユーザー控えメール失敗は致命的ではないので続行
    }

    console.log('✅ Contact form submitted:', { name, email, category });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'お問い合わせを受け付けました。' })
    };

  } catch (error) {
    console.error('Contact form error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'サーバーエラーが発生しました。時間をおいて再度お試しください。' })
    };
  }
};
