/**
 * sitemap.test.mjs — sitemap・canonical・静的ページの URL 形の契約（TRAFFIC_GROWTH_2026_10.md §2.1）
 *
 * 実行: node --test src/lib/seo/sitemap.test.mjs（astro-site 直下）。`npm run build` の test:seo に組込み。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  SITE_ORIGIN, STATIC_PATHS, EXCLUDED_PREFIXES, buildSitemapEntries, renderSitemapXml,
} from './sitemap.js';
import { DEFAULT_SITE_ORIGIN } from '../http/siteOrigin.js';

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(siteRoot, p), 'utf8');

const sample = () => buildSitemapEntries({
  archiveNankan: [{ date: '2026-10-21' }, { date: '2026-10-20' }, { date: 'bad' }, {}],
  archiveJra: [{ date: '2026-10-18' }],
  nankanPredictionSlugs: ['2026-10-21-ooi', '2026-10-21-OOI', 'archive', '../x'],
  jraPredictionDates: ['2026-10-18', '2026-1-1'],
});

describe('URL の選定', () => {
  test('主要な公開ページ（SSR を含む）が載る', () => {
    const paths = sample().map((e) => e.path);
    for (const p of ['/', '/free-prediction', '/free-prediction/jra', '/free-prediction/nankan', '/pricing', '/register',
      '/free-prediction/nankan/2026-10-21-ooi', '/free-prediction/jra/2026-10-18',
      '/archive/nankan/2026', '/archive/nankan/2026/10', '/archive/jra/2026/10',
      '/results/2026/10', '/results/2026/10/21', '/results/2026/10/18', '/stats/ohi', '/venues/ooi']) {
      assert.ok(paths.includes(p), `${p} が無い`);
    }
  });

  test('ログイン・会員・確認ファイル・有料 URL・一時ページは載せない', () => {
    for (const { path } of sample()) {
      for (const pre of EXCLUDED_PREFIXES) {
        assert.ok(!(path === pre || path.startsWith(`${pre}/`) || (pre === '/google' && path.startsWith(pre))), `${path} は載せない`);
      }
    }
    assert.ok(!STATIC_PATHS.includes('/login'));
    assert.ok(!STATIC_PATHS.includes('/lab/shutsuba'), 'noindex のページを載せない');
  });

  test('形式が不正なデータは URL にしない', () => {
    const paths = sample().map((e) => e.path);
    for (const bad of ['/free-prediction/nankan/2026-10-21-OOI', '/free-prediction/nankan/../x', '/free-prediction/jra/2026-1-1']) {
      assert.ok(!paths.includes(bad), bad);
    }
    assert.ok(!paths.some((p) => p.includes('bad') || p.includes('undefined')));
  });

  test('正規形: 末尾スラッシュなし（/ を除く）・重複なし・並びは決定的・lastmod は YYYY-MM-DD', () => {
    const entries = sample();
    const paths = entries.map((e) => e.path);
    assert.equal(new Set(paths).size, paths.length);
    assert.deepEqual(paths, [...paths].sort());
    for (const e of entries) {
      if (e.path !== '/') assert.ok(!e.path.endsWith('/'), e.path);
      if (e.lastmod) assert.match(e.lastmod, /^\d{4}-\d{2}-\d{2}$/);
    }
    // 月の lastmod はその月の最新日
    assert.equal(entries.find((e) => e.path === '/results/2026/10').lastmod, '2026-10-21');
  });

  test('XML は本番 origin・エスケープ済み', () => {
    const xml = renderSitemapXml(sample());
    assert.equal(SITE_ORIGIN, DEFAULT_SITE_ORIGIN);
    assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
    assert.match(xml, /<loc>https:\/\/keiba-intelligence\.jp\/<\/loc>/);
    assert.doesNotMatch(xml, /netlify\.app|google[0-9a-f]+|\/login</);
    assert.equal(renderSitemapXml([{ path: '/a&b' }]).includes('/a&amp;b'), true);
  });

  test('実データでも組み立てられ、予想ファイルのある日がすべて載る', () => {
    const dataDir = join(siteRoot, 'src', 'data');
    const nankan = readdirSync(join(dataDir, 'predictions')).filter((f) => /^\d{4}-\d{2}-\d{2}-[a-z]+\.json$/.test(f)).map((f) => f.slice(0, -5));
    const entries = buildSitemapEntries({
      archiveNankan: JSON.parse(read('src/data/archiveResults.json')),
      archiveJra: JSON.parse(read('src/data/archiveResultsJra.json')),
      nankanPredictionSlugs: nankan,
      jraPredictionDates: [],
    });
    const paths = new Set(entries.map((e) => e.path));
    for (const s of nankan) assert.ok(paths.has(`/free-prediction/nankan/${s}`));
    assert.ok(entries.length < 50000, 'sitemap 1 ファイルの上限');
  });
});

describe('配信経路', () => {
  test('sitemap.xml.js は prerender で、lib の選定を使う', () => {
    const src = read('src/pages/sitemap.xml.js');
    assert.match(src, /export const prerender = true;/);
    assert.match(src, /buildSitemapEntries\(/);
    assert.match(src, /renderSitemapXml\(/);
  });

  test('開催日別予想の JSON を SSR Function へ明示同梱する（sitemap の prerender 化で依存トレースが消えるため）', () => {
    assert.match(read('astro.config.mjs'), /'\.\/src\/data\/predictions\/\*\*\/\*\.json',/);
  });

  test('@netlify/plugin-sitemap を使わない（dist の sitemap.xml が上書きされる）', () => {
    const toml = read('netlify.toml');
    assert.doesNotMatch(toml.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n'), /plugin-sitemap/);
  });

  // prerender のページ（dist/<path>/index.html）を末尾スラッシュなしで 200 にする rewrite
  const PRERENDERED_REWRITES = [
    '/about', '/faq', '/terms', '/privacy', '/tokushoho', '/login', '/free-prediction',
    '/free-prediction/jra/archive', '/free-prediction/nankan/archive', '/archive', '/archive/jra', '/archive/nankan',
    '/lab/shutsuba', '/stats/:venue', '/results/:year/:month', '/results/:year/:month/:day',
  ];
  test('netlify.toml: prerender ページの rewrite（200・force）がそろっている', () => {
    const toml = read('netlify.toml');
    for (const from of PRERENDERED_REWRITES) {
      const re = new RegExp(`\\[\\[redirects\\]\\]\\n  from = "${from.replace(/[/:]/g, (c) => `\\${c}`)}"\\n  to = "${from.replace(/[/:]/g, (c) => `\\${c}`)}\\/index\\.html"\\n  status = 200\\n  force = true`);
      assert.match(toml, re, `${from} の rewrite が無い`);
    }
  });

  test('prerender = true のページは rewrite 対象か、意図的な対象外に限る', () => {
    const pagesDir = join(siteRoot, 'src', 'pages');
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    const toRoute = (f) => f.slice(pagesDir.length).replace(/\.astro$/, '').replace(/\/index$/, '').replace(/\[([a-z]+)\]/g, ':$1') || '/';
    // 対象外: / は Netlify が dist/index.html をそのまま返す。detail は最新日の一時ページ（JS が取得）。
    const exempt = new Set(['/', '/free-prediction/jra/detail/:slug']);
    for (const f of walk(pagesDir).filter((x) => x.endsWith('.astro'))) {
      if (!/^export const prerender = true;/m.test(readFileSync(f, 'utf8'))) continue;
      const route = toRoute(f);
      if (exempt.has(route)) continue;
      assert.ok(PRERENDERED_REWRITES.includes(route), `${route} は prerender だが rewrite が無い`);
    }
  });
});

describe('無料予想ページの canonical とタイトル', () => {
  const FILES = [
    'src/pages/free-prediction/jra/index.astro',
    'src/pages/free-prediction/nankan/index.astro',
    'src/pages/free-prediction/nankan/[slug].astro',
    'src/pages/free-prediction/jra/[date].astro',
  ];
  test('canonical を /prediction/*（未ログインは 302 で戻る）へ向けない＝自分自身', () => {
    for (const f of FILES) assert.doesNotMatch(read(f), /canonicalPath=/, f);
  });
  test('タイトルに「 - KEIBA Intelligence」を重ねない（BaseLayout が付ける）', () => {
    for (const f of FILES) {
      const src = read(f);
      const titleBlock = src.slice(src.indexOf('const title ='), src.indexOf('const description'));
      assert.doesNotMatch(titleBlock, /KEIBA Intelligence/, f);
    }
    assert.match(read('src/layouts/BaseLayout.astro'), /const siteTitle = `\$\{title\} \| KEIBA Intelligence`;/);
  });
  test('データの無い開催日は 404（soft 404 にしない）', () => {
    for (const f of ['src/pages/free-prediction/nankan/[slug].astro', 'src/pages/free-prediction/jra/[date].astro']) {
      assert.match(read(f), /if \(!day\.date\) Astro\.response\.status = 404;/, f);
    }
  });
});
