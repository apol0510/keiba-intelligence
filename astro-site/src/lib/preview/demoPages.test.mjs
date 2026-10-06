/**
 * demoPages.test.mjs — Deploy Preview 専用デモ Premium 画面が本番に存在しないことの検査
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { demoPaths, demoEnabled, DEMO_DAYS } from './demoPages.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

test('🔴 production / branch-deploy / 未設定では 1 ページも生成しない', () => {
  for (const env of [{ CONTEXT: 'production' }, { CONTEXT: 'branch-deploy' }, {}, { CONTEXT: 'dev' }]) {
    assert.equal(demoEnabled(env), false);
    assert.deepEqual(demoPaths(env), []);
  }
});

test('Deploy Preview（またはローカルの明示指定）だけ jra / nankan を生成', () => {
  assert.deepEqual(demoPaths({ CONTEXT: 'deploy-preview' }).map((p) => p.params.market).sort(), ['jra', 'nankan']);
  assert.equal(demoEnabled({ KI_PREVIEW_DEMO: '1' }), true);
});

test('🔴 デモは結果確定済みの過去日だけ・認証/Cookie に触れない・静的生成', () => {
  const page = readFileSync(`${ROOT}src/pages/preview-demo/[market].astro`, 'utf8');
  assert.match(page, /export const prerender = true/);
  assert.match(page, /return demoPaths\(\)/);
  assert.equal(/cookies|entitlement|Astro\.request|PREVIEW_PAID_KEY/.test(page), false);
  const jra = JSON.parse(readFileSync(`${ROOT}src/data/archiveResultsJra.json`, 'utf8'));
  const nankan = JSON.parse(readFileSync(`${ROOT}src/data/archiveResults.json`, 'utf8'));
  assert.ok(jra.some((d) => d.date === DEMO_DAYS.jra.date), 'JRA のデモ日は結果取込済み');
  assert.ok(nankan.some((d) => d.date === DEMO_DAYS.nankan.slug.slice(0, 10)), '南関のデモ日は結果取込済み');
});
