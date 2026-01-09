# メルマガ配信システム設計書

**KEIBA Intelligence - 二重送信防止メルマガ配信システム**

---

## 🎯 最重要要件

**同一メールアドレスへの二重送信が構造的に不可能であること**

過去の事故（同一アドレスへ数十件送信）を絶対に再発させない設計。

---

## 📊 データ設計（Airtable）

### テーブル1: Broadcasts（配信管理）

| フィールド名 | 型 | 説明 | 必須 |
|------------|----|----|------|
| broadcast_id | Single line text (UUID) | 配信ID（主キー） | ✅ |
| subject | Single line text | 件名 | ✅ |
| body_html | Long text | HTML本文 | ✅ |
| status | Single select | draft / dry-run / sent | ✅ |
| created_at | Date | 作成日時 | ✅ |
| sent_at | Date | 送信日時 | ❌ |
| recipient_count | Number | 送信先件数 | ❌ |
| hash | Single line text | SHA256(subject + body) | ✅ |
| created_by | Single line text | 作成者メールアドレス | ✅ |

**status の状態遷移:**
```
draft → dry-run → sent
  ↓        ↓
  ×        ×  (後退不可)
```

**重要:** `status = sent` になった配信は、**二度と送信処理を実行できない**

---

### テーブル2: BroadcastRecipients（配信ログ）

| フィールド名 | 型 | 説明 | 必須 |
|------------|----|----|------|
| id | Auto number | レコードID | ✅ |
| broadcast_id | Single line text (UUID) | 配信ID | ✅ |
| email | Email | 送信先メールアドレス | ✅ |
| send_status | Single select | pending / sent / failed | ✅ |
| sent_at | Date | 送信日時 | ❌ |
| error_message | Long text | エラーメッセージ | ❌ |
| is_test | Checkbox | テスト送信フラグ | ✅ |

**ユニーク制約（論理）:**
```
(broadcast_id, email) は必ずユニーク
```

**実装方法:**
- 送信前に `filterByFormula` でチェック
- 既存レコードがあれば送信スキップ

---

## 🔒 二重送信防止メカニズム

### レイヤー1: UI制御

```javascript
// 送信ボタンは status が draft の場合のみ有効
if (broadcast.status === 'sent') {
  return <button disabled>送信済み（再送不可）</button>;
}
```

### レイヤー2: API先行ロック

```javascript
// 送信API呼び出し時、即座に status を sent に更新
async function sendBroadcast(broadcastId) {
  // 1. 先にロック（status を sent に更新）
  await lockBroadcast(broadcastId);

  // 2. 送信処理（失敗しても status は sent のまま）
  await doSend(broadcastId);
}
```

**重要:** 送信処理の前に `status = sent` にすることで、
同時リクエストや再実行を構造的に防止。

### レイヤー3: メールアドレス重複チェック

```javascript
// 送信前に必ず BroadcastRecipients をチェック
const existingRecords = await base('BroadcastRecipients')
  .select({
    filterByFormula: `AND(
      {broadcast_id} = "${broadcastId}",
      {email} = "${email}"
    )`
  })
  .firstPage();

if (existingRecords.length > 0) {
  console.log('Already sent to:', email);
  return; // 送信スキップ
}
```

### レイヤー4: 配信ID再実行チェック

```javascript
// API開始時に必ず status をチェック
const broadcast = await getBroadcast(broadcastId);

if (broadcast.status === 'sent') {
  return {
    statusCode: 400,
    body: JSON.stringify({ error: 'Broadcast already sent' }),
  };
}
```

---

## 🚀 送信フロー（5ステップ）

### ステップ1: 配信作成（draft）

**管理画面:** `/admin/newsletter/new`

```javascript
// POST /.netlify/functions/create-broadcast
{
  "subject": "【KEIBA Intelligence】本日の予想配信",
  "body_html": "<h1>本日の予想</h1>...",
  "created_by": "admin@keiba-intelligence.keiba.link"
}

// Response:
{
  "broadcast_id": "uuid-v4",
  "status": "draft"
}
```

**Broadcasts テーブルに挿入:**
- status: draft
- hash: SHA256(subject + body_html)
- **送信処理は一切走らない**

---

### ステップ2: テスト送信

**管理画面:** `/admin/newsletter/{id}` → 「テスト送信」ボタン

```javascript
// POST /.netlify/functions/send-test
{
  "broadcast_id": "uuid-v4",
  "test_email": "admin@keiba-intelligence.keiba.link"
}
```

