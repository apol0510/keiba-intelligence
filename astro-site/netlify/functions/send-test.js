/**
 * テスト送信API
 *
 * 管理者アドレスのみに送信（本番配信と完全分離）
 */

const Airtable = require('airtable');
const sgMail = require('@sendgrid/mail');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',');

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);
const broadcastsTable = base('Broadcasts');
const recipientsTable = base('BroadcastRecipients');

sgMail.setApiKey(SENDGRID_API_KEY);

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
    const { broadcast_id, test_email } = JSON.parse(event.body);

    // バリデーション
    if (!broadcast_id || !test_email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'broadcast_id and test_email are required' }),
      };
    }

    // 管理者権限チェック
    if (!ADMIN_EMAILS.includes(test_email)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Forbidden: Admin access required' }),
      };
    }

    // 配信情報を取得
    const records = await broadcastsTable
      .select({
        filterByFormula: `{broadcast_id} = "${broadcast_id}"`,
        maxRecords: 1,
      })
      .firstPage();

    if (records.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Broadcast not found' }),
      };
    }

    const broadcast = records[0].fields;

    // SendGrid送信
    const msg = {
      to: test_email,
      from: 'noreply@keiba-intelligence.keiba.link',
      subject: `【テスト】${broadcast.subject}`,
      html: `
<div style="background: #fff3cd; border: 1px solid #ffc107; padding: 16px; margin-bottom: 24px; border-radius: 8px;">
  <strong>⚠️ これはテストメールです</strong><br>
  配信ID: ${broadcast_id}
</div>

${broadcast.body_html}
      `,
    };

    await sgMail.send(msg);

    // BroadcastRecipients に記録（is_test = true）
    await recipientsTable.create([
      {
        fields: {
          broadcast_id,
          email: test_email,
          send_status: 'sent',
          sent_at: new Date().toISOString(),
          is_test: true,
        },
      },
    ]);

    console.log('✅ Test email sent to:', test_email);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Test email sent successfully',
        test_email,
      }),
    };
  } catch (error) {
    console.error('❌ Send test error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal Server Error', details: error.message }),
    };
  }
};
