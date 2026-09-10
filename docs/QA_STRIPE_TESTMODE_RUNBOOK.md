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
| 4' | **QA ブランチの作成** | ✅ **完了** — `qa-stripe-testmode` |
| 5 | **`AIRTABLE_*` の `all` → コンテキスト別分離** | ✅ **完了・PASS**（下記 §3.5'）|
| 6 | Netlify env（branch-deploy スコープ）| ✅ **完了** — **8 キーすべて設定済み**。`STRIPE_PORTAL_RETURN_URL` のみ意図的に未設定（下記 §3.5'）|
| 7 | `allowed_branches` へ `qa-stripe-testmode` を追加 | ✅ **完了** — `["main"]` → `["main","qa-stripe-testmode"]`。他の build 設定に差分 0 件 |
| 8 | **初回 branch deploy** | ✅ **ready** — `https://qa-stripe-testmode--keiba-intelligence.netlify.app` |
| 9 | Test webhook 送信先の作成 | ✅ **完了**（仕様所有者）— 5 イベント / `status=enabled` |
| 10 | `STRIPE_WEBHOOK_SECRET`（branch-deploy）| ✅ **完了**（仕様所有者）— QA へ反映済みを実測（§3.9）|
| 11 | E2E 実行前チェック | ✅ **全項目 PASS**（下記 §3.9）|
| 12 | **経路 A**（QA `/pricing` から通常 Checkout 1 回）| ✅ **完了**（§4.A）— `ContractPrice*` 4 列・初回 accrual・Bronze / 1 か月 / 100pt を確認 |
| 13 | QA branch を最新 `main` へ通常 merge して再デプロイ | ✅ **完了** — `519ac4b1`（`origin/main` `b3f09afc` を含む）。**#126 / #127 が QA に載っている**ことを確認 |
| 14 | **経路 B**（Test Clock で 1→3→12→24 か月）| 🔴 **未実施**（承認境界。下記 §4.B）|

### 3.0' 初回 branch deploy の実測（2026-09-10）

| 確認 | 結果 |
|---|---|
| `/qa-marker.txt` `/` `/pricing` `/mypage` | **200** |
| guest の `/prediction/{nankan,jra}` | **302**（fail-closed）|
| 🔴 **301 の罠**: QA ホストへの **POST** | **503 `{"error":"not_configured"}`** = **3xx ではない** ✅ リダイレクトされていない |
| 参考: `keiba-intelligence.netlify.app/mypage` | **301 → `https://keiba-intelligence.jp/mypage`**（罠が実在することの裏付け）|
| 本番 `/` `/pricing` `/mypage` | **200**（無傷）|

🟢 **`main` とツリーが完全一致していると Netlify が
`Canceled build due to no content change` でビルドをスキップする。**
そのため QA ブランチには `astro-site/public/qa-marker.txt` を 1 ファイルだけ置いてある。
🔴 **この marker コミットを `main` へ merge しない。**

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

### 3.5' env の実施結果（2026-09-10）

#### `AIRTABLE_*` のコンテキスト別分離 — ✅ PASS

`updateEnvVar` で `all` の 1 値を **`production` / `deploy-preview` / `dev` / `dev-server` へ
同一値のまま複製**し、`branch-deploy` だけを別扱いにした（1 回の呼び出しで原子的に置換）。

| 検証 | 結果 |
|---|---|
| 変換前後の全 25 env の突き合わせ | **構造が変わったのは `AIRTABLE_API_KEY` / `AIRTABLE_BASE_ID` の 2 件のみ** |
| 🔴 production に注入される値の変化 | **0 件**（sha256 で byte 一致を確認）|
| `AIRTABLE_*` に `all` の残存 | **なし** |
| 本番 `/` `/pricing` `/mypage` | **200** |

🔴 **値はチャット・ログ・repo のいずれにも出していない。** 照合は sha256 の先頭 10 桁のみ。

#### branch-deploy スコープの現在値

