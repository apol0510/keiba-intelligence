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
