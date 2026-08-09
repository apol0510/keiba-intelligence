# 南関予想データの複数会場対応アーキテクチャ

## 📅 作成日・更新履歴

- **作成日**: 2026-03-14
- **最終更新**: 2026-03-14
- **目的**: 南関予想データの会場別ファイル形式への移行を記録し、再発防止を徹底する

---

## 🚨 背景：単一ファイル形式の問題点

### 従来の設計（❌ 廃止）

**ファイル形式:**
```
nankan/predictions/YYYY/MM/YYYY-MM-DD.json
```

**例:**
```
nankan/predictions/2026/03/2026-03-13.json
```

### 問題点：同日複数会場で上書きが発生

**発生シナリオ:**

```
1. 船橋の予想データを保存
   → 2026-03-13.json に船橋12レース分を保存 ✅

2. 大井の予想データを保存
   → 2026-03-13.json に大井12レース分を保存 ✅
   → 船橋のデータが上書きされて消失 ❌
```

**実際の不具合事例（2026-03-13）:**

Git履歴から確認：
- Commit 5c0cfed: `track="船橋"`, 12レース保存
- Commit 3c172c1: `track="大井"`, 12レース保存（船橋を上書き）

結果：
- keiba-data-sharedには大井のみ残る
- 船橋データは完全に消失
- keiba-intelligenceは過去にimportした船橋データを保持していたため、両会場タブが表示されていた（混乱の原因）

---

## ✅ 新設計：会場別ファイル形式

### 正規ファイル形式

**ファイル形式:**
```
nankan/predictions/YYYY/MM/YYYY-MM-DD-{VENUE}.json
```

**VENUE（会場コード）:**
- `OOI` - 大井
- `FUN` - 船橋
- `KAW` - 川崎
- `URA` - 浦和

**例:**
```
nankan/predictions/2026/03/2026-03-13-OOI.json   (大井)
nankan/predictions/2026/03/2026-03-13-FUN.json   (船橋)
```

### 効果

✅ **同日複数会場が共存可能**
- 船橋と大井が同日開催でも、それぞれ独立したファイル
- 上書きリスクゼロ

✅ **会場別データの管理が明確**
- ファイル名だけで日付と会場が識別可能
- データの整合性が向上

✅ **JRAと統一された設計**
- JRAは既に会場別ファイル形式（`jra/predictions/YYYY/MM/YYYY-MM-DD-{VENUE}.json`）
- 南関もJRAと同じ設計パターンに統一

---

## 📂 データ読み込み優先順位（importPrediction.js）

### Priority 1: 会場別ファイル（正規形式）✅

**パス:**
```
nankan/predictions/YYYY/MM/YYYY-MM-DD-{VENUE}.json
```

**用途:**
- AI予想データ（本命・対抗・単穴・連下等）

**処理:**
- `fetchVenuePredictions()` 関数で複数会場を一括取得
- 各会場のファイルを検出し、venues配列に統合

**ログ例:**
```
✅ [IMPORT] 2会場のファイルを検出: 2026-03-13-FUN.json, 2026-03-13-OOI.json
✅ [IMPORT] venues配列形式に統合完了: 2会場
```

---

### Priority 2: computer/配下（コンピ指数）

**パス:**
```
nankan/predictions/computer/YYYY/MM/YYYY-MM-DD-{VENUE}.json
```

**用途:**
- コンピ指数データ
- 騎手・調教師・斤量・馬齢性別の補完用

**処理:**
- Priority 1で見つからない場合、computer/配下を検索
- 会場別ファイルとして保存される

---

### Priority 3: 旧単一ファイル（❌ 非推奨）

**パス:**
```
nankan/predictions/YYYY/MM/YYYY-MM-DD.json
```

**用途:**
- 後方互換性維持（将来削除予定）

**処理:**
- Priority 1, 2で見つからない場合のみフォールバック
- **警告メッセージ表示:**
  ```
  ⚠️ [IMPORT] 【非推奨】従来の単一ファイルを取得します
  ⚠️ [IMPORT] 警告: 単一ファイル形式は将来廃止されます。会場別ファイルに移行してください。
  ```

---

## 🔧 修正ファイル一覧

### 1. astro-site/scripts/importPrediction.js

**修正内容:**
- 新関数 `fetchVenuePredictions()` を追加
- 会場別ファイルを優先的に取得
- 複数会場を自動検出してvenues配列に統合
- 優先順位システムの実装

**ログプレフィックス:**
- `[IMPORT]` - データ取得処理
- `[BUILD]` - ファイル生成処理
- `[SAVE]` - ファイル保存処理

---

### 2. astro-site/scripts/importResults.js

**修正内容:**
- エラーチェック用の予想データ存在確認を会場別ファイル対応
- **修正前:** `nankan/predictions/${year}/${month}/${date}.json`
- **修正後:** `nankan/predictions/${year}/${month}/${date}-${venueCode}.json`

