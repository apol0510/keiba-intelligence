/**
 * getDisplayRecentRacesForNankan.test.js
 *
 * 南関 過去走 表示用配列の解決 helper のテスト（Node標準 assert）。
 * 優先順位: recentRacesFromEntriesNankan → recentRacesFromHistoriesNankan → recentRaces(legacy)。
 * legacy が空でも entries / histories に実データがあれば描画対象になることを保証する
 * （2026-06-22 URA の若駒12頭 = legacy0・entries1〜2 の回帰防止）。
 *
 * 実行: node src/utils/getDisplayRecentRacesForNankan.test.js （astro-site 直下から）
 */
import assert from 'assert';
import { getDisplayRecentRacesForNankan } from './getDisplayRecentRacesForNankan.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log(`  ✅ ${name}`); } catch (e) { fail++; console.error(`  ❌ ${name}\n     ${e.message}`); } };

const mkRace = (n) => ({ date: `2026-06-${String(n).padStart(2, '0')}`, venue: '浦和', rank: n, distance: 1600 });

// 1. entries のみ存在・legacy 空 → entries を返す（若駒12頭ケース）
t('entriesのみ存在・legacy空 → entriesを返す', () => {
  const ent = [mkRace(1)];
  const out = getDisplayRecentRacesForNankan({ recentRacesFromEntriesNankan: ent, recentRaces: [] });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].date, '2026-06-01');
});

// 2. histories のみ存在 → histories を返す
t('historiesのみ存在 → historiesを返す', () => {
  const inj = [{ date: '2026-05-10', venue: '大井', finish: 2, distance: 1400 }];
  const out = getDisplayRecentRacesForNankan({ recentRacesFromHistoriesNankan: inj, recentRaces: [] });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].rank, 2); // finish→rank 補完
});

// 3. legacy のみ存在 → legacy を返す（回帰ガード）
t('legacyのみ存在 → legacyを返す', () => {
  const legacy = [mkRace(3), mkRace(4)];
  const out = getDisplayRecentRacesForNankan({ recentRaces: legacy });
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out, legacy); // 素通し（同一参照）
});

// 4. 全系統存在 → entries 優先
t('entries/histories/legacy 全存在 → entries優先', () => {
  const ent = [mkRace(1)];
  const out = getDisplayRecentRacesForNankan({
    recentRacesFromEntriesNankan: ent,
    recentRacesFromHistoriesNankan: [{ date: 'x', finish: 9 }],
    recentRaces: [mkRace(8)],
  });
  assert.strictEqual(out, ent);
});

// 5. entries 空配列・histories あり → histories へ fallback
t('entries空配列・historiesあり → historiesへfallback', () => {
  const inj = [{ date: '2026-05-10', venue: '川崎', finish: 1 }];
  const out = getDisplayRecentRacesForNankan({ recentRacesFromEntriesNankan: [], recentRacesFromHistoriesNankan: inj });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].rank, 1);
});

// 6. 全系統なし → 空配列
t('全系統なし → 空配列', () => {
  assert.deepStrictEqual(getDisplayRecentRacesForNankan({}), []);
});

// 7. 6走以上入力 → 表示(slice0,5)で最大5走・0埋めなし
t('6走入力 → slice(0,5)で5走・0埋めなし', () => {
  const ent = [1, 2, 3, 4, 5, 6].map(mkRace);
  const disp = getDisplayRecentRacesForNankan({ recentRacesFromEntriesNankan: ent }).slice(0, 5);
  assert.strictEqual(disp.length, 5);
  assert.ok(disp.every((r) => r && r.date)); // 空行(0埋め)が無い
});

// 8. 1〜4走 → 実数のまま・0埋めしない
t('2走入力 → slice(0,5)で2走のまま・0埋めなし', () => {
  const ent = [1, 2].map(mkRace);
  const disp = getDisplayRecentRacesForNankan({ recentRacesFromEntriesNankan: ent }).slice(0, 5);
  assert.strictEqual(disp.length, 2);
  assert.ok(disp.every((r) => r && r.date));
});

