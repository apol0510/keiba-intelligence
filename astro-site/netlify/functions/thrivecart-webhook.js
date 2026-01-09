/**
 * ThriveCart Webhook Handler
 *
 * ThriveCartからのWebhook（購入・解約）を受信し、
 * Airtableに顧客情報を登録・更新し、SendGridでメール送信
 */

const crypto = require('crypto');
const Airtable = require('airtable');
const sgMail = require('@sendgrid/mail');

// 環境変数から設定を読み込み
const THRIVECART_WEBHOOK_SECRET = process.env.THRIVECART_WEBHOOK_SECRET;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;

// Airtable設定
const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);
const customersTable = base('Customers');

// SendGrid設定
sgMail.setApiKey(SENDGRID_API_KEY);

/**
 * Webhook署名検証
 */
function verifySignature(body, signature) {
  if (!THRIVECART_WEBHOOK_SECRET) {
    console.warn('⚠️ THRIVECART_WEBHOOK_SECRET not set. Skipping signature verification.');
    return true; // 開発環境では検証スキップ
  }

  const hash = crypto
    .createHmac('sha256', THRIVECART_WEBHOOK_SECRET)
    .update(body)
    .digest('hex');

  return signature === hash;
}

/**
 * プランIDからプラン名を取得
 */
function getPlanName(productId) {
  const planMap = {
    'keiba-intelligence-light': 'ライト',
    'keiba-intelligence-standard': 'スタンダード',
    'keiba-intelligence-premium': 'プレミアム',
    'keiba-intelligence-ultimate': 'アルティメット',
    'keiba-intelligence-ai-plus': 'AI Plus',
  };
  return planMap[productId] || productId;
}

/**
 * 顧客をAirtableに登録
 */
async function createCustomer(data) {
  const { customer, product, subscription } = data;

  try {
    const record = await customersTable.create([
      {
        fields: {
          Email: customer.email,
          Name: customer.name,
          Plan: getPlanName(product.id),
          Status: 'active',
          'Subscription ID': subscription.id,
          'Next Payment Date': subscription.next_payment_date,
          'Created At': new Date().toISOString(),
        },
      },
    ]);

    console.log('✅ Customer created:', record[0].id);
    return record[0];
  } catch (error) {
    console.error('❌ Airtable create error:', error);
    throw error;
  }
}

/**
 * 顧客をAirtableで検索
 */
async function findCustomer(email) {
  try {
    const records = await customersTable
      .select({
        filterByFormula: `{Email} = "${email}"`,
        maxRecords: 1,
      })
      .firstPage();

    return records.length > 0 ? records[0] : null;
  } catch (error) {
    console.error('❌ Airtable find error:', error);
    throw error;
  }
}

/**
 * 顧客ステータスを更新（解約時）
 */
async function updateCustomerStatus(recordId, status, cancelledAt) {
  try {
    const record = await customersTable.update([
      {
        id: recordId,
        fields: {
          Status: status,
          'Cancelled At': cancelledAt,
        },
      },
    ]);

    console.log('✅ Customer updated:', record[0].id);
    return record[0];
  } catch (error) {
    console.error('❌ Airtable update error:', error);
    throw error;
  }
}

/**
 * ウェルカムメール送信
 */
async function sendWelcomeEmail(customer, product) {
  const msg = {
    to: customer.email,
    from: 'noreply@keiba-intelligence.keiba.link',
    subject: 'KEIBA Intelligenceへようこそ！',
    text: `
${customer.name} 様

KEIBA Intelligenceにご登録いただきありがとうございます。

■ ご登録プラン
${product.name}

■ ログイン方法
以下のリンクからログインしてください。
https://keiba-intelligence.keiba.link/login

■ 無料予想
本日の無料予想はこちらからご覧いただけます。
https://keiba-intelligence.keiba.link/free-prediction

■ サポート
ご不明点は以下までお問い合わせください。
support@keiba-intelligence.keiba.link

今後ともよろしくお願いいたします。

KEIBA Intelligence チーム
    `,
    html: `
<div style="font-family: 'Noto Sans JP', sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #3b82f6;">KEIBA Intelligenceへようこそ！</h2>

  <p>${customer.name} 様</p>

  <p>KEIBA Intelligenceにご登録いただきありがとうございます。</p>

  <h3 style="color: #1e40af;">■ ご登録プラン</h3>
  <p><strong>${product.name}</strong></p>

  <h3 style="color: #1e40af;">■ ログイン方法</h3>
  <p>以下のボタンからログインしてください。</p>
  <a href="https://keiba-intelligence.keiba.link/login" style="display: inline-block; background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600;">ログインする</a>

  <h3 style="color: #1e40af;">■ 無料予想</h3>
  <p>本日の無料予想はこちらからご覧いただけます。</p>
  <a href="https://keiba-intelligence.keiba.link/free-prediction" style="color: #3b82f6;">無料予想を見る</a>

  <h3 style="color: #1e40af;">■ サポート</h3>
  <p>ご不明点は以下までお問い合わせください。<br>
  <a href="mailto:support@keiba-intelligence.keiba.link" style="color: #3b82f6;">support@keiba-intelligence.keiba.link</a></p>

  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">

  <p style="color: #64748b; font-size: 14px;">今後ともよろしくお願いいたします。<br>
  KEIBA Intelligence チーム</p>
</div>
    `,
  };

  try {
    await sgMail.send(msg);
    console.log('✅ Welcome email sent to:', customer.email);
  } catch (error) {
    console.error('❌ SendGrid error:', error);
    throw error;
  }
}

