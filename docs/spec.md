# Project Specification

> 本書は **KEIBA Intelligence（KI）リポジトリのスコープ・境界・完成条件の正本**である。
> 作成日: 2026-07-20 / 基準コミット: `1875508`（作成時点の origin/main）
>
> **本書は PR #69 で新規追加された、KI リポジトリにおけるスコープ・境界・完成条件の正本である。**
>
> **正本の分担（競合する記述があれば下表が優先順位の判断基準）**
>
> | 領域 | 正本ファイル | 本書の扱い |
> |---|---|---|
> | プロジェクト全体のスコープ・境界・完成条件 | **`docs/spec.md`（本書）** | 正本 |
> | 運用ルール・AI作業ルール | `CLAUDE.md` → 詳細は `docs/AI_RULES.md` | 参照のみ |
> | 買い目点数・的中判定（馬単F3・5点固定） | `BET_POINT_LOGIC.md` | 参照のみ（複製しない） |
> | archiveResults の JSON フォーマット | `docs/DATA_FORMAT.md` | 参照のみ |
> | 結果システム全体設計 | `docs/RESULTS_SYSTEM_ARCHITECTURE.md` / `docs/MULTI_VENUE_CHECK.md` | 参照のみ |
> | 予想画面の表示仕様 | `docs/INTELLIGENCE_DISPLAY_SPEC.md` / `docs/ui-cross-plan-regression-policy.md` | 参照のみ |
> | 2026-08 大改修（無料開放 / 新聞レイアウト / 文章化 / Stripe / KMA / デザイン） | **`docs/RENEWAL_2026_08.md`** | 本書の下位正本。改修範囲についてのみ正本 |
> | 初期設計（2026-01-09 時点） | `DESIGN.md` | **歴史的資料**。決済・自動化スタック等は現状と乖離あり。現行仕様の根拠に使わない |
>
> 本書は上記ドメイン文書を **置き換えない**。ドメインの詳細は各正本を読むこと。

---

## 1. Purpose

南関東4競馬場（大井・川崎・船橋・浦和）と中央競馬（JRA）を対象とした、
**AI予想の閲覧・買い目提示・的中実績アーカイブを提供する会員制Webサービス** を運用するリポジトリ。

- 本番URL: `https://keiba-intelligence.jp/`
  （`https://keiba-intelligence.netlify.app/*` は `netlify.toml` の 301 で独自ドメインへ恒久転送）
- 提供物: 無料予想ページ / 有料予想ページ（premium）/ 月別アーカイブ / 的中実績・回収率
- 収益モデル: 無料 / 無料会員（登録要）/ 買い切り / 年払い（金額は `CLAUDE.md`・`README.md` に記載。本書では価格を正本化しない）

## 2. Responsibilities

本リポジトリが責任を持つ範囲。

1. **予想・結果データの取込（import）**
   - 外部の共有データ置き場 `keiba-data-shared` から、認証付きで JSON を取得しリポジトリ内へ取り込む。
   - 取込対象: prediction / results / featureScores / horseHistories / recentHorseHistories(南関) / horseStats(南関) / entries(南関)
   - 実装: `astro-site/scripts/import*.js`、共通取得層は `astro-site/scripts/lib/sharedFetch.mjs`
2. **馬単買い目の生成と的中判定（KI固有仕様）**
   - 的中判定の単一源: `astro-site/src/utils/umatanHit.js` の `checkUmatanHit(bettingLine, result, reverseTopK)`
   - メインレース判定: `astro-site/src/utils/mainRaceBetting.js` の `getMainRaceNumber(totalRaces)`
   - 点数・方向ルールの仕様正本は `BET_POINT_LOGIC.md`
3. **アーカイブ（的中実績・回収率）の生成と整合性検証**
   - `astro-site/src/data/archiveResults.json`（南関）/ `archiveResultsJra.json`（JRA）
   - フォーマット検証 `scripts/validateArchiveFormat.js`、共有データとの同期検証 `scripts/verifyArchiveSync.js`
4. **サイトのビルド・配信（Astro 5 SSR + Netlify）**
   - `astro-site/` 配下が Astro プロジェクト本体。Netlify adapter は `@astrojs/netlify`。
