# データフォーマット仕様

## 🚨 旧フォーマット禁止ルール 🚨

### 禁止キー（旧フォーマット）

以下のキーは**絶対に使用禁止**：

```json
{
  "raceResults": [...],    // ❌ 禁止（新: races）
  "honmeiHit": true,       // ❌ 禁止（新: isHit）
  "umatanHit": false,      // ❌ 禁止（新: isHit）
  "sanrenpukuHit": true    // ❌ 禁止（新: isHit）
}
```

### 新フォーマット（正）

```json
{
  "races": [...],          // ✅ 正
  "isHit": true,           // ✅ 正
  "hitLines": [...]        // ✅ 正
}
```

### 旧フォーマットの問題点

- **的中判定が誤る**: 本命的中のみカウント、他の買い目的中を無視
- **回収率が誤表示**: 実際の払戻金と異なる
- **ビルド失敗**: validateArchiveFormat.jsでエラー

### 検証方法

```bash
# アーカイブフォーマット検証
npm run validate:archive
```

**期待結果:**
```
✅ 全てのアーカイブが正常です
```

**エラー時:**
```
❌ アーカイブフォーマットエラー！
   旧フォーマット検出: raceResults, honmeiHit
```

---

## 📊 archiveResults.json（南関競馬）

### フォーマット仕様

```json
[
  {
    "date": "2026-03-06",
    "venue": "川崎",
    "totalRaces": 12,
    "hitRaces": 9,
    "hitRate": 75.0,
    "betAmount": 9600,
    "totalPayout": 21680,
    "returnRate": 225.8,
    "betPointsPerRace": 8,
    "races": [
      {
        "raceNumber": 1,
        "raceName": "3歳1組",
        "isHit": true,
        "hitLines": [
          {
            "axis": "6",
            "partners": ["1", "5", "8", "2", "3", "4"],
            "fallback": ["7"],
            "winningCombination": "6-1",
            "payout": 380
          }
        ]
      },
      {
        "raceNumber": 2,
        "raceName": "3歳2組",
        "isHit": false,
        "hitLines": []
      }
    ]
  }
]
```

### フィールド説明

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `date` | string | 日付（YYYY-MM-DD形式） |
| `venue` | string | 会場名（大井/川崎/船橋/浦和） |
| `totalRaces` | number | 総レース数（12） |
| `hitRaces` | number | 的中レース数 |
| `hitRate` | number | 的中率（%）小数点1桁 |
| `betAmount` | number | 投資額（円） |
| `totalPayout` | number | 総払戻額（円） |
| `returnRate` | number | 回収率（%）小数点1桁 |
| `betPointsPerRace` | number | レースあたり買い目点数（8 or 12） |
| `races` | array | レース詳細配列 |

#### races配列内のフィールド

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `raceNumber` | number | レース番号（1〜12） |
| `raceName` | string | レース名 |
| `isHit` | boolean | 的中フラグ |
| `hitLines` | array | 的中した買い目（isHit=trueの場合のみ） |

#### hitLines配列内のフィールド

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `axis` | string | 軸馬番号 |
| `partners` | array | 相手馬番号配列（本線） |
| `fallback` | array | 相手馬番号配列（抑え） |
| `winningCombination` | string | 的中馬番（例: "6-1"） |
| `payout` | number | 払戻金（円） |

---

## 📊 archiveResultsJra.json（中央競馬）

### フォーマット仕様

```json
[
  {
    "date": "2026-02-14",
    "venue": "京都・小倉・東京",
    "venues": ["京都", "小倉", "東京"],
    "totalRaces": 36,
    "hitRaces": 20,
    "hitRate": 55.6,
    "betAmount": 28800,
    "totalPayout": 45200,
    "returnRate": 156.9,
    "betPointsPerRace": 8,
    "races": [
      {
        "raceNumber": 1,
        "raceName": "3歳未勝利",
        "venue": "京都",
        "isHit": true,
        "hitLines": [...]
      },
      {
        "raceNumber": 1,
        "raceName": "4歳以上1勝クラス",
        "venue": "小倉",
        "isHit": false,
        "hitLines": []
      }
    ]
  }
]
```

### 南関との違い

| 項目 | 南関（archiveResults.json） | 中央（archiveResultsJra.json） |
|------|---------------------------|------------------------------|
| `venue` | 単一会場名 | 複数会場名（カンマ区切り） |
| `venues` | なし | 会場配列（["京都", "小倉", "東京"]） |
| `races[].venue` | なし | 各レースに会場情報 |
| `totalRaces` | 12 | 24〜48（会場数 × 12） |

