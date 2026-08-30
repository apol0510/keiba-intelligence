/**
 * bettingPlan.test.mjs — 「買い目を抽出」パネルの展開ロジックを固定する
 *
 * 実行: node --test src/utils/bettingPlan.test.mjs （astro-site 直下から）
 *
 * 固定する不変条件（BET_POINT_LOGIC.md / docs/RENEWAL_2026_08.md §4.4・R-9）:
 *   1. 展開方向は F3 と同じ（メイン reverseTopK=0 / 通常 reverseTopK=3）
 *   2. 🔴 抑えは買わない（点数・購入額に算入しない）
 *   3. 同じ組み合わせを二重に数えない
 *   4. 🔴 画面に出す点数は **推奨購入点数**（頭数依存・**12 点を超えない**）
 *      見出しの点数と表示するチップ数が一致する
 *   5. 🔴 的中判定に流用していない（単一源は umatanHit.js）
 *   6. 🔴 パネル・ボタンは showBetting のときだけ描画する
 *   7. 🔴 出馬表をフィルタしない（2026-08-30 に「買い目の馬だけ」を廃止）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildBettingPlan, parseBettingLine, recommendedPoints,
  UNIT_PRICE_YEN, REVERSE_TOP_K_MAIN, REVERSE_TOP_K_NORMAL, MAX_RECOMMENDED_POINTS,
} from './bettingPlan.js';
import { checkUmatanHit } from './umatanHit.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf-8');
const codeOf = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const NORMAL = ['4-6.8.12.3.11.9(抑え10.7.5)', '6-4.8.12.3.11.9(抑え10.7.5)'];
const MAIN = ['3-5.7.8.10.12'];
const key = (c) => `${c.first}-${c.second}`;

/* ---------- 1. 行の分解 ---------- */

test('parseBettingLine: 軸・相手・抑えに分ける', () => {
  const l = parseBettingLine('4-6.8.12.3.11.9(抑え10.7.5)');
  assert.equal(l.axis, 4);
  assert.deepEqual(l.partners, [6, 8, 12, 3, 11, 9]);
  assert.deepEqual(l.hold, [10, 7, 5]);
});

test('parseBettingLine: 抑えが無い形式', () => {
  const l = parseBettingLine('3-5.7.8.10.12');
  assert.equal(l.axis, 3);
  assert.deepEqual(l.partners, [5, 7, 8, 10, 12]);
  assert.deepEqual(l.hold, []);
});

test('parseBettingLine: 壊れた入力は null', () => {
  for (const v of ['', '   ', 'abc', '4-', '-6.8', null, undefined, 42, {}]) {
    assert.equal(parseBettingLine(v), null, `${JSON.stringify(v)} が通った`);
  }
});

/* ---------- 2. 展開（F3 と同じ方向ルール） ---------- */

test('メインレース: 軸 → 相手の一方向のみ（5点）', () => {
  const p = buildBettingPlan(MAIN, { isMain: true, fieldSize: 9 });
  assert.equal(p.reverseTopK, REVERSE_TOP_K_MAIN);
  assert.equal(p.expandedPoints, 5);
  assert.deepEqual(p.allCombos.map(key), ['3-5', '3-7', '3-8', '3-10', '3-12']);
  // 展開が 5 点しか無いので推奨も 5 点
  assert.equal(p.points, 5);
  assert.equal(p.amountYen, 5 * UNIT_PRICE_YEN);
});

test('通常レース: 前進全頭 ＋ 評価上位3頭の逆方向', () => {
  const p = buildBettingPlan(NORMAL, { fieldSize: 12 });
  const key2 = (c) => `${c.first}-${c.second}`;
  assert.equal(p.reverseTopK, REVERSE_TOP_K_NORMAL);
  // 4→6.8.12.3.11.9 / 6→4.8.12.3.11.9 の前進12点。
  // 逆方向は各行の上位3頭のみ（6→4,8→4,12→4 / 4→6,8→6,12→6）だが
  // 4→6 と 6→4 は前進側と重複するので、増えるのは 8→4,12→4,8→6,12→6 の4点
  assert.equal(p.expandedPoints, 16);
  for (const k of ['4-6', '6-4', '8-4', '12-4', '8-6', '12-6']) {
    assert.ok(p.allCombos.map(key2).includes(k), `${k} が無い`);
  }
  // 評価4位以下は逆方向を持たない
  for (const k of ['3-4', '11-4', '9-4', '3-6', '11-6', '9-6']) {
    assert.ok(!p.allCombos.map(key2).includes(k), `${k} は逆方向に含めてはいけない`);
  }
});

/* ---------- 2-b. 🔴 推奨購入点数 ---------- */

