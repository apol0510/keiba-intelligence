/**
 * raceDayContract.test.mjs — venue / date / raceNumber の取り違えを fail-closed で固定する
 *
 * 実行: node --test src/lib/prediction/raceDayContract.test.mjs （astro-site 直下から）
 *
 * ── 背景（2026-08-29）─────────────────────────────────────────────
 * 「11R タブを選んでいるのに 1R が表示される」という報告を受けて調査した。
 * 実際の原因は表示側（長大ページ + `scroll-behavior: smooth` でアンカージャンプが不発）で、
 * データの取り違えではなかった。
 *
 * ただし **取り違えが起きたら重大**（別レースの予想をそのレースのものとして見せる）なので、
 * 以下を恒久的に固定する:
 *
 *   1. 契約: venue / date / raceNumber が揃い、一致していることを検証できる
 *   2. fail-closed: **判定できない（欠損）ものは違反として扱い、描画対象から外す**
 *   3. 実データ: 現在取り込まれている南関・JRA が契約を 1 件の違反もなく満たす
 *   4. 表示配線: タブとパネルが同一の key から作られ、スクロールに依存しない
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  checkRaceDay, isRaceVerified, verifiedRaceDay, RACE_DAY_VIOLATION,
} from './raceDayContract.js';
import { loadNankanRaceDay, loadJraRaceDay, racesOf } from './loadRaceDay.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf-8');

const DATE = '2026-08-18';

function mkRace(rn, over = {}) {
  return {
    raceInfo: { date: DATE, venue: '川崎', raceNumber: rn, raceName: `${rn}R`, ...over },
    horses: [{ horseNumber: 1, horseName: 'A' }],
  };
}

function mkDay(races, over = {}) {
  return {
    category: 'nankan',
    date: DATE,
    venues: [{ venueName: '川崎', data: { predictions: races } }],
    error: null,
    ...over,
  };
}

const codesOf = (r) => r.violations.map((v) => v.code);

/* ---------- 1. 正常系 ---------- */

test('整合しているデータは違反ゼロで通る', () => {
  const r = checkRaceDay(mkDay([mkRace(1), mkRace(2), mkRace(11)]));
  assert.equal(r.ok, true, JSON.stringify(r.violations));
  assert.deepEqual(r.violations, []);
});

/* ---------- 2. 取り違えを検出する ---------- */

test('raceInfo.venue が会場名と違えば違反', () => {
  const r = checkRaceDay(mkDay([mkRace(11, { venue: '大井' })]));
  assert.equal(r.ok, false);
  assert.ok(codesOf(r).includes(RACE_DAY_VIOLATION.VENUE_MISMATCH));
});

test('raceInfo.date が開催日と違えば違反', () => {
  const r = checkRaceDay(mkDay([mkRace(11, { date: '2026-08-17' })]));
  assert.equal(r.ok, false);
  assert.ok(codesOf(r).includes(RACE_DAY_VIOLATION.DATE_MISMATCH));
});

test('raceNumber が重複していれば違反', () => {
  const r = checkRaceDay(mkDay([mkRace(11), mkRace(11)]));
  assert.equal(r.ok, false);
  assert.ok(codesOf(r).includes(RACE_DAY_VIOLATION.RACE_NUMBER_DUPLICATE));
});

test('raceNumber が整数でなければ違反', () => {
  for (const bad of ['11', 11.5, 0, -1, null, undefined, NaN]) {
    const r = checkRaceDay(mkDay([mkRace(bad)]));
    assert.equal(r.ok, false, `raceNumber=${String(bad)} が通ってしまう`);
    assert.ok(codesOf(r).includes(RACE_DAY_VIOLATION.RACE_NUMBER_INVALID));
  }
});

test('会場名の重複を検出する', () => {
  const day = mkDay([mkRace(1)]);
  day.venues.push({ venueName: '川崎', data: { predictions: [mkRace(1)] } });
  const r = checkRaceDay(day);
  assert.ok(codesOf(r).includes(RACE_DAY_VIOLATION.VENUE_NAME_DUPLICATE));
});

test('開催日が不正なら違反', () => {
  for (const bad of [null, '', '2026/08/18', '20260818']) {
    const r = checkRaceDay(mkDay([mkRace(1)], { date: bad }));
    assert.ok(codesOf(r).includes(RACE_DAY_VIOLATION.DATE_INVALID), `date=${String(bad)}`);
  }
});

/* ---------- 3. fail-closed（欠損も違反） ---------- */

test('raceInfo.venue が欠損していても違反にする（推測で通さない）', () => {
  const race = mkRace(11);
  delete race.raceInfo.venue;
  const r = checkRaceDay(mkDay([race]));
  assert.equal(r.ok, false);
  assert.ok(codesOf(r).includes(RACE_DAY_VIOLATION.VENUE_MISMATCH));
});

test('raceInfo.date が欠損していても違反にする', () => {
  const race = mkRace(11);
  delete race.raceInfo.date;
  const r = checkRaceDay(mkDay([race]));
  assert.equal(r.ok, false);
  assert.ok(codesOf(r).includes(RACE_DAY_VIOLATION.DATE_MISMATCH));
});

test('raceInfo ごと欠損していても違反にする', () => {
  const r = checkRaceDay(mkDay([{ horses: [] }]));
  assert.equal(r.ok, false);
  assert.ok(codesOf(r).includes(RACE_DAY_VIOLATION.RACE_INFO_MISSING));
});