// 9. null / undefined / 非配列 → 例外なし・空配列
t('null/undefined/非配列 → 例外なし・空配列', () => {
  assert.deepStrictEqual(getDisplayRecentRacesForNankan(null), []);
  assert.deepStrictEqual(getDisplayRecentRacesForNankan(undefined), []);
  assert.deepStrictEqual(getDisplayRecentRacesForNankan({ recentRaces: 'x' }), []);
  assert.deepStrictEqual(getDisplayRecentRacesForNankan({ recentRacesFromEntriesNankan: 123 }), []);
});

// 10. 入力を破壊しない（entries/histories/legacy とも元配列不変）
t('入力配列を破壊しない', () => {
  const ent = [mkRace(1), mkRace(2)];
  const entCopy = JSON.parse(JSON.stringify(ent));
  getDisplayRecentRacesForNankan({ recentRacesFromEntriesNankan: ent });
  assert.deepStrictEqual(ent, entCopy);
  const inj = [{ date: 'a', finish: 1 }, { date: 'b', finish: 2 }];
  const injCopy = JSON.parse(JSON.stringify(inj));
  getDisplayRecentRacesForNankan({ recentRacesFromHistoriesNankan: inj });
  assert.deepStrictEqual(inj, injCopy); // map/reverse は新配列・元は不変
});

// 11. 2026-06-22 URA 若駒12頭 相当: legacy=0・entries=1〜2 → 描画対象(length>0)
t('若駒12頭相当 legacy0/entries1-2 → 描画対象(length>0)', () => {
  for (const n of [1, 2]) {
    const ent = Array.from({ length: n }, (_, i) => mkRace(i + 1));
    const out = getDisplayRecentRacesForNankan({ recentRaces: [], recentRacesFromEntriesNankan: ent });
    assert.ok(out.length > 0, `entries${n}走で描画されない`);
    assert.strictEqual(out.length, n);
  }
});

// ───────── horseStats fallback（uma_info 正本・優先順位 ③）─────────
// ダイメイバタフライ相当の horseStatsNankan.recentRacesDetailed（新→古・order 1=前走）
const DAIMEI_DETAILED = [
  { order: 1, finish: 5, venue: '浦和', date: '2026-05-28', distance: 1400, raceName: '３歳(六)', headCount: 9, horseNumberInRace: 3, passingOrder: '4-3-4-5', last3f: '39.6', carriedWeight: '54.0' },
  { order: 2, finish: 3, venue: '浦和', date: '2026-04-22', distance: 1400, raceName: '３歳(五)', headCount: 11, horseNumberInRace: 9, passingOrder: '9-9-6-5', last3f: '39.5', carriedWeight: '54.0' },
  { order: 3, finish: 3, venue: '浦和', date: '2026-03-20', distance: 1400, raceName: '３歳(八)', headCount: 11, horseNumberInRace: 9, passingOrder: '11-10-4-3', last3f: '38.9' },
  { order: 4, finish: 3, venue: '浦和', date: '2026-02-28', distance: 1400, raceName: '３歳(七)', headCount: 9, horseNumberInRace: 9, passingOrder: '5-6-6-4', last3f: '40.4' },
  { order: 5, finish: 6, venue: '浦和', date: '2026-01-09', distance: 1300, raceName: '３歳(六)', headCount: 10, horseNumberInRace: 7, passingOrder: '8-10-7-7', last3f: '39.2', carriedWeight: '54.0' },
];
const mkRacebook = (n) => ({ date: `2026-0${n}-01`, venue: '浦和', rank: n, raceName: `${n}組`, passingOrder: '3-4-5' });

// 12. ケース1: entries あり（horseStats/racebook もあり）→ entries 採用
t('horseStats: entries優先（horseStats/racebookより前）', () => {
  const ent = [mkRace(1)];
  const out = getDisplayRecentRacesForNankan({
    recentRacesFromEntriesNankan: ent,
    horseStatsNankan: { recentRacesDetailed: DAIMEI_DETAILED },
    recentRaces: [mkRacebook(2)],
  });
  assert.strictEqual(out, ent);
});

// 13. ケース2: entries なし・histories あり（horseStats/racebookもあり）→ histories 採用
t('horseStats: histories優先（horseStatsより前）', () => {
  const inj = [{ date: '2026-05-10', venue: '大井', finish: 2 }];
  const out = getDisplayRecentRacesForNankan({
    recentRacesFromHistoriesNankan: inj,
    horseStatsNankan: { recentRacesDetailed: DAIMEI_DETAILED },
    recentRaces: [mkRacebook(2)],
  });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].rank, 2);
});

