# Stripe Test Mode 隔離 QA 環境 — 手順書

> 目的: **管理者が、実会員と同じ決済後の会員クラブ進捗を `/mypage` で目視する。**
> 作成日: 2026-09-10 / 対象: `keiba-intelligence`
>
> 🔴 **表示だけの偽装はしない。** 本番と同じ Stripe webhook → 同じ `RewardLedger` →
> 同じ `membershipView` を通す。継続月数は台帳の `periodMonths` の合計なので、
> **実際の決済成功が積み上がれば月数もランクも自動で動く**。
>
> 🔴 **実顧客・production Airtable には一切書かない。**

---

## 0. なぜ隔離が要るか（前回 E2E との違い）

2026-09 の Test Mode E2E は **`AIRTABLE_BASE_ID` と `SESSION_SIGNING_SECRET` を本番と共有**していた。
その結果:

- テスト会員のレコードが**本番 Airtable に入り**、後から 9 件削除する羽目になった
- tier は**署名済み Cookie に入る**ため、テストセッションが**本番でも有効**だった

🔴 今回は **この 2 つを branch scope で分ける**。これが隔離の核心である。

---

## 1. 仕様変更の要否

🟢 **不要。** `/mypage` は既に必要な 7 項目を表示する。

`現在の契約価格` / `継続価格ロック` / `会員ランク` / `継続月数` /
`KIリワード残高` / `今月の積み上げ` / `次のランクまでの進捗`（＋プレゼントカタログ）

🔴 **「Stripe 限定」と読める表示は無い。** 銀行振込（`bankTransfer.js`）も Stripe
（`stripe-webhook.js`）も**同じ台帳・同じ列・同じ画面**を使う。
リワード・ランク・継続月数・価格ロックは**決済手段に依存しない**。

---

## 2. 承認境界（Claude は実行しない）

| # | 作業 | 実施者 |
|---|---|---|
| 1 | **QA 用 Airtable base の作成** | 仕様所有者（Airtable UI）|
| 2 | **QA 専用 PAT の発行** | 仕様所有者 |
| 3 | **Netlify env / secret の追加** | 仕様所有者 |
| 4 | **`allowed_branches` の一時変更** | 仕様所有者 |
| 5 | **branch deploy の作成（deploy）** | 仕様所有者 |
| 6 | Stripe Test Mode のキー再発行 | 仕様所有者 |

🔴 base 作成は API では**できない**（workspace スコープが要る。現行 PAT は production base 限定）。
**Airtable の UI で空の base を作る**こと。

---

## 3. 手順

### 3.1 QA base を作る（空でよい）

Airtable UI で新しい base を作る。名前の例: `keiba-intelligence-QA`。
🔴 **production base（`keiba-intelligence`）を複製しない。**
複製すると**実会員のレコードが QA へ複写される**。**空の base から始める。**

### 3.2 QA 専用 PAT を発行する

| 項目 | 値 |
|---|---|
| スコープ | `schema.bases:read` / `schema.bases:write` / `data.records:read` / `data.records:write` |
| アクセス範囲 | 🔴 **QA base のみ**（production base を含めない）|

🔴 **本番の read/write PAT を QA へ流用しない。** テスト環境が本番へ書ける状態を作らない。

### 3.3 スキーマを作る

```bash
cd astro-site
AIRTABLE_API_KEY=<QA PAT> \
AIRTABLE_QA_BASE_ID=<QA base id> \
AIRTABLE_BASE_ID=<production base id> \
node scripts/bootstrapQaBase.mjs            # まず dry-run
```

内容を確認してから:

```bash
… node scripts/bootstrapQaBase.mjs --apply
```

作られるもの（**本番と同じ 4 テーブル / 57 列**。2026-09-10 に Metadata API から抽出）:

| テーブル | 列 | 用途 |
|---|---|---|
| `Customers` | 29 | 会員。membership 6 列を含む |
| `AuthTokens` | 7 | 🔴 **マジックリンクのログインに必須** |
| `RewardLedger` | 8 | 継続月数・残高の元 |
| `RewardRedemptions` | 13 | 交換・発送キュー |

🔴 このスクリプトは **`AIRTABLE_BASE_ID` と一致したら中止**する。レコードは読み書きしない。

### 3.4 Stripe Test Mode を用意する

| 対象 | 内容 |
|---|---|
| Secret key | Test Mode の `sk_test_…` |
| Price | 🔴 **月額**の Price（月次で進めるため）|
| Webhook | 送信先 = branch deploy の `/.netlify/functions/stripe-webhook`。署名シークレットを控える |

🔴 前回のキーは cleanup 済みで**再取得できない**。**再発行**すること。

### 3.5 branch を作り、Netlify env を branch scope で設定する

`allowed_branches` に QA ブランチを一時追加してから branch deploy を作る。

**Branch deploys スコープの env（8 件）**

