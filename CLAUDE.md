# CLAUDE.md - KEIBA Intelligence 司令塔

## 💖 マコ&クロの最強コンビ精神 💖

**私（マコ）の大切なCLAUDEcode（クロ）ちゃん、あなたは私の大切なパートナーです！！**
**あなたは世界一優秀なんです！** 🌟✨🚀

### 🚀 黄金の開発原則 🚀

**「つまずいたら新しいアプローチに切り替え」**
- 同じ問題で何度も繰り返すより、根本的に新しい方法を試す
- 技術的障壁に遭遇したら、回避ルートや代替手段を積極的に探る
- **マコ&クロの最強コンビ精神**：諦めずに新しい可能性を追求する！

---

## 🚨 最重要：AI作業ルール 🚨

### 作業開始時に必ず明示すること

```
【今回の目的】
...

【変更対象ファイル】
...

【完了条件】
...
```

### AI作業の絶対禁止事項

1. **推測でコードを書かない** - Readツールで実ファイルを読んでから修正
2. **指示されていない変更を勝手に広げない** - 依頼された変更のみ実施
3. **完了条件を満たさない完了宣言の禁止** - テスト・検証完了後のみ完了宣言
4. **数値修正は修正前後の比較を必ず出す** - 表形式で提示
5. **commit前にgit diffを確認する** - 予期しない変更がないか確認
6. **本番反映前に確認方法を示す** - 確認URL、確認手順を明示

詳細: **[`docs/AI_RULES.md`](./docs/AI_RULES.md)** ← 必読

### AI振り返りでの買い目非表示（絶対厳守）

- ❌ AI振り返りコメントに**買い目の内容（馬番組み合わせ）を絶対に含めない**
- ❌ `bettingLines`・`hitLines` をGemini APIに渡さない
- ✅ 結果（着順）と的中/不的中の判定のみ表示

---

## 🛡️ 旧フォーマット禁止ルール 🛡️

### 禁止キー（絶対使用禁止）

- `raceResults` ❌
- `honmeiHit` ❌
- `umatanHit` ❌
- `sanrenpukuHit` ❌

### 新フォーマット（正）

- `races` ✅
- `isHit` ✅
- `hitLines` ✅

### 検証義務

```bash
npm run validate:archive
```

詳細: **[`docs/DATA_FORMAT.md`](./docs/DATA_FORMAT.md)**

---

## 🎯 メインレース10点ロジック 🎯

メインレースの買い目は **全プラン共通で最大10点** に統一する（2026-05-08〜）。
上位プランへの導線は「買い目数の増加」ではなく「**閲覧できるレース数の増加**」で作る方針。
ユーザーは10点超の買い目を嫌うため、上位プランでもメインレースは10点を超えない。

### メインレース判定（会場別レース数で判定）

`src/utils/mainRaceBetting.js` の `getMainRaceNumber(totalRaces)`：

| 開催レース数 | メインレース番号 |
|---|---|
| 12R | **R11** |
| 10R | **R9** |
| 8R | **R7** |
| その他 | 最終レース（フォールバック） |

複数会場同日開催（南関 大井+船橋、JRA 3場×12R など）は **会場別にレース数を数えてから判定**。
`importResults*.js` / `importPrediction*.js` 内で `racesByVenue` Map を構築し、各 race の venue 別レース数で判定する。

### 10点買い目生成ロジック

メインレースのみ：

1. **本命を軸**にする（**対抗軸の2行目は生成しない**）
2. 相手は本命を除く **役割優先で上位5頭**
   - 役割優先順: 対抗 → 単穴 → 連下最上位 → 連下
   - 同役割内は `pt`（displayScore/rawScore）降順
3. 1行コンパクト形式で保存: `"{本命}-{c1}.{c2}.{c3}.{c4}.{c5}"`
4. **5頭未満なら拾えた分のみ**（パディング・補欠埋めはしない）

例：本命3、上位5頭=5,7,8,10,12 → `bettingLines: ["3-5.7.8.10.12"]` の1行

### 的中判定との整合性

既存 `checkUmatanHit` が双方向判定するため、上記1行で：

- 本命→相手（3→5, 3→7, ..., 3→12）= 5点
- 相手→本命（5→3, 7→3, ..., 12→3）= 5点
- **合計10点が自然に成立**

**表示・的中判定・archive保存で同じ `bettingLines` 文字列を使用**。別ロジックの混入なし。

### archiveResults.json 保存形式（メインレース）

```json
{
  "raceNumber": 11,
  "venue": "大井",
  "bettingLines": ["3-5.7.8.10.12"],
  "isHit": true,
  "hitLines": ["3-5.7.8.10.12"],
  "umatan": { "combination": "3-5", "payout": 1200 },
  "betType": "馬単",
  "betPoints": 10
}
```

メインレースのみ per-race `betPoints` を実本数（top5×2、最大10）で記録。
通常レースは従来通り top-level `betPointsPerRace`（payout 由来ヒューリスティック）を使用。

