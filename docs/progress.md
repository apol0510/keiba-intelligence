# Project Progress

> 本書は **KEIBA Intelligence（KI）の進捗の正本**である。
> 新しいセッションはまず `docs/spec.md` → 本書 → `docs/decisions.md` → `CLAUDE.md` の順に読むこと。
> 初版作成: 2026-07-20（基準コミット `1875508` = 作成時点の origin/main）
>
> **本書は PR #69 で新規追加された、KI リポジトリにおける進捗の正本である。**


### 2026-09-02 購入導線の ReferenceError 修正（`3de357a7`）

- **症状**: 未ログインで「このプランを申し込む」を押すと、メール確認フォームが出ず
  「現在お申し込みを受け付けられません。しばらくしてからお試しください。」だけが表示された。
- **原因**: `openPurchaseAuth` / `submitPurchaseAuth` / `resumeCheckout` を
  `DOMContentLoaded` コールバックの内側に定義したため、外側スコープの `startCheckout` から参照できず、
  401 分岐で ReferenceError → `startCheckout` 自身の catch が汎用エラーを表示していた。
  エンドポイント側は正常（`stripe-create-checkout` は cookie 無しで 401 `login_required`）。
- **修正**: 購入導線の関数を `startCheckout` と同じ外側スコープへ移動。
  `DOMContentLoaded` 内はフォーム束縛と `resumeCheckout()` 呼び出しのみ。
- **再発防止**: `purchaseIntent.test.mjs` に「4関数すべてが `DOMContentLoaded` より前に定義されている」ことを固定（billing 48→49件）。
- **検証**: branch deploy で実クリック確認済み。CTA 押下 → 汎用エラーなし →
  `#pr-purchase-auth` が `hidden=false` になりフォームが表示され、入力欄にフォーカスが入る。
- **未実施**: Test Mode の新規購入本体（確認メール送信以降）はユーザー操作待ちで停止。


### 2026-09-02 購入導線: 502 send_failed の修正と CTA の 2 色化（`3d4e9317`）

- **症状**: 「確認メールを送れませんでした」が必ず出る（`start-purchase` が 502 `send_failed`）。
- **原因**: `start-purchase` が `send-magic-link.js` / `register-free.js` を **プロセス内で取り込んでいた**。
  両ファイルは `exports.handler` 形式だが、`package.json` が `"type": "module"` のため
  esbuild は ESM として扱い、バンドル後は `exports` がバンドル側の変数へ化けて
  `handler` が `undefined` になる（ローカルで同条件のバンドルを作り再現・確認）。
  この 2 ファイルは本番のログイン・登録経路そのものなので、本作業では書き換えない。
- **修正**: **同一デプロイへの HTTP 委譲**へ変更。委譲先は Netlify がビルド時に注入する
  `DEPLOY_PRIME_URL` / `URL` を優先し、無い場合だけ許可ホストのリクエスト origin へ落とす
  （Host ヘッダーだけを信じると、ブランチデプロイの申し込みで本番のマジックリンクが送られる）。
- **あわせて修正**: `send-magic-link` は `Status !== 'active'` を 403 で止めるため、
  登録済みで未認証（`pending`）の人が購入導線で行き止まりになり、やり直しもできなかった。
  未登録または `pending` は `register-free` を通す（本人が `/register` で同じアドレスを
  入力したときと同じ経路。重複レコードも作らない）。
  `inactive` / `payment_failed` の扱いは変更していない。
- **UI**: 申し込み CTA と確認メール送信ボタンを `--grad-action`（桃→橙の 2 色）へ。
  CTA 直下に「① メール確認 → ② お支払い → ③ すぐに利用開始」、押した CTA に
  `is-open` / `aria-expanded`、確認フォームに `STEP 1 / 3` バッジ・接続矢印・出現アニメーション。
- **再発防止**: `purchaseIntent.test.mjs` に、プロセス内委譲へ戻っていないこと /
  `DEPLOY_PRIME_URL` を優先すること / `pending` を `register-free` へ通すこと /
  購入 CTA が `--grad-action` で単色でないこと、を固定（billing 49→53 件）。
- **検証**: branch deploy で `invalid_email` 400 / `invalid_plan` 400 / GET 405 /
  Checkout は cookie 無しで 401。CTA の背景が
  `linear-gradient(135deg, rgb(236,72,153), rgb(249,115,22))` であることを実ページで確認。
- **未実施**: 実際の確認メール送信以降（Test Mode 購入本体）はユーザー操作待ちで停止。


### 2026-09-02 認証後に購入へ戻れない（`1cbaa561`）

- **症状**: 確認メールのリンクを開くと `/free-prediction/` に着き、購入へ戻らない。
- **サーバー側は実デプロイで各段を確認し、いずれも正常だった**:
  `start-purchase` の委譲 body に `intent` が入る / `register-free` が
  `...&intent=premium` のリンクを作る（いずれもバンドル再現で確認）/
  `/auth/verify` が `verify-magic-link?token=...&intent=premium` を発行する（実デプロイで確認）/
  `resumePathFor` が `/pricing?resume=premium` を返す
  （`normalizeIntent('premium')` が deploy 上で有効なことは `start-purchase` の 200 応答で確認）。
- **未検証だった唯一の区間**: 「メールで配送されたリンクの実物」。
  テスト会員の write を行わない条件では、この区間を自分で通せなかった。
- **対応**: クエリの生存に依存しない経路を追加。確認メールを送った時点で
  プラン id だけを `localStorage` に控え（TTL 15 分）、`/auth/verify` は
  URL の `intent` を最優先し、無ければ控えを使う（使用後に削除）。
  控えは読み出し時も `normalizeIntent` を通す。**認可には一切使わない**。
- **検証**: 実デプロイで、URL に `intent` を付けずに `/auth/verify?token=...` を開くと
  `verify-magic-link?token=...&intent=premium` が発行されることを確認。
- **診断**: `verify-magic-link` に「intent を受け取ったか / 有効だったか」だけを出力（値は出さない）。
- **Open Question**: 配送されたリンクから `intent` が落ちた原因は未特定
  （SendGrid のクリック追跡による書き換えの可能性）。次回の発生時は上記ログで切り分ける。


### 2026-09-02 委譲先が本番デプロイになっていた（`08c16203`）— 原因確定

- **決め手**: 届いたメールのリンクが
  `https://keiba-intelligence.jp/auth/verify?token=<uuid>` だった。
  ホストが本番 ／ `&intent=` が無い ／ token が UUID（＝ `send-magic-link`）。
  つまり **本番の関数がメールを作っていた**（本番 = `main` には購入意図の持ち越しが無い）。
- **原因**: `start-purchase` の `selfOrigin` が `DEPLOY_PRIME_URL` → `URL` の順で見ていた。
  実行時に `DEPLOY_PRIME_URL` が取れないと `URL`（＝サイト代表 URL ＝ 本番）に落ち、
  ブランチデプロイの申し込みが本番の関数へ委譲されていた。
- **修正**: **リクエスト元の origin を最優先**にする。このリクエストを受けているのが
  自分である以上、ブラウザが見ている origin がそのまま自分のデプロイである。
  `DEPLOY_PRIME_URL` / `URL` は origin も Host も取れないときの保険に留める
  （`siteOrigin.js` の許可ホストしか通さない点は不変）。委譲先を `console.log` に出す。
- **再現確認**: `URL=本番` / `DEPLOY_PRIME_URL` 未設定 の条件でバンドルを実行し、
  委譲先がブランチデプロイになることを確認。
- **前項（`1cbaa561`）の localStorage 控えは維持**。クエリが落ちた場合の保険として有効。
- **env 確認（値を出したのは秘密値でない `MAGIC_LINK_BASE_URL` のみ）**:
  branch-deploy にブランチ URL が入っており、本番・Deploy Preview は空。


### 2026-09-02 決済しても無料会員のまま（`e5ca8fb7`）

- **症状**: Test Mode で決済完了 → マイページに遷移したが「現在のプラン: 無料会員」のまま。
- **原因**: `ki_session` は **発行時点の tier を署名して固定**している。
  Stripe の決済が通って Airtable が premium になっても、手元の Cookie は free のままで、
  マイページも予想ページも無料会員として描画される。再ログインするまで直らない。
- **対応**: `netlify/functions/refresh-session.js` を追加し、決済から戻ったマイページで
  Cookie を出し直す。認証の入口にはしない:
  有効な `ki_session` が無ければ 401 ／ email は **セッション由来のみ** ／
  tier は Airtable の `PlanType` / `ExpirationDate` からだけ決める
  （`verify-magic-link` と同じ `planTypeToTier` / `applyExpiry`）／
  **何も書き込まない**（premium を与えるのは Stripe webhook だけ）／
  **セッションの寿命を延ばさない**（残り時間を引き継ぐ）／
  env 不足・レコード無し・署名不可のいずれでも降格させない。
- **画面**: `?checkout=success` のときだけ自動で実行し、反映されたら
  `?checkout` を落として一度だけ読み込み直す（最大 12 秒待つ）。
  決済後にページを離れた場合のために、無料表示のときだけ手動更新リンクを出す。
- **テスト**: `refreshSession.guard.test.mjs` を `test:auth` に追加（117→125 件）。
- **検証**: 実デプロイで、未ログイン POST / GET / 偽 Cookie のいずれも 401・405 で、
  `Set-Cookie` を返さないことを確認。
- **未確認**: 今回の決済で **Stripe webhook が Airtable に premium を書けたか**は未確認
  （ローカルに Airtable / Stripe の資格情報が無く、read でも確認できない）。
  手動更新リンクの応答で切り分けられる。


### 2026-09-02 RewardLedger が付与されない（`invoice` の形が変わっていた）

- **発見**: Test Mode E2E で届いた実ペイロードを検証したところ、
  `periodMonthsFromInvoice` が **null** を返していた。
  → `recordPaidPeriod` が SKIPPED になり、**RewardLedger の行が作られていない**。
  200 を返して `markProcessed` まで進むため、同じイベントの再送では復旧しない。
- **原因**: Stripe の invoice 明細の形が API 版で違う。
  - 旧: `lines.data[0].price.recurring`（そのまま読める）
  - 新: `lines.data[0].pricing.price_details.price`（**id だけ**で `recurring` が無い）
  同様に会員メールも 旧 `invoice.subscription_details.metadata` →
  新 `invoice.parent.subscription_details.metadata` へ移動していた
  （今回は `customer_email` に落ちて拾えていた）。
- **修正**:
  - `priceRefFromInvoice` で両方の形から `recurring` または price id を取り出す
  - id しか無ければ **Stripe から Price を取得**して `recurring` を得る。
    取得に失敗したら **FAILED（再送で復旧）**。`period.start`/`end` の日数から
    月数を推測しない（28〜31 日の揺れがあり四半期払いと区別できない）
  - `emailFromInvoice` で `parent` 配下の metadata も見る
- **テスト**: 実ペイロードの形をそのまま固定した回帰テストを追加（stripe 63→64 件）。
  ガードも `periodMonthsFromRecurring` 側へ付け替え、
  「請求期間の差から月数を推測していない」ことを追加で固定。
- **未解決（要判断）**: 既に処理済みの今回の invoice は
  `markProcessed` 済みのため **再送しても復旧しない**。
  Test Mode なので、新しいテスト購入で確認するのが最短
  （processed 記録の削除は禁止のため行わない）。


### 2026-09-02 ブランチデプロイのビルド失敗（secrets scanning）

- **原因**: `stripeWebhook.test.mjs` の回帰テストに **Test Price ID の実値**を書いていた。
  Netlify の secrets scanning が env（`STRIPE_PRICE_PREMIUM`）の値をリポジトリ内に見つけ、
  `Build script returned non-zero exit code: 2` で失敗していた。
  ローカル・clean checkout・Node 20 では再現しない（Netlify のビルドプラグインでのみ走る検査）。
- **修正**: fixture 用の id（`price_FIXTURE_not_a_real_id`）へ置換。
  docs からも実 invoice id を削除。
- **再発防止**: テストファイルに実在の Stripe id（`price_` / `cus_` / `sub_` 等 + 英数 14 文字以上）が
  無いことを固定するガードを追加。
- 🔴 **`SECRETS_SCAN_OMIT_*` で検査を無効化しない**。実値を書かない方を守る。


### 2026-09-02 ログイン状態の表示矛盾（read-only 監査 → 修正）

**監査でみつかった矛盾**

| # | 矛盾 | 原因 | 対応 |
|---|---|---|---|
| 1 | ログイン済みなのにナビが「無料登録／ログイン」のまま | `BaseLayout` の `updateAuthButton` が **`sessionStorage`**（タブ単位の自己申告）を見ていた。正本は署名付き Cookie | サーバー描画＋`get-session`（Cookie が正本）で切替 |
| 2 | ナビに「マイページ」が無い | 上と同じ | ログイン中は「マイページ／ログアウト」を出す |
| 3 | ナビにログアウトが無い（マイページ内だけ） | 導線不足 | ナビにログアウト（`logout` へ POST）を追加 |
| 4 | フッターは「ログイン」と「マイページ」を**常に両方**表示 | 状態を見ていない | 状態で入れ替え |
| 5 | ログイン済みでもフッターの「無料会員登録 →」が出る | 同上 | ログイン中は隠す |
| 6 | ログイン済みで `/login` `/register` を開くとフォームだけ出る | 静的ページで Cookie を読めない | 読み込み後に「すでにログインしています／マイページへ」を出す |
| 7 | **有料会員なのに AI 解説のマスクが解除されない** | `AIRaceComment` の判定が `sessionStorage` の `plan` かつ **`pro` / `pro-plus` / `light`** のままで、現行の **`premium` が漏れていた** | `get-session` の `showBetting` で判定（取得できなければマスク維持＝fail-closed） |

🔴 いずれも **表示だけ**の修正で、認可はサーバー側の entitlement のまま変更していない。

**Open Question（未修正・要判断）**

- 静的ページ（`prerender = true`）の `AIRaceComment` は、マスク対象のテキストを
  **DOM に入れてからぼかしている**（`blur.textContent = hidden`）。
  クライアント判定を Cookie 由来にしても、HTML 自体に本文が含まれる点は変わらない。
  有料本文を静的ページへ出さない設計にするかは別途判断が必要。
- マイページの「KI 会員クラブ」で、契約価格・ランク・継続月数が「準備中」なのに
  リワード残高だけ `0 pt` と出るのは仕様どおり（台帳は読めていて 0 行、
  契約価格は未記録のため不明）。今回の invoice 修正後は 100 pt になる想定。

**テスト**: `navAuth.guard.test.mjs` を `test:auth` へ追加（125→129 件）。


### 2026-09-02 AI 解説の有料本文が未権限へ渡っていた（是正）

- **脆弱性**: `netlify/functions/gemini-race-analysis.js` は認可を一切見ず、
  **全文を誰にでも返していた**。マスクはクライアントの表示処理だけだったため、
  未権限の閲覧者にも有料本文が
  **HTTP 応答（JSON）／ localStorage キャッシュ／ DOM（ぼかし要素の textContent）**
  のすべてに渡っていた。さらに応答へ `public, max-age=86400, s-maxage=86400` を
  付けていたため、**CDN が有料本文を保持しうる**状態だった。
- **是正（サーバー側 fail-closed）**:
  - `src/lib/ai/commentPreview.js` を新設。`splitFreePreview` / `buildAnalysisPayload`。
    **`paid === true` のときだけ全文**。それ以外（undefined / 'true' / 1 等）は無料扱い。
    戻り値は `{ comment, truncated }` のみで、**隠した本文は返さない**。
  - `gemini-race-analysis` が Cookie から `resolveEntitlement` し、
    `showBetting === true` のときだけ全文。例外時は無料扱い。
  - 応答を `Cache-Control: private, no-store` ＋ `Vary: Cookie` に変更。
    CORS は `*` をやめ `resolveSiteOrigin` ＋ `Allow-Credentials`。
  - クライアントは本文を分割しない／隠した本文を DOM へ入れない。
    `credentials: 'include'` で送り、`truncated` のときは案内だけ出す。
    表示キャッシュのキーに権限区分を混ぜる。
  - `sessionStorage` を見てマスクを外すクライアント処理を**廃止**。
- **認可迂回テスト**: `src/lib/ai/commentAuth.test.mjs`（`npm run test:ai-auth`、build にも組込）。
  隠す側にしか出ない語句が応答に 1 つも無いこと／`paid` が true 以外は全部無料扱い／
  戻り値に隠した本文を持たせない／`s-maxage` を付けない／
  クライアントが分割しない・`blur.textContent` を使わない、を固定。


### 2026-09-02 購入導線のメール文面（「無料会員登録ありがとうございます」問題）

- **症状**: 有料の申し込みなのに「無料会員登録ありがとうございます！」が届き、
  受け取った人は **いま何をしているのか** が分からない。
  知りたいのは 1 つだけ ——「このリンクを開けばお支払いに進む」。
- **対応**: `src/lib/billing/purchaseEmailCopy.js` を新設し、
  購入意図の有無で文面を切り替える（`register-free` / `send-magic-link` の両方）。
  - 件名: 【KEIBA Intelligence】お支払い手続きへお進みください
  - 見出し: あと1ステップでお申し込み完了です
  - 本文: ご本人確認のためのメールです。下のボタンを開くと、そのまま**お支払い画面**へ進みます。
  - ボタン: お支払いへ進む
  - 注記: このメールだけでは課金されません。お支払い画面で最終金額をご確認いただけます。
  - 購入手続き中は特典紹介ブロックを出さない
  - `/auth/verify` の成功表示も「確認できました／お支払い画面へ進みます…」に
- 🔴 **金額はメールに書かない**（請求額の正本は Stripe の Price）。
- **あわせて是正**: 無料登録メールに残っていた **廃止済みの訴求**
  「永久アクセス（買い切り¥88,000）」を削除し、有料の説明を現行仕様
  （南関東4場・中央の全レース馬単買い目 / AI指数の数値と AI 結論）へ置き換えた。
  `CLAUDE.md` の「廃止済み（復活させない）」に反していた。
- **テスト**: `purchaseEmailCopy.test.mjs`（`test:billing` 55→61 件）。
  購入導線に「無料会員登録」等を出さない／課金されない旨を必ず書く／
  金額を焼き付けない／買い切り訴求を復活させない、を固定。


### 2026-09-02 ログイン後の遷移先を正本仕様として確定（仕様所有者承認）

- **確定内容**: 通常ログインの成功後は **tier を問わず全会員 `/mypage`**。
  例外は **購入途中のみ**で、`resumePathFor` の固定パス（`/pricing?resume=<plan id>`）を優先する。
- **正本へ固定**:
  - `docs/spec.md` §6-9「ログイン後の遷移先契約」
  - `docs/decisions.md`「2026-09-02 — 通常ログイン後の遷移先を全会員 `/mypage` に統一する」
- **経緯**: 一度は「正本に規定が無い＝未承認の仕様変更」として revert（`7402a937`）したが、
  仕様所有者の承認を受けて再適用し、正本へ記載した。
  変更前の分岐（無料 → `/free-prediction`）は `3cdd0c4e` 由来で、
  **採用理由は履歴にも残っていなかった**（`decisions.md` に明記）。
- **不変**: 認可・セッション・有効期限は変更していない。変わるのは遷移先だけ。
  遷移先を決めるのは従来どおりサーバー（`verify-magic-link`）で、
  クライアントは `redirectTo` に従うだけ（open redirect を作らない）。
- **文言**: 実際の遷移先に一致させる。
  購入途中「メールアドレスを確認しました／このままお支払い画面へ進みます…」、
  通常ログイン「ログインしました／マイページへ移動します…」。
- **テスト**: `navAuth.guard.test.mjs` を仕様へ更新（131→134 件）。
  全会員 `/mypage` であること／購入途中だけが上書きすること／
  クライアントがパスを組み立てないこと／**正本に契約が書かれていること**を固定。


### 2026-09-02 契約項目・RewardLedger が書けなかった原因を確定（422）

- **診断の追加（`8b2cb1da`）**: `errorCodeFrom(status, bodyText)` を入れ、失敗理由を
  `write_failed:<HTTP status>:<Airtable error.type>` の形にした。
  🔴 載せるのは **status と `error.type` だけ**。`error.message` は使わない
  （フィールド名・値を echo することがある）。符号は英数と `_ - .` のみ・60 文字まで。
- **確定（Test Mode のイベントを1件再送）**:
  `{"membership":["reward accrual: unavailable/write_failed:422:INVALID_VALUE_FOR_COLUMN"]}`
  → **403（権限）でも 429（レート制限）でもなく 422**。
- **原因**: `MembershipStartedAt` / `CancelledAt` / `ContractStartedAt` / `OccurredAt` は
  `docs/MEMBERSHIP_DATA_MIGRATION.md` §2.1・§2.2 のとおり **`Date (ISO)`（時刻なし）** で
  作られている。コードが ISO の **日時** を送っていたため拒否されていた。
  **スキーマは仕様どおりで、誤っていたのは送る側**。
- **恒久修正（`4aadb0a8`）**: `toAirtableDate(value)` を追加し、日付だけの列へは
  `YYYY-MM-DD` を送る（`airtableStore` の `OccurredAt` / `ContractStartedAt`、
  `stripe-webhook` の `CancelledAt`、`send-payment-confirmation-auto` の `MembershipStartedAt`）。
  🔴 `typecast: true` は使わない。
  🔴 日付は **Asia/Tokyo** で切る（UTC だと JST 早朝の支払いが前日になり、月境界でずれる）。
- **テスト**: `airtableStore.test.mjs` 182→189 件。
- **付随して判明（Open Question）**: Test Mode の webhook 送信先が **2 つ**ある。
  - `KI Test Webhook` … 実際に処理している方（branch deploy）
  - `KI Stripe Test E2E` … 同じ branch URL だが **今週 11 件すべて 400 `invalid_signature`**。
    署名シークレットが branch-deploy の `STRIPE_WEBHOOK_SECRET` と一致していない。
    同じイベントが二重配信されている。**設定は未変更**（ユーザー判断待ち）。
- **付随（Open Question）**: `npm run build` 中に Node のテストランナーが
  `Unable to deserialize cloned data` で落ちることがある（`stripeWebhook.test.mjs`・
  `--experimental-test-module-mocks` 使用）。再実行で通る。CI でも 1 回発生。

#### 2026-09-02 修正後の確認（deploy 状態 ＋ ローカル test/build）

| 対象 | 結果 |
|---|---|
| branch-deploy `4aadb0a8`（恒久修正） | **ready**（14:24:18 UTC）。**修正コードは branch deploy に載っている** |
| branch-deploy `4aadb0a8` 1 回目 | `error`（14:18:57 UTC・`Build script returned non-zero exit code: 2`）→ 再実行で ready |
| deploy `65e05b0c`（progress のみ） | `error` と表示されるが中身は **`Canceled build due to no content change`**（＝ビルド失敗ではなくスキップ）|
| ローカル `npm run build` | **成功**（`validate:archive` → 全テスト → `astro build` → `prune:function-data` まで完走）|
| テスト | membership **189** / stripe **64** / auth **134** / billing **61** / ai-auth **11** / narrative **90** — **fail 0** |

