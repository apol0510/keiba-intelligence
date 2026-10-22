# 集客（検索・他サイト・無料予想）から登録・購入へ（2026-10）— 正本

作成: 2026-10-22 / 依頼: MK 2026-10-22「既存サイト・検索・無料予想からの流入を増やし、有料へつなげる」

🔴 本書に個人を特定できる情報（氏名・email・顧客 ID・token）を書かない。数値は集計値だけ。
🔴 的中率・回収率・実績表示、価格・商品内容・会員権利は扱わない（MK 2026-10-19 決定）。`trackRecordFreeze` の固定ファイル（manifest 掲載の 38 ファイル）は**1 行も変更しない**。
🔴 dark pattern・誤認コピー・キーワード詰め込み・低品質ページの量産はしない。新しいページは作らず、既存ページを検索エンジンへ正しく示すだけ。

---

## 1. baseline（GA4 プロパティ 529387840・2026-09-23〜2026-10-20 の 28 日）

| 指標 | 値 |
|---|---|
| ユーザー | 455 |
| セッション | 1,563（Organic Search 714 / Direct 355 / AI Assistant 229 / Organic Shopping 152 / Referral 97） |
| 主要ページ（active users） | `/` 285・`/free-prediction/jra` 237・`/free-prediction/nankan` 125・`/free-prediction/` 106・`/pricing` 100・`/register` 94・`/auth/verify` 93・`/login/` 89・`/mypage` 88・`/archive/jra/` 64・`/prediction/jra` 14 |
| 登録 | `/register` 94 users に対し GA4 自動計測の `form_submit` 6 users（`ki_*` ファネルイベントは 2026-10-20 開始のため 28 日の比較値なし） |
| 売上 | 2026-10: Stripe 2 件 ¥7,960。2026-09: 8 契約・うち 6 件が 20 日以内に解約 |

## 2. 監査で見つけた欠陥（本番を GET・2026-10-22）

### 2.1 技術 SEO（PR A: `feat/traffic-growth`）

| # | 欠陥 | 証拠（本番） | 影響 |
|---|---|---|---|
| S1 | **無料予想ページの canonical が有料 URL を指し、その有料 URL は未ログインだと 302 で無料ページへ戻る（循環）** | `/free-prediction/jra` → canonical `/prediction/jra`、`/prediction/jra` → 302 `/free-prediction/jra`。南関・南関の開催日別（`/free-prediction/nankan/<slug>` → `/prediction/<slug>` → 302）も同じ | 検索流入の主力ページ（28 日 237 + 125 users）を検索エンジンへ「正規 URL ではない」と示していた。2026-08-28 の「URL で無料 / 有料を分ける」改修で /prediction が未ログイン時に転送されるようになり、canonical だけが残っていた |
| S2 | **sitemap.xml に SSR の主要ページが 1 件も無い** | 本番 sitemap 335 URL は `@netlify/plugin-sitemap` が dist の静的 HTML だけから生成。`/free-prediction/jra`・`/free-prediction/nankan`（索引ページ）・`/pricing`・`/register`・開催日別の無料予想（南関 208 日・JRA 78 日）・月別アーカイブが無く、Google 確認ファイル `/google89654457531021bb` と `/login` が載っていた。repo の `sitemap.xml.js` は plugin の静的ファイルに隠れて一度も配信されておらず、`readdirSync` 未 import で予想ページも出せなかった | 新しい開催日の無料予想が検索に見つかるまでの時間が長い |
| S3 | **静的ページが「末尾スラッシュなし → あり」へ 301** | `/free-prediction`・`/archive`・`/archive/jra`・`/archive/nankan`・`/about`・`/faq`・`/login`・`/stats/<venue>`・`/results/<y>/<m>/<d>` などが 301。canonical・sitemap・内部リンクはスラッシュなし（`trailingSlash: 'never'`） | canonical が転送される URL を指す。ホームや帯の内部リンク（`/archive/jra` 等）を押すたびに 1 往復増える（スマホで遅い） |
| S4 | 存在しない開催日の無料予想が 200（soft 404） | `/free-prediction/jra/2099-01-01`・`/free-prediction/nankan/2099-01-01-ooi` が 200 の空ページ | 任意の日付 URL が索引対象になり得る |
| S5 | 無料予想ページのタイトルが二重 | 「浦和の無料予想（2026-10-22） - KEIBA Intelligence \| KEIBA Intelligence」 | 検索結果のタイトルが切れ、肝心の開催場・日付以外が長くなる |

