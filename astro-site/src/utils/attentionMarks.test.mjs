/**
 * attentionMarks.test.mjs — 無料会員の印仕様を固定する
 *
 * 実行: node --test src/utils/attentionMarks.test.mjs （astro-site 直下から）
 *
 * 仕様（docs/RENEWAL_2026_08.md §2 R-3・2026-08-29 確定）:
 *   1. 「印」1 列に **複数の印を重複付与**する
 *   2. ◎○▲ は各 3〜5 頭、△ は約 10 頭（買い目の相手 5〜6 頭より広く）
 *   3. **本命は分かってよい**（評価最上位だけが「◎△」という一意の組み合わせ）
 *   4. **必ず空欄を残す**（2 頭以上）
 *   5. ランダム・ダミーを使わず、KI 評価から決定論的に算出する
 *   6. 画面の並びは常に馬番昇順
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assignFreeMarks, markCounts, evaluationOrder, computeMarkBands, sortByHorseNumber,
  MARK_SYMBOLS, MARK_COUNT_MIN, MARK_COUNT_MAX, minBlankFor,
} from './attentionMarks.js';
import { loadNankanRaceDay, loadJraRaceDay, racesOf } from '../lib/prediction/loadRaceDay.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf-8');

const ROLES = ['本命', '対抗', '単穴', '連下最上位'];

function field(n) {
  return Array.from({ length: n }, (_, i) => ({
    horseNumber: i + 1, horseName: `馬${i + 1}`,
    role: ROLES[i] || '連下', pt: 200 - i,
  }));
}

function marksInEvalOrder(horses) {
  const m = assignFreeMarks(horses);
  return evaluationOrder(horses).map((h) => m.get(h.horseNumber));
}

/* ---------- 1. 重複付与 ---------- */

test('1 頭に複数の印が付く（重複付与）', () => {
  const marks = marksInEvalOrder(field(12));
  assert.ok(marks.some((m) => m.length > 1), '複数印が 1 つも無い');
  assert.ok(marks.some((m) => m === '◎○△'), '◎○△ の重なりが無い');
  assert.ok(marks.some((m) => m === '○▲△'), '○▲△ の重なりが無い');
});

test('12 頭立ては ◎4 ○4 ▲5 △10 空欄2（確定した基準形）', () => {
  const c = markCounts(field(12));
  assert.equal(c['◎'], 4);
  assert.equal(c['○'], 4);
  assert.equal(c['▲'], 5);
  assert.equal(c['△'], 10);
  assert.equal(c.blank, 2);
});

/* ---------- 2. 頭数の目安 ---------- */

test('8 頭以上で ◎ と ○ は 3〜5 頭', () => {
  for (let n = 8; n <= 18; n += 1) {
    const c = markCounts(field(n));
    for (const s of ['◎', '○']) {
      assert.ok(c[s] >= MARK_COUNT_MIN && c[s] <= MARK_COUNT_MAX, `${n}頭: ${s} が ${c[s]} 頭`);
    }
  }
});

test('8 頭以上で ▲ は 3〜5 頭', () => {
  for (let n = 8; n <= 18; n += 1) {
    const c = markCounts(field(n));
    assert.ok(c['▲'] >= MARK_COUNT_MIN && c['▲'] <= MARK_COUNT_MAX, `${n}頭: ▲ が ${c['▲']} 頭`);
  }
});

test('△ は買い目の相手（5〜6 頭）より広い', () => {
  // 9 頭以上では △ が 7 頭以上あり、相手 5〜6 頭を特定できない
  for (let n = 9; n <= 18; n += 1) {
    const c = markCounts(field(n));
    assert.ok(c['△'] >= 7, `${n}頭: △ が ${c['△']} 頭しかない（相手を絞り込めてしまう）`);
  }
});

test('12 頭以上で △ は 10 頭以上', () => {
  for (let n = 12; n <= 18; n += 1) {
    assert.ok(markCounts(field(n))['△'] >= 10, `${n}頭: △ が少ない`);
  }
});

test('必ず空欄を残す（12 頭以上は 2 頭、少頭数は 1 頭）', () => {
  for (let n = 7; n <= 18; n += 1) {
    const need = minBlankFor(n);
    assert.ok(markCounts(field(n)).blank >= need, `${n}頭: 空欄が ${need} 頭未満`);
  }
});

test('少頭数でも △ が狭くならない（相手を絞り込めないこと）', () => {
  // 8 頭立てで △=6 だと、本命を除いた残りが相手 5〜6 頭と一致してしまう
  for (let n = 8; n <= 11; n += 1) {
    const c = markCounts(field(n));
    assert.ok(c['△'] >= n - 2, `${n}頭: △ が ${c['△']} 頭（狭すぎる）`);
  }
});

/* ---------- 3. 本命は分かる ---------- */

test('評価最上位だけが「◎△」という一意の組み合わせになる', () => {
  for (let n = 7; n <= 18; n += 1) {
    const marks = marksInEvalOrder(field(n));
    assert.equal(marks[0], '◎△', `${n}頭: 最上位の印が ${marks[0]}`);
    const same = marks.filter((m) => m === marks[0]).length;
    assert.equal(same, 1, `${n}頭: 同じ印の馬が ${same} 頭（本命が特定できない）`);
  }
});

test('○ は評価順 2 位から始まる（最上位を一意にするため）', () => {
  for (let n = 7; n <= 18; n += 1) {
    const b = computeMarkBands(n);
    assert.equal(b.circle[0], 2, `${n}頭: ○ が ${b.circle[0]} 位から`);
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

test('印は KI 評価に連動する（評価を落とすと印が変わる）', () => {
  const f = field(12).map((h) => ({ ...h, role: '連下' }));
  const before = assignFreeMarks(f);
  const after = assignFreeMarks(f.map((h) => (h.horseNumber === 1 ? { ...h, pt: 0 } : h)));
  assert.notEqual(before.get(1), after.get(1), '評価を落としても印が変わらない');
});

test('実装がランダム・時刻に依存していない', () => {
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

test('実データ: 全レースで印の頭数・空欄・本命の一意性を満たす', () => {
  let checked = 0;
  const bad = [];
  for (const load of [loadNankanRaceDay, loadJraRaceDay]) {
    const day = load(ROOT);
    if (day.error && !day.venues.length) continue;
    for (const venue of day.venues) {
      for (const race of racesOf(venue)) {
        const horses = race?.horses || [];
        if (horses.length < 8) continue;
        checked += 1;
        const c = markCounts(horses);
        const marks = marksInEvalOrder(horses);
        const label = `${venue.venueName}${race.raceInfo.raceNumber}R(${horses.length}頭)`;

        for (const s of ['◎', '○', '▲']) {
          if (c[s] < MARK_COUNT_MIN || c[s] > MARK_COUNT_MAX) bad.push(`${label}: ${s}=${c[s]}`);
        }
        if (c['△'] < 7) bad.push(`${label}: △=${c['△']}（相手を絞り込めてしまう）`);
        if (c.blank < minBlankFor(horses.length)) bad.push(`${label}: 空欄=${c.blank}`);
        if (marks.filter((m) => m === marks[0]).length !== 1) bad.push(`${label}: 最上位が一意でない`);
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
  assert.match(src, /freeMark/, '印の描画が重複印を使っていない');
  assert.ok(!/role-tag/.test(src), '役割バッジが残っている');
});

test('印は ◎○▲△ の 4 種類だけ', () => {
  assert.deepEqual(MARK_SYMBOLS, ['◎', '○', '▲', '△']);
});
