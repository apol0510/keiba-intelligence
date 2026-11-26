# CLAUDE.md - KEIBA Intelligence 司令塔

**事業目的: 月額売上 100 万円の継続達成。月額プレミアム（Stripe）中心。完成＝本番で顧客が迷わず購入・継続できることを確かめた状態。**

<!-- KAO-FLEET-POLICY: 2026-09-30 -->
共通の運用は ~/.claude/CLAUDE.md（冒頭の行動原則・§3・§13・§14・§35）と KAO の docs/fleet-policy.md に従う。本ファイルには本 repo 固有の事実・MK の決定・contract だけを書く。

<!-- KI-PROTECTED-SPEC: 2026-10-19 -->
## 🔒 保護仕様：的中率・回収率・実績表示（MK 最終決定 2026-10-19）

正本: `docs/decisions.md`「2026-10-19 — 的中率・回収率・実績表示を現行のまま固定する（MK 最終決定…）」

- 🛑 KI の **的中率・回収率・収支・実績の表示と計算に触れない**。数値変更・撤去・再計算・表示方法の変更・配置変更をしない（現行表示をそのまま維持）。
- 🛑 PR **#149 / #150 / #151**（および実績表示を変えるあらゆる変更）は売上改善を理由に採用・実装・merge しない。実績表示の変更は **保留**（#158 も保留）。
- 売上改善は **導線・価格 / 購入 / ログインの経路・継続 / 解約・スマホ UI・GA4 の PII 修正・計測**で行う。実績の変更を売上改善の前提条件にしない。
- 🛑 **MK の明示指示がない限り、どの AI も既存の商品仕様・実績表示・価格・会員権利を自らの判断で変更しない。**
- 保護対象（表示）: `astro-site/src/pages/archive/**`・`results*.astro`・`results/[year]/[month]/*`・`stats/*`・`venues/[venue]/index.astro`（全体）／
  `index.astro`・`layouts/BaseLayout.astro`・`pricing.astro`・`mypage.astro`・`register.astro`・`faq.astro`・`terms.astro`・`tokushoho.astro`・`contact.astro`・
  `prediction/*/index.astro`・`free-prediction/index.astro`・`components/newspaper/RaceDayBoard.astro`・`RaceNewspaper.astro`・`components/AIBettingSection.astro`・
  `AIChat.astro`・`netlify/functions/gemini-chat.js`（実績の語を含む行とその前後）。
- 保護対象（計算）: `astro-site/src/lib/stats/archiveTotals.js`・`scripts/importResults.js`・`scripts/importResultsJra.js`・`scripts/rebuildArchive.js`・
  `scripts/recalc-bet-points.mjs`・`src/utils/umatanHit.js`・`src/utils/mainRaceBetting.js`・`BET_POINT_LOGIC.md`。
- 機械的保護: `astro-site/src/lib/stats/trackRecordFreeze.guard.test.mjs`（`npm run build` 内）が sha256 manifest と照合して不一致なら落ちる。
  🛑 manifest の更新は MK の明示指示を decisions.md に記録したときだけ（`approvals` に見出しを追記）。test を緩める・外す・manifest を AI の判断で書き換えることを禁止。

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
2. **MK が求めていない仕様・条件・文言を足さない** - 目的の完成に必要な実装・検証・本番確認は範囲内
3. **完了条件を満たさない完了宣言の禁止** - テスト・検証完了後のみ完了宣言
4. **数値修正は修正前後の比較を必ず出す** - 表形式で提示
5. **commit前にgit diffを確認する** - 予期しない変更がないか確認
6. **本番反映後は Claude が本番 URL で動作を確かめる**

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

## 🎯 買い目点数・メインレース 🎯

- 買い目点数・的中判定の正本は [`BET_POINT_LOGIC.md`](./BET_POINT_LOGIC.md)（馬単 F3・投資点数は全レース 1 レース 5 点固定・メインの買い目は本命軸 → 上位 5 頭の一方向）と `docs/spec.md` 冒頭の正本対応表。旧「メインレース10点ロジック」（2026-05-08）は廃止。
- メインレース判定は `src/utils/mainRaceBetting.js` の `getMainRaceNumber()`。複数会場同日開催は会場別にレース数を数えてから判定する。
- `BET_POINT_LOGIC.md` と的中判定・集計のファイルは上の 🔒 保護仕様の対象（MK の明示指示なしに変えない）。

