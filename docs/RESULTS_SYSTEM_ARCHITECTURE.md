# 結果システム全体設計

## 🎯 結果システムの役割 🎯

### keiba-data-shared vs keiba-intelligence

| プロジェクト | 役割 | 結果データ | 予想データ |
|------------|------|-----------|-----------|
| **keiba-data-shared** | データアーカイブ・SEO対策 | 自由に保存（予想なしでもOK） | 任意 |
| **keiba-intelligence** | AI予想サイト・的中実績表示 | 予想がある日付のみ処理 | 必須 |

### 自動連携フロー

```
keiba-data-shared（結果データPush）
  ↓
GitHub Actions: dispatch-results-intelligence.yml 起動
  ↓
【チェック1】12レース揃っているか確認
  ↓
✅ 12レース揃っている場合のみ
  ↓
repository_dispatch イベント送信（results-updated）
  ↓
keiba-intelligence の GitHub Actions 起動
  ↓
importResults.js 実行
  ↓
【チェック2】予想データが存在するか確認
  ├─ ✅ 予想データあり → 的中判定実行 → archiveResults.json更新
  └─ ⏭️  予想データなし → スキップ（正常終了）
```

---

## 📁 importResults系スクリプトの役割 📁

### importResults.js（南関競馬）

#### 責務

1. **結果データ取得** - keiba-data-sharedから取得
2. **予想データ読み込み** - src/data/predictions/から読み込み
3. **的中判定** - 馬単（1着-2着）の一致判定
4. **archiveResults.json更新** - 日付単位でreplace（重複排除）
5. **旧フォーマット検証** - 保存前に禁止キーチェック

#### ファイルパス

- 実装: `scripts/importResults.js`
- 予想データ: `src/data/predictions/YYYY/MM/YYYY-MM-DD.json`
- アーカイブ: `src/data/archiveResults.json`

#### 処理フロー

```
1. 結果データ取得（keiba-data-shared: nankan/results/YYYY/MM/YYYY-MM-DD.json）
   ↓
2. 予想データ読み込み（src/data/predictions/YYYY/MM/YYYY-MM-DD.json）
   ├─ ✅ 予想データあり → 次へ
   └─ ⏭️  予想データなし → スキップ（正常終了）
   ↓
3. 的中判定（レース単位）
   - raceNumber + venue でマッチング
   - 軸-相手が1着-2着 or 2着-1着に一致 → 的中
   ↓
4. 統計計算
   - 的中率 = (的中レース数 ÷ 総レース数) × 100
   - 回収率（2段階調整） = (総払戻額 ÷ 投資額) × 100
   ↓
5. archiveResults.json更新
   - 同じ日付のエントリを削除（重複排除）
   - 新しいエントリを追加
   - 日付降順ソート
   ↓
6. 旧フォーマット検証
   - forbiddenKeys チェック
   - 検出時はエラーで中断
   ↓
7. 保存
```

---

### importResultsJra.js（中央競馬）

#### 南関との違い

| 項目 | 南関（importResults.js） | 中央（importResultsJra.js） |
|------|------------------------|---------------------------|
| **会場数** | 1〜2会場 | 2〜4会場 |
| **レース数** | 12〜24レース | 24〜48レース |
| **マッチング** | `raceNumber` のみ | `raceNumber` + `venue` 必須 |
| **会場名正規化** | なし | normalizeVenue() 必須 |
| **アーカイブ** | archiveResults.json | archiveResultsJra.json |

#### 会場名正規化（必須）

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

#### マッチングロジック（正）

```javascript
// ✅ 正解（中央競馬専用ロジック）
const predRace = predictions.find(p => {
  const predRaceNum = p.raceInfo.raceNumber;
  const predVenue = normalizeVenue(p.raceInfo.venue);
  const raceVenue = normalizeVenue(race.venue);
  return predRaceNum === raceNumber && predVenue === raceVenue;
});
```

#### ❌ 間違った実装例

```javascript
// ❌ 間違い（南関と同じロジック）
const predRace = predictions.find(p => p.raceInfo.raceNumber === raceNumber);
// → 京都1R、小倉1R、東京1Rが混在して誤マッチング（的中率25%など）
```

---

## 📊 アーカイブデータ構造の違い 📊

### 南関（archiveResults.json）

```json
{
  "date": "2026-02-14",
  "venue": "大井",
  "races": [
    {
      "raceNumber": 1,
      "raceName": "3歳2組"
      // venue フィールドなし
    }
  ]
}
```

### 中央（archiveResultsJra.json）