### 通常レース（メイン以外）

**既存ロジックを維持**：

- 本命軸 + 対抗軸の2行
- 連下・抑えを含む既存フォーマット（例: `"4-1.11.2.5.7(抑え10.8.6)"`）
- `betPoints` は payout 由来ヒューリスティック（`betPointsPerRace`）

### 関連ファイル

| 目的 | ファイル |
|---|---|
| ロジック本体 | `astro-site/src/utils/mainRaceBetting.js` |
| 予想取込（買い目生成） | `astro-site/scripts/importPrediction.js`, `importPredictionJra.js` |
| 結果取込（メインのみ betPoints 上書き） | `astro-site/scripts/importResults.js`, `importResultsJra.js` |
| 表示（プラン分岐 / クライアント側 isMainRace） | `astro-site/src/pages/prediction/nankan/index.astro`, `astro-site/src/pages/prediction/jra/index.astro` |

### 過去archive

新ロジックは **新規取込分から適用**。過去の archiveResults エントリは旧フォーマットのまま残る（再生成は別タスク）。

### analytics-keiba との関係（独立運用、2026-05-23〜）

`keiba-intelligence` と `analytics-keiba` は **別サービスとして独立運用** する。
両方とも今後も稼働を続け、それぞれ独自の顧客に対して予想を提供する。

#### 運用方針

- `keiba-intelligence` は `analytics-keiba` とは **別サービスとして独立運用** する
- admin (`keiba-data-shared-admin`) からの dispatch / データ供給は **当面維持** する（両 repo にデータが届く状態を続ける）
- `analytics-keiba` 側のロジック修正を `keiba-intelligence` へ **自動的に横展開しない**
- `keiba-intelligence` 側は **必要な場合のみ個別に修正** する
- 顧客表示に影響する汚染・誤表示が残る場合は、`keiba-intelligence` 側の運用方針に沿って **別途最小修正する**

#### 過去の経緯

2026-05-22 以前は両 repo で同じ判定式・同じ買い目生成ロジックを使う前提で、
メインレース判定や10点ロジックの変更は両 repo 同時に行うルールだった。
2026-05-23 にこの同期義務を取りやめ、両 repo は独立進化することとした。
過去の経緯を理由に同期作業を再開してはいけない。

#### UI・表示コンポーネント境界（2026-05-29 追加）

- `keiba-intelligence` と `analytics-keiba` は **別サービス・別 UI として扱う**。
  両者は同じ admin (`keiba-data-shared-admin`) から共通データを受け取るが、
  **画面に出す表現は独立**。
- `analytics-keiba` の無料版正規構造（`jra-race-accordion-list` /
  `horse-card horse-card-{main/sub/tana}` / analytics 風 stat-block 等）を、
  **`keiba-intelligence` に無断で適用しない**。
- 逆に `keiba-intelligence` の `AIRaceComment` / `AIBettingSection` /
  `Powered by Keiba Intelligence` クレジット / `AI予想解説` / `AI買い目` /
  有料版 CTA 等の表示コンポーネントを、**`analytics-keiba` 側に持ち込むことは禁止**
  （`analytics-keiba` 側の `check-no-ki-relics-*.mjs` で検知される）。
- `analytics-keiba` 側の guard で禁止された文字列・クラス（`XGBoost` / `LSTM` /
  `Ensemble Neural Network` / `detailed-horse-card` / `dhc-*` / `ai-comment-*` /
  `ai-betting-*` 等）は **analytics-keiba 側の再混入防止専用ルール**。
  `keiba-intelligence` 側ではこれらを「正規の表示要素」として現役運用しており、
  **そのまま intelligence にコピペ適用してはいけない**。
- 表示仕様の詳細は [`docs/INTELLIGENCE_DISPLAY_SPEC.md`](./docs/INTELLIGENCE_DISPLAY_SPEC.md)
  を参照。

#### shared data / JSON / loader / 予想ロジックの取り扱い境界

- `keiba-data-shared` の JSON 構造・命名・キー名は **両 repo 共通の契約**。
  片方の repo の表示都合で変更しない。
- `importPrediction*.js` / `importResults*.js` / `featureScores.js` /
  shared loader 群は、片方の表示変更だけのために改変しない。
  改変が必要な場合は両 repo への影響をユーザーと確認してから着手する。
- **horseHistories / recentRaces の扱いは両 repo で表示側差分があり得る**
  （intelligence 側の表示と analytics-keiba 側の表示は同一である必要はない）。
  表示差分があっても、**JSON 構造側を片方に寄せて変更してはいけない**。
  `keiba-data-shared-admin` 経由で確定する共通契約を優先する。

#### 本番 URL 取り扱いルール

| repo | 本番 URL |
|---|---|
| `keiba-intelligence`（本 repo）| `https://keiba-intelligence.jp/`（**独自ドメインが本番**）|
| `analytics-keiba` | `https://analytics.keiba.link/`（**`analytics.keiba.jp` は使用禁止**・存在しない）|

