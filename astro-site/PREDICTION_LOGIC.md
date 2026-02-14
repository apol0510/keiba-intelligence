# 予想ロジック仕様書

## 📋 概要

南関競馬と中央競馬（JRA）のAI予想データ処理システムの完全仕様。
このドキュメントを読めば、予想データの正規化から買い目生成までの全プロセスを理解できる。

---

## 🎯 予想システムの全体像

```
keiba-data-shared（外部予想データ）
  ↓
normalizePrediction.js（正規化）
  ↓
adjustPrediction.js（調整ルール適用）
  ↓
買い目生成（馬単2段構成）
  ↓
表示（無料予想・有料予想ページ）
```

---

## 📊 データ形式

### 入力データ（keiba-data-sharedから取得）

**詳細フォーマット**（全馬データ + 買い目）
```json
{
  "raceDate": "2026-02-14",
  "track": "大井",
  "totalRaces": 12,
  "races": [
    {
      "raceInfo": {
        "raceNumber": "1R",
        "raceName": "3歳2組",
        "startTime": "18:30",
        "distance": "1400m",
        "surface": "ダート"
      },
      "horses": [
        {
          "number": 9,
          "name": "ホースA",
          "totalScore": 15,
          "assignment": "本命",
          "marks": {
            "印1": "◎"
          },
          "kisyu": "騎手A",
          "kyusya": "厩舎A"
        }
      ],
      "bettingLines": {
        "umatan": [
          "9-16.13.2.3.8.11(抑え12.4.5.6.14.15.10)"
        ]
      }
    }
  ]
}
```

**シンプルフォーマット**（買い目のみ）
```json
{
  "date": "2026-02-14",
  "venue": "大井",
  "totalRaces": 12,
  "races": [
    {
      "raceNumber": 1,
      "raceName": "3歳2組",
      "bettingLines": {
        "umatan": [
          "9-16.13.2.3.8.11(抑え12.4.5.6.14.15.10)"
        ]
      }
    }
  ]
}
```

---

## 🔄 normalizePrediction.js（正規化処理）

### 目的

- keiba-data-sharedの異なるフォーマット（詳細/シンプル）を統一形式に変換
- 不要なフィールドを削除し、必要なフィールドを抽出
- 次の調整処理（adjustPrediction.js）に渡す

### フォーマット検出

```javascript
export function detectFormat(input) {
  // 詳細フォーマット: raceDate または races[0].raceInfo がある
  if (input.raceDate || (input.races && input.races[0]?.raceInfo)) {
    return 'detailed';
  }

  // シンプルフォーマット: date がある かつ horses が無い/空
  if (input.date && (!input.races[0]?.horses || input.races[0].horses.length === 0)) {
    return 'simple';
  }

  return 'simple';
}
```

### 正規化後のデータ構造（NormalizedPrediction）

```json
{
  "date": "2026-02-14",
  "venue": "大井",
  "venueCode": "OI",
  "totalRaces": 12,
  "races": [
    {
      "raceNumber": 1,
      "raceName": "3歳2組",
      "raceInfo": {
        "raceName": "3歳2組",
        "startTime": "18:30",
        "distance": "1400m",
        "surface": "ダート"
      },
      "horses": [
        {
          "number": 9,
          "name": "ホースA",
          "rawScore": 15,
          "displayScore": 0,
          "role": "本命",
          "mark": "",
          "mark1": "◎",
          "jockey": "騎手A",
          "trainer": "厩舎A"
        }
      ],
      "bettingLines": {
        "umatan": [
          "9-16.13.2.3.8.11(抑え12.4.5.6.14.15.10)"
        ]
      },
      "hasHorseData": true,
      "isAbsoluteAxis": null
    }
  ]
}
```

### 重要なフィールド

| フィールド | 説明 |
|-----------|------|
| `rawScore` | AI評価点（0〜20点） |
| `displayScore` | 表示用スコア（rawScore + 70） |
| `role` | 役割（本命・対抗・単穴・連下最上位・連下・補欠・無） |
| `mark` | 表示用印（◎○▲△×-） |
| `mark1` | 記者印1（◎○▲）- **独自予想用** |
| `hasHorseData` | 馬データの有無（true/false） |
| `isAbsoluteAxis` | 絶対軸フラグ（true/false/null） |

---

## ⚙️ adjustPrediction.js（調整ルール適用）

### 目的