🟢 **2026-09-10 時点で 8 キーすべて設定済み。**（下表は分離作業直後の記録。
その後 `AIRTABLE_API_KEY` / `STRIPE_SECRET_KEY` / `STRIPE_PRICE_PREMIUM` /
`STRIPE_WEBHOOK_SECRET` を仕様所有者が設定し、**すべて production と別値**であることを確認した。§3.9）

| キー | branch-deploy | 備考 |
|---|---|---|
| `AIRTABLE_BASE_ID` | ✅ QA base | production と**別値**であることを確認済み |
| `MEMBERSHIP_READ_ENABLED` | ✅ `true` | 追加のみ。production の値は不変 |
| `MEMBERSHIP_WRITE_ENABLED` | ✅ `true` | 同上。🟢 機能フラグなので production と同じ `true` でよい |
| `SESSION_SIGNING_SECRET` | ✅ 既存の branch-deploy 専用値 | 🔴 **production とは別値**であることを確認済み（QA の Cookie は本番で通用しない）|
| `STRIPE_PORTAL_RETURN_URL` | 🟡 **意図的に未設定** | 下記 |
| `AIRTABLE_API_KEY` | 🔴 **未設定** | QA PAT の値が必要 |
| `STRIPE_SECRET_KEY` | 🔴 **未設定** | Test の secret key が必要 |
| `STRIPE_PRICE_PREMIUM` | 🔴 **未設定** | Test の Price id が必要 |
| `STRIPE_WEBHOOK_SECRET` | 🔴 **未設定** | 送信先を作ると発行される |

🟢 **未設定の 4 つは fail-closed で正しく止まっている。**
QA ホストへの webhook POST は **503 `{"error":"not_configured"}`** を返す。
`AIRTABLE_API_KEY` が無いため、**QA デプロイは Airtable へ一切接続できない**
（`MEMBERSHIP_WRITE_ENABLED=true` でも書けない）。値を入れた後は
`AIRTABLE_BASE_ID` が QA base を指すので、**production base へは到達しない**。

#### 🟡 `STRIPE_PORTAL_RETURN_URL` を意図的に未設定にした理由

1. `netlify/functions/stripe-portal.js:69` の fallback は `${resolveSiteOrigin(headers)}/mypage`。
   `src/lib/http/siteOrigin.js` の `isAllowedSiteHost()` は **`*.netlify.app` を許可**するため、
   branch deploy では **設定した場合とまったく同じ URL** になる。
2. 🔴 本書に branch deploy の URL を**文字列として書いてある**。
   Netlify の Secret Scanning は **env の値と repo 内の文字列の一致**でビルドを落とすので、
   同じ URL を env に入れると **QA ビルドが `Exposed secrets detected` で red になる**。

**設定しないほうが安全で、挙動は同一。**

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

## 3.9 E2E 実行前チェック（2026-09-10 実測・**全項目 PASS**）

Stripe Test の webhook 送信先（5 イベント / `status=enabled`）と
`STRIPE_WEBHOOK_SECRET` を仕様所有者が設定した後の実測。

### A. env が QA デプロイの関数へ実際に入ったか

🔴 **Netlify の env は「次のビルド」から関数へ入る。** 設定しただけでは反映されない。

| 時点 | QA ホストへの webhook POST |
|---|---|
| env 設定直後（再デプロイ前）| **503 `{"error":"not_configured"}`** ＝ 未反映 |
| QA を再デプロイした後 | ✅ **400 `{"error":"invalid_signature"}`** ＝ **反映済み**（署名検証まで到達）|

branch-deploy の 8 キーはすべて設定済み。

🔴 **Stripe の 3 キーは Netlify で `is_secret=true` になっており、API から値を読めない**
（`***` にマスクされる）。したがって **env の突き合わせでは production と別値だと確認できない**。
確認できるのは下表のとおり **実際の挙動**である。