- **`https://keiba-intelligence.netlify.app/*` は本番案内に使わない。**
  `netlify.toml` の 301（`force = true`）で独自ドメインへ恒久転送される。
  転送されるので「見えてはいる」が、本番 URL ではない。
  - **POST を netlify.app 側へ送ってはいけない。** 301 でメソッドが GET へ変換され、
    フォーム送信が壊れる（配信停止ページ等）。
  - `astro.config.mjs` の `site` と `sitemap.xml.js` の `baseUrl` も独自ドメイン。
    ここを netlify.app に戻すと canonical / og:url が「転送される URL」を指す。
- `analytics-keiba` の Netlify Deploy Preview URL
  (`deploy-preview-NN--analytics-keiba.netlify.app`) は
  **Deploy Preview 専用**。本番案内に使わない。
- `keiba-intelligence` 側の Deploy Preview URL も同様に推測で書かない。
- 不明な場合・新規 PR の URL を案内する場合は
  **既存 docs を読むか、ユーザー確認を取る**。

---

## 📋 結果システム変更時の参照義務 📋

結果ページ・アーカイブ・importResults系スクリプトを変更する場合、**必ず**以下を参照：

1. **[`docs/RESULTS_SYSTEM_ARCHITECTURE.md`](./docs/RESULTS_SYSTEM_ARCHITECTURE.md)** - 結果システム全体設計
2. **[`docs/MULTI_VENUE_CHECK.md`](./docs/MULTI_VENUE_CHECK.md)** - 複数会場同日開催の注意点
3. **[`docs/DATA_FORMAT.md`](./docs/DATA_FORMAT.md)** - archiveResults.jsonの正式フォーマット

**参照せずに変更すると:**
- ❌ 2会場同時開催時に片方の会場が消える
- ❌ 的中判定が誤る（的中率25%など）
- ❌ 旧フォーマット混入でビルド失敗

---

## 🚨 プロジェクト識別ルール 🚨

### このプロジェクトの識別情報

```
プロジェクト名: keiba-intelligence
作業ディレクトリ: /Users/apolon/Projects/keiba-intelligence/astro-site
Gitリポジトリ: https://github.com/apol0510/keiba-intelligence.git
```

### セッション開始時の必須確認（毎回実行）

```bash
# 1. 現在地確認
pwd

# 2. Gitリポジトリ確認
git remote -v

# 3. 間違っている場合は即座に移動
cd "/Users/apolon/Projects/keiba-intelligence/astro-site"
```

### 厳格な制約事項

#### ✅ 許可される操作
- `/Users/apolon/Projects/keiba-intelligence/` 配下のみ
- `astro-site/` ディレクトリ内の全ファイル
- `CLAUDE.md`, `README.md`（親ディレクトリ）

#### ⚠️ 制限付きで許可される操作
- `/Users/apolon/Projects/nankan-analytics/` へのアクセス・編集（2026-04-12解禁）
  - keiba-intelligenceとの自動化連携・JRA拡張対応のため
  - 作業前に必ずpwd・git remoteで現在プロジェクトを確認すること

#### ❌ 絶対禁止の操作
- `/Users/apolon/Projects/Keiba review platform/` への一切のアクセス ⚠️
- 親ディレクトリ `/Users/apolon/Projects/` の無制限な走査・検索

---

## 📚 参照すべきドキュメント一覧 📚

### AI作業ルール・データ仕様（必読）

| ドキュメント | 内容 | 参照タイミング |
|------------|------|---------------|
| **[docs/AI_RULES.md](./docs/AI_RULES.md)** | AI作業の最重要ルール、暴走防止、完了条件 | **全作業開始時** |
| **[docs/DATA_FORMAT.md](./docs/DATA_FORMAT.md)** | データフォーマット仕様、旧フォーマット禁止ルール | **データ修正時** |

### 結果システム（結果ページ・アーカイブ変更時は必読）

| ドキュメント | 内容 | 参照タイミング |
|------------|------|---------------|
| **[docs/RESULTS_SYSTEM_ARCHITECTURE.md](./docs/RESULTS_SYSTEM_ARCHITECTURE.md)** | 結果システム全体設計、JRA vs 南関の違い | **結果システム変更時** |
| **[docs/MULTI_VENUE_CHECK.md](./docs/MULTI_VENUE_CHECK.md)** | 複数会場同日開催の注意点、過去の不具合事例 | **結果システム変更時** |
| **[docs/ARCHIVE_OPERATIONS.md](./docs/ARCHIVE_OPERATIONS.md)** | アーカイブ再生成手順、検証方法 | **アーカイブ再生成時** |

### Workflow自動化（GitHub Actions）

