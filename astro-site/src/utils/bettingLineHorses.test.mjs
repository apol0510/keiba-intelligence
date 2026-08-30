/**
 * bettingLineHorses.test.mjs — 買い目の馬番抽出（表示専用）と、
 * 並べ替え・抽出ボタンが **有料 tier 限定**であることを固定する。
 *
 * 実行: node --test src/utils/bettingLineHorses.test.mjs （astro-site 直下から）
 *
 * 固定する不変条件（docs/RENEWAL_2026_08.md §4.4 / R-9）:
 *   1. 買い目の文字列から、画面に印字されている馬番をすべて拾う（抑えを含む）
 *   2. 🔴 的中判定に流用されていない（単一源は umatanHit.js）
 *   3. 🔴 ボタン・`data-pt`・`data-bet` は **showBetting のときだけ**描画する
 *   4. 🔴 free/guest には買い目の痕跡（betHorses）を渡さない
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseBettingHorses, parseAxisHorses } from './bettingLineHorses.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf-8');
/** コメントを除いた実コード（説明文の中の語に反応させない）。 */
const codeOf = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

/* ---------- 1. 馬番の抽出 ---------- */

test('通常レース形式: 軸と本線相手をすべて拾う', () => {
  assert.deepEqual(parseBettingHorses(['4-6.8.12.3.11.9']), [3, 4, 6, 8, 9, 11, 12]);
});

test('抑え付き: 画面に出ている馬番なので抑えも拾う', () => {
  assert.deepEqual(
    parseBettingHorses(['4-6.8.12(抑え10.7.5)']),
    [4, 5, 6, 7, 8, 10, 12],
  );
});

test('メインレース 10 点形式', () => {
  assert.deepEqual(parseBettingHorses(['3-5.7.8.10.12']), [3, 5, 7, 8, 10, 12]);
});

test('複数行をまとめて重複なく返す', () => {
  const out = parseBettingHorses(['4-6.8.12', '6-4.8.12']);
  assert.deepEqual(out, [4, 6, 8, 12]);
});

test('parseAxisHorses: 軸だけを返す', () => {
  assert.deepEqual(parseAxisHorses(['4-6.8.12', '6-4.8.12']), [4, 6]);
});

test('壊れた入力・空・非配列で落ちない', () => {
  for (const v of [null, undefined, '', [], [null, 42, {}], ['', '   '], 'not-an-array']) {
    assert.deepEqual(parseBettingHorses(v), [], `${JSON.stringify(v)} で空にならない`);
    assert.deepEqual(parseAxisHorses(v), []);
  }
});

test('馬番の範囲外（19 以上・0）を拾わない', () => {
  assert.deepEqual(parseBettingHorses(['4-6.8.99.0.18']), [4, 6, 8, 18]);
});

/* ---------- 2. 的中判定に流用していない ---------- */

test('🔴 的中判定が bettingLineHorses を使っていない（単一源は umatanHit）', () => {
  for (const f of ['src/utils/umatanHit.js', 'scripts/importResults.js', 'scripts/importResultsJra.js']) {
    let src;
    try { src = codeOf(f); } catch { continue; }
    assert.ok(!/bettingLineHorses/.test(src), `${f} が表示専用モジュールを的中判定に使っている`);
  }
});

test('自身が的中判定をしていない', () => {
  const src = codeOf('src/utils/bettingLineHorses.js');
  assert.ok(!/checkUmatanHit|isHit|hitLines|payout/.test(src), '的中判定に踏み込んでいる');
});

/* ---------- 3. 🔴 有料 tier 限定であること ---------- */

test('🔴 ボタンは showBetting のときだけ描画される', () => {
  const src = read('src/components/newspaper/RaceEntryTable.astro');
  // showTools は showRanked（= view.showBetting）から決まる
  assert.match(src, /const showTools = showRanked;/, 'ボタンの出し分けが showBetting 由来でない');
  assert.match(src, /const showRanked = !!view\?\.showBetting;/, 'showRanked の定義が変わっている');
  // 描画そのものを止める（CSS で隠さない）
  assert.match(src, /\{showTools && \(/, 'ボタンを条件描画していない');
  assert.ok(!/\.ret-tools\s*\{[^}]*display:\s*none/.test(src), 'CSS で隠す実装になっている');
});

test('🔴 AI指数と買い目の行データは有料 tier のときだけ出る', () => {
  const src = read('src/components/newspaper/RaceEntryTable.astro');
  // data-pt は showRanked のときだけ値が入る
  assert.match(src, /data-pt=\{showRanked && r\.pt != null \? r\.pt : ''\}/, 'data-pt が無条件に出ている');
  // betSet は showRanked のときだけ中身を持つ
  assert.match(
    src,
    /const betSet = new Set<number>\(showRanked && Array\.isArray\(betHorses\)/,
    'betSet が tier で絞られていない',
  );
});

test('🔴 RaceNewspaper は showBetting のときだけ betHorses を渡す', () => {
  const src = read('src/components/newspaper/RaceNewspaper.astro');
  assert.match(
    src,
    /const betHorses = showBetting \? parseBettingHorses\(validBetting\) : \[\];/,
    'free/guest へ買い目の馬番が渡っている',
  );
});

test('並べ替えは詳細行を本体行と一緒に動かす', () => {
  const src = read('src/components/newspaper/RaceEntryTable.astro');
  assert.match(src, /body\.appendChild\(p\.row\)/, '本体行を並べ替えていない');
  assert.match(src, /if \(p\.detail\) body\.appendChild\(p\.detail\)/, '詳細行が本体行に追従しない');
});

test('抽出で隠した行の詳細も閉じる', () => {
  const src = read('src/components/newspaper/RaceEntryTable.astro');
  assert.match(src, /p\.detail\.setAttribute\('hidden', ''\)/, '隠した行の詳細が開いたまま残る');
});
