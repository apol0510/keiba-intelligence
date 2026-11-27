# COURSE_PAGES_2026_11 — 南関 4 場のコース別データ（/course）

KAO gap 6403c87d（「AK のコース解説のような独自情報ページ（南関 4 場のコース別傾向等）を増やす」）の実装と効果測定。

## 何を作ったか

- `/course`（一覧）と `/course/<venue>-<distance>`（18 コース・40 レース以上ある距離だけ）。SSR（`prerender = false`。netlify.toml の rewrite が要らない）。
- データは keiba-data-shared `nankan/results` の確定結果（着順・枠番・単勝人気・4 コーナー通過順・払戻）だけを集計する。KI の予想・実績は使わない。
  - 集計: `src/lib/course/courseStats.js`（純関数・test `courseStats.test.mjs`）
  - 生成: `npm run build:course-stats -- --source <keiba-data-shared の checkout>` → `src/data/course/nankanCourseStats.json`
- 各ページ: 要点（数値から機械的に作る文）・主な数値・人気別・枠番別・勝ち馬の 4 コーナー位置・FAQ（FAQPage / BreadcrumbList の JSON-LD）・無料予想への導線。
- 内部リンク: フッター「対象競馬場」の下・sitemap.xml。実績固定（2026-10-19 MK 決定）の対象ファイルは変えていない。

## データの更新

初回は 2026-01-23〜2026-11-27 の 2,779 レース。日次の workflow には載せていない（KI の workflow 変更は人の merge）。
月 1 回程度 `build:course-stats` を流して JSON を更新すれば足りる（傾向の数値はゆっくり動く）。

## 効果測定

- 仮説: 「大井 1200m 傾向」「浦和 1400 枠順」などのコース名の検索と AI 検索の回答で、KI が引用・表示されるようになり、/free-prediction/nankan への流入が増える。
- 指標: GSC の `/course` 配下の表示回数・クリック・掲載順位、GA4（529387840）の `/course` landing セッションと `data-cta="course_free_prediction"` のクリック → /free-prediction/nankan。
- baseline: 0（新規 URL）。
- 評価日: 2026-12-26（反映 +28 日）。表示回数が出ていれば、表示回数の多いコースに近走の傾向（直近 3 か月）を足す。出ていなければ index 状況（URL 検査）を先に確かめる。
