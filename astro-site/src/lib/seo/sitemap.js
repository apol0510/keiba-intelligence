/**
 * sitemap.js — /sitemap.xml の URL 一覧（純関数）
 *
 * 正本: docs/measurements/TRAFFIC_GROWTH_2026_10.md §2.1
 *
 * 🔴 2026-10-22 まで本番の sitemap.xml は `@netlify/plugin-sitemap` が dist の静的 HTML だけから作っていた。
 *    そのため SSR の主要ページ（/free-prediction/jra・/free-prediction/nankan・/pricing・/register・
 *    開催日別の無料予想・月別アーカイブ）が 1 件も載らず、Google サイト確認ファイルや /login が載っていた。
 *    ここで「検索から来てほしい公開ページ」だけを、正規 URL（末尾スラッシュなし・canonical と同じ形）で列挙する。
 *
 * 🔴 載せないもの: /login・/mypage・/auth/*・/admin/*・/apply・/unsubscribe・Google 確認ファイル・
 *    /prediction/*（未ログインは /free-prediction/* へ 302）・/free-prediction/jra/detail/*（最新開催日だけの一時ページ）。
 * 🔴 実績の数値・表示には触れない（URL を列挙するだけ）。
 */

export const SITE_ORIGIN = 'https://keiba-intelligence.jp';

/** 常に存在する公開ページ（正規 URL のパス）。 */
export const STATIC_PATHS = Object.freeze([
  '/',
  '/free-prediction',
  '/free-prediction/jra',
  '/free-prediction/nankan',
  '/free-prediction/jra/archive',
  '/free-prediction/nankan/archive',
  '/pricing',
  '/register',
  '/archive',
  '/archive/jra',
  '/archive/nankan',
  '/stats',
  '/about',
  '/faq',
  '/lab/shutsuba',
  '/terms',
  '/privacy',
  '/tokushoho',
]);

/** stats/[venue].astro の getStaticPaths と同じ 14 場。 */
export const STATS_VENUE_SLUGS = Object.freeze([
  'ohi', 'kawasaki', 'funabashi', 'urawa',
  'tokyo', 'kyoto', 'hanshin', 'kokura', 'nakayama', 'niigata', 'chukyo', 'fukushima', 'sapporo', 'hakodate',
]);

/** venues/[venue]/index.astro の venueMap と同じ南関 4 場。 */
export const NANKAN_VENUE_SLUGS = Object.freeze(['ooi', 'kawasaki', 'funabashi', 'urawa']);

/** URL に出さない（sitemap に載せてはいけない）パスの接頭辞。test で固定する。 */
export const EXCLUDED_PREFIXES = Object.freeze([
  '/login', '/mypage', '/auth', '/admin', '/apply', '/unsubscribe', '/google', '/prediction', '/free-prediction/jra/detail',
]);

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NANKAN_SLUG_RE = /^(\d{4}-\d{2}-\d{2})-([a-z]+)$/;

function datesOf(entries) {
  const out = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    const d = typeof e?.date === 'string' ? e.date : '';
    if (DATE_RE.test(d)) out.push(d);
  }
  return out;
}

/**
 * @param {object} input
 * @param {Array<{date:string}>} input.archiveNankan   src/data/archiveResults.json
 * @param {Array<{date:string}>} input.archiveJra      src/data/archiveResultsJra.json
 * @param {string[]} input.nankanPredictionSlugs       src/data/predictions/YYYY-MM-DD-venue.json の basename
 * @param {string[]} input.jraPredictionDates          src/data/predictions/jra/YYYY/MM/YYYY-MM-DD.json の basename
 * @returns {Array<{path:string, lastmod?:string}>}    path で一意・並びは決定的
 */
export function buildSitemapEntries({ archiveNankan = [], archiveJra = [], nankanPredictionSlugs = [], jraPredictionDates = [] } = {}) {
  const map = new Map();
  const add = (path, lastmod) => {
    const prev = map.get(path);
    if (!prev) { map.set(path, lastmod ? { path, lastmod } : { path }); return; }
    if (lastmod && (!prev.lastmod || lastmod > prev.lastmod)) prev.lastmod = lastmod;
  };

  for (const p of STATIC_PATHS) add(p);
  for (const v of STATS_VENUE_SLUGS) add(`/stats/${v}`);
  for (const v of NANKAN_VENUE_SLUGS) add(`/venues/${v}`);

  const nankanDates = datesOf(archiveNankan);
  const jraDates = datesOf(archiveJra);

  // 結果（日別・月別）: results/[year]/[month]/[day]・index の getStaticPaths と同じ母集合
  for (const d of [...nankanDates, ...jraDates]) {
    const [, y, m, day] = d.match(DATE_RE);
    add(`/results/${y}/${m}/${day}`, d);
    add(`/results/${y}/${m}`, d);
  }
  // 月別アーカイブ（SSR）: データがある月だけ
  for (const d of nankanDates) {
    const [, y, m] = d.match(DATE_RE);
    add(`/archive/nankan/${y}`, d);
    add(`/archive/nankan/${y}/${m}`, d);
  }
  for (const d of jraDates) {
    const [, y, m] = d.match(DATE_RE);
    add(`/archive/jra/${y}/${m}`, d);
  }

  // 開催日別の無料予想（SSR・データファイルがある日だけ。無い日は 404）
  for (const s of nankanPredictionSlugs) {
    const m = typeof s === 'string' ? s.match(NANKAN_SLUG_RE) : null;
    if (m && DATE_RE.test(m[1])) add(`/free-prediction/nankan/${s}`, m[1]);
  }
  for (const d of jraPredictionDates) {
    if (typeof d === 'string' && DATE_RE.test(d)) add(`/free-prediction/jra/${d}`, d);
  }

  return [...map.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** @param {Array<{path:string, lastmod?:string}>} entries */
export function renderSitemapXml(entries, origin = SITE_ORIGIN) {
  const urls = entries.map((e) => {
    const loc = e.path === '/' ? `${origin}/` : `${origin}${e.path}`;
    return `  <url><loc>${xmlEscape(loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}