**処理:**
1. Broadcasts から配信内容を取得
2. SendGrid API で `test_email` に1件のみ送信
3. BroadcastRecipients に記録（`is_test = true`）
4. **Broadcasts の status は変更しない**

**重要:** テスト送信は本番配信と完全に分離。

---

### ステップ3: Dry-Run（送信シミュレーション）

**管理画面:** `/admin/newsletter/{id}` → 「Dry-Run実行」ボタン

```javascript
// POST /.netlify/functions/send-broadcast
{
  "broadcast_id": "uuid-v4",
  "dry_run": true
}

// Response:
{
  "dry_run": true,
  "recipient_count": 123,
  "unique_emails": 123,
  "estimated_cost": "$0.12"
}
```

**処理:**
1. Customers テーブルから送信対象を取得（Status = active）
2. メールアドレスを `Set` で unique 化
3. 送信件数のみ算出
4. **実際には送信しない**
5. Broadcasts の `status` を `dry-run` に更新

---

### ステップ4: 本番送信（最終確認）

**管理画面:** `/admin/newsletter/{id}` → 「本番送信」ボタン

```javascript
// 確認ダイアログ表示:
「以下の内容で送信します。よろしいですか？

件名: 【KEIBA Intelligence】本日の予想配信
送信先件数: 123件
送信後は取り消しできません。

[ キャンセル ] [ 送信実行 ]」
```

**「送信実行」クリック時:**

```javascript
// POST /.netlify/functions/send-broadcast
{
  "broadcast_id": "uuid-v4",
  "dry_run": false,
  "confirm": true
}
```

---

### ステップ5: 送信実行（二重送信防止）

**Netlify Function: `send-broadcast.js`**

```javascript
exports.handler = async (event) => {
  const { broadcast_id, dry_run, confirm } = JSON.parse(event.body);

  // 1. 配信情報を取得
  const broadcast = await getBroadcast(broadcast_id);

  // 2. 【重要】status が sent ならエラー
  if (broadcast.status === 'sent') {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Broadcast already sent' }),
    };
  }

  // 3. 送信対象を取得（Status = active）
  const customers = await getActiveCustomers();
  const uniqueEmails = [...new Set(customers.map(c => c.email))];

  // 4. Dry-Run モード
  if (dry_run) {
    await updateBroadcastStatus(broadcast_id, 'dry-run');
    return {
      statusCode: 200,
      body: JSON.stringify({
        dry_run: true,
        recipient_count: uniqueEmails.length,
      }),
    };
  }

  // 5. 【最重要】先に status を sent に更新（ロック）
  await updateBroadcastStatus(broadcast_id, 'sent');

  // 6. 送信処理（順次送信）
  const results = [];
  for (const email of uniqueEmails) {
    // 既に送信済みかチェック
    const alreadySent = await checkAlreadySent(broadcast_id, email);
    if (alreadySent) {
      console.log('Already sent to:', email);
      continue; // スキップ
    }

    try {
      // SendGrid送信
      await sendEmail(email, broadcast.subject, broadcast.body_html);

      // BroadcastRecipients に記録
      await createRecipient({
        broadcast_id,
        email,
        send_status: 'sent',
        sent_at: new Date().toISOString(),
      });

      results.push({ email, status: 'sent' });
    } catch (error) {
      // エラーログ記録
      await createRecipient({
        broadcast_id,
        email,
        send_status: 'failed',
        error_message: error.message,
      });

      results.push({ email, status: 'failed', error: error.message });
    }
  }

  // 7. 送信件数を更新
  await updateBroadcast(broadcast_id, {
    sent_at: new Date().toISOString(),
    recipient_count: results.filter(r => r.status === 'sent').length,
  });

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      results,
    }),
  };
};
```

**重要ポイント:**
1. `status = sent` に更新してから送信処理開始
2. 同一 `broadcast_id` で関数が再実行されても、`status = sent` なので即エラー
3. メールアドレス重複チェックで二重送信防止
4. 送信ログは必ず BroadcastRecipients に記録

---

## 🚫 絶対にやってはいけないこと

### ❌ NG例1: UIから直接SendGrid API呼び出し

```javascript
// ❌ 絶対にダメ
async function handleSendClick() {
  for (const email of emails) {
    await sendEmail(email); // 直接送信
  }
}
```

**理由:** UI側で制御不能。二重クリックで二重送信。

### ❌ NG例2: status更新を送信後に行う

```javascript
// ❌ 絶対にダメ
await sendEmails(); // 送信処理
await updateStatus('sent'); // 後からロック
```

**理由:** 送信中に再実行されると二重送信。

