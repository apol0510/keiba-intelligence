# 恒久 UAT 環境 — 正本

**管理者が実ユーザー体験を定期的に目視確認するための、production と完全隔離した常設環境。**

方針確定: 2026-09-11。これ以前の `docs/QA_STRIPE_TESTMODE_RUNBOOK.md` は
**一回限りの QA** を前提にしていた。恒久環境としての正本は**本書**である。

---

## 1. 位置づけ（何であって、何でないか）

| | |
|---|---|
| ✅ これは | 常設の UAT。会員登録済みの状態・決済・/mypage の見え方を、**本番と同じコードで**定期的に目視確認する場所 |
| ❌ これは | 使い捨ての QA ではない。**毎回 base や env を作り直さない** |
| ❌ これは | 本番の課金導線ではない。Stripe は **Test Mode 固定** |

🔴 **本環境の後片付け（`QA_STRIPE_TESTMODE_RUNBOOK.md` §5）を実行してはいけない。**
片付けてよいのは「使い捨て資産」と「production 混入」だけ（§7）。

---

## 2. 🔴 隔離契約（ここを緩めない）

| 経路 | 隔離のしかた | 破れたときに何が起きるか |
|---|---|---|
| **Airtable** | UAT 専用 base ＋ UAT 専用 PAT（production base を含めない） | テスト会員が本番会員表に入る |
| **Stripe** | **Test Mode の鍵のみ**。webhook 送信先も Test の別 endpoint | 実課金が走る |
| **セッション Cookie** | `SESSION_SIGNING_SECRET` を production と**別値** | UAT の Cookie が本番で通用する |
| **メール** | `previewMailGuard` が UAT ホストの送信 8 関数を **503** で止める | 本番 SendGrid から実送信され、バウンスが本番の送信者評価に付く |
| **env** | UAT の値は **branch-deploy スコープのみ**。production スコープに置かない | 本番に UAT の値が注入される |
| **ログイン** | `uat-login` は **本番ホストで常に 404**（§5） | 本番に認証の穴が空く |

🔴 **UAT で magic link を使わない。** メールは上記のとおり塞いである（PR #129）。
ログインは §5 の専用経路だけを使う。

---

## 3. 構成（最小）

| 要素 | 値 | 備考 |
|---|---|---|
| ブランチ | `uat`（長寿命） | 🔴 **`main` へ merge しない** |
| ホスト | `uat--keiba-intelligence.netlify.app` | branch deploy |
| `allowed_branches` | `["main","uat"]` | 🔴 他のブランチを足したまま放置しない（branch-deploy の env は**すべての branch deploy に効く**） |
| marker | `astro-site/public/uat-marker.txt` | 🟢 これが無いと Netlify が `Canceled build due to no content change` でビルドをスキップする |
| Airtable | UAT 専用 base（4 テーブル / 57 列） | `npm run qa-base:bootstrap` で作成、`--check` で照合 |
| UAT 会員 | `Customers` に **1 行だけ** | §4 |
| Stripe | Test Mode。**既存の Test Price を流用**（新規作成不要） | webhook 送信先は UAT ホスト宛 |

### branch-deploy スコープに要る env（🔴 値は本書に書かない）

| キー | 内容 | 未設定時 |
|---|---|---|
| `AIRTABLE_API_KEY` | UAT 専用 PAT | Airtable へ一切接続できない |
| `AIRTABLE_BASE_ID` | UAT base | 同上 |
| `SESSION_SIGNING_SECRET` | 🔴 production と**別値** | 全閲覧者 guest 扱い |
| `STRIPE_SECRET_KEY` | Test の secret key | Checkout が成立しない |
| `STRIPE_WEBHOOK_SECRET` | Test 送信先の署名シークレット | webhook が **503 `not_configured`** |
| `STRIPE_PRICE_PREMIUM` | Test の Price id | Checkout が成立しない |
| `MEMBERSHIP_READ_ENABLED` | `true` | /mypage の会員クラブ表示が出ない |
| `MEMBERSHIP_WRITE_ENABLED` | `true` | 台帳が動かない |
| `UAT_LOGIN_KEY` | §5 の合言葉 | **UAT ログインが 503**（fail-closed） |

🟡 `STRIPE_PORTAL_RETURN_URL` は **設定しない**。`stripe-portal.js` の fallback が
`resolveSiteOrigin(headers)/mypage` を返し、branch deploy では設定した場合と同じ URL になる。
🔴 **本書に書いてある URL を env の値に入れない。** Netlify の Secret Scanning は
「env の値」と「repo 内の文字列」の一致でビルドを落とす（2026-09-02 / 09-06 / 09-10 に実際に発生）。
`SECRETS_SCAN_OMIT_*` での回避は禁止。

