/**
 * 配信作成API
 *
 * メルマガ配信を作成（status = draft）
 */

const crypto = require('crypto');
const Airtable = require('airtable');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

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
  /*
   * 🔴 管理者認証（registry e1f0c2ce）。body のメールアドレスでは判定しない。
   *    `X-KI-Admin-Key` ヘッダーと env `KI_ADMIN_API_KEY` の timing-safe 照合のみ。
   *    未設定なら常に 403（fail-closed）。CORS は KI 自身の origin だけ。
   */
  const { guardAdminRequest } = await import('../../src/lib/auth/adminAuth.js');
  const { headers, response: denied } = guardAdminRequest(event, { method: 'POST', env: process.env });
  if (denied) return denied;

  try {
    const { subject, body_html, stage, created_by } = JSON.parse(event.body);

    // バリデーション
    if (!subject || !body_html || !stage) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'subject, body_html, and stage are required' }),
      };
    }

    // broadcast_id生成（UUID v4）
    const broadcastId = crypto.randomUUID();

    // ハッシュ生成
    const hash = generateHash(subject, body_html);

    // Airtable に挿入
    const record = await broadcastsTable.create([
      {
        fields: {
          broadcast_id: broadcastId,
          subject,
          body_html,
          stage: parseInt(stage, 10),
          status: 'draft',
          created_at: new Date().toISOString(),
          hash,
          // 🔴 表示用のラベル。認証には使わない（認証はヘッダーの鍵のみ）
          created_by: typeof created_by === 'string' && created_by.trim() ? created_by.trim() : 'admin',
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
