# Stripe Test Mode E2E — 実施手順と記録

> このブランチ（`test/stripe-testmode-e2e-2026-09-01`）は **Test Mode の実 E2E 専用の受け皿**。
> Deploy Preview 上で「実際の Checkout 画面 → 本物の webhook 配信」まで通し、
> 結果をこのファイルへ記録する。
>
> 最終更新: 2026-09-01（`origin/main` を追随。会員継続制度の確認を追加）

## 🔴 触ってはいけないもの

| | |
|---|---|
| 本番 Stripe（Live Mode）| Product / Price / Webhook / Customer Portal のいずれも作らない・変えない |
| 本番の環境変数 | `Production` スコープの `STRIPE_*` は設定しない |
| 実決済 | Live のカードは使わない。Test Mode のテストカードのみ |
| コード仕様 | 本ブランチでは **挙動を変えない**。記録用の文書だけを置く |
| membership / auth / entitlement の契約 | **変更しない**（確認するだけ）|

`main` の実装は既に検証済み（`npm run test:stripe` 53 件 / `test:membership` 180 件）。
ここで確かめるのは **Stripe 側の設定が実際に噛み合うか**だけ。

## 🔴 Airtable は本番と同じベースである（最重要）

**Deploy Preview も本番も `AIRTABLE_BASE_ID` は同一**。テスト用のベースは存在しない。
したがって Test Mode の E2E でも、

- 無料会員登録 → **本番の `Customers` にレコードが 1 件増える**
- リワード付与 → **本番の `RewardLedger` に行が増える**

これは避けられない。そのため:

- 🔴 **テスト専用のメールアドレス**を使う（実会員のアドレスを使わない）
- 🔴 実施後に **§後片付け**で作ったレコードを必ず削除する
- 🔴 **既存の実会員レコードには一切触れない**

## 前提（すでに検証済みのこと）

外部通信なしの E2E は `src/lib/billing/stripeWebhook.test.mjs` /
`stripeCheckout.test.mjs` / `src/lib/membership/*.test.mjs` で通してある。

- 署名検証（正常 / 不正 / 別秘密 / 本文改竄）
- 冪等・二重付与防止・他会員混入なし
- Checkout → 付与 → 有料表示 → 解約 → 失効 → 停止 → `payment_failed`
- リワード: 支払い成功だけで付与 / 未知の間隔・`paid_at` 欠落なら付与しない / 再送で増えない
- fail-closed（秘密鍵・署名鍵の未設定、未ログイン、改竄 Cookie、期限切れ）

**本 E2E の目的は、Stripe の実配信で同じ結果になることの確認。**

---

## 準備（GUI 操作・実施者が行う）

すべて **Test Mode**（ダッシュボード左上のトグルが「テスト」）で行う。

### 1. Product / Price

| 項目 | 値 |
|---|---|
| 商品名 | KEIBA Intelligence プレミアム（テスト）|
| 料金体系 | 定期 |
| 金額 | **¥3,980 / 月 / JPY** |

→ 料金の **Price ID（`price_…`）** を控える。

🔴 `interval_count` は既定の 1 のままにする（間隔が判定できないと**付与されない**設計のため）。

### 2. Webhook エンドポイント

送信先は **このブランチのブランチデプロイ**（下記の実測 URL）。

```
https://test-stripe-testmode-e2e-2026-09-01--keiba-intelligence.netlify.app/.netlify/functions/stripe-webhook
```

🔴 **Deploy Preview（`deploy-preview-82--…`）は使えない。**
本ブランチの差分は手順書 1 ファイルだけなので、Netlify が
「Canceled build due to no content change」で **Preview のビルドを行わず 404** になる。
代わりに **ブランチデプロイ**を明示的に起こしてある（2026-09-01 実測で稼働確認済み）。

疎通確認（秘密鍵を入れる前の正常値）:

