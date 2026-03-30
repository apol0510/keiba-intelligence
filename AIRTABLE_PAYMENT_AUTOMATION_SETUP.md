# Airtable 入金確認メール自動送信 セットアップガイド

## 📅 作成日: 2026-03-30

## 🎯 目的

**Statusを"pending" → "active"に変更したら、自動的に入金確認メールを送信する**

nankan-analyticsと同じ仕組みだが、**keiba-intelligence専用のBase**に設定する。

---

## ⚠️ nankan-analytics との違い

| 項目 | nankan-analytics | keiba-intelligence |
|------|-----------------|-------------------|
| **Airtable Base** | 別Base | 別Base |
| **トリガー条件** | 2条件 | **3条件**（下記参照） |
| **3つ目の条件** | なし | `PaymentMethod = Bank Transfer` |
| **理由** | 無料会員の仕組みが違う | 無料会員（free-registered）もactiveにするので、PaymentMethodで区別が必要 |
| **Webhook URL** | `nankan-analytics.keiba.link/...` | `keiba-intelligence.netlify.app/...` |
| **顧客名フィールド** | `氏名` | `Name` |
| **プラン名フィールド** | `プラン` | `Plan` |
| **会場アクセス** | なし | `VenueAccess`（all/nankan/jra） |

---

## 📊 動作フロー

```
1. 顧客が銀行振込申請フォームを送信
   ↓
2. bank-transfer-application.js が実行
   - Airtableに登録（Status="pending", PaymentMethod="Bank Transfer", PaymentEmailSent=false）
   ↓
3. マコさんが銀行口座で入金確認
   ↓
4. AirtableでStatus を "pending" → "active" に変更
   ↓
5. ✅ Airtable Automation が自動検知（Trigger発火）
   ※ 3条件一致: Status=active, PaymentEmailSent≠true, PaymentMethod=Bank Transfer
   ↓
6. Webhook → send-payment-confirmation-auto.js
   - メール送信（プラン情報・会場情報・ログインボタン付き）
   - PaymentEmailSent = true に更新
   - 有効期限を自動計算・設定
   ↓
7. ✅ 顧客にログイン情報メール自動送信完了
```

**無料会員の場合（誤発火しない）:**
```
register-free.js → PaymentMethod未設定 → Automationの条件に一致しない → 発火しない ✅
```

---

## 前提条件

- Netlifyにデプロイ済み（`send-payment-confirmation-auto.js` が含まれるビルド）
- 環境変数が設定済み: `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `ADMIN_EMAIL`

---

## 🔧 Airtable Automation 設定手順

### Step 1: Customersテーブルに必要なフィールドを確認

以下のフィールドが必要です（銀行振込申請時にコードで自動作成されるものもあります）:

| フィールド | タイプ | 必須 | 説明 |
|-----------|--------|------|------|
| Email | Email | ✅ | 顧客メールアドレス |
| Name | Single line text | ✅ | 顧客名 |
| Plan | Single select | ✅ | プラン名（light, pro） |
| PlanType | Single select | ✅ | セッション用プランタイプ。値: `free-registered`（無料会員）, `light`（ライト）, `pro`（プロ） |
| plan_type | Single select | ✅ | 詳細プランタイプ（有料のみ）。値: `lifetime`, `yearly`, `light`, `monthly-nankan`, `monthly-jra` |
| VenueAccess | Single select | ✅ | 会場アクセス（all, nankan, jra） |
| Status | Single select | ✅ | ステータス（pending, active） |
| PaymentEmailSent | Checkbox | ✅ | メール送信済みフラグ |
| PaymentMethod | Single line text | ✅ | 支払い方法（Bank Transfer） |
| ExpirationDate | Date | - | 有効期限（自動設定される） |
| 有効期限 | Date | - | 有効期限（日本語フィールド、自動設定） |
| AccessEnabled | Checkbox | - | アクセス有効フラグ（自動設定） |

### Step 2: Airtable Automation を作成

1. **keiba-intelligence の** Airtable Base を開く
2. 上部メニューから **「Automations」** をクリック
3. **「Create automation」** をクリック
4. 名前を入力: `入金確認メール自動送信（KEIBA Intelligence）`

### Step 3: トリガーを設定

1. **Trigger type**: 「When record matches conditions」を選択
2. **Table**: `Customers` を選択
3. **Conditions（3つ設定）**:

   | # | フィールド | 条件 | 値 |
   |---|-----------|------|-----|
   | 1 | `Status` | is | `active` |
   | 2 | `PaymentEmailSent` | is not checked | （チェックなし） |
   | 3 | `PaymentMethod` | is | `Bank Transfer` |

   > ⚠️ **nankan-analyticsは2条件だが、keiba-intelligenceは3条件！**
   > 3つ目の `PaymentMethod = Bank Transfer` がないと、無料会員（free-registered）のactive化でも入金確認メールが飛んでしまう。
   > nankan-analyticsでは無料会員登録時にPaymentMethodが設定されないので2条件で済むが、念のため同じ3条件にしても問題ない。

### Step 4: アクションを設定

1. **Action type**: 「Send webhook request」を選択

   | 項目 | 値 |
   |------|-----|
   | **URL** | `https://keiba-intelligence.netlify.app/.netlify/functions/send-payment-confirmation-auto` |
   | **Method** | `POST` |
   | **Headers** | `Content-Type: application/json` |

   **Body:**
   ```json
   {
     "airtableRecordId": "{RECORD_ID}"
   }
   ```

   > **{RECORD_ID}** は Airtable の動的フィールドから「Record ID」を選択してください。
   >
   > nankan-analyticsと同じ形式だが、**URLが違う**ので注意。