**目的:**
- 予想データ読み込み失敗時、keiba-data-sharedに本当に存在しないかを二重確認
- 会場別ファイル形式で正確にチェック

---

### 3. astro-site/scripts/importResultsJra.js

**修正内容:**
- **カテゴリ誤り修正:** `nankan/predictions/` → `jra/predictions/`
- **会場別ファイル対応:** `${date}.json` → `${date}-${venueCode}.json`
- **JRA会場コードマップ追加:**
  ```javascript
  const venueCodeMap = {
    '東京': 'TOK', '中山': 'NAK', '京都': 'KYO', '阪神': 'HAN',
    '中京': 'CHU', '小倉': 'KOK', '新潟': 'NII', '福島': 'FKS',
    '札幌': 'SAP', '函館': 'HKD'
  };
  ```

**目的:**
- JRA用スクリプトが誤って南関パスを参照していた問題を修正
- JRAも会場別ファイル形式で正確にチェック

---

### 4. astro-site/src/pages/free-prediction.astro

**修正内容:**
- ログプレフィックスを `[PAGE]` に統一
- 会場別ファイルの読み込み状況を詳細にログ出力

**ログ例:**
```javascript
console.log('🔍 [PAGE] process.cwd():', process.cwd());
console.log('📂 [PAGE] 全ファイル一覧:', allFiles);
console.log('📅 [PAGE] 最新日付:', latestDate);
console.log('🏇 [PAGE] 表示会場一覧:', venues);
console.log('🎯 [PAGE] predictionDataがある会場:', Object.keys(predictionsByVenue));
```

---

## 🚫 重要：再発防止ルール

### ❌ 禁止事項

今後、**以下の形式を新規で実装することは禁止**:

```
predictions/YYYY/MM/YYYY-MM-DD.json
```

**理由:**
- 複数会場開催時に上書きが発生
- データロスのリスク
- JRAとの設計不整合

---

### ✅ 必須事項

**新規実装時は必ず会場別ファイル形式を使用:**

```
predictions/YYYY/MM/YYYY-MM-DD-{VENUE}.json
```

**会場コード（VENUE）:**
- 南関: OOI, FUN, KAW, URA
- JRA: TOK, NAK, KYO, HAN, CHU, KOK, NII, FKS, SAP, HKD

---

## 📝 関連コミット

### Commit 12bdfe2: 南関予想データを複数会場前提の正規形式に統一

**修正内容:**
- importPrediction.js に会場別ファイル優先取得を実装
- fetchVenuePredictions() 関数追加
- 優先順位システム実装
- free-prediction.astro のログプレフィックス統一

**コミットメッセージ:**
```
♻️ 南関予想データを複数会場前提の正規形式に統一

【問題】
- 従来の単一ファイル形式（YYYY-MM-DD.json）
- 船橋保存 → 大井保存で上書き発生
- 2026-03-13: 船橋データが消失

【新設計】
- 会場別ファイル形式（YYYY-MM-DD-{VENUE}.json）
- 船橋: 2026-03-13-FUN.json
- 大井: 2026-03-13-OOI.json
- 複数会場が共存可能

【実装】
- fetchVenuePredictions() 関数追加
- 優先順位: 会場別 > computer/ > 旧単一ファイル（非推奨）
- ログプレフィックス統一: [IMPORT], [BUILD], [SAVE], [PAGE]

🤖 Generated with Claude Code
Co-Authored-By: Claude <noreply@anthropic.com>
```

---

### Commit 2f4c195: 結果インポート時の予想データ存在確認を会場別ファイル対応

**修正内容:**
- importResults.js のエラーチェック修正
- importResultsJra.js のカテゴリ誤り修正 + 会場別ファイル対応
- JRA会場コードマップ追加

**コミットメッセージ:**
```
🐛 結果インポート時の予想データ存在確認を会場別ファイル対応に修正

【修正内容】
- importResults.js: 南関の予想データ確認をYYYY-MM-DD-{VENUE}.jsonに変更
- importResultsJra.js: JRAの予想データ確認を以下の通り修正
  - nankan → jra に修正
  - 単一ファイル → 会場別ファイル（YYYY-MM-DD-{VENUE}.json）に変更
  - JRA会場コードマップ追加（TOK/NAK/KYO/HAN等）

【修正前の問題】
- 南関: YYYY-MM-DD.json（単一ファイル形式）を参照
  → 複数会場開催日に正しく検出できない
- JRA: nankan/predictions/YYYY-MM-DD.json を参照
  → カテゴリ違い + 単一ファイル形式

【修正後】
- 南関: nankan/predictions/YYYY/MM/YYYY-MM-DD-{VENUE}.json
- JRA: jra/predictions/YYYY/MM/YYYY-MM-DD-{VENUE}.json
- 会場コードを正しくマッピング（大井→OOI、東京→TOK等）

【再発防止】
- エラーチェック用コードも会場別ファイル前提に統一
- importPrediction.jsは既に会場別優先で対応済み
- 残る単一ファイル参照は非推奨フォールバック（警告付き）のみ

🤖 Generated with Claude Code
Co-Authored-By: Claude <noreply@anthropic.com>
```

