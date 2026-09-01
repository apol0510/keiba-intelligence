# Stripe Test Mode E2E — 実施手順と記録

> このブランチ（`test/stripe-testmode-e2e-2026-09-01`）は **Test Mode の実 E2E 専用の受け皿**。
> Deploy Preview 上で「実際の Checkout 画面 → 本物の webhook 配信」まで通し、
> 結果をこのファイルへ記録する。

## 🔴 触ってはいけないもの

| | |
|---|---|
| 本番 Stripe（Live Mode）| Product / Price / Webhook / Customer Portal のいずれも作らない・変えない |
| 本番の環境変数 | `production` スコープの `STRIPE_*` は設定しない |
| 実決済 | Live のカードは使わない。Test Mode のテストカードのみ |
| コード仕様 | 本ブランチでは **挙動を変えない**。記録用の文書だけを置く |

`main` の実装は既に検証済み（`npm run test:stripe` の 41 件）。
ここで確かめるのは **Stripe 側の設定が実際に噛み合うか**だけ。

## 前提（すでに検証済みのこと）

外部通信なしの E2E は `astro-site/src/lib/billing/stripeWebhook.test.mjs` /
`stripeCheckout.test.mjs` で通してある（PR #81）。

- 署名検証（正常 / 不正 / 別秘密 / 本文改竄）
- 冪等・二重付与防止・他会員混入なし
- Checkout → 付与 → 有料表示 → 解約 → 失効 → 停止 → `payment_failed`
- fail-closed（秘密鍵・署名鍵の未設定、未ログイン、改竄 Cookie、期限切れ）

**本 E2E の目的は、Stripe の実配信で同じ結果になることの確認。**

## 準備（GUI 操作・実施者が行う）

すべて **Test Mode**（ダッシュボード左上のトグルが「テスト」）で行う。

### 1. Product / Price

| 項目 | 値 |
|---|---|
| 商品名 | KEIBA Intelligence プレミアム（テスト）|
| 料金体系 | 定期 |
| 金額 | ¥3,980 / 月 / JPY |

→ 料金の **Price ID（`price_…`）** を控える。

### 2. Webhook エンドポイント

送信先は **このブランチの Deploy Preview**。

```
<DEPLOY_PREVIEW_URL>/.netlify/functions/stripe-webhook
```

送信するイベント（この 4 つだけ）:

```
checkout.session.completed
customer.subscription.updated
customer.subscription.deleted
invoice.payment_failed
```

→ **署名シークレット（`whsec_…`）** を控える。

### 3. Customer Portal

Test Mode の設定 → 請求 → カスタマーポータルを有効化。
解約とカード変更を許可する。

### 4. 環境変数（🔴 Deploy Preview スコープのみ）

| Key | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` |
| `STRIPE_PRICE_PREMIUM` | 手順 1 の `price_…` |
| `STRIPE_WEBHOOK_SECRET` | 手順 2 の `whsec_…` |
| `STRIPE_PORTAL_RETURN_URL` | `<DEPLOY_PREVIEW_URL>/mypage` |

🔴 **Deploy contexts は「Deploy previews」だけに限定する。**
`Production` に入れると本番で課金導線が開いてしまう。

🔴 環境変数はデプロイ時に注入されるため、**設定後に再デプロイが必要**
（空コミットは「内容に変更なし」でキャンセルされるので、実際の変更を伴う push か
再ビルドの実行が要る）。

## 実施手順

| # | 操作 | 期待 |
|---|---|---|
| 1 | Deploy Preview で無料会員としてログイン | 印が見える / 買い目は見えない |
| 2 | `/pricing` を開く | ボタンが「このプランを申し込む」に変わっている |
| 3 | 申し込む → Checkout でテストカード `4242 4242 4242 4242` | 決済成功 → `/mypage?checkout=success` |
| 4 | Stripe の Webhook ログ | `checkout.session.completed` が 200 |
| 5 | 予想ページを再読込 | **買い目・AI指数・AI結論が開く**／印は出ない |
| 6 | Stripe で同じイベントを再送 | 応答 `duplicate:true`・Airtable が二重更新されない |
| 7 | `/mypage` からポータル → 解約 | `customer.subscription.updated(canceled)` が 200 |
| 8 | 予想ページを再読込 | 買い目が閉じる／**印は見える**（無料会員へ戻る）|
| 9 | Stripe で支払い失敗を再現 | `Status=payment_failed` のみ・アクセスは止まらない |

## 記録欄（実施後に埋める）

| # | 実施日時 | 結果 | 備考 |
|---|---|---|---|
| 1 |  |  |  |
| 2 |  |  |  |
| 3 |  |  |  |
| 4 |  |  |  |
| 5 |  |  |  |
| 6 |  |  |  |
| 7 |  |  |  |
| 8 |  |  |  |
| 9 |  |  |  |

## 後片付け

- Test Mode の Webhook エンドポイントは、この Deploy Preview が消えると 404 になる。
  E2E が終わったら **Test Mode の Webhook を削除**する。
- Deploy Preview スコープの `STRIPE_*` も削除する（残すと次の PR に効いてしまう）。
- 本 PR は **記録を残したうえで merge するか、close する**（コード変更が無いため
  merge しなくても本番へ影響しない）。
