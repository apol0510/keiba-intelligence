# Airtable スキーマ設計書

## プロジェクト: KEIBA Intelligence

**最終更新日**: 2026-01-12

---

## 📊 テーブル一覧

1. **Customers**（顧客管理）
2. **ProcessedWebhookEvents**（Webhook重複排除）
3. **Broadcasts**（メルマガ配信管理）
4. **BroadcastRecipients**（配信履歴）
5. **AuthTokens**（認証トークン）

---

## 1. Customers（顧客管理）

### **概要**
- PayPal決済完了時に顧客情報を登録・管理
- プラン別アクセス制御の基盤
- メルマガ配信リストとしても機能

### **フィールド定義**

| Field Name | Type | 必須 | 説明 | 例 |
|-----------|------|-----|------|-----|
| Email | Email | ✅ | メールアドレス（一意） | user@example.com |
| 氏名 | Single line text | ❌ | 顧客名 | 山田太郎 |
| プラン | Single select | ✅ | 契約プラン | ライト / スタンダード / プレミアム / アルティメット / AI Plus |
| Status | Single select | ✅ | 顧客ステータス | pending / active / cancelled / suspended |
| PayPalSubscriptionID | Single line text | ❌ | PayPalサブスクID（サブスクのみ） | I-XXXXXXXXX |
| 有効期限 | Date | ❌ | サブスク有効期限（AI Plusは無期限） | 2026-02-12 |
| AccessEnabled | Checkbox | ✅ | アクセス権有効/無効 | true / false |
| PaidAt | Date | ❌ | 最終入金日時（PAYMENT.SALE.COMPLETED） | 2026-01-12T10:00:00Z |
| WelcomeSentAt | Date | ❌ | ウェルカムメール送信日時 | 2026-01-12T10:05:00Z |
| CancelledAt | Date | ❌ | 解約日時 | 2026-02-01T15:00:00Z |
| WithdrawalRequested | Checkbox | ❌ | 退会申請フラグ | true / false |
| WithdrawalDate | Date | ❌ | 退会日 | 2026-02-01 |
| WithdrawalReason | Long text | ❌ | 退会理由 | サービス利用頻度が低かった |
| CreatedAt | Date | ❌ | 登録日時 | 2026-01-12T10:00:00Z |

### **インデックス**
- Primary Key: Email（一意制約）

### **備考**
- **Status値の意味:**
  - `pending`: 仮登録（BILLING.SUBSCRIPTION.CREATED）
  - `active`: 本登録（BILLING.SUBSCRIPTION.ACTIVATED or PAYMENT.SALE.COMPLETED）
  - `cancelled`: 解約済み（BILLING.SUBSCRIPTION.CANCELLED or EXPIRED）
  - `suspended`: 停止中（BILLING.SUBSCRIPTION.SUSPENDED）

- **AccessEnabled判定:**
  - `Status = active` かつ `AccessEnabled = true` → 有料コンテンツアクセス可能
  - それ以外 → アクセス不可

---

## 2. ProcessedWebhookEvents（Webhook重複排除）

### **概要**
- PayPal Webhookの重複処理防止（冪等性保証）
- event_idベースで処理済みイベントを記録

### **フィールド定義**

| Field Name | Type | 必須 | 説明 | 例 |
|-----------|------|-----|------|-----|
| EventId | Single line text | ✅ | PayPal event_id（一意） | WH-XXXXXXXXXXXXXXXXXXXXXXXX |
| EventType | Single select | ✅ | イベントタイプ | BILLING.SUBSCRIPTION.ACTIVATED |
| ProcessedAt | Date | ✅ | 処理開始日時 | 2026-01-12T10:00:00Z |
| Status | Single select | ✅ | 処理ステータス | processing / completed / ignored / failed |
| CustomerEmail | Email | ❌ | 関連する顧客メール | user@example.com |
| UserPlan | Single line text | ❌ | 関連するプラン | スタンダード |

### **インデックス**
- Primary Key: EventId（一意制約）

### **備考**
- **Status値の意味:**
  - `processing`: 処理中（並行リクエスト防止）
  - `completed`: 処理完了
  - `ignored`: 処理対象外イベント
  - `failed`: 処理失敗

- **使用方法:**
  1. Webhook受信時に即座にEventIdで検索
  2. 既存レコードがあれば`200 OK`で即座に返却（重複排除）
  3. 新規イベントなら`Status=processing`で記録→処理開始

---

## 3. Broadcasts（メルマガ配信管理）

### **概要**
- メルマガ配信の管理（下書き→テスト→本配信）
- 二重送信防止機構の核

### **フィールド定義**

| Field Name | Type | 必須 | 説明 | 例 |
|-----------|------|-----|------|-----|
| BroadcastId | Single line text | ✅ | 配信ID（UUID） | broadcast_20260112_abc123 |
| Subject | Single line text | ✅ | メール件名 | 【KEIBA Intelligence】本日の予想配信 |
| BodyHtml | Long text | ✅ | メール本文（HTML） | <html>...</html> |
| Status | Single select | ✅ | 配信ステータス | draft / test / dry-run / confirm / sending / sent / failed |
| Stage | Number | ✅ | 段階的送信ステージ | 0（未送信）/ 1（50件）/ 2（100件）... |
| RecipientCount | Number | ❌ | 配信対象件数 | 15000 |
| SentCount | Number | ❌ | 送信完了件数 | 50 |
| FailedCount | Number | ❌ | 送信失敗件数 | 0 |
| CreatedAt | Date | ✅ | 作成日時 | 2026-01-12T09:00:00Z |
| SentAt | Date | ❌ | 本配信完了日時 | 2026-01-12T10:00:00Z |
| CreatedBy | Single line text | ❌ | 作成者 | admin@keiba-intelligence.keiba.link |

