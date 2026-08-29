/**
 * attentionMarks.test.mjs — 無料会員の印仕様（重複付与）を固定する
 *
 * 実行: node --test src/utils/attentionMarks.test.mjs （astro-site 直下から）
 *
 * 仕様（docs/RENEWAL_2026_08.md §2 R-3・2026-08-29 改訂）:
 *   1. 「印」1 列に **複数の印を重複付与**する（1 頭に ◎○▲△ が複数付きうる）
 *   2. 目安は ◎3〜5 / ○3〜5 / ▲3〜5 / △約10 頭。該当しない馬は空欄
 *   3. **評価順 1 位と 2 位は必ず同じ印の組み合わせ** → 本命を一意に特定できない
 *   4. **ランダム・ダミーを使わない**。KI 評価から決定論的に算出する
 *   5. 画面の並びは常に馬番昇順（印の算出順とは別）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assignFreeMarks, markCounts, evaluationOrder, computeMarkBands,
  sortByHorseNumber, MARK_SYMBOLS, MARK_COUNT_MIN, MARK_COUNT_MAX,
} from './attentionMarks.js';
import { loadNankanRaceDay, loadJraRaceDay, racesOf } from '../lib/prediction/loadRaceDay.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf-8');

const ROLES = ['本命', '対抗', '単穴', '連下最上位'];

/** n 頭立ての典型的な評価（上位 4 頭に役割、以降は連下）。 */
function field(n) {
  return Array.from({ length: n }, (_, i) => ({
    horseNumber: i + 1,
    horseName: `馬${i + 1}`,
    role: ROLES[i] || '連下',
    pt: 200 - i,
  }));
}

/** 評価順に並べた印の配列。 */
function marksInEvalOrder(horses) {
  const m = assignFreeMarks(horses);
  return evaluationOrder(horses).map((h) => m.get(h.horseNumber));
}

/* ---------- 1. 複数付与 ---------- */

test('1 頭に複数の印が付く（重複付与）', () => {
  const marks = marksInEvalOrder(field(12));
  assert.ok(marks.some((m) => m.length > 1), '複数印が 1 つも無い');
  assert.ok(marks.some((m) => m.includes('◎') && m.includes('△')), '◎△ の重複が無い');
  assert.ok(marks.some((m) => m.includes('○') && m.includes('▲')), '○▲ の重複が無い');
});

test('該当しない馬は空欄', () => {
  const counts = markCounts(field(16));
  assert.ok(counts.blank > 0, '空欄の馬がいない');
});

/* ---------- 2. 頭数の目安 ---------- */

test('12〜18 頭立てで ◎○▲ が 3〜5 頭、△ が 10 頭', () => {
  for (let n = 12; n <= 18; n += 1) {
    const c = markCounts(field(n));
    for (const s of ['◎', '○', '▲']) {
      assert.ok(c[s] >= MARK_COUNT_MIN && c[s] <= MARK_COUNT_MAX,
        `${n}頭: ${s} が ${c[s]} 頭（3〜5 の範囲外）`);
    }
    assert.equal(c['△'], 10, `${n}頭: △ が ${c['△']} 頭`);
    assert.ok(c.blank >= 2, `${n}頭: 空欄が ${c.blank} 頭`);
  }
});

test('頭数が少ないレースでは △ が出走頭数−2 まで縮む（空欄を必ず残す）', () => {
  for (let n = 7; n <= 11; n += 1) {
    const c = markCounts(field(n));
    assert.equal(c['△'], n - 2, `${n}頭: △ が ${c['△']} 頭`);
    assert.ok(c.blank >= 2, `${n}頭: 空欄が ${c.blank} 頭`);
  }
});

test('8 頭以上なら ◎○▲ は 3〜5 頭に収まる', () => {
  for (let n = 8; n <= 18; n += 1) {
    const c = markCounts(field(n));
    for (const s of ['◎', '○', '▲']) {
      assert.ok(c[s] >= MARK_COUNT_MIN && c[s] <= MARK_COUNT_MAX,
        `${n}頭: ${s} が ${c[s]} 頭`);
    }
  }
});

/* ---------- 3. 本命が一意に特定できない ---------- */

test('評価順 1 位と 2 位は必ず同じ印の組み合わせ', () => {
  for (let n = 4; n <= 18; n += 1) {
    const marks = marksInEvalOrder(field(n));
    assert.equal(marks[0], marks[1],
      `${n}頭: 1 位「${marks[0]}」と 2 位「${marks[1]}」が違う（本命が特定できる）`);
  }
});

