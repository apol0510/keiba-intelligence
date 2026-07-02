// KI 馬単 F3 判定 + 回収率（全レース5点固定・DP無し・上限無し・全候補公開）の検証。
// node --test scripts/umatanHit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkUmatanHit } from '../src/utils/umatanHit.js';
import { isMainRace, getMainRaceNumber } from '../src/utils/mainRaceBetting.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, '..', 'src', 'data');
const BET_POINTS_PER_RACE = 5;
const R = (first, second) => ({ results: [{ number: first }, { number: second }] });

// ───────────────── F3 方向ルールのユニットテスト ─────────────────
test('メイン(reverseTopK=0): 軸→相手の一方向のみ、逆方向は不的中', () => {
  const line = '5-9.11.6.8.4'; // 軸5 → 相手[9,11,6,8,4]（評価順）
  assert.equal(checkUmatanHit(line, R(5, 9), 0), true, '軸1着&相手2着=的中');
  assert.equal(checkUmatanHit(line, R(5, 4), 0), true, '軸1着&相手(下位)2着=的中');
  assert.equal(checkUmatanHit(line, R(9, 5), 0), false, '相手1着&軸2着=一方向なので不的中');
  assert.equal(checkUmatanHit(line, R(11, 5), 0), false, '逆方向は全て不的中');
  assert.equal(checkUmatanHit(line, R(5, 7), 0), false, '相手に無い馬=不的中');
});

test('通常(reverseTopK=3): 前進は全頭、逆方向は評価上位1〜3位のみ', () => {
  const line = '3-6.11.7.10.8'; // 軸3 → 相手[6(1位),11(2位),7(3位),10(4位),8(5位)]
  // 前進（軸1着）は全相手2着で的中
  for (const p of [6, 11, 7, 10, 8]) assert.equal(checkUmatanHit(line, R(3, p), 3), true, `前進 3→${p}`);
  // 逆方向（軸2着）は上位3頭のみ的中
  assert.equal(checkUmatanHit(line, R(6, 3), 3), true, '相手1位→軸: 逆方向的中');
  assert.equal(checkUmatanHit(line, R(11, 3), 3), true, '相手2位→軸: 逆方向的中');
  assert.equal(checkUmatanHit(line, R(7, 3), 3), true, '相手3位→軸: 逆方向的中');
  assert.equal(checkUmatanHit(line, R(10, 3), 3), false, '相手4位→軸: 前進のみ=不的中');
  assert.equal(checkUmatanHit(line, R(8, 3), 3), false, '相手5位→軸: 前進のみ=不的中');
});

test('抑えは候補外（F3では生成しないが、混入しても本線のみで判定）', () => {
  const line = '3-6.11.7(抑え5.9)';
  assert.equal(checkUmatanHit(line, R(3, 5), 3), false, '軸→抑え は候補外');
  assert.equal(checkUmatanHit(line, R(5, 3), 3), false, '抑え→軸 は候補外');
  assert.equal(checkUmatanHit(line, R(3, 6), 3), true, '本線相手は的中');
});

// ───────────────── 実archiveでのF3再計算（v7確定値の再現 + 恒等式） ─────────────────
function recomputeDay(entry) {
  const races = entry.races || [];
  const isLeg = !races.some(r => r && (r.bettingLines !== undefined || r.result !== undefined));
  const venueCount = {};
  for (const r of races) { const v = r.venue || entry.venue || '_'; venueCount[v] = (venueCount[v] || 0) + 1; }
  let hits = 0, payout = 0;
  for (const r of races) {
    if (isLeg) { if (r.isHit) { hits++; payout += Number(r.payout ?? r.umatan?.payout) || 0; } continue; }
    const v = r.venue || entry.venue || '_';
    const total = venueCount[v] || races.length;
    const rn = typeof r.raceNumber === 'string' ? parseInt(r.raceNumber) : r.raceNumber;
    const reverseTopK = isMainRace(rn, total) ? 0 : 3;
    const result = R(r.result?.first?.number, r.result?.second?.number);
    const lines = r.bettingLines || [];
    const hit = lines.some(l => checkUmatanHit(l, result, reverseTopK));
    if (hit) { hits++; payout += Number(r.umatan?.payout) || 0; }
  }
  const betAmount = races.length * BET_POINTS_PER_RACE * 100;
  return { races: races.length, hits, payout, betAmount, rate: betAmount ? payout / betAmount * 100 : 0 };
}

function aggregate(file) {
  const arr = JSON.parse(readFileSync(join(DATA, file), 'utf-8'));
  let payout = 0, invest = 0, hits = 0, races = 0;
  for (const e of arr) { const d = recomputeDay(e); payout += d.payout; invest += d.betAmount; hits += d.hits; races += d.races; }
  return { payout, invest, hits, races, overall: invest ? payout / invest * 100 : 0 };
}

test('[archiveResults.json] 5点固定・全候補公開・恒等式・冪等・F3通算(v7一致)', () => {
  const a = aggregate('archiveResults.json');
  const b = aggregate('archiveResults.json'); // 冪等性（同一入力→同一出力）
  assert.deepEqual(a, b, '再計算は決定的・冪等');
  assert.equal(a.invest, a.races * 500, '投資額 = 全レース×5×100');
  // getMainRaceNumber が使えること（12→11）
  assert.equal(getMainRaceNumber(12), 11);
  // F3通算回収率が確定v7値(南関≈217.1%)近傍
  assert.ok(a.overall > 210 && a.overall < 224, `南関F3通算 ${a.overall.toFixed(1)}% が確定値近傍`);
  console.log(`  南関F3: 通算 ${a.overall.toFixed(1)}%  公開的中 ${a.hits}  払戻¥${a.payout.toLocaleString()} / 投資¥${a.invest.toLocaleString()}`);
});

test('[archiveResultsJra.json] 5点固定・全候補公開・恒等式・冪等・F3通算(v7一致)', () => {
  const a = aggregate('archiveResultsJra.json');
  const b = aggregate('archiveResultsJra.json');
  assert.deepEqual(a, b, '再計算は決定的・冪等');
  assert.equal(a.invest, a.races * 500, '投資額 = 全レース×5×100');
  assert.ok(a.overall > 205 && a.overall < 220, `JRA F3通算 ${a.overall.toFixed(1)}% が確定値近傍`);
  console.log(`  JRA F3: 通算 ${a.overall.toFixed(1)}%  公開的中 ${a.hits}  払戻¥${a.payout.toLocaleString()} / 投資¥${a.invest.toLocaleString()}`);
});
