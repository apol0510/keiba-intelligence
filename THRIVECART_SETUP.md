# ThriveCart + Netlify Functions 設定手順書

**KEIBA Intelligence - 決済・自動化システム構築マニュアル**

---

## 🎯 システム構成

```
ThriveCart（決済）
  ↓ Webhook
Netlify Functions（thrivecart-webhook.js）
  ↓
Airtable（顧客管理）+ SendGrid（メール送信）
```

**メリット:**
- ✅ Zapier不要（月額約¥11,000節約）
- ✅ 完全制御可能・レスポンス速い
- ✅ Netlify Pro $19/月に含まれる（追加コストなし）
- ✅ 無料枠: 125,000 requests/月

---

## 📋 1. ThriveCart商品登録

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
Currency: JPY (日本円)
Payment Gateway: PayPal
Product ID: keiba-intelligence-light
```

**Bump Offers（年額プラン）:**
```
年額価格: ¥29,800
説明: 2ヶ月無料（月額換算¥2,483）
```

---

#### プラン2: スタンダード（月額¥4,980）

```
商品名: KEIBA Intelligence - スタンダードプラン
説明: 全レース馬単買い目
価格: ¥4,980
Product ID: keiba-intelligence-standard
```

**Bump Offers:**
```
年額価格: ¥49,800
```

---

#### プラン3: プレミアム（月額¥6,980）

```
商品名: KEIBA Intelligence - プレミアムプラン
説明: 全レース三連複買い目
価格: ¥6,980
Product ID: keiba-intelligence-premium
```

**Bump Offers:**
```
年額価格: ¥69,800
```

---

#### プラン4: アルティメット（月額¥8,980）

```
商品名: KEIBA Intelligence - アルティメットプラン
説明: 馬単+三連複+穴馬情報
価格: ¥8,980
Product ID: keiba-intelligence-ultimate
```

**Bump Offers:**
```
年額価格: ¥89,800
```

---

#### プラン5: AI Plus（月額¥19,800）

```
商品名: KEIBA Intelligence - AI Plusプラン
説明: 1鞍超精密AI予想
価格: ¥19,800
Product ID: keiba-intelligence-ai-plus
```

**注意:** 単品購入のみ（他プランと併用不可）

---

### 1.3 決済設定（PayPal）

**Settings → Payment Gateways → PayPal**

```
PayPalアカウント: （マコさんのPayPalメールアドレス）
PayPal Mode: Live（本番環境）
```

**テスト時:**
```
PayPal Mode: Sandbox（テスト環境）
Test PayPal Account: （テスト用PayPalアカウント）
```

---

### 1.4 Webhook設定（Netlify Functions）

**Settings → Webhooks → Add Webhook**

#### Webhook 1: 購入完了時

```
Webhook Name: Purchase Success
Trigger: Purchase Success
Webhook URL: https://keiba-intelligence.keiba.link/.netlify/functions/thrivecart-webhook
```

#### Webhook 2: 解約時

```
Webhook Name: Subscription Cancelled
Trigger: Subscription Cancelled
Webhook URL: https://keiba-intelligence.keiba.link/.netlify/functions/thrivecart-webhook
```

**送信データ形式（JSON）:**
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

### 1.5 Webhook Secret取得

**Settings → Webhooks → Webhook Secret**

```
Webhook Secret: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**↓ Netlify環境変数に設定:**
```
THRIVECART_WEBHOOK_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

### 1.6 埋め込みコード取得

**Products → [商品名] → Publish → Get Embed Code**

各プランの埋め込みコードを取得し、`/pricing` ページに設置:

```html
<!-- ライトプラン -->
<a href="https://thrivecart.com/checkout/keiba-intelligence-light" class="btn btn-primary">
  ライトプランを始める
</a>

<!-- スタンダードプラン -->
<a href="https://thrivecart.com/checkout/keiba-intelligence-standard" class="btn btn-primary">
  スタンダードプランを始める
</a>