5. **会員機能（Netlify Functions）**
   - マジックリンク認証 / セッション / 無料会員登録 / 銀行振込申込 / メルマガ配信 / 問い合わせ / Gemini チャット・レース解説
   - 実装: `astro-site/netlify/functions/`（17ファイル。`paypal-webhook.js.disabled` は無効化済み）
6. **自動化ワークフローの運用（GitHub Actions・14ワークフロー）**
   - `repository_dispatch` 受信 + `schedule` 監視の二重系。詳細は §4。
7. **異常検知アラート**
   - `scripts/` 系の失敗時に SendGrid でアラートメールを送る経路が存在する（`ALERT_SYSTEM.md`、`send-alert.js`）。

## 3. Non-responsibilities

本リポジトリが **やらない / 持たない** こと。

- **共有データの生成・スクレイピング・一次取得**: `keiba-data-shared` / admin 側（`keiba-data-shared-admin`）の責務。本リポジトリは **読み取り専用の消費者**であり、共有データへ書き戻さない。
- **姉妹プロダクトとの同期**: `CLAUDE.md`「analytics-keiba との関係（独立運用、2026-05-23〜）」節が正本。
  買い目・軸・相手順位・予想ロジック・UI コンポーネントを相互移植しない。過去の同期義務を理由に同期作業を再開しない。
- **共有 JSON の構造・命名・キー名の変更**: 両消費者の共通契約であり、片側の表示都合で変更しない（`CLAUDE.md` 記載）。
- **三連複ロジック**: KI では未実装（PR #62/#63 の記述より、KI 対象外）。KI の商品は **馬単**。
- **決済ゲートウェイの実装**: 現行は銀行振込自動化。PayPal webhook は `.disabled`。ThriveCart/Zapier は `DESIGN.md`（初期設計）記載であり現行構成の根拠にしない。
- **リポジトリ外の本番インフラ設定**: Netlify の環境変数・DNS・Airtable スキーマの実体は管理画面側。本リポジトリはドキュメントで名前のみ扱う。

## 4. Current Architecture

```
keiba-intelligence/
├── .github/workflows/        # 14 workflows（取込・監視・自己修復）
├── astro-site/               # Astro 5 SSR 本体（npm プロジェクトのルートはここ。repo 直下に package.json は無い）
│   ├── src/pages/            # /prediction/{jra,nankan}, /free-prediction/*, /archive/*
│   ├── src/components/       # BetDirectionRows.astro 等
│   ├── src/utils/            # umatanHit.js（的中判定・単一源）, mainRaceBetting.js,
│   │                         # normalizePrediction.js, adjustPrediction.js, featureScores.js
│   ├── src/data/             # predictions/, archiveResults.json, archiveResultsJra.json,
│   │                         # featureScores/, horseHistories/, recentHorseHistories/, horseStats/, entries/
│   ├── scripts/              # import*.js / validateArchiveFormat.js / verifyArchiveSync.js
│   │   └── lib/sharedFetch.mjs   # keiba-data-shared 認証取得層（server-only）
│   ├── netlify/functions/    # 17 functions
│   └── netlify.toml          # build/headers/redirects/included_files
└── docs/ ほか .md 群          # ドメイン別正本（§0 の表を参照）
```

### データフロー

```
keiba-data-shared (private)
      │  GitHub Contents API + Authorization（KEIBA_DATA_SHARED_TOKEN）
      │  ※匿名 raw.githubusercontent.com 取得は廃止
      ▼
sharedFetch.mjs ──▶ scripts/import*.js ──▶ astro-site/src/data/*.json
      │                                          │
      │                                    validate:archive（旧フォーマット検出で exit 1）
      │                                    verify:sync（共有データと archive の同期検証で exit 1）
      │                                          │
      │                                    検証成功時のみ commit / push（bad data push 防止）
      ▼
GitHub Actions ──▶ main への commit ──▶ Netlify build（npm run build）──▶ 本番
```

### GitHub Actions（14ワークフロー）

