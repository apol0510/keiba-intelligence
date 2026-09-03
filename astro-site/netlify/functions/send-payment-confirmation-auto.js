/**
 * 入金確認メール自動送信（Airtable Automation専用）
 *
 * トリガー: Airtable Status が "pending" → "active" に変更
 * 動作:
 *   1. Airtableからレコード情報取得（email, Name, Plan, plan_type）
 *   2. 二重送信防止チェック（PaymentEmailSentフィールド）
 *   3. メール送信（SendGrid）
 *   4. PaymentEmailSent を true に更新 + 有効期限設定
 *   5. 🔵 会員継続制度への反映（**別リクエスト・フラグ付き・失敗を握りつぶす**）
 *
 * 🔴 **手順 5 は手順 1〜4 に一切影響させない。**
 *    入金確認・`AccessEnabled`・メール送信は会員継続制度より優先される。
 *    membership 側が失敗しても、この関数の応答は変わらない（200 のまま）。
 *    正本: docs/MEMBERSHIP_REWARDS.md §7.6 / §7.7
 */

/**
 * 入金確認を会員継続制度へ反映する（best-effort）。
 *
 * 🔴 既定（`MEMBERSHIP_WRITE_ENABLED` 未設定）では **何もしない**。
 * 🔴 例外を投げない。呼び出し側の try/catch を汚さない。
 * 🔴 `AccessEnabled` / `Status` / `PlanType` には触れない（認可は変更しない）。
 *
 * @param {object} o
 * @param {string} o.recordId
 * @param {object} o.fields         更新前のレコード
 * @param {string} o.expirationDate この入金で設定した有効期限
 * @param {string|null} [o.confirmedAtIso] 初回のみ「いま確認した」時刻。
 *   🔴 再実行では null を渡し、`ExpirationDate − 期間` から復元させる。
 */
async function recordBankMembership({ recordId, fields, expirationDate, confirmedAtIso = null }) {
  try {
    const [{ resolveMembershipStore, isWriteEnabled }, { planBankMembershipUpdate }, { toAirtableDate }] =
      await Promise.all([
        import('../../src/lib/membership/store.js'),
        import('../../src/lib/membership/bankTransfer.js'),
        import('../../src/lib/membership/airtableStore.js'),
      ]);
    if (!isWriteEnabled(process.env)) return;

    const plan = planBankMembershipUpdate({ fields, recordId, expirationDate, confirmedAtIso });

    if (plan.skipped.length) {
      // 🔴 理由をログに残すが、処理は続ける（起点だけ書ける場合もある）
      console.log('ℹ️ membership: skipped ->', plan.skipped.join(','));
    }

    const store = resolveMembershipStore({ env: process.env });
    if (!store.enabled) return;

    // 起点（＝初回の入金確認日）。既に入っていれば書かない
    if (plan.startedAtIso) {
      const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
      const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
      const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Customers/${recordId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
        // 🔴 membership の列だけ。既存列は 1 つも入れない
        // 🔴 MembershipStartedAt は日付だけの列。日時を送ると 422 になる
        body: JSON.stringify({ fields: { MembershipStartedAt: toAirtableDate(plan.startedAtIso) } }),
      });
      console.log(res.ok
        ? `✅ membership: MembershipStartedAt=${plan.startedAtIso}`
        : `⚠️ membership: MembershipStartedAt not written (${res.status})`);
    }

    // 支払い済み期間ぶんの付与（冪等キー＝レコード＋その期の期限）
    if (plan.entry) {
      const r = await store.appendEntry(fields.Email, plan.entry);
      console.log(`ℹ️ membership: accrual ${r.status} (${plan.entry.points}pt / ${plan.entry.periodMonths}m)`);
    }
  } catch (e) {
    // 🔴 入金確認・AccessEnabled・メール送信へ波及させない
    console.warn('⚠️ membership: not recorded (ignored):', e?.name || 'Error');
  }
}

