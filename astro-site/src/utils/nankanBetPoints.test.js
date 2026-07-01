/**
 * nankanBetPoints.test.js (keiba-intelligence)
 *
 * 案1「ユニーク実購入買い目数」算出関数の単体・回帰テスト（Node標準 assert）。
 * 実行: node src/utils/nankanBetPoints.test.js （astro-site 直下から）
 *
 * 馬単の CANONICAL 期待値は AK / KI 両 repo のテストで**同一値**を用いる（parity 保証）。
 * KI は南関=馬単のみ（三連複は AK 専用）。
 */
import assert from 'assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseUmatanLine,
  countUmatanUniquePoints,
  BetPointsParseError,
} from './nankanBetPoints.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log(`  ✅ ${name}`); } catch (e) { fail++; console.error(`  ❌ ${name}\n     ${e && e.message}`); } };

// ── 馬単 CANONICAL（AK/KI 共通の parity 期待値）─────────────────
const UMATAN_CANONICAL = [
  { name: '軸↔相手3頭 → 6組', lines: ['3↔5.7.8'], expected: 6 },
  { name: 'ダッシュ区切りも同結果（separator不変/parity）', lines: ['3-5.7.8'], expected: 6 },
  { name: '抑えを相手に含める', lines: ['3↔5.7(抑え9)'], expected: 6 },
  { name: '本命↔対抗の重複を軸間dedup', lines: ['3↔5.7', '5↔3.7'], expected: 6 },
  { name: '同一行の重複をdedup', lines: ['3↔5.7', '3↔5.7'], expected: 4 },
  { name: '空配列は0点', lines: [], expected: 0 },
];

t('馬単 CANONICAL 期待値一致（parity 基準）', () => {
  for (const c of UMATAN_CANONICAL) {
    assert.strictEqual(countUmatanUniquePoints(c.lines), c.expected, `${c.name}: ${JSON.stringify(c.lines)}`);
  }
});

t('parseUmatanLine: 軸除外・本線+抑え結合・dedup', () => {
  const { axis, partners } = parseUmatanLine('3↔5.7.3(抑え9.5)'); // 3=軸(除外), 5重複, 9抑え
  assert.strictEqual(axis, 3);
  assert.deepStrictEqual([...partners].sort((a, b) => a - b), [5, 7, 9]);
});

t('抑え・補欠が組数に反映される（含める前後で差）', () => {
  const withOsae = countUmatanUniquePoints(['3↔5.7(抑え9.11)']);
  const without = countUmatanUniquePoints(['3↔5.7']);
  assert.strictEqual(without, 4);
  assert.strictEqual(withOsae, 8); // 相手 5,7,9,11 × 双方向
});

t('払戻額を入力に取らない（関数arityは1・払戻非依存）', () => {
  assert.strictEqual(countUmatanUniquePoints.length, 1);
  const lines = ['3↔5.7.8(抑え9)'];
  const a = countUmatanUniquePoints(lines);
  const b = countUmatanUniquePoints(lines);
  assert.strictEqual(a, b);
  assert.strictEqual(a, 8);
});

t('malformed 馬単行は BetPointsParseError を throw（黙って推測しない）', () => {
  assert.throws(() => countUmatanUniquePoints(['abc']), BetPointsParseError);
  assert.throws(() => countUmatanUniquePoints(['3']), BetPointsParseError);       // 区切りなし
  assert.throws(() => countUmatanUniquePoints(['3↔5.x']), BetPointsParseError);   // 相手が数値でない
  assert.throws(() => countUmatanUniquePoints('3↔5'), BetPointsParseError);       // 配列でない
});

// ── 実データ fixture 回帰（tracked prediction を使用）──────────
const readPred = (slug) => JSON.parse(readFileSync(join(process.cwd(), 'src/data/predictions', `${slug}.json`), 'utf-8'));
const umatanDayTotal = (j) => (j.predictions || j.races).reduce((s, r) => s + countUmatanUniquePoints(r.bettingLines?.umatan || []), 0);

t('fixture 2026-06-30 OOI: 馬単日計ユニーク=316 / R1=30', () => {
  const j = readPred('2026-06-30-ooi');
  assert.strictEqual(umatanDayTotal(j), 316);
  assert.strictEqual(countUmatanUniquePoints((j.predictions || j.races)[0].bettingLines.umatan), 30);
});

t('fixture 2026-06-26 URA: 馬単日計ユニーク=312 / R1=30', () => {
  const j = readPred('2026-06-26-urawa');
  assert.strictEqual(umatanDayTotal(j), 312);
  assert.strictEqual(countUmatanUniquePoints((j.predictions || j.races)[0].bettingLines.umatan), 30);
});

console.log(`\nnankanBetPoints.test.js: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
