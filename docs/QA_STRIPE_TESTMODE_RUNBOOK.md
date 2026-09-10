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

### 3.0 実施状況（2026-09-10）

| # | 作業 | 状態 |
|---|---|---|
| 1 | QA base の作成 | ✅ **完了**（仕様所有者）|
| 2 | QA 専用 PAT の発行 | ✅ **完了**（仕様所有者）|
| 3 | スキーマの作成 | ✅ **完了**（bootstrap write は不要だった）|
| 3' | **スキーマ照合（`--check`）** | ✅ **PASS** — 4 テーブル / 57 列・型・選択肢・primary 一致・**全 4 テーブル 0 レコード**。production データの混入なし |
| 4 | Stripe Test Mode の確認 | ✅ **完了**（read-only。下記 §3.4）|
| 4' | **QA ブランチの作成** | ✅ **完了** — `qa-stripe-testmode`（`main` と同一 SHA）。🔴 **deploy は起きていない**（`allowed_branches` が `["main"]` のため）|
| 5 | Test webhook 送信先の作成 | 🔴 **未実施**（branch deploy URL が決まってから）|
| 6 | Netlify env（branch scope・**9 キー**）| 🔴 **未実施**（承認境界）|
| 7 | `allowed_branches` の一時追加 | 🔴 **未実施**（承認境界）|
| 8 | branch deploy の作成 | 🔴 **未実施**（承認境界）|

🔴 QA base id・PAT は **repo にも本書にも書かない**（Secret Scanning のため）。

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

🔴 前回のキーは cleanup 済みで**再取得できない**。**再発行**すること。
以下は `netlify/functions/stripe-webhook.js` と `rewards.js` から確定した要件。

#### 必要な値（3 つ）と 2026-09-10 の確認結果

| # | 値 | 要件 | env キー | 状態 |
|---|---|---|---|---|
| 1 | Secret key | Test Mode（`sk_test_…`）| `STRIPE_SECRET_KEY` | 取得すればよい |
| 2 | **Price** | 🔴 **recurring / `interval=month` / `interval_count=1`** / **JPY** | `STRIPE_PRICE_PREMIUM` | ✅ **既存を再利用できる**（下記）|
| 3 | Webhook 署名シークレット | 送信先を作ると発行される | `STRIPE_WEBHOOK_SECRET` | 🔴 **送信先が 0 件**。作成が要る |

✅ **Price は新規作成しなくてよい。**
Test Mode に「**KEIBA Intelligence プレミアム（テスト）**」**¥3,980 / 月**・
`interval_count=1`・**トライアルなし**の Price が既にある（仕様所有者が read-only 確認）。
要件（月次・`interval_count` あり・トライアルなし）をすべて満たす。

🔴 **Test の webhook 送信先は現在 0 件。** §3.4' で作る。

🔴 **Price は必ず「月次」にする。**
`periodMonthsFromPrice()` は `interval` × `interval_count` で月数を出し、
🔴 **`interval_count` が無いときに 1 で補わない**（＝付与しない）。
`month` / `year` 以外（`day` / `week`）も**付与されない**。
月額 1 期 = **1 か月 / 100 pt**、年額 1 期 = **12 か月 / 1,200 pt**。

#### 3.4' Webhook 送信先（🔴 branch deploy を作ってから登録する）

- QA ブランチ: **`qa-stripe-testmode`**（`main` と同一。本番コードを検証対象にする）
- branch deploy URL（見込み）: `https://qa-stripe-testmode--keiba-intelligence.netlify.app`
- 登録する URL: `https://qa-stripe-testmode--keiba-intelligence.netlify.app/.netlify/functions/stripe-webhook`

🟢 **301 の罠に当たらないことを確認済み。**
`netlify.toml` の 301 は `from = "https://keiba-intelligence.netlify.app/*"` と
**ホスト固定**で、branch deploy のホスト（`qa-stripe-testmode--…`）には当たらない。
（当たると **POST が GET へ変換されて webhook が壊れる**。既知の罠）

🔴 **URL は branch deploy を作ってから確定させること。** 見込みのまま登録しない。
- 🔴 **有効化するイベント（5 つ）** — これ以外は届いても無視される

| イベント | 何が起きるか |
|---|---|
| `checkout.session.completed` | 会員を有料へ。**契約価格を保存**（`ContractPrice*`）|
| `invoice.payment_succeeded` | 🔴 **台帳へ付与**（継続月数・残高が動く中核）|
| `invoice.payment_failed` | 付与を保留（認可は止めない。TBD-10）|
| `customer.subscription.updated` | `active` / `trialing` 以外で解約扱い |
| `customer.subscription.deleted` | 解約。`CancelledAt` を保存 |

#### 🔴 付与が成立する条件（満たさないと台帳が動かない）

