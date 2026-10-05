/**
 * exacta.test.mjs — AI 動的判定（KAO D-160）の選択・成績・表示切替の検査（合成データのみ）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { raceIdOf, displayMarkets, validateRow, parseSelections, planFromSelection, FORBIDDEN_KEYS } from './selection.js';
import { settle } from './stats.js';
import { loadSelectionsForDate, setReaderForTest } from './source.js';

const row = (o = {}) => ({ schema: 'ki_exacta_selection.v1', race_id: '2026-10-11-05-11', outcome: 'BUY',
  selections: ['07>03', '03>07'], decision_id: 'd1', ...o });

test('race_id は KARL ki_index と同じ規約', () => {
  assert.equal(raceIdOf('jra', '2026-10-11', '東京', 11), '2026-10-11-05-11');
  assert.equal(raceIdOf('nankan', '2026-10-06', '大井', 3), '2026-10-06-OI-3');
  assert.equal(raceIdOf('jra', '2026-10-11', '大井', 3), null);
  assert.equal(raceIdOf('jra', '', '東京', 1), null);
});

test('表示の切替は市場ごと・既定は切替なし', () => {
  assert.deepEqual([...displayMarkets({})], []);
  assert.deepEqual([...displayMarkets({ KI_EXACTA_DISPLAY_MARKETS: 'jra, x ,nankan' })].sort(), ['jra', 'nankan']);
});

test('🔴 確率・オッズ・EV・stake を含む行は捨てる', () => {
  assert.ok(validateRow(row()));
  for (const k of FORBIDDEN_KEYS) assert.equal(validateRow(row({ [k]: 1 })), null, k);
  assert.equal(validateRow(row({ selections: ['7-3'] })), null);
  assert.equal(validateRow(row({ outcome: 'NO_SELECTION' })), null);
  assert.ok(validateRow(row({ outcome: 'NO_SELECTION', selections: [] })));
});

test('JSONL は先勝ち（後から差し替えない）・壊れた行は捨てる', () => {
  const text = [JSON.stringify(row()), '{oops', JSON.stringify(row({ selections: ['01>02'] }))].join('\n');
  const m = parseSelections(text);
  assert.equal(m.size, 1);
  assert.deepEqual(m.get('2026-10-11-05-11').selections, ['07>03', '03>07']);
});

test('plan: 組み合わせだけ・見送り・発走前（点数や金額を持たない）', () => {
  const p = planFromSelection(row(), { isMain: true });
  assert.deepEqual(p.combos, [{ first: 7, second: 3 }, { first: 3, second: 7 }]);
  assert.equal(p.points, undefined);
  assert.equal(p.amountYen, undefined);
  assert.equal(planFromSelection(row({ outcome: 'NO_SELECTION', selections: [] })).skip, true);
  assert.equal(planFromSelection(null).pending, true);
});

test('成績: 採用 1 件 100 円・返還は投資に数えない・未着は数えない・見送りは別勘定', () => {
  const sels = [row(), row({ race_id: 'b', selections: ['01>02', '02>01'] }), row({ race_id: 'c', outcome: 'NO_SELECTION', selections: [] }),
    row({ race_id: 'd' })];
  const results = new Map([
    ['2026-10-11-05-11', { first: '07', second: '03', payoutPer100: 1840 }],
    ['b', { first: '05', second: '01', payoutPer100: 900, voidHorses: ['02'] }],
  ]);
  const { totals } = settle(sels, results);
  assert.equal(totals.invest, 200);          // b は 2 点とも返還 → 投資 0 → 未精算扱い
  assert.equal(totals.payout, 1840);
  assert.equal(totals.returnRate, 920);
  assert.equal(totals.buyRaces, 1);
  assert.equal(totals.hitRaces, 1);
  assert.equal(totals.skipped, 1);
  assert.equal(totals.unsettled, 2);
});

test('読み込みは失敗しても空（例外を投げない）・不正な日付は読まない', async () => {
  setReaderForTest(async () => { throw new Error('blobs down'); });
  assert.equal((await loadSelectionsForDate('2026-10-11')).size, 0);
  let called = false;
  setReaderForTest(async () => { called = true; return ''; });
  assert.equal((await loadSelectionsForDate('../etc')).size, 0);
  assert.equal(called, false);
  setReaderForTest(async () => JSON.stringify(row()));
  assert.equal((await loadSelectionsForDate('2026-10-12')).size, 1);
});

test('🔴 買い目パネルに点数・金額・確率・オッズを出す経路が無い', () => {
  const table = readFileSync(fileURLToPath(new URL('../../components/newspaper/RaceEntryTable.astro', import.meta.url)), 'utf8');
  const markup = table.slice(table.indexOf('{hasPlan && ('), table.indexOf('<table class="ret-table">'));
  for (const w of ['plan.points', 'plan.amountYen', 'p_calibrated', 'odds', '期待値', '確率']) {
    assert.equal(markup.includes(w), false, w);
  }
});
