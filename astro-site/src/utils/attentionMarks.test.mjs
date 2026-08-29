/**
 * attentionMarks.test.mjs — 無料会員に本命順位を漏らさないことを固定する
 *
 * 実行: node --test src/utils/attentionMarks.test.mjs （astro-site 直下から）
 *
 * 仕様（docs/RENEWAL_2026_08.md §3 / §4・2026-08-29 確定）:
 *   1. 印が付くのは **2〜5 頭**
 *   2. 印は **同一種類 1 つだけ**（◎○▲△ のような序列を作らない）
 *   3. 返すのは **集合**であり、順序を持たない
 *   4. 出馬表は **常に馬番昇順**
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  attentionHorseNumbers, sortByHorseNumber,
  ATTENTION_MARK, ATTENTION_LABEL, ATTENTION_MIN, ATTENTION_MAX, ATTENTION_ROLES,
} from './attentionMarks.js';
import { loadNankanRaceDay, loadJraRaceDay, racesOf } from '../lib/prediction/loadRaceDay.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf-8');

const mk = (n, role, pt) => ({ horseNumber: n, role, pt });

/** 9 頭立ての典型（本命1・対抗1・単穴1・連下最上位1・連下3・補欠2） */
const FIELD = [
  mk(1, '連下', 126), mk(2, '補欠', 117), mk(3, '連下最上位', 131),
  mk(4, '対抗', 135), mk(5, '連下', 122), mk(6, '本命', 150),
  mk(7, '連下', 120), mk(8, '連下', 123), mk(9, '補欠', 119),
];

/* ---------- 1. 印は 2〜5 頭 ---------- */

test('印が付くのは 2〜5 頭', () => {
  const s = attentionHorseNumbers(FIELD);
  assert.ok(s.size >= ATTENTION_MIN && s.size <= ATTENTION_MAX, `size=${s.size}`);
});

test('役割該当が 1 頭しかなくても 2 頭まで補う', () => {
  const s = attentionHorseNumbers([mk(1, '本命', 150), mk(2, '連下', 120), mk(3, '連下', 118)]);
  assert.equal(s.size, 2);
});

test('役割該当が多すぎても 5 頭を超えない', () => {
  const many = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => mk(n, '本命', 150 - n));
  assert.equal(attentionHorseNumbers(many).size, ATTENTION_MAX);
});

test('全頭に印を付けない（印の意味が消えるため）', () => {
  for (const size of [2, 3]) {
    const field = Array.from({ length: size }, (_, i) => mk(i + 1, '本命', 150 - i));
    const s = attentionHorseNumbers(field);
    assert.ok(s.size < size, `${size}頭立てで全頭に印が付いた`);
  }
});

test('出走馬がいなければ空', () => {
  assert.equal(attentionHorseNumbers([]).size, 0);
  assert.equal(attentionHorseNumbers(null).size, 0);
});

/* ---------- 2. 順位が漏れない ---------- */

test('返り値は集合で、順序を持たない', () => {
  const s = attentionHorseNumbers(FIELD);
  assert.ok(s instanceof Set, 'Set でない（順序を持つ配列は順位が漏れる）');
});

test('印は 1 種類だけ（序列を作らない）', () => {
  assert.equal(typeof ATTENTION_MARK, 'string');
  assert.ok(ATTENTION_MARK.length > 0);
  // ◎○▲△ を使わない
  for (const m of ['◎', '○', '▲', '△', '☆']) {
    assert.notEqual(ATTENTION_MARK, m, `序列のある印 ${m} を使っている`);
  }
});

test('印の集合から本命が特定できない（本命だけの印を作らない）', () => {
  const s = attentionHorseNumbers(FIELD);
  // 本命(6) を含むが、対抗(4)・単穴(3) も同じ印なので本命は特定できない
  assert.ok(s.size >= 2, '印が 1 頭だけだと本命が特定できてしまう');
});

test('ATTENTION_ROLES に順序の意味を持たせない（集合として扱う）', () => {
  const a = attentionHorseNumbers(FIELD);
  const shuffled = [...FIELD].reverse();
  const b = attentionHorseNumbers(shuffled);
  assert.deepEqual([...a].sort((x, y) => x - y), [...b].sort((x, y) => x - y),
    '入力順で結果が変わる（順序に依存している）');
});

/* ---------- 3. 並び順 ---------- */

test('sortByHorseNumber: 常に馬番昇順', () => {
  const sorted = sortByHorseNumber(FIELD).map((h) => h.horseNumber);
  assert.deepEqual(sorted, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('sortByHorseNumber: pt や role の影響を受けない', () => {
  const byPt = [...FIELD].sort((a, b) => b.pt - a.pt);
  assert.deepEqual(
    sortByHorseNumber(byPt).map((h) => h.horseNumber),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
});

test('sortByHorseNumber: 馬番が無い馬は末尾へ（例外を投げない）', () => {
  const out = sortByHorseNumber([mk(3, '連下', 1), { horseName: 'x' }, mk(1, '本命', 2)]);
  assert.deepEqual(out.map((h) => h.horseNumber), [1, 3, undefined]);
  assert.deepEqual(sortByHorseNumber(null), []);
});

/* ---------- 4. 実データ（全レースで 2〜5 頭） ---------- */

test('実データ: 全レースで印が 2〜5 頭に収まる', () => {
  for (const load of [loadNankanRaceDay, loadJraRaceDay]) {
    const day = load(ROOT);
    if (day.error && !day.venues.length) continue;
    for (const venue of day.venues) {
      for (const race of racesOf(venue)) {
        const horses = race?.horses || [];
        if (horses.length < 2) continue;
        const s = attentionHorseNumbers(horses);
        assert.ok(
          s.size >= ATTENTION_MIN && s.size <= ATTENTION_MAX,
          `${venue.venueName} ${race.raceInfo.raceNumber}R: 印が ${s.size} 頭（2〜5 の範囲外）`,
        );
        assert.ok(s.size < horses.length, `${venue.venueName} ${race.raceInfo.raceNumber}R: 全頭に印`);
      }
    }
  }
});

/* ---------- 5. 配線の静的検証 ---------- */

test('RaceEntryTable が注目印の仕組みを使っている', () => {
  const src = read('src/components/newspaper/RaceEntryTable.astro');
  assert.match(src, /attentionHorseNumbers\(/);
  assert.match(src, /ATTENTION_MARK/);
  assert.ok(!/role-tag/.test(src), '役割バッジが残っている');
});

test('ATTENTION_LABEL が役割語でない', () => {
  for (const w of ['本命', '対抗', '単穴', '連下', '補欠']) {
    assert.ok(!ATTENTION_LABEL.includes(w), `印のラベルに役割語「${w}」が入っている`);
  }
});