robots.txt の Sitemap は 2026-10-19 に本番ドメインへ修正済み（`ROBOTS_SITEMAP_2026_10.md`）で、本番も `https://keiba-intelligence.jp/sitemap.xml`。

**修正（PR A）**

- S1: `free-prediction/{jra,nankan}/index.astro`・`free-prediction/nankan/[slug].astro` の `canonicalPath` を外し、自分自身を canonical にする。
- S2: `src/lib/seo/sitemap.js`（純関数・載せる / 載せないを列挙）＋ `src/pages/sitemap.xml.js` を `prerender = true` に。netlify.toml から `@netlify/plugin-sitemap` を外す。
  載せる: 公開の静的ページ・`/free-prediction/{jra,nankan}`・`/pricing`・`/register`・開催日別の無料予想（データファイルがある日だけ）・月別 / 年別アーカイブ・結果ページ・場別統計。
  載せない: `/login`・`/mypage`・`/auth/*`・`/admin/*`・`/apply`・`/unsubscribe`・Google 確認ファイル・`/prediction/*`・`/free-prediction/jra/detail/*`（最新日だけの一時ページ）。
- S3: netlify.toml の末尾に、prerender ページを `…/index.html` へ内部 rewrite（200・force）する規則を 16 本。`/archive-jra`・`/free-prediction-jra` の 301 先もスラッシュなしへ（2 段転送の解消）。
- S4: データの無い日付は `Astro.response.status = 404`（画面の案内と戻りリンクは従来どおり）。
- S5: 4 ページのタイトルから「 - KEIBA Intelligence」を外す（BaseLayout が「 | KEIBA Intelligence」を付ける）。
- 検証: `src/lib/seo/sitemap.test.mjs`（13 件・`test:seo` を `npm run build` に組込み）、Deploy Preview で sitemap の全 URL が 200 かつ canonical = loc（§4）。

**本 PR では直さない（固定ファイル・事業判断）**

- ホーム（`index.astro`・固定対象）の予想リンク 8 本が `/prediction/{nankan,jra}`（未ログインは 302）。`/free-prediction/*` へ向けるのが望ましいが、固定ファイルのため MK の指示待ち。
- 構造化データ（JSON-LD）は全ページ 0。WebSite / Organization は `BaseLayout`・`index.astro`（固定対象）に置くのが自然なため保留。
- `/register`・`/stats` 等のタイトル二重（固定対象）。
- JRA 開催日別ページの HTML が 2.8MB（南関 0.5MB）。スマホの表示速度に影響し得る。表示内容に関わるため別 task。

### 2.2 無料予想 → 登録の摩擦（PR B: `feat/register-cta-anchor`）

実ブラウザ（Playwright・本番・解析通信は遮断・`register-free` / `send-magic-link` は差し替えで実データ送信なし）1280px / Pixel 7 / iPhone 13 / iPhone SE:

| 確認 | 結果 |
|---|---|
| 無料予想の帯「無料会員に登録して印を見る」→ `/register` | 遷移する |
| 不一致・形式不正のメール | 送信されない（不一致表示・ブラウザ標準の検証） |
| 正しい入力 → 送信 | 案内パネル（送信先の伏せ字・再送）が出る。ページのエラーなし（401 は未ログインの get-session で想定どおり） |
| **入力欄の位置** | **帯から来た直後、メール欄は画面の外**（1280px: y=1208 / 高さ 800、iPhone 13: y=1444 / 664、iPhone SE: y=1464 / 568）。特典カード 4 枚の下にあり、スマホで 2 画面以上スクロールしないとフォームが見えない |
| `/register#registerForm` | 入力欄まで移動するが、**固定ヘッダー（sticky・74〜84px）がラベルとメール欄を覆う** |