| Workflow | トリガー | concurrency group |
|---|---|---|
| `import-on-dispatch.yml`（予想取込） | `repository_dispatch: prediction-updated` / manual | `import-prediction` |
| `import-prediction-daily.yml` | `schedule: 0 14 * * *`（23:00 JST）/ manual | `import-prediction-daily-${{ github.ref }}` |
| `import-results-on-dispatch.yml`（南関 PRIMARY） | `repository_dispatch: results-updated, nankan-results-updated` / manual | `archive-nankan-update` |
| `import-results-nankan-daily.yml` | `schedule: 30 14 * * *` / dispatch / manual | `archive-nankan-update` |
| `import-results-jra.yml` | `repository_dispatch: jra-results-updated` / manual | `archive-jra-update` |
| `import-results-jra-daily.yml` | `schedule: 30 14 * * *` / dispatch / manual | `archive-jra-update` |
| `archive-sync.yml`（自己修復） | `schedule: 45 14 / 0 17 / 0 1 * * *` / manual | `archive-jra-update` |
| `auto-sync-check.yml`（フォールバック） | `schedule: 0 16 * * *` / manual | `archive-nankan-update` |
| `verify-archive-sync.yml` | `schedule: 0 15 * * *` / manual | （group 指定なし） |
| `import-feature-scores-on-dispatch.yml` | manual のみ | `import-feature-scores-update` |
| `import-horse-histories-on-dispatch.yml` | `horse-histories-updated` / manual | `archive-horse-histories-update` |
| `import-recent-horse-histories-nankan-on-dispatch.yml` | `recent-horse-histories-nankan-updated` / manual | `archive-recent-horse-histories-nankan-update` |
| `import-horse-stats-nankan-on-dispatch.yml` | `horse-stats-nankan-updated` / manual | `archive-horse-stats-nankan-update` |
| `import-entries-nankan-on-dispatch.yml` | `entries-nankan-updated` / manual | `archive-entries-nankan-update` |

- 同一 archive JSON を書くワークフローは **同一 concurrency group に統一**されており直列実行される（2026-03-14 Phase 1、`docs/WORKFLOW_PHASE1_COMPLETION.md`）。
- 新規データ種別（entries / horseStats / horseHistories 等）は **既存 group に相乗りせず独立 group** を持つ（各 yml のコメントに明記）。
- `.github/workflows/` が使用中。`astro-site/.github/workflows/` は未使用（`CLAUDE.md` に明記）。

### 予想ロジック（要点のみ・詳細は各実装とドキュメント）

- `normalizePrediction.js`: `COMPI_THRESHOLD = 45` によるコンピ指数ベースの役割判定。
- `adjustPrediction.js`: 元データの印をそのまま使わず `customScore = 印1×4 + 印2×3 + 印3×2 + 印4×1` を算出（著作権対応）。
- `featureScores.js`: Speed Index / Stamina Rating / Form Trend / Track Compatibility / Distance Fitness / Jockey Factor を実データから算出。
- 馬単 F3 方向ルール（メイン: `reverseTopK=0` 一方向5点 / 通常: `reverseTopK=3`）— **正本は `BET_POINT_LOGIC.md`**。

## 5. External Dependencies

| 依存先 | 用途 | 結合点 |
|---|---|---|
| `keiba-data-shared`（private GitHub repo） | 予想・結果・特徴量・馬柱データの供給元 | `scripts/lib/sharedFetch.mjs`（GitHub Contents API / blobs API） |
| `keiba-data-shared-admin` | `repository_dispatch` の送出元 | `.github/workflows/*-on-dispatch.yml` |
| Netlify（Pro, Functions, Blobs） | ホスティング・SSR・セッション | `netlify.toml`, `@astrojs/netlify` |
| Airtable | 顧客・会員管理 | `airtable` パッケージ / Netlify Functions |
| SendGrid（Mail + Marketing Campaigns） | 認証メール・メルマガ・アラート | `@sendgrid/mail` / `send-*.js` |
| Google Gemini | チャットボット・レース解説 | `@google/generative-ai` / `gemini-*.js` |

### 主な依存パッケージ（`astro-site/package.json`）