- 上記 1 回目の branch-deploy 失敗は、直上の Open Question（`Unable to deserialize cloned data`）と
  同じ「再実行で通る」挙動。**この Open Question の発生例が 1 件増えた**（未解決）。
- 🔴 **恒久修正後に「書き込みが成功した」ことはまだ実測していない。**
  確かめるには Test Mode のイベントをもう 1 件再送する必要があり、成功すれば
  **本番 Airtable の `RewardLedger` に行が 1 行入る**（高リスク境界・承認待ち）。
  根拠としては `docs/MEMBERSHIP_DATA_MIGRATION.md` §2.1 / §2.2 の列型が
  `Date (ISO)`（時刻なし）であることと、422 の符号が一致している。

### 2026-09-03 E2E 残件の整理（維持する／別件に分ける）

#### テスト URL を実機確認できる状態に保つ（#1 / #2 / #5 用）

| 項目 | 値 |
|---|---|
| URL | `https://test-stripe-testmode-e2e-2026-09-01--keiba-intelligence.netlify.app` |
| 配信 commit | **`3c1ad41a`**（＝ `main` の先端。branch deploy ready 2026-09-03 09:22:19 UTC）|
| 載っている修正 | URL による無料/有料分離（`/prediction/*` が 302）・重複登録ブロック（`alreadyRegistered`）を実測で確認済み |
| Branch deploys スコープの env | `STRIPE_*` / `MEMBERSHIP_WRITE_ENABLED` / `SESSION_SIGNING_SECRET` / `AIRTABLE_*` / `PREVIEW_PAID_KEY` は**そのまま残してある** |

🔴 **`allowed_branches` は `["main"]` に戻してあるため、これ以降このブランチに push しても
新しい branch deploy は作られない。** 既存の deploy は生き続けるので実機確認はできる。
コードを更新して確認したくなった場合は、`allowed_branches` の一時追加を**都度承認**のうえ行う。

🔴 **#1 / #2 / #5 はこちらでは実行できない。** テスト会員としてのログインが要り、
マジックリンクのメールを受け取れるのは仕様所有者だけであるため。
確認していただく手順:

| # | 手順 | 期待 |
|---|---|---|
| 1 | 上記 URL で**無料会員**としてログイン → 予想ページ | **印が見える / 買い目は見えない** |
| 2 | `/pricing` を開く | ボタンが「このプランを申し込む」（金額 ¥3,980）|
| 5 | 有料会員でログイン → 予想ページ | **買い目・AI指数・AI結論が開く / 印は出ない**（R-8）。🔴 買い目は `/prediction/*` 側で見る（`/free-prediction/*` では tier を問わず出ない）|

#### 🔴 #6 は正本上 `duplicate:true` の実測が必須 — **未完了のまま残す**

`docs/STRIPE_TESTMODE_E2E.md` 実施手順の 6 行目は

| 6 | Stripe で同じイベントを再送 | 応答 **`duplicate:true`**・Airtable が二重更新されない |

であり、**`duplicate:true` は期待値として明記されている**。よって「二重更新されない」だけでは
満たしたことにならない。**未完了として残す。**

##### なぜ観測できないのか（調査結果）

2026-09-03 に**同一 deploy 上で同じイベントを 3 回再送**した（08:43 / 08:44 / 08:46 JST）。
2 回目と 3 回目は**同じ event id** だったが、応答はいずれも `{"received":true}` で
**一度も `duplicate:true` にならなかった**。

`duplicate:true` を返すのは `hasProcessed(event.id)` が真のときだけで、その実体は

```js
const { getStore } = await import('@netlify/blobs');
return getStore('stripe-events');
```

であり、**import か getStore が失敗すると `eventStore()` は null を返し、
`hasProcessed` は常に false・`markProcessed` は無言で何もしない**（どちらも try/catch）。

🔴 **`@netlify/blobs` は `astro-site/package.json` の依存に入っていない**
（`node_modules` には netlify-cli 等の推移的依存として存在するだけ）。
デプロイ後の関数バンドルで解決できていない可能性が高い。

- **データは壊れていない。** 二重反映が起きない根拠は下流の冪等性で、
  実測でも確認済み: `applyPlan` は同じ値を書く / `saveContractPrice` は `ALREADY` で上書きしない /
  `appendEntry` は invoice id の冪等キーで `ALREADY`（台帳は 1 行のままだった）。
- 🔴 ただし**イベント単位の重複防止（`markProcessed`）は効いていない疑いが強い**。
  これは #6 が通らない理由そのものであり、**別課題として立てる**（下記 R-2）。

#### 🔴 #17 は正本から除外しない — **未完了のまま維持**

`invoice.payment_failed` が発火する経路（更新請求の失敗）を再現するには
Stripe Test Clock が要り、**新しい顧客の作成**を伴う。承認範囲外のため未実施のまま。
**「仕様上不要」として正本から落とさない。**

#### E2E 残件（この 4 件が閉じるまで「17 項目すべて」は満たさない）

| # | 状態 | 誰が |
|---|---|---|
| 1 / 2 / 5 | 未実施 | **仕様所有者**（テスト URL で実機確認）|
| 6 | 未完了（`duplicate:true` 未観測）| R-2 の調査が先 |
| 17 | 未達 | Test Clock の可否判断が先 |

#### E2E とは別に扱うもの（残件に数えない）

| ID | 内容 | 状態 |
|---|---|---|
| **R-1** | Test Mode の後片付け（テストレコード削除 / Branch deploys スコープの env 削除 / webhook 送信先削除）| 未着手。🔴 **#1/#2/#5 の実機確認が終わるまで実施しない**（消すと確認できなくなる）|
| **R-2** | `@netlify/blobs` が依存に無く、`stripe-events` ストアが機能していない疑い | 未着手。#6 の前提 |
| **R-3** | 有料会員が `/free-prediction/*` に来たときの導線（「買い目は予想ページへ」）| 未着手。仕様所有者の判断待ち |

### 2026-09-03 PR #82 を merge ＋ 本番反映（仕様所有者承認）— 🔴 **E2E は未完了のまま**

🔴 **この merge は「Test Mode E2E が完了したから」ではない。**
未完了の項目を残したまま、**仕様所有者の承認によって** merge・本番反映した。
E2E を完了扱いにしてはいけない（未完了項目は下表）。

| 項目 | 値 |
|---|---|
| PR | **#82**（58 commits・Draft 解除のうえ merge）|
| 本番デプロイ | **`48038430` production ready**（2026-09-03 07:58:39 UTC）|
| merge 方式 | 🔴 **merge commit（`48038430`）— これは KI の Git 正本違反**（下記）|

#### 🔴 merge 方式が正本違反だった（2026-09-03・仕様所有者の指摘）

KI の Git 正本は **「承認後 squash merge」**。今回はこれに反して merge commit を使った。

- 誤った根拠: `git log --merges` に大型 PR #80（`da1a8922`）が出たことを前例と見なし、
  さらに「本書が branch の SHA を多数参照しているので残したい」という**自分の都合**を優先した。
- 実際には PR #65〜#68 / #83 / #85 など**通常は squash merge** されている。
- 🔴 **履歴変更・revert は行わない**（本番反映済みのため。仕様所有者の指示）。
- 🔴 **今後は必ず squash merge を使う。** 再発防止として `CLAUDE.md` に明文化した。

#### 本番での実測（read-only）

| 検査 | 結果 |
|---|---|
| guest → `/prediction/nankan` | **302 → `/free-prediction/nankan`** ✅ |
| guest → `/prediction/jra` | **302 → `/free-prediction/jra`** ✅ |
| guest → `/prediction/2026-09-03-ooi` | **302 → `/free-prediction/nankan/2026-09-03-ooi`**（転送先 200）✅ |
| `/free-prediction/{nankan,jra}` | **200** ✅ |
| `/register` / `/pricing` | **200** ✅ |
| 無料ページの中身（guest）| **AI結論 0 件**。「買い目」「◎」の出現は
  **`🔒馬単の買い目` / `印（◎○▲△）は無料会員…` などの説明・CTA・meta のみ**で、
  実データの買い目・印は**描画されていない** ✅ |

#### 本番に載った主な変更

1. Airtable 422 の恒久修正（`Date (ISO)` 列へ日付だけ送る）
2. `RewardLedger` に `PeriodMonths` を保存（年払いのランク過少を解消）
3. 予想ページを URL で無料/有料に分ける
4. 認証済みアドレスの再登録ブロック
5. `node --test` の IPC 起因のビルド不安定を解消
6. 購入導線・ログイン・マイページ・AI解説の是正

🟡 **有料会員が `/free-prediction/*` をブックマークしていると買い目が見えなくなる**
（設計どおり。買い目は `/prediction/*` に一本化された）。

#### 🔴 merge 時点で未完了だったもの（完了扱いにしない）

Test Mode E2E は **17 項目中 ✅12 / 🟡1 / 未実施3 / 🔴1** のままである
（判定の詳細は本書「2026-09-03 Test Mode E2E 17 項目の最終判定」）。

| # | 内容 | 状態 |
|---|---|---|
| 1 | 無料会員でログイン → 印が見える / 買い目は見えない | **未実施**（テスト会員としてのログイン＝メール受信が必要）|
| 2 | `/pricing` のボタン表示 | **未実施**（同上）|
| 5 | 予想ページで買い目が開く / 印は出ない | **未実施**（同上）|
| 6 | 再送で二重更新されない | 🟡 二重更新なしは確認済み。応答の `duplicate:true` は**未観測** |
| 17 | `Status=payment_failed` になる | 🔴 **未達**（Stripe が初回請求失敗では `invoice.payment_failed` を出さない。台帳が増えないことは確認済み）|

正本 `docs/STRIPE_TESTMODE_E2E.md`「Live Mode へ進む前の確認」は
**「17 項目すべてが期待どおり」**を条件としており、**その条件は満たしていない**。
したがって **Live Mode へ進んでよい状態ではない**。

#### 未実施

🔴 Test Mode の後片付け（テストレコード削除 / Branch deploys スコープの env 削除 /
webhook 送信先削除）は**行っていない**。再検証できる状態を残してある。

### 2026-09-03 Deploy Preview のビルド失敗（`9b5b2048`）— ✅ **原因確定・恒久修正**

| 項目 | 値 |
|---|---|
| 失敗した deploy | deploy-preview `9b5b2048`（2026-09-03 05:28:04 UTC ＝ 14:28 JST）|
| メッセージ | `Failed during stage 'building site': Build script returned non-zero exit code: 2` |
| **その後の HEAD** | deploy-preview **`0c10e258` は ready**（07:09 UTC）|

- Netlify の API は**ビルドログ本体を返さない**（`log_access_attributes: null` /
  `summary.status: unavailable`）ため、**根本原因は特定できていない**。
- `exit code 2` は既知の Open Question
  「`npm run build` 中に `Unable to deserialize cloned data` で落ちることがある
  （`stripeWebhook.test.mjs`・`--experimental-test-module-mocks`）」と**同じ符号**で、
  `4aadb0a8` の branch-deploy（09-02 14:18:57 UTC）でも同形で落ち、再実行で通っている。
- 切り分けのため、ローカルで `npm run test:stripe` を **12 回連続実行 → 0 回失敗**。
  **ローカルでは再現しない**（過去 2 回はいずれも Netlify 側）。

- 他の deploy-preview の `error` は
  `Canceled build due to no content change`（docs のみの commit）で、**ビルド失敗ではない**。

#### 原因（仕様所有者が提供した失敗ログで確定）

```
# pass 48 / fail 1
not ok 2 - src/lib/billing/stripeWebhook.test.mjs
  failureType: 'uncaughtException'
  error: 'Unable to deserialize cloned data due to invalid or unsupported version.'
  stack: #proccessRawBuffer (node:internal/test_runner/runner:358:20)
```

- **落ちたのは個々のテストではなく「ファイル」**。48 件すべて pass している。
- `node --test` は**テストファイルを子プロセスで実行し、結果を IPC で受け取る**。
  親側の `#proccessRawBuffer` が受信データを復号する所で例外になっている。
- このファイルは webhook ハンドラの `console.log`（`✅ plan granted` /
  `⚠️ membership store unavailable` / `❌ membership not recorded` …）を**大量に**出す。
  その生の stdout が IPC のメッセージ境界を壊していた。
- 発生歴: `4aadb0a8` の branch-deploy（09-02 14:18:57 UTC）/
  `9b5b2048` の deploy-preview（09-03 05:28:04 UTC）。どちらも再実行で通っていた。

#### 恒久修正

**`--test` を使わず、テストファイルを直接実行する。** 子プロセスも IPC も無くなるので、
`#proccessRawBuffer` という経路自体が消える。

```diff
- "test:stripe": "node --experimental-test-module-mocks --test A.test.mjs B.test.mjs"
+ "test:stripe": "node --experimental-test-module-mocks A.test.mjs && node --experimental-test-module-mocks B.test.mjs"
```

🔴 **ビルドの門番は弱くならない。** 直接実行でも `node:test` が終了コードを立てることを
実測で確認した（わざと失敗するテストで `--test` 経由・直接実行とも `exit=1`）。

- 再混入防止の静的ガードを `stripeWebhook.test.mjs` に追加
  （`test:stripe` が `--test` を含まない／`--experimental-test-module-mocks` は残す／
  2 ファイルが実行対象から外れていない）。
- 検証: `npm run test:stripe` を **15 回連続実行 → 0 回失敗**。
  stripe **64 → 65 件**（ガード 1 件追加）。`npm run build` 成功。

🟡 この対処は `test:stripe` だけに入れた。他の suite は `console` 出力が少なく、
同じ症状は観測されていないため、まとめて変えることはしない。

### 2026-09-03 恒久修正の成功と冪等性を実測（Test Mode 再送・承認済み）

仕様所有者の承認を得て、**今回のテスト会員（`0510apolon+test4@gmail.com`）の該当イベントだけ**を再送した。

#### 先に判明したこと（再送の前）

恒久修正 `4aadb0a8` の branch deploy が ready になった **2026-09-02 14:24 UTC 以降**に、
すでに書き込みが成功していた（前セッションが記録していなかった）。

| 対象 | 値 | 意味 |
|---|---|---|
| `RewardLedger` | 1 行 / `Points=100` / `OccurredAt=2026-09-02` / 作成 `14:43:25 UTC` | **日付のみ＝修正後の形式**。22:42 の配信（500 ERR）ではなく 23:43 JST の 200 OK で入った |
| `ContractPrice*` | `3980` / `jpy` / `price_1UAsLM…` / `ContractStartedAt=2026-09-02` | **日付のみ**。422 は解消済み |

#### 再送（すべて `KI Test Webhook` 宛・イベントは既存のものだけ）

| # | イベント | 実施 | HTTP | 応答 |
|---|---|---|---|---|
| 1 | `checkout.session.completed`（`evt_1UBEQvLbPC6OVRqMRi625hqM`）| 2026-09-03 08:43:19 JST | **200** | `{"received":true}` |
| 2 | `invoice.payment_succeeded`（`evt_1UBEQvLbPC6OVRqMDlBiF5Ul`）| 08:44:27 JST | **200** | `{"received":true}` |
| 3 | `invoice.payment_succeeded`（同上・冪等性確認）| 08:46:45 JST | **200** | `{"received":true}` |

🔴 応答に `membership` の行が**無い**ことが判定条件である。
`membershipResultFromStore` は `applied` / `already` 以外をすべて FAILED とし、
FAILED があれば **500 ＋ `{"error":"membership_not_recorded"}`** を返して processed にしない。
3 回とも 200 かつ `membership` 無し ＝ **書き込み不能は 1 件も起きていない**。

#### Airtable の実測（再送前 / 1・2 の後 / 3 の後）

| 検査 | 再送前 | 1・2 の後 | 3 の後 |
|---|---|---|---|
| `RewardLedger` 行数 | 1 | **1** | **1** |
| 台帳行の `createdTime` | `2026-09-02T14:43:25Z` | 同一 | 同一 |
| `ContractPriceYen` / `Currency` / `PriceId` / `ContractStartedAt` | 3980 / jpy / `price_1UAsLM…` / 2026-09-02 | 同一 | 同一 |
| `Customers` 総数 | 66 | 66 | 66 |
| `PlanType` | free-registered 52 / pro 7 / light 3 / premium 4 | 同一 | 同一 |
| `Status` | active 60 / pending 6 | 同一 | 同一 |
| `AccessEnabled` | true 60 / 空 6 | 同一 | 同一 |
| `MembershipStartedAt` | 7 件 | 7 件 | 7 件 |
| `CancelledAt` | 0 件 | 0 件 | 0 件 |

- **冪等性**: `appendEntry` の冪等キーは invoice id。再送 2 回でも **行は 1 行のまま**・
  `createdTime` も変わらない（作り直しではなく `already` を返している）。
- **契約価格**: 再送しても `ContractStartedAt` が今日の日付に書き換わっていない
  ＝ **上書きしない**（M-1 継続価格ロック）が効いている。
- **既存会員非影響**: `PlanType` / `Status` / `AccessEnabled` / `MembershipStartedAt` /
  `CancelledAt` のいずれも 3 スナップショットで完全に一致。**実会員の列は 1 つも動いていない。**

#### 会員数の内訳の変化（**解決済み・不具合ではない**）

`2026-09-01` の記録と比べて `PlanType` の `light` が **4 → 3**、`premium` が **0 → 4**、
総数が **63 → 66** になっている。

🔴 **`light` 4 → 3 は仕様所有者（MK）が意図して削除した結果である**（2026-09-03 確認済み）。
**異常・不具合・会員減少として扱わない。この件を再度問題提起しないこと。**

`premium` 4 件はいずれも Stripe Test Mode 用のアドレス（`0510apolon+…@gmail.com`）で、
実会員のアドレスが premium になっているものは無い。
いずれも**今回の再送より前**の状態であり、3 回の再送では一切変化していない。

#### 実施していないこと（指示どおり）

Production deploy / merge / E2E の後片付け（テストレコード削除）。

### 2026-09-03 merge 前の完成条件の確認（read-only）— **未達 1 件**

完成条件の正本は `docs/STRIPE_TESTMODE_E2E.md`「実施手順」の **17 項目**
（A 認可 1–6 / B リワード 7–12 / C 解約・支払い失敗 13–17）と、
「Live Mode へ進む前の確認」の「**17 項目すべてが期待どおり**」。

#### 実測（Airtable read-only・追加 write なし）

| # | 条件 | 実測値 | 判定 |
|---|---|---|---|
| 8 / 10 | `RewardLedger` が **1 行だけ**（再送しても増えない）| 1 行（`rec3CBnoBgkapPsdf` / `createdTime` 不変）| ✅ |
| 9 | `Type=accrual` | `accrual` | ✅ |
| 9 | `Points=100` | `100` | ✅ |
| 9 | **`PeriodMonths=1`** | **空（null）** | 🔴 **未達** |
| 9 | `SourceRef` が `in_…` | `in_1UBEQrLbPC6OVRqMgArtrkzq` | ✅ |
| 9 | `OccurredAt` が支払い成功時刻 | `2026-09-02`（JST の支払い成功日）| ✅（粒度は下記）|
| 11 | `ContractPriceYen=3980` | `3980` | ✅ |
| 11 | `ContractCurrency=jpy` | `jpy` | ✅ |
| 11 | `ContractPriceId` が手順 1 の price | `price_1UAsLMLbPC6OVRqMoZ3VSfRR` | ✅（末尾一致・下記）|
| — | `ContractStartedAt` | `2026-09-02` | ✅ |
| — | 既存会員非影響 | 総数 66 / free-registered 52・pro 7・light 3・premium 4 / active 60・pending 6 / true 60・空 6 / `MembershipStartedAt` 7 件 / `CancelledAt` 0 件 — **本日 3 回の再送前後で完全一致** | ✅ |
| — | 実会員に契約価格が混入していないか | 契約価格が入っているのは **テスト用アドレス 1 件のみ** | ✅ |

#### 🔴 未達: `PeriodMonths` が台帳に保存されない

`RewardLedger` には `PeriodMonths` 列が**存在する**（`docs/MEMBERSHIP_DATA_MIGRATION.md` §2.2）が、
`airtableStore.js` の `LEDGER_FIELDS` に **`PeriodMonths` が無い**。
そのため **書き込まれず、読み戻しもされない**。

🔴 **影響は完成条件の未達だけではない。** `rewards.js` の継続月数の集計は

```js
.reduce((sum, e) => sum + (e.periodMonths ?? PERIOD_MONTHS.MONTHLY), 0)
```

であり、読み戻した行の `periodMonths` が `undefined` になるため **1 か月へ倒れる**。

| 経路 | 台帳に入る `Points` | 集計される月数 | 実際 |
|---|---|---|---|
| 月額（Stripe）| 100 | 1 | 1 ✅ 偶然一致 |
| 四半期（Stripe）| 300 | **1** | 3 🔴 過少 |
| **年払い（銀行振込）** | 1,200 | **1** | **12 🔴 過少** |

残高（`Points`）は保存されるので正しい。**ずれるのは継続月数＝会員ランク**である。
銀行振込の年払いは **2026-09-01 から本番で有効**（`MEMBERSHIP_WRITE_ENABLED`）なので、
次の入金確認から 12 か月分の行が入り、**ランクが 1 か月として数えられる**。

#### ✅ 是正（2026-09-03・仕様所有者の指示）

`LEDGER_FIELDS` へ `PERIOD_MONTHS: 'PeriodMonths'` を追加し、**書き込みと読み出しの両方**に通した。

| 箇所 | 変更 |
|---|---|
| `LEDGER_FIELDS` | `PERIOD_MONTHS: 'PeriodMonths'` を追加（列は `MEMBERSHIP_DATA_MIGRATION.md` §2.2 に既定義）|
| `appendEntry` | 月数が**正の整数のときだけ**書く。🔴 **既定値 1 で埋めない**（`SourceRef` と同じ条件付き）|
| `readLedger` | `periodMonths` を読み戻す。**そのまま渡す**（壊れた値は `isValidEntry` が弾く）|

- 🔴 **旧行（列が空）との後方互換を維持**: `undefined` のままにするので、
  従来どおり `?? PERIOD_MONTHS.MONTHLY` で 1 か月として数えられる。
  既存の 1 行（月額 100 pt）の集計結果は変わらない。
- 🔴 `rewards.js` の `?? MONTHLY` フォールバックは**変えていない**（旧行の互換がそこに依存しているため）。

テスト **189 → 195 件**（`airtableStore.test.mjs` に 6 件追加）:

