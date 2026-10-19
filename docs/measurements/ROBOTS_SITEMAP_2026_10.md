# robots.txt の Sitemap を本番ドメインへ（2026-10）— 正本

作成: 2026-10-19 / 対象: `astro-site/public/robots.txt`（KAO registry `f032ad08`）

| 項目 | 内容 |
|---|---|
| 問題 | robots.txt の `Sitemap:` が旧ホスト（`*.netlify.app/sitemap.xml`）。301 で本番の `sitemap.xml` へ転送されるが、検索エンジンへ正の URL を直接示していない。`astro.config.mjs` の `site` と `sitemap.xml.js` の baseUrl は既に `https://keiba-intelligence.jp` |
| baseline（2026-10-19） | 本番 `https://keiba-intelligence.jp/sitemap.xml` = 200 application/xml。旧ホストの同 URL = 301 → 本番。Search Console は API 未有効のため送信済みサイトマップ・インデックス数は未取得 |
| 仮説 | Sitemap の URL を正の独自ドメインにそろえると、クロールの寄り道（301）が消え、サイトマップの扱いが独自ドメインに一本化される |
| 介入 | `Sitemap: https://keiba-intelligence.jp/sitemap.xml` に 1 行変更。ページ・sitemap 本体・リダイレクトは不変 |
| 期待結果 | 本番の robots.txt に旧ホストが出ない。Search Console（権限が付けば）で独自ドメインのサイトマップが「成功」 |
| 評価期間 | 2026-10-20 〜 2026-11-16（FUNNEL_2026_10.md と同じ 28 日）。効果は小さく、計測できなくても維持する |
| 判断 | 維持（技術的な正しさの修正）。rollback は 1 行の revert |

検証: `src/lib/http/siteOrigin.test.mjs`（Sitemap 行が `DEFAULT_SITE_ORIGIN/sitemap.xml` だけ・`netlify.app` を含まない・`astro.config.mjs` の site と一致。`test:billing` → `npm run build`）、Deploy Preview の `/robots.txt`。