// 14. ケース3: entries/histories なし・horseStats 5走・racebook 4走 → horseStats 採用（5走・値正）
t('horseStats fallback（5走・1/9・raceName/passingOrder 正）', () => {
  const out = getDisplayRecentRacesForNankan({
    horseStatsNankan: { recentRacesDetailed: DAIMEI_DETAILED },
    recentRaces: [mkRacebook(2), mkRacebook(3), mkRacebook(4), mkRacebook(5)], // racebook 4走
  });
  assert.strictEqual(out.length, 5, '5走になっていない');
  // KI 契約は 新→古。前走=先頭、5走目(最古)=末尾。
  assert.strictEqual(out[0].date, '2026-05-28');
  assert.strictEqual(out[0].raceName, '３歳(六)');
  assert.strictEqual(out[0].passingOrder, '4-3-4-5');
  assert.strictEqual(out[0].rank, 5);            // finish→rank
  assert.strictEqual(out[0].horseNumber, 3);     // horseNumberInRace→horseNumber
  // 5走目（2026-01-09）が末尾に存在
  assert.strictEqual(out[4].date, '2026-01-09');
  assert.strictEqual(out[4].raceName, '３歳(六)');
  assert.strictEqual(out[4].passingOrder, '8-10-7-7');
  // racebook の不完全値（六組/3-4-5）に汚染されていない
  assert.ok(!out.some((r) => r.passingOrder === '3-4-5'), 'racebook の passingOrder が混入');
});

// 15. ケース4: 全系統なし（horseStats なし）・racebook あり → racebook 素通し
t('horseStats なし → legacy(racebook) 素通し', () => {
  const legacy = [mkRacebook(2), mkRacebook(3)];
  assert.strictEqual(getDisplayRecentRacesForNankan({ recentRaces: legacy }), legacy);
});

// 16. ケース5: horseStats 不完全（空/不正）→ 例外にせず racebook へ fallback
t('horseStats 不完全 → racebook へ fallback', () => {
  const legacy = [mkRacebook(2)];
  assert.strictEqual(getDisplayRecentRacesForNankan({ horseStatsNankan: { recentRacesDetailed: [] }, recentRaces: legacy }), legacy);
  assert.strictEqual(getDisplayRecentRacesForNankan({ horseStatsNankan: { recentRacesDetailed: null }, recentRaces: legacy }), legacy);
  assert.strictEqual(getDisplayRecentRacesForNankan({ horseStatsNankan: {}, recentRaces: legacy }), legacy);
  assert.strictEqual(getDisplayRecentRacesForNankan({ horseStatsNankan: null, recentRaces: legacy }), legacy);
  assert.strictEqual(getDisplayRecentRacesForNankan({ horseStatsNankan: { recentRacesDetailed: [null, 1, 'x'] }, recentRaces: legacy }), legacy);
});

// 17. recentRacesDetailed を破壊しない & passingOrder 配列を安全化
t('horseStats: 入力不変 & passingOrder 配列を文字列化', () => {
  const detailed = JSON.parse(JSON.stringify(DAIMEI_DETAILED));
  const copy = JSON.parse(JSON.stringify(DAIMEI_DETAILED));
  getDisplayRecentRacesForNankan({ horseStatsNankan: { recentRacesDetailed: detailed } });
  assert.deepStrictEqual(detailed, copy);
  const out = getDisplayRecentRacesForNankan({
    horseStatsNankan: { recentRacesDetailed: [{ order: 1, finish: 5, date: '2026-05-28', passingOrder: [4, 3, 4, 5], raceName: '３歳(六)' }] },
  });
  assert.strictEqual(out[0].passingOrder, '4-3-4-5');
});

// 18. order は順序であり着順ではない: rank=finish のみ・order は出力に残さない
t('horseStats: order を着順(rank)に使わない・order を出力に残さない', () => {
  const out = getDisplayRecentRacesForNankan({
    horseStatsNankan: { recentRacesDetailed: [{ order: 1, finish: 7, date: '2026-05-28', raceName: '３歳(六)' }] },
  });
  assert.strictEqual(out[0].rank, 7, 'rank は finish(=7) であるべき（order=1 を使っていない）');
  assert.ok(!('order' in out[0]), 'order が出力に混入している');
});

console.log(`\ngetDisplayRecentRacesForNankan: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