/**
 * 解約通知メール送信
 */
async function sendCancellationEmail(customer) {
  const msg = {
    to: customer.email,
    from: 'noreply@keiba-intelligence.keiba.link',
    subject: 'KEIBA Intelligence 解約完了のお知らせ',
    text: `
${customer.name} 様

KEIBA Intelligenceの解約手続きが完了しました。

ご契約期間満了まではサービスをご利用いただけます。

今後、再度ご利用をご希望の場合は、いつでも再登録いただけます。

またのご利用を心よりお待ちしております。

KEIBA Intelligence チーム
    `,
    html: `
<div style="font-family: 'Noto Sans JP', sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #ef4444;">解約完了のお知らせ</h2>

  <p>${customer.name} 様</p>

  <p>KEIBA Intelligenceの解約手続きが完了しました。</p>

  <p>ご契約期間満了まではサービスをご利用いただけます。</p>

  <p>今後、再度ご利用をご希望の場合は、いつでも再登録いただけます。</p>

  <a href="https://keiba-intelligence.keiba.link/pricing" style="display: inline-block; background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600;">料金プランを見る</a>

  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">

  <p style="color: #64748b; font-size: 14px;">またのご利用を心よりお待ちしております。<br>
  KEIBA Intelligence チーム</p>
</div>
    `,
  };

  try {
    await sgMail.send(msg);
    console.log('✅ Cancellation email sent to:', customer.email);
  } catch (error) {
    console.error('❌ SendGrid error:', error);
    throw error;
  }
}

/**
 * メインハンドラー
 */
exports.handler = async (event) => {
  // CORSヘッダー
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  // OPTIONSリクエスト（プリフライト）
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  // POSTリクエストのみ受け付け
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  try {
    // Webhook署名検証
    const signature = event.headers['x-thrivecart-signature'];
    if (!verifySignature(event.body, signature)) {
      console.error('❌ Invalid signature');
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid signature' }),
      };
    }

    // リクエストボディをパース
    const data = JSON.parse(event.body);
    const eventType = data.event;

    console.log('📥 Webhook received:', eventType);

    // イベントタイプによって処理を分岐
    if (eventType === 'purchase.success' || eventType === 'subscription.created') {
      // 購入完了・サブスク作成時
      const existingCustomer = await findCustomer(data.customer.email);

      if (existingCustomer) {
        console.log('⚠️ Customer already exists:', data.customer.email);
        // 既存顧客の場合はステータス更新のみ
        await updateCustomerStatus(existingCustomer.id, 'active', null);
      } else {
        // 新規顧客登録
        await createCustomer(data);
        await sendWelcomeEmail(data.customer, data.product);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: 'Customer created successfully' }),
      };
    } else if (eventType === 'subscription.cancelled' || eventType === 'refund.created') {
      // サブスク解約・返金時
      const customer = await findCustomer(data.customer.email);

      if (customer) {
        await updateCustomerStatus(
          customer.id,
          'cancelled',
          data.subscription?.cancelled_at || new Date().toISOString()
        );
        await sendCancellationEmail(data.customer);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ message: 'Customer status updated successfully' }),
        };
      } else {
        console.warn('⚠️ Customer not found:', data.customer.email);
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Customer not found' }),
        };
      }
    } else {
      // 未対応のイベントタイプ
      console.warn('⚠️ Unsupported event type:', eventType);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: 'Event type not supported' }),
      };
    }
  } catch (error) {
    console.error('❌ Handler error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal Server Error', details: error.message }),
    };
  }
};
