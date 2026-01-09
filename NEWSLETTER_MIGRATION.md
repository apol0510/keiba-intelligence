# 配配メール → SendGrid 段階移行システム

**KEIBA Intelligence - 15,000件を安全に移行する完全設計**

---

## 🎯 最重要要件

**15,000件の配信先を段階的にSendGridへ移行する**

- 全件一括移行は絶対禁止
- 有料会員のみを対象
- 配配メールとの併用期間を安全に運用
- 二重送信・誤送信・一括大量送信事故を構造的に防止

---

## 📊 移行対象の限定条件（最優先）

SendGridへの段階移行は**有料会員のみ**を対象とする。

### 必須条件（4条件すべて満たす）

```javascript
// 配信対象条件
plan_type = 'paid'        // 有料会員のみ
status = 'active'         // アクティブ会員のみ
unsubscribe != true       // 配信停止していない
send_channel = 'sendgrid' // SendGrid配信対象
```

**1条件でも欠けた場合は必ず除外する。**

---

## 📋 Airtable テーブル設計（拡張版）

### テーブル1: Customers（顧客管理）

| フィールド名 | 型 | 説明 | 必須 | 例 |
|------------|----|----|------|-----|
| email | Email | メールアドレス（主キー） | ✅ | user@example.com |
| plan_type | Single select | paid / free | ✅ | paid |
| status | Single select | active / cancelled / bounced / suppressed | ✅ | active |
| source | Single select | haipai / sendgrid / mixed | ✅ | haipai |
| send_channel | Single select | haipai / sendgrid | ✅ | haipai |
| migrated_at | Date | SendGridへ移行した日時 | ❌ | 2026-01-15 |
| last_sent_at | Date | 最終送信日時 | ❌ | 2026-01-10 |
| unsubscribe | Checkbox | 配信停止フラグ | ✅ | false |
| tags | Multiple select | タグ（任意） | ❌ | VIP, 新規 |
| Name | Single line text | 氏名 | ❌ | 山田太郎 |
| Plan | Single line text | プラン名 | ❌ | スタンダード |

**重要フィールドの意味:**

- `plan_type`: 有料会員（paid）か無料会員（free）か
- `send_channel`: 配信チャネル（**移行の最重要スイッチ**）
  - `haipai`: 配配メールで送信
  - `sendgrid`: SendGridで送信
- `source`: データソース（どこから登録されたか）
  - `haipai`: 配配メールから
  - `sendgrid`: SendGridから
  - `mixed`: 両方

---

### テーブル2: Broadcasts（配信管理）

| フィールド名 | 型 | 説明 | 必須 |
|------------|----|----|------|
| broadcast_id | Single line text (UUID) | 配信ID | ✅ |
| subject | Single line text | 件名 | ✅ |
| body_html | Long text | HTML本文 | ✅ |
| status | Single select | draft / dry-run / locked / sending / sent / aborted | ✅ |
| stage | Number | 送信ステージ（50/100/300/500/1000/...） | ✅ |
| created_at | Date | 作成日時 | ✅ |
| locked_at | Date | ロック日時 | ❌ |
| sent_at | Date | 送信完了日時 | ❌ |
| recipient_count_planned | Number | 送信予定件数 | ❌ |
| recipient_count_sent | Number | 実際に送信した件数 | ❌ |
| hash | Single line text | SHA256(subject + body) | ✅ |
| created_by | Single line text | 作成者 | ✅ |

**status の状態遷移:**
```
draft → dry-run → locked → sending → sent
                       ↓
                    aborted
```

**stage の例:**
- Stage 1: 50件
- Stage 2: 100件
- Stage 3: 300件
- Stage 4: 500件
- Stage 5: 1,000件
- Stage 6: 3,000件
- Stage 7: 7,000件
- Stage 8: 15,000件（完了）

---

### テーブル3: BroadcastRecipients（配信ログ）

| フィールド名 | 型 | 説明 | 必須 |
|------------|----|----|------|
| id | Auto number | レコードID | ✅ |
| broadcast_id | Single line text (UUID) | 配信ID | ✅ |
| email | Email | 送信先メールアドレス | ✅ |
| send_status | Single select | pending / sent / failed / skipped | ✅ |
| provider_message_id | Single line text | SendGridメッセージID | ❌ |
| error_code | Single line text | エラーコード | ❌ |
| sent_at | Date | 送信日時 | ❌ |
| is_test | Checkbox | テスト送信フラグ | ✅ |

**ユニーク制約（論理）:**
```
(broadcast_id, email) は必ずユニーク
```

---

## 🚀 移行戦略（段階的移行）

### ステージ1: 50件（初期テスト）

**目的:** SendGridの送信品質を確認

