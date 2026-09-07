/**
 * attentionMarkPolicy.test.mjs — 無料会員に **実際に描画する印**を固定する
 *
 * 実行: node --test src/utils/attentionMarkPolicy.test.mjs （astro-site 直下から）
 *
 * 正本: docs/RENEWAL_2026_08.md §2 R-3（2026-09-07 改訂）
 *
 * 🔴 生成側と表示側でテストを分ける:
 *   - `attentionMarks.test.mjs` … 生成仕様（△≧4 の広さ・空欄・軸の本数・◎の重み）。
 *     生成側は少頭数で「△ 集合 ＝ 買い目 1 行の相手集合」を避けられないので、そこは検証しない。
 *   - 本ファイル               … 表示側。ポリシー適用後に **完全一致が残らない**ことを実データで検証する。
 *
 * 🔴 比較単位は **買い目 1 行**。union へ戻さない（union は実際より広い集合になり判定が甘くなる）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  partnerSetsOf, downSetOf, markPolicyFor, applyMarkPolicy,
  MARK_POLICY_FULL, MARK_POLICY_NO_DOWN,
} from './attentionMarkPolicy.js';
import { assignFreeMarks } from './attentionMarks.js';
import { normalizePastRaces } from './raceNarrative.js';
import { loadNankanRaceDay, loadJraRaceDay, racesOf, racesResolverFor } from '../lib/prediction/loadRaceDay.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf-8');

/** 9/8 川崎の回帰ケース（本番経路で解決した過去走ごと固定してある）。 */
const FIXTURE = JSON.parse(readFileSync(join(HERE, 'attentionMarkPolicy.fixture.json'), 'utf-8'));
const fixtureRace = (rn) => FIXTURE.races.find((r) => r.raceInfo.raceNumber === rn);
const fixtureMarks = (race) =>
  assignFreeMarks(race.horses, { pastRacesOf: (h) => h.pastRaces, raceInfo: race.raceInfo });

/** `RaceDayBoard.astro` の `bettingLinesOf` と同じ形（配列 / { umatan } の両方を受ける）。 */
function bettingLinesOf(race) {
  const b = race?.bettingLines;
  if (Array.isArray(b)) return b.filter((x) => typeof x === 'string');
  if (b && Array.isArray(b.umatan)) return b.umatan.filter((x) => typeof x === 'string');
  return [];
}

const setOf = (...ns) => new Set(ns);
const same = (a, b) => a.size === b.size && [...b].every((x) => a.has(x));

/* ---------- 1. 買い目の読み取り ---------- */

test('partnerSetsOf: 買い目 1 行ごとに相手集合を作る（抑えは含めない）', () => {
  const sets = partnerSetsOf(['13-12.10.5.8.14.4(抑え3.1.7.6)', '12-13.10.5.8.14.4(抑え3.1.7.6)']);
  assert.equal(sets.length, 2);
  assert.ok(same(sets[0], setOf(12, 10, 5, 8, 14, 4)), '1 行目の相手が違う');
  assert.ok(same(sets[1], setOf(13, 10, 5, 8, 14, 4)), '2 行目の相手が違う');
});

test('partnerSetsOf: 相手が無い行・文字列でない行は落とす', () => {
  assert.deepEqual(partnerSetsOf(['5', '', null, undefined, 7, '3-']), []);
  assert.deepEqual(partnerSetsOf(null), []);
});

/* ---------- 2. △ の集合 ---------- */

test('downSetOf: △ を含む馬番だけを集める', () => {
  const marks = new Map([[1, '◎◎○'], [2, '○▲△'], [3, '△△△'], [4, ''], [5, '▲']]);
  assert.ok(same(downSetOf(marks), setOf(2, 3)));
  assert.equal(downSetOf(null).size, 0);
});

/* ---------- 3. ポリシー判定 ---------- */