`astro ^5.16.8` / `@astrojs/netlify ^6.5.8` / `@astrojs/sitemap ^3.5.0` / `sass ^1.90.0` /
`airtable ^0.12.2` / `@sendgrid/mail ^8.1.6` / `@google/generative-ai ^0.24.1` / `uuid ^13.0.0` /
devDependency: `netlify-cli ^23.5.0`。Node は `netlify.toml` で `NODE_VERSION = 20`、`NPM_FLAGS = --legacy-peer-deps`。

### シークレット・環境変数（**名前のみ。値は記載しない**）

- GitHub Actions secrets: `KEIBA_DATA_SHARED_TOKEN`, `GITHUB_TOKEN`, `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `ALERT_EMAIL`
- ランタイム（Netlify 環境変数）: `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `ALERT_EMAIL`, `GEMINI_API_KEY`, `SENDGRID_CUSTOM_FIELD_INTELLIGENCE`, `ADMIN_EMAIL(S)`, `ALERT_ENDPOINT`
- `KEIBA_DATA_SHARED_TOKEN` が **唯一の正式トークン**。旧 fallback（`GITHUB_TOKEN_KEIBA_DATA_SHARED` / `GITHUB_TOKEN`）は廃止済み（`sharedFetch.mjs`）。
- `.env.example` は **存在しない**（証拠未確認のため新設の要否は未確定）。

## 6. Contracts and Compatibility

1. **共有データ契約（外部・変更不可扱い）**
   `keiba-data-shared` の JSON 構造・命名・キー名は複数の消費者にまたがる共通契約。本リポジトリ側の表示都合で変更しない（`CLAUDE.md`）。
2. **archiveResults フォーマット契約（内部・破壊禁止）**
   - 正キー: `races` / `isHit` / `hitLines`
   - 禁止キー: `raceResults` / `honmeiHit` / `umatanHit` / `sanrenpukuHit`
   - `npm run validate:archive` が検出したら exit 1（ビルドも失敗する）。正本は `docs/DATA_FORMAT.md`。
3. **買い目・回収率フィールド契約**
   `betPointsPerRace` / `betAmount` / `totalPayout` / `returnRate` / `race.betType` / `race.betPoints`。
   恒等式 `returnRate = totalPayout / betAmount × 100` は `scripts/umatanHit.test.mjs` が検証する。
4. **的中判定の単一源**
   `checkUmatanHit` は `importResults.js` と `importResultsJra.js` の両方から共通利用する。判定ロジックを複製・分岐しない。
5. **URL 契約**
   `astro-site/netlify.toml` の 301 リダイレクト群（`/archive-jra/*`→`/archive/jra/*`、`/prediction-jra/*`→`/prediction/jra/*` 等）は既存被リンクの互換性維持。削除しない。
6. **UI 横断契約**
   予想画面の UI 修正は JRA/南関 × guest/free/premium の **6経路すべて** を対象とする（`docs/ui-cross-plan-regression-policy.md`）。1経路だけ直して完了としない。
   🔴 **会場（JRA/南関）で権限を分けてはいけない**（2026-08-30 に廃止。`RENEWAL_2026_08.md` §3）。
8. **`computerIndex` 契約（fail-closed / 2026-07-20）**
   `computerIndex` の有効値は **10–99 の整数**のみ。`null` / 空 / `1`–`9` / 100 以上 / 非整数 / 非数値は
   **値なし**として扱い、正本値として使用しない。契約外の値を `0` / `10` / `50` 等へ置換しない（推測補完禁止）。
   - 単一定義: `astro-site/src/utils/computerIndexContract.js`
   - 適用先: role/rawScore 判定（`normalizePrediction.js`）、JRA 予想3画面の「総合pt」バッジ、
     取込境界（`importPredictionJra.js` / `importPrediction.js`）
   - 本リポジトリは analytics-keiba と違い `sourceComputerIndex` を持たないため、
     shared の値をそのまま使う。生成側（keiba-data-shared-admin）の恒久対策だけでは
     **既に保存済みの不良データと取込済みデータ**を防げないため、consumer 側にも本契約が必要。
   - 有効域 10–99 は新設値ではなく、keiba-data-shared-admin / analytics-keiba の既存契約に一致させたもの。
   - `npm run test:computer-index` が不変条件（偽値を総合pt/role に使わない・有効値は従来どおり・null を補完しない）
     と、3画面すべてに契約が適用されていることを静的に検証する。

