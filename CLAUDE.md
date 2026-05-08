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

### analytics-keiba との整合

姉妹repo `analytics-keiba` にも同じ `src/utils/mainRaceBetting.js` を配置済み。
**両 repo で同じ判定式・同じ買い目生成ロジック**を使うため、メインレース判定や10点ロジックを変更する場合は **両 repo を同時に更新する**。

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
| **本番URL** | https://keiba-intelligence.netlify.app/ |

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

| プラン | 価格 | 内容 |
|--------|------|------|
| フリー | ¥0 | 予想閲覧のみ（上位5頭、買い目なし） |
| **無料会員** | **¥0（登録必要）** | **全頭予想・買い目一部・AI分析・メルマガ** |
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