---

## 4. UAT 会員（1 行だけ）

UAT base の `Customers` に次の 1 行を作る。

| 列 | 値 |
|---|---|
| `Email` | `uat@keiba-intelligence.jp` |
| `PlanType` | `free-registered` |
| `Status` | `active` |
| `AccessEnabled` | ✓ |

🔴 **このアドレスは `src/lib/auth/uatLogin.js` の `UAT_MEMBER_EMAIL` と一致させる。**
コード側は定数で固定してあり、リクエストから宛先を受け取らない。
🔴 実顧客のアドレスを使わない。メールは送らないので受信可能である必要はない。

---

## 5. ログイン経路（正本）

`POST /.netlify/functions/uat-login`

実装: `netlify/functions/uat-login.js`（薄いアダプタ）＋ `src/lib/auth/uatLogin.js`（判定）
テスト: `src/lib/auth/uatLogin.test.mjs` / `uatLogin.guard.test.mjs`（`npm run test:auth` に同梱）

### 🔴 安全契約（7 つ。緩めない）

1. **本番ホストでは常に無効。** `isPreviewHost()` が false なら**メソッドを問わず 404**。
   エンドポイントの存在自体を本番に晒さない
2. **`UAT_LOGIN_KEY` 未設定なら 503**（fail-closed）
3. **合言葉を URL に載せない。** 受け取りは **POST の body だけ**。
   GET は合言葉を受け付けず、入力フォームを返すだけ
   （クエリ・履歴・Referer・アクセスログに合言葉を残さないため）
4. 照合は **timing-safe**。長さが違えば即拒否
5. 不一致は **404**（「合言葉が違う」と教えない）
6. 🔴 **発行できるのは固定 1 アドレスの `free` セッションだけ。**
   宛先も tier も**リクエストから受け取らない**。
   **この関数は有料 tier を発行できない**
7. 合言葉を message / log / レスポンスに含めない

### 🔴 なぜ free 固定なのか

premium を直接発行できてしまうと、**確認したい体験そのもの（決済 → webhook → 反映）を
迂回する**ことになり、UAT の意味が消える。premium は必ず
**Test Mode の実決済 → `stripe-webhook` → `refresh-session`** を通ってのみ成立する。

### 使い方

1. `https://uat--keiba-intelligence.netlify.app/.netlify/functions/uat-login` を開く
2. 合言葉を入力して送信（POST）
3. `ki_session` Cookie が発行され `/mypage` へ

---

## 6. 定期確認の手順（目視 UAT）

| # | 見るもの | 期待 |
|---|---|---|
| 1 | ログイン（§5） | `/mypage` に着地。無料会員として表示される |
| 2 | 予想ページ | 無料会員の見え方（印まで。買い目はモザイク） |
| 3 | `/pricing` | 申し込み導線が出る |
| 4 | Test カードで決済 | Checkout が完了し `/mypage?checkout=success` へ戻る |
| 5 | `/mypage` | 契約価格 / 価格ロック / ランク / 継続月数 / 残高 / 今月の積み上げ / 次ランク進捗 の **7 項目** |
| 6 | 予想ページ（決済後） | 買い目が開く（premium の見え方） |
| 7 | 🔴 本番 | `/` `/pricing` `/mypage` **200**、guest 予想 **302** のまま |

🟢 tier ごとの**見え方だけ**を確認したいときは、ログイン不要の
`?view=free` / `?view=premium&key=…`（`previewMode.js`）が使える。
ただしこれは**表示のプレビューであって、会員・決済・台帳は動かない**。

---

## 7. cleanup 方針（何を消して、何を残すか）

| 区分 | 例 | 扱い |
|---|---|---|
| 🟢 **恒久資産（消さない）** | `uat` ブランチ / UAT base / UAT PAT / branch-deploy の env / Test webhook 送信先 / UAT 会員 1 行 | **残す** |
| 🔴 **使い捨て資産（消す）** | Test Clock（シミュレーション）/ 検証のたびに増えたテスト Customer・Subscription / 一時ブランチとその branch deploy | 確認が終わったら消す |
| 🔴 **production 混入（消す）** | production base に入ったテスト行 / production env に混ざった UAT の値 | **見つけ次第、承認のうえ消す** |

🔴 **production 混入の削除は不可逆。** 対象を id で特定し、実会員でないことを確認してから消す。
名前や見た目で判断しない（production base と UAT base は名前が似る）。

