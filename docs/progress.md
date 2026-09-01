# Project Progress

> 本書は **KEIBA Intelligence（KI）の進捗の正本**である。
> 新しいセッションはまず `docs/spec.md` → 本書 → `docs/decisions.md` → `CLAUDE.md` の順に読むこと。
> 初版作成: 2026-07-20（基準コミット `1875508` = 作成時点の origin/main）
>
> **本書は PR #69 で新規追加された、KI リポジトリにおける進捗の正本である。**

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
| M2 | テスト 67 件（不変条件 50 ＋ 静的ガード 17） | **完了** |
| M3 | `/pricing` の二本柱化 | **完了** |
| M4 | `/mypage` の会員クラブ枠（未確定は「準備中」） | **完了** |
| M5 | 永続化の移行案・rollback 作成 | **完了**（**実行はしていない**） |
| M6 | TBD-1〜TBD-8 の確定 | **未着手**（仕様所有者） |
| M7 | 法務確認 L-1〜L-9 | **未着手**（仕様所有者） |
| M8 | Airtable スキーマ移行・write 有効化 | **未実施**（高リスク境界・承認必要） |

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
| テスト | `membership.test.mjs`（50）/ `membershipCopy.guard.test.mjs`（17）。`npm run test:membership` を build に組込み |
| 文書 | `MEMBERSHIP_REWARDS.md` / `MEMBERSHIP_DATA_MIGRATION.md` 新規、`spec.md` / `README.md` / `RENEWAL_2026_08.md` の矛盾解消 |

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

### 既存仕様との矛盾を解消したもの

| 箇所 | 変更前 | 変更後 |
|---|---|---|
| `docs/spec.md` §1 | 収益モデルに「買い切り」 | 月額プレミアム ＋ 銀行振込年払い（買い切りは 2026-08-30 廃止と明記） |
| `docs/spec.md` §3 / §10 | 会員クラブの境界が無い | 育成アプリ非対応・換金非対応を明記。禁止事項 12〜15 を追加 |
| `README.md` | 買い切り ¥88,000 / 年払い ¥66,000 / 月払い ¥12,000 | 現行 4 tier ＋ ¥3,980 / ¥39,800。廃止済みを明記 |
| `docs/RENEWAL_2026_08.md` §2 | `light+` 表記がライト販売と読める | 「`light` 以上の tier の意味であり、ライトプランの販売ではない」注記を追加（契約文は不変） |

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

0. 🔴 **会員継続制度の未確定事項（2026-09-01・仕様所有者の確定待ち）。**
   正本の一覧は `docs/MEMBERSHIP_REWARDS.md` §7。ここでは重複させず、**状態のみ**記録する。

   | # | 未確定事項 |
   |---|---|
   | TBD-1 | 毎月の付与ポイント数 |
   | TBD-2 | 各ランクへの昇格月数 |
   | TBD-3 | 商品ごとの必要ポイント |
   | TBD-4 | 景品価格 |
   | TBD-5 | 何か月目に何をプレゼントするか |
   | TBD-6 | ポイント失効期限 |
   | TBD-7 | 解約時のポイント保持・復活条件 |
   | TBD-8 | 価格ロックの再加入時の扱い |
   | TBD-9〜12 | 継続月数の起点 / 支払い失敗時の扱い / 銀行振込年払い会員の扱い / 発送先住所の取得 |

   **コード側は既定値を持たず `pending` を返す**ので、確定するまで画面は「準備中」のままである。
   併せて §8 の法務確認（L-1〜L-9。景表法の限度額・ポイントの会計処理・前払式支払手段の非該当）が未了。

0.5 🔴 **`/mypage` の「利用できる機能」に『穴馬レポート・優先メルマガ』が残っている（2026-09-01 発見）。**
   `docs/RENEWAL_2026_08.md` §6.1 は「実装が無いものを訴求しない」として
   **プレミアム限定コンテンツの訴求を廃止**し、`canSeePremiumExtras` ごと削除している。
   ところが `src/pages/mypage.astro` の `FEATURES` 配列には該当行が残り、
   プレミアム会員に「✓」として表示されている（**実装は無い**）。
   → **本タスクの依頼範囲外のため修正していない**（1 行削除で済むが、独断で広げない）。
   仕様所有者の指示があれば削除する。

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
