/**
 * 配信作成API
 *
 * メルマガ配信を作成（status = draft）
 */

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const Airtable = require('airtable');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',');

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);
const broadcastsTable = base('Broadcasts');

/**
 * ハッシュ生成（SHA256）
 */
function generateHash(subject, bodyHtml) {
  return crypto
    .createHash('sha256')
    .update(subject + bodyHtml)
    .digest('hex');
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
    const { subject, body_html, created_by } = JSON.parse(event.body);

    // 管理者権限チェック
    if (!ADMIN_EMAILS.includes(created_by)) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Forbidden: Admin access required' }),
      };
    }

    // バリデーション
    if (!subject || !body_html) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'subject and body_html are required' }),
      };
    }

    // broadcast_id生成（UUID v4）
    const broadcastId = uuidv4();

    // ハッシュ生成
    const hash = generateHash(subject, body_html);

    // Airtable に挿入
    const record = await broadcastsTable.create([
      {
        fields: {
          broadcast_id: broadcastId,
          subject,
          body_html,
          status: 'draft',
          created_at: new Date().toISOString(),
          hash,
          created_by,
        },
      },
    ]);

    console.log('✅ Broadcast created:', broadcastId);

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        success: true,
        broadcast_id: broadcastId,
        status: 'draft',
        created_at: record[0].fields.created_at,
      }),
    };
  } catch (error) {
    console.error('❌ Create broadcast error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal Server Error', details: error.message }),
    };
  }
};