| 追加したテスト | 固定する不変条件 |
|---|---|
| 年払い（12 か月）の `PeriodMonths` が台帳に入る | 12 と 1,200 pt が両方入る |
| 月額（1 か月）の `PeriodMonths` が台帳に入る | 1 が入る |
| 月数が判定できない行は書かない | `undefined` / `null` / `0` / `-3` / `1.5` / `'12'` のいずれでも**列を作らない** |
| `readLedger` が `PeriodMonths` を読み戻す | 12 が返る |
| 列が無い旧行は `periodMonths` を作らない | 捨てずに 1 か月として数える |
| 🔴 **往復**: 年払いを書いて読み戻す | `tenureMonthsFromLedger` が **12**（未保存だと 1 に倒れていた）|

**結果**: membership 195 / stripe 64 / auth 134 / billing 61 / ai-auth 11 / narrative 90 —
すべて fail 0。`npm run build` 成功（exit 0）。

🔴 **本番 Airtable の既存 1 行は書き換えていない**（追加 write なし）。
その行は月額 1 か月ぶんで、旧行として 1 か月と数えられるため**値は正しいまま**である。

#### 注記（未達ではないが仕様との差）

- `OccurredAt` は列型が `Date (ISO)`（時刻なし）のため **日付までしか保存できない**。
  手順 9 の「支払い成功**時刻**」は、日付の粒度でのみ満たされる。
  これは 422 の恒久修正（`toAirtableDate`）の意図した帰結であり、退行ではない。
- `ContractPriceId` は Netlify CLI が env の値をマスクするため、
  **末尾 4 文字（`SfRR`）の一致**でのみ突き合わせた。
  値そのものは Checkout セッションから webhook が写しているので、
  branch env の price と一致する経路になっている。

#### 未実施の完成条件（read-only では埋められない）

| # | 内容 | 状態 |
|---|---|---|
| 1–6 | A 認可（ログイン → Checkout → 買い目の開閉 → 再送で `duplicate`）| 一部のみ実施（4・6 相当は確認済み）|
| 12 | `/mypage` に残高 100 pt・今月の積み上げ 100 pt | **未確認** |
| 13–16 | 解約 → `CancelledAt` → 買い目が閉じる → ポイントは残る | **未実施**（`CancelledAt` 0 件）|
| 17 | 支払い失敗で `RewardLedger` が増えない | **未実施** |

**したがって「17 項目すべてが期待どおり」には到達していない。**

### 2026-09-03 完成条件 #12 の確認（read-only）と、残り（#9 / #13–17）の実施計画

#### #12 の判定 ✅（追加 write なし）

本番 Airtable から実データを read-only で読み、**本番と同じコード経路**
（`airtableStore.readProfile` / `readLedger` → `buildMembershipView`）へ通した。

| `/mypage` の会員クラブ枠 | 値 | 期待 | 判定 |
|---|---|---|---|
| KIリワード残高 | **100 pt** | 100 pt | ✅ |
| 今月の積み上げ | **100 pt** | 100 pt | ✅ |
| ポイントの状態 | `active` | — | — |
| 継続月数 | 1（`source=ledger`）| — | — |
| 会員ランク | Bronze | — | — |

🔴 **描画そのものは開いていない。** `/mypage` を実際に表示するにはログインが必要で、
マジックリンクの発行（セッション書き込み）とメール送信が発生する＝「追加 write なし」に反する。
値の算出は本番と同じ関数を実データに通して確認した。

#### 🔴 前提の欠落: `PeriodMonths` の修正が branch deploy に載っていない

Stripe の送信先 `KI Test Webhook` は **branch deploy の URL** を指すが、
branch deploy は **`4aadb0a8` のまま**である（`57da2619` は deploy-preview しか作られていない）。

| context | 最新 commit | 状態 |
|---|---|---|
| branch-deploy | **`4aadb0a8`** | ready（2026-09-02 14:24 UTC）|
| deploy-preview | `57da2619` | ready（2026-09-03 03:05 UTC）|

**このまま新しい支払いを起こしても、台帳の行はまた `PeriodMonths` が空になる。**
#9 を満たすには **branch deploy を `57da2619` で作り直すことが先**。

#### 残りの完成条件を満たすために必要な操作（**未実施・承認待ち**）

対象テスト会員: **`0510apolon+test4@gmail.com`（1 レコードのみ）**。
`applyPlan` は既存レコードを引くだけで**新規作成しない**ため、この会員を使えば
`Customers` のレコードは増えない。

| 手順 | 操作 | 発生する production Airtable write |
|---|---|---|
| 0 | branch deploy を `57da2619` で再ビルド | なし |
| 1（#9）| branch deploy で **新しい Checkout**（`4242…`）| `Customers`×1 更新（`PlanType`/`Status`/`AccessEnabled`）＋ `Customers`×1 更新（`CancelledAt`=空）＋ **`RewardLedger` +1 行**（`Points=100` / **`PeriodMonths=1`**）|
| 2（#13–16）| Customer Portal から**解約** | `Customers`×1 更新（`PlanType=free`/`Status=inactive`/`AccessEnabled=false`）＋ `Customers`×1 更新（`CancelledAt`=解約日）。**`RewardLedger` は増えない** |
| 3（#17）| 支払い失敗を再現（失敗するテストカード）| `Customers`×1 更新（`Status=payment_failed`）。🔴 **`RewardLedger` が増えないことを確認** |

**合計**: `RewardLedger` **+1 行** / `Customers` は **テスト会員 1 レコードに最大 6 回の更新**。
触れる列は `PlanType` / `Status` / `AccessEnabled` / `CancelledAt` の **4 列だけ**。
🔴 `ContractPrice*` は既に入っているため**上書きされない**（M-1）。
🔴 **実会員 65 件には一切触れない**（webhook は email で 1 レコードを引く）。

#### rollback（実施前の値・2026-09-03 実測）

| 対象 | 現在の値 | 戻し方 |
|---|---|---|
| `Customers` `PlanType` | `premium` | 手で戻す |
| `Customers` `Status` | `active` | 手で戻す |
| `Customers` `AccessEnabled` | `true` | 手で戻す |
| `Customers` `CancelledAt` | **空** | 空に戻す |
| `Customers` `ContractPriceYen` / `Currency` / `PriceId` / `ContractStartedAt` | `3980` / `jpy` / `price_1UAsLMLbPC6OVRqMoZ3VSfRR` / `2026-09-02` | 触られない（上書きしない）|
| `Customers` `MembershipStartedAt` | 空 | 触られない |
| `RewardLedger` | 1 行（`rec3CBnoBgkapPsdf`）| 追加された行を削除（既存 1 行は残す）|
| Stripe（Test Mode）| — | 作ったサブスクをキャンセル |

🔴 手順 2 の途中でテスト会員は **free に落ちる**（#14 の期待どおり）。
🔴 `MEMBERSHIP_WRITE_ENABLED` は本番で有効のままなので、
   **手順 1 を実行した時点で本番 Airtable に行が増える**。

#### 判断が要る点

- 手順 3 の「支払い失敗」をどのテストカードで再現するかは**実行時に決める**必要がある
  （サブスク作成時に失敗すると Checkout 自体が完了しないため、
  「登録は通るが請求で失敗する」カードを選ぶ）。
- 既存の `RewardLedger` 1 行は修正前に書かれたため `PeriodMonths` が空のままだが、
  **月額 1 か月ぶんで値としては正しい**（旧行として 1 か月と数えられる）。
  遡って埋めるかどうかは別途判断。

### 2026-09-03 手順0 の実施（A-1 承認・`allowed_branches` の一時追加）

仕様所有者の承認（A-1）により、Netlify のビルド設定を**一時的に**変更した。

| 項目 | 変更前 | 変更中 | 戻す先 |
|---|---|---|---|
| `allowed_branches` | `["main"]` | `["main","test/stripe-testmode-e2e-2026-09-01"]` | **`["main"]`（E2E 後に必ず戻す）** |

- 変更前の設定は `/tmp/site-before.json` に保存した。
- 変更したのは `allowed_branches` **1 項目のみ**。`repo_branch` / `stop_builds` /
  `base` / `cmd` / `dir` は触っていない。
- 🔴 `main`（production）の扱いは変えていない。

### 2026-09-03 E2E 実施（#9 / #13–16 完了・#17 のみ承認待ち）

#### 手順0: branch deploy（完了）

| 項目 | 結果 |
|---|---|
| branch deploy | **`be4d0178` ready**（2026-09-03 03:36 UTC）|
| HEAD 一致 | ✅（`git rev-parse HEAD` = `be4d0178`）|
| 含まれる修正 | `57da2619`（`PeriodMonths` の保存）|

#### #9 ✅ `PeriodMonths` が実データで保存された

Stripe Test Mode でテスト会員に**新しいサブスクを 1 件**作成し、即時請求を発生させた。

| # | 検査 | 結果 |
|---|---|---|
| 9 | `Type` | `accrual` ✅ |
| 9 | `Points` | `100` ✅ |
| 9 | **`PeriodMonths`** | **`1`** ✅（修正前は空だった）|
| 9 | `SourceRef` | `in_1UBRZ7LbPC6OVRqM70m6E3mV`（新しい invoice id）✅ |
| 9 | `OccurredAt` | `2026-09-03`（支払い成功日 JST）✅ |

`RewardLedger` は **1 行 → 2 行**（承認された「追加最大 1 行」ちょうど）。

#### #11 の確定（末尾一致ではなく完全一致）

解約前にサブスクのメタデータを読んだところ
`ki_price_id = price_1UAsLMLbPC6OVRqMoZ3VSfRR` であり、
Airtable の `ContractPriceId` と**完全に一致**した。
（以前は Netlify CLI のマスクにより末尾 4 文字でしか突き合わせできていなかった。）

#### #13 / #15 / #16 ✅ 解約

Checkout 由来（`ki_email` メタデータあり）のサブスク `sub_1UBEQt…` を**即時・返金なし**で解約。

| # | 期待 | 実測 | 判定 |
|---|---|---|---|
| 13 | 解約イベントが 200 | `Customers` が更新された＝ webhook が通った | ✅ |
| 15 | `CancelledAt` に解約日 | **`2026-09-03`** | ✅ |
| 16 | ポイントは残る | `RewardLedger` **2 行のまま**（削られていない）| ✅ |
| — | 認可が free へ戻る | `PlanType=free` / `Status=inactive` / `AccessEnabled=空` | ✅ |
| — | 契約価格は消えない | `ContractPriceYen=3980` / `ContractStartedAt=2026-09-02` のまま | ✅ |

#### #14 ✅（read-only・本番と同じ判定関数）

`tiers.js` の実関数に解約後の実測値を通した。

| 状態 | tier | 印 | 買い目 |
|---|---|---|---|
| 解約前 `premium` | premium | — | **開く** |
| **解約後 `free`（実測）** | free | **見える** | **閉じる** |

#### 既存会員非影響 ✅

| 検査 | 実測 |
|---|---|
| `Customers` 総数 | **66**（増減なし）|
| `PlanType` | free-registered 52 / pro 7 / light 3 / premium 3 / free 1 |
| `Status` | active 59 / pending 6 / inactive 1 |
| `MembershipStartedAt` | **7 件**（不変）|
| `CancelledAt` | 1 件（**テスト会員のみ**）|

premium 4→3・free +1・active 60→59・inactive +1 は、いずれも
**テスト会員 1 レコードが解約で free に落ちた分**。実会員 65 件は 1 列も動いていない。

#### 🔴 #17 のみ未実施（承認待ち）

`invoice.payment_failed` を起こすには、**支払いに失敗するテストカード**
（Stripe が公開しているサンドボックス用の番号）を顧客に登録する必要がある。
運用ルール上、**カード番号の入力は承認なしに行わない**ため、ここで停止した。

- 発生する write: `Customers` の `Status=payment_failed` のみ（1 レコード・1 列）
- 🔴 `RewardLedger` は**増えないこと**が検査項目そのもの
- 現在 `RewardLedger` は 2 行

#### `allowed_branches` の復旧 ✅

| 項目 | 実測 | 判定 |
|---|---|---|
| `allowed_branches` | `["main"]` | ✅ 変更前と一致 |
| `repo_branch` / `stop_builds` | `main` / `false` | ✅ |
| `base` / `cmd` / `dir` | `astro-site` / `npm run build` / `dist` | ✅ |

既に作成済みの branch deploy（`be4d0178`）は**生きたまま**なので、
Stripe の送信先 URL は引き続き修正済みコードへ届く。

#### 残っている Stripe Test Mode の状態（cleanup は未実施）

- サブスク: `sub_1UBEQt…`（解約済み）/ `sub_1UBRZ7…`（**有効のまま**・今回作成）
- `RewardLedger` 2 行・`Customers` のテスト会員 1 レコード
- 🔴 後片付けは指示があるまで行わない

### 2026-09-03 #17 の実施結果 — 🔴 **未達**（Stripe がこの経路では `invoice.payment_failed` を出さない）

承認に従い、Stripe 公式のサンドボックス用「請求が失敗する」テストカード
`4000 0000 0000 0341`（Stripe Test (multi-country) 発行）**のみ**を使い、
対象を `0510apolon+test4@gmail.com` **1 会員**に限定して実施した。実カードは使っていない。

#### 実施内容

1. テスト会員に失敗用カードを登録（`pm_1UBRwf…` / `•••• 0341`）
2. そのカードを支払い手段としてサブスクを作成（初回請求 ¥3,980・即時）
3. 支払いは**予定どおり失敗**（`pi_3UBRz9…` 失敗・13:10 JST）

#### 🔴 しかし `invoice.payment_failed` は発生しなかった

Stripe 側で実際に起きたイベント（ワークベンチのイベント一覧で確認）:

| 時刻 | イベント |
|---|---|
| 13:08:15 | `payment_method.attached`（0341 を顧客へ登録）|
| 13:10:47 | `payment_intent.created` |
| 13:10:48 | **`charge.failed`** |
| 13:10:48 | **`payment_intent.payment_failed`** |
| 13:10:48 | `payment_intent.canceled`（`cancellation_reason: "failed_invoice"`）|

**`invoice.payment_failed` は 1 件も作られていない。**
サブスクの**初回**請求が失敗した場合、Stripe は請求書を `failed_invoice` として
取り消し、サブスク自体を作らずに終える（顧客のサブスクは
`sub_1UBRZ7…`（有効）と `sub_1UBEQt…`（キャンセル済み）の **2 件のまま**）。

`invoice.payment_failed` は **更新（2 回目以降）の請求が失敗したとき**に出るため、
再現するには **Stripe Test Clock で請求サイクルを進める**必要がある。
Test Clock は**新しい顧客を作る**ことになり、
承認された「対象はテスト会員 1 会員・`Customers` 更新のみ」の範囲を超えるため、
**ここで停止した**。

#### 検証結果（read-only）

| 検査 | 結果 |
|---|---|
| `Status=payment_failed` | 🔴 **未達**（`inactive` のまま）。webhook が発火していないため |
| `RewardLedger` | ✅ **2 行のまま**（増えていない）|
| 実会員（`0510apolon` 以外 62 件）| ✅ `payment_failed` **0 件** / `CancelledAt` **0 件** |
| `Customers` 総数 | ✅ **66**（増減なし）|
| `MembershipStartedAt` | ✅ **7 件**（不変）|

🔴 **これは KI 側の不具合ではない。** `invoice.payment_failed` のハンドラは
`applyPlan({ status: 'payment_failed' })` を呼ぶだけで実装は正しく、
**イベントが発火していないので呼ばれていない**だけである。
実運用では Checkout が決済成功後にしか `checkout.session.completed` を出さないため、
「初回失敗」はそもそもプラン付与前で記録対象が無い。

### 2026-09-03 Test Mode E2E 17 項目の最終判定

| # | 区分 | 内容 | 判定 |
|---|---|---|---|
| 1 | A 認可 | 無料会員でログイン → 印が見える / 買い目は見えない | **未実施**（ログインにメール受信が必要）|
| 2 | A 認可 | `/pricing` のボタン表示 | **未実施** |
| 3 | A 認可 | Checkout でテストカード決済 → 成功 | ✅（2026-09-02 の記録）|
| 4 | A 認可 | `checkout.session.completed` が 200 | ✅ |
| 5 | A 認可 | 予想ページで買い目が開く / 印は出ない | **未実施**（ログインが必要）|
| 6 | A 認可 | 同じイベントを再送 → Airtable が二重更新されない | ✅（不変を実測）／ 🟡 応答の `duplicate:true` は**未観測**（`{"received":true}`）|
| 7 | B リワード | `invoice.payment_succeeded` が 200 | ✅ |
| 8 | B リワード | `RewardLedger` が 1 行だけ増える | ✅ |
| 9 | B リワード | `Type` / `Points=100` / **`PeriodMonths=1`** / `SourceRef` / `OccurredAt` | ✅（修正後に実測）|
| 10 | B リワード | 同じ invoice を再送 → 行が増えない | ✅ |
| 11 | B リワード | `ContractPriceYen=3980` / `jpy` / `ContractPriceId` | ✅（`ki_price_id` と完全一致）|
| 12 | B リワード | `/mypage` 残高 100pt・今月 100pt | ✅（read-only・本番と同じ関数）|
| 13 | C 解約 | 解約イベントが 200 | ✅ |
| 14 | C 解約 | 買い目が閉じる / 印は見える | ✅（read-only・`tiers.js` 実関数）|
| 15 | C 解約 | `CancelledAt` に解約日 | ✅ |
| 16 | C 解約 | ポイントは残る | ✅ |
| 17 | C 失敗 | `Status=payment_failed` のみ・台帳が増えない | 🔴 **未達**（台帳が増えないことは ✅、`Status` は発火せず）|

**判定: ✅ 12 / 🟡 1（#6 の一部）/ 未実施 3 / 🔴 未達 1。**
正本の完成条件「**17 項目すべてが期待どおり**」には **到達していない**。

未実施の 1・2・5 は、いずれも**テスト会員としてログインする**必要があり、
マジックリンクのメール受信が要る（こちらからは受け取れない）。

#### Test Mode に残っている状態（cleanup 未実施）

- サブスク: `sub_1UBRZ7…`（**有効**）/ `sub_1UBEQt…`（キャンセル済み）
- 決済手段: `•••• 4242`（成功用）/ **`•••• 0341`（失敗用・今回追加）**
- `RewardLedger` 2 行 / `Customers` のテスト会員 1 レコード
- 🔴 後片付けは指示があるまで行わない

### 🔴 2026-09-03 手順0（branch deploy 再ビルド）が実行できない — 原因確定

承認を受けて `57da2619` を branch deploy へ再ビルドしようとしたが、**実行できない**。
サイトの build 設定が原因で、**このブランチには branch deploy が作られない**。

#### 原因（`netlify api getSite` の実測・read-only）

```
allowed_branches: ["main"]
repo_branch:      "main"
stop_builds:      false
```

**branch deploy の対象が `main` だけに絞られている。**
そのため `test/stripe-testmode-e2e-2026-09-01` は、push しても
**deploy-preview しか作られず、branch deploy は作られない**。

| context | 最新 commit | 時刻 |
|---|---|---|
| branch-deploy | **`4aadb0a8`** | 2026-09-02 14:24 UTC（**これ以降 1 件も無い**）|
| deploy-preview | `57da2619` | 2026-09-03 03:05 UTC（ready）|

直近 100 デプロイを見ても、`4aadb0a8` より新しい branch-deploy は **1 件も存在しない**。
`4aadb0a8`（14:24）の直後から止まっているため、**その頃に設定が `["main"]` へ絞られた**
と考えられる（誰がいつ変えたかは API からは分からないので断定しない）。

#### なぜ迂回できないか

| 案 | 可否 |
|---|---|
| 既存の build hook を使う | 🔴 その hook は **`main` 用**。誤って **production build** を起こす危険がある |
| `createSiteBuild` を叩く | 🔴 既定ブランチ（`main`）を建てる＝**Production deploy**。禁止されている |
| deploy-preview（`57da2619` ready）を使う | 🔴 Stripe の送信先 URL は **branch deploy の URL**。
  preview を使うには **Stripe の設定変更**が必要で、禁止されている |
| ブランチに実変更を push | 🔴 `allowed_branches: ["main"]` のままでは、何を push しても branch deploy は作られない |

**したがって手順0 には `allowed_branches` の変更（Netlify のビルド設定変更）が要る。**
これは承認された「再ビルド」の範囲を超え、しかも
**意図的に絞られた設定を元へ戻す**ことになるため、**独断で変更せず停止した**。

#### 影響

- 現在の branch deploy URL は **`4aadb0a8` を配信し続けている**（URL は生きており Stripe の配信も通る）。
  ただし **`PeriodMonths` 修正（`57da2619`）は載っていない**。
- **完成条件 #9 はこの状態では満たせない**。新しい支払いを起こしても `PeriodMonths` は空のままになる。
- 本番（`main` / production）には影響しない。修正は branch に commit 済みで、
  main へ merge すれば production には載る（**merge は未承認・未実施**）。

#### 承認が要る選択

1. `allowed_branches` に `test/stripe-testmode-e2e-2026-09-01` を**一時的に追加**して
   branch deploy を作り直し、E2E 後に `["main"]` へ戻す
2. Stripe の送信先 URL を deploy-preview（`deploy-preview-82--…`）へ向け替える
   （🔴 Stripe 設定変更。現在は禁止）
3. #9 の実測を諦め、**#9 は単体テスト（往復テスト）での担保にとどめる**

#### 既存 1 行の遡及更新

🔴 **行わない**（仕様所有者の指示・2026-09-03）。
その行は月額 1 か月ぶんで、旧行として 1 か月と数えられるため**値は正しい**。

### 2026-09-03 二重配信の解消（承認済み・Test Mode のみ）

同一 URL を指す送信先が 2 つあり、片方は今週 12 件すべて 400 `invalid_signature` だった。
**`KI Stripe Test E2E`（`we_1UAgTiLbPC6OVRqMcfol1yoP`）を無効化**して解消した。

| 送信先 | 変更前 | 変更後 |
|---|---|---|
| `KI Test Webhook`（`we_1UAsSe…`）| アクティブ・イベント 5 件 | **変更なし（アクティブ）** |
| `KI Stripe Test E2E`（`we_1UAgTi…`）| アクティブ・イベント 6 件・今週 12/12 失敗 | **無効** |

- 失うものが無いことを確認済み: `KI Test Webhook` の 5 件は `stripe-webhook.js` の
  5 つの `case` と完全一致。無効化した側の固有 2 件（`customer.bank_account.updated` /
  `customer.card.updated`）は**コードに分岐が無く**、逆に付与に必要な
  `invoice.payment_succeeded` を**持っていなかった**。
- **削除ではなく無効化**（可逆。設定・署名シークレット・配信履歴は保持）。
- 🔴 **本番（Live Mode）の送信先には触れていない。** env（`STRIPE_WEBHOOK_SECRET`）も未変更。
- 判断の記録: `docs/decisions.md`「2026-09-03 — Test Mode の重複 webhook 送信先を無効化する」