---

## ✅ 動作確認

### 本番サイト確認（free-prediction）

**URL:** https://keiba-intelligence.jp/free-prediction

**確認項目:**
- ✅ 船橋タブが表示される
- ✅ 大井タブが表示される
- ✅ 各会場のレースデータが正常に表示される
- ✅ 会場切り替えが正常に動作する

**確認日:** 2026-03-14

**確認データ:** 2026-03-13（船橋・大井 同日開催）

---

## 📊 データフロー図

### 従来の単一ファイル形式（❌ 廃止）

```
keiba-data-shared-admin
  ↓ 船橋予想保存
keiba-data-shared/nankan/predictions/2026/03/2026-03-13.json (船橋12R)
  ↓ 大井予想保存（上書き）
keiba-data-shared/nankan/predictions/2026/03/2026-03-13.json (大井12R) ← 船橋消失
  ↓
keiba-intelligence (import)
  → 大井のみインポート
  → 船橋データは存在しない
```

---

### 新しい会場別ファイル形式（✅ 正規形式）

```
keiba-data-shared-admin
  ↓ 船橋予想保存
keiba-data-shared/nankan/predictions/2026/03/2026-03-13-FUN.json (船橋12R)
  ↓ 大井予想保存（別ファイル）
keiba-data-shared/nankan/predictions/2026/03/2026-03-13-OOI.json (大井12R)
  ↓
keiba-intelligence (import)
  → fetchVenuePredictions() で両会場を検出
  → 2026-03-13-funabashi.json (船橋)
  → 2026-03-13-ooi.json (大井)
  ↓
free-prediction.astro
  → 船橋タブ ✅
  → 大井タブ ✅
```

---

## 🔍 トラブルシューティング

### Q1: 旧単一ファイル形式のデータが残っている場合は？

**A:** Priority 3のフォールバックで自動的に読み込まれます。ただし、警告メッセージが表示されます。

**推奨対応:**
1. keiba-data-sharedで会場別ファイルを生成
2. keiba-intelligenceで再importを実行
3. 旧単一ファイルは削除可能（オプショナル）

---

### Q2: computer/配下にデータがある場合の動作は？

**A:** Priority 2として自動的に読み込まれます。

**データの優先順位:**
1. nankan/predictions/YYYY/MM/YYYY-MM-DD-{VENUE}.json
2. nankan/predictions/computer/YYYY/MM/YYYY-MM-DD-{VENUE}.json ← ここ
3. nankan/predictions/YYYY/MM/YYYY-MM-DD.json（非推奨）

---

### Q3: 会場コードの大文字・小文字は？

**A:**
- **keiba-data-shared（保存）:** 大文字（OOI, FUN, KAW, URA）
- **keiba-intelligence（表示）:** 小文字（ooi, funabashi, kawasaki, urawa）

**変換マップ:**
```javascript
const venueMap = {
  'ooi': '大井',
  'funabashi': '船橋',
  'kawasaki': '川崎',
  'urawa': '浦和'
};
```

---

## 📚 参照ドキュメント

- [MULTI_VENUE_CHECK.md](./MULTI_VENUE_CHECK.md) - 複数会場同日開催チェックリスト
- [DATA_FORMAT.md](./DATA_FORMAT.md) - データフォーマット仕様
- [RESULTS_SYSTEM_ARCHITECTURE.md](./RESULTS_SYSTEM_ARCHITECTURE.md) - 結果システム設計
- [ARCHIVE_OPERATIONS.md](./ARCHIVE_OPERATIONS.md) - アーカイブ操作手順

---

## 📌 まとめ

### ✅ 達成したこと

1. **会場別ファイル形式への移行完了**
   - 南関予想データの保存形式を統一
   - 複数会場開催時のデータロスを防止

2. **優先順位システムの実装**
   - 会場別ファイル → computer/ → 旧単一ファイル
   - 後方互換性を維持しつつ、新形式を優先

3. **エラーチェックの修正**
   - importResults.js: 南関会場別ファイル対応
   - importResultsJra.js: JRAカテゴリ修正 + 会場別ファイル対応

4. **ログの標準化**
   - [IMPORT], [BUILD], [SAVE], [PAGE] プレフィックス統一
   - トラブルシューティングが容易に

### 🎯 今後の方針

1. **旧単一ファイル形式の段階的廃止**
   - Priority 3の警告メッセージを維持
   - データ移行が完了次第、Priority 3を削除予定

2. **JRAとの設計統一**
   - 南関もJRAも会場別ファイル形式
   - 同じロジックで処理可能

3. **再発防止の徹底**
   - 新規実装時は必ず会場別ファイル形式
   - コードレビューでチェック

---

**作成者:** Claude Code (クロちゃん)
**協力者:** マコさん
**ドキュメント種別:** アーキテクチャ設計書・再発防止ガイド