<!-- プレミアムプラン -->
<a href="https://thrivecart.com/checkout/keiba-intelligence-premium" class="btn btn-primary">
  プレミアムプランを始める
</a>

<!-- アルティメットプラン -->
<a href="https://thrivecart.com/checkout/keiba-intelligence-ultimate" class="btn btn-primary">
  アルティメットプランを始める
</a>

<!-- AI Plusプラン -->
<a href="https://thrivecart.com/checkout/keiba-intelligence-ai-plus" class="btn btn-secondary">
  AI Plusプランを始める
</a>
```

---

## 🔧 2. Netlify環境変数設定

**Netlify → Site settings → Environment variables**

以下の環境変数を追加:

```bash
# ThriveCart
THRIVECART_WEBHOOK_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Airtable
AIRTABLE_API_KEY=patxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AIRTABLE_BASE_ID=appxxxxxxxxxxxxxxx

# SendGrid
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## 🧪 3. テスト実行

### 3.1 ローカルテスト（Netlify CLI）

```bash
# Netlify CLIインストール
npm install -g netlify-cli

# ログイン
netlify login

# ローカル開発サーバー起動
cd astro-site
netlify dev

# Webhook URLがローカルで利用可能:
# http://localhost:8888/.netlify/functions/thrivecart-webhook
```

### 3.2 テストWebhook送信

```bash
# curlでテスト送信
curl -X POST http://localhost:8888/.netlify/functions/thrivecart-webhook \
  -H "Content-Type: application/json" \
  -d '{
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
  }'
```

**期待される結果:**
- ✅ Airtable Customersテーブルに新規レコード作成
- ✅ SendGridからtest@example.comにウェルカムメール送信
- ✅ Netlify Function Logsに成功ログ

### 3.3 ThriveCart Test Mode

**Settings → Test Mode → Enable**

```
Test Mode: ON
PayPal Mode: Sandbox
```

**テスト購入:**
1. `/pricing` ページでスタンダードプランのCTAをクリック
2. ThriveCartチェックアウトページで情報入力
3. PayPal Sandboxで決済完了
4. Webhook自動送信 → Netlify Functions実行

**確認:**
- Airtableに顧客レコードが作成されたか
- SendGridでウェルカムメールが送信されたか
- Netlify Function Logs（Deploy → Functions → thrivecart-webhook）

---

## 🚀 4. 本番デプロイ

### 4.1 GitHubにプッシュ

```bash
git add netlify/functions/thrivecart-webhook.js
git commit -m "✨ Netlify Functions Webhook実装"
git push origin main
```

### 4.2 Netlify自動デプロイ確認

**Netlify → Deploys → 最新デプロイ確認**

- ビルド成功
- Functions: thrivecart-webhook（1 function deployed）

### 4.3 ThriveCart本番モード切り替え

**Settings → Test Mode → Disable**

```
Test Mode: OFF
PayPal Mode: Live
```

**Webhook URL更新:**
```
https://keiba-intelligence.keiba.link/.netlify/functions/thrivecart-webhook
```

---

## 📊 5. 動作確認（本番）

### 5.1 実際に購入テスト

1. `/pricing` ページでライトプランを選択
2. ThriveCartチェックアウトで実際に決済
3. Airtableで顧客レコード確認
4. メール受信確認

### 5.2 解約テスト

1. ThriveCart管理画面で手動解約実行
2. Airtableでステータスが `cancelled` に更新されたか確認
3. 解約通知メール受信確認

---

## 🔍 6. ログ確認・監視

### 6.1 Netlify Function Logs

**Netlify → Functions → thrivecart-webhook → View logs**

```
✅ 正常ログ例:
📥 Webhook received: purchase.success
✅ Customer created: recXXXXXXXXXXXXXX
✅ Welcome email sent to: user@example.com

❌ エラーログ例:
❌ Invalid signature
❌ Airtable create error: ...
❌ SendGrid error: ...
```

### 6.2 Airtableビュー作成

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