test('recommendedPoints: 頭数に応じて決まり、12 点を超えない', () => {
  const big = 99; // 展開数は十分あるものとする
  assert.equal(recommendedPoints(7, big), 6);
  assert.equal(recommendedPoints(8, big), 6);
  assert.equal(recommendedPoints(9, big), 8);
  assert.equal(recommendedPoints(11, big), 8);
  assert.equal(recommendedPoints(12, big), 10);
  assert.equal(recommendedPoints(14, big), 10);
  assert.equal(recommendedPoints(15, big), MAX_RECOMMENDED_POINTS);
  assert.equal(recommendedPoints(18, big), MAX_RECOMMENDED_POINTS);
});

test('🔴 推奨点数が 12 点を超えることはない', () => {
  for (let n = 1; n <= 24; n++) {
    assert.ok(recommendedPoints(n, 99) <= MAX_RECOMMENDED_POINTS, `${n}頭で 12 点を超えた`);
  }
});

test('展開数が推奨より少なければ展開数に合わせる', () => {
  assert.equal(recommendedPoints(18, 5), 5);
  assert.equal(recommendedPoints(12, 0), 0);
  assert.equal(recommendedPoints(NaN, 4), 4);
});

test('🔴 見出しの点数と表示する組み合わせの数が一致する', () => {
  for (const [lines, opt] of [[NORMAL, { fieldSize: 12 }], [MAIN, { isMain: true, fieldSize: 9 }]]) {
    const p = buildBettingPlan(lines, opt);
    assert.equal(p.combos.length, p.points, '見出しとチップ数がずれている');
    assert.equal(p.amountYen, p.points * UNIT_PRICE_YEN, '購入額が点数と合っていない');
  }
});

test('🔴 推奨は展開した組の部分集合', () => {
  const p = buildBettingPlan(NORMAL, { fieldSize: 12 });
  assert.equal(p.points, 10, '12頭立ての推奨は10点');
  assert.equal(p.amountYen, 1000);
  const all = new Set(p.allCombos.map(key));
  for (const c of p.combos) assert.ok(all.has(key(c)), `${key(c)} が展開に無い`);
});

/* ---------- 2-c. 軸ごとの内訳は馬番昇順 ---------- */

test('🔴 軸の相手は馬番昇順で返す（評価順を画面に出さない）', () => {
  const p = buildBettingPlan(NORMAL, { fieldSize: 12 });
  for (const l of p.lines) {
    const sorted = [...l.partners].sort((a, b) => a - b);
    assert.deepEqual(l.partners, sorted, `軸${l.axis} の相手が馬番順でない`);
  }
  assert.deepEqual(p.lines[0].partners, [3, 6, 8, 9, 11, 12]);
  assert.deepEqual(p.lines[1].partners, [3, 4, 8, 9, 11, 12]);
});

test('抑えも馬番昇順', () => {
  const p = buildBettingPlan(NORMAL, { fieldSize: 12 });
  assert.deepEqual(p.hold, [5, 7, 10]);
});

test('同じ組み合わせを二重に数えない', () => {
  const p = buildBettingPlan(NORMAL, { fieldSize: 12 });
  const seen = p.allCombos.map(key);
  assert.equal(new Set(seen).size, seen.length, '重複した組がある');
});

test('自分自身への組み合わせを作らない', () => {
  const p = buildBettingPlan(['4-4.6.8'], { fieldSize: 12 });
  assert.ok(!p.allCombos.some((c) => c.first === c.second), '4→4 が生成された');
});

/* ---------- 3. 🔴 抑えは買わない ---------- */

test('🔴 抑えは点数にも購入額にも入らない', () => {
  const p = buildBettingPlan(NORMAL, { fieldSize: 12 });
  assert.deepEqual(p.hold, [5, 7, 10]);
  for (const c of p.allCombos) {
    assert.ok(!(p.hold.includes(c.first) && p.hold.includes(c.second)), '抑え同士の組が生成された');
  }
  // 抑えを消しても点数が変わらない
  const noHold = buildBettingPlan(NORMAL.map((l) => l.replace(/\(抑え[^)]*\)/, '')), { fieldSize: 12 });
  assert.equal(noHold.points, p.points, '抑えが点数に影響している');
  assert.equal(noHold.expandedPoints, p.expandedPoints);
  assert.equal(noHold.amountYen, p.amountYen);
});

/* ---------- 4. 展開が F3 判定と矛盾しない ---------- */