- 正規化されたデータに対して、AI予想の調整ルールを適用
- 本命・対抗・単穴の役割を最適化
- 絶対軸（信頼度が高い本命）を判定
- 表示用印（◎○▲△×）を生成

### 調整ルールの流れ（南関競馬）

```
Step 0: 印1を基準に本命・対抗・単穴を決定（独自予想）
  ↓
Step 1: displayScore計算（rawScore + 70）
  ↓
Step 2: 本命15点以下の降格処理（無効化）
  ↓
Step 3: 差4点以上の役割入れ替え（無効化）
  ↓
Step 4: 連下3頭制限（連下最上位1頭維持 + 連下最大3頭）
  ↓
Step 5: 絶対軸判定（19/20点 or 差4点以上）
  ↓
Step 6: 表示用印の割り当て（◎○▲△×-）
```

### Step 0: 印1を基準に本命・対抗・単穴を決定

**目的**: 記者印1（◎○▲）を優先し、本命・対抗・単穴を強制的に決定

**ロジック**:
1. 印1◎ → 本命（そのまま）
2. 印1○と印1▲ → rawScoreを比較
   - rawScoreが高い方 → 対抗
   - rawScoreが低い方 → 単穴

```javascript
// 印1が有効な馬を検出
const honmeiMark1 = race.horses.find(h => h.mark1 === '◎');
const taikouMark1 = race.horses.find(h => h.mark1 === '○');
const tananaMark1 = race.horses.find(h => h.mark1 === '▲');

// 本命（◎）はそのまま
if (honmeiMark1) {
  honmeiMark1.role = '本命';
}

// 対抗（○）と単穴（▲）はrawScoreで比較して入れ替え
if (taikouMark1 && tananaMark1) {
  if (taikouMark1.rawScore >= tananaMark1.rawScore) {
    // ○の方が高い or 同点 → そのまま
    taikouMark1.role = '対抗';
    tananaMark1.role = '単穴';
  } else {
    // ▲の方が高い → 入れ替え
    taikouMark1.role = '単穴';
    tananaMark1.role = '対抗';
  }
} else if (taikouMark1) {
  taikouMark1.role = '対抗';
} else if (tananaMark1) {
  tananaMark1.role = '単穴';
}
```

**具体例**:
```
印1○の馬: rawScore 12点
印1▲の馬: rawScore 15点

→ ▲の方が高い → 入れ替え

結果:
対抗: 印1▲の馬（15点）
単穴: 印1○の馬（12点）
```

**重要**:
- ✅ **南関競馬**: 印1で役割を決定（独自予想）
- ❌ **中央競馬**: `skipMark1Override: true` で無効化（assignment保持）

### Step 1: displayScore計算

```javascript
for (const horse of race.horses) {
  if (horse.rawScore > 0) {
    horse.displayScore = horse.rawScore + 70; // 15点 → 85点
  } else {
    horse.displayScore = 0; // 0点はそのまま
  }
}
```

### Step 2 & 3: 本命降格・役割入れ替え（無効化）

**理由**: 印1で役割を決定するため、これらのルールは無効化

```javascript
// Step 2: 本命15点以下の場合、本命と対抗をスワップ
// ⚠️ 印1で決定した役割を維持するため、無効化

// Step 3: 差4点以上の役割入れ替え
// ⚠️ 印1で決定した役割を維持するため、無効化
```

### Step 4: 連下3頭制限

**目的**: 連下を上位3頭に絞り、残りは補欠に降格

```javascript
// 連下最上位は1頭固定（そのまま維持）
const renkaTop = race.horses.find(h => h.role === '連下最上位');

// 連下を抽出（連下最上位は除外）
const renkaList = race.horses.filter(h => h.role === '連下');

// rawScoreで降順ソート
renkaList.sort((a, b) => b.rawScore - a.rawScore);

// 上位3頭のみ連下、残りは補欠
for (let i = 0; i < renkaList.length; i++) {
  if (i < 3) {
    renkaList[i].role = '連下';
  } else {
    renkaList[i].role = '補欠';
  }
}

// 結果: 連下最上位(1頭) + 連下(最大3頭) + 補欠(残り)
```

### Step 5: 絶対軸判定

**目的**: 信頼度が高い本命を「絶対軸」として判定

**条件**:
1. 本命が19点または20点
2. 本命と対抗の差が4点以上