---

## 8. 🔴 やってはいけないこと

1. production base を**複製**して UAT を作る（実会員が複写される）
2. 本番の read/write PAT を UAT env へ入れる
3. `SESSION_SIGNING_SECRET` を本番と同じにする
4. Stripe の実キー・Price id・本番 URL を **repo に書く**（ビルドが落ちる）
5. `SECRETS_SCAN_OMIT_*` で secrets scanning を無効化する
6. **UAT から magic link を要求する**（本番 SendGrid で実送信される）
7. `previewMailGuard` を UAT のために緩める
8. `uat-login` を **premium を発行できるように**変える（§5 契約 6）
9. `uat-login` の合言葉を **GET / クエリ**で受けるように変える（同 契約 3）
10. `uat-marker.txt` を `main` へ merge する
11. `allowed_branches` に UAT 以外のブランチを足したまま放置する
12. UAT の検証結果をもって**本番の実測**と記録する

---

## 9. 承認が要る作業（仕様所有者が行う）

コード側（本書 §5）は実装済み。環境側は **secret を扱うため Claude は実行しない**。

| # | 作業 | 場所 | 状態（2026-09-12）|
|---|---|---|---|
| 1 | UAT base の作成（空の base から。複製しない） | Airtable UI | ✅ 完了 |
| 2 | UAT 専用 PAT の発行（UAT base のみ。スコープ 4 種） | Airtable UI | ✅ 完了 |
| 3 | スキーマ作成 → `npm run qa-base:bootstrap` / `-- --apply` / `-- --check` | ターミナル | ✅ **完了**（4 テーブル / 57 列・全 0 件・extra なし・exit 0）|
| 4 | UAT 会員 1 行の作成（§4） | Airtable UI | ✅ 完了 |
| 5 | `uat` ブランチ作成（`main` ＋ `uat-marker.txt`） | git | ✅ 完了 |
| 6 | `allowed_branches` に `uat` を追加 | Netlify | ✅ 完了（`["main","uat"]`）|
| 7 | branch-deploy スコープの env（§3 の 9 キーのうち**残り 8 キー**。`SESSION_SIGNING_SECRET` は設定済み）| Netlify | 🔴 **未実施** |
| 8 | Stripe Test の webhook 送信先を UAT ホスト宛に作成 → `STRIPE_WEBHOOK_SECRET` を設定 | Stripe / Netlify | 🔴 **未実施** |

🟢 **UAT base は完成**（1〜4 完了）。`--check` は**再実行しない**。
残るのは 7・8 の env と webhook 送信先だけ。それが入るまで UAT は fail-closed のままで、
`uat-login` は UAT ホストで **503 `not_configured`**、本番では **404** を返す（いずれも実測済み）。

🔴 3・7・8 は **PAT / secret / 合言葉の値そのもの**を扱う。
Claude は secret を入力欄へ入れない（値を見ない・持たない）。

### 🔴 スキーマ作成の順序と注意（2026-09-11 の 422 を踏まえて）

1. `npm run qa-base:bootstrap`（dry-run。対象 base が UAT であることを目視）
2. `npm run qa-base:bootstrap -- --apply`
3. `npm run qa-base:bootstrap -- --check`
4. **そのあとで** UAT 会員 1 行を作る（§4）

🔴 **`--check` は「レコード 0 件」も合格条件**（production base を複製していないことの裏取り）。
**会員 1 行を先に作ると `--check` は exit 1 で落ちる。** 必ず上の順序で行う。

🔴 **`AIRTABLE_BASE_ID`（production）を必ず export する。**
`assertNotProduction()` は **fail-closed**（2026-09-12）。
比較相手が無いと誤爆を判定できないため、**production 側が未設定なら中止する**。
中止するのは次の 3 ケース:

1. `AIRTABLE_QA_BASE_ID` が未設定 / 形式不正
2. `AIRTABLE_BASE_ID`（production）が未設定
3. 対象 base が production base と同じ

いずれも**ネットワークへ出る前**に止まる。

🟡 **Metadata API は「読み取り時の形」と「作成時に要求される形」が違う。**
2026-09-11 に `dateTime` の `timeFormat` 欠落で 422
`INVALID_FIELD_TYPE_OPTIONS_FOR_CREATE` を踏んだ。
現在は `validateCreateField()` が**送信前に**検証して落とすため、
同種の誤りはネットワークへ出る前に止まる（`npm run test:qa-base` が回帰を守る）。