| 経路 | 期待 |
|---|---|
| `/pricing` | 200 |
| `/.netlify/functions/stripe-prices` | 200・`{"ready":false,…}`（秘密鍵なしでも 500 にしない）|
| `/.netlify/functions/stripe-webhook`（POST）| **503**（未設定なので無検証で書き込まない）|

送信するイベント（🔴 **5 つ**。以前の手順書は 4 つだったので注意）:

```
checkout.session.completed
customer.subscription.updated
customer.subscription.deleted
invoice.payment_succeeded     ← 🔴 リワード付与の駆動源。これが無いとポイントが一切付かない
invoice.payment_failed
```

→ **署名シークレット（`whsec_…`）** を控える。

🔴 `invoice.payment_succeeded` を登録し忘れても **認可（買い目の開閉）は正常に動く**ため、
気づきにくい。必ず 5 つ登録すること。

### 3. Customer Portal

Test Mode の 設定 → 請求 → カスタマーポータルを有効化。解約とカード変更を許可する。

### 4. 環境変数（🔴 **Branch deploys** スコープのみ）

| Key | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` |
| `STRIPE_PRICE_PREMIUM` | 手順 1 の `price_…` |
| `STRIPE_WEBHOOK_SECRET` | 手順 2 の `whsec_…` |
| `STRIPE_PORTAL_RETURN_URL` | `https://test-stripe-testmode-e2e-2026-09-01--keiba-intelligence.netlify.app/mypage` |
| `MEMBERSHIP_WRITE_ENABLED` | `true` ← リワード付与を確認する場合のみ |

🔴 **Deploy contexts は「Branch deploys」だけに限定する**
（送信先がブランチデプロイのため。「Deploy previews」では効かない）。
`Production` に入れると **本番で課金導線が開いてしまう**。

🔴 Branch deploys スコープには現在 `SESSION_SIGNING_SECRET` / `AIRTABLE_*` /
`PREVIEW_PAID_KEY` が **Production と同じ値で効いている**（2026-09-01 実測）。
つまりログインも Airtable 読み書きも本番と同じ相手になる。

🔴 `MEMBERSHIP_WRITE_ENABLED` を入れると **本番 Airtable の `RewardLedger` に行が増える**
（上記「Airtable は本番と同じベース」参照）。付与まで確認したい場合だけ入れ、
E2E 後に **Deploy Preview スコープの env とテスト行を削除**する。

🔴 環境変数はデプロイ時に注入されるため、**設定後に再デプロイが必要**
（空コミットは「内容に変更なし」でキャンセルされるので、実際の変更を伴う push か
再ビルドの実行が要る）。

---

## 実施手順

### A. 認可（買い目の開閉）

| # | 操作 | 期待 |
|---|---|---|
| 1 | ブランチデプロイで**テスト用アドレス**の無料会員としてログイン | 印が見える / 買い目は見えない |
| 2 | `/pricing` を開く | ボタンが「このプランを申し込む」に変わっている（金額 ¥3,980）|
| 3 | 申し込む → Checkout でテストカード `4242 4242 4242 4242` | 決済成功 → `/mypage?checkout=success` |
| 4 | Stripe の Webhook ログ | `checkout.session.completed` が 200 |
| 5 | 予想ページを再読込 | **買い目・AI指数・AI結論が開く**／**印は出ない**（R-8）|
| 6 | Stripe で同じイベントを再送 | 応答 `duplicate:true`・Airtable が二重更新されない |

### B. 会員継続制度（リワード）

🔴 `MEMBERSHIP_WRITE_ENABLED=true` を Deploy Preview スコープに入れた場合のみ。

| # | 操作 | 期待 |
|---|---|---|
| 7 | Stripe の Webhook ログで `invoice.payment_succeeded` | 200 |
| 8 | Airtable `RewardLedger` を見る | **1 行だけ**増えている |
| 9 | その行の内容 | `Type=accrual` / **`Points=100`** / **`PeriodMonths=1`** / `SourceRef` が `in_…`（invoice id）/ `OccurredAt` が **支払い成功時刻**（受信時刻ではない）|
| 10 | Stripe で **同じ invoice** の `invoice.payment_succeeded` を再送 | 🔴 **行が増えない（1 行のまま）**・`Points` も変わらない |
| 11 | `Customers` のテスト会員 | `ContractPriceYen=3980` / `ContractCurrency=jpy` / `ContractPriceId` が手順 1 の price |
| 12 | `/mypage` を開く | KIリワード残高 **100 pt**・今月の積み上げ **100 pt** |

