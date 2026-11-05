/**
 * serviceScope.test.mjs — 無料・有料の説明が /pricing の表と食い違わないことの契約
 * 実行: `npm run test:seo`（build に組込み）
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  SERVICE_TIERS, SERVICE_SCOPE_SUMMARY, DAY_PAGE_SCOPE_NOTE, buildAboutJsonLd, renderJsonLd,
} from './serviceScope.js';

const siteRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(siteRoot, p), 'utf8');

/** pricing.astro の TIER_MATRIX を行ごとに読む */
function pricingMatrix() {
  const src = read('src/pages/pricing.astro');
  const rows = [...src.matchAll(/\{ label: '([^']+)', guest: (true|false), free: (true|false), paid: (true|false) \}/g)];
  assert.ok(rows.length >= 5, 'TIER_MATRIX を読めない');
  return new Map(rows.map(([, label, guest, free, paid]) => [label, { guest: guest === 'true', free: free === 'true', paid: paid === 'true' }]));
}

describe('/pricing の表との一致', () => {
  const matrix = pricingMatrix();
  const [guest, free, paid] = SERVICE_TIERS;

  test('未登録の項目は未登録から見える', () => {
    for (const item of guest.items) assert.equal(matrix.get(item)?.guest, true, item);
  });
  test('無料会員の項目は未登録に無く、無料会員に有る', () => {
    for (const item of free.items) {
      assert.equal(matrix.get(item)?.guest, false, item);
      assert.equal(matrix.get(item)?.free, true, item);
    }
  });
  test('プレミアムの項目は無料に無く、有料に有る', () => {
    for (const item of paid.items) {
      assert.equal(matrix.get(item)?.free, false, item);
      assert.equal(matrix.get(item)?.paid, true, item);
    }
  });
  test('有料の項目はすべて説明に載っている', () => {
    for (const [label, row] of matrix) {
      if (!row.free) assert.ok(paid.items.includes(label), `${label} が説明に無い`);
    }
  });
});

describe('文面', () => {
  const texts = [SERVICE_SCOPE_SUMMARY, DAY_PAGE_SCOPE_NOTE, JSON.stringify(SERVICE_TIERS), JSON.stringify(buildAboutJsonLd())];

  test('有料の範囲があることを必ず書く', () => {
    assert.match(SERVICE_SCOPE_SUMMARY, /有料/);
    assert.match(DAY_PAGE_SCOPE_NOTE, /有料/);
  });
  test('「完全無料」と書かず、金額と実績の数値を書かない', () => {
    for (const t of texts) {
      assert.doesNotMatch(t, /完全無料|全て無料|すべて無料/);
      assert.doesNotMatch(t, /[¥￥]|\d+円|的中率|回収率/);
    }
  });
});

describe('ページへの組込み', () => {
  test('/about に範囲の説明と JSON-LD がある', () => {
    const src = read('src/pages/about.astro');
    assert.match(src, /SERVICE_TIERS\.map/);
    assert.match(src, /application\/ld\+json/);
    assert.match(src, /href="\/pricing"/);
  });
  test('開催日ページの description に有料の範囲がある', () => {
    for (const p of ['src/pages/free-prediction/jra/[date].astro', 'src/pages/free-prediction/nankan/[slug].astro']) {
      assert.match(read(p), /DAY_PAGE_SCOPE_NOTE/, p);
    }
  });
  test('JSON-LD の文字列は script を閉じられない', () => {
    assert.doesNotMatch(renderJsonLd({ a: '</script>' }), /<\/script>/);
  });
  test('JSON-LD は Organization と WebSite を持ち、本番の URL を使う', () => {
    const graph = buildAboutJsonLd()['@graph'];
    assert.deepEqual(graph.map((g) => g['@type']), ['Organization', 'WebSite']);
    assert.equal(graph[0].url, 'https://keiba-intelligence.jp/');
  });
});