test('markPolicyFor: △ が買い目 1 行の相手と完全一致したら noDown', () => {
  const marks = new Map([[1, '◎'], [2, '△'], [3, '△'], [4, '△'], [5, '']]);
  assert.equal(markPolicyFor(marks, ['1-2.3.4']), MARK_POLICY_NO_DOWN);
});

test('markPolicyFor: △ が相手より広ければ full（一致しない）', () => {
  const marks = new Map([[1, '◎'], [2, '△'], [3, '△'], [4, '△'], [5, '△']]);
  assert.equal(markPolicyFor(marks, ['1-2.3.4']), MARK_POLICY_FULL);
});

test('🔴 markPolicyFor: 比較は 1 行ごと。union が一致しても行が一致しなければ full', () => {
  // union = {2,3,4,5} は △ と一致するが、どの 1 行とも一致しない。
  const marks = new Map([[2, '△'], [3, '△'], [4, '△'], [5, '△']]);
  assert.equal(markPolicyFor(marks, ['1-2.3.4', '1-3.4.5']), MARK_POLICY_FULL);
});

test('🔴 markPolicyFor: union へ戻すと見逃す形（1 行一致 ＋ 別の広い行）でも noDown', () => {
  const marks = new Map([[2, '△'], [3, '△'], [4, '△']]);
  assert.equal(markPolicyFor(marks, ['1-2.3.4', '1-2.3.4.5.6']), MARK_POLICY_NO_DOWN);
});

test('markPolicyFor: △ が 1 頭も居なければ full（空集合は相手と一致しない）', () => {
  assert.equal(markPolicyFor(new Map([[1, '◎○']]), ['1-2.3']), MARK_POLICY_FULL);
  assert.equal(markPolicyFor(new Map(), ['1-2.3']), MARK_POLICY_FULL);
});

test('markPolicyFor: 買い目が無ければ full', () => {
  assert.equal(markPolicyFor(new Map([[1, '△']]), []), MARK_POLICY_FULL);
});

/* ---------- 4. ポリシーの適用 ---------- */

test('applyMarkPolicy: noDown は △ だけ落とす（◎○▲ は残す）', () => {
  assert.equal(applyMarkPolicy('◎○▲△△', MARK_POLICY_NO_DOWN), '◎○▲');
  assert.equal(applyMarkPolicy('△△△△△', MARK_POLICY_NO_DOWN), '');
  assert.equal(applyMarkPolicy('◎◎◎○○', MARK_POLICY_NO_DOWN), '◎◎◎○○');
});

test('applyMarkPolicy: full は素通し', () => {
  assert.equal(applyMarkPolicy('◎○▲△△', MARK_POLICY_FULL), '◎○▲△△');
  assert.equal(applyMarkPolicy('', MARK_POLICY_FULL), '');
});

/* ---------- 5. 回帰ケース（2026-09-08 川崎） ---------- */

test('回帰 2026-09-08 川崎 1R: △ が買い目 1 行の相手と完全一致 → noDown', () => {
  const race = fixtureRace(1);
  const marks = fixtureMarks(race);
  // 前提（この一致こそが修正の対象）
  assert.ok(same(downSetOf(marks), setOf(1, 3, 4, 5, 6, 8)), '△ 集合が想定と違う');
  assert.ok(
    partnerSetsOf(race.bettingLines).some((p) => same(downSetOf(marks), p)),
    '買い目 1 行との完全一致が再現しない',
  );
  assert.equal(markPolicyFor(marks, race.bettingLines), MARK_POLICY_NO_DOWN);

  // 適用後: △ は消え、◎○▲ は残る
  const shown = [...marks.entries()].map(([, s]) => applyMarkPolicy(s, MARK_POLICY_NO_DOWN));
  assert.ok(!shown.some((s) => s.includes('△')), '△ が残っている');
  assert.ok(shown.some((s) => s.includes('◎')), '◎ まで消えている');
  assert.ok(shown.some((s) => s.includes('○')), '○ まで消えている');
  assert.ok(shown.some((s) => s.includes('▲')), '▲ まで消えている');
});