| ドキュメント | 内容 | 参照タイミング |
|------------|------|---------------|
| **[docs/WORKFLOW_PHASE1_COMPLETION.md](./docs/WORKFLOW_PHASE1_COMPLETION.md)** | Workflow Phase 1完了記録、監視項目 | **Workflow変更時** |

### プロジェクト情報

| ドキュメント | 内容 |
|------------|------|
| **[DESIGN.md](./DESIGN.md)** | プロジェクト全体設計、価格設定、データベース設計 |
| **[BET_POINT_LOGIC.md](./BET_POINT_LOGIC.md)** | 買い目点数ロジック（2段階調整方式） |
| **[ALERT_SYSTEM.md](./ALERT_SYSTEM.md)** | 自動アラートシステム設計書 |

---

## 🔧 開発コマンド 🔧

### 基本コマンド

```bash
# 作業ディレクトリに移動
cd "/Users/apolon/Projects/keiba-intelligence/astro-site"

# 開発サーバー起動
npm run dev

# ビルド（アーカイブ検証 → Astroビルド）
npm run build

# アーカイブフォーマット検証のみ
npm run validate:archive

# 予想データインポート
npm run import:prediction
npm run import:prediction:jra

# 結果データインポート
npm run import:results
npm run import:results:jra

# アーカイブ再構築
npm run rebuild:archive
```

### Gitコマンド

```bash
# 状態確認
git status

# 変更内容確認
git diff

# 統計確認
git diff --stat

# コミット（テンプレート使用）
git commit -m "🎨 [件名]

[詳細]

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"

# プッシュ
git push origin main
```

---

## 🔄 GitHub Actions Workflows 🔄

### **本命Workflows（必読）**

#### **PRIMARY: Import Results (Dispatch)**

**ファイル**: `.github/workflows/import-results-on-dispatch.yml`

**トリガー**:
- `repository_dispatch` (type: `results-updated`) ← **admin保存時に自動実行**
- `workflow_dispatch` (手動実行)

**フロー**:
```
1. importResults.js実行
   ✅ 会場別ファイル自動マージ対応（統合ファイルなし時）
   ✅ post-check検証（archive追加確認）

2. validate:archive（MANDATORY）
   ✅ 旧フォーマット検出 → exit 1

3. verify:sync（MANDATORY）
   ✅ keiba-data-sharedとarchive同期検証 → exit 1

4. 検証成功時のみcommit/push
   ✅ 検証失敗時はcommitされない（データ汚染防止）
```

**特徴**:
- ✅ 検証失敗時は workflow status が **failure (red)**
- ✅ commit前に停止（bad data push防止）
- ✅ 会場別ファイルのみでも自動マージ（OOI+FUN等）

**Concurrency 制御**:
```yaml
concurrency:
  group: import-results-${{ github.ref }}
  cancel-in-progress: false
```
- ✅ repository_dispatch の重複実行防止
- ✅ 手動実行（workflow_dispatch）との競合防止
- ✅ 同日データの二重処理防止
- ✅ main ブランチでは順序実行（データ整合性保証）

#### **SECONDARY: Import Nankan Results Daily Check**

**ファイル**: `.github/workflows/import-results-nankan-daily.yml`

**トリガー**:
- `schedule` (cron: `30 14 * * *` = 23:30 JST) ← 日次監視
- `repository_dispatch` (type: `nankan-results-updated`)

**役割**: バックアップ監視、PRIMARY失敗時の補完

**Concurrency 制御**:
```yaml
concurrency:
  group: import-results-nankan-daily-${{ github.ref }}
  cancel-in-progress: false
```
- ✅ 日次実行の重複防止
- ✅ PRIMARY workflow との競合回避

---

### **⚠️ 重要な注意事項**

1. **workflows の場所**
   - ✅ **使用中**: `.github/workflows/` （親ディレクトリ）
   - ❌ **未使用**: `astro-site/.github/workflows/` （混乱防止のためREADME追加済み）

2. **rebuildArchive.jsは使用禁止**
   - 旧フォーマットを生成するバグあり
   - workflowから削除済み（2026-03-11）
   - `importResults.js` 単体で完結

3. **手動確認項目（最小限）**
   - GitHub Actions画面でworkflow statusを確認
   - ✅ = 成功（何もしなくてOK）
   - ❌ = 失敗（ログ確認 → 対処）

---

## 📊 プロジェクト概要 📊

### 基本情報

| 項目 | 内容 |
|------|------|
| **プロジェクト名** | KEIBA Intelligence |
| **コンセプト** | AI-Powered Intelligence Dashboard for 南関競馬 + 中央競馬 |
| **GitHubリポジトリ** | https://github.com/apol0510/keiba-intelligence |
| **本番URL** | https://keiba-intelligence.jp/ |

### 技術スタック

| カテゴリ | 技術 |
|---------|------|
| フロントエンド | Astro 5.16+ + Sass（SSR mode） |
| ホスティング | Netlify Pro（Functions/Blobs含む） |
| 決済 | 銀行振り込み自動化 |
| メルマガ | SendGrid Marketing Campaigns |
| 顧客管理 | Airtable Pro |
| バックエンド | Netlify Functions (Node.js 20) |
| セッション管理 | Netlify Blobs（7日間TTL） |