### **インデックス**
- Primary Key: BroadcastId（一意制約）

### **備考**
- **Status遷移:**
  ```
  draft → test → dry-run → confirm → sending → sent
                                              ↓
                                            failed
  ```

- **段階的送信（Stage）:**
  - Stage 0: 未送信
  - Stage 1: 50件送信
  - Stage 2: 100件送信
  - Stage 3: 300件送信
  - ...
  - Stage 8: 15,000件送信完了

---

## 4. BroadcastRecipients（配信履歴）

### **概要**
- メルマガ配信の宛先ごとの送信結果記録
- 二重送信防止・トラブルシューティング

### **フィールド定義**

| Field Name | Type | 必須 | 説明 | 例 |
|-----------|------|-----|------|-----|
| BroadcastId | Single line text | ✅ | 配信ID（Broadcastsテーブルとリンク） | broadcast_20260112_abc123 |
| Email | Email | ✅ | 宛先メールアドレス | user@example.com |
| Status | Single select | ✅ | 送信ステータス | pending / sent / failed |
| SentAt | Date | ❌ | 送信完了日時 | 2026-01-12T10:00:00Z |
| ErrorMessage | Long text | ❌ | エラーメッセージ（失敗時） | SMTP Error: 550 ... |
| SendGridMessageId | Single line text | ❌ | SendGridメッセージID | <abc123@sendgrid.net> |

### **インデックス**
- Composite Key: (BroadcastId, Email)

### **備考**
- **Status値の意味:**
  - `pending`: 送信待ち
  - `sent`: 送信完了
  - `failed`: 送信失敗

- **使用方法:**
  1. 配信前に`BroadcastId`でフィルタ
  2. 既存レコードがある場合はスキップ（二重送信防止）
  3. 送信成功後に`Status=sent`で記録

---

## 5. AuthTokens（認証トークン）

### **概要**
- マジックリンク認証のトークン管理
- 15分有効期限・単回使用

### **フィールド定義**

| Field Name | Type | 必須 | 説明 | 例 |
|-----------|------|-----|------|-----|
| Token | Single line text | ✅ | 認証トークン（UUID） | 1234567890abcdef... |
| Email | Email | ✅ | 認証対象メールアドレス | user@example.com |
| CreatedAt | Date | ✅ | 作成日時 | 2026-01-12T10:00:00Z |
| ExpiresAt | Date | ✅ | 有効期限（15分後） | 2026-01-12T10:15:00Z |
| Used | Checkbox | ✅ | 使用済みフラグ | true / false |
| UsedAt | Date | ❌ | 使用日時 | 2026-01-12T10:05:00Z |
| IpAddress | Single line text | ❌ | リクエスト元IPアドレス | 203.0.113.1 |

### **インデックス**
- Primary Key: Token（一意制約）

### **備考**
- **トークン検証条件:**
  1. `Token`が存在する
  2. `ExpiresAt > 現在時刻`（15分以内）
  3. `Used = false`（未使用）

- **トークン使用後:**
  1. `Used = true`に更新
  2. `UsedAt`に現在時刻を記録
  3. Netlify Blobsにセッション作成（7日間TTL）

---

## 📋 Airtable View設計

### **Customers テーブル**

#### **SendGrid_Paid_Active View**
- **用途**: メルマガ配信対象者の抽出
- **フィルタ条件**:
  ```
  AND(
    {Status} = "active",
    {AccessEnabled} = true,
    {WithdrawalRequested} = false
  )
  ```

#### **Cancelled View**
- **用途**: 解約者の管理
- **フィルタ条件**:
  ```
  OR(
    {Status} = "cancelled",
    {Status} = "suspended"
  )
  ```

### **ProcessedWebhookEvents テーブル**

#### **Recent Events View**
- **用途**: 最近のWebhookイベント確認
- **ソート**: ProcessedAt（降順）
- **制限**: 最新100件

---

## 🔧 セットアップ手順

### **1. Airtable Base作成**
1. Airtableログイン: https://airtable.com/
2. 新規Base作成: "KEIBA Intelligence"
3. 5つのテーブルを作成（Customers, ProcessedWebhookEvents, Broadcasts, BroadcastRecipients, AuthTokens）

### **2. フィールド設定**
各テーブルのフィールドを上記定義に従って作成

### **3. View作成**
- Customersテーブル: SendGrid_Paid_Active View作成
- ProcessedWebhookEventsテーブル: Recent Events View作成

### **4. API Key取得**
1. Airtable右上アカウントアイコン → Account
2. "API" タブ → "Generate API key"
3. 環境変数`AIRTABLE_API_KEY`に設定

### **5. Base ID取得**
1. Airtable API: https://airtable.com/api
2. 作成したBase選択 → Base IDをコピー（`appXXXXXXXXXXXXXXX`）
3. 環境変数`AIRTABLE_BASE_ID`に設定

---

## ✅ 動作確認

### **Customers登録テスト**
```javascript
// netlify/functions/paypal-webhook.js で自動テスト
// PayPal Sandbox環境でBILLING.SUBSCRIPTION.ACTIVATEDイベント送信
```

### **重複排除テスト**
```javascript
// 同じevent_idでWebhookを2回送信
// 2回目は「Duplicate event ignored」で即座に返却されることを確認
```

### **メルマガ配信テスト**
```javascript
// /admin/newsletter/new で下書き作成
// test → dry-run → confirm → send の流れを確認
```

---

**作成者: Claude Code（クロちゃん）**
**協力者: マコさん**
