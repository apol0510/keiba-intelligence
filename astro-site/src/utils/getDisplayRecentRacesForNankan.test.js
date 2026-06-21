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

console.log(`\ngetDisplayRecentRacesForNankan: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
