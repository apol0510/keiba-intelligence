# JRA予想パイプライン理解マップ（旧 vs 現在）

2026-05-23 マコ指示で作成。提案前に必ずここを参照する。

## 全体フロー（端から端まで）

```
[新聞PDF]
   ↓ pdf2xml + race-data-importer.astro (adminブラウザ)
[racebook JSON]  (keiba-data-shared/jra/racebook/YYYY/MM/{date}-{venue}.json)
   ↓ importPredictionJra.js が GitHub から fetch
   ↓ normalizeAndAdjust → convertToLegacyFormat
[intelligence JSON]  (src/data/predictions/jra/YYYY/MM/{date}.json)
   ↓ Astro SSR
[/prediction/jra のカード画面]
```

## レイヤー別責務

### 1. admin parser (`keiba-data-shared-admin/src/pages/admin/race-data-importer.astro`)
- 入力: 新聞PDFをブラウザにロード→pdf2xml化
- 抽出: 印・馬名・性齢・斤量・騎手・厩舎・人気指数(コンピ)・予想オッズ・調教・短評・近走(最大6走)
- 出力: racebook JSON
- 各レース・各馬ごとに `computerIndex / marks{印1〜印N} / totalScore / predictedOdds / pastRaces[]` 等を保存

### 2. 取込 (`importPredictionJra.js`)
- ソース優先順: predictions/ → computer/ → racebook/ (フォールバック)
- 別途 racebook-past から **horseDataMap** を構築（馬名キーで近走/オッズ/computerIndexを保持）
- normalizeAndAdjust に渡してJRA予想JSONへ変換

### 3. 正規化・調整 (`normalizePrediction.js` + `adjustPrediction.js`)
- **rawScore** = horse.PT || horse.totalScore || horse.rawScore || 0
- rawScore===0 かつ computerIndex≧45 → **rawScore = computerIndex**（フォールバック）
- **displayScore = rawScore + 70**（adjustPrediction L94）
- **customScore = 印1×4 + 印2×3 + 印3×2 + 印4×1**（adjustPrediction）
- 役割割り当て: 印1◎固定 + customScore降順 / hasCustomScore=false なら rawScore降順

### 4. 表示 (`src/pages/prediction/jra/index.astro` 等)
- カードに 印・馬番・馬名・役割・AI指数・AI支持率スコア・基本情報・近走4走 を表示
- 5走目は newspaper圧縮で諦め (`slice(0,4)`)

## 各フィールドの来歴と現状

| 表示項目 | 出処 | 計算 | 種類 |
|---|---|---|---|
| 印（◎○▲△☆） | adjustPrediction.js の役割割当 | customScore順 + 印1◎固定 | **独自計算** |
| 馬番 | horse.number | そのまま | 事実 |
| 馬名 | horse.name | 正規化のみ（lookup側で(地)/(外)除去） | 事実 |
| 役割（本命/対抗/単穴…） | adjustPrediction.js | customScore順位 | **独自計算** |
| **AI指数 X** | **computerIndex（人気指数生値）+ 10** | min(100, ci+10) | **リブランド＋著作権マスク** ⚠️ |
| 性齢 | horse.sexAge | そのまま | 事実 |
| 斤量 | horse.weight | そのまま | 事実 |
| 騎手 | horse.jockey | そのまま | 事実 |
| 厩舎 | horse.trainer | そのまま | 事実 |
| **AI支持率スコア X** | **単勝予想オッズ** | clamp(166/odds^0.8, 1, 95) | **見栄えスコア化（勝率ではない）** ⚠️ |
| 近走 venue | pastRaces[i].venue | 1字会場を2字に展開（京→京都、名→中京等） | 事実＋表示変換 |
| 近走 date | pastRaces[i].venue から M.D 抽出 | 年は当日比較で推定 | 事実＋推定 |
| 近走 rank | pastRaces[i].finish（丸数字→数字） | extractFinish | 事実 |
| 近走 time | pastRaces[i].time | content-based 抽出 | 事実 |
| 近走 上り | pastRaces[i].final3F | content-based 抽出 | 事実 |
| 近走 paceType | pastRaces[i].paceType | content-based 抽出 | 事実 |
| 近走 status | pastRaces[i].finishStatus | 除外/取消/中止/失格 検出 | 事実 |

## 「AI」と呼ばれているものの正体

### ✅ 独自計算（本当に我々がやっている処理）
- **役割割り当て**（印1◎固定 + customScore降順 → 本命/対抗/単穴...）
- **customScore**（印1×4+印2×3+印3×2+印4×1）= 新聞の印の独自重み付け
- **買い目生成**（メインレース10点ロジック、対抗軸2行 等）
- **AI支持率スコアの式**（166/odds^0.8）— 数値変換は独自、ただし元は新聞オッズ
- **近走再構成**（pdf2xml→構造化）

