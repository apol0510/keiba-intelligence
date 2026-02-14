# 結果判定ロジック仕様書

## 📋 概要

南関競馬と中央競馬（JRA）の的中判定システムの完全仕様。
このドキュメントを読めば、誰でも結果判定ロジックを理解できる。

---

## 🎯 基本仕様

### 共通仕様（南関・中央共通）

| 項目 | 仕様 |
|------|------|
| **券種** | 馬単（1着-2着の組み合わせを予想） |
| **買い目構造** | 2段構成（本線 + 抑え） |
| **買い目点数** | 2段階調整方式（8点 or 12点/レース） |
| **的中判定** | 軸-相手の組み合わせが1着-2着 or 2着-1着に一致 |
| **払戻金** | 的中した場合、1点（100円）分の払戻金を計算 |

### 買い目フォーマット

```
例: "9-16.13.2.3.8.11(抑え12.4.5.6.14.15.10)"

構造:
  軸: 9番
  本線相手: 16, 13, 2, 3, 8, 11 (6点)
  抑え相手: 12, 4, 5, 6, 14, 15, 10 (7点)
  合計: 13点
```

### 的中判定パターン

**パターン1: 軸が1着**
- 1着: 軸（9番）
- 2着: 相手（本線 or 抑え）のいずれか
- 例: 9-16（的中！）、9-12（的中！）

**パターン2: 相手が1着**
- 1着: 相手（本線 or 抑え）のいずれか
- 2着: 軸（9番）
- 例: 16-9（的中！）、12-9（的中！）

**不的中の例**
- 1-2（軸も相手も含まれていない）
- 16-13（両方とも相手だが、軸が含まれていない）

---

## 💰 2段階買い目調整ロジック

### 目的

- 回収率を適切に計算し、実際の投資額に近い数値を表示
- 基本は8点で計算（収支改善）
- 高配当的中時（回収率300%超）は12点で再計算（過度な回収率を抑制）

### ロジック詳細

```javascript
// 第1段階: 基本8点で仮計算
let betPointsPerRace = 8;
let betAmount = totalRaces * 8 * 100; // 例: 12レース × 8点 × 100円 = 9,600円
let returnRate = (totalPayout / betAmount) * 100;

// 第2段階: 回収率300%超なら12点で再計算
if (returnRate > 300) {
  betPointsPerRace = 12;
  betAmount = totalRaces * 12 * 100; // 例: 12レース × 12点 × 100円 = 14,400円
  returnRate = (totalPayout / betAmount) * 100;
}
```

### 具体例

**ケース1: 通常日（回収率300%以下）**
```
12レース × 8点 = 9,600円投資
払戻: 20,000円
回収率: 208.3%
→ そのまま8点で計算
```

**ケース2: 高配当日（回収率300%超）**
```
【第1段階】
12レース × 8点 = 9,600円投資
払戻: 35,000円
回収率: 364.6%（300%超！）

【第2段階】自動調整
12レース × 12点 = 14,400円投資
払戻: 35,000円
回収率: 243.1%（適正化）
→ 12点で再計算
```

### 詳細仕様

- **BET_POINT_LOGIC.md** を参照

---

## 🏇 南関競馬（Nankan）の結果判定

### ファイル

- **スクリプト**: `scripts/importResults.js`
- **アーカイブ**: `src/data/archiveResults.json`

### データ構造

**予想データ**: `src/data/predictions/YYYY/MM/YYYY-MM-DD.json`
```json
{
  "date": "2026-02-14",
  "venue": "大井",
  "races": [
    {
      "raceInfo": {
        "raceNumber": 1,
        "raceName": "3歳2組"
      },
      "bettingLines": {
        "umatan": [
          "9-16.13.2.3.8.11(抑え12.4.5.6.14.15.10)",
          "16-9.13.2.3.8.11(抑え12.4.5.6.14.15.10)"
        ]
      }
    }
  ]
}
```

**結果データ**: `keiba-data-shared/nankan/results/YYYY/MM/YYYY-MM-DD.json`
```json
{
  "date": "2026-02-14",
  "venue": "大井",
  "races": [
    {
      "raceNumber": 1,
      "raceName": "3歳2組",
      "results": [
        { "number": 9, "name": "ホースA" },
        { "number": 16, "name": "ホースB" },
        { "number": 2, "name": "ホースC" }
      ],
      "payouts": {
        "umatan": [
          { "combination": "9-16", "payout": 1500 }
        ]
      }
    }
  ]
}
```

### マッチングロジック

```javascript
// 1. raceNumberで一致するレースを検索
const predRace = predictions.races.find(p => p.raceInfo.raceNumber === raceNumber);

// 2. 買い目を取得
const bettingLines = predRace.bettingLines.umatan;

// 3. 各買い目で的中判定
bettingLines.forEach(line => {
  if (checkUmatanHit(line, race)) {
    // 的中！
  }
});
```