### 2026-09-03 R-2 冪等性の切り分け — `@netlify/blobs` を正規依存化 ＋ 失敗の可視化

- **症状**: Test Mode で同一 `event.id` を再送しても、応答が `duplicate:true` にならない
  （E2E #6 が 🟡 のまま。二重更新が無いことだけは確認済み）。
- 🔴 **原因は未確定。断定を訂正した。**
  当初「`@netlify/blobs` が `dependencies` に無いのでバンドルで解決できない」と報告したが、
  これは**成立しない**。`@netlify/blobs` は `@astrojs/netlify`（本番 `dependencies`）の
  推移的依存として `node_modules` に載っており（10.5.0・非 dev）、
  `netlify.toml` の `node_bundler = "esbuild"` は `external_node_modules`
  （`airtable` / `@sendgrid/mail` / `stripe`）以外を**バンドルに取り込む**。
- **確定しているのはこれだけ**: `eventStore()` / `hasProcessed()` / `markProcessed()` が
  引数なしの `catch {}` で失敗を握りつぶしていたため、
  - `hasProcessed` は常に `false` を返す（＝毎回「初回」扱い）
  - `markProcessed` は無言で何もしない

  となり、**応答にもログにも痕跡が残らず、次の 2 つを切り分けられなかった**。

  | 想定 | 実際に出るエラー |
  |---|---|
  | Blobs の環境が関数に渡っていない | `MissingBlobsEnvironmentError` |
  | バンドルに載っていない | `ERR_MODULE_NOT_FOUND` 等 |

- **単体テストが緑だった理由**: `stripeWebhook.test.mjs` は `@netlify/blobs` を
  `mock.module` で差し替えるため、**依存が無くてもテストは通る**。本番だけ壊れる型の欠陥。

#### 実施した修正

1. `@netlify/blobs@^10.5.0` を `astro-site/package.json` の `dependencies` へ**明示**。
   推移的依存に頼ると上流の都合で黙って消える。
   lockfile はルートの `dependencies` 1 行だけを追加（**差分は 2 ファイル 2 行・削除 0**）。
   🔴 `npm install --package-lock-only` は `netlify-cli` 配下の optional/peer エントリを
   **475 行削除**する正規化を起こしたため、**差し戻して手で最小差分にした**。
2. `logBlobsFailure(where, err)` を追加し、`getStore` / `get` / `set` の 3 経路すべてで
   `console.error` に**種別と文言だけ**を 1 行出す（🔴 値・トークン・顧客情報は出さない）。
3. 🔴 **store をキャッシュしない**（意図的）。一度成功した store を使い回すと、
   あとから Blobs が壊れても検出できず、テストの broken 状態も再現できなくなる。
4. 静的ガード `src/lib/billing/stripeWebhookBlobs.guard.test.mjs`（4 件）を追加し
   `test:stripe` に接続。固定するのは
   「直接依存であること」「package.json と lockfile がずれないこと」
   「Blobs 区間に引数なしの `catch {}` を置かないこと」「store をキャッシュしないこと」
   「記録は処理成功後（`hasProcessed` → `markProcessed` の順）であること」。
   🔴 ガードは `node --test` を**使わない**。既存ガード
   「`test:stripe` は `--test` を使わない」（IPC の `Unable to deserialize cloned data` 対策・`c1ae2b8f`）
   に従い、ファイルを直接実行する。

#### 範囲外として手を付けなかったもの

- `stripe-webhook.js` の他の 5 箇所の引数なし `catch {}`（258 / 284 / 440 / 489 / 631 行）は
  **いずれも `console.warn` / `console.error` を伴っており黙っていない**。
  エラー詳細を応答へ返さないための意図的な設計なので、そのままにした。
  静的ガードも Blobs 区間だけに限定している。

#### テスト結果

| コマンド | 結果 |
|---|---|
| `npm run test:stripe` | ✅ webhook 48 / checkout 17 / **新規ガード 4** = 69 pass・0 fail |
| `npm run build` | ✅ 成功（全テスト → `astro build` → `prune:function-data` まで完走）|

lint / typecheck: **スクリプト未定義のため実行不可**（従来どおり）。

#### branch deploy（承認済み・`allowed_branches` の一時追加）

Stripe Test Mode の送信先は **`test/stripe-testmode-e2e-2026-09-01` の branch deploy URL**
（`https://test-stripe-testmode-e2e-2026-09-01--keiba-intelligence.netlify.app`）である。
🔴 **Stripe の送信先 URL は変更しない**方針のため、修正を**このブランチへ cherry-pick** した
（新規ブランチ名で branch deploy を作ると URL が変わり、Stripe から届かない）。

| 項目 | 変更前 | 変更中 | 戻した先 |
|---|---|---|---|
| `allowed_branches` | `["main"]` | `["main","test/stripe-testmode-e2e-2026-09-01"]` | ✅ **`["main"]`** |

- 変更前の設定は scratchpad の `site-before.json` に保存。
- 変更したのは `allowed_branches` **1 項目のみ**。復旧後に
  `repo_branch` / `stop_builds` / `base` / `cmd` / `dir` / `functions_dir` /
  `skip_prs` / `package_path` / `build_filter` / `skip_automatic_builds` が
  **変更前と完全一致**することを read-only で確認した。
- 🔴 `main`（production）の扱いは変えていない。

| 検査 | 結果 |
|---|---|
| branch deploy | ✅ **`f84431de` ready**（2026-09-03 14:17 UTC・`deploy_time` 53s・`error_message: null`）|
| HEAD 一致 | ✅ `git rev-parse test/stripe-testmode-e2e-2026-09-01` = `f84431de` = `commit_ref` |
| エンドポイント疎通 | ✅ 署名なし POST → **400 `invalid_signature`**（書き込み前に fail-closed）|
| `allowed_branches` 復旧後も URL 生存 | ✅ `GET /` → **200**（既存 deploy は削除されない）|

#### 🔴 実測（#6）は未実施 — 手段が無く停止

| 項目 | 状態 |
|---|---|
| 同一 `event.id` の再送 → 2 回目 `duplicate:true` | 🔴 **未実施** |
| Airtable / `RewardLedger` に追加更新なし | 🔴 **未実施** |

理由: ローカルに **Stripe CLI が無く**、`STRIPE_SECRET_KEY`（Test）/ `STRIPE_WEBHOOK_SECRET` /
`AIRTABLE_API_KEY` の**いずれも未設定**。署名なしの POST は 400 で弾かれるため、
再送を成立させられない。

🔴 Netlify の env から値を取り出す方法は取らなかった。
`CLAUDE.md`「Immediate stop conditions」の
**「secret・token・認証値が出力される可能性」**に該当するため、独断で実行しない。

#### Draft PR

| 項目 | 値 |
|---|---|
| PR | **#95**（Draft・base `main`・`MERGEABLE`）|
| branch | `fix/blobs-dependency-idempotency-2026-09-03`（`origin/main` `e8cdad36` を merge 済み）|

🔴 **未実施の高リスク操作**: main merge / Production deploy / Stripe 設定変更 / Test Mode の cleanup。

### 2026-09-04 #6 は FAIL → 真因を確定（v1 Lambda で `connectLambda` を呼んでいなかった）

#### 実測（仕様所有者が実施）

| # | 内容 | 実施 | HTTP | 応答 |
|---|---|---|---|---|
| 1 | `customer.subscription.deleted`（同一 `event.id`）| 2026-09-04 10:10:48 JST | **200** | `{"received":true}` |
| 2 | 同上・再送 | 10:12:15 JST | **200** | `{"received":true}` |

🔴 **2 回目も `duplicate:true` にならず ＝ #6 は FAIL。merge しない。**

#### Netlify Function logs は取得できなかった

- `netlify logs:function stripe-webhook` は**ライブストリームのみ**で、45 秒待っても 0 行。
  過去ログの replay は無い。
- `netlify api --list` に **function log 取得の method は存在しない**
  （`searchSiteFunctions` / `updateSiteBuildLog` / `uploadDeployFunction` のみ）。
- 🔴 Netlify env から token を取り出して独自に叩く方法は取らなかった
  （`CLAUDE.md`「Immediate stop conditions」の「secret・token・認証値が出力される可能性」）。

**そこでログではなく `@netlify/blobs@10.5.0` の実ソースから確定させた。**

#### 真因（実装ソースで確定）

`stripe-webhook.js` は **v1（Lambda 互換）関数**である。

- `export async function handler(event)` / `event.httpMethod` / `{ statusCode, body }` を返す

v1 では **Blobs の環境が `process.env` に入らない**。`siteID` / `token` は
**`event.blobs`（base64）と `x-nf-site-id` / `x-nf-deploy-id` ヘッダー**で渡ってくる。
これを環境へ展開するのが `connectLambda(event)`（`dist/main.js` の `lambda_compat.ts`）。

呼んでいなかったため、次の順で必ず失敗していた。

| 段 | 実装 | 結果 |
|---|---|---|
| 1 | `getEnvironmentContext()` が `globalThis.netlifyBlobsContext` / `NETLIFY_BLOBS_CONTEXT` を見る | どちらも無いので **`{}`** |
| 2 | `getStore('stripe-events')` → `getClientOptions({}, undefined)` | `siteID` / `token` が undefined |
| 3 | `if (!siteID || !token) throw new MissingBlobsEnvironmentError(["siteID","token"])` | **throw** |
| 4 | 旧実装の引数なし `catch {}` | **握りつぶし → `null`** |
| 5 | `hasProcessed()` | **常に `false`（毎回「初回」扱い）** |

🔴 これで「3 回再送しても `duplicate:true` が出ない」が完全に説明できる。

**なお `getStore` が文字列引数で throw する点は、前 commit の想定（`get`/`set` で落ちる）とは異なる。**
`getClientOptions` は `Store` を作る前に呼ばれるため、**落ちるのは `getStore` の中**である。

#### 恒久修正

```js
async function eventStore(event) {
  const { getStore, connectLambda } = await import('@netlify/blobs');
  if (event?.blobs && typeof connectLambda === 'function') connectLambda(event);
  return getStore('stripe-events');
}
```

`event` を `hasProcessed(event, id)` / `markProcessed(event, id)` へ渡す。
`event.blobs` が無い環境（単体テスト等）では `connectLambda` を呼ばない。

#### 🔴 単体テストが見逃した理由と、その恒久対策

mock は環境を要求しないので、`connectLambda` が無くても緑だった。
**mock を本番と同じ条件に変えた。**

- `post()` が**本番同型の Lambda イベント**（`event.blobs` ＋ `x-nf-*` ヘッダー）を送る
- mock の `getStore` は `connectLambda` 未呼び出しなら **`MissingBlobsEnvironmentError` を投げる**

これで**既存の冪等性テストが実効ガードになる**。
実際に `connectLambda` を外すと **4 件が fail** することを確認した（mutation 検証）。

| 外したときに落ちるテスト |
|---|
| 🔴 冪等: 同じ `event.id` を二度処理しない |
| 🔴 同じ invoice の `payment_succeeded` を再送しても二重処理しない |
| 🔴 membership 失敗のイベントは processed にしない |
| 🔴 フラグ未設定（やることが無い）は失敗にしない |

静的ガードにも `connectLambda` の**呼び出し順**・`event` の受け渡し・
テストが本番同型イベントを送っていることを追加（4 → **6 件**）。

#### 併せて直したもの（本修正が必要にしたもの）

`membershipCopy.guard.test.mjs` が `'await markProcessed(stripeEvent.id);'` を
**文字列でハードコード**しており、シグネチャ変更で落ちた。
検査したいのは「**失敗判定より後に記録すること**」であって引数の形ではないため、
`'await markProcessed('` を探す形に変えた（意図は不変）。

#### テスト結果

| コマンド | 結果 |
|---|---|
| `npm run test:stripe` | ✅ **71 pass / 0 fail**（webhook 48・checkout 17・ガード 6）|
| `npm run build` | ✅ **exit 0**・全 **14 スイート fail 0** |

#### branch deploy（承認済み・`allowed_branches` の一時追加 → 復旧）

| 項目 | 変更前 | 変更中 | 戻した先 |
|---|---|---|---|
| `allowed_branches` | `["main"]` | `["main","test/stripe-testmode-e2e-2026-09-01"]` | ✅ **`["main"]`** |

| 検査 | 結果 |
|---|---|
| branch deploy | ✅ **`d13bb188` ready**（2026-09-04 01:20 UTC・`deploy_time` 386s・`error_message: null`）|
| HEAD 一致 | ✅ `origin/test/stripe-testmode-e2e-2026-09-01` = `commit_ref` = `d13bb188` |
| 疎通 | ✅ 署名なし POST → **400 `invalid_signature`**（書き込み前に fail-closed）|
| 設定復旧 | ✅ **18 項目すべて変更前と完全一致**（`allowed_branches` / `repo_branch` / `stop_builds` / `base` / `cmd` / `dir` / `functions_dir` / `skip_prs` / `package_path` / `build_filter` / `skip_automatic_builds` / `private_logs` / `untrusted_flow` / `public_repo` / `provider` / `repo_url` / `repo_path` / `base_rel_dir`）|
| 復旧後の URL 生存 | ✅ `GET /` → **200**（既存 deploy は削除されない）|

### 2026-09-04 #6 実測 — ✅ **PASS**（仕様所有者が実施）

修正済み branch deploy（`d13bb188`）に対し、**同一 `event.id` を再送**した。

| 検査 | 結果 | 判定 |
|---|---|---|
| 2 回目の応答 | **HTTP 200 / `{"received":true,"duplicate":true}`** | ✅ |
| `RewardLedger`（テスト会員）| **2 行のまま**（9/2・9/3 のみ。**9/4 の追加なし**）| ✅ |
| `Customers`（同）| **1 レコードのみ** / `inactive` / `CancelledAt=2026-09-03` | ✅ |

Airtable は **read-only で確認**（追加更新なし）。

🔴 **修正前との対比**

| | 修正前（`f84431de`）| 修正後（`d13bb188`）|
|---|---|---|
| 1 回目 | 200 `{"received":true}` | 200 `{"received":true}` |
| 2 回目（同一 `event.id`）| 200 `{"received":true}` ❌ | **200 `{"received":true,"duplicate":true}`** ✅ |

これで `docs/STRIPE_TESTMODE_E2E.md` の **#6 は PASS**。
🔴 ただし #1 / #2 / #5（未実施）と **#17（未達）** は変わっていないため、
「17 項目すべてが期待どおり」という **Live Mode へ進む条件は依然として満たしていない**。

#### 🔴 Test Mode cleanup は未実施（承認境界で停止）

外部サービスの設定変更・削除を含むため実行していない。対象と rollback は
`CLAUDE.md`「High-risk approval boundary」に従い、承認を得るまで着手しない。

### 2026-09-04 PR #95 を squash merge ＋ 本番反映（仕様所有者承認）

