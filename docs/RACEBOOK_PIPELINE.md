# racebook連携・特徴量システム（2026-04-08 実装）

> CLAUDE.md から移設（2026-11-25）。内容は 2026-04-08 実装時点の記録で、定数名だけ現行コードに合わせた。

## racebook import パイプライン

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

## 独自予想ロジック（adjustPrediction.js）
- 元データの印・振り分けをそのまま使わない（著作権対応）
- marks配列を逆順（本紙→印1）にして印1〜印Nに変換
- `customScore = 印1×4 + 印2×3 + 印3×2 + 印4×1`
- 印1◎の馬を本命 or 対抗に固定
- 連下3頭制限（連下最上位1頭 + 連下最大3頭）

## 独自指数 OWN_INDEX_KI_V1（2026-11-28 の開催から）

正規化の後に `scripts/lib/ownIndexImport.mjs` が役割を独自指数（指数 ＋ 近走 ×2・上がり・コース）の順に付け直す。正本は docs/spec.md §4。
下の「コンピ指数による役割判定」は 2026-11-27 までの開催の仕様。

## コンピ指数による役割判定（normalizePrediction.js）
- **`COMPI_MIN = 45`**（`normalizePrediction.js`）
- 印あり → totalScoreでrawScore決定
- 印なし + コンピ45以上 → rawScore=コンピ指数 → 補欠等に
- 印なし + コンピ44以下 → rawScore=0 → 「無」
- rawScore=0の馬は役割割り当て対象外（adjustPredictionでもスキップ）

## 特徴量算出（featureScores.js）
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

## dispatch受信
- event: `prediction-updated`
- workflow: `import-on-dispatch.yml`
- save-keiba-book.mjsから自動送信（JRA/南関のみ、localはスキップ）

## 対応ファイル一覧
| ファイル | 役割 |
|---|---|
| `scripts/importPrediction.js` | racebook取込 + fetchRacebookPastRaces + convertToLegacyFormat |
| `scripts/importPredictionJra.js` | JRA用racebook取込 |
| `src/utils/normalizePrediction.js` | rawScore決定 + COMPI_MIN 判定 |
| `src/utils/adjustPrediction.js` | 独自スコア計算 + 役割割り当て |
| `src/utils/featureScores.js` | 特徴量算出（全ページ共通） |