| キー | `is_secret` | production と別値だと確認できたか |
|---|---|---|
| `AIRTABLE_API_KEY` | `false` | ✅ **確認済み**（値を読んで sha256 で照合。さらに QA PAT は production base へ **403**）|
| `AIRTABLE_BASE_ID` | `false` | ✅ **確認済み** |
| `SESSION_SIGNING_SECRET` | `false` | ✅ **確認済み** |
| `STRIPE_SECRET_KEY` | 🔴 `true` | ❌ 読めない。**代わりに実挙動で確認** → QA から作った Checkout Session の id が **`cs_test_…`**（live 鍵なら `cs_live_…`）|
| `STRIPE_PRICE_PREMIUM` | 🔴 `true` | ❌ 読めない。Checkout が **200 を返した**＝ Price が Test Mode に実在する |
| `STRIPE_WEBHOOK_SECRET` | 🔴 `true` | ❌ 読めない。**署名なし POST が `invalid_signature`** ＝ 何らかの secret が入っている。**別値である保証は Stripe 側の仕様**（test / live は別、endpoint ごとに別）に依る |

`MEMBERSHIP_READ_ENABLED` / `MEMBERSHIP_WRITE_ENABLED` は機能フラグなので
production と同じ `true` でよい。

### B. 🔴 Airtable の隔離（二重）

| 検証 | 結果 |
|---|---|
| QA base の中身（QA PAT で read）| `Customers` / `AuthTokens` / `RewardLedger` / `RewardRedemptions` = **すべて 0 件** |
| 🔴 **QA PAT で production base を読む** | **HTTP 403 到達不可** ✅ |
| production base の基準値（E2E 後の比較用）| `Customers` **81** / `AuthTokens` **696** / `RewardLedger` **2** / `RewardRedemptions` **0** |

🟢 **隔離は二重になっている。**
① branch-deploy の `AIRTABLE_BASE_ID` が QA base を指す。
② 仮に base id を取り違えても、**QA PAT は production base へ 403 で弾かれる**。

### C. production への影響

| 検証 | 結果 |
|---|---|
| 本日の全作業後、**production に注入される env 値**が変化した env | **0 件**（全 25 env を sha256 で突き合わせ）|
| env の増減 | **なし**（25 → 25）|
| 本番 `/` `/pricing` `/mypage` | **200** |
| 本番 guest の `/prediction/{nankan,jra}` | **302**（fail-closed）|
| Test イベントが誤って本番へ届いた場合 | production と branch-deploy の `STRIPE_WEBHOOK_SECRET` は**別値**なので、**署名検証に失敗して 400**（fail-closed）|

---

## 4. 月数を進めて変化を見る

### 4.0 🔴 経路を 2 つに分ける理由（2026-09-10 に判明）

`astro-site/netlify/functions/stripe-create-checkout.js:98` は
Checkout Session に **`customer_email` だけ**を渡しており、**`customer` を渡していない**。

```js
mode: 'subscription',
line_items: [{ price: priceId, quantity: 1 }],
customer_email: ent.email,        // 🔴 customer は渡していない
client_reference_id: ent.email,
```

Stripe の仕様では、この場合 **Checkout が新しい Customer を作る**。
したがって **事前に作った Test Clock Customer には Subscription が紐付かない**。
Test Clock で時計を進めても、その Subscription には請求が発生しない。

🔴 **production コード・auth 仕様は変更しない。**
代わりに検証を **2 経路**へ分ける。

| 経路 | 何を通すか | 何を確かめるか |
|---|---|---|
| **A: 通常 Checkout（1 回だけ）** | ✅ **実際の `stripe-create-checkout.js` を通る** | 本番の入口そのもの。初月ぶんの一次情報 |
| **B: Test Clock（1→3→12→24 か月）** | 🔴 **`stripe-create-checkout.js` を通らない**（API で Session を作る）| 月数・ランク・ポイントの推移 |

🔴 **B は本番の入口を通らない。** B の結果をもって
「`stripe-create-checkout.js` が正しい」とは記録しない。入口の検証は **A が正本**。

---

### 4.A 経路 A — QA `/pricing` から通常の Test Checkout を 1 回

**そのまま本番と同じ道を通す。** Test Clock は使わない。

