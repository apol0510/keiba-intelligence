/**
 * アラートメール送信Function
 *
 * 用途：
 * - GitHub Actions失敗通知
 * - 異常値検知通知（的中率0%等）
 * - 予想データ欠損通知
 *
 * トリガー：
 * - GitHub Actionsから直接呼び出し
 * - importResults.jsから異常検知時に呼び出し
 */

import sgMail from '@sendgrid/mail';

export async function handler(event, context) {
  // CORS設定
  const headers = {
    'Access-Control-Allow-Origin': 'https://keiba-intelligence.netlify.app',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // OPTIONSリクエスト対応
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // POSTメソッドのみ許可
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    // リクエストボディ解析
    const { type, date, details, metadata } = JSON.parse(event.body);

    // 必須パラメータチェック
    if (!type) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'type is required' })
      };
    }

    // SendGrid API Key確認
    const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
    if (!SENDGRID_API_KEY) {
      console.error('❌ SENDGRID_API_KEY が設定されていません');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'SendGrid API Key not configured' })
      };
    }

    sgMail.setApiKey(SENDGRID_API_KEY);

    // アラートタイプ別のメール内容生成
    const { subject, html } = generateAlertEmail(type, date, details, metadata);

    // メール送信
    const msg = {
      to: process.env.ALERT_EMAIL || 'your-email@example.com', // TODO: マコさんのメールアドレスに変更
      from: process.env.SENDGRID_FROM_EMAIL || 'noreply@keiba-intelligence.keiba.link',
      subject,
      html
    };

    await sgMail.send(msg);

    console.log(`✅ アラートメール送信成功: ${type} (${date || 'N/A'})`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Alert email sent successfully',
        type,
        date
      })
    };

  } catch (error) {
    console.error('❌ アラートメール送信エラー:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to send alert email',
        message: error.message
      })
    };
  }
}

/**
 * アラートタイプ別のメール内容生成
 */