```
対象: send_channel=sendgrid かつ plan_type=paid の 50件
期間: 2〜3日
確認項目:
- 配信成功率（98%以上）
- バウンス率（2%以下）
- 苦情率（0.1%以下）
```

### ステージ2: 100件

**目的:** スケーラビリティ確認

```
対象: 前回50件 + 追加50件
期間: 1週間
```

### ステージ3: 300件

**目的:** 中規模配信の安定性確認

### ステージ4: 500件

### ステージ5: 1,000件

### ステージ6: 3,000件

### ステージ7: 7,000件

### ステージ8: 15,000件（完了）

**各ステージで以下を確認:**
1. SendGrid Statsで配信成功率を確認
2. バウンス・苦情がないか確認
3. 管理者が明示的に次ステージを許可
4. Customers の send_channel を `haipai` → `sendgrid` に切り替え

---

## 🔒 二重送信防止メカニズム（5レイヤー）

### レイヤー1: UI制御

```javascript
if (broadcast.status === 'sent' || broadcast.status === 'locked' || broadcast.status === 'sending') {
  return <button disabled>送信済み・実行中（再送不可）</button>;
}
```

### レイヤー2: API先行ロック（最重要）

```javascript
// 送信開始前に status を locked に更新
await updateBroadcastStatus(broadcastId, 'locked');

// 以降、この broadcast_id では送信APIを拒否
if (broadcast.status !== 'dry-run') {
  return { error: 'Broadcast already locked or sent' };
}
```

### レイヤー3: 配信対象の厳格チェック

```javascript
// 4条件すべてを満たすレコードのみ取得
const customers = await customersTable
  .select({
    filterByFormula: `AND(
      {plan_type} = "paid",
      {status} = "active",
      {unsubscribe} != TRUE(),
      {send_channel} = "sendgrid"
    )`
  })
  .all();
```

### レイヤー4: メールアドレス重複チェック

```javascript
// 既に送信済みかチェック
const alreadySent = await checkAlreadySent(broadcast_id, email);
if (alreadySent) {
  console.log('⏭️ Already sent to:', email);
  continue; // スキップ
}
```

### レイヤー5: 配信チャネル分離

```javascript
// send_channel = haipai の人は絶対SendGridで送らない
if (customer.send_channel === 'haipai') {
  console.log('⏭️ Haipai channel, skipped:', customer.email);
  continue;
}
```

---

## 📧 送信フロー（7ステップ）

### ステップ1: 配信作成（draft）

管理画面で配信を作成。

```
POST /.netlify/functions/create-broadcast
{
  "subject": "【重要】有料会員の皆様へ",
  "body_html": "<p>本メールは有料会員の方にのみお送りしています...</p>",
  "stage": 50,
  "created_by": "admin@keiba-intelligence.keiba.link"
}
```

### ステップ2: Dry-Run（対象抽出）

送信対象を抽出し、件数を確認。

```
POST /.netlify/functions/send-broadcast
{
  "broadcast_id": "uuid",
  "dry_run": true,
  "stage": 50,
  "user_email": "admin@keiba-intelligence.keiba.link"
}

Response:
{
  "dry_run": true,
  "recipient_count_planned": 50,
  "unique_emails": 50,
  "conditions": {
    "plan_type": "paid",
    "status": "active",
    "unsubscribe": false,
    "send_channel": "sendgrid"
  }
}
```

### ステップ3: 対象プレビュー

管理画面で送信予定メールアドレス一覧を表示。

### ステップ4: テスト送信

管理者アドレス1件のみに送信。

```
POST /.netlify/functions/send-test
{
  "broadcast_id": "uuid",
  "test_email": "admin@keiba-intelligence.keiba.link"
}
```

### ステップ5: 本番送信（最終確認）

```javascript
// 確認ダイアログ
confirm(`
以下の条件で送信します。よろしいですか？

件名: ${broadcast.subject}
ステージ: ${broadcast.stage}件
対象条件:
- 有料会員のみ（plan_type=paid）
- アクティブ会員のみ（status=active）
- 配信停止していない（unsubscribe≠true）
- SendGrid配信対象（send_channel=sendgrid）

送信予定件数: ${recipientCount}件

送信後は取り消しできません。
`);
```

### ステップ6: バッチ送信実行

```javascript
// 200件/バッチで送信
const batchSize = 200;
const delay = 2000; // 2秒間隔

for (let i = 0; i < emails.length; i += batchSize) {
  const batch = emails.slice(i, i + batchSize);
  await sendBatch(batch);
  await sleep(delay);
}
```

### ステップ7: 送信完了確認

