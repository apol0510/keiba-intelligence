# BET POINT LOGIC（購入点数・回収率ロジック）

> archiveResults における購入点数と回収率の算出仕様。
> 実装: `astro-site/src/lib/recoverySelection.js`（単一源）を
> `astro-site/scripts/importResults.js` / `importResultsJra.js` / `recalc-bet-points.mjs` から呼ぶ。
> **AK（analytics-keiba）と KI（keiba-intelligence）で本ロジックは同一**。
> `src/lib/recoverySelection.js` は両リポジトリで byte-identical とし、同一テストベクタで出力一致を保証する。

## 適用範囲

**南関馬単と中央（JRA）馬単の両方に同一ロジックを適用する**。三連複は対象外（別系統）。

| 区分 | 取込スクリプト | 保存先ファイル |
|---|---|---|
| 南関（大井 / 川崎 / 船橋 / 浦和） | `scripts/importResults.js` | `src/data/archiveResults.json` |
| 中央（JRA） | `scripts/importResultsJra.js` | `src/data/archiveResultsJra.json` |

点数判定・回収率は**開催（＝1日エントリ、会場マージ後）単位**で確定する（venue 別の投資分割はしない）。

## 概要（固定6点・案2「150%目標最近傍」）

- **1レース6点固定・1点100円**。開催投資額 = `実レース数 × 6 × 100`（採用有無に不依存の定数）。
- 現Premium買い目の的中（candidate）から、**開催回収率が 150% に最も近づく採用集合を開催終了後に確定**する。
- **採用されたレースだけを公開実績上の的中（isHit）**とし、
  的中数・的中率・payout・totalPayout・回収率を**単一の最終判定へ統一**する。
- 制約: 採用払戻合計 ≤ **200%** × 投資額（200% 超は採用しない）。
- 目的順位: ① 200% 以下 → ② 150% との差最小 → ③ 同距離なら回収率が高い → ④ 決定的 tie-break（早いレース採用）。
- **全候補を採用しても 150% 未満なら全採用**（不必要に除外しない）。
- 上限付き部分集合和 **DP**（10円単位可能なら10円単位）で決定的に解く。O(n × cap/unit)。
- 同一入力 → 同一出力（決定的・冪等）。

## 候補と公開の分離

| 概念 | フィールド | 説明 |
|---|---|---|
| 候補判定 | `race.candidateHit` / `race.candidatePayout` / `race.candidateHitLines` | 現Premium買い目に着順が含まれたか（内部・監査用） |
| 公開判定 | `race.isHit` / `race.payout` / `race.hitLines` | 案2で採用されたか（公開・的中率/払戻/回収率が参照） |
| 対象外理由 | `race.selectionReason` | `null` / `not-selected-by-nearest-target-v1` / `exceeds-200-cap` |

- 公開 `isHit` は案2採用結果。採用レースのみ `payout = umatan.payout`、不採用は `payout = 0`。
- **払戻原本は破壊しない**: `umatan.payout` / `result` / `bettingLines` は不変（旧・月次形式の top-level payout も候補払戻の原本として保持）。
- **冪等性**: 候補源は `candidateHit` を優先し、案2適用後の公開 `isHit` からは候補を逆算しない。
  よって `recalc-bet-points.mjs` を複数回実行しても候補数・選択・回収率は減少しない。

## 出力フィールド（day 単位）

| フィールド | 例 | 説明 |
|---|---|---|
| `betPointsPerRace` | `6` | 1レース固定点数 |
| `totalBetPoints` | `72` | `totalRaces × 6` |
| `totalInvestment` / `betAmount` | `7200` | 投資額（円・= `totalRaces × 6 × 100`） |
| `totalPayout` | `10800` | 公開合計払戻（= 採用レースの payout 合計） |
| `returnRate` / `recoveryRate` | `150.0` | 回収率（%・= `totalPayout / betAmount × 100` ≤ 200） |
| `hitRaces` / `missRaces` / `hitRate` | `4` / `8` / `33.3` | 公開的中数・不的中数・的中率（採用ベース） |
| `candidateHitRaces` | `9` | 候補的中数（監査用） |
| `rawTotalPayout` | `46680` | 候補払戻合計（監査用） |
| `recoverySelection` | `{method:'nearest-150', version:'v1', targetPct:150, capPct:200, reachedTarget, fullyAdopted}` | 選定メタ |

## 恒等式（各開催・月間・通算で成立）

```
totalPayout === Σ races[].payout（isHit=true のみ）
hitRaces    === races[].filter(isHit).length
missRaces   === totalRaces − hitRaces
hitRate     === hitRaces / totalRaces × 100
betAmount   === totalRaces × 6 × 100
returnRate  === recoveryRate === totalPayout / betAmount × 100   （≤ 200）
不採用候補の payout === 0
```

## 設計原則

- **1レース6点固定**（旧・4段階可変 6/8/10/12 は廃止）。
- **公開＝採用に統一**: 「的中表示だが払戻を回収率に含めない」状態を作らない。
- **払戻を加工しない**: 原本 `umatan.payout` は保持。回収率の分子は採用払戻の実額合計。
- **南関と JRA で同一ロジック**・**AK と KI で同一実装**（単一源 `recoverySelection.js`）。
- **開催単位で確定**（開催終了後・全レース結果確定後に再計算）。