### 特徴

- ✅ **単会場**: 大井・川崎・船橋・浦和のいずれか1会場のみ
- ✅ **12レース固定**: 常に12レース
- ✅ **シンプル**: raceNumberのみでマッチング

---

## 🏆 中央競馬（JRA）の結果判定

### ファイル

- **スクリプト**: `scripts/importResultsJra.js`
- **アーカイブ**: `src/data/archiveResultsJra.json`

### データ構造

**予想データ**: `src/data/predictions/jra/YYYY/MM/YYYY-MM-DD.json`
```json
{
  "date": "2026-02-14",
  "totalRaces": 36,
  "venues": [
    {
      "venue": "京都",
      "predictions": [
        {
          "raceInfo": {
            "raceNumber": 1,
            "raceName": "3歳未勝利",
            "venue": "京都"
          },
          "bettingLines": {
            "umatan": [
              "10-7.4.13.1.11.2(抑え5.9)",
              "7-10.4.13.1.11.2(抑え5.9)"
            ]
          }
        }
      ]
    },
    {
      "venue": "小倉",
      "predictions": [...]
    },
    {
      "venue": "東京",
      "predictions": [...]
    }
  ]
}
```

**結果データ**: `keiba-data-shared/jra/results/YYYY/MM/YYYY-MM-DD.json`
```json
{
  "date": "2026-02-14",
  "venue": "JRA統合",
  "totalRaces": 36,
  "races": [
    {
      "raceNumber": 1,
      "raceName": "3歳未勝利",
      "venue": "京都",
      "results": [
        { "number": 10, "name": "リーチグローリー" },
        { "number": 4, "name": "ウンナターシャ" },
        { "number": 11, "name": "ドリームキャリー" }
      ],
      "payouts": {
        "umatan": [
          { "combination": "10-4", "payout": 900 }
        ]
      }
    },
    {
      "raceNumber": 1,
      "raceName": "3歳未勝利",
      "venue": "小倉",
      "results": [...]
    },
    {
      "raceNumber": 1,
      "raceName": "3歳未勝利",
      "venue": "東京",
      "results": [...]
    }
  ]
}
```

### マッチングロジック（重要！）

**❌ 間違い（南関と同じロジック）**
```javascript
// raceNumberのみでマッチング（バグ！）
const predRace = predictions.find(p => p.raceInfo.raceNumber === raceNumber);
// → 京都1R、小倉1R、東京1Rが混在して誤マッチング
```

**✅ 正解（中央競馬専用ロジック）**
```javascript
// raceNumberとvenueの両方でマッチング
const predRace = predictions.find(p => {
  const predRaceNum = p.raceInfo.raceNumber;
  const predVenue = normalizeVenue(p.raceInfo.venue);
  const raceVenue = normalizeVenue(race.venue);

  return predRaceNum === raceNumber && predVenue === raceVenue;
});
```

### 会場名正規化

```javascript
function normalizeVenue(venue) {
  const venueMap = {
    '京都': 'KYO', 'KYO': 'KYO',
    '小倉': 'KOK', 'KOK': 'KOK',
    '東京': 'TOK', 'TOK': 'TOK',
    '中山': 'NAK', 'NAK': 'NAK',
    '阪神': 'HAN', 'HAN': 'HAN',
    '新潟': 'NII', 'NII': 'NII',
    '札幌': 'SAP', 'SAP': 'SAP',
    '函館': 'HAK', 'HAK': 'HAK',
    '福島': 'FUK', 'FUK': 'FUK',
    '中京': 'CHU', 'CHU': 'CHU'
  };
  return venueMap[venue] || venue;
}
```

### 特徴

- ✅ **多会場**: 同日に2〜4会場で開催（京都・小倉・東京など）
- ✅ **36レース**: 3会場 × 12レース = 36レース
- ✅ **複雑**: raceNumberとvenueの両方でマッチングが必要
- ✅ **会場別統計**: 各会場の的中率・払戻金を個別表示

---

## 📊 アーカイブデータ構造

### 南関競馬（archiveResults.json）

