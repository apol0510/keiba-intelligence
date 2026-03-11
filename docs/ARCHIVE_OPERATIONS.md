# アーカイブ操作手順

## 🎯 アーカイブ再生成の目的 🎯

### 再生成が必要なケース

1. **旧フォーマット混入** - raceResults, honmeiHit等が検出された
2. **的中率・回収率の誤表示** - 本命的中のみカウント、他の買い目的中を無視
3. **データ構造変更** - 新しいフィールド追加時
4. **買い目点数ロジック変更** - 8点 or 12点の調整ルール変更時

---

## 📋 日付単位の再生成手順 📋

### 基本コマンド（南関）

```bash
# 単一日付の再生成
node scripts/importResults.js --date 2026-03-06

# 複数日付の再生成（手動実行）
node scripts/importResults.js --date 2026-03-02
node scripts/importResults.js --date 2026-03-03
node scripts/importResults.js --date 2026-03-04
```

### 基本コマンド（中央）

```bash
# 単一日付の再生成
node scripts/importResultsJra.js --date 2026-02-14

# 複数日付の再生成（手動実行）
node scripts/importResultsJra.js --date 2026-02-08
node scripts/importResultsJra.js --date 2026-02-09
node scripts/importResultsJra.js --date 2026-02-14
```

---

## 🔄 日付単位のreplace仕様 🔄

### 重複排除機構

importResults.js / importResultsJra.jsは、同じ日付のエントリを自動的に削除してから追加します。

```javascript
// archiveResults.jsonから同じ日付のエントリを削除
const archive = existingData.filter(entry => entry.date !== date);

// 新しいエントリを追加
archive.push(newEntry);

// 日付降順ソート
archive.sort((a, b) => b.date.localeCompare(a.date));
```

### 安全性

- ✅ **重複なし**: 同じ日付が2つ存在することはない
- ✅ **上書き**: 既存データを削除してから追加
- ✅ **ソート**: 常に日付降順（新しい順）

---

## 📅 月単位の一括再生成手順 📅

### 方法1: 手動実行（推奨）

```bash
# 2026年3月の全日付を再生成
node scripts/importResults.js --date 2026-03-02
node scripts/importResults.js --date 2026-03-03
node scripts/importResults.js --date 2026-03-04
node scripts/importResults.js --date 2026-03-05
node scripts/importResults.js --date 2026-03-06
```

### 方法2: シェルスクリプト（大量日付）

```bash
#!/bin/bash
# 2026年2月の全日付を再生成

for date in 2026-02-{01..28}; do
  echo "Processing $date..."
  node scripts/importResults.js --date "$date"
done
```

### 注意事項

- **予想データなし**の日付はスキップされる（正常）
- **結果データなし**の日付はエラーになる

---

## ✅ 検証手順 ✅

### 1. フォーマット検証

```bash
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

### 2. ビルド検証

```bash
npm run build
```

**期待結果:**
```
✅ ビルド成功
```

### 3. 実データ確認

```bash
# archiveResults.jsonを読む（南関）
cat src/data/archiveResults.json | jq '.[] | select(.date == "2026-03-06")'

# archiveResultsJra.jsonを読む（中央）
cat src/data/archiveResultsJra.json | jq '.[] | select(.date == "2026-02-14")'
```

**確認項目:**
- `date`: 正しい日付
- `totalRaces`: 正しいレース数
- `hitRaces`: 的中レース数
- `hitRate`: 的中率（%）
- `returnRate`: 回収率（%）
- `betPointsPerRace`: 8 or 12
- `races`: 配列形式（旧: raceResults ❌）
- `isHit`: 各レースに存在（旧: honmeiHit ❌）

---

## 📊 修正前後の比較方法 📊

### 1. 修正前の値を記録

```bash
# git diffで確認
git diff src/data/archiveResults.json
```

### 2. 表形式で比較

| 日付 | 項目 | 修正前 | 修正後 |
|------|------|--------|--------|
| 2026-03-02 | 的中率 | 33% | 50% |
| 2026-03-02 | 回収率 | 41% | 106.4% |
| 2026-03-03 | 的中率 | 33% | 58.3% |
| 2026-03-03 | 回収率 | 55% | 281.9% |

### 3. git diff統計

```bash
git diff --stat src/data/archiveResults.json
```

**例:**
```
src/data/archiveResults.json | 3047 +++++---------------
1 file changed, 937 insertions(+), 2284 deletions(-)
```

---

## 🚨 本番反映前の確認項目 🚨

### チェックリスト

- [ ] **フォーマット検証**: `npm run validate:archive` 成功
- [ ] **ビルド検証**: `npm run build` 成功
- [ ] **実データ確認**: 修正後の値が正しい
- [ ] **修正前後の比較**: 表形式で提示
- [ ] **git diff確認**: 予期しない変更がない
- [ ] **削除行数・追加行数確認**: 妥当な範囲

### commit前確認

```bash
# 変更ファイル確認
git status

# 変更内容確認
git diff src/data/archiveResults.json

# 統計確認
git diff --stat
```

### commitメッセージ例

```bash
git commit -m "🛡️ アーカイブ再生成（旧フォーマット削除）

【修正内容】
- 2026/03の全日付を再生成
- 旧フォーマット（raceResults, honmeiHit）完全削除
- 的中率・回収率を正確な値に修正

【修正前後】
- 3/2: 33%→50%(的中率), 41%→106.4%(回収率)
- 3/3: 33%→58.3%, 55%→281.9%
- 3/4: 8%→58.3%, 88%→195.0%

【検証】
- npm run validate:archive: ✅ 成功
- npm run build: ✅ 成功

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## 🔍 トラブルシューティング 🔍

### エラー: 旧フォーマット検出

**現象:**
```
❌ アーカイブフォーマットエラー検出！
   旧フォーマットキー「raceResults」が混入しています
```

**原因:**
- 手動でarchiveResults.jsonを編集した
- importResults.js実行前に旧データが残っている

**対処:**
1. 該当日付のエントリを手動削除
2. 再度importResults.js実行
3. `npm run validate:archive` で確認

### エラー: 予想データが見つかりません

**現象:**
```
⏭️  予想データが見つかりません: 2026-01-26
   keiba-intelligenceでは的中判定をスキップします
```

**原因:**
- 予想データが存在しない日付
- keiba-data-sharedには結果のみ保存されている

**対処:**
- 正常動作（エラーではない）
- archiveResults.jsonには追加されない

### エラー: ビルド失敗

**現象:**
```
❌ アーカイブフォーマットエラー！
   旧フォーマット検出: honmeiHit
```

**原因:**
- validateArchiveFormat.jsで旧フォーマット検出
- ビルド前検証でエラー

**対処:**
1. `npm run validate:archive` で詳細確認
2. 該当日付を特定
3. importResults.js で再生成

---

## 📚 参照ドキュメント 📚

- [AI_RULES.md](./AI_RULES.md) - AI作業ルール
- [DATA_FORMAT.md](./DATA_FORMAT.md) - データフォーマット仕様
- [RESULTS_SYSTEM_ARCHITECTURE.md](./RESULTS_SYSTEM_ARCHITECTURE.md) - 結果システム設計
- [MULTI_VENUE_CHECK.md](./MULTI_VENUE_CHECK.md) - 複数会場対応

---

**作成日**: 2026-03-11
**最終更新**: 2026-03-11
**目的**: アーカイブ再生成手順の明確化、トラブルシューティング、検証方法の整理