## 🤝 analytics-keiba との関係（独立運用、2026-05-23〜）

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
  改変するときは、両 repo の test / build を Claude が確認してから着手する。
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
  **既存 docs か `netlify.toml` / `astro.config.mjs` を読んで確かめる**。

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
作業ディレクトリ: /Users/user/Projects/keiba-intelligence/astro-site
Gitリポジトリ: https://github.com/apol0510/keiba-intelligence.git
```

### セッション開始時の必須確認（毎回実行）

```bash
# 1. 現在地確認
pwd

# 2. Gitリポジトリ確認
git remote -v

# 3. 間違っている場合は即座に移動
cd "/Users/user/Projects/keiba-intelligence/astro-site"
```

### 厳格な制約事項

#### ✅ 許可される操作
- `/Users/user/Projects/keiba-intelligence/` 配下のみ
- `astro-site/` ディレクトリ内の全ファイル
- `CLAUDE.md`, `README.md`（親ディレクトリ）

#### ⚠️ 制限付きで許可される操作
- `/Users/user/Projects/nankan-analytics/` へのアクセス・編集（2026-04-12解禁）
  - keiba-intelligenceとの自動化連携・JRA拡張対応のため
  - 作業前に必ずpwd・git remoteで現在プロジェクトを確認すること

---

## 📚 参照すべきドキュメント一覧 📚

### AI作業ルール・データ仕様（必読）

| ドキュメント | 内容 | 参照タイミング |
|------------|------|---------------|
| **[docs/AI_RULES.md](./docs/AI_RULES.md)** | データ修正時の確認・AI振り返りの買い目非表示 | **全作業開始時** |
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

### 恒久 UAT 環境（Stripe Test Mode）

| ドキュメント | 内容 | 参照タイミング |
|------------|------|---------------|
| **[docs/UAT_PERMANENT_ENV.md](./docs/UAT_PERMANENT_ENV.md)** | 恒久 UAT の**正本**。隔離契約・専用ログイン・定期確認手順・cleanup 方針 | **UAT を触る前に必読** |
| **[docs/QA_STRIPE_TESTMODE_RUNBOOK.md](./docs/QA_STRIPE_TESTMODE_RUNBOOK.md)** | 2026-09-10 の一回限り QA の記録（**常設運用の正本ではない**）| 経緯を追うとき |

🔴 **`QA_STRIPE_TESTMODE_RUNBOOK.md` §5「後片付け」を恒久 UAT に対して実行しない。**
消してよいのは使い捨て資産と production 混入だけ（`UAT_PERMANENT_ENV.md` §7）。
🔴 **UAT から magic link を要求しない**（本番 SendGrid で実送信される）。
ログインは `POST /.netlify/functions/uat-login` のみ。

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
cd "/Users/user/Projects/keiba-intelligence/astro-site"

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
| 決済 | Stripe 月額（カード・自動更新）＋ 銀行振込（年払い） |
| メルマガ | SendGrid Marketing Campaigns |
| 顧客管理 | Airtable Pro |
| バックエンド | Netlify Functions (Node.js 20) |
| セッション管理 | Netlify Blobs（7日間TTL） |

### 価格設定

> ⚠️ **2026-08-30 更新**: 課金は **Stripe の月額プレミアム 1 本が主導線**。
> **「ライト＝南関のみ」という会場で分ける概念は廃止**した（有料なら南関＋中央）。
> 正本は [`docs/RENEWAL_2026_08.md`](./docs/RENEWAL_2026_08.md) §3・§6。

| tier | 到達条件 | 見えるもの |
|------|---------|-----------|
| 未登録（guest） | 誰でも | 全頭の馬柱・過去走・特徴量・**AI短評**・**AIレース展望**・展開予想（馬番順） |
| 無料会員（free） | メール登録＋認証 | 上記 ＋ **印（◎○▲△・指数ごとの印を合算）**・AI指数の列（モザイク） |
| プレミアム（premium） | Stripe 月額 | 上記 ＋ **AI指数の実数値・AI結論・馬単の買い目（南関東4場＋中央競馬）**。印は非表示 |
| ライト（light） | 🟡 **プラン保留** | 新規導線なし。既存レコードのみ。権限は premium と同じ |

### 価格

| 導線 | 内容 | 金額 |
|------|------|------|
| **月額プレミアム**（主導線・Stripe） | 南関東＋中央の全レース馬単買い目 | **正規 ¥5,000 → 割引 ¥3,980/月** |
| 年払い（銀行振込・控えめ） | 同内容 | **¥39,800/年** |

🔴 **請求額の正本は Stripe の Price。** コードの金額（`plans.js` の
`MONTHLY_LIST_PRICE_YEN` / `MONTHLY_PRICE_YEN` / `BANK_YEARLY_PRICE_YEN`）は **表示用**。
価格変更時は **Stripe と `plans.js` の両方**を直すこと。

🔴 **廃止済み（復活させない）**: ライトの購入導線 / 会場別アクセス（`venueAccess`）/
買い切り ¥88,000 / 月払い ¥12,000 系 / ライト ¥6,600 /
プレミアム限定の訴求（詳細レポート・穴馬・優先メルマガ ＝ **実装が無い**）。

### 🎁 会員継続制度（KI Membership / KIリワード・2026-09-01 確定）

正本は **[`docs/MEMBERSHIP_REWARDS.md`](./docs/MEMBERSHIP_REWARDS.md)**。
永続化の移行案は [`docs/MEMBERSHIP_DATA_MIGRATION.md`](./docs/MEMBERSHIP_DATA_MIGRATION.md)。

- KI は **AI競馬予想 ＋ 長期会員クラブ**。🔴 **馬育成アプリ・KAA 型の育成ポイントは作らない。**
  ネイティブアプリ化もスコープ外。別 repo の育成・ゲーム機能を KI へコピーしない。
- 制度: 継続価格ロック / 継続プレゼント / 選べるプレゼント / 長期会員優遇 /
  会員ランク（**Bronze / Silver / Gold / Platinum**）/ KIリワード / 継続記念品。
- 🔴 **ランク差はリワード・プレゼント・長期待遇に限定する。**
  予想の精度・買い目の内容・有料情報の質に差を付けない。
  🔴 **ランク・継続月数・リワードを entitlement / 認可の判断材料にしない。**
- 🔴 **KIリワードは現金・預金ではない。** 換金可能な残高として実装しない。
  円換算・出金・譲渡を作らない。表示語は「KIリワード残高」「今月の積み上げ」
  「次のプレゼントまであと◯◯」。
- 🔴 **数値は確定済み**（[`docs/MEMBERSHIP_REWARDS.md`](./docs/MEMBERSHIP_REWARDS.md) §7.1: 100 pt/月・ランク 0 / 3 / 12 / 24 か月・交換 600 / 1,200 pt・**景品は 1 点 ¥796 以内**・記念品 12 / 24 か月・失効と再加入は 90 日）。
  未確定は**包装資材費・景品価額（TBD-13）だけ**。未確定値を勝手に決めず、画面には出さない（必要な箇所は「準備中」）。
- 検証: `npm run test:membership`（`membership.test.mjs` ＋ `membershipCopy.guard.test.mjs`）。
  `npm run build` にも組み込み済み。

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
# 🟡 optional。未設定なら実装の fallback（siteOrigin + /mypage）が同じ URL を返す。
# 🔴 Netlify の Secret Scanning は **env の値とリポジトリ内の文字列の一致**を検出する。
#    値が秘密かどうかは問わない。設定する場合は、その値が repo 内（テストの fixture 等）に
#    書かれていないことを確認する。テストの fixture では本番 URL を直接使わず、
#    `.invalid` 等の非本番 fixture を使うこと。
#    🔴 SECRETS_SCAN_OMIT_* での回避は禁止（docs/progress.md 2026-09-02 / 2026-09-06）。
STRIPE_PORTAL_RETURN_URL=https://keiba-intelligence.jp/mypage

# Deploy Preview の有料プレビュー用の合言葉（未設定なら有料プレビューは成立しない）
# 🔴 本番ホストでは常に無効。Deploy Preview / ブランチデプロイ / localhost のみで効く
PREVIEW_PAID_KEY=（ランダムな長い文字列）

# 🧊 KMA連携（凍結・MK 決定。現行のメール経路は SendGrid。以下は旧連携の変数で、有効化しない）
KMA_ENROLL_ENABLED=false
KMA_ENROLL_WRITE_ENABLED=false
KMA_BASE_URL=https://keiba-marketing-automation.netlify.app
KMA_ADMIN_TOKEN=（KMA の ADMIN_API_TOKEN と同一値）
```

