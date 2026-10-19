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

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);
const broadcastsTable = base('Broadcasts');
const recipientsTable = base('BroadcastRecipients');

sgMail.setApiKey(SENDGRID_API_KEY);

/**
 * メインハンドラー
 */
exports.handler = async (event) => {
  /*
   * 🔴 管理者認証（registry e1f0c2ce）。body のメールアドレスでは判定しない。
   *    `X-KI-Admin-Key` ヘッダーと env `KI_ADMIN_API_KEY` の timing-safe 照合のみ。
   *    未設定なら常に 403（fail-closed）。CORS は KI 自身の origin だけ。
   *    🔴 送信・Airtable への書き込みより前で止める。
   */
  const { guardAdminRequest } = await import('../../src/lib/auth/adminAuth.js');
  const { headers, response: denied } = guardAdminRequest(event, { method: 'POST', env: process.env });
  if (denied) return denied;

  /*
   * 🔴 **本番以外のホストからはメールを送らない**（`docs/decisions.md` 2026-09-11）。
   *
   *    `SENDGRID_API_KEY` は `all` スコープで、Deploy Preview / ブランチデプロイにも
   *    **production の値**が入る。QA からの送信は本番アカウントの実送信になり、
   *    受信できないアドレス宛のバウンスが**本番の送信者評価に付く**。
   *
   * 🔴 送信だけでなく、**送信に付随する書き込みより前**で止める。
   */
  {
    const { isMailSendBlocked, PREVIEW_MAIL_BLOCKED, PREVIEW_MAIL_BLOCKED_STATUS } =
      await import('../../src/lib/mail/previewMailGuard.js');
    if (isMailSendBlocked(event.headers)) {
      console.warn('⚠️ mail blocked on preview host');
      return {
        statusCode: PREVIEW_MAIL_BLOCKED_STATUS,
        headers,
        body: JSON.stringify(PREVIEW_MAIL_BLOCKED),
      };
    }
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

    // 🔴 宛先の制限（認証ではない）。ADMIN_EMAILS / ADMIN_EMAIL のアドレスにだけ送る
    const { isAllowedTestRecipient } = await import('../../src/lib/auth/adminAuth.js');
    if (!isAllowedTestRecipient(test_email, process.env)) {
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
      from: process.env.SENDGRID_FROM_EMAIL || 'noreply@em8410.keiba-intelligence.jp',
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