### ❌ NG例3: メールアドレス重複チェックなし

```javascript
// ❌ 絶対にダメ
for (const customer of customers) {
  await sendEmail(customer.email); // 重複チェックなし
}
```

**理由:** 同一メールアドレスが複数存在した場合に多重送信。

### ❌ NG例4: 配信ログを残さない

```javascript
// ❌ 絶対にダメ
await sendEmail(email);
// ログ記録なし
```

**理由:** 送信済みかどうかを判定できず、再送信される。

---

## 🛡️ 安全装置（必須実装）

### 1. 最終確認ダイアログ

```javascript
const confirmed = window.confirm(
  `以下の内容で送信します。よろしいですか？\n\n` +
  `件名: ${broadcast.subject}\n` +
  `送信先件数: ${recipientCount}件\n\n` +
  `送信後は取り消しできません。`
);

if (!confirmed) {
  return;
}
```

### 2. 管理者権限チェック

```javascript
// Netlify Function 内で必ず確認
const adminEmails = [
  'admin@keiba-intelligence.keiba.link',
  'mako@example.com',
];

const userEmail = event.headers['x-user-email'];

if (!adminEmails.includes(userEmail)) {
  return {
    statusCode: 403,
    body: JSON.stringify({ error: 'Forbidden' }),
  };
}
```

### 3. SendGrid送信レート制限

```javascript
// 1秒あたり最大10件に制限
async function sendEmails(emails, broadcast) {
  for (let i = 0; i < emails.length; i++) {
    await sendEmail(emails[i], broadcast);

    // 10件ごとに1秒待機
    if ((i + 1) % 10 === 0) {
      await sleep(1000);
    }
  }
}
```

**理由:** SendGridのレート制限回避 + 負荷分散

---

## 📁 ファイル構成

```
astro-site/
├── netlify/functions/
│   ├── create-broadcast.js      # 配信作成
│   ├── get-broadcasts.js        # 配信一覧取得
│   ├── get-broadcast.js         # 配信詳細取得
│   ├── send-test.js             # テスト送信
│   └── send-broadcast.js        # 本番送信（二重送信防止）
│
└── src/pages/admin/newsletter/
    ├── index.astro              # 配信一覧
    ├── new.astro                # 新規作成
    └── [id].astro               # 詳細・送信

```

---

## 🎨 管理画面UI設計

### ページ1: 配信一覧（/admin/newsletter）

```
+------------------------------------------+
| メルマガ配信管理                          |
+------------------------------------------+
| [ + 新規配信作成 ]                        |
+------------------------------------------+
| 件名                | 状態    | 送信日時  |
+------------------------------------------+
| 本日の予想配信       | 送信済み | 2026-01-10 |
| 週末レース情報       | draft   | -         |
| 新規登録者向けメール  | dry-run | -         |
+------------------------------------------+
```

**表示項目:**
- broadcast_id
- subject
- status（バッジで色分け: draft=灰, dry-run=黄, sent=緑）
- recipient_count
- sent_at
- 詳細リンク

---

### ページ2: 新規作成（/admin/newsletter/new）

```
+------------------------------------------+
| 新規配信作成                              |
+------------------------------------------+
| 件名:                                     |
| [_____________________________________] |
|                                          |
| 本文（HTML）:                             |
| +--------------------------------------+ |
| | <h1>本日の予想</h1>                   | |
| | <p>...</p>                            | |
| +--------------------------------------+ |
|                                          |
| [ キャンセル ]  [ 下書き保存 ]            |
+------------------------------------------+
```

**機能:**
- 件名入力（必須）
- HTML本文入力（リッチテキストエディタ or テキストエリア）
- プレビュー機能
- 下書き保存（status = draft で保存）

---

### ページ3: 詳細・送信（/admin/newsletter/[id]）

```
+------------------------------------------+
| 配信詳細                                  |
+------------------------------------------+
| 状態: [ draft ]                          |
|                                          |
| 件名: 【KEIBA Intelligence】本日の予想配信 |
| 作成日時: 2026-01-10 12:00:00           |
| 送信日時: -                              |
| 送信件数: -                              |
|                                          |
+------------------------------------------+
| 本文プレビュー:                           |
| +--------------------------------------+ |
| | 本日の予想                            | |
| | ...                                   | |
| +--------------------------------------+ |
|                                          |
+------------------------------------------+
| [ テスト送信 ]  [ Dry-Run実行 ]          |
|                                          |
| [ 本番送信 ] ← status=draft の場合のみ   |
+------------------------------------------+
```

**status別の表示:**

