/**
 * frameNumber.test.mjs — 枠番算出の検証
 *
 * 実行: node --test src/utils/frameNumber.test.mjs （astro-site 直下から）
 *
 * 枠番は馬番と頭数から一意に決まる規則であり、推測ではない。
 * ここでは規則そのものと、**上流の実データ（南関 horseStats）との一致**を固定する。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { calcFrameNumber, resolveFrameNumber } from './frameNumber.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('8頭以下は枠番=馬番', () => {
  for (let n = 1; n <= 8; n += 1) assert.equal(calcFrameNumber(n, 8), n);
  assert.equal(calcFrameNumber(1, 1), 1);
  assert.equal(calcFrameNumber(5, 5), 5);
});

test('18頭: 枠1〜6が2頭、枠7・8が3頭', () => {
  const expected = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 7, 8, 8, 8];
  for (let n = 1; n <= 18; n += 1) {
    assert.equal(calcFrameNumber(n, 18), expected[n - 1], `馬番${n}`);
  }
});

test('9頭: 枠8だけ2頭', () => {
  const expected = [1, 2, 3, 4, 5, 6, 7, 8, 8];
  for (let n = 1; n <= 9; n += 1) assert.equal(calcFrameNumber(n, 9), expected[n - 1], `馬番${n}`);
});

test('16頭: 全枠2頭', () => {
  for (let n = 1; n <= 16; n += 1) {
    assert.equal(calcFrameNumber(n, 16), Math.ceil(n / 2), `馬番${n}`);
  }
});

test('不正な入力は null（推測しない）', () => {
  assert.equal(calcFrameNumber(0, 12), null);
  assert.equal(calcFrameNumber(13, 12), null);
  assert.equal(calcFrameNumber(null, 12), null);
  assert.equal(calcFrameNumber(3, null), null);
  assert.equal(calcFrameNumber('a', 12), null);
});

test('resolveFrameNumber: データの枠番を優先し、無ければ算出する', () => {
  assert.equal(resolveFrameNumber({ horseNumber: 5, frameNumber: 3 }, 18), 3);
  assert.equal(resolveFrameNumber({ horseNumber: 5 }, 18), 3);
  // 契約外の枠番は採用しない（算出へ落とす）
  assert.equal(resolveFrameNumber({ horseNumber: 5, frameNumber: 99 }, 18), 3);
  assert.equal(resolveFrameNumber({ horseNumber: 5 }, null), null);
});

test('上流の実データ（南関 horseStats）の枠番と一致する', () => {
  const base = join(ROOT, 'src', 'data', 'horseStats', 'nankan');
  if (!existsSync(base)) return; // データが無い環境ではスキップ

  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.json')) files.push(p);
    }
  };
  walk(base);
  if (!files.length) return;

  let checked = 0;
  const mismatches = [];
  for (const f of files) {
    let json;
    try { json = JSON.parse(readFileSync(f, 'utf-8')); } catch { continue; }
    const horses = Array.isArray(json?.horses) ? json.horses : [];
    const total = horses.length;
    for (const h of horses) {
      if (h?.frameNumber == null || h?.horseNumber == null) continue;
      checked += 1;
      const calc = calcFrameNumber(h.horseNumber, total);
      if (calc !== h.frameNumber) {
        mismatches.push(`${total}頭 馬番${h.horseNumber}: 実${h.frameNumber} / 算出${calc}`);
      }
    }
  }

  assert.ok(checked > 0, '照合対象が 0 件だった');
  assert.deepEqual(mismatches.slice(0, 5), [], `枠番の算出が実データと一致しない（${mismatches.length}件）`);
});