1. QA の branch deploy で QA 会員としてログインする
2. `/pricing` の購入ボタンから Checkout を開く
   （→ `stripe-create-checkout.js` が Session を作る）
3. Test Mode のカードで決済する
4. `checkout.session.completed` → `invoice.payment_succeeded` が QA の
   `stripe-webhook.js` へ届く

#### 確認する項目

| 対象 | 期待 |
|---|---|
| `stripe-create-checkout.js` | **200 と Checkout URL**（QA の origin へ戻る `success_url`）|
| `checkout.session.completed` | QA `Customers` の `PlanType` / `Status` が更新される |
| 初回 `invoice.payment_succeeded` | `RewardLedger` に **`accrual` 1 行**（`periodMonths=1`）|
| `MembershipStartedAt` | **保存される**（空でない）|
| `ContractPriceYen` / `ContractPriceId` / `ContractCurrency` / `ContractStartedAt` | **4 列とも保存される** |
| `/mypage` | **継続 1 か月 / Bronze / 100 pt** |

---

#### 実績（2026-09-10・カード入力の直前まで）

| # | 手順 | 結果 |
|---|---|---|
| 1 | QA `Customers` へ QA 会員を **1 件だけ**作成 | ✅ `qa+stripe-testmode@keiba-intelligence.jp` / `PlanType=free-registered` / `Status=active` / `AccessEnabled=✓` |
| 2 | ログイン | ✅ **QA 専用 `SESSION_SIGNING_SECRET` でセッションを発行**（tier=`free`）|
| 3 | QA `/mypage` | ✅ **200**・QA 会員の Email が表示・「無料会員」「KI 会員クラブ」を含む |
| 4 | 🔴 **実際の `stripe-create-checkout.js`** へ POST（`plan: premium`）| ✅ **200** と Checkout URL。id は **`cs_test_…`** ＝ **Test Mode** |
| 5 | カード入力・決済 | ✅ **完了**（仕様所有者）|

#### 決済後の read-only 確認（2026-09-10）

| 確認対象 | 結果 |
|---|---|
| `PlanType` | ✅ `free-registered` → **`premium`** |
| `Status` | ✅ `active` |
| **初回 invoice → `RewardLedger`** | ✅ **1 行**・`Type=accrual`・`Points=100`・`PeriodMonths=1`・`EntryId=accrual:<email>:<invoice id>` |
| `ContractPriceYen` | ✅ **3980** |
| `ContractPriceId` | ✅ Test の Price id が入っている（🔴 値は repo に書かない）|
| `ContractCurrency` | ✅ `jpy` |
| `ContractStartedAt` | ✅ `2026-09-10` |
| `/mypage` の表示 | ✅ **Bronze** / **1 か月** / **100 pt** / **¥3,980** |
| 🔴 **`MembershipStartedAt`** | 🔴 **空のまま**（下記）|
| QA の他テーブル | `AuthTokens` 0 件 / `RewardRedemptions` 0 件 |

🟢 **`ContractPrice*` 4 列と初回 accrual は期待どおり保存された。**
Bronze・1 か月・100pt も一致。**本番と同じ webhook 経路**で確認できた。

#### ✅ 解決済み — Stripe 経由で `MembershipStartedAt` が書かれなかった（**既知の実装欠落**）

`stripe-webhook.js` は membership store の
**`saveContractPrice()` と `appendEntry()` しか呼んでいない**。
`MembershipStartedAt`（`airtableStore.js` の `CUSTOMER_FIELDS.STARTED_AT`）は
**読まれるだけで、Stripe 経路からは一度も書かれない**。
書いているのは銀行振込経路（`bankTransfer.js`）だけ。

🟢 **今回の表示が正しかった理由**: `membershipView.js` の `resolveTenureMonths()` は
**台帳（`RewardLedger`）があればそちらを使う**。`startedAtIso` は台帳が読めないときの
フォールバックにすぎない。

