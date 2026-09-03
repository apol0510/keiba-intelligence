# UI修正の全プラン横断ルール（KI 予想画面）

KEIBA Intelligence の予想画面に関する UI 修正は、以下の **6 経路すべて** を対象とする。
1 経路だけ直して「完了」とすることを恒久的に禁止する。

## 対象 6 経路

> 🔴 **2026-09-03**: `/prediction/*` は**有料専用**（入れない tier は無料ページへ 302）、
> `/free-prediction/*` は**tier を問わず買い目を出さない**。
> 正本: `docs/decisions.md`「2026-09-03 — 予想ページを URL で無料 / 有料に分ける」

| 区分 | 本番URL | Astroページ実装 | 備考 |
|------|---------|----------------|------|
| JRA free | `/free-prediction/jra`（+ `/free-prediction/jra/{date}`） | `src/pages/free-prediction/jra/index.astro` / `[date].astro` | 無料会員向け。独立ページ実装 |
| JRA light | `/prediction/jra` | `src/pages/prediction/jra/index.astro` | premium と同一ページ。`sessionStorage.isLightUser` でクライアント側分岐（買い目のみ制御、カードDOMは共通） |
| JRA premium | `/prediction/jra` | `src/pages/prediction/jra/index.astro` | 同上（プロ会員） |
| 南関 free | `/free-prediction/nankan`（+ `/free-prediction/nankan/{slug}`） | `src/pages/free-prediction/nankan/index.astro` / `[slug].astro` | index=カード型 / [slug]=テーブル型（別UX） |
| 南関 light | `/prediction/nankan` | `src/pages/prediction/nankan/index.astro` | premium と同一ページ。クライアント側分岐 |
| 南関 premium | `/prediction/nankan` | `src/pages/prediction/nankan/index.astro` | 同上 |

補足:
- `light` / `premium` は同一ページを共有し、`AccessControl`（`requiredPlan="free-registered"`）通過後に
  `sessionStorage` の `isFreeUser` / `isLightUser` フラグで **買い目セクションの表示のみ** を切り替える。
  馬詳細カード（`detailed-horse-card` / 近走成績 / 過去走データ / `dhc-features`）の DOM は free/light/premium で共通。
- `free` は別ページ実装（`free-prediction/*`）であり、`prediction/*` の修正は **波及しない**。
- 馬詳細カードの markup と scoped `<style>` は **各ページにインライン複製** されている（共通コンポーネント未導入）。
  → これが「1ページだけ直すと他が直らない」事故の構造的原因。

## 禁止事項
- 1 ページだけを修正して完了扱いする
- 同型 UI へ個別 CSS を重複追加する（場当たりの per-page 上書き）
- ユーザーへ 6 画面すべての実機目視を要求する
- Chromium の 1 経路だけで PASS 判定する
- URL 経路を推測したまま検証する

## 必須事項
- 実際の 6 経路 URL と実装ファイルを対応表にする（本書の表を最新に保つ）
- 共通コンポーネントまたは共通 CSS を優先する
- 6 経路すべてを自動検証する（Playwright Chromium + WebKit、mobile/desktop）
- mobile（375/390/393/430/768）と desktop（1280）を確認する
- JRA/南関・free/light/premium の回帰結果を報告する

## 既知の技術的制約（共通化の壁）
- Astro の scoped `<style>` は `.selector[data-astro-cid-xxx]` となり、グローバル CSS（`.selector`）より
  詳細度が高い。よって「グローバル CSS 1 枚で全ページ上書き」は `!important` なしでは成立しない。
- 馬詳細カードの「過去走/近走を `dhc-info-card` の外（兄弟）へ出す」整列修正は **DOM 構造変更** であり、
  CSS だけでは是正できない。各ページの markup を直すか、共通コンポーネント化が必要。

## 推奨アーキテクチャ（恒久対応）
- `JraHorseDetailCard.astro` / `NankanHorseDetailCard.astro` を新設し、
  `prediction/*` と `free-prediction/*` の双方から利用してカード DOM/CSS を一元化する。
- free と premium の差分（feature 表示ゲート: free=上位2頭 `isTopTwo` / premium=役割ベース、
  特徴量データのソース差など）は props / modifier class で吸収する。
- 完了するまでは、修正のたびに本書の 6 経路を Playwright で自動巡回検証する。

## 今回の対応方針（2026-06-19）
現状、馬詳細カードのDOMとscoped CSSは複数ページへ重複実装されている。
今回の修正では低リスクを優先し、既存の確定パターン（`prediction/jra` `prediction/nankan` の
整列修正 = 近走/過去走を `dhc-info-card` の外へ出し、`.dhc-features` を `width:100%` + `box-sizing:border-box`、
mobile のみカード下部 padding/margin を `--spacing-md` に統一）を未修正の free ページ
（`free-prediction/jra/index.astro` `free-prediction/jra/[date].astro` `free-prediction/nankan/index.astro`）へ
機械的に適用する。
`JraHorseDetailCard` / `NankanHorseDetailCard` への共通コンポーネント化は別タスク（技術的負債）として扱う。

## 正しい完成形（受け入れ基準）
- 過去走データ枠と特徴量重要度分析枠の左右端が一致（左右差 0〜1px）
- 閉じたアコーディオン間の縦 gap が統一
- 特徴量枠下からカード下端までの余白が統一
- JRA/南関で同じ縦リズム
- free/light/premium で同じ横幅
- 横スクロールなし
- desktop 退行なし