```javascript
const finalHonmei = race.horses.find(h => h.role === '本命');
const finalTaikou = race.horses.find(h => h.role === '対抗');

if (finalHonmei) {
  // 条件1: 本命が19点または20点
  if (finalHonmei.rawScore === 19 || finalHonmei.rawScore === 20) {
    race.isAbsoluteAxis = true;
  }
  // 条件2: 本命と対抗の差が4点以上
  else if (finalTaikou && (finalHonmei.rawScore - finalTaikou.rawScore >= 4)) {
    race.isAbsoluteAxis = true;
  }
  else {
    race.isAbsoluteAxis = false;
  }
}
```

**絶対軸の効果**:
- 買い目生成で本命を軸固定
- 相手（対抗・単穴・連下最上位）のみを流す

### Step 6: 表示用印の割り当て

```javascript
function getRoleMark(role) {
  const markMap = {
    '本命': '◎',
    '対抗': '○',
    '単穴': '▲',
    '連下最上位': '△',
    '連下': '△',
    '補欠': '×',
    '無': '-'
  };
  return markMap[role] || '-';
}

for (const horse of race.horses) {
  horse.mark = getRoleMark(horse.role);
}
```

---

## 🏆 中央競馬（JRA）専用の簡易調整

### simpleAdjustForJRA()

**目的**:
- 中央競馬のassignment（本命・対抗・単穴）をそのまま保持
- displayScoreとmarkのみを生成
- **印1による役割変更を一切行わない**

```javascript
function simpleAdjustForJRA(normalized) {
  for (const race of adjusted.races) {
    for (const horse of race.horses) {
      // displayScore計算
      if (horse.rawScore > 0) {
        horse.displayScore = horse.rawScore + 70;
      } else {
        horse.displayScore = 0;
      }

      // mark生成（roleから）
      horse.mark = getRoleMark(horse.role);
    }

    race.hasHorseData = true;
    race.isAbsoluteAxis = null; // JRAでは絶対軸判定なし
  }

  return adjusted;
}
```

### normalizeAndAdjust()の分岐

```javascript
export function normalizeAndAdjust(input, options = {}) {
  const normalized = normalizePrediction(input);

  // JRA用の簡易調整（skipMark1Override: true）
  if (options.skipMark1Override) {
    return simpleAdjustForJRA(normalized);
  }

  // 南関用の完全調整
  if (normalized.races.length > 0 && normalized.races[0].hasHorseData) {
    return adjustPrediction(normalized, options);
  }

  return normalized;
}
```

---

## 🎯 買い目生成ロジック

### 馬単2段構成

**基本構造**:
```
軸-相手.相手.相手(抑え相手.相手.相手)
```

**例**:
```
9-16.13.2.3.8.11(抑え12.4.5.6.14.15.10)

軸: 9番
本線相手: 16, 13, 2, 3, 8, 11 (6点)
抑え相手: 12, 4, 5, 6, 14, 15, 10 (7点)
合計: 13点
```

### 買い目生成パターン

#### パターン1: 絶対軸（isAbsoluteAxis: true）

**本命を軸固定 + 相手流し**

```
本命-対抗.単穴.連下最上位.連下1.連下2.連下3(抑え補欠1.補欠2.補欠3)
```

**例**:
```
本命: 9番（19点）← 絶対軸
対抗: 16番（15点）
単穴: 13番（12点）
連下最上位: 2番（10点）
連下: 3番（8点）、8番（7点）、11番（6点）
補欠: 12番（5点）、4番（4点）、5番（3点）

買い目:
9-16.13.2.3.8.11(抑え12.4.5)
```

#### パターン2: 通常（isAbsoluteAxis: false）

**本命-相手 + 対抗-相手 の2ライン**

```
本命-対抗.単穴.連下最上位.連下1.連下2.連下3(抑え補欠1.補欠2.補欠3)
対抗-本命.単穴.連下最上位.連下1.連下2.連下3(抑え補欠1.補欠2.補欠3)
```

**例**:
```
本命: 9番（15点）
対抗: 16番（14点）← 差1点（絶対軸ではない）
単穴: 13番（12点）
連下最上位: 2番（10点）
連下: 3番（8点）、8番（7点）、11番（6点）
補欠: 12番（5点）、4番（4点）、5番（3点）

買い目:
9-16.13.2.3.8.11(抑え12.4.5)
16-9.13.2.3.8.11(抑え12.4.5)
```

---

## 🔍 南関 vs 中央の違い

### 南関競馬（独自予想）

