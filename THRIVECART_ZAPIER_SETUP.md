# ThriveCart + Zapier 設定手順書

**KEIBA Intelligence - 決済・自動化システム構築マニュアル**

---

## 📋 目次

1. [ThriveCart商品登録](#1-thrivecart商品登録)
2. [Zapier Zap作成](#2-zapier-zap作成)
3. [テスト実行](#3-テスト実行)
4. [本番運用](#4-本番運用)

---

## 1. ThriveCart商品登録

### 1.1 ThriveCartにログイン

https://thrivecart.com/ にアクセスしてログイン

### 1.2 商品作成（5プラン）

#### プラン1: ライト（月額¥2,980）

**Products → New Product**

```
商品名: KEIBA Intelligence - ライトプラン
説明: 後半3レース馬単買い目
価格: ¥2,980
課金タイプ: Recurring (定期課金)
課金周期: Monthly (毎月)
```

**Product Settings:**
- Currency: JPY (日本円)
- Payment Gateway: PayPal
- Product ID: `keiba-intelligence-light`

**Bump Offers:**
- 年額プラン: ¥29,800（2ヶ月無料）

---

#### プラン2: スタンダード（月額¥4,980）

```
商品名: KEIBA Intelligence - スタンダードプラン
説明: 全レース馬単買い目
価格: ¥4,980
課金タイプ: Recurring
課金周期: Monthly
Product ID: keiba-intelligence-standard
```

**Bump Offers:**
- 年額プラン: ¥49,800（2ヶ月無料）

---

#### プラン3: プレミアム（月額¥6,980）

```
商品名: KEIBA Intelligence - プレミアムプラン
説明: 全レース三連複買い目
価格: ¥6,980
課金タイプ: Recurring
課金周期: Monthly
Product ID: keiba-intelligence-premium
```

**Bump Offers:**
- 年額プラン: ¥69,800（2ヶ月無料）

---

#### プラン4: アルティメット（月額¥8,980）

```
商品名: KEIBA Intelligence - アルティメットプラン
説明: 馬単+三連複+穴馬情報
価格: ¥8,980
課金タイプ: Recurring
課金周期: Monthly
Product ID: keiba-intelligence-ultimate
```

**Bump Offers:**
- 年額プラン: ¥89,800（2ヶ月無料）

---

#### プラン5: AI Plus（月額¥19,800）

```
商品名: KEIBA Intelligence - AI Plusプラン
説明: 1鞍超精密AI予想
価格: ¥19,800
課金タイプ: Recurring
課金周期: Monthly
Product ID: keiba-intelligence-ai-plus
```

**注意:**
- 単品購入のみ（他プランと併用不可）
- Bump Offersなし

---

### 1.3 決済設定

**Settings → Payment Gateways → PayPal**

```
PayPalアカウント: （マコさんのPayPalメールアドレス）
PayPal Mode: Live（本番環境）
```

**テスト時:**
- PayPal Mode: Sandbox（テスト環境）
- Test PayPal Account: （テスト用PayPalアカウント）

---

### 1.4 Webhook設定（Zapier連携用）

**Settings → Webhooks → Add Webhook**

**Webhook 1: 購入完了時**
```
Webhook Name: Purchase Success
Trigger: Purchase Success
Webhook URL: （Zapier ZapのWebhook URLを後で設定）
```

**Webhook 2: 解約時**
```
Webhook Name: Refund/Cancel
Trigger: Refund/Cancel
Webhook URL: （Zapier ZapのWebhook URLを後で設定）
```

**送信データ（JSON）:**
```json
{
  "event": "purchase.success",
  "customer": {
    "email": "user@example.com",
    "name": "山田太郎"
  },
  "product": {
    "id": "keiba-intelligence-standard",
    "name": "KEIBA Intelligence - スタンダードプラン",
    "price": 4980
  },
  "subscription": {
    "id": "sub_xxxxxxxxxxxxx",
    "status": "active",
    "next_payment_date": "2026-02-10"
  },
  "timestamp": "2026-01-10T12:00:00Z"
}
```

---

### 1.5 埋め込みコード取得

**Products → [商品名] → Publish → Get Embed Code**

各プランの埋め込みコードを取得:

```html
<!-- ライトプラン -->
<script src="https://thrivecart.com/embed/xxxxxxxxxx"></script>

<!-- スタンダードプラン -->
<script src="https://thrivecart.com/embed/yyyyyyyyyy"></script>

<!-- プレミアムプラン -->
<script src="https://thrivecart.com/embed/zzzzzzzzzz"></script>

<!-- アルティメットプラン -->
<script src="https://thrivecart.com/embed/aaaaaaaaaa"></script>

<!-- AI Plusプラン -->
<script src="https://thrivecart.com/embed/bbbbbbbbbb"></script>
```

**埋め込み先:**
- `/pricing` ページのCTAボタン（`#thrivecart-light`など）
- `/free-prediction` ページのプレミアムCTA

---

## 2. Zapier Zap作成

### 2.1 Zapierにログイン

https://zapier.com/ にアクセスしてログイン

---

### 2.2 Zap 1: 購入完了時の会員登録

**Create Zap → Name: ThriveCart Purchase → Airtable Create**

#### Step 1: Trigger（ThriveCart Webhook）

```
App: Webhooks by Zapier
Trigger Event: Catch Hook
Webhook URL: （コピーしてThriveCartのWebhook設定に貼り付け）
```

**Test Data（サンプルJSON送信）:**
```json
{
  "event": "purchase.success",
  "customer": {
    "email": "test@example.com",
    "name": "テスト太郎"
  },
  "product": {
    "id": "keiba-intelligence-standard",
    "name": "KEIBA Intelligence - スタンダードプラン",
    "price": 4980
  },
  "subscription": {
    "id": "sub_test123",
    "status": "active",
    "next_payment_date": "2026-02-10"
  },
  "timestamp": "2026-01-10T12:00:00Z"
}
```

#### Step 2: Action（Airtable Create Record）

```
App: Airtable
Action Event: Create Record
Account: （Airtableアカウント接続）

Base: KEIBA Intelligence
Table: Customers

Field Mapping:
- Email: {{customer.email}}
- Name: {{customer.name}}
- Plan: {{product.id}}
- Status: active
- Subscription ID: {{subscription.id}}
- Next Payment Date: {{subscription.next_payment_date}}
- Created At: {{timestamp}}
```

#### Step 3: Action（SendGrid Send Email）

```
App: SendGrid
Action Event: Send Email

From: noreply@keiba-intelligence.keiba.link
To: {{customer.email}}
Subject: KEIBA Intelligenceへようこそ！

Body:
{{customer.name}} 様

KEIBA Intelligenceにご登録いただきありがとうございます。

■ ご登録プラン
{{product.name}}

■ ログイン方法
以下のリンクからログインしてください。
https://keiba-intelligence.keiba.link/login

■ サポート
ご不明点は以下までお問い合わせください。
support@keiba-intelligence.keiba.link

KEIBA Intelligence チーム
```

**Zapの有効化:**
- Test & Review → Turn on Zap

---

### 2.3 Zap 2: 解約時の会員ステータス更新

**Create Zap → Name: ThriveCart Refund/Cancel → Airtable Update**

#### Step 1: Trigger（ThriveCart Webhook）

```
App: Webhooks by Zapier
Trigger Event: Catch Hook
Webhook URL: （コピーしてThriveCartのRefund/Cancel Webhook設定に貼り付け）
```

**Test Data（サンプルJSON送信）:**
```json
{
  "event": "subscription.cancelled",
  "customer": {
    "email": "test@example.com"
  },
  "subscription": {
    "id": "sub_test123",
    "status": "cancelled",
    "cancelled_at": "2026-01-15T12:00:00Z"
  }
}
```

#### Step 2: Action（Airtable Find Record）

```
App: Airtable
Action Event: Find Record

Base: KEIBA Intelligence
Table: Customers

Search Field: Email
Search Value: {{customer.email}}
```

#### Step 3: Action（Airtable Update Record）

```
App: Airtable
Action Event: Update Record

Record ID: {{Record ID from Step 2}}

Field Mapping:
- Status: cancelled
- Cancelled At: {{subscription.cancelled_at}}
```

#### Step 4: Action（SendGrid Send Email）

```
App: SendGrid
Action Event: Send Email

From: noreply@keiba-intelligence.keiba.link
To: {{customer.email}}
Subject: KEIBA Intelligence 解約完了のお知らせ

Body:
{{customer.name}} 様

KEIBA Intelligenceの解約手続きが完了しました。

ご契約期間満了まではサービスをご利用いただけます。

またのご利用を心よりお待ちしております。

KEIBA Intelligence チーム
```

**Zapの有効化:**
- Test & Review → Turn on Zap

---

## 3. テスト実行

### 3.1 ThriveCart Test Mode

**Settings → Test Mode → Enable**

```
Test Mode: ON
PayPal Mode: Sandbox
Test PayPal Account: sandbox@example.com
```

### 3.2 テスト購入

1. `/pricing` ページでスタンダードプランのCTAをクリック
2. ThriveCartチェックアウトページで情報入力
3. PayPal Sandboxで決済完了

### 3.3 Zapier動作確認

**Zapier Dashboard → Zap History**

- Zap 1（Purchase Success）が正常実行されたか確認
- Airtableに顧客レコードが作成されたか確認
- SendGridでウェルカムメールが送信されたか確認

### 3.4 解約テスト

1. ThriveCart管理画面で手動解約実行
2. Zap 2（Refund/Cancel）が正常実行されたか確認
3. Airtableのステータスが `cancelled` に更新されたか確認

---

## 4. 本番運用

### 4.1 ThriveCart本番モード切り替え

**Settings → Test Mode → Disable**

```
Test Mode: OFF
PayPal Mode: Live
PayPal Account: （本番PayPalアカウント）
```

### 4.2 Webhook URLの最終確認

**Settings → Webhooks**

- Purchase Success Webhook: ✅ 有効
- Refund/Cancel Webhook: ✅ 有効

### 4.3 Zapier監視設定

**Zapier Dashboard → Settings → Notifications**

```
Email Notifications: ON
Notify on: Zap Errors
Email: mako@example.com
```

### 4.4 Airtableビュー作成

**Customers Table → Views**

**ビュー1: Active Members**
```
Filter: Status = "active"
Sort: Created At (newest first)
```

**ビュー2: Cancelled Members**
```
Filter: Status = "cancelled"
Sort: Cancelled At (newest first)
```

**ビュー3: By Plan**
```
Group by: Plan
Sort: Created At (newest first)
```

---

## 5. 運用チェックリスト

### 毎日確認

- [ ] Zapier Zap Historyでエラーがないか確認
- [ ] Airtableで新規登録者数を確認
- [ ] SendGridで送信エラーがないか確認

### 毎週確認

- [ ] ThriveCartで決済エラー率を確認
- [ ] Airtableで解約率を計算
- [ ] PayPalで売上を確認

### 毎月確認

- [ ] ThriveCart手数料確認
- [ ] Zapier使用量確認（Premium: 50,000 tasks/月）
- [ ] Airtableレコード数確認（Pro: 250,000件上限）

---

## 6. トラブルシューティング

### Q: Zapが実行されない

**A: Webhook URLが正しく設定されているか確認**
- ThriveCart → Settings → Webhooks → Webhook URL確認
- Zapier → Trigger → Webhook URL確認

### Q: Airtableにレコードが作成されない

**A: Field Mappingを確認**
- Zapier → Action → Field Mapping
- Airtableのフィールド名が一致しているか確認

### Q: SendGridメールが届かない

**A: From アドレスが認証済みか確認**
- SendGrid → Settings → Sender Authentication
- Domain Authentication（SPF/DKIM）設定済みか確認

### Q: 重複登録が発生する

**A: Airtable Find Record で重複チェック**
- Zap 1のStep 2の前に「Find Record」を追加
- 既存レコードがあれば「Update」、なければ「Create」

---

## 7. 環境変数（Netlify）

Netlify Functions から ThriveCart Webhook を検証するための環境変数:

```bash
# Netlify → Site settings → Environment variables

THRIVECART_WEBHOOK_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**取得方法:**
- ThriveCart → Settings → Webhooks → Webhook Secret

---

## 8. セキュリティ

### Webhook署名検証（推奨）

ThriveCartからのWebhookが正当かを検証:

```javascript
// netlify/functions/thrivecart-webhook.js

const crypto = require('crypto');

exports.handler = async (event) => {
  const signature = event.headers['x-thrivecart-signature'];
  const secret = process.env.THRIVECART_WEBHOOK_SECRET;

  const hash = crypto
    .createHmac('sha256', secret)
    .update(event.body)
    .digest('hex');

  if (signature !== hash) {
    return {
      statusCode: 401,
      body: 'Invalid signature',
    };
  }

  // Webhook処理
  const data = JSON.parse(event.body);

  // ... Airtable更新処理 ...

  return {
    statusCode: 200,
    body: 'OK',
  };
};
```

---

## 9. 完了

以上でThriveCart + Zapier + Airtable + SendGridの自動化システムが完成です。

**構築したシステム:**
- ✅ ThriveCart商品登録（5プラン）
- ✅ Zapier Zap作成（2 Zaps）
- ✅ Airtable自動更新
- ✅ SendGrid自動メール送信
- ✅ Webhook署名検証

**次のステップ:**
- 会員認証システム実装（マジックリンク）
- 管理画面作成（prediction-converter, results-manager）
- 有料予想ページ作成（プラン別アクセス制御）

---

**作成日**: 2026-01-10
**作成者**: Claude Code（クロちゃん）
**協力者**: マコさん