### ⚠️ リブランド（新聞データを別名で出している）
- **AI指数 X = 人気指数(コンピ) + 10**
  - +10 は **元値を直接出さないためのマスク**（[[案A廃案]]の理由）
  - 内訳・計算式は**絶対に公開しない**
- **AI支持率スコア = 単勝予想オッズの単調変換**
  - 元値（オッズ）を直接出さない代わりに見栄えスコア化
  - 「勝率」ではない、と明言する命名で誤解防止

### ❌ Fake branding（実体なし、見せかけ）
- 「Ensemble Deep Neural Network」「XGBoost + LSTM」「Multi-Layer Perceptron」
- 「127 Features w/ PCA」「48,392 Historical Races」
- 「Cross-Val Score 9247/10000」「Validation Accuracy XX%」「Training Loss 0.XXX」
- 現状：**折りたたみで既定非表示**（2026-05-23、commit c1981f9等）

### 🗑️ 削除済み（較正未検証で誤誘導するため）
- 勝率（softmax / featureScores 由来）
- 期待値（−25%固定問題）
- 確信度・リスク
- Feature Importance Analysis（6本バー、50.0問題）

## 著作権マスキングの仕組み

新聞由来の数値は**直接の生表示を避ける**：
- 人気指数（生値）→ **+10で AI指数 X として表示**（差分10は固定オフセットでマスク）
- 単勝予想オッズ（生値）→ **AI支持率スコア（166/odds^0.8）** に変換して表示
- 印・短評 → **直接そのまま出さない**（adjustPredictionで独自スコア化してから役割表示）

**禁止行為**：
- 「AI指数 = 人気指数+10」など**内訳・式の公開UI**（[[案A廃案]]）
- 新聞の印（◎○▲）を生のまま並べて見せる
- 新聞の短評文を画面に出す
- 単勝予想オッズの生値（X.X倍）を出す
- 人気指数の生値を出す

## このセッションでの主要変更

| 変更 | コミット | 内容 |
|---|---|---|
| (地)/(外) lookup正規化 | a6ddf90 | horseDataMap.has/.get で `(地)/(外)` を除去 |
| PT表示廃止 | aab39ce | PT(=ci+70)とAI指数(=ci+10)が同源で二重のため、PTを廃しAI指数に一本化 |
| AI支持率スコア新設 | 8171933 | 予想オッズ生表示を廃し 166/odds^0.8 で見栄えスコア化 |
| 勝率/期待値/Feature Importance廃止 | d311e94, 5cf36b8 | 較正未検証で危険なため非表示 |
| 確信度・リスク廃止 | dca2916 | 較正未検証＋ユーザーから dead と判定 |
| 近走表示刷新 | 8171933 | 暗いinline → 明るい行レイアウト、日付YY/MM/DD、前走/2走前ラベル、最大5→4走 |
| 会場2文字化 | 6990f78 | 京→京都、東→東京、名→中京（JRA、データ確認）等 |
| AIモデル仕様カード折りたたみ | c1981f9, a4b4835 | fake branding を既定非表示に |
| 除外/取消ステータス | a6ddf90+73b2623 | finishStatus 検出して `[除外]` 表示 |
| admin parser修正 | 8aa0d71/93bc5be/d811fa6/f7a1701/73b2623 | VENUE_RE地方追加・top<400修正・time/paceText内容ベース化・finishStatus検出 |

## 触っていないもの（意図的に保持）

- `src/utils/featureScores.js` — 一切触らない（他用途・再利用可能性のため保持）
- 買い目（馬単）ロジック（mainRaceBetting.js / メインレース10点）
- 印・役割・customScore計算（normalize/adjust）
- 的中実績アーカイブ
- 料金導線・無料/有料制限
- analytics-keiba（姉妹repo、同期しない）

## Q&A 確認済み（2026-05-23 マコの口頭テストへの正解）

### Q1. `/admin/computer-manager` は使わず `/admin/race-data-importer` のみ使用 — 状況

- **運用方針**: race-data-importer のみが入力。computer-manager は不使用（マコ指示）。
- **コード現状**（`importPredictionJra.js` L391-403）: フォールバックがまだ残存
  - 優先順位1: `predictions/`（旧統合ファイル）
  - 優先順位2: `computer/`（computer-manager の出力）← 本来は廃止対象
  - 優先順位3: `racebook/`（race-data-importer の出力）← 本来の唯一の入力源