test('回帰 2026-09-08 川崎 8R: △ が相手より広い（一致しない） → full', () => {
  const race = fixtureRace(8);
  const marks = fixtureMarks(race);
  assert.ok(same(downSetOf(marks), setOf(1, 2, 4, 5, 6, 7, 8)), '△ 集合が想定と違う');
  assert.equal(markPolicyFor(marks, race.bettingLines), MARK_POLICY_FULL);
});

test('回帰 2026-09-08 川崎 12R: 一致しない → full（印はそのまま出す）', () => {
  const race = fixtureRace(12);
  const marks = fixtureMarks(race);
  assert.ok(same(downSetOf(marks), setOf(3, 4, 5, 8, 10, 13, 14)), '△ 集合が想定と違う');
  assert.equal(markPolicyFor(marks, race.bettingLines), MARK_POLICY_FULL);
});

/* ---------- 6. 実データ（表示側の漏洩検証） ---------- */

test('🔴 実データ: ポリシー適用後、△ が買い目 1 行の相手と完全一致するレースが無い', () => {
  let checked = 0;
  let suppressed = 0;
  const leaks = [];
  for (const [cat, load] of [['nankan', loadNankanRaceDay], ['jra', loadJraRaceDay]]) {
    const day = load(ROOT);
    if (day.error && !day.venues.length) continue;
    const resolve = racesResolverFor(cat);
    const past = (h) => normalizePastRaces(resolve(h));
    for (const venue of day.venues) {
      for (const race of racesOf(venue)) {
        const horses = race?.horses || [];
        if (horses.length < 8) continue;
        const lines = bettingLinesOf(race);
        if (!partnerSetsOf(lines).length) continue;
        checked += 1;

        const raceInfo = race.raceInfo || {};
        const marks = assignFreeMarks(horses, { pastRacesOf: past, raceInfo });
        const policy = markPolicyFor(marks, lines);
        if (policy === MARK_POLICY_NO_DOWN) suppressed += 1;

        // 実際に描画される印だけで判定する
        const shown = new Map(
          [...marks.entries()].map(([no, s]) => [no, applyMarkPolicy(s, policy)]),
        );
        const down = downSetOf(shown);
        if (!down.size) continue;
        for (const partners of partnerSetsOf(lines)) {
          if (same(down, partners)) {
            leaks.push(`${venue.venueName}${raceInfo.raceNumber}R: △ が買い目の相手と完全一致`);
            break;
          }
        }
      }
    }
  }
  assert.ok(checked > 0, '買い目を持つレースが 0');
  assert.deepEqual(leaks, [], `${leaks.length} 件の漏洩 / 抑止 ${suppressed} レース`);
});

/* ---------- 7. 配線 ---------- */

test('RaceNewspaper がポリシーを判定して RaceEntryTable へ渡している', () => {
  const src = read('src/components/newspaper/RaceNewspaper.astro');
  assert.match(src, /markPolicyFor\(/, 'ポリシーを判定していない');
  assert.match(src, /markPolicy=\{markPolicy\}/, 'RaceEntryTable へ渡していない');
  assert.match(src, /showMarks && !showBetting/, '無料会員のときだけ判定していない');
});

test('RaceEntryTable がポリシーを適用して印を描画している', () => {
  const src = read('src/components/newspaper/RaceEntryTable.astro');
  assert.match(src, /applyMarkPolicy\(/, 'ポリシーを適用していない');
  assert.match(src, /markPolicy/, 'ポリシーを受け取っていない');
});

test('🔴 RaceEntryTable に買い目そのものを渡していない', () => {
  const src = read('src/components/newspaper/RaceEntryTable.astro');
  assert.ok(!/bettingLines/.test(src), 'buy line の生データが出馬表コンポーネントへ入っている');
});