🔴 **既存の実会員レコード（`MembershipStartedAt` が入っている 7 件を含む）が
変化していないこと**も併せて確認する。

### C. 解約・支払い失敗

| # | 操作 | 期待 |
|---|---|---|
| 13 | `/mypage` からポータル → 解約 | `customer.subscription.updated(canceled)` が 200 |
| 14 | 予想ページを再読込 | 買い目が閉じる／**印は見える**（無料会員へ戻る）|
| 15 | `Customers` のテスト会員 | `CancelledAt` に解約日が入る |
| 16 | `/mypage` | ポイントは残る（解約後 90 日は保持）|
| 17 | Stripe で支払い失敗を再現 | `Status=payment_failed` のみ・**アクセスは止まらない**・🔴 **`RewardLedger` が増えない** |

---

## 記録欄（実施後に埋める）

| # | 区分 | 実施日時 | 結果 | 備考 |
|---|---|---|---|---|
| 1 | A 認可 |  |  |  |
| 2 | A 認可 |  |  |  |
| 3 | A 認可 |  |  |  |
| 4 | A 認可 |  |  |  |
| 5 | A 認可 |  |  |  |
| 6 | A 認可 |  |  |  |
| 7 | B リワード |  |  |  |
| 8 | B リワード |  |  |  |
| 9 | B リワード |  |  |  |
| 10 | B リワード |  |  |  |
| 11 | B リワード |  |  |  |
| 12 | B リワード |  |  |  |
| 13 | C 解約 |  |  |  |
| 14 | C 解約 |  |  |  |
| 15 | C 解約 |  |  |  |
| 16 | C 解約 |  |  |  |
| 17 | C 失敗 |  |  |  |

---

## 後片付け

🔴 **Airtable が本番と同じベースなので、テストで作ったものは必ず消す。**

1. **Airtable**
   - `RewardLedger` の **テスト会員の行**を削除（`Email` がテスト用アドレスのもの）
   - `Customers` の **テスト会員レコード**を削除
   - 🔴 既存の実会員（63 件）には触れない
2. **Netlify**
   - **Branch deploys** スコープの `STRIPE_SECRET_KEY` / `STRIPE_PRICE_PREMIUM` /
     `STRIPE_WEBHOOK_SECRET` / `STRIPE_PORTAL_RETURN_URL` / `MEMBERSHIP_WRITE_ENABLED` を削除
     （残すと他のブランチデプロイに効いてしまう）
3. **Stripe（Test Mode）**
   - Webhook エンドポイントを削除（ブランチデプロイを消すと 404 になるため）
   - テストの Product / Price は残してよい（Live とは分離されている）
4. **PR**
   - 記録を残したうえで merge するか close する
     （コード変更が無いため merge しなくても本番へ影響しない）

## Live Mode へ進む前の確認

Test Mode で 17 項目すべてが期待どおりなら、Live Mode の設定に進む。
Live での差分は次の 3 点だけ。

| | Test Mode | Live Mode |
|---|---|---|
| Webhook 送信先 | ブランチデプロイの URL | `https://keiba-intelligence.jp/.netlify/functions/stripe-webhook` |
| env スコープ | Branch deploys | **Production** |
| `MEMBERSHIP_WRITE_ENABLED` | Branch deploys に一時設定 | **すでに Production で有効**（2026-09-01 13:28 UTC）|

🔴 Live の Price は **新規に作る**（Test Mode の Price は Live では使えない）。
🔴 Live の Price 金額を後から書き換えない（継続価格ロックが壊れる）。