- **実害が出ていない理由**: マコが運用で computer-manager を動かさない → `computer/` ディレクトリが空 → 自然と `racebook/` にフォールバックする。
- **隠れたリスク**: `computer/` にファイルが残っていれば今でも優先される。コードから完全に外していないので将来事故の余地。
- **横の補完**: `fetchRacebookPastRaces` が常時走り、horseDataMap が computerIndex / predictedOdds / recentRaces を racebook から補完。一次ソースが何であれ表示用フィールドは race-data-importer 由来で揃う設計（2026-05-23 セッションで確立）。
- **🔴 残課題**: `importPredictionJra.js` から優先順位2の `fetchComputerPredictions` を**コードレベルで廃止する**（将来事故防止）。今は据え置き。

### Q2. 総合pt と AI支持率スコア の算出

#### 総合pt（カードの青いガラスバッジ表示）
- **計算**: `min(100, computerIndex + 10)`
- **ソース**: `computerIndex` = race-data-importer が新聞「人気指数」を生値で racebook JSON に保存したもの
- **+10 の意味**: 生値を直接見せないための**著作権マスク**（マコ指定）
- **ラベル変遷**: 「AI指数」→「AI」→ 現状「**総合pt**」
- **非表示条件**: computerIndex が無い馬（約15%）は完全非表示（偽値・代替値は出さない）
- **禁止**: 「= 人気指数+10」のような内訳公開UI（マスクが無効化される）

#### AI支持率スコア（青グラデのバー＋数値）
- **計算**: `clamp( round( 166 / odds^0.8 ), 1, 95 )`
- **ソース**: `predictedOdds` = 新聞の単勝予想オッズ（生値）。これを生表示せずスコア化
- **アンカー**（マコ指定）: オッズ 2.3 → 85、76.4 → 5
- **非表示条件**: predictedOdds が無い馬は非表示
- **明示禁止表記**: 「勝率」（較正未検証のため）

#### 内部使用（UIには出ない）
- `rawScore` = `horse.PT || horse.totalScore || horse.rawScore || (computerIndex ≥ 45 ? computerIndex : 0)`
- `displayScore` = `rawScore + 70`（旧PT表示の実体、**表示廃止済**）
- `customScore` = `印1×4 + 印2×3 + 印3×2 + 印4×1`（役割割当の主軸）

### Q3. 不要馬（無）の判定基準＋全頭の振り分け

#### 「無」の判定
- `rawScore === 0` **かつ** `customScore === 0`
- 言い換え: 印が一つも付いていない **かつ** totalScore/PT が無い **かつ** 人気指数 < 45（フォールバックも不可）

#### 全頭振り分けの順序（`adjustPrediction.js`）

1. **rawScore 確定**: `totalScore || PT || rawScore || 0`。0 なら人気指数≥45でフォールバック、未満なら 0 のまま（→無）。
2. **customScore 計算**: `印1×4 + 印2×3 + 印3×2 + 印4×1`。
3. **activeHorses 抽出**: customScore>0 または rawScore>0。
4. **ソート**: customScore 降順（全頭 customScore=0 なら rawScore 降順）。
5. **役割割当（印1◎優先）**:
   - 印1◎ が 1 位 → そのまま順番に：本命/対抗/単穴/連下最上位/連下…
   - 印1◎ が 2 位以下 → 1 位を本命、印1◎を対抗に固定、以下も印1◎を除いた順で。
   - 印1◎ 不在 → 純粋に customScore 順で機械割当。
6. **連下3頭制限**: 連下のうち customScore 上位 3 頭だけ「連下」、それ以降は「補欠」。

#### 結果バケット（固定）

| 役割 | 頭数 | 判定 |
|---|---|---|
| 本命 | 1 | customScore 1位 or 印1◎ |
| 対抗 | 1 | customScore 2位 or 印1◎（下位の場合） |
| 単穴 | 1 | 印1◎を除く customScore 3位 |
| 連下最上位 | 1 | 印1◎を除く customScore 4位 |
| 連下 | 最大3 | customScore 5位以降の上位3頭 |
| 補欠 | 残り | active だが連下に入れなかった馬 |
| 無（不要馬） | 残り | rawScore=0 かつ customScore=0 |

#### 補足
- 連下最上位は 1 頭固定で、連下3頭制限の対象外（保持される）。
- 全頭 customScore=0 のとき（印データなしの computer/ 形式など）は rawScore 順で既存役割を維持。
- COMPI_MIN=45 は人気指数（日刊コンピ）の慣習的な「妙味馬閾値」。

## 私が提案する前のチェックリスト

1. その表示は **新聞由来の生値・式を露出していないか**？（露出するなら却下）
2. **較正検証が必要な数値**ではないか？（不要なら可、必要なら却下 or 検証先行）
3. データは **既存JSONにあるか**？（無ければadmin parser修正必要）
4. **自動化済のパイプラインで継続供給できるか**？
5. **featureScores.js を触る必要があるか**？（触るなら立ち止まる）
6. 3ページ（会員/無料index/無料[date]）で整合するか？
