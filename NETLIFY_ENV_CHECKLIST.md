# Netlify環境変数チェックリスト

## 📋 必須環境変数一覧

無料会員登録システムが正常に動作するために必要な環境変数のチェックリストです。

---

## ✅ チェック方法

1. Netlify管理画面にログイン: https://app.netlify.com/
2. サイトを選択: keiba-intelligence
3. Site settings → Environment variables を開く
4. 以下の環境変数がすべて設定されているか確認

---

## 🔑 必須環境変数（優先度順）

### 【最優先】無料登録システム用

| 環境変数名 | 用途 | 設定必須 | 確認方法 |
|-----------|------|---------|---------|
| **SENDGRID_API_KEY** | マジックリンクメール送信 | ✅ 必須 | SendGrid管理画面で作成 |
| **SENDGRID_FROM_EMAIL** | メール送信元アドレス | ✅ 必須 | support@keiba-intelligence.jp |
| **AIRTABLE_API_KEY** | 顧客情報保存 | ✅ 必須 | Airtable管理画面で作成 |
| **AIRTABLE_BASE_ID** | Airtableベース識別 | ✅ 必須 | Airtable URLから取得 |

### 【推奨】メルマガ自動登録用

| 環境変数名 | 用途 | 設定必須 | 確認方法 |
|-----------|------|---------|---------|
| **SENDGRID_CUSTOM_FIELD_INTELLIGENCE** | SendGrid Marketing Campaignsカスタムフィールド | ⚠️ 推奨 | SendGrid管理画面（Custom Fields） |

**注意**: SendGrid Marketing Campaigns未設定でも無料登録は可能（警告のみ、メール送信は継続）

### 【既存システム用】

| 環境変数名 | 用途 | 設定必須 |
|-----------|------|---------|
| **GEMINI_API_KEY** | AIチャットボット | ✅ 必須 |
| **GITHUB_TOKEN** | 自動デプロイ | ⚠️ 推奨 |
| **ALERT_EMAIL** | アラートメール送信先 | ✅ 必須 |
| **ADMIN_EMAIL** | 管理者メール | ⚠️ 推奨 |

---

## 🔍 個別確認手順

### 1. SendGrid設定確認

```bash
# 必要な設定:
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SENDGRID_FROM_EMAIL=support@keiba-intelligence.jp

# 確認:
# - SendGrid管理画面でVerified Senderに登録済みか
# - APIキーが有効か（Create時に Full Access 選択）
```

**Verified Sender設定**:
1. SendGrid → Settings → Sender Authentication
2. Single Sender Verification → Verify a Single Sender
3. `support@keiba-intelligence.jp` を登録
4. 確認メールのリンクをクリック

### 2. Airtable設定確認

```bash
# 必要な設定:
AIRTABLE_API_KEY=patxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AIRTABLE_BASE_ID=appxxxxxxxxxxxxxxx

# 確認:
# - AirtableでCustomersテーブルが存在するか
# - 以下のフィールドが存在するか:
#   - Email (Single line text)
#   - PlanType (Single select: free-registered, pro, etc.)
#   - Status (Single select: pending, active, etc.)
#   - AccessEnabled (Checkbox)
#   - CreatedAt (Date)
#   - Source (Single line text)
```

**Customersテーブル作成**:
1. Airtable Base を開く
2. 新しいテーブル「Customers」を作成
3. 以下のフィールドを追加:
   - Email: Single line text
   - PlanType: Single select (options: free-registered, pro, pro-plus)
   - Status: Single select (options: pending, active, cancelled)
   - AccessEnabled: Checkbox
   - CreatedAt: Date
   - Source: Single line text

### 3. SendGrid Marketing Campaigns設定確認

```bash
# 必要な設定:
SENDGRID_CUSTOM_FIELD_INTELLIGENCE=e2_T  # カスタムフィールドID

# 確認:
# - SendGrid管理画面 → Marketing → Contacts → Custom Fields
# - 「registered_intelligence」フィールドが作成済みか
# - フィールドIDを環境変数に設定
```

---

## 🧪 動作テスト手順

### ステップ1: ローカル開発環境でテスト

```bash
# 1. 環境変数ファイル作成（astro-site/.env）
cd /Users/apolon/Projects/keiba-intelligence/astro-site
cat > .env << 'ENVEOF'
SENDGRID_API_KEY=SG.xxxxx（実際のキー）
SENDGRID_FROM_EMAIL=support@keiba-intelligence.jp
AIRTABLE_API_KEY=patxxxxx（実際のキー）
AIRTABLE_BASE_ID=appxxxxx（実際のID）
SENDGRID_CUSTOM_FIELD_INTELLIGENCE=e2_T（実際のカスタムフィールドID）
ENVEOF

# 2. Netlify Dev起動
netlify dev

# 3. ブラウザで開く
# http://localhost:8888/register
```

### ステップ2: テスト登録

1. ブラウザで http://localhost:8888/register を開く
2. テスト用メールアドレスを入力（例: test@example.com）
3. 「無料で登録する」ボタンをクリック
4. 成功メッセージが表示されることを確認

### ステップ3: 各システムで確認

**Airtable**:
- Customersテーブルに新しいレコードが追加されているか
- PlanType: free-registered
- Status: pending
- Source: keiba-intelligence

**SendGrid**:
- Activity Feed でメール送信履歴を確認
- Delivered 状態になっているか

**SendGrid Marketing Campaigns**:
- Contacts一覧に新しい登録が追加されているか
- カスタムフィールド `registered_intelligence` が `true` になっているか

**メール受信**:
- テスト用メールアドレスにマジックリンクメールが届いているか
- メール本文が正しく表示されているか
- マジックリンクをクリックして認証できるか

---

## ⚠️ トラブルシューティング

### エラー: "SENDGRID_API_KEY is not defined"

**原因**: 環境変数が設定されていない

**解決策**:
1. Netlify管理画面で環境変数を確認
2. 変数名にスペルミスがないか確認
3. Netlifyサイトを再デプロイ（環境変数変更後は再デプロイ必要）

### エラー: "Airtable error: 404"

**原因**: テーブル名またはベースIDが間違っている

**解決策**:
1. Airtable URLからベースIDを再確認（`app` で始まる文字列）
2. テーブル名が "Customers" であることを確認（大文字小文字区別）

### エラー: "SendGrid Marketing Campaigns error"

**原因**: カスタムフィールドIDが間違っている、またはAPI認証失敗

**解決策**:
1. SendGrid管理画面 → Marketing → Contacts → Custom Fields でカスタムフィールドIDを確認
2. `SENDGRID_CUSTOM_FIELD_INTELLIGENCE` 環境変数が正しく設定されているか確認
3. **注意**: SendGrid Marketing Campaigns失敗しても登録は継続される（警告のみ）

---

## 📝 次のステップ

1. ✅ このチェックリストで全環境変数を確認
2. ✅ SendGrid Marketing Campaignsカスタムフィールド作成
3. ✅ ローカル開発環境でテスト登録
4. ✅ 各システムでデータ反映を確認
5. ✅ 本番環境でテスト登録
6. ✅ 問題なければ正式リリース

---

## 📅 作成日: 2026-02-24
## 👤 作成者: Claude Code（クロちゃん）