### Step 5: テスト

1. テスト用レコードを作成:

   | フィールド | 値 |
   |-----------|-----|
   | Email | マコさんのメールアドレス |
   | Name | テスト太郎 |
   | Plan | pro |
   | plan_type | monthly-jra |
   | VenueAccess | jra |
   | Status | pending |
   | PaymentMethod | Bank Transfer |
   | PaymentEmailSent | ☐（未チェック） |

2. Status を `active` に変更

3. 確認:
   - ✅ メールが届くか
   - ✅ PaymentEmailSent が ☑ に変わるか
   - ✅ ExpirationDate が設定されるか
   - ✅ メール内容にプラン情報・会場情報・ログインボタンが表示されるか

### Step 6: 有効化

テスト成功後、Automation を **ON** にする。

---

## 🏃 運用フロー

### 通常の入金確認手順

1. 銀行振込を確認
2. Airtable の該当レコードの **Status を `active` に変更**
3. 以上！（メールは自動送信されます）

### 二重送信防止

- `PaymentEmailSent` が `true` の場合、メールは送信されません
- 再送信したい場合は `PaymentEmailSent` のチェックを外してから Status を再度 active にしてください

---

## 📋 プラン別の自動設定

### PlanType と plan_type の違い

| PlanType（セッション用） | plan_type（詳細） | 対象 | 入金確認メール |
|------------------------|-----------------|------|--------------|
| `free-registered` | なし | 無料会員 | 送信しない（Automation対象外） |
| `light` | `light` | ライトプラン | 送信する |
| `pro` | `lifetime` | 買い切りプラン | 送信する |
| `pro` | `yearly` | 年払いプラン | 送信する |
| `pro` | `monthly-nankan` | 月払い（南関のみ） | 送信する |
| `pro` | `monthly-jra` | 月払い（中央のみ） | 送信する |

> `free-registered` は無料会員登録（register-free.js）で自動設定される。
> PaymentMethod が設定されないため、Automation のトリガー条件に一致せず、入金確認メールは飛ばない。

### 有効期限の自動計算

入金確認メール送信時に、plan_type に応じて自動設定されます:

| plan_type | 有効期限 | 会場アクセス |
|-----------|---------|------------|
| lifetime | 2099-12-31（永久） | all |
| yearly | +1年 | all |
| light | +1ヶ月 | all |
| monthly-nankan | +1ヶ月 | nankan |
| monthly-jra | +1ヶ月 | jra |

---

## 🚨 トラブルシューティング

### メールが送信されない場合

1. **Airtable Automation のログを確認**
   - Automations → 該当Automation → Run history

2. **Netlify Functions のログを確認**
   - Netlify管理画面 → Functions → `send-payment-confirmation-auto` → Logs

3. **よくある原因**:
   - `PaymentEmailSent` が既に `true` → チェックを外す
   - `PaymentMethod` が `Bank Transfer` でない → 値を確認
   - `Email` または `Name` フィールドが空 → 入力する
   - 環境変数が未設定 → Netlify管理画面で確認

### 手動でメール送信をテストする場合

```bash
curl -X POST https://keiba-intelligence.netlify.app/.netlify/functions/send-payment-confirmation-auto \
  -H "Content-Type: application/json" \
  -d '{"airtableRecordId":"recXXXXXXXXXXXXXX"}'
```

---

## ✅ 設定チェックリスト

- [ ] **keiba-intelligence の** Airtable Base で作業している（nankan-analyticsではない）
- [ ] Customersテーブルに必要なフィールドが存在する
- [ ] Airtable Automationが作成されている
- [ ] Automation名: `入金確認メール自動送信（KEIBA Intelligence）`
- [ ] トリガー条件1: `Status` is `active`
- [ ] トリガー条件2: `PaymentEmailSent` is not checked
- [ ] トリガー条件3: `PaymentMethod` is `Bank Transfer`
- [ ] Webhook URL: `https://keiba-intelligence.netlify.app/.netlify/functions/send-payment-confirmation-auto`
- [ ] POST body に `{RECORD_ID}` が動的に入る
- [ ] テストレコードでメール受信確認
- [ ] PaymentEmailSent が自動で true になることを確認
- [ ] ExpirationDate が正しく設定されることを確認
- [ ] Automation を ON にした

---

## 📚 関連ファイル

| ファイル | 説明 |
|---------|------|
| `astro-site/netlify/functions/bank-transfer-application.js` | 銀行振込申請処理（VenueAccess・PaymentEmailSent設定） |
| `astro-site/netlify/functions/send-payment-confirmation-auto.js` | 入金確認メール自動送信 |
| `astro-site/netlify/functions/register-free.js` | 無料会員登録（PaymentMethodなし→Automation対象外） |
| `astro-site/netlify/functions/verify-magic-link.js` | ログイン認証（venueAccess含むセッション返却） |
| `astro-site/src/components/AccessControl.astro` | 会場別アクセス制御 |