---

## 🔀 Git マージ規約 🔀

### 🔴 PR は **CI green・前提確認後に squash merge** する

- **必ず squash merge**（`gh pr merge <N> --squash`）。
  merge commit（`--merge`）も rebase merge（`--rebase`）も**使わない**。
- merge は **CI green と前提確認（対象・影響・rollback・検証方法）の後**。経路は KAO の MEDIUM handoff
  （`fleet-medium-handoff`・KAO `config/fleet.yml` で `contentAllowed: true`。billing の path は人が merge）。
  `main` は production branch であり、merge した時点で本番デプロイが走ることに注意する。
- `main` へ直接 push しない。変更は必ず branch → PR を経由する。

🔴 **squash によって branch の commit SHA は `main` に残らない。**
`docs/progress.md` などが branch の SHA を参照していても、**それは squash を回避する理由にならない**
（2026-09-03 に PR #82 でこの判断を誤り、merge commit を使ってしまった）。
SHA が消えて困る情報は、**文書側に本文として書く**こと。

🔴 squash merge されたブランチは `git branch --merged` で merged と判定されない。
**PR の状態を根拠に判断する**。

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

## 🧠 racebook連携・特徴量システム 🧠

- 元データの印・振り分けをそのまま使わない（著作権対応。独自スコアで役割を決める・`src/utils/adjustPrediction.js`）。
- 2026-11-28 の開催から、印・役割・AI指数は KI の独自指数 OWN_INDEX_KI_V1（`src/utils/ownIndexKi.js`・取込 `scripts/lib/ownIndexImport.mjs`・正本 docs/spec.md §4・decisions.md 2026-11-26）。指数そのもの（`computerIndex`）は公開データに出さない。AK（OWN_INDEX_V1）と同じ項目構成にしない。
- 取込パイプライン・コンピ指数の役割判定・特徴量の算出は [`docs/RACEBOOK_PIPELINE.md`](./docs/RACEBOOK_PIPELINE.md)。