🔴 **これは「未確定の仕様」ではなく「既知の実装欠落」だった。**
起点の仕様は **2026-09-01 に TBD-9 として確定済み**（`docs/MEMBERSHIP_REWARDS.md` §7.6）で、
**Stripe 側の実装だけが入っていなかった**。

**修正済み: PR #127**（`fix/stripe-membership-started-at`）。
`invoice.payment_succeeded` で台帳へ積んだあと `saveMembershipStart()` を呼ぶ。
起点は `status_transitions.paid_at`。**初回だけ書き、更新で動かさない。**
🔴 既存データの backfill はしない（§7.6「起点が不明な会員は空のまま・推測で埋めない」）。

🔴 **magic link は使っていない。**
`SENDGRID_API_KEY` は `all` スコープのままなので、QA からマジックリンクを要求すると
**production の SendGrid で実際にメールが飛ぶ**。外部送信は承認境界なので、
QA 専用のセッション鍵で Cookie を発行する方法を採った（**production の auth 仕様は未変更**）。

🟢 実行直後の確認: QA `Customers` **1 件** /
production は **`Customers` 81・`AuthTokens` 696・`RewardLedger` 2・`RewardRedemptions` 0 で不変** /
QA PAT は production base へ **403** のまま / 本番 **200**・guest **302**。

---

### 4.B 経路 B — Test Clock で 1 → 3 → 12 → 24 か月

🔴 **この経路は `stripe-create-checkout.js` を通らない。**
Test Clock Customer を先に作り、**その Customer ID を指定した Checkout Session を
Stripe API で直接作る**。

1. **Test Clock** を作る
2. その Test Clock に紐づく **Customer** を作る
3. **その Customer ID を指定して** Checkout Session を API で作る
4. 返ってきた URL を開き、Test Mode のカードで決済する
5. Test Clock を **1 か月**進める → 自動更新請求 → 台帳が増える
6. 必要な回数だけ 5 を繰り返す

#### 🔴 Session の契約は現行 production Checkout に合わせる

`stripe-create-checkout.js:94-113` と **同じ値**にする。
違うのは `customer_email` → `customer` の 1 点だけ。

| 項目 | 値 | 出どころ |
|---|---|---|
| `mode` | `subscription` | 同上 |
| `line_items` | `[{ price: <STRIPE_PRICE_PREMIUM>, quantity: 1 }]` | 🔴 **env の値**。`priceIdFor()` と同じ |
| **`customer`** | 🔴 **Test Clock の Customer ID** | **ここだけが差分**（`customer_email` は同時に指定できない）|
| `client_reference_id` | QA 会員の Email | 同上 |
| `allow_promotion_codes` | `true` | 同上 |
| `success_url` | `<QA branch deploy>/mypage?checkout=success` | 同上（origin が QA になる）|
| `cancel_url` | `<QA branch deploy>/pricing?checkout=cancelled` | 同上 |
| `metadata` | `{ ki_plan: 'premium', ki_email: <QA 会員>, ki_price_id: <Price ID> }` | 同上 |
| **`subscription_data.metadata`** | **同じ 3 キー** | 🔴 **必須** |

🔴 **`subscription_data.metadata` を落とすと Test Clock の請求が会員へ紐付かない。**
`stripe-webhook.js` の `emailFromInvoice()` は
`invoice.parent.subscription_details.metadata.ki_email` を読む。
ここが空だと `invoice.customer_email` へ落ちるため、Customer の請求先メールが
QA 会員と一致していないと **台帳が積まれない**。

#### 🔴 経路 B は **別の QA 会員**で行う（経路 A の会員を使い回さない）

継続月数は `tenureMonthsFromLedger()` が
**その会員の accrual の `periodMonths` を合算**して出す。
経路 A の会員には既に **1 か月・100 pt** が積まれているため、
同じメールアドレスで経路 B を始めると **1 → 3 → 12 → 24 が観測できない**
（実際には 2 → 4 → 13 → 25 になる）。

🔴 **経路 B 用に新しいメールアドレスの QA 会員を 1 件作る。**
経路 A のレコード・台帳は**消さない**（経路 A の実績として残す）。

