# Project Progress

> 本書は **KEIBA Intelligence（KI）の進捗の正本**である。
> 新しいセッションはまず `docs/spec.md` → 本書 → `docs/decisions.md` → `CLAUDE.md` の順に読むこと。
> 初版作成: 2026-07-20（基準コミット `1875508` = 作成時点の origin/main）
>
> **本書は PR #69（branch `docs/autonomous-project-workflow`）で新規追加された。main へマージされるまでは
> 当該branch上にのみ存在し、リポジトリ恒久の正本ではない。** マージ後に本注記を削除すること。

## Final Goal

`keiba-intelligence.jp` を、**人手の日次介入なしで**運用できる状態に保つこと。具体的には:

1. 共有データ（`keiba-data-shared`）から予想・結果・特徴量が自動取込され、検証を通過した分だけ main に入る。
2. 馬単 F3・投資5点固定の商品仕様（`BET_POINT_LOGIC.md`）に沿った買い目と的中実績が、南関・JRA で同一ロジックで公開される。
3. 予想画面の 6 経路（JRA/南関 × free/light/premium）が仕様通り表示され、片肺修正による退行が起きない。
4. 仕様・進捗・設計判断が文書化され、セッションをまたいで作業を再開できる。

## Current Phase

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

## In Progress

- **本ドキュメント基盤の Draft PR レビュー**（ブランチ `docs/autonomous-project-workflow` / PR #69）。マージは未実施。

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
2. マージ後、`CLAUDE.md` の「メインレース10点ロジック」節と文書索引を現行 F3 仕様に整合させる小 PR を出す（コード変更なし）。
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