**修正（PR B）**: `global.scss` の `html` に `scroll-padding-top: 6rem`（固定ヘッダーの高さ分。ページ内リンク全般で見出しが隠れなくなる）、`TierRibbon` の無料会員向け導線を `/register#registerForm` に。文言・価格・特典・フォームは不変（`register.astro` は固定ファイルのため触らない）。

**提案のみ（`register.astro` は固定ファイル）**: メール一致判定が大文字小文字を区別する（`Test@…` と `test@…` で不一致になる）。確認欄は `autocomplete="off"`。

### 2.3 他サイトからの送客（調査のみ・他 repo は変更しない）

本番の KI リンク先の状態: `/`・`/free-prediction/{nankan,jra}`・`/archive/` は 200。`/free-prediction/{nankan,jra}/`（末尾スラッシュ付き）は 301、`/archive`・`/archive/{nankan,jra}` は本 PR まで 301。

| repo（本番） | 現状 | 提案（repo・ページ・配置） |
|---|---|---|
| keiba-matome-monorepo（keiba-matome.jp / chihou / yosou） | 送客済み（`outbound-links.mjs` の `DESTINATIONS.ki`・`cta-catalog.mjs` の `ki_free_nankan` / `ki_free_jra` / `ki_featured_races`、UTM 契約 v2） | catalog の `/free-prediction/nankan/`・`/jra/` の末尾スラッシュを外す（毎回 301）。yosou の `/venue/*` ハブ（catalog は `hub_venue` を許可済み）に `ki_free_nankan` |
| keiba-review-monorepo（keiba-review.jp） | ブログ約 30 本の本文 CTA・`blog/index.astro` が KI の `/`（UTM なし）。`verification/keiba-intelligence.astro` は `/archive/nankan`・`/archive/jra`（301） | 南関の記事は `/free-prediction/nankan`、JRA の記事は `/free-prediction/jra` へ。`packages/shared/lib/constants.ts` の定数を使い、`utm_source=keiba-review&utm_medium=referral&utm_campaign=article` を付ける |
| keiba-review-monorepo / nankan-review（nankan.keiba-review.jp） | KI へのリンクなし（AK へは各場ページに CTA あり） | `src/pages/venues/{ooi,kawasaki,funabashi,urawa}.astro` の AK CTA の隣に「無料のAI予想（KEIBA Intelligence）」→ `/free-prediction/nankan?utm_source=nankan-review…` |
| keiba-nyumon（keiba-nyumon.jp） | なし | `src/components/RelatedSitesCTA.astro` の設定配列（AK と同じ形）に、`nankan` カテゴリへ `/free-prediction/nankan`、`baken` / `data` へ `/free-prediction/jra` |
| nankan-courses（nankan-course.keiba.link） | なし | `src/layouts/BaseLayout.astro` フッター「関連リンク」に `/free-prediction/nankan` |
| nankan-beginner（nankan-beginner.keiba.link） | なし | `src/layouts/Layout.astro` フッターに `/free-prediction/nankan`（ヘッダーの「無料予想」ボタンの差し替えは事業判断） |
| analytics-keiba（AK） | 利用者向けリンクなし（独立運用・KI 痕跡を禁止する guard あり） | 追加しない。運用スクリプトが旧ホスト `keiba-intelligence.netlify.app/.netlify/functions/send-alert` を呼んでいる（POST は 301 を追わない恐れ）点だけ AK 側の task として記録 |

