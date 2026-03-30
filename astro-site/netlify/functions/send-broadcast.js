/**
 * 本番送信API（段階移行対応）
 *
 * 最重要：
 * - 有料会員のみを対象（plan_type=paid）
 * - 段階移行（50→100→300→500→1000→...）
 * - 配配メールとの併用（send_channel分離）
 * - 二重送信・誤送信を構造的に防止
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
  const fields = { status, ...additionalFields };

  // locked または sending に遷移する場合、locked_at を記録
  if (status === 'locked' || status === 'sending') {
    fields.locked_at = new Date().toISOString();
  }

  await broadcastsTable.update([{ id: recordId, fields }]);
  console.log('✅ Broadcast status updated:', status);
}

/**
 * 配信情報を更新（送信件数など）
 */
async function updateBroadcast(recordId, fields) {
  await broadcastsTable.update([{ id: recordId, fields }]);
}

/**
 * 配信対象を取得（有料会員のみ・厳格チェック）
 */
async function getTargetCustomers(stage) {
  console.log('📊 Getting target customers (stage:', stage, ')');

  // 4条件すべてを満たすレコードのみ取得
  const records = await customersTable
    .select({
      filterByFormula: `AND(
        {plan_type} = "paid",
        {Status} = "active",
        {unsubscribe} != TRUE(),
        {send_channel} = "sendgrid"
      )`,
      maxRecords: stage, // ステージ上限
      sort: [{ field: 'migrated_at', direction: 'asc' }], // 移行日時順（古い順）
    })
    .all();

  console.log('📊 Target customers found:', records.length);

  return records.map((record) => ({
    email: record.fields.Email,
    name: record.fields.Name,
    plan: record.fields.Plan,
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
  await recipientsTable.create([{ fields: data }]);
}

/**
 * SendGrid経由でメール送信
 */
async function sendEmail(email, subject, bodyHtml) {
  const msg = {
    to: email,
    from: process.env.SENDGRID_FROM_EMAIL || 'noreply@em8410.keiba-intelligence.jp',
    subject,
    html: bodyHtml,
  };

  const response = await sgMail.send(msg);

  // SendGridメッセージIDを取得
  const messageId = response[0].headers['x-message-id'] || null;

  return messageId;
}

/**
 * バッチ送信（レート制御）
 */
async function sendBatch(emails, broadcast, broadcastId) {
  const batchSize = 200; // 200件/バッチ
  const delay = 2000; // 2秒間隔

  let sentCount = 0;
  let failedCount = 0;
  const results = [];

  for (let i = 0; i < emails.length; i += batchSize) {
    const batch = emails.slice(i, i + batchSize);

    console.log(`📨 Sending batch ${Math.floor(i / batchSize) + 1} (${batch.length} emails)...`);

    for (const email of batch) {
      try {
        // 既送信チェック
        const alreadySent = await checkAlreadySent(broadcastId, email);
        if (alreadySent) {
          console.log('⏭️ Already sent to:', email);
          results.push({ email, status: 'skipped', reason: 'already sent' });
          continue;
        }

        // SendGrid送信
        const messageId = await sendEmail(email, broadcast.subject, broadcast.body_html);

        // ログ記録
        await createRecipient({
          broadcast_id: broadcastId,
          email,
          send_status: 'sent',
          provider_message_id: messageId,
          sent_at: new Date().toISOString(),
          is_test: false,
        });

        sentCount++;
        results.push({ email, status: 'sent', message_id: messageId });

        console.log(`✅ Sent (${sentCount}/${emails.length}):`, email);
      } catch (error) {
        console.error('❌ Send error:', email, error.message);

        // エラーログ記録
        await createRecipient({
          broadcast_id: broadcastId,
          email,
          send_status: 'failed',
          error_code: error.code || 'UNKNOWN',
          sent_at: new Date().toISOString(),
          is_test: false,
        });

        failedCount++;
        results.push({ email, status: 'failed', error: error.message });
      }
    }

    // バッチ間の待機
    if (i + batchSize < emails.length) {
      console.log(`⏳ Waiting ${delay}ms before next batch...`);
      await sleep(delay);
    }
  }

  return { sentCount, failedCount, results };
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
    const { broadcast_id, dry_run, confirm, stage, user_email } = JSON.parse(event.body);

    // 管理者権限チェック
    if (!ADMIN_EMAILS.includes(user_email)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Forbidden: Admin access required' }),
      };
    }

    // ステージ指定必須
    if (!stage) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'stage is required' }),
      };
    }

    // 配信情報を取得
    const broadcast = await getBroadcast(broadcast_id);

    console.log('📥 Send broadcast:', broadcast_id, 'status:', broadcast.status, 'stage:', stage, 'dry_run:', dry_run);

    // 【最重要】status チェック
    if (broadcast.status === 'sent' || broadcast.status === 'locked' || broadcast.status === 'sending') {
      console.error('❌ Broadcast already sent/locked/sending:', broadcast_id);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Broadcast already sent/locked/sending',
          message: 'この配信は既に送信済み、ロック済み、または送信中です。再送信できません。',
        }),
      };
    }

    // 送信対象を取得（有料会員のみ）
    const customers = await getTargetCustomers(stage);

    // メールアドレスを unique 化
    const uniqueEmails = [...new Set(customers.map((c) => c.email))];

    console.log('📊 Target customers:', customers.length);
    console.log('📊 Unique emails:', uniqueEmails.length);

    // Dry-Run モード
    if (dry_run) {
      await updateBroadcastStatus(broadcast.id, 'dry-run', {
        stage,
        recipient_count_planned: uniqueEmails.length,
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          dry_run: true,
          stage,
          recipient_count_planned: uniqueEmails.length,
          unique_emails: uniqueEmails.length,
          conditions: {
            plan_type: 'paid',
            status: 'active',
            unsubscribe: false,
            send_channel: 'sendgrid',
          },
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

    // 【最重要】先に status を locked に更新（ロック）
    console.log('🔒 Locking broadcast:', broadcast_id);
    await updateBroadcastStatus(broadcast.id, 'locked', {
      stage,
      recipient_count_planned: uniqueEmails.length,
    });

    // 送信中に更新
    await updateBroadcastStatus(broadcast.id, 'sending');

    // バッチ送信実行
    const { sentCount, failedCount, results } = await sendBatch(uniqueEmails, broadcast, broadcast_id);

    // 送信完了
    await updateBroadcast(broadcast.id, {
      status: 'sent',
      sent_at: new Date().toISOString(),
      recipient_count_sent: sentCount,
    });

    console.log('🎉 Broadcast sent:', broadcast_id, 'sent:', sentCount, 'failed:', failedCount);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        broadcast_id,
        stage,
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
