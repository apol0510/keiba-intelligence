# Google 検索・AI モードでの誤認の改善（2026-11）— 正本

作成: 2026-11-05 / 依頼: MK 2026-11-05「KI の無料・有料サービスに関する AI の誤認識を改善」

🔴 的中率・回収率・実績表示、価格・商品内容・会員権利は扱わない（MK 2026-10-19 決定）。`trackRecordFreeze.manifest.json` 掲載の 38 ファイルは今回変更していない。
🔴 無料と有料の範囲の正本は `/pricing` の「どこまで見えるか」の表。本書と `src/lib/seo/serviceScope.js` はその事実の言い換えだけ。

## 1. 問題

2026-11-05 に Google AI モードで「KEIBA Intelligence 競馬 評判」を確認した（1 回の実行。回答は実行ごとに変わる）。

- 「登録なし・完全無料」「有料プランへの誘導を目的としたサービスではない」と説明された。実際は印が無料会員、AI 指数の数値・AI 結論・馬単の買い目が有料の月額プレミアム。
- 「競馬 AI予想 おすすめサイト」「南関競馬 AI予想 無料 サイト」では KI は紹介されなかった。

## 2. baseline

| 指標 | 値 |
|---|---|
| Search Console（2026-10-06〜11-02・28 日） | 221 クリック・1,510 表示・CTR 14.7%・平均 17.4 位 |
| インデックス（2026-11-05 時点の表示） | 登録 404・未登録 2,150 |
| 未登録の内訳 | 404 が 1,200・リダイレクト 319・代替ページ 125・クロール済み未登録 425・検出未登録 65 ほか |
| GA4 の AI Assistant チャネル | 2026-09-23〜10-20 で 229 セッション（`TRAFFIC_GROWTH_2026_10.md` §1） |

## 3. 本番の実測（2026-11-05）

- sitemap の 639 URL はすべて 200。404 は sitemap から出ていない。
- GSC の 404 の例は `/free-prediction/jra/detail/*`（最新日だけの一時ページ・sitemap 対象外）。現在の開催日ページ（11/1）と一覧には `/detail/` へのリンクが無く、過去に発見された URL の再クロール。404 は正しい応答なので修正しない。
- `/free-prediction` と `/free-prediction/`、`/login` と `/login/`、`/faq`・`/archive`・`/about` の末尾スラッシュ違いは両方 200 だが、canonical はどちらもスラッシュなしで一致。修正しない（`/pricing/` は 301）。

## 4. 実装

- `src/lib/seo/serviceScope.js`: 無料・有料の範囲の単一源。`serviceScope.test.mjs` が `/pricing` の表との一致、「完全無料」・金額・実績の数値を書かないことを固定する（`test:seo`）。
- `/about`: 「無料で見られる範囲と有料プラン」の本文、Organization と WebSite の JSON-LD、南関東 4 場を含む説明へ修正。
- 開催日ページ（`/free-prediction/jra/[date]`・`/free-prediction/nankan/[slug]`）: description に有料の範囲を追加（一覧ページと同じ事実）。

## 5. 未完了（固定ファイルのため今回変更していない）

| ファイル | 内容 |
|---|---|
| `faq.astro` | 「無料で利用できますか？」が「無料会員登録で全レースの予想を閲覧」と読め、未登録で見える範囲の説明とずれる。「支払い方法は？」が銀行振込のみと読め、`/pricing` の月額（カード）とずれる。FAQPage JSON-LD も未追加 |
| `free-prediction/index.astro` | description が「高精度予想を毎日無料公開」で、有料の範囲が無い |
| `index.astro`・`BaseLayout.astro` | ホームの Organization / WebSite JSON-LD を未追加。BaseLayout の既定 description は撤去済みの固定値を含む |

## 6. 評価

- 評価期間: 2026-11-06 〜 2026-12-03（反映日が遅れた場合は反映日から 28 日）。
- 見るもの: AI モードの「KEIBA Intelligence 競馬 評判」で有料の範囲が説明されるか（複数回）、GSC の表示・クリック、`/pricing`・`/register` への遷移、GA4 の AI Assistant チャネル。
- 短期のノイズで仕様を変えない。AI モードの回答は 1 回では判定しない。
