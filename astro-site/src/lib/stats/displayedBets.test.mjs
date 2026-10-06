/**
 * displayedBets.test.mjs — 表示買い目の凍結と、表示買い目基準の成績（内部）の検査
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { displayedRaces, freeze, displayedReturn, resultsFromArchive, PUBLIC_FROM } from './displayedBets.js';
import { tiersForVenue } from '../../utils/displayedSelection.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const race = (rn, lines) => ({ raceInfo: { raceNumber: rn }, horses: [], bettingLines: lines });

test('表示と同じ規則: 抑えは組み合わせに入れない・メインレースは逆方向なし', () => {
  const preds = Array.from({ length: 12 }, (_, i) => race(i + 1, ['3-5.7.8(抑え9.10)']));
  const races = displayedRaces(preds);
  const r1 = races.find((r) => r.raceNumber === 1);
  const r11 = races.find((r) => r.raceNumber === 11);
  assert.equal(r11.isMain, true);
  assert.deepEqual(r11.combos, ['03>05', '03>07', '03>08']);           // メインは前進のみ
  assert.deepEqual(r1.combos, ['03>05', '03>07', '03>08', '05>03', '07>03', '08>03']);
  assert.equal(r1.combos.some((c) => c.includes('09') || c.includes('10')), false);
});

test('🔴 凍結は最初の版が勝つ・後の変更は drift として記録だけ', () => {
  const first = freeze({ market: 'nankan', date: '2026-10-06', venue: '大井', predictions: [race(1, ['3-5.7'])], nowIso: 't0' });
  assert.equal(first.changed, true);
  const later = freeze({ market: 'nankan', date: '2026-10-06', venue: '大井', predictions: [race(1, ['4-5.7'])], nowIso: 't1', existing: first.record });
  assert.equal(later.changed, false);
  assert.deepEqual(later.drift, [1]);
  assert.equal(later.record.frozenAt, 't0');
  assert.deepEqual(later.record.races[0].combos, first.record.races[0].combos);
});

test('成績: 表示した組み合わせを各 100 円・未着は数えない', () => {
  const f = freeze({ market: 'jra', date: '2026-10-05', venue: '東京', predictions: [race(1, ['3-5.7']), race(2, ['1-2'])], nowIso: 't' }).record;
  const results = new Map([['jra|2026-10-05|東京|1', { first: '05', second: '03', payoutPer100: 1500 }]]);
  const { totals, days } = displayedReturn([f], results);
  assert.equal(days[0].stake, 400);          // 1R: 3>5,3>7,5>3,7>3 の 4 点（2R は結果未着）
  assert.equal(days[0].payout, 1500);
  assert.equal(days[0].unsettled, 1);
  assert.equal(totals.jra.returnRate, 375);
  assert.equal(totals.jra.hitRate, 100);
});

test('🔴 凍結済みデータの的中が archive の isHit と一致する（着順と払戻の組が食い違うレースを除く）', () => {
  for (const [market, file] of [['nankan', 'archiveResults.json'], ['jra', 'archiveResultsJra.json']]) {
    const dir = join(ROOT, 'src/data/displayedBets', market);
    if (!existsSync(dir)) continue;
    const fm = new Map();
    for (const n of readdirSync(dir)) for (const f of JSON.parse(readFileSync(join(dir, n), 'utf8'))) for (const r of f.races) fm.set(`${f.date}|${f.venue}|${r.raceNumber}`, r);
    let checked = 0;
    for (const d of JSON.parse(readFileSync(join(ROOT, 'src/data', file), 'utf8'))) {
      for (const r of d.races) {
        const fr = fm.get(`${d.date}|${r.venue || d.venue}|${r.raceNumber}`);
        if (!fr) continue;
        const a = Number(r.result?.first?.number); const b = Number(r.result?.second?.number);
        const [ca, cb] = String(r.umatan?.combination || '').split('-').map(Number);
        if (a !== ca || b !== cb) continue;     // データの食い違い（推測しない）
        const hit = fr.combos.includes(`${String(a).padStart(2, '0')}>${String(b).padStart(2, '0')}`);
        assert.equal(hit, !!r.isHit, `${market} ${d.date} ${r.venue || d.venue} ${r.raceNumber}R`);
        checked += 1;
      }
    }
    assert.ok(checked > 1000, `${market}: 照合件数 ${checked}`);
  }
});

test('🔴 凍結の AI全選定 / AI上位表示は表示と同じ定義（displayedSelection）・上位は全選定の先頭', () => {
  const horses = (n) => Array.from({ length: n }, (_, i) => ({ horseNumber: i + 1 }));
  const preds = Array.from({ length: 12 }, (_, i) => ({ raceInfo: { raceNumber: i + 1 }, horses: horses(i < 6 ? 8 : 14),
    bettingLines: ['3-5.7.8.1.2(抑え9)', '5-3.7.8.1.2'] }));
  const tiers = tiersForVenue(preds);
  for (const r of displayedRaces(preds)) {
    const t = tiers.get(r.raceNumber);
    assert.deepEqual(r.combos, t.all);
    assert.deepEqual(r.top, t.top);
    assert.deepEqual(r.top, r.combos.slice(0, r.top.length));
    assert.equal(r.topRule, 'ki-top-v1');
  }
});

test('top の無い旧レコードは組み合わせが一致するレースだけ top を補う（combos は変えない）', () => {
  const preds = [race(1, ['3-5.7.8.1.2.4.6.9'])];
  const old = freeze({ market: 'nankan', date: '2026-10-06', venue: '大井', predictions: preds, nowIso: 't0' }).record;
  const legacy = { ...old, races: old.races.map(({ top, topRule, fieldSize, ...r }) => r) };
  const res = freeze({ market: 'nankan', date: '2026-10-06', venue: '大井', predictions: preds, nowIso: 't1', existing: legacy });
  assert.equal(res.changed, true);
  assert.deepEqual(res.record.races[0].combos, legacy.races[0].combos);
  assert.deepEqual(res.record.races[0].top, old.races[0].top);
  assert.equal(res.record.frozenAt, 't0');
  const drifted = freeze({ market: 'nankan', date: '2026-10-06', venue: '大井', predictions: [race(1, ['4-5'])], nowIso: 't1', existing: legacy });
  assert.equal(drifted.changed, false);
});

test('成績は AI全選定と AI上位表示を別々に数える', () => {
  const f = freeze({ market: 'jra', date: '2026-10-05', venue: '東京', predictions: [race(1, ['3-5.7.8.1.2.4.6.9', '5-3.7.8.1.2.4.6.9'])], nowIso: 't' }).record;
  assert.ok(f.races[0].combos.length > f.races[0].top.length);
  const last = f.races[0].combos.at(-1).split('>');
  const results = new Map([['jra|2026-10-05|東京|1', { first: last[0], second: last[1], payoutPer100: 5000 }]]);
  const { days } = displayedReturn([f], results);
  assert.equal(days[0].hits, 1);
  assert.equal(days[0].top.hits, 0);                 // 上位表示の外で決着
  assert.equal(days[0].stake, f.races[0].combos.length * 100);
  assert.equal(days[0].top.stake, f.races[0].top.length * 100);
});

test('🔴 顧客向けの集計（displayedSummary.json）が凍結データ × archive の再計算と一致する（古いまま出さない）', () => {
  const walkJson = (d) => (existsSync(d) ? readdirSync(d).flatMap((n) => (n.endsWith('.json') ? JSON.parse(readFileSync(join(d, n), 'utf8')) : [])) : []);
  const frozen = ['nankan', 'jra'].flatMap((m) => walkJson(join(ROOT, 'src/data/displayedBets', m)));
  const read = (f) => JSON.parse(readFileSync(join(ROOT, 'src/data', f), 'utf8'));
  const { results } = resultsFromArchive([['nankan', read('archiveResults.json')], ['jra', read('archiveResultsJra.json')]]);
  const { totals } = displayedReturn(frozen, results, { from: PUBLIC_FROM });
  const summary = read('stats/displayedSummary.json');
  for (const m of ['nankan', 'jra']) {
    for (const k of ['races', 'hits', 'stake', 'payout', 'returnRate', 'hitRate', 'avgCombos', 'from', 'to']) {
      assert.equal(summary[m][k], totals[m][k], `${m}.${k}（npm run recompute:displayed-return で再生成）`);
    }
    assert.ok(summary[m].from >= PUBLIC_FROM);
  }
});
