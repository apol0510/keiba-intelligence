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