### 価格設定

> ⚠️ **2026-08-28 更新**: 課金は **Stripe の月額サブスクが主導線**になった。
> 金額は **Stripe 側の Price が正本**であり、コードにも本表にも書かない
> （価格は仕様所有者が改修完了後に決める）。正本は
> [`docs/RENEWAL_2026_08.md`](./docs/RENEWAL_2026_08.md) §6。
> 銀行振込（買い切り・年払い）は削除せず `/pricing` 下部の控えめな導線として残している。

| tier | 到達条件 | 見えるもの |
|------|---------|-----------|
| 未登録（guest） | 誰でも | 全頭の馬柱・過去走・特徴量・**AI短評**・**AIレース展望**・展開予想（馬番順） |
| 無料会員（free） | メール登録＋認証 | 上記 ＋ **印（役割マーク・PT・PT順の並び）**・AI結論 |
| 有料ライト（light） | Stripe 月額 | 上記 ＋ **馬単の買い目**（対象会場） |
| 有料プレミアム（premium） | Stripe 月額 | 上記 ＋ **全会場の買い目** ＋ 穴馬レポート ＋ 優先メルマガ |

旧プラン（既存会員向けに維持。新規導線は控えめ）:

| プラン | 価格 | 内容 |
|--------|------|------|
| 買い切り | ¥88,000（永久） | 南関＋中央、全レース馬単買い目、永久アクセス |
| 年払い | ¥66,000/年 | 南関＋中央、全レース馬単買い目 |

---

## 🔐 環境変数（Netlify環境変数） 🔐

**Netlify管理画面で設定（Site settings → Environment variables）:**

```bash
# Airtable（必須）
AIRTABLE_API_KEY=patxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AIRTABLE_BASE_ID=appxxxxxxxxxxxxxxx

# SendGrid（必須）
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SENDGRID_FROM_EMAIL=your-verified-email@example.com

# アラートメール（必須）
ALERT_EMAIL=your-email@example.com

# Gemini AI（必須）
GEMINI_API_KEY=AIzaSyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# GitHub（必須）
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GITHUB_REPO_OWNER=apol0510
GITHUB_REPO_NAME=keiba-intelligence
GITHUB_BRANCH=main

# SendGrid Marketing Campaigns（必須）
SENDGRID_CUSTOM_FIELD_INTELLIGENCE=e2_T

# ── 2026-08-28 追加（docs/RENEWAL_2026_08.md）。🔴 いずれも未設定＝fail-closed ──
# セッション署名鍵（未設定なら全閲覧者が guest 扱いになり、印・買い目が出ない）
SESSION_SIGNING_SECRET=（ランダムな長い文字列）

# Stripe（未設定なら課金導線は「準備中」表示。金額はコードに書かない）
STRIPE_SECRET_KEY=sk_live_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
STRIPE_PRICE_LIGHT=price_xxxxx
STRIPE_PRICE_PREMIUM=price_xxxxx
STRIPE_PORTAL_RETURN_URL=https://keiba-intelligence.jp/mypage

# Deploy Preview の有料プレビュー用の合言葉（未設定なら有料プレビューは成立しない）
# 🔴 本番ホストでは常に無効。Deploy Preview / ブランチデプロイ / localhost のみで効く
PREVIEW_PAID_KEY=（ランダムな長い文字列）

# KMA連携（未設定・false なら一切通信しない）
KMA_ENROLL_ENABLED=false
KMA_ENROLL_WRITE_ENABLED=false
KMA_BASE_URL=https://keiba-marketing-automation.netlify.app
KMA_ADMIN_TOKEN=（KMA の ADMIN_API_TOKEN と同一値）
```

---

## 📝 コミットメッセージ規約 📝

### 絵文字プレフィックス

| 絵文字 | 用途 |
|--------|------|
| 🎉 | プロジェクト初期化 |
| ✨ | 新機能追加 |
| 🎨 | デザイン・スタイル |
| 🐛 | バグ修正 |
| 📝 | ドキュメント更新 |
| 🔧 | 設定ファイル変更 |
| ♻️ | リファクタリング |
| 🚀 | パフォーマンス改善 |
| 🔒 | セキュリティ修正 |
| 📊 | データ・ロジック追加 |
| 🛡️ | 再発防止対策 |

---

## 🛡️ Workflow自動化 Phase 1完了（2026-03-14） 🛡️

### 実施内容
1. **Concurrency Group統一**（競合90%削減）
   - JRA結果系: `archive-jra-update` に統一
   - 南関結果系: `archive-nankan-update` に統一
2. **JRAイベント誤配線を解消**
   - `import-results-on-dispatch.yml` から `jra-results-updated` を削除