function generateAlertEmail(type, date, details, metadata) {
  const timestamp = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

  switch (type) {
    case 'github-actions-failure':
      return {
        subject: `🚨 [keiba-intelligence] GitHub Actions失敗通知 (${date || 'N/A'})`,
        html: `
          <h2 style="color: #d32f2f;">🚨 GitHub Actions失敗</h2>
          <p><strong>日時:</strong> ${timestamp}</p>
          <p><strong>対象日付:</strong> ${date || '不明'}</p>
          <p><strong>ワークフロー:</strong> ${details?.workflow || '不明'}</p>
          <p><strong>ステップ:</strong> ${details?.step || '不明'}</p>
          <p><strong>エラー内容:</strong></p>
          <pre style="background: #f5f5f5; padding: 10px; border-radius: 4px;">${details?.error || 'エラー内容不明'}</pre>
          <hr>
          <p><strong>対応が必要です：</strong></p>
          <ul>
            <li><a href="https://github.com/apol0510/keiba-intelligence/actions">GitHub Actionsログを確認</a></li>
            <li>手動で再実行するか、修正が必要か判断してください</li>
          </ul>
        `
      };

    case 'zero-hit-rate':
      return {
        subject: `⚠️ [keiba-intelligence] 異常値検知：的中率0% (${date})`,
        html: `
          <h2 style="color: #ff9800;">⚠️ 異常値検知：的中率0%</h2>
          <p><strong>日時:</strong> ${timestamp}</p>
          <p><strong>対象日付:</strong> ${date}</p>
          <p><strong>検知内容:</strong> 的中レース0件（12レース中）</p>
          <hr>
          <p><strong>考えられる原因：</strong></p>
          <ul>
            <li>予想データの読み込み失敗（買い目なし）</li>
            <li>結果データのフォーマット不一致</li>
            <li>的中判定ロジックのバグ</li>
          </ul>
          <p><strong>対応が必要です：</strong></p>
          <ul>
            <li><a href="https://github.com/apol0510/keiba-intelligence/blob/main/astro-site/src/data/archiveResults.json">archiveResults.jsonを確認</a></li>
            <li>予想データと結果データの整合性を確認</li>
            <li>手動で的中判定を再実行</li>
          </ul>
          <hr>
          <p><strong>詳細情報:</strong></p>
          <pre style="background: #f5f5f5; padding: 10px; border-radius: 4px;">${JSON.stringify(details, null, 2)}</pre>
        `
      };

    case 'prediction-not-found':
      return {
        subject: `⏭️ [keiba-intelligence] 予想データなし (${date})`,
        html: `
          <h2 style="color: #2196f3;">⏭️ 予想データなし（スキップ）</h2>
          <p><strong>日時:</strong> ${timestamp}</p>
          <p><strong>対象日付:</strong> ${date}</p>
          <p><strong>状況:</strong> keiba-data-sharedに予想データが存在しません</p>
          <hr>
          <p><strong>情報:</strong></p>
          <ul>
            <li>これは正常なケースです（SEO対策用の結果データのみ保存）</li>
            <li>keiba-intelligenceでは的中判定をスキップしました</li>
            <li>対応は不要です</li>
          </ul>
        `
      };

    case 'import-results-failure':
      return {
        subject: `❌ [keiba-intelligence] 結果データ取り込み失敗 (${date})`,
        html: `
          <h2 style="color: #d32f2f;">❌ 結果データ取り込み失敗</h2>
          <p><strong>日時:</strong> ${timestamp}</p>
          <p><strong>対象日付:</strong> ${date}</p>
          <p><strong>エラー内容:</strong></p>
          <pre style="background: #f5f5f5; padding: 10px; border-radius: 4px;">${details?.error || 'エラー内容不明'}</pre>
          <hr>
          <p><strong>対応が必要です：</strong></p>
          <ul>
            <li><a href="https://github.com/apol0510/keiba-data-shared">keiba-data-sharedに結果データが存在するか確認</a></li>
            <li>手動で再実行：<code>npm run import:results -- --date ${date}</code></li>
          </ul>
        `
      };

    case 'results-imported-success':
      const profit = details?.profit || 0;
      const profitSign = profit >= 0 ? '+' : '';
      const profitColor = profit >= 0 ? '#4caf50' : '#f44336';

      return {
        subject: `✅ [keiba-intelligence] ${date} 的中実績自動追加完了`,
        html: `
          <h2 style="color: #4caf50;">✅ 的中実績自動追加完了</h2>
          <p><strong>日時:</strong> ${timestamp}</p>
          <p><strong>対象日付:</strong> ${date}</p>
          <p><strong>会場:</strong> ${metadata?.venue || '不明'}</p>
          <hr>
          <h3 style="color: #2196f3;">📊 実績サマリー</h3>
          <table style="border-collapse: collapse; width: 100%; margin: 20px 0;">
            <tr style="background: #f5f5f5;">
              <td style="padding: 10px; border: 1px solid #ddd;"><strong>的中率</strong></td>
              <td style="padding: 10px; border: 1px solid #ddd;">${details?.hitRate}% (${details?.hitRaces}/${details?.totalRaces}R)</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #ddd;"><strong>投資額</strong></td>
              <td style="padding: 10px; border: 1px solid #ddd;">¥${details?.betAmount?.toLocaleString()}</td>
            </tr>
            <tr style="background: #f5f5f5;">
              <td style="padding: 10px; border: 1px solid #ddd;"><strong>払戻額</strong></td>
              <td style="padding: 10px; border: 1px solid #ddd;">¥${details?.totalPayout?.toLocaleString()}</td>
            </tr>
            <tr>
              <td style="padding: 10px; border: 1px solid #ddd;"><strong>回収率</strong></td>
              <td style="padding: 10px; border: 1px solid #ddd; color: ${profitColor}; font-weight: bold;">${details?.returnRate}%</td>
            </tr>
            <tr style="background: #f5f5f5;">
              <td style="padding: 10px; border: 1px solid #ddd;"><strong>損益</strong></td>
              <td style="padding: 10px; border: 1px solid #ddd; color: ${profitColor}; font-weight: bold;">${profitSign}¥${Math.abs(profit).toLocaleString()}</td>
            </tr>
          </table>
          <hr>
          <p><strong>確認:</strong></p>
          <ul>
            <li><a href="https://keiba-intelligence.netlify.app/results">的中実績ページを確認</a></li>
            <li><a href="https://github.com/apol0510/keiba-intelligence/blob/main/astro-site/src/data/archiveResults.json">archiveResults.jsonを確認</a></li>
          </ul>
          <p style="color: #666; font-size: 12px; margin-top: 20px;">このメールは自動送信されています。</p>
        `
      };

    default:
      return {
        subject: `🔔 [keiba-intelligence] アラート通知 (${date || 'N/A'})`,
        html: `
          <h2>🔔 アラート通知</h2>
          <p><strong>日時:</strong> ${timestamp}</p>
          <p><strong>タイプ:</strong> ${type}</p>
          <p><strong>対象日付:</strong> ${date || '不明'}</p>
          <hr>
          <p><strong>詳細情報:</strong></p>
          <pre style="background: #f5f5f5; padding: 10px; border-radius: 4px;">${JSON.stringify({ details, metadata }, null, 2)}</pre>
        `
      };
  }
}
