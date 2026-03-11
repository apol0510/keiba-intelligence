# 複数会場同日開催チェックリスト

## 🚨 南関2会場同日開催の注意点 🚨

### 基本情報

- **南関4会場**: 大井・川崎・船橋・浦和
- **同日開催**: 1〜2会場（例: 大井＋川崎）
- **レース数**: 12R/会場（2会場なら24R）

### 過去の不具合事例

#### ❌ 2会場同時開催時に片方の会場が消える

**問題:**
- 大井＋川崎開催日に、大井のレースのみ表示される
- 川崎の12レースが消失
- 月間統計が誤る

**原因:**
- `venue` フィールドが単一文字列（"大井"）のみ
- `venues` 配列がない
- マッチング時に会場を考慮していない

**修正:**
- archiveResults.jsonに `venues` 配列を追加
- マッチング時に `venue` で正規化して判定

---

## 📊 データ構造：南関 vs 中央 📊

### 南関（1〜2会場）

```json
{
  "date": "2026-03-10",
  "venue": "大井・川崎",
  "venues": ["大井", "川崎"],
  "totalRaces": 24,
  "races": [
    {
      "raceNumber": 1,
      "raceName": "3歳1組",
      "venue": "大井"
    },
    {
      "raceNumber": 1,
      "raceName": "3歳2組",
      "venue": "川崎"
    }
  ]
}
```

### 中央（2〜4会場）

```json
{
  "date": "2026-02-14",
  "venue": "京都・小倉・東京",
  "venues": ["京都", "小倉", "東京"],
  "totalRaces": 36,
  "races": [
    {
      "raceNumber": 1,
      "raceName": "3歳未勝利",
      "venue": "京都"
    },
    {
      "raceNumber": 1,
      "raceName": "4歳以上1勝クラス",
      "venue": "小倉"
    }
  ]
}
```

---

## 🔍 マッチングロジックの違い 🔍

### 南関（importResults.js）

#### 現在の実装（簡易版）

```javascript
// raceNumberのみでマッチング
const predRace = predictions.races.find(p => p.raceInfo.raceNumber === raceNumber);
```

**理由:**
- 南関は1会場のみの日が多い
- 2会場同時開催でも、会場名が明示的に分かれている

#### 2会場同時開催時の処理

```javascript
// venue フィールドがある場合は会場も考慮
if (race.venue) {
  const predRace = predictions.races.find(p => {
    return p.raceInfo.raceNumber === raceNumber &&
           p.raceInfo.venue === race.venue;
  });
}
```

---

### 中央（importResultsJra.js）

#### 必須実装（会場名正規化）

```javascript
// ✅ 正解（中央競馬専用ロジック）
const predRace = predictions.find(p => {
  const predRaceNum = p.raceInfo.raceNumber;
  const predVenue = normalizeVenue(p.raceInfo.venue);
  const raceVenue = normalizeVenue(race.venue);
  return predRaceNum === raceNumber && predVenue === raceVenue;
});
```

#### 会場名正規化関数

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

#### ❌ 間違った実装例

```javascript
// ❌ 間違い（南関と同じロジック）
const predRace = predictions.find(p => p.raceInfo.raceNumber === raceNumber);
// → 京都1R、小倉1R、東京1Rが混在して誤マッチング
// → 的中率が25%など異常に低くなる
```

---

## 🛡️ チェックリスト 🛡️

### importResults.js / importResultsJra.js 修正時

- [ ] `raceNumber` + `venue` の両方でマッチングしているか
- [ ] 会場名正規化（normalizeVenue）を実装しているか（中央のみ）
- [ ] `venues` 配列を正しく生成しているか
- [ ] 2会場同時開催時にレースが消失しないか

### archiveResults.json / archiveResultsJra.json 確認時

- [ ] `venue` フィールドに全会場名が含まれているか（例: "京都・小倉・東京"）
- [ ] `venues` 配列が正しく生成されているか
- [ ] `races[].venue` フィールドが各レースに存在するか
- [ ] `totalRaces` が全会場のレース数合計になっているか

### 月別アーカイブページ確認時

- [ ] 2会場同時開催日のレースが全て表示されるか
- [ ] 会場名が正しく表示されるか（大井・川崎など）
- [ ] 月間統計が正しく集計されているか

---

## 🚨 過去の不具合と修正履歴 🚨

### 2026-02-14: 中央競馬的中率25%問題

**問題:**
- 京都・小倉・東京3会場開催
- 的中率が25%と異常に低い
- 京都1R、小倉1R、東京1Rが混在して誤マッチング

**原因:**
```javascript
// ❌ 間違い
const predRace = predictions.find(p => p.raceInfo.raceNumber === raceNumber);
```

**修正:**
```javascript
// ✅ 正解
const predRace = predictions.find(p => {
  const predRaceNum = p.raceInfo.raceNumber;
  const predVenue = normalizeVenue(p.raceInfo.venue);
  const raceVenue = normalizeVenue(race.venue);
  return predRaceNum === raceNumber && predVenue === raceVenue;
});
```

**効果:**
- 的中率 25% → 55.6% に改善
- 正しいレースとマッチング

---

### 2026-03-10: 南関2会場同時開催対応（想定）

**想定される問題:**
- 大井＋川崎開催日に、大井のレースのみ表示
- 川崎の12レースが消失

**対策:**
- `venues` 配列を追加
- `races[].venue` フィールドを追加
- マッチング時に会場も考慮

---

## 📚 参照ドキュメント 📚

- [AI_RULES.md](./AI_RULES.md) - AI作業ルール
- [DATA_FORMAT.md](./DATA_FORMAT.md) - データフォーマット仕様
- [RESULTS_SYSTEM_ARCHITECTURE.md](./RESULTS_SYSTEM_ARCHITECTURE.md) - 結果システム設計
- [ARCHIVE_OPERATIONS.md](./ARCHIVE_OPERATIONS.md) - アーカイブ操作手順

---

**作成日**: 2026-03-11
**最終更新**: 2026-03-11
**目的**: 複数会場同日開催時の不具合防止、過去の不具合事例の記録