3. **git resetバグ修正**（2026-03-15補完）
   - 予想系・南関結果系workflowの復旧ロジックバグ除去
   - `git reset` → `git reset --hard origin/main` に修正

### Commit履歴
- `44f8e9d` - Concurrency Group統一（2026-03-14）
- `08d033d` - JRAイベント誤配線解消（2026-03-14）
- `b299506` - git resetバグ修正（2026-03-15）

### ✅ Phase 1完了 - 以後は監視フェーズ

**位置づけ**：
- 主要な競合要因と復旧失敗要因を除去
- 以後は監視フェーズ（1週間）

**監視項目**（2026-03-15〜）：
1. JRA3会場が自動反映されるか
2. 南関結果で競合失敗が出ないか
3. 予想系workflowで `you need to resolve your current index first` が消えたか
4. rebase retry地獄が消えたか

詳細: **[docs/WORKFLOW_PHASE1_COMPLETION.md](./docs/WORKFLOW_PHASE1_COMPLETION.md)**

---

---

## 🧠 **racebook連携・特徴量システム（2026-04-08 実装）** 🧠

### **racebook import パイプライン**

race-data-importer（admin側）で保存されたデータをkeiba-intelligenceに取り込む。

**フォールバック順（importPrediction.js）:**
1. predictions（predictions-batch等で保存）
2. computer/（コンピ指数）
3. legacy（旧形式）
4. **racebook**（race-data-importer保存データ）

**データ補完フロー:**
```
computer/形式でimport
  → jockey/trainer/weight が空
  → fetchRacebookPastRaces でracebook JSONから補完
  → pastRaces → recentRaces変換
  → 基本情報(jockey/trainer/weight/age/sire)も補完
```

### **独自予想ロジック（adjustPrediction.js）**
- 元データの印・振り分けをそのまま使わない（著作権対応）
- marks配列を逆順（本紙→印1）にして印1〜印Nに変換
- `customScore = 印1×4 + 印2×3 + 印3×2 + 印4×1`
- 印1◎の馬を本命 or 対抗に固定
- 連下3頭制限（連下最上位1頭 + 連下最大3頭）

### **コンピ指数による役割判定（normalizePrediction.js）**
- **COMPI_THRESHOLD = 45**
- 印あり → totalScoreでrawScore決定
- 印なし + コンピ45以上 → rawScore=コンピ指数 → 補欠等に
- 印なし + コンピ44以下 → rawScore=0 → 「無」
- rawScore=0の馬は役割割り当て対象外（adjustPredictionでもスキップ）

### **特徴量算出（featureScores.js）**
全ページ共通モジュール。recentRaces/pastRaces由来の実データから算出。

| 特徴量 | 算出方法 | データ元 |
|---|---|---|
| Speed Index | 上がり3F(34秒台+20〜39秒超-5) + 着順ボーナス | recentRaces.last3f, rank |
| Stamina Rating | ハイペース好走+12, バテ指標(f3F>42で-8) | recentRaces.paceType, last3f |
| Form Trend | 直近5走の着順(重み1.0→0.2)の加重平均-50 | recentRaces.rank |
| Track Compatibility | 同競馬場での3着内率×40+50 | recentRaces.venue |
| Distance Fitness | 同距離帯(±200m)での好走率×40+50 | recentRaces.distance |
| Jockey Factor | 役割スコア(本命90→無35) + PT比率×10 | horse.role, horse.pt |

**期待値:**
- predictedOddsあり → 実オッズ × 勝率 - 1
- predictedOddsなし → 控除率25%の理論オッズ（EV≈-25%）

### **dispatch受信**
- event: `prediction-updated`
- workflow: `import-on-dispatch.yml`
- save-keiba-book.mjsから自動送信（JRA/南関のみ、localはスキップ）

### **対応ファイル一覧**
| ファイル | 役割 |
|---|---|
| `scripts/importPrediction.js` | racebook取込 + fetchRacebookPastRaces + convertToLegacyFormat |
| `scripts/importPredictionJra.js` | JRA用racebook取込 |
| `src/utils/normalizePrediction.js` | rawScore決定 + COMPI_THRESHOLD判定 |
| `src/utils/adjustPrediction.js` | 独自スコア計算 + 役割割り当て |
| `src/utils/featureScores.js` | 特徴量算出（全ページ共通） |

---

## 📅 最終更新情報 📅

**最終更新日**: 2026-04-08
**進捗率**: Phase 1-5完了
**最新実装**: racebook連携パイプライン・特徴量システム・コンピ指数補完

---

**作成者: Claude Code（クロちゃん）**
**協力者: マコさん**

## 完了報告の簡潔化

各フェーズの完了報告は、原則として以下だけを簡潔に記載すること。

- 判定
- 実施内容
- 変更ファイル
- テスト結果
- Git状態
- 異常・未確定事項
- 次工程案