| 条件 | 根拠 |
|---|---|
| `invoice.amount_paid > 0` | 🔴 **¥0 請求では付与しない**（2026-09-05 に誤付与を実測して修正）|
| `price.recurring.interval` が `month` / `year` | それ以外は付与しない |
| `price.recurring.interval_count` が存在する | 🔴 **欠けていても 1 で補わない** |
| `invoice.status_transitions.paid_at` がある | 🔴 受信時刻で代用しない |

🔴 **トライアル期間を付けない。** 初回が ¥0 請求になり、付与されずに月数が進まない。

#### 用意しないもの

| 対象 | 理由 |
|---|---|
| `STRIPE_PRICE_LIGHT` | ライトは保留プラン。QA でも使わない |
| 年額 Price | 「月次で進める」目的から外れる（2 回で 24 か月になる）|
| Customer Portal の設定 | 解約まで見るなら要るが、月数の進行には不要 |

### 3.5 branch を作り、Netlify env を branch scope で設定する

`allowed_branches` は現在 **`["main"]`**。QA ブランチを一時追加してから branch deploy を作る。

**Branch deploys スコープへ入れる env は 9 キー。**

#### 現状のスコープ（2026-09-10 に read-only 確認。🔴 値は見ていない）

| キー | 現在のスコープ | branch-deploy への設定 | 危険度 |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | dev / deploy-preview / production / dev-server | **追加**（Test の値）| 🟢 追加のみ |
| `STRIPE_WEBHOOK_SECRET` | 同上 | **追加**（Test の値）| 🟢 追加のみ |
| `STRIPE_PRICE_PREMIUM` | 同上 | **追加**（既存の Test Price「KEIBA Intelligence プレミアム（テスト）」）| 🟢 追加のみ。**新規作成は不要** |
| `STRIPE_PORTAL_RETURN_URL` | **未設定** | **追加** → `https://qa-stripe-testmode--keiba-intelligence.netlify.app/mypage` | 🟢 追加のみ。🔴 本番 URL を入れない |
| `MEMBERSHIP_READ_ENABLED` | production のみ | **追加**（`true`）| 🟢 追加のみ |
| `MEMBERSHIP_WRITE_ENABLED` | production のみ | **追加**（`true`）| 🟢 追加のみ |
| `SESSION_SIGNING_SECRET` | dev / **branch-deploy** / deploy-preview / production / dev-server | **branch-deploy の値を差し替え** | 🟡 branch のみに影響 |
| **`AIRTABLE_API_KEY`** | 🔴 **all（1 値）** | QA 専用 PAT | 🔴 **下記の注意** |
| **`AIRTABLE_BASE_ID`** | 🔴 **all（1 値）** | QA base id | 🔴 **下記の注意** |

#### 🔴 いちばん危険な作業: `AIRTABLE_*` の `all` → コンテキスト別への変換

`AIRTABLE_API_KEY` と `AIRTABLE_BASE_ID` は **「all」スコープで 1 つの値**しか持っていない。
branch-deploy だけ別の値にするには、**コンテキスト別の値へ変換**する必要がある。

🔴 **この変換で production の値を取りこぼすと、本番のログイン・会員データ読み書きが全部壊れる。**

安全な進め方:

1. 変換前に **production の現在値を控える**
   （`netlify env:get AIRTABLE_BASE_ID --context production` / 同 `AIRTABLE_API_KEY`）
2. UI でコンテキスト別へ変え、**production / deploy-preview / dev / dev-server に元の値**を入れる
3. **branch-deploy にだけ QA の値**を入れる
4. 変換後に **production の値が元のままか**を必ず読み直して確認する
5. 本番 `/mypage` が 200 で、ログイン済み会員の表示が壊れていないことを確認する

🟢 `SESSION_SIGNING_SECRET` は既にコンテキスト別なので、**branch-deploy の値を変えるだけ**でよい。
新しい値の作り方（値は画面に出さない）:

```bash
node -e "require('crypto').randomBytes(48).toString('base64url')" >/dev/null   # 例
# 実際は UI の入力欄へ直接貼る。ターミナルの履歴に残さないこと
```

🔴 **`SESSION_SIGNING_SECRET` を本番と同じにしない。**
同じにすると、QA で発行したセッション Cookie が**本番でも有効**になる。

#### 🔴 QA base id・PAT・Test キーを repo に書かない

Netlify の Secret Scanning は「env の値」と「repo 内の文字列」の一致でビルドを落とす。
2026-09-02 / 09-06 / **09-10** に実際に発生している（09-10 は本番ビルドが 2 回 red・
`Exposed secrets detected`）。**`SECRETS_SCAN_OMIT_*` で回避しない。**

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
| 1 | Netlify | Branch deploys スコープの env **9 キー**を削除（🔴 `AIRTABLE_*` は削除ではなく **all スコープへ戻す**）|
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
