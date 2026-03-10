# 結果システム設計参照

## 設計本体の場所

**結果ページの設計は以下を参照:**

```
keiba-data-shared/RESULTS_SYSTEM_ARCHITECTURE.md
keiba-data-shared/MULTI_VENUE_CHECK.md
```

---

## このプロジェクトの役割

**keiba-intelligence**は
結果JSONを消費して表示するサイト。

---

## データフロー

```
keiba-data-shared（JSON配信）
  ↓
GitHub Actions dispatch
  ↓
importResults.js（自動取り込み）
  ↓
的中判定・アーカイブ保存
  ↓
/results/（結果表示ページ）
```

---

## ページ構造

### 南関競馬

```
/nankan/results/YYYY/MM/DD/          # 日付親ページ
/nankan/results/YYYY/MM/DD/venue/    # 会場親ページ
/nankan/results/YYYY/MM/DD/venue/R/  # レース詳細ページ
```

### 中央競馬

```
/jra/results/YYYY/MM/DD/             # 日付親ページ
/jra/results/YYYY/MM/DD/venue/       # 会場親ページ
/jra/results/YYYY/MM/DD/venue/R/     # レース詳細ページ
```

---

## 重要な注意事項

**結果ページの構造を変更する場合:**

1. `keiba-data-shared/RESULTS_SYSTEM_ARCHITECTURE.md` を必ず確認
2. 3階層構造（day → venue → race）を維持
3. JSON読み込みルール（会場別優先 → 統合フォールバック）を守る
4. venue mapping（slug → venueCode）を変更しない

---

**最終更新**: 2026-03-10
**作成者**: Claude (クロちゃん)