```json
{
  "date": "2026-02-14",
  "venue": "京都・小倉・東京",
  "venues": ["京都", "小倉", "東京"],
  "races": [
    {
      "raceNumber": 1,
      "raceName": "3歳未勝利",
      "venue": "京都" // 各レースに会場情報
    }
  ]
}
```

---

## 🔍 的中判定ロジック 🔍

### 共通ルール

- **券種**: 馬単（1着-2着の組み合わせ）
- **買い目**: 2段構成（本線 + 抑え）
  - 例: `"9-16.13.2.3.8.11(抑え12.4.5.6.14.15.10)"`
- **的中条件**: 軸-相手が1着-2着 or 2着-1着に一致

### 買い目パース処理

```javascript
function parseBettingFormula(formula) {
  // 例: "9-16.13.2.3.8.11(抑え12.4.5.6.14.15.10)"
  const [mainPart, fallbackPart] = formula.split('(抑え');
  const [axis, partnersStr] = mainPart.split('-');
  const partners = partnersStr.split('.');
  const fallback = fallbackPart ? fallbackPart.replace(')', '').split('.') : [];

  return {
    lines: [
      { axis, partners, fallback }
    ]
  };
}
```

### 的中判定処理

```javascript
function isHit(axis, partners, first, second) {
  const allPartners = [...partners, ...fallback];

  return (
    (axis === first && allPartners.includes(second)) ||
    (axis === second && allPartners.includes(first))
  );
}
```

---

## 📈 買い目点数ロジック（2段階調整方式） 📈

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

### 実装箇所

- `scripts/importResults.js` (Line 275-305)
- `scripts/importResultsJra.js` (同様のロジック)

詳細: [`BET_POINT_LOGIC.md`](../BET_POINT_LOGIC.md)

---

## 🗂️ 月別アーカイブページ 🗂️

### ページ構造

- URL: `/archive/YYYY/MM/`
- ファイル: `src/pages/archive/[year]/[month]/index.astro`

### データソース

- 南関: `src/data/archiveResults.json`
- 中央: `src/data/archiveResultsJra.json`

### 表示内容

1. **月間サマリー統計**
   - 開催日数
   - 月間的中率
   - 月間回収率
   - 月間合計配当

2. **日別結果一覧**
   - 日付・会場
   - 的中レース数・的中率
   - 買い目点数・配当・回収率
   - 的中レース詳細（レース番号・レース名・払戻金）

### 旧フォーマット検出警告

```astro
{(() => {
  // 旧フォーマット検出警告
  if (dayData.raceResults) {
    console.warn(`⚠️  旧フォーマット検出: ${dayData.date} (raceResults)`);
  }

  // 新フォーマット優先（racesのみ使用）
  const races = dayData.races || [];
  return races.filter(race => race.isHit).map((race) => {
```

---

## 🚨 重要な注意事項 🚨

### 1. 複数会場開催時の注意点

- **南関**: 1〜2会場同時開催あり（大井・川崎など）
- **中央**: 2〜4会場同時開催（京都・小倉・東京など）

詳細: [`MULTI_VENUE_CHECK.md`](./MULTI_VENUE_CHECK.md)

### 2. 予想データなしのスキップ処理

```javascript
try {
  prediction = loadPrediction(date);
} catch (error) {
  // 予想データがない場合はスキップ
  console.log(`⏭️  予想データが見つかりません: ${date}`);
  console.log(`   keiba-intelligenceでは的中判定をスキップします`);
  process.exit(0); // 正常終了（エラーではない）
}
```

### 3. 旧フォーマット混入防止

- 保存前に必ず検証
- forbiddenKeys: `['raceResults', 'honmeiHit', 'umatanHit', 'sanrenpukuHit']`
- 検出時はエラーで中断

詳細: [`DATA_FORMAT.md`](./DATA_FORMAT.md)

---

## 📚 参照ドキュメント 📚

- [AI_RULES.md](./AI_RULES.md) - AI作業ルール
- [DATA_FORMAT.md](./DATA_FORMAT.md) - データフォーマット仕様
- [MULTI_VENUE_CHECK.md](./MULTI_VENUE_CHECK.md) - 複数会場対応
- [ARCHIVE_OPERATIONS.md](./ARCHIVE_OPERATIONS.md) - アーカイブ操作手順
- [BET_POINT_LOGIC.md](../BET_POINT_LOGIC.md) - 買い目点数ロジック

---

**作成日**: 2026-03-11
**最終更新**: 2026-03-11
**目的**: 結果システム全体設計の明確化、南関 vs 中央の違いの整理
