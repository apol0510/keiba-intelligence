# AI作業ルール（KI 固有）

共通の運用は ~/.claude/CLAUDE.md（冒頭の行動原則・§3・§13・§14・§35）と KAO の docs/fleet-policy.md に従う。本ファイルには本 repo 固有の事実・MK の決定・contract だけを書く。

作業開始時の明示・絶対禁止事項・旧フォーマット禁止・結果システムの参照義務は [CLAUDE.md](../CLAUDE.md) が正本。
本ファイルには、データ修正時の確認と AI 振り返りの買い目非表示だけを置く。

- MK が求めていない仕様・条件・文言を足さない。目的の完成に必要な実装・検証・本番確認は範囲内。
- 本番反映後は Claude が本番 URL で動作を確かめる。

---

## 📊 データ修正時の必須確認事項 📊

### archiveResults.json修正時

1. **修正前の値を確認**
   - Read toolでarchiveResults.jsonを読む
   - 該当日付の現在値を記録

2. **修正処理実行**
   - importResults.js等のスクリプト実行
   - エラーがないか確認

3. **修正後の値を確認**
   - 再度Read toolで確認
   - 修正前後の比較を表形式で提示

4. **検証実行**
   - `npm run validate:archive` 実行
   - フォーマット検証が通ることを確認

5. **git diff確認**
   - 予期しない変更がないか確認
   - 削除行数・追加行数を確認

### 数値集計時

- ✅ 月間統計の再計算を実施
- ✅ 的中率・回収率の整合性確認
- ✅ 極端な数値（300%超など）の理由を説明

🔒 実績表示・集計の保護対象（CLAUDE.md「保護仕様」・MK 2026-10-19）は、MK の明示指示があるときだけ変更する。

---

## 🚫 AI振り返り（結果コメント）での買い目非表示ルール 🚫

### 絶対禁止

- ❌ AI振り返りコメントに**買い目の内容（馬番の組み合わせ）を表示しない**
- ❌ `bettingLines`・`hitLines` のデータをGemini APIに渡さない
- ❌ 「○-○.○.○」のような買い目フォーマットをAI生成文に含めない

### 許可される内容

- ✅ 着順結果（1着・2着・3着の馬番・馬名）
- ✅ 的中 / 不的中の判定のみ
- ✅ 払戻金額（的中時）
- ✅ 馬単の決着組み合わせ（結果としての事実）

### 対象ファイル

- `netlify/functions/gemini-race-analysis.js` — RESULT_PROMPT・formatResultData
- `src/pages/results/[year]/[month]/[day].astro` — AIRaceCommentへのデータ渡し

### 経緯

マコさんから「買い目は見せないで」と指示あり。AI振り返りでは結果と的中判定のみを伝え、具体的な買い目の内容は含めない。

---

## 📚 参照ドキュメント 📚

- [CLAUDE.md](../CLAUDE.md) - プロジェクト全体の司令塔
- [docs/DATA_FORMAT.md](./DATA_FORMAT.md) - データフォーマット仕様
- [docs/RESULTS_SYSTEM_ARCHITECTURE.md](./RESULTS_SYSTEM_ARCHITECTURE.md) - 結果システム設計
- [docs/MULTI_VENUE_CHECK.md](./MULTI_VENUE_CHECK.md) - 複数会場対応
- [docs/ARCHIVE_OPERATIONS.md](./ARCHIVE_OPERATIONS.md) - アーカイブ操作手順

---

**作成日**: 2026-03-11
**最終更新**: 2026-11-25（共通規則の写しを削除・KI 固有の事項だけを残した）