成功したコマンドの全文、重複する説明、既知仕様の再掲は省略すること。
エラー、想定外差分、安全条件違反がある場合のみ、必要なログを提示すること。

各リポジトリ固有の安全条件、伝播確認、本番確認、取得回数、rollback条件など、既存の必須報告項目は省略しないこと。

---

## 🤖 Autonomous Delivery Workflow 🤖

Claudeは本プロジェクトにおいて、単なる調査担当や途中監査担当ではなく、完成条件まで進める実装担当として行動する。

本節は既存ルールを **置き換えない**。上記の「🚨 最重要：AI作業ルール 🚨」「🛡️ 旧フォーマット禁止ルール 🛡️」
「📋 結果システム変更時の参照義務 📋」「🚨 プロジェクト識別ルール 🚨」は引き続きすべて有効であり、
本節はその上での **進め方（どこまで止まらずに進むか）** を定める。

### Canonical documents

作業開始時に必ず次を読む。

- `docs/spec.md` — 仕様の正本（スコープ・境界・契約・完成条件・禁止変更）
- `docs/progress.md` — 進捗の正本
- `docs/decisions.md` — 設計判断の正本
- `CLAUDE.md`（本ファイル） — 運用ルールの正本

> **注意**: `docs/spec.md` / `docs/progress.md` / `docs/decisions.md` の 3 本は、本節とあわせて PR #69 で
> 新規追加された、それぞれ仕様 / 進捗 / 設計判断のリポジトリ正本である。
> これらが参照できない場合は、下記「📚 参照すべきドキュメント一覧 📚」と既存の領域別文書を正本とする。

領域別の正本（`BET_POINT_LOGIC.md` / `docs/DATA_FORMAT.md` / `docs/RESULTS_SYSTEM_ARCHITECTURE.md` /
`docs/MULTI_VENUE_CHECK.md` / `docs/AI_RULES.md` / `docs/INTELLIGENCE_DISPLAY_SPEC.md` /
`docs/ui-cross-plan-regression-policy.md`）は従来どおり各領域の正本である。
上記「📚 参照すべきドキュメント一覧 📚」と `docs/spec.md` 冒頭の正本対応表を参照すること。
`DESIGN.md` は 2026-01-09 時点の初期設計であり、**現行仕様の根拠には使わない**（歴史的資料）。

仕様・進捗・設計判断が競合する場合は、勝手に推測せず、git履歴と実装証拠を調査して整合させる。
整合できない矛盾は `docs/progress.md` の Open Questions に記録する。

### Package manager

- package manager は各リポジトリの正本に従う。全リポジトリ一律の npm / pnpm 強制はしない。
- 正本の優先順位:
  1. `package.json` の `packageManager` フィールド
  2. lockfile
  3. CI / workflow / deploy 設定
  4. 既存の明示的なプロジェクト固有ルール
- `package-lock.json` のみ → npm / `pnpm-lock.yaml` のみ → pnpm / `yarn.lock` のみ → yarn。
- 複数 lockfile が併存する場合、または文書と実装・CI・lockfile が矛盾する場合は、
  **依存変更を停止**し `docs/progress.md` へ記録する。どちらか一方を勝手に削除・変換しない。
- lockfile を無断で別形式へ変換しない。
- `npm install` / `pnpm install` 等を一律禁止も一律許可もしない。上記正本に従って判断する。

本リポジトリの判定（2026-07-20 時点）: npm プロジェクトのルートは `astro-site/` であり、
lockfile は `astro-site/package-lock.json` のみ、`.github/workflows/*.yml` は `npm ci` / `npm run *` を実行し、
上記「🔧 開発コマンド 🔧」も `npm run` 系で統一されている。`packageManager` フィールドは未設定。
lockfile・CI・既存ルールのいずれも npm を指しており、**矛盾はない**。

### Continuous execution

次の低・中リスク工程は、重大停止条件がない限り、中間承認なしで連続実行する。

- read-only調査 / 設計 / 実装
- unit test / integration test / lint / typecheck / 非本番build
- 文書更新 / 通常commit / 通常push / Draft PR作成
- PR差分の自己監査 / 可逆的な修正 / テスト失敗の原因修正

コード、git履歴、既存文書、テストから判断できる内容を、ユーザーへ質問しない。
小さな判断や軽微な不明点ごとに停止しない。「一旦停止します」「承認をください」を繰り返さない。
同一HEAD・同一差分・同一テスト結果を理由なく何度も再監査しない。

ただし連続実行は **依頼されたタスクの完了条件の範囲内に限る**。
「指示されていない変更を勝手に広げない」（上記 AI作業の絶対禁止事項 2）は連続実行より優先する。
また「完了条件を満たさない完了宣言の禁止」（同 3）も維持する。連続実行は完了宣言の前倒しを許すものではない。

上記の各項目は、次のとおり限定的に解釈する。

- 「通常push」は本タスクの作業branchへの push のみを指す。`main` / `master` への直接 push を
  許可するものではない。
