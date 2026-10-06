/**
 * displayedBets.test.mjs — 表示買い目の凍結と、表示買い目基準の成績（内部）の検査
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { displayedRaces, freeze, displayedReturn } from './displayedBets.js';

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