**draft:**
- テスト送信ボタン: 有効
- Dry-Run実行ボタン: 有効
- 本番送信ボタン: 有効

**dry-run:**
- 送信予定件数を表示
- 本番送信ボタン: 有効

**sent:**
- 送信済み表示（緑バッジ）
- 送信日時・送信件数表示
- すべてのボタン: 無効
- 「送信済み・再送不可」警告表示

---

## 📧 メール送信例

### 件名:
```
【KEIBA Intelligence】本日の予想配信
```

### 本文（HTML）:
```html
<div style="font-family: 'Noto Sans JP', sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #3b82f6;">【本日の予想】大井競馬場</h2>

  <p>KEIBA Intelligence会員の皆様</p>

  <p>本日の予想を公開しました。</p>

  <a href="https://keiba-intelligence.keiba.link/predictions/20260110"
     style="display: inline-block; background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
            color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600;">
    予想を見る
  </a>

  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">

  <p style="color: #64748b; font-size: 14px;">
    メール配信停止をご希望の場合は、<a href="https://keiba-intelligence.keiba.link/unsubscribe">こちら</a>からお手続きください。
  </p>
</div>
```

---

## 🔧 環境変数

```bash
# Netlify → Site settings → Environment variables

SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AIRTABLE_API_KEY=patxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AIRTABLE_BASE_ID=appxxxxxxxxxxxxxxx
ADMIN_EMAILS=admin@keiba-intelligence.keiba.link,mako@example.com
```

---

## 📊 運用フロー例

### 毎日の予想配信

1. 管理画面で新規配信作成
   - 件名: 【KEIBA Intelligence】本日の予想配信
   - 本文: 予想へのリンク
   - 下書き保存

2. テスト送信で確認
   - 管理者メールアドレスに送信
   - 内容確認・リンクチェック

3. Dry-Run実行
   - 送信件数確認（例: 123件）

4. 本番送信
   - 最終確認ダイアログで確認
   - 送信実行

5. 送信完了確認
   - status が sent になっているか確認
   - recipient_count が正しいか確認

---

## 🚨 トラブルシューティング

### Q: 「Broadcast already sent」エラーが出る

**A: 既に送信済みです。再送信できません。**

- status を確認（sent になっているはず）
- 新しい配信を作成してください

### Q: 一部のメールアドレスに送信失敗した

**A: BroadcastRecipients で send_status = failed のレコードを確認**

```javascript
// Airtable で確認
filterByFormula: `AND(
  {broadcast_id} = "${broadcast_id}",
  {send_status} = "failed"
)`
```

- error_message を確認
- SendGridのエラーログを確認
- 必要に応じて手動で再送（個別対応）

### Q: 送信が途中で止まった

**A: Netlify Functions のタイムアウト（26秒）に注意**

- 大量送信の場合は、バッチ処理に分割
- 送信済みは BroadcastRecipients に記録されているので、未送信分のみ再送可能

**対策:**
```javascript
// 未送信アドレスのみ取得
const sentEmails = await getSentEmails(broadcast_id);
const remainingEmails = allEmails.filter(e => !sentEmails.includes(e));
```

---

## ✅ 完了チェックリスト

### Airtable設定
- [ ] Broadcasts テーブル作成
- [ ] BroadcastRecipients テーブル作成
- [ ] ビュー作成（Active Broadcasts, Sent Broadcasts）

### Netlify Functions実装
- [ ] create-broadcast.js（配信作成）
- [ ] get-broadcasts.js（配信一覧取得）
- [ ] get-broadcast.js（配信詳細取得）
- [ ] send-test.js（テスト送信）
- [ ] send-broadcast.js（本番送信・二重送信防止）

### 管理画面UI実装
- [ ] /admin/newsletter（配信一覧）
- [ ] /admin/newsletter/new（新規作成）
- [ ] /admin/newsletter/[id]（詳細・送信）

### テスト
- [ ] 配信作成テスト
- [ ] テスト送信テスト
- [ ] Dry-Runテスト
- [ ] 本番送信テスト
- [ ] 二重送信防止テスト（同じbroadcast_idで2回実行）

### 本番運用
- [ ] 環境変数設定
- [ ] 管理者権限設定
- [ ] SendGridドメイン認証
- [ ] 運用マニュアル作成

---

**作成日**: 2026-01-10
**作成者**: Claude Code（クロちゃん）
**協力者**: マコさん

**次のステップ:**
1. Netlify Functions 5個を実装
2. 管理画面UI 3ページを実装
3. テスト実行・本番運用開始