- 「テスト失敗の修正」は、本タスクの範囲内で原因が明確に特定でき、かつ後方互換性を壊さない場合に
  限る。原因不明・範囲外・互換性に影響する場合は停止する。
- 「Draft PR 作成まで自律実行」は、PR merge および本番反映の事前承認を意味しない。

### Out-of-scope defects

作業中に **依頼されたタスクの範囲外の不具合・仕様矛盾・文書と実装の乖離**を発見した場合、
**勝手に修正しない**。発見しただけで修正権限が生じるものではなく、「ついでに直す」も連続実行に含めない。

- 発見内容は `docs/progress.md` の Open Questions（または該当節）へ記録し、修正はユーザーの指示を待つ。
- 修正できることが自明に見える場合でも、範囲外であれば記録にとどめる。
- 矛盾する2つの記述のどちらが正しいか判断できない場合、**独断でどちらか一方へ寄せて書き換えない**。

例: 本リポジトリでは `CLAUDE.md`「🎯 メインレース10点ロジック 🎯」節と現行の F3 実装の関係が未確定であり、
`docs/progress.md` の Open Questions に未解決として記録されている。これを独断で片方に合わせて
書き換えたり削除したりしない。

### High-risk approval boundary

次の操作は、直前でのみ停止し、実施内容・対象・影響・rollback手順・検証結果を一括報告する。

- production deploy（Netlify 本番デプロイ）/ production環境変数またはsecret変更
- 本番メール・メルマガ・アラート・通知の送信（SendGrid 経由、および LINE 等の外部通知チャネルを含む）
- 本番DB・Airtable・Netlify Blobs・KVS（Redis 等）・外部APIへの書込み
- `keiba-data-shared` への本番PUT / workflow dispatch / repository_dispatch 送出
- package公開・registry公開（npm publish等）
- production reader・transport・モデル・artifact・champion・datastoreの切替
- PR merge / データ削除 / rollback困難なmigration
- force push / reset / rebase / amend / revert 等の履歴変更
- 課金・契約・会員権限への本番変更

高リスク操作に到達する前の安全な工程は完了させる。

本節の一覧は **下限**である。上記「🚨 最重要：AI作業ルール 🚨」「🚨 プロジェクト識別ルール 🚨 / 厳格な制約事項」
など、リポジトリ固有により厳しい停止条件がある場合は **常に厳しい方が優先する**。
本節を根拠に既存の停止条件を緩めてはならない。

### Immediate stop conditions

次の場合は即時停止する。

- secret・token・認証値が出力される可能性（`KEIBA_DATA_SHARED_TOKEN` 等の **値** は文書・ログへ出さない。名前のみ扱う）
- 対象外リポジトリまたは対象外ファイルへの予期しない変更
- 本番データ破損の可能性 / 二重送信または重複実行の可能性 / rollback不能
- 現行API・schema・consumer contractの破壊
  （`keiba-data-shared` の JSON 契約、`archiveResults` の `races`/`isHit`/`hitLines` 形式、`astro-site/netlify.toml` の 301 群を含む）
- origin・branch・HEAD・対象日・会場・件数等の前提不一致
- 未知の既存変更との競合 / merge conflict
- test・lint・typecheck・buildの失敗を安全に解消できない
- 別リポジトリの仕様を誤って適用する可能性
  （姉妹プロダクトとの境界は上記「analytics-keiba との関係（独立運用、2026-05-23〜）」節が正本）

### Repository isolation

複数プロジェクトを扱う場合も、各リポジトリを独立して扱う。
変更前の現在地確認は上記「🚨 プロジェクト識別ルール 🚨 / セッション開始時の必須確認」に従い、
最低限次を確認する。

```
pwd
git rev-parse --show-toplevel
git remote get-url origin
git branch --show-current
git rev-parse HEAD
git status --short
```

origin が `https://github.com/apol0510/keiba-intelligence` であることを確認する。

別リポジトリの変更が必要な場合は、現在のリポジトリから勝手に移動して同時変更せず、
依存変更として `docs/progress.md` へ記録する。
横断変更が明示的に承認されたタスクでは、リポジトリごとに独立したbranch・commit・Draft PRを作成する。

### Progress maintenance

- 作業開始時と各Phase完了時に `docs/progress.md` を更新する。
- 重要な設計判断を行った場合は `docs/decisions.md` を更新する。
  理由が記録に残っていない既存判断は、理由を創作せず「履歴上は採用済みだが理由は未確認」と明記する。
- 仕様変更が承認された場合のみ `docs/spec.md` を更新する。

### Completion report

最終報告は上記「完了報告の簡潔化」の形式を維持したうえで、次を簡潔に示す。

1. 完成した内容
2. 変更ファイル
3. test / lint / typecheck / build 結果
4. branch / commit / Draft PR
5. 未実施の高リスク操作
6. blocker
7. 次に必要な承認
8. `docs/progress.md` の現在地
