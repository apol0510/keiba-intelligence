/**
 * 本番送信API（二重送信防止）
 *
 * 最重要：同一メールアドレスへの二重送信が構造的に不可能
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
const customersTable = base('Customers');

sgMail.setApiKey(SENDGRID_API_KEY);

/**
 * sleep関数（レート制限対策）
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 配信情報を取得
 */
async function getBroadcast(broadcastId) {
  const records = await broadcastsTable
    .select({
      filterByFormula: `{broadcast_id} = "${broadcastId}"`,
      maxRecords: 1,
    })
    .firstPage();

  if (records.length === 0) {
    throw new Error('Broadcast not found');
  }

  return {
    id: records[0].id,
    ...records[0].fields,
  };
}

/**
 * 配信ステータスを更新
 */
async function updateBroadcastStatus(recordId, status, additionalFields = {}) {
  await broadcastsTable.update([
    {
      id: recordId,
      fields: {
        status,
        ...additionalFields,
      },
    },
  ]);
}

/**
 * 配信情報を更新（送信件数など）
 */
async function updateBroadcast(recordId, fields) {
  await broadcastsTable.update([
    {
      id: recordId,
      fields,
    },
  ]);
}

/**
 * アクティブ顧客を取得
 */
async function getActiveCustomers() {
  const records = await customersTable
    .select({
      filterByFormula: `{Status} = "active"`,
    })
    .all();

  return records.map((record) => ({
    email: record.fields.Email,
    name: record.fields.Name,
  }));
}

/**
 * 既に送信済みかチェック
 */
async function checkAlreadySent(broadcastId, email) {
  const records = await recipientsTable
    .select({
      filterByFormula: `AND({broadcast_id} = "${broadcastId}", {email} = "${email}")`,
      maxRecords: 1,
    })
    .firstPage();

  return records.length > 0;
}

/**
 * 受信者レコードを作成
 */
async function createRecipient(data) {
  await recipientsTable.create([
    {
      fields: data,
    },
  ]);
}

/**
 * SendGrid経由でメール送信
 */
async function sendEmail(email, subject, bodyHtml) {
  const msg = {
    to: email,
    from: 'noreply@keiba-intelligence.keiba.link',
    subject,
    html: bodyHtml,
  };

  await sgMail.send(msg);
}

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
    const { broadcast_id, dry_run, confirm, user_email } = JSON.parse(event.body);

    // 管理者権限チェック
    if (!ADMIN_EMAILS.includes(user_email)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Forbidden: Admin access required' }),
      };
    }

    // 配信情報を取得
    const broadcast = await getBroadcast(broadcast_id);

    console.log('📥 Send broadcast:', broadcast_id, 'status:', broadcast.status, 'dry_run:', dry_run);

    // 【最重要】status が sent ならエラー
    if (broadcast.status === 'sent') {
      console.error('❌ Broadcast already sent:', broadcast_id);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Broadcast already sent',
          message: 'この配信は既に送信済みです。再送信できません。',
        }),
      };
    }

    // 送信対象を取得（Status = active）
    const customers = await getActiveCustomers();

    // メールアドレスを unique 化
    const uniqueEmails = [...new Set(customers.map((c) => c.email))];

    console.log('📊 Unique emails:', uniqueEmails.length);

    // Dry-Run モード
    if (dry_run) {
      await updateBroadcastStatus(broadcast.id, 'dry-run');

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          dry_run: true,
          recipient_count: uniqueEmails.length,
          unique_emails: uniqueEmails.length,
        }),
      };
    }

    // 本番送信の最終確認
    if (!confirm) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Confirmation required',
          message: '送信確認が必要です',
        }),
      };
    }

    // 【最重要】先に status を sent に更新（ロック）
    console.log('🔒 Locking broadcast:', broadcast_id);
    await updateBroadcastStatus(broadcast.id, 'sent', {
      sent_at: new Date().toISOString(),
    });

    // 送信処理（順次送信）
    const results = [];
    let sentCount = 0;
    let failedCount = 0;

    for (let i = 0; i < uniqueEmails.length; i++) {
      const email = uniqueEmails[i];

      try {
        // 既に送信済みかチェック
        const alreadySent = await checkAlreadySent(broadcast_id, email);
        if (alreadySent) {
          console.log('⏭️ Already sent to:', email);
          results.push({ email, status: 'skipped', reason: 'already sent' });
          continue;
        }

        // SendGrid送信
        await sendEmail(email, broadcast.subject, broadcast.body_html);

        // BroadcastRecipients に記録
        await createRecipient({
          broadcast_id,
          email,
          send_status: 'sent',
          sent_at: new Date().toISOString(),
          is_test: false,
        });

        sentCount++;
        results.push({ email, status: 'sent' });

        console.log(`✅ Sent (${sentCount}/${uniqueEmails.length}):`, email);

        // レート制限対策（10件ごとに1秒待機）
        if ((i + 1) % 10 === 0) {
          await sleep(1000);
        }
      } catch (error) {
        console.error('❌ Send error:', email, error.message);

        // エラーログ記録
        await createRecipient({
          broadcast_id,
          email,
          send_status: 'failed',
          error_message: error.message,
          is_test: false,
        });

        failedCount++;
        results.push({ email, status: 'failed', error: error.message });
      }
    }

    // 送信件数を更新
    await updateBroadcast(broadcast.id, {
      recipient_count: sentCount,
    });

    console.log('🎉 Broadcast sent:', broadcast_id, 'sent:', sentCount, 'failed:', failedCount);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        broadcast_id,
        sent_count: sentCount,
        failed_count: failedCount,
        total: uniqueEmails.length,
        results,
      }),
    };
  } catch (error) {
    console.error('❌ Send broadcast error:', error);
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
