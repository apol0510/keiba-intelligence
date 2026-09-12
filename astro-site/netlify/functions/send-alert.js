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
    // リクエストボディ解析
    const { type, date, details, metadata, nonce } = JSON.parse(event.body);

    // 必須パラメータチェック
    if (!type) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'type is required' })
      };
    }

    /*
     * 🔴 **外部から直接発火させない alert type の検証**（2026-09-12）。
     *
     *    この関数は認証を持たない。そのままだと `stripe_webhook_failed` を
     *    誰でも POST でき、`stripe-webhook` 側の 6 時間 dedup を**迂回して**
     *    メールを撃たせられる。
     *
     *    そこでこの type だけは、**`stripe-webhook` が発行した単回使用の nonce**
     *    を必須にする。nonce は Blobs にあり、ここで**検証して消す**。
     *
     *    🔴 検証できないときは送らない（fail-closed）。
     *    🔴 他の type の呼び出し元には影響しない（`requiresAlertNonce` が false）。
     */
    {
      const { requiresAlertNonce, verifyAlertNonce, ALERT_NONCE_STORE } =
        await import('../../src/lib/billing/webhookAlert.js');

      if (requiresAlertNonce(type)) {
        let storedAtIso = null;
        let store = null;
        try {
          const { getStore, connectLambda } = await import('@netlify/blobs');
          if (event?.blobs && typeof connectLambda === 'function') connectLambda(event);
          store = getStore(ALERT_NONCE_STORE);
          if (typeof nonce === 'string' && nonce) storedAtIso = await store.get(nonce);
        } catch (err) {
          console.error('❌ send-alert: nonce store unavailable:', err && err.message);
        }

        const verdict = verifyAlertNonce({ type, nonce, storedAtIso });
        if (!verdict.ok) {
          // 🔴 理由は返さない（当て推量の手掛かりを与えない）
          console.warn('⚠️ send-alert: internal alert rejected:', verdict.reason);
          return { statusCode: 403, headers, body: JSON.stringify({ error: 'forbidden' }) };
        }

        // 単回使用。消せなくても送信は続ける（多重送信は dedup 側で抑えている）
        try {
          if (store) await store.delete(nonce);
        } catch (err) {
          console.warn('⚠️ send-alert: nonce not consumed:', err && err.message);
        }
      }
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
      to: process.env.ALERT_EMAIL || 'your-email@example.com',
      from: process.env.SENDGRID_FROM_EMAIL || 'noreply@em8410.keiba-intelligence.jp',
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
          <pre style="background: #f5f5f5; padding: 10px; border-radius: 4px;">${details?.error || details?.message || '[詳細情報欠落：呼び出し側で details.error を指定してください]'}</pre>
          ${details?.stack ? `<p><strong>stack要約:</strong></p><pre style="background:#f5f5f5;padding:10px;border-radius:4px;font-size:12px;">${String(details.stack).split('\n').slice(0,6).join('\n')}</pre>` : ''}
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

    case 'import-results-failure': {
      const stage = details?.stage || 'unknown';
      const errorMsg = details?.error || details?.message || '[詳細情報欠落：sendAlert呼び出し側で error/message/stage を指定してください]';
      const stackSummary = details?.stack ? String(details.stack).split('\n').slice(0, 6).join('\n') : '(スタックトレース未収集)';
      const variant = metadata?.variant || 'nankan';
      const cmd = variant === 'jra' ? 'npm run import:results:jra' : 'npm run import:results';
      const stageLabel = {
        'fetch': 'fetch（データ取得）',
        'fetch-predictions': 'fetch（予想データ取得）',
        'fetch-predictions-jra': 'fetch（JRA予想データ取得）',
        'parse': 'parse（解析）',
        'write': 'write（書き込み）',
        'verify': 'verify（検証）',
        'verify-archive': 'verify（archive反映検証）',
        'commit': 'commit（コミット）',
        'push': 'push（プッシュ）',
        'unknown': 'unknown（段階未指定）'
      }[stage] || stage;
      return {
        subject: `❌ [keiba-intelligence] 結果データ取り込み失敗 (${date}) stage=${stage}`,
        html: `
          <h2 style="color: #d32f2f;">❌ 結果データ取り込み失敗</h2>
          <p><strong>日時:</strong> ${timestamp}</p>
          <p><strong>対象日付:</strong> ${date}</p>
          <p><strong>失敗段階:</strong> <code style="background:#fee;padding:2px 6px;border-radius:3px;">${stageLabel}</code></p>
          <p><strong>例外メッセージ:</strong></p>
          <pre style="background: #f5f5f5; padding: 10px; border-radius: 4px;">${errorMsg}</pre>
          <p><strong>stack要約:</strong></p>
          <pre style="background: #f5f5f5; padding: 10px; border-radius: 4px; font-size: 12px;">${stackSummary}</pre>
          ${details?.message && details.message !== errorMsg ? `<p><strong>補足:</strong> ${details.message}</p>` : ''}
          <hr>
          <p><strong>対応:</strong></p>
          <ul>
            <li><a href="https://github.com/apol0510/keiba-data-shared">keiba-data-sharedに結果データが存在するか確認</a></li>
            <li>手動で再実行：<code>${cmd} -- --date ${date}</code></li>
          </ul>
          <p style="color:#888;font-size:12px;">※ このアラートは最終状態が失敗の場合のみ送信されます（archive反映済みの誤検知は抑止されます）</p>
        `
      };
    }

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
            <li><a href="https://keiba-intelligence.jp/results">的中実績ページを確認</a></li>
            <li><a href="https://github.com/apol0510/keiba-intelligence/blob/main/astro-site/src/data/archiveResults.json">archiveResults.jsonを確認</a></li>
          </ul>
          <p style="color: #666; font-size: 12px; margin-top: 20px;">このメールは自動送信されています。</p>
        `
      };

    /*
     * 🔴 Stripe webhook が静かに失敗している（2026-09-12 の事故の再発防止）。
     *    決済は成立しているのに会員の権限が開かない状態なので、最優先で直す。
     *    🔴 本文に秘密値・リクエスト内容は入れない（送る側で組み立て済み）。
     */
    case 'stripe_webhook_failed': {
      const steps = Array.isArray(metadata?.nextSteps) ? metadata.nextSteps : [];
      return {
        subject: `🚨 [keiba-intelligence] Stripe webhook 失敗 (${metadata?.reason || 'unknown'})`,
        html: `
          <h2>🚨 Stripe webhook が失敗しています</h2>
          <p><strong>日時:</strong> ${timestamp}</p>
          <p><strong>理由:</strong> ${metadata?.reason || '不明'}</p>
          <hr>
          <p>${details || ''}</p>
          <p style="background:#fff3cd;padding:10px;border-radius:4px;">
            <strong>影響:</strong> 決済が成立していても、会員の権限が開きません。
            Airtable の <code>PlanType</code> が更新されず、リワードも付きません。
          </p>
          <p><strong>次に確認すること:</strong></p>
          <ul>${steps.map((s) => `<li>${s}</li>`).join('')}</ul>
          <p style="color:#666;font-size:12px;margin-top:20px;">
            同じ理由の通知は ${metadata?.windowHours ?? '—'} 時間に 1 通だけ送られます。
            以後の状況は Stripe ダッシュボードの Webhook のエラー率で確認してください。
          </p>
        `
      };
    }

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
