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
| R-3 | 無料の印は 1 列に重複付与（◎3〜5/○3〜5/▲3〜5/△約10・空欄あり）。**本命は分かってよい**（最上位のみ「◎△」）。守るのは相手（△を相手5〜6頭より広く） | `attentionMarks.assignFreeMarks`（評価順 → バンド。ランダム不使用） |
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

## 前 Phase（完了）

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

## Open Questions

1. **`CLAUDE.md` の「メインレース10点ロジック」は F3・5点固定に完全に置き換わったのか、一部が併存しているのか。**
   コードは F3（`umatanHit.js` の `reverseTopK`）が現行。ただし `CLAUDE.md` の 10 点節は削除されておらず、
   「置き換えた」と明記した記録も見つからない。→ 仕様所有者の確認が必要。
2. **`BET_POINT_LOGIC.md` の検証表の数値はいつ時点のものか。**
   - `BET_POINT_LOGIC.md` 記載値（**時点の記載なし**）: 南関 217.1% / 公開的中 784 / ¥1,483,110、JRA 212.8% / 634 / ¥1,417,180
   - **2026-07-20 に実測した時点値**: 南関 214.8% / 902 / ¥1,673,170、JRA 212.9% / 744 / ¥1,647,970

   **両者とも archive の蓄積件数に依存する時点測定値であり、恒久的な仕様値ではない。**
   archive に開催が追加されれば数値は変動するため、いずれの数値も「満たすべき基準」として扱わないこと。
   テストは pass するため恒等式・冪等性の破綻ではなく、文書側がスナップショットである可能性が高いが明記がない。
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