| 項目 | 内容 |
|------|------|
| **調整方式** | `adjustPrediction()` 完全適用 |
| **印1の扱い** | 印1（◎○▲）で本命・対抗・単穴を強制決定 |
| **role変更** | あり（印1優先、連下3頭制限） |
| **絶対軸判定** | あり（19/20点 or 差4点以上） |
| **買い目** | 1ライン or 2ライン（絶対軸判定による） |

### 中央競馬（JRA）

| 項目 | 内容 |
|------|------|
| **調整方式** | `simpleAdjustForJRA()` 簡易適用 |
| **印1の扱い** | 無視（assignmentをそのまま保持） |
| **role変更** | なし（assignmentを一切変更しない） |
| **絶対軸判定** | なし（常に null） |
| **買い目** | 2ライン固定（本命-相手、対抗-相手） |

### コード例

**南関競馬**:
```javascript
const adjusted = normalizeAndAdjust(input);
// → adjustPrediction()適用、印1で役割決定
```

**中央競馬**:
```javascript
const adjusted = normalizeAndAdjust(input, { skipMark1Override: true });
// → simpleAdjustForJRA()適用、assignmentを保持
```

---

## 📊 データフロー全体図

```
【南関競馬】
keiba-data-shared/nankan/predictions/YYYY/MM/YYYY-MM-DD.json
  ↓
normalizePrediction() - 正規化
  ↓
adjustPrediction() - 完全調整
  ├─ Step 0: 印1で役割決定
  ├─ Step 1: displayScore計算
  ├─ Step 4: 連下3頭制限
  ├─ Step 5: 絶対軸判定
  └─ Step 6: 表示用印生成
  ↓
買い目生成（1ライン or 2ライン）
  ↓
表示（/prediction）

【中央競馬】
keiba-data-shared/jra/predictions/YYYY/MM/YYYY-MM-DD.json
  ↓
normalizePrediction() - 正規化
  ↓
simpleAdjustForJRA() - 簡易調整
  ├─ displayScore計算のみ
  ├─ mark生成のみ
  └─ assignment（本命・対抗・単穴）を保持
  ↓
買い目生成（2ライン固定）
  ↓
表示（/prediction-jra）
```

---

## 🚨 重要な注意事項

### 1. 印1の扱い（南関のみ）

**印1とは**: 記者印1（◎○▲）、独自予想の最も重要な指標

```javascript
// ❌ 間違い: assignmentを信頼
const honmei = race.horses.find(h => h.assignment === '本命');

// ✅ 正解: 印1を優先
const honmei = race.horses.find(h => h.mark1 === '◎');
if (honmei) honmei.role = '本命';
```

### 2. 中央競馬でのrole保持

**問題**: 印1で役割を上書きすると、JRAのassignment（本命・対抗・単穴）が消える

```javascript
// ❌ 間違い（中央競馬）
const adjusted = adjustPrediction(normalized); // 印1で上書き

// ✅ 正解（中央競馬）
const adjusted = normalizeAndAdjust(normalized, { skipMark1Override: true });
// → assignmentを保持
```

### 3. 絶対軸の判定（南関のみ）

**絶対軸とは**: 信頼度が高い本命（19/20点 or 差4点以上）

- ✅ 南関: 絶対軸判定あり → 1ライン買い目
- ❌ 中央: 絶対軸判定なし → 常に2ライン買い目

---

## 📝 まとめ

### 南関競馬

- **独自予想**: 印1（◎○▲）を最優先
- **役割変更**: あり（印1優先、連下3頭制限）
- **絶対軸判定**: あり（19/20点 or 差4点以上）
- **買い目**: 1ライン or 2ライン
- **調整関数**: `adjustPrediction()`

### 中央競馬

- **外部予想**: assignment（本命・対抗・単穴）を保持
- **役割変更**: なし（assignmentを一切変更しない）
- **絶対軸判定**: なし（常に null）
- **買い目**: 2ライン固定
- **調整関数**: `simpleAdjustForJRA()`

### 共通ルール

- **rawScore**: AI評価点（0〜20点）
- **displayScore**: rawScore + 70（表示用）
- **role**: 本命・対抗・単穴・連下最上位・連下・補欠・無
- **mark**: ◎○▲△×-（role から生成）
- **買い目**: 馬単2段構成（本線 + 抑え）

---

**📅 最終更新日**: 2026-02-14
**✍️ 作成者**: Claude Code (クロちゃん)

このドキュメントを読めば、南関と中央の予想ロジックを完全に理解できます！
