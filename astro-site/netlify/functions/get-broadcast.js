/**
 * 配信詳細取得API
 *
 * 指定した broadcast_id の配信を取得
 */

const Airtable = require('airtable');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);
const broadcastsTable = base('Broadcasts');

/**
 * メインハンドラー
 */
exports.handler = async (event) => {
  /*
   * 🔴 管理者認証（registry e1f0c2ce）。body のメールアドレスでは判定しない。
   *    `X-KI-Admin-Key` ヘッダーと env `KI_ADMIN_API_KEY` の timing-safe 照合のみ。
   *    未設定なら常に 403（fail-closed）。CORS は KI 自身の origin だけ。
   *    🔴 Airtable を読む前に止める（配信本文・作成者アドレスを漏らさない）。
   */
  const { guardAdminRequest } = await import('../../src/lib/auth/adminAuth.js');
  const { headers, response: denied } = guardAdminRequest(event, { method: 'GET', env: process.env });
  if (denied) return denied;

  try {
    // クエリパラメータから broadcast_id を取得
    const broadcastId = event.queryStringParameters?.broadcast_id;

    if (!broadcastId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'broadcast_id is required' }),
      };
    }

    // Airtable から検索
    const records = await broadcastsTable
      .select({
        filterByFormula: `{broadcast_id} = "${broadcastId}"`,
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

    const record = records[0];

    const broadcast = {
      id: record.id,
      broadcast_id: record.fields.broadcast_id,
      subject: record.fields.subject,
      body_html: record.fields.body_html,
      status: record.fields.status,
      created_at: record.fields.created_at,
      sent_at: record.fields.sent_at || null,
      recipient_count: record.fields.recipient_count || 0,
      hash: record.fields.hash,
      created_by: record.fields.created_by,
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        broadcast,
      }),
    };
  } catch (error) {
    console.error('❌ Get broadcast error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal Server Error', details: error.message }),
    };
  }
};