## 🛡️ 7. セキュリティ

### 7.1 Webhook署名検証

`thrivecart-webhook.js` で実装済み:

```javascript
function verifySignature(body, signature) {
  const hash = crypto
    .createHmac('sha256', THRIVECART_WEBHOOK_SECRET)
    .update(body)
    .digest('hex');

  return signature === hash;
}
```

### 7.2 環境変数の保護

- ✅ Netlify環境変数は暗号化保存
- ✅ GitHub Secretsに保存（コードにハードコードしない）
- ✅ .envファイルは.gitignore登録済み

---

## 📈 8. コスト比較

### Zapier方式（旧）

| サービス | プラン | 月額 |
|---------|--------|------|
| Zapier | Premium | $73.50 |
| Netlify | Pro | $19.00 |
| Airtable | Pro | $20.00 |
| SendGrid | Essential 100 | $0 |
| **合計** | - | **$112.50（約¥16,875）** |

### Netlify Functions方式（新）

| サービス | プラン | 月額 |
|---------|--------|------|
| Netlify | Pro | $19.00 |
| Airtable | Pro | $20.00 |
| SendGrid | Essential 100 | $0 |
| **合計** | - | **$39.00（約¥5,850）** |

**節約額: $73.50/月（約¥11,025/月）**

---

## 🚨 9. トラブルシューティング

### Q: Webhookが実行されない

**A: ThriveCart Webhook URL確認**
```
https://keiba-intelligence.keiba.link/.netlify/functions/thrivecart-webhook
```

**確認方法:**
- ThriveCart → Settings → Webhooks → Webhook URL確認
- Netlify → Functions → thrivecart-webhook が存在するか確認

### Q: Airtableにレコードが作成されない

**A: 環境変数確認**
```bash
# Netlify → Site settings → Environment variables

AIRTABLE_API_KEY=patxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AIRTABLE_BASE_ID=appxxxxxxxxxxxxxxx
```

**Netlify Function Logs確認:**
```
❌ Airtable create error: Invalid API key
```

### Q: SendGridメールが届かない

**A: From アドレス認証確認**
- SendGrid → Settings → Sender Authentication
- Domain Authentication（SPF/DKIM）設定済みか確認

### Q: 署名検証エラー

**A: Webhook Secret確認**
```bash
# Netlify環境変数
THRIVECART_WEBHOOK_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# ThriveCartで取得したSecretと一致しているか確認
```

---

## ✅ 10. 完了チェックリスト

### ThriveCart設定
- [ ] 5プラン作成（ライト〜AI Plus）
- [ ] PayPal決済設定
- [ ] Webhook URL設定（2つ）
- [ ] Webhook Secret取得

### Netlify設定
- [ ] 環境変数設定（4つ）
- [ ] Functions デプロイ確認
- [ ] Function Logs確認

### テスト実行
- [ ] ローカルテスト（curlで送信）
- [ ] ThriveCart Test Mode購入
- [ ] Airtableレコード作成確認
- [ ] SendGridメール受信確認
- [ ] 解約テスト

### 本番運用
- [ ] ThriveCart本番モード切り替え
- [ ] 実際に購入テスト
- [ ] Airtableビュー作成
- [ ] 監視設定（Netlify Notifications）

---

## 📚 11. 参考リンク

- **ThriveCart Webhooks Documentation**: https://thrivecart.com/docs/webhooks/
- **Netlify Functions Documentation**: https://docs.netlify.com/functions/overview/
- **Airtable API Documentation**: https://airtable.com/developers/web/api/introduction
- **SendGrid Node.js Library**: https://github.com/sendgrid/sendgrid-nodejs

---

**作成日**: 2026-01-10
**作成者**: Claude Code（クロちゃん）
**協力者**: マコさん

**次のステップ:**
- 会員認証システム実装（SendGrid経由マジックリンク）
- 管理画面作成（prediction-converter, results-manager）
- 有料予想ページ作成（プラン別アクセス制御）