---

## 📊 予想データフォーマット

### src/data/predictions/YYYY/MM/YYYY-MM-DD.json（南関）

```json
{
  "date": "2026-03-06",
  "venue": "川崎",
  "totalRaces": 12,
  "races": [
    {
      "raceInfo": {
        "raceNumber": 1,
        "raceName": "3歳1組",
        "venue": "川崎"
      },
      "predictions": [
        {
          "gateNumber": "6",
          "horseName": "サクラバクシンオー",
          "role": "本命",
          "displayScore": 85,
          "mark": "◎",
          "assignment": "本命"
        }
      ],
      "bettingFormula": "6-1.5.8.2.3.4(抑え7)"
    }
  ]
}
```

### src/data/predictions/jra/YYYY/MM/YYYY-MM-DD.json（中央）

```json
{
  "date": "2026-02-14",
  "venues": ["京都", "小倉", "東京"],
  "totalRaces": 36,
  "races": [
    {
      "raceInfo": {
        "raceNumber": 1,
        "raceName": "3歳未勝利",
        "venue": "京都"
      },
      "predictions": [...],
      "bettingFormula": "..."
    }
  ]
}
```

---

## 🔍 結果データフォーマット（keiba-data-shared）

### nankan/results/YYYY/MM/YYYY-MM-DD.json

```json
{
  "date": "2026-03-06",
  "venue": "川崎",
  "races": [
    {
      "raceNumber": 1,
      "raceName": "3歳1組",
      "venue": "川崎",
      "results": {
        "first": "6",
        "second": "1",
        "third": "5"
      },
      "payouts": {
        "umatan": [
          {
            "combination": "6-1",
            "payout": 380
          }
        ]
      }
    }
  ]
}
```

### jra/results/YYYY/MM/YYYY-MM-DD.json

```json
{
  "date": "2026-02-14",
  "venues": ["京都", "小倉", "東京"],
  "races": [
    {
      "raceNumber": 1,
      "raceName": "3歳未勝利",
      "venue": "京都",
      "results": {...},
      "payouts": {...}
    }
  ]
}
```

---

## ⚙️ 買い目点数ロジック（2段階調整方式）

### 基本ルール

```
第1段階: 基本8点で仮計算
  投資額 = レース数 × 8点 × 100円
  回収率（仮） = (払戻額 ÷ 投資額) × 100

第2段階: 回収率判定・調整
  IF 回収率（仮） > 300% THEN
    買い目点数 = 12点/レース
    投資額 = レース数 × 12点 × 100円
    回収率（最終） = (払戻額 ÷ 投資額) × 100
  ELSE
    回収率（最終） = 回収率（仮）
  END IF
```

### 具体例

- **通常日**: 12R × 8点 = 9,600円投資
- **高配当日**: 12R × 12点 = 14,400円投資（回収率300%超の場合）

詳細: [`BET_POINT_LOGIC.md`](../BET_POINT_LOGIC.md)

---

## 🛡️ フォーマット検証システム

### 検証レイヤー

#### Layer 1: importResults.js実行時検証

```javascript
// 保存前に旧フォーマットキーを検出
const forbiddenKeys = ['raceResults', 'honmeiHit', 'umatanHit', 'sanrenpukuHit'];

for (const key of forbiddenKeys) {
  if (archiveJson.includes(`"${key}"`)) {
    throw new Error(`旧フォーマット「${key}」が混入しています`);
  }
}
```

#### Layer 2: validateArchiveFormat.js独立検証

```bash
npm run validate:archive
```

#### Layer 3: ビルド時検証

```json
{
  "scripts": {
    "build": "npm run validate:archive && astro build"
  }
}
```

#### Layer 4: GitHub Actions検証

```yaml
- name: Validate archive format
  run: npm run validate:archive
```

---

## 📚 参照ドキュメント 📚

- [AI_RULES.md](./AI_RULES.md) - AI作業ルール
- [RESULTS_SYSTEM_ARCHITECTURE.md](./RESULTS_SYSTEM_ARCHITECTURE.md) - 結果システム設計
- [MULTI_VENUE_CHECK.md](./MULTI_VENUE_CHECK.md) - 複数会場対応
- [ARCHIVE_OPERATIONS.md](./ARCHIVE_OPERATIONS.md) - アーカイブ操作手順

---

**作成日**: 2026-03-11
**最終更新**: 2026-03-11
**目的**: データフォーマット仕様の明確化、旧フォーマット混入防止
