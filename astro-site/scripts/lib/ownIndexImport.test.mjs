// KI の独自指数 OWN_INDEX_KI_V1 の取込（scripts/lib/ownIndexImport.mjs・src/utils/ownIndexKi.js）。docs/spec.md §4
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  OWN_INDEX_START, ownIndexOn, loadJockeyStats, clearJockeyStatsMemo, applyOwnIndexToVenue, applyOwnIndexToDay, publishedPt, publishedOwnEval, publishedComputerIndex,
} from './ownIndexImport.mjs';
import { ownOrder } from '../../src/utils/ownIndex.js';
import { ownIndexKiRace, displayOwnIndex, KI_WEIGHTS } from '../../src/utils/ownIndexKi.js';
import { form5Of, courseRateOf } from '../../src/utils/ownIndex.js';
import { generateMainRaceUmatanLines } from '../../src/utils/mainRaceBetting.js';

beforeEach(() => clearJockeyStatsMemo());

/** keiba-data-shared の過去走（古い順）: 1 コーナー位置・着順・上がり */
const past = (corner, finish, f3) => [{ passingOrder: `${corner}-${corner}`, finish: String(finish), final3F: String(f3) }];
/** 予想ファイルの 1 レース（12 頭）。1 番は指数 90 で近走不振、2 番は指数 89 で近走好調 */
function rawRace(raceNumber = 1) {
  return {
    raceNumber,
    horses: Array.from({ length: 12 }, (_, i) => ({
      number: i + 1, name: `テスト${i + 1}`, jockey: i === 1 ? '好調騎手' : i === 0 ? '不振騎手' : `騎手${i + 1}`,
      computerIndex: i === 1 ? 89 : 90 - i * 3,
      pastRaces: i === 0 ? past(10, 9, 40.5) : i === 1 ? past(1, 1, 36.0) : past(6, 6, 39.0),
    })),
  };
}
const stats = () => new Map([['好調騎', { rides: 50, wins: 15 }], ['不振騎', { rides: 50, wins: 1 }]]);
/** normalizeAndAdjust の形（コンピ順で役割済み） */
function normalizedRace(raceNumber = 1) {
  const horses = rawRace(raceNumber).horses.map((h) => ({ number: h.number, name: h.name, rawScore: h.computerIndex, displayScore: h.computerIndex + 70, role: '無' }));
  [...horses].sort((a, b) => b.rawScore - a.rawScore).forEach((h, i) => { h.role = i === 0 ? '本命' : i === 1 ? '対抗' : i === 2 ? '単穴' : i === 3 ? '連下最上位' : i < 7 ? '連下' : '補欠'; });
  return { raceNumber, hasHorseData: true, horses };
}

test('開始日: OWN_INDEX_START 以降だけ独自指数', () => {
  assert.equal(ownIndexOn('2026-11-27'), false);
  assert.equal(ownIndexOn(OWN_INDEX_START), true);
});

test('役割を独自指数の順に付け直す（指数の差が小さい ◎○ は独自評価で入れ替わる）・相手の並びは指数のまま', () => {
  const venue = { races: [normalizedRace(11)] };
  const r = applyOwnIndexToVenue(venue, { venueCode: 'URA', races: [rawRace(11)] }, stats());
  assert.deepEqual(r, { races: 1, applied: 1, missing: 0 });
  const horses = venue.races[0].horses;
  const byNo = (n) => horses.find((h) => h.number === n);
  assert.equal(byNo(2).role, '本命');
  assert.equal(byNo(2).mark, '◎');
  assert.notEqual(byNo(1).role, '本命');
  // 順は ownIndex.js の ownOrder と同じ
  const idx = ownIndexKiRace(rawRace(11).horses.map((h) => ({ number: h.number, base: h.computerIndex, jockey: h.jockey, recent: [...h.pastRaces].reverse() })), stats(), { venueCode: 'URA' });
  const order = ownOrder(idx);
  assert.equal(order[0], 2);
  assert.deepEqual(['本命', '対抗', '単穴', '連下最上位'].map((role) => horses.find((h) => h.role === role).number), order.slice(0, 4));
  // displayScore（相手を選ぶときの同じ役割内の順）は指数 + 70 のまま・公開 pt は独自指数 + 70
  assert.equal(byNo(2).displayScore, 89 + 70);
  assert.equal(publishedPt(byNo(2), 0), displayOwnIndex(idx.get(2).ownIndex) + 70);
  assert.notEqual(publishedPt(byNo(2), 0), 89 + 70);
  // 点が 0 の馬も公開値は指数 + 70 にならない
  const zero = horses.find((h) => h.ownPoints === 0);
  if (zero) assert.notEqual(publishedPt(zero, 0), zero.rawScore + 70);
  assert.equal(publishedOwnEval(byNo(2)), 50 + 5 * idx.get(2).points);
  // メインレースの買い目: 本命 → 相手 5 頭（役割の優先 → 指数の高い順）
  const [line] = generateMainRaceUmatanLines(horses);
  assert.match(line, /^2-/);
});