```javascript
// 送信完了後
await updateBroadcast(broadcastId, {
  status: 'sent',
  sent_at: new Date().toISOString(),
  recipient_count_sent: sentCount,
});
```

---

## 🛡️ 配配メールとの併用設計

### 原則: チャネル分離

```
send_channel = haipai  → 配配メールで送信
send_channel = sendgrid → SendGridで送信
```

### 移行手順

1. **初期状態（全員 haipai）**
```javascript
// 全Customersレコード
send_channel = 'haipai'
```

2. **Stage 1: 50件をSendGridに移行**
```javascript
// 50件のレコードを選択
UPDATE Customers SET send_channel = 'sendgrid' WHERE ...
```

3. **Stage 2: 追加50件を移行**
```javascript
// 追加50件のレコードを選択
UPDATE Customers SET send_channel = 'sendgrid' WHERE ...
```

### 同一キャンペーンの二重送信防止

```javascript
// 配信前チェック
const haipaiCount = await countCustomers({ send_channel: 'haipai' });
const sendgridCount = await countCustomers({ send_channel: 'sendgrid' });

console.log('配配メール対象:', haipaiCount);
console.log('SendGrid対象:', sendgridCount);

// SendGridで送信する場合、send_channel=sendgrid のみ送信
// これにより、同じ人に両方から送る事故を防止
```

---

## 🔧 Netlify Functions 実装

### 1. send-broadcast.js（修正版）

```javascript
/**
 * 本番送信API（段階移行対応）
 */

// 配信対象を取得（有料会員のみ・厳格チェック）
async function getTargetCustomers(stage) {
  const customers = await customersTable
    .select({
      filterByFormula: `AND(
        {plan_type} = "paid",
        {status} = "active",
        {unsubscribe} != TRUE(),
        {send_channel} = "sendgrid"
      )`,
      maxRecords: stage, // ステージ上限
      sort: [{ field: 'migrated_at', direction: 'asc' }], // 移行日時順
    })
    .all();

  return customers.map(r => r.fields.Email);
}

// ステージ別送信
async function sendByStage(broadcastId, stage) {
  // 1. 先にロック
  await updateBroadcastStatus(broadcastId, 'locked');

  // 2. 対象取得
  const emails = await getTargetCustomers(stage);

  // 3. unique化
  const uniqueEmails = [...new Set(emails)];

  // 4. バッチ送信
  const batchSize = 200;
  const delay = 2000;

  for (let i = 0; i < uniqueEmails.length; i += batchSize) {
    const batch = uniqueEmails.slice(i, i + batchSize);

    for (const email of batch) {
      // 既送信チェック
      const alreadySent = await checkAlreadySent(broadcastId, email);
      if (alreadySent) continue;

      // 送信
      await sendEmail(email, broadcast.subject, broadcast.body_html);

      // ログ記録
      await createRecipient({
        broadcast_id: broadcastId,
        email,
        send_status: 'sent',
        sent_at: new Date().toISOString(),
      });
    }

    await sleep(delay);
  }

  // 5. 完了
  await updateBroadcast(broadcastId, {
    status: 'sent',
    sent_at: new Date().toISOString(),
    recipient_count_sent: uniqueEmails.length,
  });
}
```

### 2. abort-broadcast.js（新規）

```javascript
/**
 * 配信中断API
 */

exports.handler = async (event) => {
  const { broadcast_id, user_email } = JSON.parse(event.body);

  // 管理者権限チェック
  if (!ADMIN_EMAILS.includes(user_email)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  // 配信情報を取得
  const broadcast = await getBroadcast(broadcast_id);

  // sending 状態のみ中断可能
  if (broadcast.status !== 'sending') {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Broadcast not in sending state' }),
    };
  }

  // 中断
  await updateBroadcastStatus(broadcast.id, 'aborted');

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, message: 'Broadcast aborted' }),
  };
};
```

---

## 🎨 管理画面UI設計

### ページ: /admin/newsletter/[id]（修正版）

```html
<div class="detail-card">
  <h2>移行ステージ選択</h2>

  <select id="stage-select">
    <option value="50">Stage 1: 50件</option>
    <option value="100">Stage 2: 100件</option>
    <option value="300">Stage 3: 300件</option>
    <option value="500">Stage 4: 500件</option>
    <option value="1000">Stage 5: 1,000件</option>
    <option value="3000">Stage 6: 3,000件</option>
    <option value="7000">Stage 7: 7,000件</option>
    <option value="15000">Stage 8: 15,000件</option>
  </select>

  <div class="conditions-preview">
    <h4>送信条件</h4>
    <ul>
      <li>✅ 有料会員のみ（plan_type=paid）</li>
      <li>✅ アクティブ会員のみ（status=active）</li>
      <li>✅ 配信停止していない（unsubscribe≠true）</li>
      <li>✅ SendGrid配信対象（send_channel=sendgrid）</li>
    </ul>
  </div>

  <button id="dryrun-btn" class="btn btn-secondary">Dry-Run実行</button>
  <button id="send-btn" class="btn btn-primary">本番送信</button>
  <button id="abort-btn" class="btn btn-danger" style="display:none">中断</button>
</div>
```