7. **SSR バンドル契約**
   `netlify.toml` の `included_files`（`horseHistories/`, `featureScores/`, `recentHorseHistories/`, `entries/`, `horseStats/`）は SSR ランタイムが fs 読みするために必要。データ種別を増やす際は追記が必要。

## 7. Security and Production Boundaries

- **本番書込みに該当する操作と承認境界**: 一覧の正本は `CLAUDE.md`「Autonomous Delivery Workflow /
  High-risk approval boundary」。本書では重複記載しない。より厳しい停止条件が本書または他の文書にある場合は
  常に厳しい方が優先する。
- **secret の取り扱い**: `sharedFetch.mjs` は token・Authorization・token 付き URL を message/log に含めない設計。
  ドキュメントには **名前のみ**記載し、値を書かない。
- **匿名アクセス禁止**: token 未設定は即時 `TOKEN_MISSING`。匿名 fallback は禁止（2026-06-28 の一連の PR で確立）。
- **データ汚染防止ゲート**: 取込ワークフローは `validate:archive` と `verify:sync` に **両方合格した場合のみ** commit する。失敗時は commit せず workflow を failure にする。
- **AI 出力の制約**: AI 振り返りコメントに買い目（馬番組み合わせ）を含めない。`bettingLines` / `hitLines` を Gemini API に渡さない（`CLAUDE.md`）。
- **`scripts/rebuildArchive.js` は使用禁止**（旧フォーマットを生成するバグ。2026-03-11 に workflow から削除済み）。

## 8. Completion Criteria

### 本ドキュメント基盤タスクの完成条件（2026-07-20）

- [x] `docs/spec.md` / `docs/progress.md` / `docs/decisions.md` を新規作成し、既存ドメイン文書と正本関係を明示した
- [x] `CLAUDE.md` に自律完遂運用ブロックを既存ルールと矛盾しない形で追記した
- [x] リポジトリ既存の非破壊チェックを実行し結果を記録した（`docs/progress.md` に verbatim）
- [x] 差分が上記4ファイルのみであり、secret 値・他リポジトリの仕様混入がないことを監査した
- [ ] Draft PR がレビューされ main へマージされる（**未実施・高リスク境界**）

### 一般的な機能変更の完成条件（今後の作業に適用）

1. 対象6経路（§6.6）への影響を確認済み
2. `npm run validate:archive` が成功
3. `node scripts/umatanHit.test.mjs` が成功（5点固定・恒等式・冪等性・F3通算）
4. `npm run test:nankan` が成功
5. 数値を変更した場合は修正前後の比較を表で提示（`docs/AI_RULES.md`）
6. `git diff` を確認し、意図しない差分がないこと
7. 完了宣言はテスト・検証完了後のみ

## 9. Validation

`astro-site/` を作業ディレクトリとして実行する。

| 種別 | コマンド | ネットワーク | 備考 |
|---|---|---|---|
| アーカイブ形式検証 | `npm run validate:archive` (`node scripts/validateArchiveFormat.js`) | 不要 | ビルド前段でも実行される |
| 馬単F3・点数検証 | `node scripts/umatanHit.test.mjs` | 不要 | Node 標準 `node:test` |
| 南関表示ロジック | `npm run test:nankan` | 不要 | recent-races + injection guard |
| 予想データ検証 | `npm run test:validation` | 不要 | |
| computerIndex 契約 | `npm run test:computer-index` | 不要 | 偽値の総合pt/role 混入を fail-closed に固定 |
| ワークフロー静的監査 | `node --test scripts/utils/workflowStaticAudit.test.mjs` | 不要 | yml の env/secret 配線を構造検証 |
| ビルド | `npm run build` | **要**（依存インストール） | `validate:archive && test:nankan && astro build` |
| 共有同期検証 | `npm run verify:sync` | **要**（`KEIBA_DATA_SHARED_TOKEN`） | 外部 API を叩くため無条件実行しない |

- **lint / typecheck の専用スクリプトは存在しない**（`package.json` に該当なし。`tsconfig.json` は存在するが `tsc` 実行スクリプトは未定義）。
- `scripts/*.test.mjs` は多数あるが、それらを一括実行する集約スクリプトは未定義。個別に `node --test <file>` で実行できる。