---

## 🤖 Autonomous Delivery Workflow（KI 固有）🤖

### Canonical documents

作業開始時に必ず次を読む。

- `docs/spec.md` — 仕様の正本（スコープ・境界・契約・完成条件・禁止変更）
- `docs/progress.md` — 進捗の正本
- `docs/decisions.md` — 設計判断の正本
- `CLAUDE.md`（本ファイル） — 運用ルールの正本

領域別の正本（`BET_POINT_LOGIC.md` / `docs/DATA_FORMAT.md` / `docs/RESULTS_SYSTEM_ARCHITECTURE.md` /
`docs/MULTI_VENUE_CHECK.md` / `docs/AI_RULES.md` / `docs/INTELLIGENCE_DISPLAY_SPEC.md` /
`docs/ui-cross-plan-regression-policy.md`）は従来どおり各領域の正本である。
上記「📚 参照すべきドキュメント一覧 📚」と `docs/spec.md` 冒頭の正本対応表を参照すること。
`DESIGN.md` は 2026-01-09 時点の初期設計であり、**現行仕様の根拠には使わない**（歴史的資料）。

仕様・進捗・設計判断が競合する場合は、勝手に推測せず、git履歴と実装証拠を調査して整合させる。
整合できない矛盾は `docs/progress.md` の Open Questions に記録する。

### Package manager

npm（`astro-site/package-lock.json`・CI は `npm ci`）。

### 範囲外の不具合

同じ差分に混ぜず、同じ目的の完成に必要なものは別 branch / PR で修正し、無関係なものは `docs/progress.md` に記録して最終報告に含める。

### 前提確認の具体例（KI）

`keiba-data-shared` への本番 PUT / workflow dispatch / repository_dispatch 送出、SendGrid 経由の本番メール・メルマガ・アラート、Airtable・Netlify Blobs への本番書込み。

### KI 固有の停止条件

- secret・token の**値**の出力（`KEIBA_DATA_SHARED_TOKEN` 等は名前だけ扱う）
- 現行 API・schema・consumer contract の破壊（`keiba-data-shared` の JSON 契約、`archiveResults` の `races` / `isHit` / `hitLines` 形式、`astro-site/netlify.toml` の 301 群を含む）
- 別 repo の仕様を誤って適用する可能性（姉妹プロダクトとの境界は上の「analytics-keiba との関係」が正本）
- origin は `https://github.com/apol0510/keiba-intelligence`。違えば作業しない

### Progress maintenance

- 作業開始時と各Phase完了時に `docs/progress.md` を更新する。
- 重要な設計判断を行った場合は `docs/decisions.md` を更新する。
  理由が記録に残っていない既存判断は、理由を創作せず「履歴上は採用済みだが理由は未確認」と明記する。
- MK が決めた仕様変更は `docs/spec.md` に反映する。

報告の形式は `~/.claude/CLAUDE.md` §34。
