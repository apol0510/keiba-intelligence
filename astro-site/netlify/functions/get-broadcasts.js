/**
 * 配信一覧取得API
 *
 * 全配信を取得（降順）
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
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  try {
    // 全配信を取得（作成日時降順）
    const records = await broadcastsTable
      .select({
        sort: [{ field: 'created_at', direction: 'desc' }],
      })
      .all();

    const broadcasts = records.map((record) => ({
      id: record.id,
      broadcast_id: record.fields.broadcast_id,
      subject: record.fields.subject,
      status: record.fields.status,
      created_at: record.fields.created_at,
      sent_at: record.fields.sent_at || null,
      recipient_count: record.fields.recipient_count || 0,
      created_by: record.fields.created_by,
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        broadcasts,
      }),
    };
  } catch (error) {
    console.error('❌ Get broadcasts error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal Server Error', details: error.message }),
    };
  }
};