test('最上位の印の組み合わせを持つ馬が必ず 2 頭以上いる', () => {
  for (let n = 4; n <= 18; n += 1) {
    const marks = marksInEvalOrder(field(n));
    const same = marks.filter((m) => m === marks[0]).length;
    assert.ok(same >= 2, `${n}頭: 最上位と同じ印の馬が ${same} 頭しかいない`);
  }
});

test('○ と ▲ は評価順 3 位以降から始まる（1・2 位を分けない）', () => {
  for (let n = 5; n <= 18; n += 1) {
    const b = computeMarkBands(Math.min(10, n <= 3 ? n - 1 : n - 2));
    if (b.circle[0] > 0) assert.ok(b.circle[0] >= 3, `${n}頭: ○ が ${b.circle[0]} 位から`);
    if (b.filled[0] > 0) assert.ok(b.filled[0] >= 3, `${n}頭: ▲ が ${b.filled[0]} 位から`);
  }
});

/* ---------- 4. 決定論（ランダム・ダミーを使わない） ---------- */

test('同じ入力からは常に同じ印になる', () => {
  const a = [...assignFreeMarks(field(14)).entries()].sort();
  const b = [...assignFreeMarks(field(14)).entries()].sort();
  assert.deepEqual(a, b);
});

test('入力の並び順を変えても印が変わらない', () => {
  const f = field(14);
  const a = [...assignFreeMarks(f).entries()].sort();
  const b = [...assignFreeMarks([...f].reverse()).entries()].sort();
  assert.deepEqual(a, b, '入力順に依存している');
});

test('印は KI 評価に連動する（pt を入れ替えると印も入れ替わる）', () => {
  const f = field(12).map((h) => ({ ...h, role: '連下' })); // 役割を同一にして pt だけで決める
  const before = assignFreeMarks(f);
  const swapped = f.map((h) => (h.horseNumber === 1 ? { ...h, pt: 0 } : h));
  const after = assignFreeMarks(swapped);
  assert.notEqual(before.get(1), after.get(1), '評価を落としても印が変わらない');
});

test('実装がランダムを使っていない', () => {
  const src = read('src/utils/attentionMarks.js');
  assert.ok(!/Math\.random/.test(src), 'ランダムを使っている');
  assert.ok(!/Date\.now|new Date/.test(src), '時刻に依存している');
});

/* ---------- 5. 並び順 ---------- */

test('sortByHorseNumber: 常に馬番昇順（評価の影響を受けない）', () => {
  const byPt = [...field(12)].sort((a, b) => a.pt - b.pt);
  assert.deepEqual(
    sortByHorseNumber(byPt).map((h) => h.horseNumber),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  );
  assert.deepEqual(sortByHorseNumber(null), []);
});

/* ---------- 6. 実データ ---------- */

test('実データ: 全レースで印の頭数と非一意性を満たす', () => {
  let checked = 0;
  const bad = [];
  for (const load of [loadNankanRaceDay, loadJraRaceDay]) {
    const day = load(ROOT);
    if (day.error && !day.venues.length) continue;
    for (const venue of day.venues) {
      for (const race of racesOf(venue)) {
        const horses = race?.horses || [];
        if (horses.length < 4) continue;
        checked += 1;
        const c = markCounts(horses);
        const marks = marksInEvalOrder(horses);
        const label = `${venue.venueName}${race.raceInfo.raceNumber}R(${horses.length}頭)`;

        for (const s of ['◎', '○', '▲']) {
          if (c[s] < MARK_COUNT_MIN || c[s] > MARK_COUNT_MAX) bad.push(`${label}: ${s}=${c[s]}`);
        }
        // △ は 10 頭、頭数が少なければ 出走頭数-2
        const expectedTriangle = Math.min(10, horses.length - 2);
        if (c['△'] !== expectedTriangle) bad.push(`${label}: △=${c['△']}（期待 ${expectedTriangle}）`);
        if (c.blank < 1) bad.push(`${label}: 空欄なし`);
        if (marks[0] !== marks[1]) bad.push(`${label}: 上位2頭の印が異なる`);
      }
    }
  }
  assert.ok(checked > 0, '検査対象が 0 レース');
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} 件の逸脱`);
});

/* ---------- 7. 配線 ---------- */

test('RaceEntryTable が重複印の仕組みを使っている', () => {
  const src = read('src/components/newspaper/RaceEntryTable.astro');
  assert.match(src, /assignFreeMarks\(/, '重複印の算出を使っていない');
  assert.ok(!/role-tag/.test(src), '役割バッジが残っている');
  assert.match(src, /freeMark/, '印の描画が重複印を使っていない');
});

test('印は ◎○▲△ の 4 種類だけ', () => {
  assert.deepEqual(MARK_SYMBOLS, ['◎', '○', '▲', '△']);
});