🟢 新しい会員なら `MembershipStartedAt` も空から始まるので、
**PR #127（初回請求だけ起点を書く）の検証もそのまま行える**。

#### 実行前に要るもの

| # | 前提 | 状態 |
|---|---|---|
| 1 | QA branch deploy が `#126` / `#127` を載せている | ✅ **確認済み**（下記）|
| 2 | Stripe Test の webhook 送信先が QA を向いている | ✅ 5 イベント / `status=enabled` |
| 3 | 経路 B 用の **新しい QA 会員**（`Customers` に 1 件）| 🔴 未作成 |
| 4 | `STRIPE_SECRET_KEY`（Test）| 🔴 **仕様所有者しか読めない**（下記）|

#### 手順（`astro-site/scripts/qaTestClock.mjs`）

契約を取り違えないよう、`stripe-create-checkout.js:94-113` と同じ値を組み立てる
スクリプトを用意した。**差分は `customer_email` → `customer` の 1 点だけ**。

```bash
cd astro-site
STRIPE_SECRET_KEY=sk_test_... \
STRIPE_PRICE_PREMIUM=price_... \
QA_ORIGIN=https://qa-stripe-testmode--keiba-intelligence.netlify.app \
QA_EMAIL=<経路 B 用の新しいアドレス> \
node scripts/qaTestClock.mjs start
# → test_clock / customer / Checkout URL が出る。カードを入力して決済する

STRIPE_SECRET_KEY=sk_test_... node scripts/qaTestClock.mjs advance <clock_id> 2   # 1 → 3 か月
STRIPE_SECRET_KEY=sk_test_... node scripts/qaTestClock.mjs advance <clock_id> 9   # 3 → 12 か月
STRIPE_SECRET_KEY=sk_test_... node scripts/qaTestClock.mjs advance <clock_id> 12  # 12 → 24 か月
```

- 🔴 `sk_test_` 以外の鍵は**受け付けずに中止**する。
- 🔴 `QA_ORIGIN` が branch deploy の形でなければ**中止**する（本番へ戻す設定を作らない）。
- 🔴 鍵・Price id は**出力しない**。
- `advance` は Stripe 側が `ready` に戻るまで待つ（この間に webhook が飛ぶ）。

#### 🔴 経路 B の実行主体（2026-09-10 時点の制約）

`STRIPE_SECRET_KEY` は Netlify で `is_secret=true` のため **値を読めない**。
したがって **Test Clock / Customer / Checkout Session を作る API 呼び出しは、
鍵を持っている仕様所有者が実行する**。
（Test Clock と Customer は Stripe ダッシュボードでも作れるが、
**Customer を指定した Checkout Session の作成は API / CLI が要る**。）

🔴 `ki_plan` は `plans.js` の `id: 'premium'`、
`ki_price_id` は **env `STRIPE_PRICE_PREMIUM` の値そのもの**
（`stripe-webhook.js` はこれを読んで契約価格を記録する）。

### 4.C 目視できる変化（ランク閾値はコード定数 0 / 3 / 12 / 24）

🔴 1 か月ぶんは **経路 A** で、3 / 12 / 24 か月は **経路 B** で見る。

| 進めた月数 | 継続月数 | ランク | 残高（100pt/月）|
|---|---|---|---|
| 1 | 1 か月 | **Bronze** | 100 pt |
| 3 | 3 か月 | **Silver** | 300 pt |
| 12 | 12 か月 | **Gold** | 1,200 pt |
| 24 | 24 か月 | **Platinum** | 2,400 pt |

🟡 **24 か月まで見るには Test Clock を 24 回進める**（1 回あたり数十秒）。
年額 Price なら 2 回で 24 か月（`periodMonths=12`×2）だが、
「月次の決済成功を進めて見る」目的からは外れる。

### 4.D 契約価格・価格ロックの確認

Stripe の Checkout を通すと `stripe-webhook.js` が `ContractPrice*` を保存する。
`/mypage` の「現在の契約価格」「継続価格ロック」が**準備中 → 実値**へ変わる。