🔴 ローカル checkout の多くは origin と乖離していた（keiba-matome は古い branch）。他 repo で実装するときは最新の origin から作業する。

## 3. 実験として扱う

| 項目 | 内容 |
|---|---|
| 問題 | 28 日 455 users。検索流入の主力（無料予想）が正規 URL として示されておらず、sitemap に主要ページが無い。登録導線はフォームが画面外 |
| 仮説 H1（PR A） | canonical・sitemap・URL 形を正すと、無料予想（索引・開催日別）の索引数と Organic Search の表示回数・流入が増える |
| 仮説 H2（PR B） | 帯から直接フォームが見えると、`/register` 到達者のうち送信する割合が上がる |
| 指標 H1 | GA4: Organic Search のセッション・`/free-prediction/*` の landing users（baseline 714 セッション / 28 日）。Search Console（権限が付けば）: sitemap の送信 URL 数・索引登録数・`/free-prediction/*` の表示回数 |
| 指標 H2 | GA4: `ki_signup_result{result=sent}` の users ÷ `/register` の page_view users（baseline は 2026-10-20〜10-22 の `ki_signup_result` から取る。GA4 自動計測の `form_submit` は fetch 送信のフォームで不正確なため使わない）。補助: Airtable の新規登録件数 |
| 評価期間 | 2026-10-23 〜 2026-11-19（28 日）。中間確認 2026-11-05。索引の反映には数週間かかるため、H1 は 2026-12-17（56 日）にも再評価 |
| 判断 | 技術的な正しさの修正（S1〜S5）は数値に関係なく維持。H2 は送信率が下がった場合だけ導線の向き先を戻す |
| rollback | 各 PR の revert（データ・設定・外部サービスの変更なし）。S3 の rewrite は netlify.toml 末尾のブロック削除だけで戻る |

🔴 母数が小さい（登録は月 2 桁、決済は月 1 桁）。短期の増減で仕様を変えない。

## 4. Deploy Preview での検証（PR A・#179）

| 確認 | 結果 |
|---|---|
| `/sitemap.xml` | 200 `application/xml`。**608 URL**（本番は 335）。plugin 形式ではなく本 PR の生成物 |
| sitemap の全 URL を GET | **608 / 608 が 200 かつ canonical = loc**（`/free-prediction/jra`・`/free-prediction/nankan`・`/pricing`・`/register`・開催日別 南関 207・JRA 76 を含む） |
| 末尾スラッシュ | `/free-prediction`・`/archive/jra`・`/about`・`/login?next=…`・`/stats/ohi`・`/results/2026/10/20`・`/free-prediction/jra/archive` が 301 なしで 200。スラッシュ付きも 200 |
| soft 404 | `/free-prediction/jra/2099-01-01`・`/free-prediction/nankan/2099-01-01-ooi`・`/stats/foo` が 404 |
| 既存の転送 | `/prediction/jra` → 302 `/free-prediction/jra`（不変）、`/archive/2026/10` → 301 `/archive/nankan/2026/10`（不変） |

🔴 **検証で見つけた隠れた依存（修正済み）**: 1 回目の Preview では開催日別の無料予想が**全て 404** になった。予想 JSON（`src/data/predictions`）は
SSR の旧 `sitemap.xml.js` にあった `join(process.cwd(),'src','data','predictions')` の依存トレースで**偶然** SSR Function に同梱されていたため、
sitemap を prerender にすると同梱されなくなった。`astro.config.mjs` の adapter `includeFiles` に明示（prune 後 283 件・117.9MB で main と同量）し、
`sitemap.test.mjs` で固定した。2 回目の Preview build は Netlify 側で exit code 2（ログは API で取得できず、ローカル build は green）→ 同一 commit の retry で ready（一過性）。

`/archive-jra`・`/free-prediction-jra` の裸 URL 規則は `/*` の splat 規則の後ろにあり一度も使われていなかった（空 splat が先に一致してスラッシュ付きへ転送）。順序を入れ替えた。