test('horses が配列でなければ違反', () => {
  const race = mkRace(11);
  race.horses = null;
  const r = checkRaceDay(mkDay([race]));
  assert.ok(codesOf(r).includes(RACE_DAY_VIOLATION.HORSES_INVALID));
});

test('isRaceVerified: 一致しないレースは通さない', () => {
  const ok = { venueName: '川崎', date: DATE };
  assert.equal(isRaceVerified(mkRace(11), ok), true);
  assert.equal(isRaceVerified(mkRace(11, { venue: '大井' }), ok), false);
  assert.equal(isRaceVerified(mkRace(11, { date: '2026-08-17' }), ok), false);
  assert.equal(isRaceVerified(mkRace(11), { venueName: '大井', date: DATE }), false);
  assert.equal(isRaceVerified(null, ok), false);
});

/* ---------- 4. 検証を通らないレースは描画対象から外す ---------- */

test('verifiedRaceDay: 違反レースを取り除き、正しいレースは残す', () => {
  const day = mkDay([mkRace(1), mkRace(11, { venue: '大井' }), mkRace(12)]);
  const { day: verified, dropped } = verifiedRaceDay(day);
  const kept = racesOf(verified.venues[0]).map((r) => r.raceInfo.raceNumber);
  assert.deepEqual(kept, [1, 12]);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].raceNumber, 11);
});

test('verifiedRaceDay: 元データを書き換えない', () => {
  const day = mkDay([mkRace(1), mkRace(11, { venue: '大井' })]);
  const before = racesOf(day.venues[0]).length;
  verifiedRaceDay(day);
  assert.equal(racesOf(day.venues[0]).length, before, '入力が破壊された');
});

test('verifiedRaceDay: すべて正しいときは会場オブジェクトを作り替えない', () => {
  const day = mkDay([mkRace(1), mkRace(2)]);
  const { day: verified, dropped } = verifiedRaceDay(day);
  assert.equal(dropped.length, 0);
  assert.equal(verified.venues[0], day.venues[0], '不要な作り替えが起きている');
});

/* ---------- 5. 実データ ---------- */

test('取り込み済みの南関データが契約を満たす', () => {
  const day = loadNankanRaceDay(ROOT);
  if (day.error && !day.venues.length) return; // データが無い環境ではスキップ
  const r = checkRaceDay(day);
  assert.deepEqual(r.violations.slice(0, 5), [], `南関データに違反: ${r.violations.length}件`);
});

test('取り込み済みの JRA データが契約を満たす（複数会場でも混ざらない）', () => {
  const day = loadJraRaceDay(ROOT);
  if (day.error && !day.venues.length) return;
  const r = checkRaceDay(day);
  assert.deepEqual(r.violations.slice(0, 5), [], `JRAデータに違反: ${r.violations.length}件`);

  // 会場ごとに raceNumber が 1..N で揃っていること
  for (const venue of day.venues) {
    const nums = racesOf(venue).map((x) => x.raceInfo.raceNumber);
    assert.deepEqual(
      [...nums].sort((a, b) => a - b),
      nums.slice().sort((a, b) => a - b),
      `${venue.venueName}: raceNumber の並びが壊れている`,
    );
    assert.equal(new Set(nums).size, nums.length, `${venue.venueName}: raceNumber が重複`);
  }
});

/* ---------- 6. 表示配線（タブとパネルの取り違え防止） ---------- */

test('RaceDayBoard: タブとパネルを同一の key から作っている', () => {
  const src = read('src/components/newspaper/RaceDayBoard.astro');
  // key は venueIndex と rn からのみ作る
  assert.match(src, /key:\s*`\$\{venueIndex\}-\$\{rn\}`/, 'key の生成が venueIndex/rn 由来でない');
  // タブ・パネルの双方が同じ e.key を使う
  assert.match(src, /data-race-tab=\{e\.key\}/, 'タブが e.key を使っていない');
  assert.match(src, /data-race-panel=\{e\.key\}/, 'パネルが e.key を使っていない');
  assert.match(src, /id=\{`race-\$\{e\.key\}`\}/, 'パネル id が e.key 由来でない');
  assert.match(src, /aria-controls=\{`race-\$\{e\.key\}`\}/, 'aria-controls が e.key 由来でない');
});

test('RaceDayBoard: レース切替がスクロールに依存しない（不具合の再発防止）', () => {
  const src = read('src/components/newspaper/RaceDayBoard.astro');
  assert.ok(!/scrollIntoView\s*\(/.test(src), 'scrollIntoView に依存している');
  assert.ok(!/href=\{`#race-/.test(src), 'アンカージャンプに戻っている');
  // 選択したレースだけを表示する実装であること
  assert.match(src, /data-race-panel/, 'レースパネルの制御が無い');
  assert.match(src, /function selectRace\(/, 'レース選択の実装が無い');
});

test('RaceDayBoard: 描画前に契約検証を通している（fail-closed）', () => {
  const src = read('src/components/newspaper/RaceDayBoard.astro');
  assert.match(src, /verifiedRaceDay\(/, '契約検証を通していない');
  assert.match(src, /const \{ day, dropped \} = verifiedRaceDay\(rawDay\)/, '検証済みデータを描画に使っていない');
});