test('独自指数の無いレース（予想ファイルに無い）は従来の役割のまま', () => {
  const venue = { races: [normalizedRace(3)] };
  const before = JSON.stringify(venue);
  const r = applyOwnIndexToVenue(venue, { races: [rawRace(4)] }, stats());
  assert.equal(r.missing, 1);
  assert.equal(JSON.stringify(venue), before);
});

/** keiba-data-shared の API client の代わり（listDirectory / fetchJsonFromEntry） */
function fakeClient(files, { fail = false } = {}) {
  return {
    async listDirectory(path) {
      if (fail) { const e = new Error('rate'); e.code = 'RATE_LIMITED'; throw e; }
      const names = Object.keys(files).filter((p) => p.startsWith(`${path}/`)).map((p) => p.slice(path.length + 1));
      return names.length ? names.map((name) => ({ name, path: `${path}/${name}`, type: 'file' })) : null;
    },
    async fetchJsonFromEntry(entry) { return files[entry.path] ?? null; },
  };
}
const pred = { races: [{ raceNumber: 1, horses: [{ number: 1, jockey: '森 泰斗' }] }] };
const win = { races: [{ raceNumber: 1, results: [{ number: 1, rank: 1 }] }] };

test('騎手成績: 開催日より前の開催だけを数える（当日・後の日の結果は数えない）', async () => {
  const files = {};
  for (const d of ['2026-10-30', '2026-11-27', '2026-11-28', '2026-11-29']) {
    files[`nankan/predictions/computer/${d.slice(0, 4)}/${d.slice(5, 7)}/${d}-OOI.json`] = pred;
    files[`nankan/results/${d.slice(0, 4)}/${d.slice(5, 7)}/${d}-OOI.json`] = win;
  }
  const s = await loadJockeyStats(fakeClient(files), 'nankan', '2026-11-28');
  assert.deepEqual(s.get('森泰斗'), { rides: 2, wins: 2 });
});

test('取込の 1 日分: 開始日より前は何もしない・騎手成績を読めなければ従来の順のまま', async () => {
  const logs = [];
  const log = (m) => logs.push(m);
  const v1 = { races: [normalizedRace(1)] };
  const off = await applyOwnIndexToDay([{ normalized: v1, raw: { races: [rawRace(1)] } }], { date: '2026-11-27', category: 'nankan', client: fakeClient({}), log });
  assert.equal(off.status, 'off');
  assert.equal(v1.races[0].horses.find((h) => h.number === 1).role, '本命');
  const v2 = { races: [normalizedRace(1)] };
  const bad = await applyOwnIndexToDay([{ normalized: v2, raw: { races: [rawRace(1)] } }], { date: OWN_INDEX_START, category: 'nankan', client: fakeClient({}, { fail: true }), log });
  assert.equal(bad.status, 'stats_unavailable');
  assert.equal(v2.races[0].horses.find((h) => h.number === 1).role, '本命');
  assert.ok(logs.some((m) => m.includes('stats_unavailable') && m.includes('RATE_LIMITED')));
  const v3 = { races: [normalizedRace(1)] };
  const ok = await applyOwnIndexToDay([{ normalized: v3, raw: { races: [rawRace(1)] } }], { date: OWN_INDEX_START, category: 'nankan', client: fakeClient({}), log });
  assert.equal(ok.status, 'applied');
  assert.equal(v3.races[0].rankVersion, 'OWN_INDEX_KI_V1');
});

test('KI の重み（近 5 走重視）: 近走 ×2・上がり・コース。近走とコースの値・表示値は単調で同じ値にならない', () => {
  assert.deepEqual({ ...KI_WEIGHTS }, { form5: 2, f3: 1, course: 1 });
  const runs = [{ finish: '1', venue: '浦和 11.6' }, { finish: '9', venue: '大井 10.2' }, { finish: '3', venue: '浦和 9.1' }];
  assert.equal(form5Of([]), 40);
  assert.equal(form5Of(runs), (100 * 1 + 15 * 0.8 + 70 * 0.6) / (1 + 0.8 + 0.6));
  assert.equal(courseRateOf(runs, 'URA'), (2 + 0.5) / (2 + 1.5));
  assert.equal(courseRateOf(runs, 'XXX'), 0.5 / 1.5);
  const shown = Array.from({ length: 60 }, (_, i) => displayOwnIndex(40 + i));
  assert.ok(shown.every((v, i) => i === 0 || v > shown[i - 1]));
  assert.equal(displayOwnIndex(60), 49);
});

test('指数そのもの（computerIndex）: 独自指数の開催は独自指数の無い馬（役割「無」）にも出さない・それより前の開催は従来どおり', () => {
  assert.equal(publishedComputerIndex(OWN_INDEX_START, '44'), null);
  assert.equal(publishedComputerIndex('2026-12-05', '40'), null);
  assert.equal(publishedComputerIndex('2026-11-27', '44'), '44');
  assert.equal(publishedComputerIndex('2026-11-27', null), null);
});