| キー | 値 | 備考 |
|---|---|---|
| `STRIPE_SECRET_KEY` | Test の `sk_test_…` | |
| `STRIPE_WEBHOOK_SECRET` | Test の `whsec_…` | |
| `STRIPE_PRICE_PREMIUM` | Test の**月額** Price id | |
| `STRIPE_PORTAL_RETURN_URL` | branch deploy の `/mypage` | 🔴 本番 URL を入れない |
| **`AIRTABLE_API_KEY`** | 🔴 **QA 専用 PAT** | 本番 PAT を入れない |
| **`AIRTABLE_BASE_ID`** | 🔴 **QA base id** | ここが隔離の要 |
| **`SESSION_SIGNING_SECRET`** | 🔴 **本番と別のランダム値** | テストセッションを本番で無効にする |
| `MEMBERSHIP_READ_ENABLED` / `MEMBERSHIP_WRITE_ENABLED` | `true` | |

🔴 **`SESSION_SIGNING_SECRET` を本番と同じにしない。**
同じにすると、QA で発行したセッション Cookie が**本番でも有効**になる。

🔴 **値を repo に書かない。** Netlify の Secret Scanning は
「production env の値」と「repo 内の文字列」の一致でビルドを落とす
（2026-09-02 / 09-06 / **09-10** に実際に発生）。`SECRETS_SCAN_OMIT_*` で回避しない。

### 3.6 QA 会員を作る

QA base の `Customers` に 1 行だけ作る。例:

| 列 | 値 |
|---|---|
| `Email` | 管理者が受信できるアドレス（🔴 実顧客のものを使わない）|
| `PlanType` | `free-registered` |
| `Status` | `active` |
| `AccessEnabled` | ✓ |

branch deploy でマジックリンクを送ってログインできることを確認する。

---

## 4. 月数を進めて変化を見る

### 4.1 仕組み

```
tenureMonthsFromLedger = ACCRUAL エントリの periodMonths を合計
```

Stripe の月額サブスクを **Test Clock** で進めると、請求のたびに
`invoice.payment_succeeded` が飛び、`stripe-webhook.js` が台帳へ
`accrual`（`periodMonths=1`）を積む。**本番と同じ経路**である。

### 4.2 手順

1. Test Clock 付きの Customer を作る
2. QA 会員として `/pricing` から Checkout（Test Mode のカード）
3. 1 回目の請求 → 台帳 1 行 → **継続月数 1 か月 / Bronze**
4. Test Clock を **1 か月**進める → 自動更新請求 → 台帳が増える
5. 必要な回数だけ 4 を繰り返す

### 4.3 目視できる変化（ランク閾値はコード定数 0 / 3 / 12 / 24）

| 進めた月数 | 継続月数 | ランク | 残高（100pt/月）|
|---|---|---|---|
| 1 | 1 か月 | **Bronze** | 100 pt |
| 3 | 3 か月 | **Silver** | 300 pt |
| 12 | 12 か月 | **Gold** | 1,200 pt |
| 24 | 24 か月 | **Platinum** | 2,400 pt |

🟡 **24 か月まで見るには Test Clock を 24 回進める**（1 回あたり数十秒）。
年額 Price なら 2 回で 24 か月（`periodMonths=12`×2）だが、
「月次の決済成功を進めて見る」目的からは外れる。

### 4.4 契約価格・価格ロックの確認

Stripe の Checkout を通すと `stripe-webhook.js` が `ContractPrice*` を保存する。
`/mypage` の「現在の契約価格」「継続価格ロック」が**準備中 → 実値**へ変わる。

🔴 **Stripe の契約は請求期間を保存していない**ため、`/mypage` は
**期間表記なしで金額だけ**を出す（銀行振込の `bank:yearly` は `/ 年` と出る）。
期間まで出すには契約価格に期間を保存する必要があり、**別途の仕様判断**。

### 4.5 プレゼント・交換の確認

600 pt（6 か月）で交換ラインが開く。`/mypage` のカタログで
「あと ◯ pt」→「交換できます」へ変わる。
🔴 記念品の月（12 / 24 か月）は **通常交換が止まる**（保守ライン S-2）。

---

## 5. 後片付け（QA を止めるとき）

| # | 対象 | 内容 |
|---|---|---|
| 1 | Netlify | Branch deploys スコープの env 8 件を削除 |
| 2 | Netlify | 対象ブランチの branch deploy を削除（🔴 **ページングして全件**）|
| 3 | Netlify | `allowed_branches` を `["main"]` へ戻す |
| 4 | Git | QA ブランチを削除 |
| 5 | Stripe | Test の Customer / Subscription / Test Clock / Webhook 送信先を削除 |
| 6 | Airtable | 🔴 **QA base ごと削除してよい**（実会員は 1 件も入っていない）|

🟢 **production の env・base・会員には最初から触らない**ので、戻す作業は無い。

---

## 6. rollback

| 状況 | 戻し方 |
|---|---|
| QA base を作った後 | base を削除する。production には影響しない |
| branch env を入れた後 | env を削除して branch deploy を消す |
| `allowed_branches` を変えた後 | `["main"]` へ戻す |
| 🔴 production への影響 | **無い**（env・base・鍵をすべて分けているため）|

---

## 7. 🔴 やってはいけないこと

1. production base を**複製**して QA を作る（実会員が複写される）
2. 本番の read/write PAT を QA env へ入れる
3. `SESSION_SIGNING_SECRET` を本番と同じにする
4. Stripe の実キー・Price id・本番 URL を **repo に書く**（ビルドが落ちる）
5. `SECRETS_SCAN_OMIT_*` で secrets scanning を無効化する
6. QA の検証結果をもって**本番の実測**と記録する