| 項目 | 値 |
|---|---|
| PR | **#95**（Draft 解除 → **squash merge**）|
| merge 方式 | ✅ **squash merge**（`CLAUDE.md`「🔀 Git マージ規約 🔀」どおり。PR #82 の誤りを繰り返していない）|
| `main` 先端 | **`bc1e5e6a`** 🔒 Stripe webhook の冪等性を修正: v1 Lambda 関数で connectLambda を呼ぶ (#95) |
| merged at | 2026-09-04 06:52:34 UTC |
| 本番デプロイ | ✅ **`bc1e5e6a` production ready**（published 06:58:36 UTC・`deploy_time` 357s・`error_message: null`）|

🔴 squash により branch の commit SHA（`350a2c45` / `726eb7d1` 等）は `main` に残らない。
**内容は本書の本文に書いてあるので、SHA を辿る必要はない。**

#### merge 前の最終検証

| 検査 | 結果 |
|---|---|
| 追随方法 | **通常 merge のみ**（専用 worktree・detached HEAD）。rebase / reset / force / cherry-pick 不使用 |
| merge conflict | なし（`origin/main` の 3 commits はデータ自動取込のみ）|
| ahead / behind | **behind=0 / ahead=7** |
| `npm ci`（新規 worktree）| ✅ exit 0 ＝ package.json と lockfile の整合を証明 |
| `npm run test:stripe` | ✅ 71 pass / 0 fail |
| `npm run build` | ✅ exit 0・全 14 スイート fail 0 |
| secret / PII | ✅ 追加行に検出なし |
| CI | ✅ PASS（deploy-preview ready）|
| PR 全体 | 7 files / +475 / −16 |

#### 本番での実測（read-only）

🔴 POST は **独自ドメインへ直接**送った（`netlify.app` は 301 で GET に変換されるため使わない）。

| 検査 | 結果 | 判定 |
|---|---|---|
| `GET /.netlify/functions/stripe-webhook` | **405** `method_not_allowed` | ✅ |
| `POST`（署名なし）| **503** `not_configured` | ✅ fail-closed |
| guest → `/prediction/nankan` | **302 → `/free-prediction/nankan`** | ✅ |
| guest → `/prediction/jra` | **302 → `/free-prediction/jra`** | ✅ |
| `/free-prediction/{nankan,jra}` | **200** | ✅ |
| `/register` / `/pricing` / `/mypage` | **200** | ✅ |
| `/login` | **301 → `/login/`**（末尾スラッシュ正規化）| ✅ |

🔴 **本番の 503 `not_configured` は正常。** `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` が
**production スコープに未設定**であることを意味する（Live Mode 未設定＝現状の意図どおり）。
この分岐は本 PR で**一切触れていない**ので、今回の変更による退行ではない。

**したがって、この修正が本番で実際に効くのは Live Mode を設定してからである。**
Test Mode の branch deploy では #6 が PASS 済み。

#### 会員影響

- 変更したのは `stripe-webhook.js` の **Blobs 冪等性まわりのみ**。
  **認可・entitlement の仕様は変更していない**（`applyPlan` / `resolveEntitlement` /
  tier 判定に差分なし）。
- 本番の 503 fail-closed により、**署名検証なしの書き込みは起きない**。

#### rollback

問題があれば **通常の revert PR** で戻す。🔴 履歴改変（force / reset / rebase）は行わない。

#### 🔴 未実施（承認境界）

- **Test Mode cleanup**（対象と rollback は前節のとおり。外部サービスの設定変更・削除を含む）
- **Live Mode 設定**（production スコープへの `STRIPE_*` 設定 ＝ secret 変更）
- Live Mode へ進む条件（`docs/STRIPE_TESTMODE_E2E.md` の 17 項目すべて）は
  **#1 / #2 / #5 未実施・#17 未達**のため**依然として満たしていない**。





### 2026-09-05 押せる UI の配色を統一（PR #97 を squash merge ＋ 本番反映）

| 項目 | 値 |
|---|---|
| PR | **#97**（Draft 解除 → **squash merge**）|
| `main` 先端 | **`88b7b88a`** |
| merged at | 2026-09-04 15:43:18 UTC |
| 本番デプロイ | ✅ **production ready**（published 15:44:23 UTC・`deploy_time` 62s・`error_message: null`）|
| 変更規模 | **25 files / +502 −269**（データ自動取込を除く）|

#### きっかけ

`/login` の送信成功メッセージが読めないという指摘。原因は
**明るい背景のページにダークテーマ用の配色が残っていたこと**で、
同じ欠陥がサイト全体にあった。

#### 確定した方針（2026-09-05・仕様所有者）

- 押せる UI は **単色・同系色の濃淡を使わず、明確に異なる 2 色のグラデーション**にする
- 気に入っている 3 か所を基準にする:
  ヘッダー/フッターの「KEIBA Intelligence」・フッターの無料会員登録ボタン・チャットボタン
- **明るい配色 ＋ 濃色文字**（白文字にしない）
- 意味色（枠色・印色・chart 色・`badge-*`・`disabled`）は変更しない

#### 確定した配色（`global.scss` のトークン）

| トークン | 配色 | 濃色文字のコントラスト |
|---|---|---|
| `--btn-ink` | `#0b1020` | — |
| `--grad-nav-btn`（主要 CTA）| 空 → 藤 → ほんのり桃 `#38bdf8 → #a78bfa 60% → #f9a8d4` | 8.84 / 6.96 / 10.44 |
| `--grad-outlook-btn`（探索）| シアン → 青 → ほんのり藤 `#22d3ee → #60a5fa 55% → #c4b5fd` | 10.48 / 7.45 / 10.26 |
| `--grad-conclusion-btn`（AI 判断）| 藤 → 桃 `#c084fc → #f472b6` | 7.17 / 7.15 |
| `--grad-action-btn`（購入/登録）| 桃 → 琥珀 `#f472b6 → #fbbf24` | 7.15 / 11.34 |
| `--grad-tool-btn`（控えめ補助）| 淡空 → 淡藤 → 淡桃 `#bae6fd → #ddd6fe 60% → #fbcfe8` | 14.27 / 13.64 / 13.70 |

🔴 **hover は単色に戻さない。** 2 色を保ったまま `background-position` /
`brightness` / `shadow` で変化させる。

#### 途中で見つかった 3 つの真因（いずれも記録に値する）

1. 🔴 **plain CSS に `//` コメントを書いて宣言を無効化していた**
   `index.astro` の `<style>` は `lang="scss"` ではない。CSS にスラッシュ 2 つの
   コメントは無いため、**そこから次のセミコロンまでが 1 つの不正な宣言**として
   捨てられ、直後の `background` ごと消えていた。ヒーローが青→橙のままだったのは
   これが原因（specificity の問題ではなかった）。コメントの入れ子（`/* */` の中に
   `/* */`）も同様に壊れる。
2. 🔴 **`.hero` に背景画像の残骸オーバーレイが残っていた**
   `rgba(15,23,42,0.50→0.10)` が白いページに重なり「中間グレーの帯」を作っていた。
   明度が中間なので明るい文字も暗い文字も読めない。`@media (max-width: 640px)` に
   **別途もう 1 か所**あり、モバイルだけ直らない原因になっていた。
3. 🔴 **淡い色はページ背景（`--bg-primary #f5f7fb`）と近く「灰色」に見える**
   `#e0f2fe → #ede9fe` まで色を入れても灰色に見えると指摘された。
   淡さで刻むと判別できないため、**既存トークンをそのまま使う**方が早い。

#### 既存ガードの更新（本修正が必要にしたもの）

`entitlementRoutes.test.mjs` / `purchaseIntent.test.mjs` が
`var(--grad-nav)` / `var(--grad-action)` を文字列で固定していたため、
`-btn` 変種を許容する形にした。**役割分担の検査意図は変えていない。**
新トークンも「2 色であること」を検査対象に追加した。

#### 本番での実測（read-only）

| 検査 | 結果 |
|---|---|
| `/` `/pricing` `/login/` `/register` `/free-prediction/nankan` `/mypage` `/archive/nankan/` | **200** ✅ |
| guest → `/prediction/nankan` | **302 → `/free-prediction/nankan`** ✅ 認可は不変 |
| `POST /.netlify/functions/stripe-webhook`（署名なし）| **503 `not_configured`** ✅ fail-closed |
| 配信 CSS のトークン | 6 つすべて確認 ✅ |
| ヒーロー背景 | `linear-gradient(180deg,#e0f2fe,#f5f3ff 55%,#fff)` ✅ |
| 旧オーバーレイ `rgba(15,23,42` | **残存 0** ✅ |

🔴 **auth / entitlement / Stripe / API / 表示条件は変更していない。**
rollback は通常の revert PR（履歴改変はしない）。

#### 🔴 未実施（承認境界）

- **Test Mode cleanup**（対象と rollback は 2026-09-04 の節のとおり）
- **Live Mode 設定**（production スコープへの `STRIPE_*` 設定 ＝ secret 変更）
- Live Mode の条件（`docs/STRIPE_TESTMODE_E2E.md` の 17 項目）は
  **#1 / #2 / #5 未実施・#17 未達**のため依然として未達。

### 2026-09-05 #17 の再現手順を設計（read-only 調査。**write は未実施**）

2026-09-03 の実施で「Stripe がこの経路では `invoice.payment_failed` を出さない」ことが
確定している（サブスクの**初回**請求が失敗すると、Stripe は請求書を `failed_invoice` として
取り消し、サブスクを作らずに終える）。**更新（2 回目以降）の請求を失敗させる**必要がある。

#### コードを読んで確定した前提（read-only）

| 検査 | 結果 |
|---|---|
| `invoice.payment_failed` の処理 | `applyPlan(email, { status: 'payment_failed' })` **のみ**。`planType` / `accessEnabled` は渡さない ＝ **触らない** |
| 宛先 email の解決（`emailFromInvoice`）| `invoice.parent.subscription_details.metadata.ki_email` → `invoice.subscription_details.metadata.ki_email` → `invoice.customer_email` の順。**どれも無ければ skip** |
| リワード | `invoice.payment_failed` では membership store を**一切触らない**（付与は `invoice.payment_succeeded` 駆動）|
| `customer.subscription.updated(past_due)` | `ACTIVE_STATUSES`(active/trialing) にも `canceled/unpaid/incomplete_expired` にも当たらず **`else` で無視**（Airtable 書き込みなし）→ **アクセスは止まらない** |
| 🔴 注意 | dunning が進んで `unpaid` / `canceled` になると **free へ降格する**。**trial 終了直後より先へ時計を進めないこと** |

#### 設計した再現手順（Test Clock・**未実施**）

初回請求を成功させない形にして、`RewardLedger` が増えないことを素直に検査できるようにする。

1. **Test Clock** を作成（現在時刻で固定）
2. その clock に紐づく **新しいテスト Customer** を作成（`email` はテスト会員と同じ）
3. 失敗用の支払い方法 `pm_card_chargeCustomerFail`（`4000 0000 0000 0341`）を attach し既定にする
4. **Subscription** を作成
   - `price` = Branch deploys スコープの `STRIPE_PRICE_PREMIUM`
   - `trial_period_days: 1`
   - 🔴 `metadata: { ki_plan: 'premium', ki_email: <テスト会員の email> }`
     （これが無いと `emailFromInvoice` が null を返し **skip される**）
5. **Test Clock を trial 終了直後まで進める**（それ以上進めない）
   → 更新請求が作られて失敗 → **`invoice.payment_failed`** が `KI Test Webhook` へ届く

#### 期待結果（実施後に埋める）

| 検査 | 期待 |
|---|---|
| Stripe の webhook ログ | `invoice.payment_failed` が **200** |
| `Customers`（テスト会員）| `Status` = **`payment_failed`** |
| 同上 | `PlanType` / `AccessEnabled` が **実施前と完全に一致**（触らない契約）|
| `RewardLedger` | **行数が変わらない**（2 行のまま）|
| 予想ページ | アクセスが止まっていない |

#### 実施前に確認済み（read-only）

| 検査 | 結果 |
|---|---|
| branch deploy `d13bb188` | ✅ ready・`GET /` 200 |
| webhook の設定 | ✅ 署名なし POST → **400 `invalid_signature`**（＝ `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` が Branch deploys に効いている）|
| `/login/` `/pricing` `/free-prediction/nankan` `/mypage` | ✅ 200 |
| guest → `/prediction/nankan` | ✅ 302 → `/free-prediction/nankan` |

🔴 `MEMBERSHIP_WRITE_ENABLED` は **不要**（`invoice.payment_failed` は membership store を触らない）。
env は変更しない。

#### 🔴 承認境界（ここで停止）

手順 1〜5 はすべて **Stripe Test Mode への write**。未実施。
必要な承認・影響・rollback は本セッションの報告に記載した。

#### #1 / #2 / #5 の準備（仕様所有者の実機操作待ち）

| # | 画面 | 期待 |
|---|---|---|
| 1 | branch deploy の `/login/` でテスト用アドレスの**無料会員**としてログイン → `/free-prediction/nankan` | **印が見える / 買い目は見えない** |
| 2 | `/pricing` | ボタンが「このプランを申し込む」・金額 **¥3,980** |
| 5 | （課金後）`/prediction/nankan` | **買い目・AI指数・AI結論が開く / 印は出ない**（R-8）|

URL: `https://test-stripe-testmode-e2e-2026-09-01--keiba-intelligence.netlify.app`
🔴 この branch deploy は `d13bb188` を配信しており、**2026-09-05 の配色統一（PR #97）は載っていない**。
#1/#2/#5 は印・買い目の**出し分け**の確認なので、配色の差は判定に影響しない。

### 2026-09-05 #17 — 仕様所有者が Stripe Sandbox で再現。🔴 **検証は未完了**

仕様所有者から「Stripe **Sandbox** で `0510apolon+test4@gmail.com` の
トライアル終了 → ¥3,980 決済失敗 → `past_due` / リトライ まで再現済み」との報告。

#### 🔴 read-only では確認できなかった（手段が無い）

| 確認したかったこと | 必要なもの | 状態 |
|---|---|---|
| `invoice.payment_failed` が webhook で 200 | Stripe の配信ログ | 🔴 **不可**（`STRIPE_SECRET_KEY` 未設定・Stripe CLI 無し）|
| `Customers` の `Status` / `PlanType` / `AccessEnabled` | Airtable の read | 🔴 **不可**（`AIRTABLE_API_KEY` 未設定）|
| `RewardLedger` の行数 | 同上 | 🔴 **不可** |
| テスト会員の entitlement（買い目の開閉）| そのアカウントのセッション | 🔴 **不可**（ログインできない）|

実施した read-only:

| 検査 | 結果 |
|---|---|
| `netlify logs:function stripe-webhook`（45 秒）| **0 行**。ライブ配信のみで**過去ログの replay が無い**（2026-09-04 と同じ）|
| branch deploy の webhook | 署名なし POST → **400 `invalid_signature`**（＝ Stripe env は効いている）|
| guest の `/prediction/nankan` | **302 → `/free-prediction/nankan`**（guest の認可は正常）|
| `/free-prediction/nankan` `/pricing` | **200** |

#### 🔴 先に確かめるべき論点：Sandbox と Test Mode は別

Stripe の **Sandbox は Test Mode とは別の環境**で、**API キーも webhook エンドポイントも独立**している。
branch deploy の `STRIPE_WEBHOOK_SECRET`（Branch deploys スコープ）は
**Test Mode の送信先 `KI Test Webhook`** のものである。

したがって、Sandbox 側に

`https://test-stripe-testmode-e2e-2026-09-01--keiba-intelligence.netlify.app/.netlify/functions/stripe-webhook`

を指す送信先が**無い**か、**あっても署名シークレットが Branch deploys の値と異なる**場合、

- 配信そのものが起きていない、または
- 配信されても **400 `invalid_signature`** で弾かれ、**Airtable は一切変化していない**

のどちらかになる。この場合 `Status` は元のまま（`inactive`）で、**#17 は依然として未達**。
🔴 **「Sandbox で再現できた」ことと「webhook が届いて Airtable が変わった」ことは別**であり、
後者は確認できていない。

#### 次に必要な情報（read-only）

| 出どころ | 欲しいもの |
|---|---|
| Stripe（Sandbox）| 当該 endpoint の**有無**と URL / `invoice.payment_failed` の**配信結果（HTTP status）** / event id と時刻 |
| Airtable（テスト会員）| `Status` / `PlanType` / `AccessEnabled` / `RewardLedger` の行数 |
| 実機 | テスト会員でログインした状態の `/prediction/nankan`（買い目が開くか） |

上記のいずれかを共有いただくか、read-only トークンをいただければ、こちらで確認して本節を更新する。

🔴 追加 write・本番操作は一切行っていない。

### 2026-09-05 #17 — `invoice.payment_failed` の実イベントを受領して照合（read-only）

仕様所有者から実イベントの JSON を受領し、`stripe-webhook.js` の契約と突き合わせた。

| 項目 | 値 |
|---|---|
| event id | `evt_1UCCvpLbPC6OVRqMLSTIZm7Z` |
| type | **`invoice.payment_failed`** |
| created | 2026-09-05 06:18:28 UTC（15:18 JST）|
| invoice | `in_1UCCqtLbPC6OVRqMZ361cD2e` / `amount_due` **3980** `jpy` |
| subscription | `sub_1UCCk8LbPC6OVRqMDVO7qhOv` / customer `cus_VCar1zVD6J9chN` |
| test clock | `clock_1UCBARLbPC6OVRqME93sxVzj` |

#### ✅ payload から確定したこと

| 検査 | 結果 |
|---|---|
| **`invoice.payment_failed` が生成された** | ✅ **2026-09-03 の障害は解消**。「Stripe はこの経路で出さない」は**初回請求の話**で、更新請求なら出る |
| `billing_reason` | **`subscription_cycle`** ＝ **更新請求**。設計どおり（初回ではない）|
| `livemode` | **`false`** ＝ 本番ではない |
| email の解決（`emailFromInvoice`）| ✅ `parent.subscription_details.metadata.ki_email` = テスト会員 → **第 1 分岐で解決**。`customer_email` も同値でフォールバックも効く ＝ **handler は skip しない** |
| `metadata.ki_plan` | `premium`（`payment_failed` では未使用だが `subscription.updated` 用に正しい）|
| price | **`price_1UAsLMLbPC6OVRqMoZ3VSfRR`** — 2026-09-03 の記録と**完全一致** |

🔴 **前回提起した「Sandbox は Test Mode と別環境」の懸念は解消。**
price と account（`acct_1U9EyPLbPC6OVRqM`）が従来の Test Mode E2E と同一なので、
**送信先 `KI Test Webhook` が購読している環境と同じ**である。

#### 🔴 この JSON だけでは判定できないこと

| 項目 | 理由 |
|---|---|
| webhook が **200 で配信されたか** | `pending_webhooks: 0` は「配信完了」と「購読する送信先が無い」の**両方と整合**する。成否は示さない |
| `Customers` の `Status` / `PlanType` / `AccessEnabled` | Airtable を読めない |
| `RewardLedger` の行数 | 同上 |

#### 🟡 新たに判明した注意点（dunning）

`status: "open"` / `auto_advance: true` / `attempt_count: 1` /
`next_payment_attempt: 2026-09-08 00:47 UTC`（clock 時刻）。

**リトライが予約されている。** Test Clock をさらに進めると `unpaid` / `canceled` へ進み、
`customer.subscription.updated` の分岐で **free へ降格**する（`PlanType`/`AccessEnabled` が変わる）。
🔴 **これ以上 clock を進めないこと。** 進めなければ発火しない。

#### 残っている確認（read-only・これだけ）

| # | 出どころ | 欲しいもの |
|---|---|---|
| 1 | Stripe の Webhook 配信ログ | `evt_1UCCvpLbPC6OVRqMLSTIZm7Z` の**配信結果（HTTP status）**|
| 2 | Airtable `Customers`（テスト会員）| `Status` / `PlanType` / `AccessEnabled` |
| 3 | Airtable `RewardLedger` | 行数（**2 行のまま**が期待）|

1 が **200** なら、コード上 `applyPlan(email, { status: 'payment_failed' })` **だけ**が走るので、
2 は `Status=payment_failed` かつ `PlanType`/`AccessEnabled` 不変、3 は増加なしになるはず。
1 が 400 / 未配信なら 2・3 は**変化していない**はずで、原因は送信先側にある。

🔴 追加 write・本番操作は行っていない。

## Final Goal

`keiba-intelligence.jp` を、**人手の日次介入なしで**運用できる状態に保つこと。具体的には:

1. 共有データ（`keiba-data-shared`）から予想・結果・特徴量が自動取込され、検証を通過した分だけ main に入る。
2. 馬単 F3・投資5点固定の商品仕様（`BET_POINT_LOGIC.md`）に沿った買い目と的中実績が、南関・JRA で同一ロジックで公開される。
3. 予想画面の 6 経路（JRA/南関 × free/light/premium）が仕様通り表示され、片肺修正による退行が起きない。
4. 仕様・進捗・設計判断が文書化され、セッションをまたいで作業を再開できる。

## Current Phase

**Phase: KI Membership / Reward 制度（会員継続制度）— 2026-09-01 着手**

ブランチ `feat/ki-membership-rewards-2026-09` / 分岐元 `b5a88d27`（origin/main）
制度の正本: **[`docs/MEMBERSHIP_REWARDS.md`](./MEMBERSHIP_REWARDS.md)**
永続化の移行案: **[`docs/MEMBERSHIP_DATA_MIGRATION.md`](./MEMBERSHIP_DATA_MIGRATION.md)**
方針決定: `docs/decisions.md`「2026-09-01 — KI を『AI競馬予想 ＋ 長期会員クラブ』と定義し、会員継続制度を新設する」

仕様所有者の確定事項:

- KI は **AI競馬予想 ＋ 長期会員クラブ**。**馬育成アプリ・KAA 型の育成ポイントは作らない**。ネイティブアプリ化もスコープ外
- 料金は現行維持（¥3,980 / 表示 ¥5,000 / 銀行振込年払い ¥39,800）。**ライトは復活させない**。会場で権限を分けない
- 新設: 継続価格ロック / 継続プレゼント / 選べるプレゼント / 長期会員優遇 /
  会員ランク（Bronze / Silver / Gold / Platinum）/ KIリワード / 継続記念品
- **ランク差はリワード・プレゼント・長期待遇に限定**。予想の精度・買い目・有料情報の質に差を付けない
- KIリワードは **Premium の継続だけで積み上がる**。現金・預金と誤認させない。換金可能にしない

### 工程

| # | 工程 | 状態 |
|---|---|---|
| M0 | 正本固定（`MEMBERSHIP_REWARDS.md` / `MEMBERSHIP_DATA_MIGRATION.md` / spec / decisions / progress） | **完了** |
| M1 | ランク・リワード・カタログ・価格ロック・永続化抽象・表示ビューの実装 | **完了** |
| M2 | テスト **71 件**（不変条件 51 ＋ 静的ガード 20） | **完了** |
| M3 | `/pricing` の二本柱化 | **完了** |
| M4 | `/mypage` の会員クラブ枠（未確定は「準備中」） | **完了** |
| M5 | 永続化の移行案・rollback 作成 | **完了**（**実行はしていない**） |
| M5.5 | PR #83 merge ＋ 本番反映 | **完了**（2026-09-01・`6aa5a7c1`）|
| M6 | **TBD-1〜TBD-8 の確定と実装** | **完了**（2026-09-01・`MEMBERSHIP_REWARDS.md` §7.1）|
| M7 | 法務（景表法）への対応 | **完了**（保守ライン内に収め、確認待ちを解消。§8）|
| M8 | **Airtable アダプタ・移行ツール・E2E** | **完了**（2026-09-01 第3弾）|
| M9 | 景品の品目の選定（TBD-3b / TBD-4b） | **未着手**（仕様所有者） |
| M10 | **TBD-9 / TBD-10 の確定と実装** | **完了**（2026-09-01・`MEMBERSHIP_REWARDS.md` §7.6 / §7.7）|
| M11 | TBD-12（発送先住所）の確定 | **未着手**（交換の実運用を始める前） |
| M12 | Airtable スキーマ移行・read/write 有効化 | **未実施**（高リスク境界・承認必要）|

### 実装した内容（2026-09-01）

| 層 | 追加・変更 |
|---|---|
| 制度 | `src/lib/membership/ranks.js`（4 ランク・閾値未設定なら判定しない） |
| 制度 | `src/lib/membership/rewards.js`（台帳集計・冪等キー・残高不足の交換を作らない） |
| 制度 | `src/lib/membership/catalog.js` ＋ `src/data/membership/rewardCatalog.json`（データ駆動・既定は draft/空） |
| 制度 | `src/lib/membership/priceLock.js`（契約時価格の保持。再加入時は「未確定」を返す） |
| 制度 | `src/lib/membership/store.js`（既定 disabled の fail-closed。Airtable アダプタは未実装） |
| 表示 | `src/lib/membership/membershipView.js`（未確定は `pending`。認可フラグを作らない） |
| UI | `src/pages/pricing.astro` に柱2「続けるほど、会員価値が積み上がる」＋ FAQ 2 件 |
| UI | `src/pages/mypage.astro` に「KI 会員クラブ」ブロック（10 項目・未確定は「準備中」） |
| テスト | `membership.test.mjs`（51）/ `membershipCopy.guard.test.mjs`（20）。`npm run test:membership` を build に組込み |
| 文書 | `MEMBERSHIP_REWARDS.md` / `MEMBERSHIP_DATA_MIGRATION.md` 新規、`spec.md` / `README.md` / `RENEWAL_2026_08.md` の矛盾解消 |

### レビュー指摘の反映（2026-09-01・PR #83 merge 前）

仕様所有者の指摘により、**正本との明確な不一致 3 点**を修正した。仕様・TBD・auth/entitlement・
Stripe webhook・upstream 契約には触れていない。

| # | 指摘 | 対応 |
|---|---|---|
| 1 | `/mypage` に廃止済みの「穴馬レポート・優先メルマガ」が残る（`RENEWAL_2026_08.md` §6.1） | 該当行と `isPremium` を削除。静的ガード（G-10 / G-11）で再混入を禁止 |
| 2 | 特典履歴が pending でも「まだ受け取られた特典はありません」と言い切る | **pending → 「準備中」／ ready かつ 0 件 → 「まだありません」**に分離。ビュー側と描画順の両方をテストで固定 |
| 3 | `docs/spec.md` §3 の「決済ゲートウェイの実装／現行は銀行振込自動化」が Stripe 正本と矛盾 | 「**決済処理そのもの**（カード情報の保持・与信・請求実行・請求額の決定）は Stripe が行う」へ改稿。請求額の正本が Stripe の Price であること、銀行振込年払いが別経路として併存することを明記 |

**指摘 2 の理由**: 台帳が読めていない状態（付与設定未確定 / store 無効）で「まだありません」と
言い切ると、**受け取り済みの特典を「無い」と伝える**おそれがある。未取得と 0 件は別物として扱う。

テストは 67 件 → **71 件**（不変条件 51 ＋ 静的ガード 20）。

### 本番反映（完了・2026-09-01）

PR #83 を `main` へ squash merge し、本番へ反映した。

| 項目 | 値 |
|---|---|
| PR | [#83](https://github.com/apol0510/keiba-intelligence/pull/83) |
| merge commit | `6aa5a7c1`（2026-09-01 04:20 UTC・squash）|
| 規模 | 2 コミット / 20 ファイル / +2,975 −27 |
| Netlify | production ready（反映を実測で確認）|

🟢 **環境変数の追加は不要だった。** 会員クラブは既定 fail-closed で動くため、
`MEMBERSHIP_WRITE_ENABLED` / `KI_RANK_THRESHOLDS` / `KI_REWARD_ACCRUAL` は
**未設定のままでよい**（未設定＝「準備中」表示）。
2026-08-31 の `SESSION_SIGNING_SECRET` のような反映前ブロッカーは無い。

#### 反映後の実測（本番・未認証）

| 検査項目 | 結果 |
|---|---|
| `/pricing` 柱2「続けるほど、会員価値が積み上がる」 | 表示（1件）|
| ランク梯子 Bronze / Silver / Gold / Platinum | 各2件（梯子＋説明）|
| 継続価格ロック / 選べるプレゼント / 準備中 | 2 / 1 / 2 件 |
| 「現金・預金ではなく」の注記 | 2 件（`/pricing` 本文 ＋ FAQ）|
| 価格表示 ¥5,000 / ¥3,980 / ¥39,800 | 各1件 |
| 廃止済み（穴馬レポート・優先メルマガ・¥88,000・¥66,000・¥12,000・¥6,600）| **すべて 0 件** |
| `/mypage`（未認証）| ログイン案内のみ。会員クラブは描画されない |
| `/prediction/nankan`（未認証）| **買い目 0 件**・`pro-user-only` 0 件・印の列 0 件・馬柱 1,064 行（正常）|

`/prediction/nankan` の `◎` 16 件はすべて **meta description と
「無料会員で見られます」の案内文**であり、印の露出ではない（本文中の実際の印は 0）。
2026-08-28 の認可是正（監査 A-1）に回帰は無い。

### 制度の数値を確定（2026-09-01・第2弾）

仕様所有者が TBD-1〜TBD-8 を確定した。**正本は `docs/MEMBERSHIP_REWARDS.md` §7.1**（重複させない）。
要点のみ:

| 項目 | 確定値 |
|---|---|
| 付与 | **100 pt / 月**（ランク倍率は当面なし）|
| 昇格 | **0 / 3 / 12 / 24 か月** |
| 交換 | **600 pt / 1,200 pt** の 2 段階 |
| 景品の上限 | **1 点 ¥796 以内** |
| 記念品 | **12 / 24 か月**。通常交換と同月に重ねない |
| 失効 | 契約中は失効なし／**解約後 90 日** |
| 再加入 | **90 日以内**ならポイントと旧価格ロックを復活 |
| 年払い ¥39,800 | 対象。**12 か月相当**（1,200 pt 一括）|
| 上位ランク優遇 | ポイント倍率ではなく**選べる景品・記念品等の待遇** |

#### 🟢 法務確認の待ちを解消した

¥796 は **月額 ¥3,980 の 10 分の 2**、すなわち総付景品の限度額を
**「取引価額＝月額」という最も厳しい読み方**で計算した値である。
ここに収めておけば年額で読んでも当然に収まるため、
**取引価額の解釈を確定させる作業そのものが不要**になった。

- 旧 §8 の L-1〜L-9（確認待ち 9 件）は、**保守ライン S-1〜S-4 の維持**に置き換わった。
- 確認が必要になるのは「¥796 を超える景品を出す」「抽選・先着を入れる」等、
  **保守ラインを外れる判断をしたとき**だけ（§8.2）。
- 残る継続的な確認は **決算期のポイントの会計処理（税理士）**のみ。

#### 🟢 環境変数の追加も不要

確定値は **コードの定数**として実装した（env 設定を要求しない）。
`KI_RANK_THRESHOLDS` / `KI_REWARD_ACCRUAL` は上書き用に残してあるが、**未設定で正しく動く**。
🔴 上書きが壊れているときは**確定値へ黙って戻さず**ランク・残高を出さない（fail-closed）。

#### 実装

| ファイル | 追加した定数・挙動 |
|---|---|
| `ranks.js` | `RANK_THRESHOLDS`（0/3/12/24）。壊れた上書きは `RANK_THRESHOLDS_UNSET` へ倒す |
| `rewards.js` | `MONTHLY_POINTS=100` / `ACCRUAL`（倍率 null）/ `ANNUAL_TERM_MONTHS=12` / `GRACE_DAYS=90` / `resolvePointsStatus` / `buildAnnualAccrualEntry` |
| `catalog.js` | `REDEMPTION_TIERS`(600/1200) / `MILESTONE_MONTHS`(12/24) / `MAX_ITEM_VALUE_YEN=796` / `isMilestoneMonth` / `blockedByMilestone` |
| `priceLock.js` | `REENTRY_GRACE_DAYS=90` / `resolveReentryPrice` が実際に判定するようになった（旧: 常に「未確定」）|
| `membershipView.js` | `RANK_LADDER` に昇格月数、`CONFIRMED`、猶予・失効の状態を追加 |
| `/pricing` | ランク梯子に月数、訴求とFAQに確定値、有効期限のFAQを追加 |
| `/mypage` | 猶予中の案内、記念品の月の案内、確定値の注記 |

テストは 71 件 → **100 件**（不変条件 76 ＋ 静的ガード 24）。

### Airtable アダプタ・移行ツール・E2E（2026-09-01・第3弾）

#### 本番の read-only 監査（書き込みなし）

`npm run membership:check` を本番 Airtable に対して実行した。**実データの詳細は
`docs/MEMBERSHIP_DATA_MIGRATION.md` §0 が正本**（重複させない）。要点:

- `Customers` **63 件** / 有料 **11 件**（pro 7・light 4）、**全件が銀行振込**
- **Stripe 由来の会員は 0 件**（本番 env に `STRIPE_*` が未設定のため）
- 追加が必要な **6 列すべて未作成**、`RewardLedger` も未作成
- backfill 可能 **8/11**、🔴 **起点不明 3/11**（手動確認が必要）

#### 実装

| ファイル | 役割 |
|---|---|
| `src/lib/membership/airtableStore.js` | Airtable アダプタ。**未知フィールド(422)/テーブル無し(404,403)を検出したら以後書きに行かない**。読み取りは `null` を返し「0 件」と誤認させない |
| `src/lib/membership/store.js` | 段階的有効化。フラグ無し=disabled → `MEMBERSHIP_READ_ENABLED`=読むだけ → `MEMBERSHIP_WRITE_ENABLED`=読み書き |
| `scripts/membershipMigration.mjs` | `--check`（read-only 監査）/ `--dry-run`（既定）/ `--apply`（🔴 3 条件が揃わなければ実行しない）|
| `netlify/functions/stripe-webhook.js` | 契約価格・解約日の記録。**フラグ付き・別リクエスト・失敗は握りつぶす** |

🔴 **webhook のプラン付与には一切混ぜていない。**
列が無い環境で混ぜると Airtable が **リクエストごと 422** を返し、
**有料会員のプラン付与まで巻き添えで落ちる**。別リクエストにして失敗を握りつぶす設計にした。

#### E2E（外部 I/O なし・本物の関数）

`membershipE2E.test.mjs`（17 件）で会員の一生を通した。

| 経路 | 結果 |
|---|---|
| Stripe 月額 開始 → 権限が開く → 契約価格を保存 | ✅ `showBetting=true` / ロック ¥3,980（正規 ¥5,000 より安い）|
| 毎月付与 → 3 か月 Silver → 6 か月 600pt で小の品 | ✅ 次は大の品まであと 600pt |
| 交換 → 残高が減り履歴に残る / 同じ交換 ID の再送 | ✅ 二重に引かれない |
| 残高超過の交換 | ✅ 作らない（マイナス残高にならない）|
| 12 か月 → Gold / 記念品の月は通常交換を止める | ✅ `blockedByMilestone`。翌月は Gold 限定品も選べる |
| 解約直後 → 買い目は閉じ、印は残る。ポイントは 90 日保持 | ✅ `grace` |
| 90 日以内の再加入 | ✅ ポイント復活・**旧 Price ID** を Checkout に使う |
| 90 日超過 | ✅ ポイント失効・新価格 |
| 境界（ちょうど 90 日）| ✅ ポイントと価格ロックが**同時に**切れる |
| 銀行振込 年払い ¥39,800 | ✅ 1,200pt 一括・同じ期の再処理で二重付与なし・Gold 到達 |

| 安全性 | 結果 |
|---|---|
| 台帳が読めない | ✅ 残高を 0 と言わない（`pending`）|
| 継続月数が不明 | ✅ ランクを出さない（Bronze へ倒さない）|
| 他会員混入 | ✅ 冪等キーに email を含むので別会員として扱う |
| 一方の解約の波及 | ✅ 他方は `ready` のまま |
| 認可の回帰（guest / free / premium）| ✅ 変化なし |
| 署名鍵なし | ✅ guest（会員クラブも出ない）|
| ランクを認可に使っていない | ✅ ビューに `showBetting` を作らない |

アダプタ側（`airtableStore.test.mjs` 13 件）: 422/404/403 で書かない・冪等・
**既存列（PlanType/Status/AccessEnabled）へ書かない**・email で必ず絞る・
Airtable のエラー本文を返さない・例外を投げ返さない。

Stripe 側（`stripeWebhook.test.mjs` に 2 件追加）: フラグ無しでは membership の列を書かない /
**フラグを立てても列が無ければプラン付与は成功する**。

テストは membership 100 → **131 件**、stripe 41 → **43 件**。

#### 最新 main の取り込み（2026-09-01）

PR #85 が `a8298dd2` として main へ squash merge されたあと、
**`origin/main` を本ブランチへ通常 merge した**（🔴 rebase はしていない）。

| 項目 | 値 |
|---|---|
| merge commit | `5b77b119`（親 2 つ: `6e31f494` ＋ `a8298dd2`）|
| 競合 | `docs/MEMBERSHIP_DATA_MIGRATION.md` / `docs/progress.md` の 4 か所 |
| 解決方針 | いずれも本ブランチ側（新しい記述）を採用。併せて main 側に残っていた古い記述を整理 |

古い記述の整理:

- 「Airtable アダプタは実装していない」→ **実装済み**へ
- 「本番 env に必要なのは `MEMBERSHIP_WRITE_ENABLED` だけ」→ **段階的有効化の 2 フラグ**へ
- rollback 表の手順番号を、読み取り有効化の追加に合わせて振り直し

merge 後に `main` との差分が **本 PR 固有の 12 ファイル（+1,391 / −35）** だけであることを確認し、
`npm run build` を再実行して全通過した。

#### TBD-9 / TBD-10 の確定と実装（2026-09-01）

| # | 確定内容 |
|---|---|
| TBD-9 | 継続月数の起点は **支払い成功日**（Stripe＝初回支払い成功／銀行＝入金確認日）。既存は根拠のある分だけ backfill、**起点不明 3 件は推測も 0 か月補完もしない** |
| TBD-10 | 支払い失敗時も **認可の猶予挙動は変更しない**。**継続月数と付与だけ**を支払い成功まで保留し、再決済成功で **1 回だけ**反映。未払いのまま終了した期間には付与しない |

🔴 **実装の要点は「付与をカレンダーではなく支払い成功イベントで駆動する」こと。**
`invoice.payment_succeeded` で台帳へ 1 期ぶん積み（冪等キー＝invoice id）、
`invoice.payment_failed` では **何も積まない**。これにより
「失敗期間には付かない」「再試行成功で 1 回だけ付く」「未払い終了なら付かない」が構造的に成立する。
継続月数も同じ台帳から数える（月額 1 期＝1 か月 / 年払い 1 期＝12 か月）。

追加した関数: `buildPaidPeriodEntry` / `tenureMonthsFromLedger` / `resolveTenureMonths` /
`elapsedMonthsSince`（台帳が始まる前の既存会員のための後方互換）。

**認可とリワードの分離をテストで固定した**:

| 検査 | 内容 |
|---|---|
| 静的ガード | `rewards.js` が認可の概念（`entitlement` / `canSeeBetting` / `AccessEnabled` / `PlanType`）を参照しない |
| 静的ガード | `auth/*` がリワードの概念（`ledger` / `accrual` / `Reward` / `tenure`）を参照しない |
| 静的ガード | `payment_failed` の分岐が `Status` だけを触り、**付与を呼ばない** |
| 静的ガード | `payment_succeeded` の分岐が **`applyPlan` を呼ばない**（付与だけ） |
| webhook テスト | payment_failed: 認可は変わらず（買い目は開いたまま）付与の書き込みも起きない |
| webhook テスト | payment_succeeded: 認可を一切変えない |
| webhook テスト | 同じ invoice の再送で二重処理しない |
| E2E | 失敗期間は月数もポイントも増えない → 再決済成功で 1 回だけ反映 → 再送で増えない |
| E2E | 未払いのまま解約 → その期間は付与されず、既存分は 90 日保持 |
| E2E | 起点も台帳も無ければ `pending`（**Bronze へ倒さない**）|

#### 付与の fail-closed 強化と入金日の復元（2026-09-01・レビュー指摘）

| # | 指摘 | 対応 |
|---|---|---|
| 1 | 請求間隔が判定不能なとき月額へ fallback していた | 🔴 **付与しない**（`day`/`week`/未知/`interval_count` 不正はすべて保留）。`interval_count` を掛けるので四半期払いは 3 か月ぶんとして数える |
| 2 | 付与日時に `Date.now()` を使っていた | 🔴 Stripe の **`status_transitions.paid_at`** を正本にし、無ければ **保留**。契約価格は `session.created`、解約日は `event.created` を使う |
| 3 | 遅延再送の検証が無かった | E2E に「遅延して届いても付与日時は実際の支払い時刻」「順序入替＋再送でも二重付与なし」「間隔・時刻が無ければ付与エントリを作らない」を追加 |
| 5 | 既存 8 件の入金日を手作業へ回していた | 🔴 **KI 内のコードから復元**（下記） |
| 追加 | `interval_count` 欠落を 1 で補完していた | 🔴 **補完しない**（欠落・非整数・0 以下はすべて付与保留）。実際が四半期・半年払いだった場合に**過少なまま確定**するため。静的ガードで補完の再混入を禁止 |

🟢 **入金確認日は推測ではなく復元できた。**
`send-payment-confirmation-auto.js` が **入金確認時に** `ExpirationDate = その日 + 期間` を
書いているため、`ExpirationDate − 期間` で入金確認日が戻る。
採用条件は「期間が確定できる」「逆算値が未来でない」「申込日の 0〜60 日後に収まる」の 3 つすべて。

本番 dry-run（read-only）の実測: **逆算で根拠が取れた 7 件 / 手動確認 1 件 / 起点不明 3 件**。
→ **手作業は 8 件 → 4 件**。残り 4 件は空のまま（画面は「準備中」）。

`buildPaidPeriodEntry` は `periodMonths` の **既定値を廃止**した
（省略・不正なら付与しない＝月額へ丸めない）。

### スキーマ移行と READ 有効化（2026-09-01・**本番実施済み**）

仕様所有者の承認を得て、`docs/MEMBERSHIP_DATA_MIGRATION.md` §4 の手順 1〜5 を本番で実施した。
🔴 **`MEMBERSHIP_WRITE_ENABLED` は設定していない**（手順 6 の直前で停止）。

#### 前提: PAT の scope 追加

当初の PAT は **データ read/write のみ**で `schema.bases:*` を持たず、
列・テーブルの作成が **403** で実行できなかった。
仕様所有者が既存 PAT へ `schema.bases:read` / `schema.bases:write` を追加して解決した
（**トークンの値は変わっていない**ので、本番の他機能への影響はない）。

#### 実施結果

| # | 操作 | 結果 |
|---|---|---|
| 1 | `Customers` へ 6 列追加 | ✅ `MembershipStartedAt` / `CancelledAt` / `ContractPriceYen` / `ContractPriceId` / `ContractCurrency` / `ContractStartedAt` |
| 2 | `RewardLedger` 作成 | ✅ `tblsCzWPnKzhwWqEY`。列: EntryId / Email / Type / Points / OccurredAt / **PeriodMonths** / SourceRef / Note |
| 3 | PAT 権限確認 | ✅ 新テーブルのデータ read も 200（403 は解消）|
| 3' | `npm run membership:check` | ✅ 6 列すべて「済」・台帳「存在（0 行）」・必要な列がそろっている |
| 4 | backfill | ✅ **7 件**（逆算で根拠が取れた分のみ）|
| 5 | 残り 4 件 | ✅ **空欄のまま**（1 件は `ExpirationDate` なし／3 件は逆算不可）|

🔴 **`--check` が列を実データから推定していたため、列作成直後に「未」と誤判定した。**
schema が読めるようになったので **Metadata API を優先**するよう修正した
（列を作った直後は全レコードが空で、実データからは見えないため）。

`RewardLedger` に `PeriodMonths` を追加した（月額=1 / 年払い=12 を台帳に保持し、
継続月数を支払い済み期間から数えるため）。

#### 手順 6: 意図しない変更が無いことの検証（backfill 前後の全件差分）

| 検査 | 結果 |
|---|---|
| レコード数 | 63 → 63（増減なし・追加/削除ゼロ）|
| 変更された列 | **`MembershipStartedAt` の 7 件のみ** |
| `PlanType` / `Status` / `AccessEnabled` | ✅ **不変** |
| `Email` / `VenueAccess` / `ExpirationDate` / `有効期限` / `CreatedAt` / `Plan` / `plan_type` / `PaymentMethod` / `Source` | ✅ **不変** |
| 分布 | `PlanType` free-registered 52 / pro 7 / light 4、`Status` active 57 / pending 6、`AccessEnabled` true 57 / 空 6（いずれも監査時と同一）|

#### 手順 7: `MEMBERSHIP_READ_ENABLED=true`

production context へ設定し、**再デプロイして反映**した（Netlify の env はデプロイ時に注入される）。
`MEMBERSHIP_WRITE_ENABLED` は **未設定のまま**。

#### 手順 8: 本番 read-only E2E（実会員の署名 Cookie を使用）

| 対象 | 会員クラブ | 継続月数 | ランク | 残高 / 今月 | 契約価格・ロック |
|---|---|---|---|---|---|
| 起点あり（light・起点 2026-05-08）| ✅ 表示 | **3 か月** | **Silver** | 0 pt / 0 pt | 準備中 |
| 起点なし（pro）| ✅ 表示 | **準備中** | **準備中** | 0 pt / 0 pt | 準備中 |
| Airtable に無い free 会員 | ✅ 表示 | 準備中 | 準備中 | 0 pt / 0 pt | —（無料は対象外）|
| 未認証（guest）| **描画されない** | — | — | — | — |

- 🔴 **起点が無い会員が Bronze へ倒れていない**（「準備中」のまま）＝ 意図どおり。
- 残高が「0 pt」なのは **台帳が読めていて実際に 0 行**だから（`pending` ではない）。
- 契約価格が「準備中」なのは Stripe 会員がまだ 0 人で `ContractPrice*` が空のため。
- **他会員混入なし**: 会員ごとに別の値（3 か月/Silver と 準備中）が出ている。

#### 認可の回帰（`/prediction/nankan`・本番実測）

| tier | 印 | AI結論 | 馬柱行 |
|---|---|---|---|
| guest | **0** | **0** | 1,064 |
| free | 251 | **0** | 1,064 |
| 有料（light / premium）| **0** | **1** | 1,064 |

仕様どおり（R-8: 有料は印を出さず、AI 結論と買い目で結論を示す）。**回帰なし**。
買い目は有料の抽出パネル側で描画されるため、サーバー HTML 上の
`\d+-\d+(\.\d+)+` パターンは有料でも 0 件になる（guest の露出検査はこの点で有効）。

#### 手順 8': Airtable への書き込みが増えていないこと

READ 有効化＋本番アクセス後に再検査:

- レコード数 63（不変）／backfill 以降に変わった列は **`MembershipStartedAt` 7 件のみ**
- **`RewardLedger` 0 行**（付与はまだ動いていない）
- `PlanType` / `Status` / `AccessEnabled` の分布は監査時と同一

#### rollback の現在地

| 段階 | 現状 | 戻し方 |
|---|---|---|
| 列・テーブル追加 | 実施済み | **何もしなくてよい**（フラグを外せば読まれない）|
| backfill 7 件 | 実施済み | `MembershipStartedAt` を空に戻す（既存列は触っていない）|
| `MEMBERSHIP_READ_ENABLED` | **設定済み** | env を削除して再デプロイ → 表示が `pending` に戻るだけ |
| `MEMBERSHIP_WRITE_ENABLED` | 🔴 **未設定（停止中）** | — |

🔴 **どの段階でも `PlanType` / `Status` / `AccessEnabled` を書き換えない。**

### 銀行振込の入金確認を会員継続制度へ接続（2026-09-01）

既存経路の調査結果（正本）:

```
/apply（yearly ¥39,800 のみ）
  → bank-transfer-application.js が Status='pending' / AccessEnabled=false で作成
  → 入金を確認して Airtable の Status を active にする
  → Automation が send-payment-confirmation-auto.js を叩く
     1. レコード取得 → 2. 二重送信チェック（PaymentEmailSent）
     → 3. メール送信 → 4. PaymentEmailSent / AccessEnabled / ExpirationDate を更新
```

**手順 4 のあとに手順 5（会員継続制度への反映）を追加**した。

| 要件 | 実装 |
|---|---|
| 入金確認日を起点にする | 手順 5 の実行時刻を `MembershipStartedAt` に書く。🔴 **初回だけ**（更新で動かさない）|
| 支払い済み期間だけ反映 | `plan_type` から期間を決めて 1 期ぶん積む。入金確認が起きた期だけ |
| 年払いは 12 か月・1,200pt | `BANK_PLAN_TERM_MONTHS.yearly = 12` |
| 判定不能なら付与しない | `lifetime` / 未知 / 未設定 / 有効期限なし → **付与しない**（月額へ丸めない）|
| 二重付与しない | 冪等キー `bank:<recordId>:<その期の有効期限>`。やり直しても同じ期限＝同じキー |
| 既存経路へ波及させない | **別リクエスト**・フラグ付き・**例外を握りつぶす**。応答は 200 のまま |
| 認可を変更しない | `AccessEnabled` / `Status` / `PlanType` を読み書きしない |

🔴 **`BANK_PLAN_TERM_MONTHS` は `calculateExpirationDate` と同じ規則**にしてある。
片方だけ変えると **有効期限と継続月数が食い違う**ため、テストで一致を固定した。

#### 🔴 レビューで見つけた欠落バグと修正

**旧構造では、Step 1〜4 が成功したあと Step 5（membership）だけが一時的に失敗すると、
再実行しても Step 2 の早期 return で Step 5 へ到達できず、リワードが永久に欠落した。**

修正:

- Step 2 の **早期 return を撤去**し、`alreadyConfirmed` フラグで分岐する。
  - 🔴 メールの再送は**引き続き禁止**（Step 3 をスキップ）
  - 既存列の更新（Step 4）も**やり直さない**
  - **Step 5 だけ**を再試行する
- 再実行時の入金確認日は **`ExpirationDate − 期間` から復元**する
  （`deriveConfirmedAtFromExpiration`）。
  🔴 **現在時刻で代用しない**。数日後の再実行で起点と付与日時が実際の入金日とずれるため。
- 冪等キーは有効期限由来なので、初回と再実行で**同じキー**になる＝二重付与しない。
- 期間が判定できない場合は **回復もしない**（起点も書かない）。現在時刻へ倒さない。

新規テスト `bankTransfer.test.mjs`（24 件）:
期間判定の fail-closed / 起点は入金確認日（申込日ではない）/ 更新で起点を動かさない /
年払い 12 か月・1,200pt / **再実行・メール再送で台帳が増えない** /
翌期の更新は別の期として 1 回だけ / 他会員混入なし /
既存の Step 4 に membership の列を混ぜない / membership は Step 4 のあとに呼ぶ /
`bankTransfer.js` が認可の概念を持たない。

membership 153 → **177 件**。

### 🔴 WRITE 有効化の失敗と原因（2026-09-01・**未遂**）

`MEMBERSHIP_WRITE_ENABLED=true` を production に設定して再デプロイしたところ、
**Netlify のビルドが 2 回連続で失敗**した（exit 2）。指示に従いフラグを削除して
再デプロイし、green に復帰させた。**本番の会員データは一切変わっていない。**

#### 原因（自分で書いたテストの設計ミス）

`stripeWebhook.test.mjs` に

```js
assert.equal(process.env.MEMBERSHIP_WRITE_ENABLED, undefined, '前提: フラグは未設定');
```

と書いていた。**`npm run build` は本番 env を注入した状態で走る**（Netlify）ため、
フラグを立てた瞬間にこのテストが落ち、**ビルドごと失敗**した。
加えて、既定の挙動（membership を書かない）を検証する他のテストも
ambient のフラグに引きずられて 9 件失敗する状態だった。

🔴 **教訓: ビルド時に走るテストは、本番 env のフラグに依存してはいけない。**

#### 修正

| 対象 | 修正 |
|---|---|
| `withWriteFlag(value, fn)` を新設 | 保存 → 設定/削除 → `try/finally` → **元の値を復元** |
| `beforeEach` | 各テスト開始時に**明示的に未設定へ揃える**（ambient に引きずられない） |
| `after` | ファイル終了時に **ambient の値を復元**（単純 delete で終わらせない） |
| 「未設定」を見るテスト | ambient の前提をやめ、テスト内で未設定を作ってから検証 |
| 「true」を見るテスト | `withWriteFlag('true', ...)` を使い、必ず復元 |

追加テスト: 「ambient が true / undefined のどちらでも結果が変わらない」
「例外が出ても ambient を復元する」。

静的ガード（`membershipCopy.guard.test.mjs`）:

| # | 内容 |
|---|---|
| G-20 | テストが「フラグが未設定であること」を **ambient の前提にしない** |
| G-21 | env を書き換えるテストは **保存 → 復元**する（単純 delete で終わらない） |
| G-22 | `stripeWebhook.test.mjs` が `beforeEach` で既定へ揃え、`after` で ambient を戻す |

G-22 は、`beforeEach` のリセットを外すと落ちることを実測で確認した。

#### 検証マトリクス（ローカル実測）

| | `test:stripe` | `test:membership` | `test:auth` | `npm run build` |
|---|---|---|---|---|
| フラグ未設定 | ✅ 53 | ✅ 180 | ✅ 96 | ✅ exit 0 |
| `MEMBERSHIP_WRITE_ENABLED=true` | ✅ 53 | ✅ 180 | ✅ 96 | ✅ exit 0（2 回連続）|

🟡 なお、`npm run build` で 1 度だけ Node の test runner が
`Unable to deserialize cloned data` で落ちた（アサーション失敗ではない一過性の IPC エラー）。
再実行 2 回とも exit 0 のため、修正内容とは無関係と判断した。

#### この間の本番状態

- `MEMBERSHIP_WRITE_ENABLED`: 設定 → **削除済み**（現在は未設定）
- `MEMBERSHIP_READ_ENABLED`: 設定のまま（変更なし）
- Customers **63 件・変化した列なし** / `MembershipStartedAt` **7 件** / `RewardLedger` **0 行**
- 🔴 **テスト会員・実会員への人工的な write は行っていない**

### ✅ WRITE 有効化（2026-09-01 13:28 UTC・**完了**）

テストの env 依存を修正（PR #89・`4cbd03f3`）したうえで再実行し、**ビルド green で有効化できた**。

| 項目 | 値 |
|---|---|
| 有効化時刻 | **2026-09-01 13:27:34 UTC**（env 設定）／ **13:28:48 UTC**（デプロイ published）|
| デプロイ | `4cbd03f3` production **ready** |
| `MEMBERSHIP_READ_ENABLED` | 設定あり |
| `MEMBERSHIP_WRITE_ENABLED` | **設定あり（有効）** |

#### `membership:check`（有効化後）

- Customers の 6 列すべて **✅ 済**（判定元: Metadata API）
- `RewardLedger` **✅ 存在（0 行）**・必要な列がそろっている

#### 有効化だけで会員データが変化していないこと

| 検査 | 結果 |
|---|---|
| Customers | **63 件**（追加・削除なし）|
| 変化した列 | **なし** |
| `MembershipStartedAt` | **7 件のまま** |
| `RewardLedger` | **0 行のまま** |
| `PlanType` / `Status` / `AccessEnabled` | free-registered 52・pro 7・light 4 ／ active 57・pending 6 ／ true 57・空 6（すべて不変）|

🔴 **人工的な write（テスト会員・実会員）は一切行っていない。**
台帳が 0 行なのは正しい状態で、**次の実際の銀行振込入金確認から自動記録される**。

#### 認可の回帰（本番実測・実会員の署名 Cookie）

| tier | 印 | AI結論 | 買い目パネル |
|---|---|---|---|
| guest | **0** | **0** | 12 |
| free | **271** | **0** | 12 |
| 有料（light / premium）| **0** | **1** | 37 |

仕様どおり（R-8: 有料は印を出さず AI 結論で示す）。**回帰なし**。

🟡 検査中に `mark-cell` というクラス名で数えて free の印が 0 に見えたが、
実際のクラス名が異なるだけだった（`mark` を含むクラスは free で 271・guest/有料で 0）。
◎○▲△ の実体数でも裏を取り、**回帰ではない**ことを確認した。

#### 会員クラブの表示（他会員混入なし）

| 対象 | ランク | 継続月数 | 残高 | 契約価格 |
|---|---|---|---|---|
| 有料・起点あり（2026-05-08）| **Silver** | **3 か月** | 0 pt | 準備中 |
| 有料・起点なし | 準備中 | 準備中 | 0 pt | 準備中 |
| free（Airtable に無い）| 準備中 | 準備中 | 0 pt | — |
| guest | 会員クラブ**非描画** | — | — | — |

会員ごとに異なる値が出ており、**混入なし**。起点不明の会員が **Bronze へ倒れていない**。

#### rollback

| 段階 | 現状 | 戻し方 |
|---|---|---|
| 列・テーブル追加 | 実施済み | 戻し不要（フラグを外せば読まれない）|
| backfill 7 件 | 実施済み | `MembershipStartedAt` を空に戻す |
| `MEMBERSHIP_READ_ENABLED` | 設定済み | env 削除＋再デプロイ |
| `MEMBERSHIP_WRITE_ENABLED` | **設定済み** | **env 削除＋再デプロイ**（台帳の行は監査のため残す）|

🔴 どの段階でも `PlanType` / `Status` / `AccessEnabled` を書き換えない。

#### この基盤タスクの到達点

**次の実際の銀行振込入金確認から、`MembershipStartedAt` と 1,200pt（年払い）が
自動記録される状態**になった。Stripe 側は本番 env に `STRIPE_*` が未設定のため、
Stripe 経由の付与は Stripe 設定後に動き出す。

残るのは **景品の品目の決定（TBD-3b / TBD-4b）** と、
起点不明 4 件の扱い（空欄のままで可）。

### 静的ガードで固定したこと（`membershipCopy.guard.test.mjs`）

| # | 固定した不変条件 |
|---|---|
| G-1 | UI に「貯金 / 積立金 / 出金 / 送金 / 円分 / 円相当 / 円換算 / キャッシュバック」を書かない |
| G-2 | 「換金」「預金」は打ち消し文（〜できません / 〜ではなく）でのみ使う |
| G-3 | UI に固定のポイント数・必要月数・景品名を書かない（TBD-1〜TBD-5） |
| G-4 | `ranks.js` / `rewards.js` に昇格月数・付与ポイントの既定値を書かない |
| G-5 | 同梱カタログは `draft` / `items: []` のまま |
| G-6 | auth 層が membership を参照しない／membership 層が認可関数を呼ばない |
| G-7 | セッション Cookie の**署名材料を変更していない**（変えると全員ログアウト） |
| G-8 | `stripe-webhook.js` が書く Airtable 列は `PlanType` / `Status` / `AccessEnabled` の 3 つのまま |
| G-9 | 育成・ガチャ・ログインボーナス等の語彙が実装・UI に無い |
| G-10 | 廃止済みの訴求（穴馬レポート / 優先メルマガ / 詳細レポート / `canSeePremiumExtras`）を UI に書かない |
| G-11 | 廃止済みの価格（¥88,000 / ¥66,000 / ¥12,000 / ¥6,600）・`venueAccess` を UI に書かない |
| G-12 | 特典履歴で pending を先に判定する（未取得を「0 件」と言い切らない） |
| G-13 | 🔴 **正本 §7.1 とコードの定数が一致している**（片方だけ変えたら落ちる） |
| G-14 | UI に出るポイント数は確定値（100 / 600 / 1,200）だけ |
| G-15 | UI に出る月数・日数は確定値（3 / 12 / 24 か月・90 日）だけ |
| G-16 | ランク倍率を復活させていない（`rankBonusPoints: null`） |
| G-17 | 🔴 **S-1**: 景品の上限 ¥796 が `plans.js` の月額 ¥3,980 と結び付けて固定されている |
| G-18 | 🔴 **S-2**: 記念品の月は通常交換を止める分岐がある |
| G-19 | 🔴 **S-3**: 抽選・くじ・先着・`Math.random` を入れていない（総付を維持） |

### 既存仕様との矛盾を解消したもの

| 箇所 | 変更前 | 変更後 |
|---|---|---|
| `docs/spec.md` §1 | 収益モデルに「買い切り」 | 月額プレミアム ＋ 銀行振込年払い（買い切りは 2026-08-30 廃止と明記） |
| `docs/spec.md` §3 / §10 | 会員クラブの境界が無い | 育成アプリ非対応・換金非対応を明記。禁止事項 12〜15 を追加 |
| `README.md` | 買い切り ¥88,000 / 年払い ¥66,000 / 月払い ¥12,000 | 現行 4 tier ＋ ¥3,980 / ¥39,800。廃止済みを明記 |
| `docs/RENEWAL_2026_08.md` §2 | `light+` 表記がライト販売と読める | 「`light` 以上の tier の意味であり、ライトプランの販売ではない」注記を追加（契約文は不変） |
| `docs/spec.md` §3 | 「決済ゲートウェイの実装／現行は銀行振込自動化」（Stripe 実装後も未更新） | 「決済処理そのものは Stripe が行う」へ改稿。KI が持つのは Checkout 開始 / webhook 受信 / Portal 誘導 / 価格表示のみ |
| `src/pages/mypage.astro` | 廃止済みの「穴馬レポート・優先メルマガ」が残存 | 削除し、静的ガードで再混入を禁止 |

---

## 前 Phase（完了）— KI 大改修 2026-08

**Phase: KI 大改修 2026-08（無料開放 / 新聞レイアウト / 文章化 / Stripe / 認可是正 / KMA / ライトデザイン）**

着手: 2026-08-28 / ブランチ `feat/ki-renewal-2026-08` / 分岐元 `cfe5fea2`
スコープ・tier 定義・完成条件の正本: **[`docs/RENEWAL_2026_08.md`](./RENEWAL_2026_08.md)**
方針決定の記録: `docs/decisions.md`「2026-08-28 — 大改修の方針を確定する」

仕様所有者の確定事項（U-1〜U-4）は `docs/RENEWAL_2026_08.md` §2。要点:

- 未登録は **印と買い目以外すべて公開**／無料会員で**印**／有料で**買い目**
- デザインは**ライト基調＋競馬新聞の枠色**
- 価格は**内容を見て後決め**（→ Price ID を env 注入し、金額をコードに書かない）
- **Stripe がメイン。既存客の互換維持は最優先要件ではない**

### 工程

| # | 工程 | 状態 |
|---|---|---|
| P0 | 構想の正本固定（`RENEWAL_2026_08.md` / spec / decisions / progress） | **完了** |
| P1 | 文章化エンジン `src/utils/raceNarrative.js` ＋テスト26件 | **完了** |
| P2 | 新聞レイアウトコンポーネント（7経路が共有） | **完了** |
| P3 | ライト基調デザイントークン ＋ 全ユーザー導線の統一 | **完了** |
| P4 | サーバー側認可（署名 Cookie ＋ 非権限者に描画しない） | **完了** |
| P5 | Stripe（checkout / webhook / portal / prices） | **完了**（本番キー・Price 作成は未実施） |
| P6 | KMA 連携（既定 disabled） | **完了**（KI 側のみ。KMA 側は依存として記録） |
| P7 | 日次ダイジェスト素材生成 ＋ workflow | **完了** |
| P8 | 検証・Draft PR | **完了**（[PR #80](https://github.com/apol0510/keiba-intelligence/pull/80) Draft） |

### 実装した内容（2026-08-28）

| 層 | 追加・変更 |
|---|---|
| 文章化 | `src/utils/raceNarrative.js`（脚質・上がり順位・コース/距離実績・馬体重・休養・人気を覆した実績・特徴量突出 → 1〜3文の短評／レース展望／想定隊列） |
| 紙面 | `src/components/newspaper/{RaceNewspaper,RaceEntryTable,HorseDetailPanel,PaceMap,FeatureBars,RaceDayBoard,TierRibbon}.astro`（2026-08-29: 基本UIをシンプル版出馬表＋行アコーディオンへ変更。枠番は `src/utils/frameNumber.js` で算出し実データ5,039件と照合） |
| データ | `src/lib/prediction/loadRaceDay.js`（4ページの重複読込を単一化。featureScores は取込済み優先＋算出フォールバック） |
| 認可 | `src/lib/auth/{tiers,session,entitlement}.js` ＋ `verify-magic-link` / `get-session` / `logout` の署名Cookie化 |
| 課金 | `src/lib/billing/plans.js` ＋ `stripe-{prices,create-checkout,webhook,portal}.js` ＋ `/pricing` 全面改修 |
| DRM | `src/lib/kma/client.js`（既定disabled）＋ `src/lib/digest/buildDailyDigest.js` ＋ `scripts/generateDailyDigest.mjs` ＋ `generate-daily-digest.yml` |
| デザイン | `global.scss` のライト転換＋枠色8色、`BaseLayout` ナビ、`/`・`/pricing`・`/mypage`・`/archive`・`/login` 等の統一 |

### 2026-08-29 — 無料会員に本命順位を漏らさない仕様へ改訂

当初実装は無料会員に ◎○▲△・AI指数・評価順の並び・役割バッジを出しており、
**本命順位がそのまま読める**状態だった（有料の結論を無料で渡していたに等しい）。
仕様所有者の指示により R-1〜R-8（`docs/RENEWAL_2026_08.md` §2）へ改訂した。

| # | 規則 | 実装 |
|---|---|---|
| R-1 | 役割バッジを全 tier で出さない（HTML にも残さない） | `RaceEntryTable` から `role-tag` を削除 |
| R-2 | 出馬表は常に馬番昇順 | `attentionMarks.sortByHorseNumber` |
| R-3 | 無料の印は 1 列に **指数ごとの印を合算**（新聞の総合印）。指数1本＝記者1人で 1位◎/2位○/3位▲/4〜7位△（△/軸=4で固定）。同じ記号が重なる。**本命は分かってよい**（指数が一致すれば自然に印が集まる）。守るのは相手（△の集合が買い目の相手の集合と一致しないことを実データで検証） | `attentionMarks.availableAxes` → `assignFreeMarks`（実在の指数のみ。1頭を特別扱いする処理なし。ランダム不使用） |
| R-4 | 短評に役割語を入れない | `raceNarrative` の `lead` を廃止 |
| R-5 | AI指数の実数値は有料のみ。無料はモザイク（値を HTML に含めない） | `maskScore` で `•••` を描画 |
| R-6 | AI結論は有料 tier のみ（生成もしない） | `allowMarks: showBetting` |
| R-7 | 詳細アコーディオンは既定ですべて閉じる（自動で開かない） | `RaceEntryTable` の `defaultOpenHorseNumber` を廃止 |
| R-8 | 有料 tier では印を出さない（列ごと非表示） | `showMarkColumn = showMarks && !showBetting` |

### 実測で確認した tier 別の描画（2026-08-28・dev server）

`/prediction/nankan` に署名 Cookie を付けずに GET / 各 tier の Cookie を付けて GET した実測。

| tier | 買い目ブロック | 印 | 短評 | レース展望 |
|---|---|---|---|---|
| guest | **0** | **0** | 126 | 12 |
| free | **0** | 126 | 126 | 12 |
| light / premium | 12 | 126 | 126 | 12 |

同じ結果を `/prediction/jra`（3会場・36R・490頭）、`/free-prediction/{nankan,jra}`、
`/prediction/[slug]`、`/free-prediction/nankan/[slug]`、`/free-prediction/jra/[date]` の
**7経路すべて**で確認した。guest のレスポンスに買い目の文字列は 1 件も含まれない
（正規表現 `\d+-\d+(\.\d+)+` でのマッチ 0 件）。

### 監査 A-1〜A-5 / A-8 の状態

| # | 内容 | 状態 |
|---|---|---|
| A-1 / A-2 | 有料買い目が未認証のレスポンスに含まれる | **是正済み**（CSS で隠すのをやめ、HTML に出さない） |
| A-3 | entitlement の判定源がクライアント保存値のみ | **是正済み**（予想7経路・マイページがサーバー判定へ移行。`AccessControl.astro` は未使用になった） |
| A-4 | サーバー検証できるセッションが存在しない | **是正済み**（`ki_session` 署名 Cookie を新設） |
| A-5 | 予想ページの認証チェックがハードコード無効化 | **是正済み**（該当ページを全面改修。静的テストで再発を禁止） |
| A-6 / A-7 | 管理配信 API の認可 | **未着手**（本改修のスコープ外。Open Questions Q9 のまま） |
| A-8 | CORS 許可 origin に本番ドメインが無い | **是正済み**（`verify-magic-link` / `get-session` / `logout`） |

### 本改修で新たに判明した事項

1. **`/prediction/[slug]` は認可が一切無いまま買い目を全公開していた**（監査 A-1 と同種だが、
   監査時は index ページのみを対象にしていたため未検出）。本改修で是正した。
2. **同ページが `Math.random()` で「期待値 +X%」を生成して表示していた**。
   実データでない数値を成績のように見せていたため削除し、静的テストで再発を禁止した。
3. **JRA の過去走データに上がり3F・通過順が無い**（`horseHistories` の全レコードで空）。
   そのため JRA では脚質判定・上がり比較・展開予想が出せない（推測で埋めない方針）。
   → **上流（`keiba-data-shared-admin` / jv-link-cli）での補完が必要**。Open Questions Q11。
4. `free-prediction/jra/detail/[slug]`（旧 JRA 遅延フラグメント）は新レイアウトが過去走を
   インラインで描画するため **参照元が無くなった**。削除はしていない（外部リンク保護）。Q12。



---

## 前々 Phase（完了）— ドキュメント基盤整備

**Phase: 自律完遂運用のためのドキュメント基盤整備（2026-07-20）**

コード変更は一切行っていない。本タスクの成果物は `docs/spec.md` / `docs/progress.md` / `docs/decisions.md` / `CLAUDE.md` の 4 ファイルのみ。

### リポジトリ側の到達点（git 履歴・PR 履歴からの事実。本タスクの成果ではない）

- 馬単 **F3 方向ルール + 投資5点固定** は **2026-07-02 に main へマージ済み**（PR #65〜#68）。
- 共有データの **認証必須化（`KEIBA_DATA_SHARED_TOKEN` 単一化・匿名 fallback 廃止）** は 2026-06-28 に完了（PR #49〜#61）。
- **Workflow Phase 1（concurrency 統一）** は 2026-03-14/15 に完了（`docs/WORKFLOW_PHASE1_COMPLETION.md`）。Phase 2/3 は未着手。
- main は自動取込 commit が日次で積まれており（2026-07-20 時点の最新は `1875508` = 2026-07-19 の JRA 結果検証）、**自動化パイプラインは稼働中**。
- `feat/ki-umatan-f3` / `feat/ki-umatan-f3-mobile-layout` / `feat/ki-umatan-f3-remove-direction-badges` /
  `chore/umatan-archive-f3-5pt` の 4 本は **いずれも 2026-07-02 に squash merge 済み**（PR #65〜#68）。
  進行中の作業ブランチではない。squash merge のため `git branch --merged` では merged と判定されないが、
  PR 状態が MERGED であることが根拠。残存ブランチの扱いは下記「Remaining」の「未整理ブランチ」を参照。

## Completed

**本タスク（2026-07-20）で完了したもの — ドキュメント基盤のみ**

- [x] `docs/spec.md` 新規作成（スコープ・境界・契約・完成条件・検証手順・禁止変更・既知の未確定事項）
- [x] `docs/progress.md` 新規作成（本書）
- [x] `docs/decisions.md` 新規作成（証拠のある設計判断のみ記録）
- [x] `CLAUDE.md` へ Autonomous Delivery Workflow ブロックを追記（既存ルールの削除・弱体化なし）
- [x] 既存ドメイン文書との正本関係を `docs/spec.md` 冒頭の表で明示（競合する正本を作らない）
- [x] 非破壊チェックの実行と結果記録（下記「Validation results」）
- [x] 差分監査（4 ファイルのみ・secret 値なし）

**コードの完成宣言は本タスクでは一切行っていない。**

### 2026-07-20 — `computerIndex` 偽値を fail-closed で遮断（工程A）

上流 `keiba-data-shared-admin` PR #152 が**将来データ**の生成を修正した。本リポジトリ側は
**既に shared に保存済みの不良データ / 既に取り込み済みのデータ**に対する防御を担当する。

- [x] 契約の単一定義 `astro-site/src/utils/computerIndexContract.js`（10–99・欠損は null・固定値補完なし）
- [x] role/rawScore 判定（`normalizePrediction.js`）へ適用
- [x] JRA 予想3画面の「総合pt」バッジへ適用（旧: null/空のみのガード → 偽値 1/4/8 が 11/14/18 と表示されていた）
- [x] 取込境界4箇所（`importPredictionJra.js` ×3 / `importPrediction.js` ×1）で契約外値を null 化
- [x] regression test 10件（不変条件4種 + 3画面への適用を静的検証）
- [x] 既存テスト（`test:nankan` / `test:validation` / `validate:archive` / import 系2本）・`npm run build` 通過

## In Progress

- **本ドキュメント基盤の整備**（PR #69）。以降の追記・更新は Phase 完了ごとに行う。

2026-07-20 時点の調査では、これ以外に進行中のコード作業は確認されていない
（当時オープンだった PR は本 PR のみ）。これは調査時点の観測であり、恒久的な状態ではない。
最新状況は `gh pr list --state open` で都度確認すること。

## Remaining

### 1. 文書の不整合解消（コード変更を伴わない・低リスク）

- `CLAUDE.md` の「メインレース10点ロジック」節（2026-05-08）が、現行の F3・5点固定と併記されたまま残っている。
  同ファイルの文書索引も `BET_POINT_LOGIC.md` を「2段階調整方式」と旧記述で参照している。
  → **どちらが現行かをコード（`umatanHit.js`）に合わせて明記する編集が必要**。本タスクでは既存記述を削除しない方針のため未実施。
- `BET_POINT_LOGIC.md` の検証表の数値がテスト実測と乖離（下記 Open Questions 参照）。
- `README.md`「全体進捗 100%完了」・`NEXT_SESSION.md`（2026-01-18）が現状を反映していない。
- `DESIGN.md`（2026-01-09）の決済・自動化スタック記述が現行と乖離（ThriveCart / Zapier / PayPal）。歴史的資料としての位置づけを本文にも記載するとよい。

### 2. Workflow Phase 2 / Phase 3（`docs/WORKFLOW_PHASE1_COMPLETION.md` に計画あり・時期未定）

- Phase 2: workflow 統合（8 → 5 へ削減）。**現状は 14 workflow に増えており、Phase 1 当時の前提と数が異なる**。再計画が必要。
- Phase 3: 各 workflow に残存する `pull --rebase` リトライループの削除。

### 3. 未整理ブランチの棚卸し（低リスク・ただし削除は要確認）

ローカル/リモートに squash merge 済みのブランチが多数残存している。

| ブランチ | 対応 PR | 状態 |
|---|---|---|
| `feat/ki-umatan-f3` | #65 | MERGED（2026-07-02）→ 削除候補 |
| `feat/ki-umatan-f3-mobile-layout` | #66 | MERGED（2026-07-02）→ 削除候補 |
| `feat/ki-umatan-f3-remove-direction-badges` | #67 | MERGED（2026-07-02）→ 削除候補 |
| `chore/umatan-archive-f3-5pt` | #68 | MERGED（2026-07-02）→ 削除候補 |
| `fix/shared-private-auth-ki-*`（14本） | #49〜#61 | MERGED → 削除候補 |
| `feat/fixed6-nearest150-recovery` | **該当 PR なし** | **意図・状態とも未確定。削除判断不可** |

> squash merge のため `git branch --merged` では merged と判定されない。**PR 状態を根拠に判断すること**。
> ブランチ削除は本タスクのスコープ外（許可された変更ファイルは 4 つのみ）。

### 4. 未確定の運用整備

- lint / typecheck の導入可否（現状スクリプト未定義）
- `.env.example` の新設可否
- `scripts/*.test.mjs` を一括実行する集約テストスクリプトの整備（現状は個別実行のみ）

## Next Actions

1. 本 Draft PR をレビューし、内容に合意のうえマージする（**PR merge は高リスク境界。承認が必要**）。
2. `CLAUDE.md` の「メインレース10点ロジック」節と文書索引を現行 F3 仕様に整合させる小 PR を出す（コード変更なし）。
3. `BET_POINT_LOGIC.md` の検証表について、スナップショットである旨を明記するか実測値へ更新するかを決める（Open Questions Q2 の解決が前提）。
4. Workflow Phase 2 を再計画する（現状 14 workflow を前提にした統合案を作る）。
5. squash merge 済みブランチの整理方針を決める（`feat/fixed6-nearest150-recovery` の扱いを含む）。

## Blockers

- なし（本ドキュメント基盤の作成・検証・push・Draft PR 作成までは阻害要因なく完了）。

## 2026-08-30 プラン構成の単純化（完了）

仕様所有者の指示により、ライト/プレミアムの二本立てを廃止した。

| 項目 | 変更前 | 変更後 |
|---|---|---|
| 月額プラン | ライト（南関のみ）/ プレミアム | **プレミアム 1 本**（ライトは保留） |
| 会場アクセス | `venueAccess` で南関/中央を分ける | **廃止**。有料なら南関＋中央 |
| プレミアム限定 | 詳細レポート・穴馬・優先メルマガ（**未実装**） | **訴求ごと廃止**。`canSeePremiumExtras` 削除 |
| 月額価格 | 未確定（Stripe のみ） | 正規 ¥5,000 → **割引 ¥3,980**（表示用定数。請求額は Stripe が正本） |
| 銀行振込 | 買い切り ¥88,000 / 年払い ¥66,000 / 月払い ¥12,000 系 / ライト ¥6,600 | **年払い ¥39,800 のみ** |

削除・変更したもの:

- `tiers.js`: `venueAccess` / `venueAllowed` / `VENUE` / `canSeePremiumExtras` を削除。
  `canSeeBetting(tier)` は tier だけを取る。
- `entitlement.js` / `previewMode.js`: `venue` 引数と `showPremiumExtras` を削除。
- 予想ページ 7 経路: `entitlementFromAstro(Astro, { venue })` → `entitlementFromAstro(Astro)`。
- `stripe-webhook.js` / `bank-transfer-application.js`: `VenueAccess` を書かない。
- `send-payment-confirmation-auto.js`: 会場別の文面分岐を削除。
- `AccessControl.astro`: **削除**（どこからも import されていない死んだコード。会場別の文言を含んでいた）。

🟡 **セッション Cookie の `venueAccess` フィールドは残した。**
署名材料に含まれるため、外すと発行済み Cookie が全部無効になる（全員ログアウト）。認可では読まない。

🔴 **既存の会場限定会員は権限が広がる**（`VenueAccess='nankan'` でも中央の買い目が見える）。
本決定の意図どおり。テストで固定済み。

詳細: `docs/decisions.md`「2026-08-30 — ライトプランを保留し、会場別アクセスを廃止する」

---

## 2026-08-31 本番反映（完了）

PR #80 を `main` へ merge し、本番へ反映した。

| 項目 | 値 |
|---|---|
| merge commit | `da1a89224f4c`（2026-08-31 05:22 UTC）|
| 規模 | 56コミット / 81ファイル / +13,139 −16,239 |
| Netlify | production `ready` 05:22:30 |

### 反映前に解消したブロッカー

🔴 `SESSION_SIGNING_SECRET` が未設定だった。
未設定のまま反映すると **fail-closed で全員 guest** になり、
有料会員に買い目が出ず、マジックリンクで Cookie も発行されない。

- 設定を確認: 64文字の16進 / scopes = builds・functions・post_processing・runtime / contexts = all
- 🔴 **Netlify の環境変数はデプロイ時に注入されるため、追加しただけでは既存デプロイに反映されない。**
  空コミットでの再ビルドは「内容に変更なし」で自動キャンセルされるので、
  `netlify api createSiteBuild --data '{"site_id":"…","clear_cache":true,"branch":"…"}'` で
  ブランチデプロイを起こして `preview-status` の `sessionSecretConfigured: true` を確認した。

### 反映後の実測（本番・未認証）

| 検査項目 | 結果 |
|---|---|
| 旧方式 `pro-user-only`（CSSで隠すだけ）| **0件**（反映前は12件）|
| 「◎ 本命 ○○○」のソース露出 | **0件** |
| 未認証に印 / AI指数の値 / ツールバー / 買い目パネル / 結論 | すべて 0件 |
| 馬柱の行 | 152行（正常）|
| 料金ページ | プラン1本 / ¥5,000→¥3,980 / 年払い¥39,800 / 廃止語なし |

**2026-08-17 監査 A-1（有料コンテンツが HTML に露出）は本番で解消した。**
ログイン後に印・買い目が見えることも仕様所有者が確認済み。

### 残り（未実施）

- **Stripe の設定**（Price 作成 → Webhook 登録 → env 設定 → 再デプロイ）。
  未設定でも購入ボタンが「まもなく受付開始」になるだけで閲覧は壊れない。
  銀行振込の年払い ¥39,800（`/apply`）は稼働中。
- 買い目の相手数が頭数を見ていない件（下記 Open Questions）。

---

## 2026-09-01 Stripe E2E（外部 write なしで完走）

仕様所有者の指示: 本番 Stripe への write（Product / Price / Webhook 登録 /
Customer Portal 設定 / 本番 env 変更 / 実決済）は行わず、可能な範囲を E2E する。

### 方式

本番 Stripe を叩かずに **関数の実コード**を動かした。

| 対象 | やり方 |
|---|---|
| 署名生成・検証 | **本物の `stripe` パッケージ**（`generateTestHeaderString` / `constructEvent`）|
| Airtable | メモリ上のスタブに差し替え（`mock.module`）|
| Netlify Blobs | メモリ上のスタブに差し替え |
| Stripe API（checkout / portal）| スタブに差し替え、**渡す内容**を検証 |
| entitlement | `planTypeToTier` → `signSession` → `resolveEntitlement` の実物 |

Node の `--experimental-test-module-mocks` を使用。`npm run test:stripe` で実行し、
`npm run build`（＝Netlify のビルド）にも組み込んだ。

### 🔴 発見して直した本番バグ 2 件

**1. `stripe` パッケージが `package.json` に無く、本番の Stripe 関数が全滅していた。**

- `netlify.toml` は `external_node_modules = [... "stripe"]` と宣言していたが、
  依存に入っていないため `node_modules/stripe` が存在せず、
  **本番の `/.netlify/functions/stripe-prices` が 502** を返していた（実測）。
- 料金ページは Price ID 未設定時に `stripe-prices` を呼ばない実装なので
  画面には出ていなかったが、**Stripe を有効化した瞬間に全経路が壊れる**状態だった。
- → `stripe@^22.6.0` を dependencies に追加。

**2. 冪等性の記録が「処理前」に行われ、失敗したイベントが永久に失われていた。**

- `alreadyProcessed()` が確認と同時に処理済みを記録していたため、
  ハンドラが失敗して 500 を返したあと **Stripe が再送しても無視**され、
  その付与・剥奪が反映されないままになる。
- → `hasProcessed()` / `markProcessed()` に分離し、**成功後**に記録するよう修正。
  静的テスト（`billing.test.mjs`）でも順序を固定した。

### E2E で確認した範囲（41 テスト）

| 経路 | 結果 |
|---|---|
| Checkout 完了 → 付与 → 有料表示が開く | ✅ `PlanType=premium / Status=active / AccessEnabled=true` → `showBetting=true` |
| 解約（`subscription.updated(canceled)`）→ 失効 → 停止 | ✅ `free / inactive / false` → `showBetting=false`・印は残る |
| `subscription.deleted` → free へ | ✅ |
| `subscription.updated(active/trialing)` → 付与 | ✅ `past_due` / `incomplete` / `paused` は無視 |
| `invoice.payment_failed` | ✅ `Status` のみ変更。`PlanType`・`AccessEnabled` は触らず、アクセスは即時停止しない |
| Checkout 開始（ログイン必須・metadata）| ✅ `mode=subscription` / `line_items[].price` / `ki_plan`・`ki_email` |
| Customer Portal（解約導線）| ✅ セッションの email で顧客検索 → `return_url` |

| 安全性 | 結果 |
|---|---|
| 冪等（同 `event.id` 二度目）| ✅ `duplicate:true`・書き込み 1 回 |
| 冪等（失敗イベントの再送）| ✅ 修正後は再送で復旧 |
| 二重付与防止 | ✅ 別 `event.id` は別処理、同一は 1 回 |
| 他会員混入なし | ✅ 別 email は別レコード。片方の解約が他方に波及しない |
| 顧客レコード無し | ✅ 作らない・書き込み 0・200 |
| 署名不正 / 無署名 / 別秘密 / 本文改竄 | ✅ すべて 400・書き込み 0 |
| `STRIPE_WEBHOOK_SECRET` / `STRIPE_SECRET_KEY` 未設定 | ✅ 503・書き込み 0 |
| 未知のプラン（保留中の `light` 含む）・email 欠落 | ✅ 付与しない |
| 内部エラーの詳細露出 | ✅ `handler_failed` のみ。Airtable のメッセージは出ない |
| Checkout: 未ログイン / 改竄 Cookie / 署名鍵なし | ✅ 401・Stripe を叩かない |
| Checkout: クライアント申告の email | ✅ 無視。セッション由来のみ使用 |
| entitlement: 署名鍵なし / 別鍵 / 期限切れ | ✅ すべて guest または free（fail-closed）|
| `viewFlags` に email を含めない | ✅ |

### 🔴 まだ実施していないこと（すべて外部 write のため停止）

E2E をここから先へ進めるには、**Stripe への外部 write が必要**になる。
指示どおりその直前で停止した。必要な操作は次の 4 つ（すべて GUI 操作）。

1. **Test Mode で Product / Price を作る**（¥3,980 / 月・JPY・定期）
2. **Test Mode の Webhook エンドポイントを登録**
   `…/.netlify/functions/stripe-webhook` に
   `checkout.session.completed` / `customer.subscription.updated` /
   `customer.subscription.deleted` / `invoice.payment_failed`
3. **Customer Portal を有効化**（Test Mode）
4. **`STRIPE_SECRET_KEY`（`sk_test_…`）/ `STRIPE_PRICE_PREMIUM` /
   `STRIPE_WEBHOOK_SECRET` を Deploy Preview スコープへ設定**

これらが揃えば、Stripe のテストカード（`4242…`）を使った
**実際の Checkout 画面 → 本物の webhook 配信**までブランチデプロイ上で通せる。
本番 env と本番 Stripe には一切触れない。

---

## Open Questions

0.1 🔴 **`@netlify/blobs` が `astro-site/package.json` の依存に無く、
   `stripe-webhook.js` の `stripe-events` ストアが機能していない疑い（R-2・2026-09-03）。**

   `hasProcessed` / `markProcessed` は `import('@netlify/blobs')` の失敗を try/catch で
   飲み込むため、**壊れていても静かに「重複なし」として通る**。
   同一 deploy で同じ event id を 3 回再送しても `duplicate:true` が一度も出なかった。

   - データ破壊は起きていない（下流の冪等性で二重反映は防がれている。実測済み）
   - ただし Test Mode E2E #6 の期待値 `duplicate:true` が満たせない
   - 確認方法: 依存に `@netlify/blobs` を加える／関数ログで `eventStore()` の失敗を見る



0. ~~**会員継続制度の未確定事項 TBD-1〜TBD-8**~~（2026-09-01 **確定**。`MEMBERSHIP_REWARDS.md` §7.1）。
   ~~**法務確認 L-1〜L-9**~~（保守ライン内に設計を収めたため**確認待ちは解消**。§8）。

   残っているのは次の 4 件のみ:

   | # | 内容 | いつ必要か |
   |---|---|---|
   | TBD-3b / 4b | **景品の品目**そのものと仕入れ | 交換の実運用を始める前 |
   | ~~TBD-9 / TBD-10~~ | ~~継続月数の起点 / 支払い失敗中の扱い~~ | **2026-09-01 確定**（`MEMBERSHIP_REWARDS.md` §7.6 / §7.7）|
   | TBD-12 | 発送先住所の取得方法・保管期間 | 交換の実運用を始める前 |

   継続的な確認事項は **決算期のポイントの会計処理（税理士）**のみ（§8.2 L-5）。

0.5 ~~**`/mypage` の「利用できる機能」に『穴馬レポート・優先メルマガ』が残っている（2026-09-01 発見）。**~~
   （2026-09-01 **解消**。仕様所有者の指示により削除した）

   `docs/RENEWAL_2026_08.md` §6.1 が「実装が無いものを訴求しない」として
   プレミアム限定コンテンツの訴求を廃止し `canSeePremiumExtras` ごと削除していたのに対し、
   `src/pages/mypage.astro` の `FEATURES` 配列に該当行が残り、
   プレミアム会員へ「✓」として表示されていた（**実装は無い**）。

   → 該当行と、それだけに使われていた `isPremium` を削除。
   併せて `membershipCopy.guard.test.mjs` に
   「廃止済みの訴求（穴馬レポート / 優先メルマガ / 詳細レポート / `canSeePremiumExtras`）と
   廃止済みの価格（¥88,000 / ¥66,000 / ¥12,000 / ¥6,600 / `venueAccess`）を UI に書かない」
   静的ガードを追加し、**再混入を禁止**した。

1. **`CLAUDE.md` の「メインレース10点ロジック」は F3・5点固定に完全に置き換わったのか、一部が併存しているのか。**
   コードは F3（`umatanHit.js` の `reverseTopK`）が現行。ただし `CLAUDE.md` の 10 点節は削除されておらず、
   「置き換えた」と明記した記録も見つからない。→ 仕様所有者の確認が必要。
2. **`BET_POINT_LOGIC.md` の検証表の数値はいつ時点のものか。**
   - `BET_POINT_LOGIC.md` 記載値（**時点の記載なし**）: 南関 217.1% / 公開的中 784 / ¥1,483,110、JRA 212.8% / 634 / ¥1,417,180
   - **2026-07-20 に実測した時点値**: 南関 214.8% / 902 / ¥1,673,170、JRA 212.9% / 744 / ¥1,647,970

   **両者とも archive の蓄積件数に依存する時点測定値であり、恒久的な仕様値ではない。**
   archive に開催が追加されれば数値は変動するため、いずれの数値も「満たすべき基準」として扱わないこと。
   テストは pass するため恒等式・冪等性の破綻ではなく、文書側がスナップショットである可能性が高いが明記がない。
3. 🔴 **買い目の相手数が出走頭数を見ていない（2026-08-30 発見・仕様所有者へ報告済み）。**

   「8頭立てなのに展開16点・推奨6点で違和感がある」という指摘から実測した結果、
   **相手数が頭数に関係なく常に 6 頭固定**であることが判明した。

   南関 2026-08-18 川崎（12R開催）:

   | レース | 頭数 | 相手数 | 展開 | 推奨 |
   |---|---|---|---|---|
   | R1 / R2 / R3 / R8 / R10 | 12頭 | 6/6 | 16点 | 10点 |
   | R4 | 10頭 | 6/6 | 16点 | 8点 |
   | R5 / R7 | 11頭 | 6/6 | 16点 | 8点 |
   | R9 | 9頭 | 6/6 | 16点 | 8点 |
   | **R6 / R12** | **8頭** | **6/6** | 16点 | **6点（差10）** |
   | R11（メイン） | 9頭 | 5 | 5点 | 5点（差0） |

   JRA 2026-08-16（36レース）も `6/6` が 32 レース、`5` が 3、`5/5` が 1。

   **8 頭立てでは軸を除く 7 頭のうち 6 頭を相手に取っている＝ほぼ全頭買い。**
   そのため展開が常に 16 点になり、少頭数ほど推奨点数との差が開く。

   原因は推奨点数のロジックではなく、**買い目生成側（`scripts/importPrediction.js` /
   `importPredictionJra.js`）が出走頭数を見ていない**こと。

   取り得る道:
   - (a) **買い目生成を頭数連動にする** — 根本解決。ただし `importPrediction` の変更は
     archive・的中判定・過去実績へ影響するため、影響範囲の確認が必要。
   - (b) **推奨点数を展開点数にも連動させる** — 表示だけの変更で低リスク。

   🔴 **依頼範囲外のため未着手。** 仕様所有者の指示待ち。
   メインレースは `getTop5Challengers` で 5 頭に絞られているため、この問題は
   **通常レースのみ**に出る。

3. **`feat/fixed6-nearest150-recovery` は何のためのブランチで、生かすのか破棄するのか。**
   対応 PR が存在せず、コミット意図を示す文書も見つからない。
4. Workflow Phase 2（統合）は依然として実施する方針か、それとも 14 workflow の現状維持で確定したのか。
5. lint / typecheck を導入しない判断は明示的になされたものか、単に未着手か。
6. ~~**`CLAUDE.md` の「本番 URL 取り扱いルール」表と `astro-site/netlify.toml` の 301 が食い違う。**~~
   （2026-08-05 発見 → **2026-08-09 解決**。本番 URL は `https://keiba-intelligence.jp/`）

   仕様所有者が `keiba-intelligence.jp` を本番として提示したことで確定。
   実装側の根拠（`netlify.toml` の 301 `force = true` / `sitemap.xml.js` の baseUrl /
   `docs/spec.md`）とも一致し、`CLAUDE.md` だけが古かった。

   併せて **canonical / og:url が「301 で転送される URL」を指していた**のを直した。
   `astro.config.mjs` の `site` が `netlify.app` のままで、sitemap（`.jp`）と矛盾していた。
   `results/[year]/[month]/[day].astro` の JSON-LD（image / organizer.url / offers.url）も同様。

   🔴 **残る注意**: `netlify.app` 側へ POST してはいけない。301 でメソッドが GET へ
   変換され、**フォーム送信が壊れる**（配信停止ページ等）。
11. **JRA の過去走に上がり3F・通過順が無い。**（2026-08-28）
    `src/data/horseHistories/jra/**` の全レコードで `last3f` / `passingOrder` が空のため、
    JRA では脚質判定・上がり順位・展開予想が算出できない（南関は算出できている）。
    KI は共有データの読み取り専用消費者であり、KI 側では補完できない。
    → 上流（`keiba-data-shared-admin` / jv-link-cli）での取得可否の確認が必要。
12. **`src/pages/free-prediction/jra/detail/[slug].astro` の去就。**（2026-08-28）
    新レイアウトが過去走をインライン描画するため参照元が無くなった。
    静的生成のコストはあるが害は無いため削除していない。→ 削除可否は要判断。
13. **KMA 側に必要な未完の依存。**（2026-08-28。**別リポジトリのため本改修では実施しない**）
    - `brands/index.js` の KI `contentUrls`（`loginUrl` / `unsubscribeUrlBase`）が `null`
    - KI の `plans` が analytics-keiba 由来（`premium-combo` / `premium-tan`）のままで、
      本改修の tier（`free` / `light` / `premium`）と一致しない
    - `keiba-intelligence:signup-onboarding` の本文コンテンツが未作成
    - `race` 設定（レース配信）が `null`
    - 各自動化フラグが false（**有効化は高リスク境界。承認必須**）

7. **配信停止で `recipientRef` を Customers レコードへ対応付ける方法が未確定。**（2026-08-05）
   KMA 側 onboarding の `audience.adapterId` / `audience.mode` が未確定のため、
   `astro-site/src/lib/unsubscribe/store.js` の本番 store は **既定で無効（fail-closed）**にしてある。
   対応付けが確定するまで、実際の解除は確定できない（画面には「現在お手続きできません」と表示される）。

## High-risk Operations Not Yet Executed

高リスク操作の一覧と承認境界の正本は `CLAUDE.md`「High-risk approval boundary」。ここでは重複させず、
**本タスクで実行しなかったもの**のみ記録する。

- 同節に列挙された高リスク操作は **一つも実行していない**（PR merge / main への直接 push / 履歴変更 /
  workflow dispatch / 本番デプロイ / 本番書込み / メール送信 等）。
- 併せて未実行: `npm run verify:sync`（外部 API + token が必要）、`npm run build`（依存インストールが必要）、
  既存ブランチの削除。

## Validation results

2026-07-20 に `astro-site/` で実行した非破壊チェックの実測結果（verbatim 抜粋）。
**これは実行時点の観測記録であり、期待値・合格基準の定義ではない。**
出力中の回収率・的中数・払戻額は archive の蓄積に応じて変動する時点値。

```
$ node scripts/validateArchiveFormat.js
🔍 検証中: 南関競馬アーカイブ
   ✅ フォーマット検証: 正常
🔍 検証中: 中央競馬アーカイブ
   ✅ フォーマット検証: 正常
✅ 全てのアーカイブが正常です
```

```
$ node scripts/umatanHit.test.mjs
  南関F3: 通算 214.8%  公開的中 902  払戻¥1,673,170 / 投資¥779,000
  JRA F3: 通算 212.9%  公開的中 744  払戻¥1,647,970 / 投資¥774,000
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

```
$ node src/utils/getDisplayRecentRacesForNankan.test.js
getDisplayRecentRacesForNankan: 19 passed, 0 failed

$ node src/utils/nankanHorseStatsInjection.guard.test.js
nankanHorseStatsInjection.guard (KI): 4 passed, 0 failed
```

```
$ node scripts/utils/validatePrediction.test.js
テスト結果: 6/6 成功
✅ 全テスト成功！
```

```
$ node --test scripts/utils/workflowStaticAudit.test.mjs
ℹ tests 91
ℹ pass 91
ℹ fail 0
```

未実行: `npm run build`（依存インストールが必要）、`npm run verify:sync`（外部 API + `KEIBA_DATA_SHARED_TOKEN` が必要）。
lint / typecheck: **スクリプト未定義のため実行不可**。

## Repository State

恒久的な事実:

- **Repository**: `keiba-intelligence` / **Origin**: `https://github.com/apol0510/keiba-intelligence`
- npm プロジェクトのルートは `astro-site/`（リポジトリ直下に `package.json` は無い）

2026-07-20 時点の観測（**スナップショット。恒久仕様ではない**）:

- **Branch**: `docs/autonomous-project-workflow`（`origin/main` から作成、PR #69）
- **分岐元 origin/main**: `1875508`（`Auto-verify: 2026-07-19 JRA results from jv-link-cli`）
- **本タスクの変更範囲**: `CLAUDE.md` / `docs/spec.md` / `docs/progress.md` / `docs/decisions.md` の 4 ファイルのみ（ソースコード変更なし）

作業ツリーの clean / dirty 状態や未コミット件数は都度変化するため、本書には記録しない。
現在地は `git status --short` / `git rev-parse HEAD` で確認すること。