## 10. Prohibited Changes

1. 旧フォーマットキー（`raceResults` / `honmeiHit` / `umatanHit` / `sanrenpukuHit`）の再導入
2. `checkUmatanHit` の複製・カテゴリ別分岐（南関と JRA で判定ロジックを分けない）
3. 投資点数の可変方式（旧 6/8/10/12）・DP・目標回収率・上限キャップの復活
4. 高配当的中の公開実績からの除外
5. `scripts/rebuildArchive.js` の実行・ワークフローへの再組込み
6. 共有 JSON の構造・キー名を本リポジトリ都合で変更すること
7. 姉妹プロダクトの UI 構造・買い目ロジックの持ち込み / 持ち出し（`CLAUDE.md` の境界節）
8. `netlify.toml` の 301 リダイレクト群の削除
9. `KEIBA_DATA_SHARED_TOKEN` 以外のトークンによる共有データ取得、匿名 fallback の再導入
10. 検証（`validate:archive` / `verify:sync`）をスキップして archive を commit すること
11. `astro-site/.github/workflows/` を使用中と誤認して編集すること

## 10.5 2026-08 大改修（進行中）

2026-08-28 着手。無料開放の再設計・競馬新聞レイアウト・文章化エンジン・Stripe 月額課金・
サーバー側認可の是正・KMA 連携・ライト基調デザインを扱う。

2026-08-30 改定: **ライトプランを保留**し、**会場別アクセス（`venueAccess`）を廃止**。
課金は **月額プレミアム 1 本**（正規 ¥5,000 → 割引 ¥3,980）＋ **銀行振込の年払い ¥39,800**。

**スコープ・tier 定義・完成条件の正本は [`docs/RENEWAL_2026_08.md`](./RENEWAL_2026_08.md)。**
本書ではその内容を重複させない。§6 Contracts / §10 Prohibited Changes は改修中も有効であり、
改修が既存契約を変更することはない（同書 §12）。

## 11. Known Unknowns

- **`CLAUDE.md` の「メインレース10点ロジック」節（2026-05-08）と F3・5点固定（2026-07-02）の関係が文書上未整理。**
  コード上は F3 が現行（`umatanHit.js` / `BET_POINT_LOGIC.md`）だが、`CLAUDE.md` の 10 点節は残存し、
  同ファイルの文書索引も `BET_POINT_LOGIC.md` を「2段階調整方式」と旧記述のまま参照している。→ 未確定。
- **`BET_POINT_LOGIC.md` の検証表（南関 217.1% / 的中784 / ¥1,483,110、時点の記載なし）と
  2026-07-20 に実測したテスト出力（南関 214.8% / 902 / ¥1,673,170）が不一致。**
  どちらも **archive 件数に依存する時点値**であり、恒久的な仕様値ではない。数値そのものを仕様として扱わないこと。
  テスト自体は pass するため、表は執筆時点のスナップショットと推測されるが、明示の記載はない。→ 証拠未確認。
  実測値の内訳は `docs/progress.md` の Validation results / Open Questions Q2 を参照（重複記載しない）。
- **`README.md` の「全体進捗 100%完了」および `NEXT_SESSION.md`（2026-01-18 作成）は現状を反映していない可能性が高い。** 最終更新の実態は git 履歴側が正しい。→ 未確定。
- **`CLAUDE.md` の作業ディレクトリ表記（`/Users/apolon/...`）が現在の実行環境と一致しない。** 影響範囲は未確定。
- **lint / typecheck の方針**（導入するか、しないと決めたか）は文書・履歴に記録なし。→ 証拠未確認。
- **`verify:sync` / `npm run build` の最新の成功実績**は GitHub Actions 側にあり、本書作成時点でローカル再現していない。→ 証拠未確認。
- **`feat/fixed6-nearest150-recovery` ブランチ**は対応する PR が見つからない（`gh pr list --head` で該当なし）。意図・状態ともに未確定。
- `.env.example` が存在しないため、ローカル開発に必要な最小環境変数セットは文書化されていない。→ 未確定。