```json
[
  {
    "date": "2026-02-14",
    "venue": "大井",
    "totalRaces": 12,
    "hitRaces": 9,
    "missRaces": 3,
    "hitRate": 75.0,
    "betAmount": 9600,
    "betPointsPerRace": 8,
    "totalPayout": 28500,
    "returnRate": 296.9,
    "races": [
      {
        "raceNumber": 1,
        "raceName": "3歳2組",
        "result": {
          "first": { "number": 9, "name": "ホースA" },
          "second": { "number": 16, "name": "ホースB" },
          "third": { "number": 2, "name": "ホースC" }
        },
        "bettingLines": [
          "9-16.13.2.3.8.11(抑え12.4.5.6.14.15.10)",
          "16-9.13.2.3.8.11(抑え12.4.5.6.14.15.10)"
        ],
        "bettingPoints": 26,
        "isHit": true,
        "hitLines": ["9-16.13.2.3.8.11(抑え12.4.5.6.14.15.10)"],
        "umatan": {
          "combination": "9-16",
          "payout": 1500
        }
      }
    ],
    "verifiedAt": "2026-02-14T12:00:00.000Z"
  }
]
```

### 中央競馬（archiveResultsJra.json）

```json
[
  {
    "date": "2026-02-14",
    "venue": "京都・小倉・東京",
    "venues": ["京都", "小倉", "東京"],
    "totalRaces": 36,
    "hitRaces": 25,
    "missRaces": 11,
    "hitRate": 69.4,
    "betAmount": 28800,
    "betPointsPerRace": 8,
    "totalPayout": 85370,
    "returnRate": 296.4,
    "races": [
      {
        "raceNumber": 1,
        "raceName": "3歳未勝利",
        "venue": "京都",
        "result": {
          "first": { "number": 10, "name": "リーチグローリー" },
          "second": { "number": 4, "name": "ウンナターシャ" },
          "third": { "number": 11, "name": "ドリームキャリー" }
        },
        "bettingLines": [
          "10-7.4.13.1.11.2(抑え5.9)",
          "7-10.4.13.1.11.2(抑え5.9)"
        ],
        "bettingPoints": 16,
        "isHit": true,
        "hitLines": ["10-7.4.13.1.11.2(抑え5.9)"],
        "umatan": {
          "combination": "10-4",
          "payout": 900
        }
      }
    ],
    "verifiedAt": "2026-02-14T12:00:00.000Z"
  }
]
```

### 重要なフィールド

| フィールド | 説明 |
|-----------|------|
| `venue` | 表示用会場名（南関: "大井"、中央: "京都・小倉・東京"） |
| `venues` | 会場配列（中央のみ: `["京都", "小倉", "東京"]`） |
| `races[].venue` | 各レースの会場（中央のみ: "京都"/"小倉"/"東京"） |
| `betPointsPerRace` | 実際の買い目点数（8 or 12） |
| `isHit` | 的中フラグ（true/false） |
| `hitLines` | 的中した買い目（複数ある場合もあり） |

---

## 🔍 トラブルシューティング

### 的中率が異常に低い（25%など）

**原因**: 中央競馬でraceNumberのみでマッチングしている

```javascript
// ❌ バグコード
const predRace = predictions.find(p => p.raceInfo.raceNumber === raceNumber);
```

**解決**: venueも一致させる

```javascript
// ✅ 修正後
const predRace = predictions.find(p => {
  return p.raceInfo.raceNumber === raceNumber
    && normalizeVenue(p.raceInfo.venue) === normalizeVenue(race.venue);
});
```

### 会場情報が表示されない

**原因**: `races[].venue` フィールドが保存されていない

```javascript
// ❌ バグコード
raceResults.push({
  raceNumber,
  raceName: race.raceName,
  // venue: raceVenue が抜けている
  result: { ... }
});
```

**解決**: venueフィールドを追加

```javascript
// ✅ 修正後
raceResults.push({
  raceNumber,
  raceName: race.raceName,
  venue: raceVenue, // 追加！
  result: { ... }
});
```

### "JRA統合" と表示される

**原因**: 会場別の情報を集約していない

**解決**: venues配列を生成し、表示用文字列を作成

```javascript
// ✅ 修正後
const venues = [...new Set(raceResults.map(r => r.venue))].sort();
const venueDisplay = venues.join('・'); // "京都・小倉・東京"
```

---

## 📝 まとめ

### 南関競馬

- **会場**: 1会場のみ（大井・川崎・船橋・浦和）
- **レース数**: 12レース
- **マッチング**: raceNumberのみ
- **シンプル**: 追加の会場処理は不要

### 中央競馬

- **会場**: 2〜4会場（京都・小倉・東京など）
- **レース数**: 24〜48レース（会場数 × 12）
- **マッチング**: raceNumber + venue（両方必要！）
- **複雑**: 会場名正規化、会場別統計が必要

### 共通ルール

- **券種**: 馬単
- **買い目**: 2段構成（本線 + 抑え）
- **買い目点数**: 2段階調整（8点 or 12点）
- **的中判定**: 軸-相手が1着-2着 or 2着-1着に一致

---

**📅 最終更新日**: 2026-02-14
**✍️ 作成者**: Claude Code (クロちゃん)

このドキュメントを読めば、南関と中央の結果判定ロジックを完全に理解できます！