---

## 📖 Airtable セットアップ手順

### 1. Customersテーブル作成

**Base:** KEIBA Intelligence

**Fields:**
```
- Email (Email, Primary)
- plan_type (Single select: paid, free)
- status (Single select: active, cancelled, bounced, suppressed)
- source (Single select: haipai, sendgrid, mixed)
- send_channel (Single select: haipai, sendgrid)
- migrated_at (Date)
- last_sent_at (Date)
- unsubscribe (Checkbox)
- tags (Multiple select)
- Name (Single line text)
- Plan (Single line text)
```

### 2. View作成: SendGrid_Paid_Active

**Filter:**
```
AND(
  {plan_type} = "paid",
  {status} = "active",
  {unsubscribe} != TRUE(),
  {send_channel} = "sendgrid"
)
```

**Sort:**
```
migrated_at (ascending)
```

### 3. 初期データインポート

配配メールから15,000件をエクスポートし、Airtableにインポート。

**初期値:**
```csv
Email,plan_type,status,source,send_channel,unsubscribe
user1@example.com,paid,active,haipai,haipai,false
user2@example.com,paid,active,haipai,haipai,false
...
```

**重要:** 最初は全員 `send_channel=haipai` にする。

---

## ✅ 移行チェックリスト

### Stage 1: 50件

- [ ] Airtableに15,000件インポート（send_channel=haipai）
- [ ] SendGrid_Paid_Active View作成
- [ ] 50件を選択し、send_channel を sendgrid に変更
- [ ] 配信作成（draft）
- [ ] Dry-Run実行（50件確認）
- [ ] テスト送信（管理者1件）
- [ ] 本番送信（50件）
- [ ] SendGrid Statsで成功率確認（98%以上）
- [ ] バウンス・苦情確認（ゼロ）
- [ ] 2〜3日待機

### Stage 2: 100件

- [ ] 追加50件を選択し、send_channel を sendgrid に変更
- [ ] 新規配信作成
- [ ] Dry-Run実行（100件確認）
- [ ] 本番送信（100件）
- [ ] 1週間待機・確認

### Stage 3〜8: 繰り返し

---

## 🚨 トラブルシューティング

### Q: 同じ人に配配メールとSendGridから両方届いた

**A: send_channel設定を確認**

```javascript
// 配信前チェック
const customer = await getCustomer(email);
if (customer.send_channel === 'haipai') {
  console.error('Error: This customer is still on haipai');
  return;
}
```

### Q: 無料会員に送信されてしまった

**A: 4条件チェックを確認**

```javascript
// 必ず4条件すべてを満たすか確認
if (
  customer.plan_type !== 'paid' ||
  customer.status !== 'active' ||
  customer.unsubscribe === true ||
  customer.send_channel !== 'sendgrid'
) {
  console.log('Skipped:', customer.email);
  return;
}
```

### Q: ステージ上限を超えて送信された

**A: maxRecords設定を確認**

```javascript
// Airtable select で maxRecords を必ず指定
.select({
  filterByFormula: '...',
  maxRecords: stage, // ✅ 必須
})
```

---

## 📝 特別ルール（有料会員向け）

### 初回SendGrid配信文面テンプレート

```html
<div style="font-family: 'Noto Sans JP', sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background: #fff3cd; border: 1px solid #ffc107; padding: 16px; margin-bottom: 24px; border-radius: 8px;">
    <strong>📢 なぜこのメールが届いたか</strong><br>
    本メールは、KEIBA Intelligence の有料会員としてご登録いただいている方にのみお送りしています。
  </div>

  <h2>【重要】有料会員の皆様へ</h2>

  <p>いつもKEIBA Intelligenceをご利用いただきありがとうございます。</p>

  <p>...</p>

  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">

  <p style="color: #64748b; font-size: 14px;">
    配信停止をご希望の場合は、<a href="https://keiba-intelligence.keiba.link/unsubscribe?email={{email}}">こちら</a>からお手続きください。
  </p>
</div>
```

---

**作成日**: 2026-01-10
**作成者**: Claude Code（クロちゃん）
**協力者**: マコさん

**次のステップ:**
1. Netlify Functions修正（段階移行対応）
2. 管理画面UI修正（ステージ選択）
3. Airtableセットアップ
4. Stage 1: 50件テスト配信