🔴 **Stripe の契約は請求期間を保存していない**ため、`/mypage` は
**期間表記なしで金額だけ**を出す（銀行振込の `bank:yearly` は `/ 年` と出る）。
期間まで出すには契約価格に期間を保存する必要があり、**別途の仕様判断**。

### 4.E プレゼント・交換の確認

600 pt（6 か月）で交換ラインが開く。`/mypage` のカタログで
「あと ◯ pt」→「交換できます」へ変わる。
🔴 記念品の月（12 / 24 か月）は **通常交換が止まる**（保守ライン S-2）。

### 4.F 🔴 E2E の最後に必ず再確認する

| 検証 | 期待 |
|---|---|
| QA base の 4 テーブル | **増えている**（＝ QA へ書けている）|
| 🔴 **production base の件数** | **基準値から不変**: `Customers` **81** / `AuthTokens` **696** / `RewardLedger` **2** / `RewardRedemptions` **0** |
| 🔴 QA PAT で production base を読む | **HTTP 403 到達不可**のまま |
| production に注入される env 値 | **変化 0 件**（全 env を sha256 で突き合わせ）|
| 本番 `/` `/pricing` `/mypage` | **200** / guest 予想 **302** |

🔴 **production の件数が 1 件でも増えていたら、そこで停止して報告する。**

---

## 5. 後片付け（QA を止めるとき）

| # | 対象 | 内容 |
|---|---|---|
| 1 | Netlify | Branch deploys スコープの env を削除（🔴 `AIRTABLE_API_KEY` / `AIRTABLE_BASE_ID` は**削除ではなく、`all` の 1 値へ戻す**）|
| 2 | Netlify | 対象ブランチの branch deploy を削除（🔴 **ページングして全件**）|
| 3 | Netlify | `allowed_branches` を **`["main"]`** へ戻す |
| 4 | Git | QA ブランチ `qa-stripe-testmode` を削除（🔴 `qa-marker.txt` ごと消える。**main へ merge しない**）|
| 5 | Stripe | Test の Customer / Subscription / Test Clock / Webhook 送信先を削除 |
| 6 | Airtable | 🔴 **QA base ごと削除してよい**（実会員は 1 件も入っていない）|

🟢 **production の env・base・会員には最初から触らない**ので、戻す作業は無い。

---

## 6. rollback

| 状況 | 戻し方 |
|---|---|
| QA base を作った後 | base を削除する。production には影響しない |
| branch env を入れた後 | env を削除して branch deploy を消す |
| `allowed_branches` を変えた後 | **`["main"]`** へ戻す |
| 🔴 **`AIRTABLE_*` の分離を戻したい** | `production` の値を `all` の 1 値へ戻す。**変換前のスナップショットは残していない**ので、`production` の現在値が正（本作業で byte 一致を確認済み）|
| 🔴 production への影響 | **無い**（env・base・鍵をすべて分けており、production 値の byte 一致を実測済み）|

---

## 7. 🔴 やってはいけないこと

1. production base を**複製**して QA を作る（実会員が複写される）
2. 本番の read/write PAT を QA env へ入れる
3. `SESSION_SIGNING_SECRET` を本番と同じにする
4. Stripe の実キー・Price id・本番 URL を **repo に書く**（ビルドが落ちる）
5. `SECRETS_SCAN_OMIT_*` で secrets scanning を無効化する
6. QA の検証結果をもって**本番の実測**と記録する
7. 🔴 **経路 B（Test Clock）の結果をもって `stripe-create-checkout.js` を検証したと記録する**
   （B は本番の入口を通らない。入口の検証は **経路 A が正本**）
8. `customer_email` を `customer` に変える等、**production コードを QA の都合で書き換える**
9. `qa-marker.txt` と空コミットを `main` へ merge する
10. `allowed_branches` に QA 以外のブランチを足したまま放置する
   （`branch-deploy` の env は**すべての branch deploy に効く**）