test('🔴 展開した組み合わせは checkUmatanHit と一致する', () => {
  for (const [lines, isMain] of [[NORMAL, false], [MAIN, true]]) {
    // 🔴 突き合わせるのは **展開した組の全体**（推奨は部分集合なので別で検証する）
    const plan = buildBettingPlan(lines, { isMain, fieldSize: 12 });
    const k = isMain ? 0 : 3;
    // 展開した組がすべて的中扱いになること
    for (const c of plan.allCombos) {
      const result = { results: [{ number: c.first }, { number: c.second }] };
      const hit = lines.some((l) => checkUmatanHit(l, result, k));
      assert.ok(hit, `${c.first}→${c.second} が的中判定で外れる（展開が多い）`);
    }
    // 展開していない組が的中扱いにならないこと
    const inPlan = new Set(plan.allCombos.map(key));
    for (let a = 1; a <= 13; a++) {
      for (let b = 1; b <= 13; b++) {
        if (a === b || inPlan.has(`${a}-${b}`)) continue;
        const result = { results: [{ number: a }, { number: b }] };
        const hit = lines.some((l) => checkUmatanHit(l, result, k));
        assert.ok(!hit, `${a}→${b} は展開していないのに的中判定が通る（展開が足りない）`);
      }
    }
  }
});

test('🔴 的中判定が bettingPlan を使っていない（単一源は umatanHit）', () => {
  for (const f of ['src/utils/umatanHit.js', 'scripts/importResults.js', 'scripts/importResultsJra.js']) {
    let src;
    try { src = codeOf(f); } catch { continue; }
    assert.ok(!/bettingPlan/.test(src), `${f} が表示専用モジュールを的中判定に使っている`);
  }
});

test('自身が結果との突き合わせをしていない', () => {
  const src = codeOf('src/utils/bettingPlan.js');
  assert.ok(!/checkUmatanHit|isHit|hitLines|payout|results/.test(src), '的中判定に踏み込んでいる');
});

/* ---------- 5. 🔴 有料 tier 限定 ---------- */

test('🔴 ツールバーとパネルは showBetting のときだけ描画される', () => {
  const src = read('src/components/newspaper/RaceEntryTable.astro');
  assert.match(src, /const showTools = showRanked;/, 'ボタンの出し分けが showBetting 由来でない');
  assert.match(src, /const plan = showRanked \? bettingPlan : null;/, 'パネルが tier で絞られていない');
  assert.match(src, /\{showTools && \(/, 'ボタンを条件描画していない');
  assert.match(src, /\{hasPlan && \(\n\s*<section class="ret-plan"/, 'パネルを条件描画していない');
  assert.ok(!/\.ret-plan\s*\{[^}]*display:\s*none/.test(src), 'CSS で隠す実装になっている');
});

test('🔴 RaceNewspaper は showBetting のときだけ買い目を展開する', () => {
  const src = read('src/components/newspaper/RaceNewspaper.astro');
  assert.match(src, /const bettingPlan = showBetting && validBetting\.length/, 'free/guest へ買い目が渡っている');
});

test('メインレース判定が RaceDayBoard から渡っている', () => {
  const board = read('src/components/newspaper/RaceDayBoard.astro');
  assert.match(board, /isMain=\{!!e\.isMain\}/, 'isMain を渡していない（通常扱いになり点数がずれる）');
});

/* ---------- 6. 🔴 出馬表のフィルタは廃止 ---------- */

test('🔴 「買い目の馬だけ」フィルタが復活していない', () => {
  const src = read('src/components/newspaper/RaceEntryTable.astro');
  for (const gone of ['data-bet', 'inBet', 'is-filtered', 'betHorses', '買い目の馬だけ']) {
    assert.ok(!src.includes(gone), `廃止した出馬表フィルタが残っている: ${gone}`);
  }
  const news = read('src/components/newspaper/RaceNewspaper.astro');
  assert.ok(!news.includes('betHorses'), 'RaceNewspaper に betHorses が残っている');
});

test('並べ替えは詳細行を本体行と一緒に動かす', () => {
  const src = read('src/components/newspaper/RaceEntryTable.astro');
  assert.match(src, /body\.appendChild\(p\.row\)/, '本体行を並べ替えていない');
  assert.match(src, /if \(p\.detail\) body\.appendChild\(p\.detail\)/, '詳細行が本体行に追従しない');
});

test('🔴 削除した注記が復活していない', () => {
  const src = read('src/components/newspaper/RaceEntryTable.astro');
  for (const gone of [
    '買い目には含みません',
    '1点100円で計算しています',
    '回収率の投資基準',
  ]) {
    assert.ok(!src.includes(gone), `削除した注記が残っている: ${gone}`);
  }
  assert.match(src, /rpl-reco/, '「推奨」であることを画面に出していない');
});

test('パネルの開閉が出馬表の行に触れない', () => {
  const src = read('src/components/newspaper/RaceEntryTable.astro');
  const fn = src.slice(src.indexOf('function applyPlan'), src.indexOf('function syncButtons'));
  assert.ok(!/ret-row|tbody/.test(fn), 'パネルの開閉が出馬表を触っている');
});
