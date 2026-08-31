/**
 * pedigreeName.test.mjs — 血統名の妥当性判定（fail-closed）
 *
 * 実行: node --test src/utils/pedigreeName.test.mjs （astro-site 直下から）
 *
 * 上流 `horseStats.profile.damsire` に「性齢 毛色 生年月日 中同名」が
 * 混入しているレコードがあり、そのまま出すと母の父として誤情報になる。
 * ここでは「馬名として妥当でない値を表示しない」ことを固定する。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isPlausiblePedigreeName, cleanPedigreeName } from './pedigreeName.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('正常な馬名は通す', () => {
  for (const n of ['ニューイヤーズデイ', 'キズナ', 'ゼンノロブロイ', 'ハーツクライ', '(外)ミクストベリーズ']) {
    assert.equal(isPlausiblePedigreeName(n), true, n);
    assert.equal(cleanPedigreeName(` ${n} `), n);
  }
});

test('上流の列ずれ（性齢・毛色・生年月日・同名）は表示しない', () => {
  for (const bad of [
    '牡6 鹿毛 20.2.22 中同名',
    '牝3 青鹿毛 23.3.25 中同名',
    'セ5 栗毛 21.3.23 中同名',
    '牡4 栗毛 22.2.17 中同名',
  ]) {
    assert.equal(isPlausiblePedigreeName(bad), false, bad);
    assert.equal(cleanPedigreeName(bad), null, bad);
  }
});

test('毛色だけ・日付だけ・数字だけも表示しない', () => {
  for (const bad of ['鹿毛', '黒鹿毛', '20.2.22', '123', '']) {
    assert.equal(isPlausiblePedigreeName(bad), false, JSON.stringify(bad));
  }
});

test('文字列でない値・長すぎる値は表示しない', () => {
  for (const bad of [null, undefined, 0, 123, {}, [], 'あ'.repeat(25)]) {
    assert.equal(isPlausiblePedigreeName(bad), false, JSON.stringify(bad));
    assert.equal(cleanPedigreeName(bad), null);
  }
});

test('実データ: dam は全件通り、damsire の列ずれだけが弾かれる', () => {
  const base = join(ROOT, 'src', 'data', 'horseStats', 'nankan');
  if (!existsSync(base)) return;

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

  let damTotal = 0, damRejected = 0, damsireTotal = 0, damsireRejected = 0;
  for (const f of files.slice(-40)) {
    let json;
    try { json = JSON.parse(readFileSync(f, 'utf-8')); } catch { continue; }
    for (const h of (json?.horses || [])) {
      const p = h?.horseStatsNankan?.profile;
      if (!p) continue;
      if (p.dam != null) { damTotal += 1; if (!isPlausiblePedigreeName(p.dam)) damRejected += 1; }
      if (p.damsire != null) { damsireTotal += 1; if (!isPlausiblePedigreeName(p.damsire)) damsireRejected += 1; }
    }
  }

  assert.ok(damTotal > 0, '照合対象が 0 件');
  // 母は上流で壊れていない（壊れ始めたら検知したい）
  assert.equal(damRejected, 0, `母（dam）に妥当でない値が ${damRejected} 件ある`);
  // 母の父は壊れているレコードがあり、それが弾かれていること
  assert.ok(damsireRejected > 0, '母の父の列ずれが検出できていない（判定が緩い）');
  assert.ok(damsireRejected < damsireTotal, '母の父が全件弾かれている（判定が厳しすぎる）');
});

test('HorseDetailPanel が血統名の妥当性判定を通している', () => {
  const src = readFileSync(join(ROOT, 'src', 'components', 'newspaper', 'HorseDetailPanel.astro'), 'utf-8');
  assert.match(src, /cleanPedigreeName\(/, '血統名の判定を通していない');
});