exports.handler = async (event, context) => {
  // CORSヘッダー設定
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    const requestData = JSON.parse(event.body);
    const { airtableRecordId } = requestData;

    console.log('📧 Payment confirmation auto trigger:', airtableRecordId);

    if (!airtableRecordId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'airtableRecordId is required' })
      };
    }

    // Airtable API設定
    const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
    const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

    if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
      throw new Error('Airtable credentials not configured');
    }

    // ========================================
    // Step 1: Airtableからレコード情報取得
    // ========================================
    const recordUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Customers/${airtableRecordId}`;

    console.log('🔍 Fetching record:', airtableRecordId);

    const recordResponse = await fetch(recordUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!recordResponse.ok) {
      const errorText = await recordResponse.text();
      throw new Error(`Airtable record fetch failed: ${recordResponse.status} - ${errorText}`);
    }

    const recordData = await recordResponse.json();
    const fields = recordData.fields;

    const email = fields.Email;
    const fullName = fields.Name || fields['氏名'] || '';
    const planDisplayName = fields.Plan || '';
    const planType = fields.plan_type || '';
    const paymentAmount = fields['入金金額'] || fields.transferAmount || null;
    const paymentEmailSent = fields.PaymentEmailSent || false;

    console.log('📋 Record info:', { email, fullName, planDisplayName, planType, paymentEmailSent });

    if (!email || !fullName) {
      console.error('⚠️ Missing required fields:', { email, fullName });
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: 'Missing required fields in Airtable record',
          details: { email, fullName }
        })
      };
    }

    // ========================================
    // Step 2: 二重送信防止チェック
    // ========================================
    // 🔴 メールの再送は引き続き禁止する。
    //    ただし **ここで return しない**。Step 1〜4 が成功したあとに
    //    Step 5（会員継続制度）だけが一時的に失敗した場合、
    //    早期 return するとリワードが**永久に欠落**するため、
    //    再実行で Step 5 だけ回復できるように先へ進む。
    const alreadyConfirmed = paymentEmailSent === true;
    if (alreadyConfirmed) {
      console.log('ℹ️ Payment email already sent — skip mail/update, try membership only:', email);
    }

    // ========================================
    // Step 3: メール送信
    // ========================================
    const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
    const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'noreply@em8410.keiba-intelligence.jp';
    const SUPPORT_EMAIL = process.env.ADMIN_EMAIL || 'support@keiba-intelligence.jp';

    if (!SENDGRID_API_KEY) {
      throw new Error('SendGrid API key not configured');
    }

    // プラン別情報
    const planInfo = getPlanInfo();

    // プラン表示名（メール用）
    const emailPlanName = getEmailPlanName(planType);

    // 日本時間
    const japanTime = new Date().toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    // 有効期限計算
    const expirationDate = calculateExpirationDate(planType);

    // 会場アクセス表示テキスト
    const venueAccessDisplay = getVenueAccessDisplay();

    // メール送信（🔴 再実行では送らない）
    const userEmailData = {
      personalizations: [{
        to: [{ email: email }],
        subject: `【入金確認】KEIBA Intelligence ${emailPlanName} - アクセス情報`
      }],
      from: { email: FROM_EMAIL, name: 'KEIBA Intelligence' },
      content: [{
        type: 'text/html',
        value: generateEmailHTML(fullName, email, emailPlanName, planType, expirationDate, paymentAmount, venueAccessDisplay, planInfo, SUPPORT_EMAIL)
      }],
      tracking_settings: {
        click_tracking: { enable: false },
        open_tracking: { enable: false }
      }
    };

    if (!alreadyConfirmed) {
      const userResponse = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SENDGRID_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(userEmailData)
      });

      if (!userResponse.ok) {
        const errorText = await userResponse.text();
        console.error('SendGrid user email error:', errorText);
        throw new Error(`Failed to send user email: ${userResponse.status}`);
      }

      console.log('✅ Payment confirmation email sent:', email);
    }

    // ========================================
    // Step 4: Airtable更新
    // ========================================
    const updatePayload = {
      fields: {
        'PaymentEmailSent': true,
        'AccessEnabled': true
      }
    };

    // 有効期限設定
    if (expirationDate) {
      updatePayload.fields['ExpirationDate'] = expirationDate;
      updatePayload.fields['有効期限'] = expirationDate;
      console.log('📅 有効期限設定:', expirationDate, 'for', planType);
    }

    // PaymentMethod設定（未設定の場合）
    if (!fields.PaymentMethod) {
      updatePayload.fields['PaymentMethod'] = 'Bank Transfer';
    }

    if (!alreadyConfirmed) {
      const updateResponse = await fetch(recordUrl, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updatePayload)
      });

      if (updateResponse.ok) {
        console.log('✅ Airtable updated:', airtableRecordId);
      } else {
        const errorText = await updateResponse.text();
        console.error('⚠️ Airtable update failed:', errorText);
      }
    }

    // ========================================
    // Step 5: 会員継続制度への反映（best-effort・既定では何もしない）
    // 🔴 ここで失敗しても手順 1〜4 の結果は変えない
    // ========================================
    // 🔴 初回は「いま確認した」時刻を渡す。再実行では **渡さない**（有効期限から復元する）。
    //    現在時刻で代用すると、数日後の再実行で起点と付与日時が実際の入金日とずれる。
    await recordBankMembership({
      recordId: airtableRecordId,
      fields,
      // 再実行のときは保存済みの有効期限を使う（この実行では書き換えていない）
      expirationDate: alreadyConfirmed
        ? (fields.ExpirationDate || fields['有効期限'] || null)
        : expirationDate,
      confirmedAtIso: alreadyConfirmed ? null : new Date().toISOString(),
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        skipped: alreadyConfirmed,
        message: alreadyConfirmed
          ? 'Payment email already sent (membership reconciled)'
          : 'Payment confirmation email sent successfully',
        email: email,
        planType: planType,
        expirationDate: expirationDate,
        airtableRecordId: airtableRecordId
      })
    };

  } catch (error) {
    console.error('Error sending payment confirmation:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Internal Server Error',
        message: error.message
      })
    };
  }
};

/**
 * 有効期限計算
 */
function calculateExpirationDate(planType) {
  const today = new Date();

  if (planType === 'lifetime') {
    return '2099-12-31';
  } else if (planType === 'yearly') {
    const expDate = new Date(today);
    expDate.setFullYear(expDate.getFullYear() + 1);
    return expDate.toISOString().split('T')[0];
  } else if (planType === 'monthly-nankan' || planType === 'monthly-jra' || planType === 'light') {
    const expDate = new Date(today);
    expDate.setMonth(expDate.getMonth() + 1);
    return expDate.toISOString().split('T')[0];
  }

  // デフォルト: 1ヶ月後
  const expDate = new Date(today);
  expDate.setMonth(expDate.getMonth() + 1);
  return expDate.toISOString().split('T')[0];
}

/**
 * プラン表示名（メール件名用）
 */
function getEmailPlanName(planType) {
  const names = {
    'lifetime': '買い切りプラン',
    'yearly': '年払いプラン',
    'light': 'ライトプラン',
    'monthly-nankan': '月払いプラン（南関）',
    'monthly-jra': '月払いプラン（中央）'
  };
  return names[planType] || 'プロプラン';
}

/**
 * 対象会場の表示テキスト。
 * 🔴 2026-08-30: 会場で分ける概念を廃止したため、有料は常に全会場。
 */
function getVenueAccessDisplay() {
  return '南関4場（大井・川崎・船橋・浦和）＋ JRA全10場';
}

/**
 * プラン別のログインURL・ボタンテキスト
 */
function getPlanInfo() {
  const baseUrl = 'https://keiba-intelligence.jp';
  // 🔴 2026-08-30: 会場で分けないため、導線は 1 本
  return {
    loginUrl: `${baseUrl}/login`,
    buttonText: 'ログインして予想を見る'
  };
}

/**
 * メールHTML生成
 */
function generateEmailHTML(fullName, email, planName, planType, expirationDate, paymentAmount, venueAccessDisplay, planInfo, supportEmail) {
  // プランタイプ表示用
  let planTypeDisplay = '';
  if (planType === 'lifetime') planTypeDisplay = '（永久アクセス）';
  else if (planType === 'yearly') planTypeDisplay = '（年払い）';
  else if (planType === 'monthly-nankan' || planType === 'monthly-jra' || planType === 'light') planTypeDisplay = '（月払い）';

  // 有効期限表示
  let expirationDisplay = '';
  if (expirationDate) {
    if (expirationDate === '2099-12-31' || planType === 'lifetime') {
      expirationDisplay = '永久アクセス';
    } else {
      expirationDisplay = expirationDate;
    }
  }

  // 入金金額表示
  let amountDisplay = '';
  if (paymentAmount) {
    const amount = typeof paymentAmount === 'number'
      ? paymentAmount.toLocaleString('ja-JP')
      : paymentAmount;
    amountDisplay = `¥${amount}`;
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Hiragino Sans', 'Yu Gothic', sans-serif; line-height: 1.8; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #3b82f6; background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; padding: 30px 20px; border-radius: 8px; margin-bottom: 20px; text-align: center; }
    .section { background: #f8fafc; padding: 20px; border-radius: 8px; margin-bottom: 15px; border-left: 4px solid #3b82f6; }
    .info-row { padding: 10px 0; border-bottom: 1px solid #e2e8f0; }
    .label { font-weight: bold; color: #475569; display: inline-block; width: 140px; }
    .value { color: #1e293b; }
    .highlight { background: #dbeafe; padding: 20px; border-radius: 8px; border-left: 4px solid #3b82f6; margin: 20px 0; }
    .venue-info { background: #f0fdf4; padding: 15px; border-radius: 8px; border-left: 4px solid #10b981; margin: 15px 0; }
    .login-button { display: inline-block; background-color: #3b82f6; background: linear-gradient(135deg, #3b82f6, #2563eb); color: #ffffff; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 15px 0; }
    .footer { text-align: center; color: #64748b; font-size: 0.9rem; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0; font-size: 1.8rem;">🎉 ご入金ありがとうございます</h1>
      <p style="margin: 15px 0 0 0; font-size: 1rem;">入金を確認いたしました</p>
    </div>

    <div class="section">
      <p style="margin: 0 0 15px 0; font-size: 1.1rem;">
        <strong>${fullName} 様</strong>
      </p>
      <p style="margin: 0; color: #475569; line-height: 1.8;">
        この度は <strong>${planName}</strong> をご購入いただき、誠にありがとうございます。<br>
        ご入金を確認いたしました。
      </p>
    </div>

    <div class="highlight">
      <h3 style="margin: 0 0 15px 0; color: #1e40af;">🔑 ご利用情報</h3>
      <div class="info-row">
        <span class="label">プラン:</span>
        <span class="value"><strong>${planName} ${planTypeDisplay}</strong></span>
      </div>
      ${expirationDisplay ? `
      <div class="info-row">
        <span class="label">有効期限:</span>
        <span class="value"><strong>${expirationDisplay}</strong></span>
      </div>
      ` : ''}
      ${amountDisplay ? `
      <div class="info-row">
        <span class="label">お支払い金額:</span>
        <span class="value"><strong>${amountDisplay}</strong></span>
      </div>
      ` : ''}
      <div class="info-row" style="border-bottom: none;">
        <span class="label">ログインメール:</span>
        <span class="value"><strong>${email}</strong></span>
      </div>
    </div>

    <div class="venue-info">
      <h4 style="margin: 0 0 10px 0; color: #065f46;">🏇 アクセス可能な競馬場</h4>
      <p style="margin: 0; color: #1e293b; font-weight: bold;">${venueAccessDisplay}</p>
    </div>

    <div class="section">
      <h3 style="margin: 0 0 15px 0; color: #1e293b;">📱 ログイン方法</h3>
      <p style="margin: 0 0 15px 0; color: #475569;">
        下記のボタンからログインページにアクセスし、<br>
        ご登録メールアドレスを入力してください。<br>
        メールに届くログインリンクからアクセスできます。
      </p>
      <div style="text-align: center;">
        <a href="${planInfo.loginUrl}" class="login-button" target="_blank" style="display: inline-block; background-color: #3b82f6; background: linear-gradient(135deg, #3b82f6, #2563eb); color: #ffffff !important; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 15px 0;">
          ${planInfo.buttonText}
        </a>
      </div>
      <p style="margin: 15px 0 0 0; padding: 15px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px; color: #92400e; font-size: 0.95rem;">
        <strong>⚠️ 重要</strong><br>
        既にログイン中の場合は、一度ログアウトしてから再度ログインしてください。<br>
        プラン情報が正しく反映されます。
      </p>
    </div>

    <div class="section">
      <h4 style="margin: 0 0 15px 0; color: #1e293b;">📞 サポート</h4>
      <p style="margin: 0; color: #475569; line-height: 1.8;">
        ご不明な点やログインできない場合は、お気軽にお問い合わせください。<br>
        📧 <a href="mailto:${supportEmail}" style="color: #3b82f6;">${supportEmail}</a>
      </p>
    </div>

    <div class="footer">
      <p><strong>KEIBA Intelligence</strong></p>
      <p>AI-Powered Intelligence Dashboard for 競馬予想</p>
      <p><a href="https://keiba-intelligence.jp" style="color: #3b82f6; text-decoration: none;">https://keiba-intelligence.jp</a></p>
      <p style="margin-top: 15px; font-size: 0.85rem; color: #94a3b8;">
        ※このメールは入金確認後に自動送信されています
      </p>
    </div>
  </div>
</body>
</html>
  `;
}
