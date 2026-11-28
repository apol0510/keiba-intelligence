/**
 * 無料予想ページの HTML 量のガード（2026-11-20）
 *
 * HorseDetailPanel / FeatureBars は 1 頭ごとに描画され、JRA の無料予想ページでは
 * 全レース×全頭（約 500 頭）を 1 枚の HTML に含む。scoped style に戻すと要素ごとに
 * data-astro-cid 属性が付き、HTML が約 1.4MB 増える（4.1MB の約 36%）。
 *
 * global にする条件として、全セレクタがコンポーネント固有の接頭辞で始まることも検査する
 * （他のコンポーネントの要素へ漏れないこと）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../../components/newspaper/', import.meta.url));

const CASES = [
  { file: 'HorseDetailPanel.astro', prefix: /^\.hdp(-[a-z0-9-]+)?\b/ },
  { file: 'FeatureBars.astro', prefix: /^\.(feature-bars|fb-[a-z0-9-]+)\b/ },
];

function styleBlocks(src) {
  return [...src.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)].map((m) => ({ attrs: m[1], css: m[2] }));
}

function selectorsOf(css) {
  const out = [];
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of noComments.matchAll(/([^{}]+)\{/g)) {
    const head = m[1].trim();
    if (!head || head.startsWith('@') || /^(from|to|\d+%)$/.test(head)) continue;
    for (const sel of head.split(',')) out.push(sel.trim());
  }
  return out;
}

for (const { file, prefix } of CASES) {
  test(`${file}: style は is:global（data-astro-cid 属性を出さない）`, () => {
    const blocks = styleBlocks(readFileSync(dir + file, 'utf8'));
    assert.ok(blocks.length > 0, 'style ブロックがある');
    for (const b of blocks) assert.match(b.attrs, /\bis:global\b/);
  });

  test(`${file}: 全セレクタが固有の接頭辞で始まる（global でも他へ漏れない）`, () => {
    const blocks = styleBlocks(readFileSync(dir + file, 'utf8'));
    const sels = blocks.flatMap((b) => selectorsOf(b.css));
    assert.ok(sels.length > 5);
    const bad = sels.filter((s) => !prefix.test(s));
    assert.deepEqual(bad, []);
  });
}
