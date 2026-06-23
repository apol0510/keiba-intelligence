/**
 * nankanHorseStatsInjection.guard.test.js (keiba-intelligence)
 *
 * 南関 horseStats 近走 fallback の「配線が外れる退行」を静的に検知する guard（Node標準 assert）。
 * getDisplayRecentRacesForNankan が horseStats を採用できるのは、各ページが
 * horse.horseStatsNankan を注入している前提。注入呼び出しが削除されると resolver の
 * horseStats 分岐は無音で死ぬ（racebook 4走へ退行）ため、注入サイトの存在を固定する。
 * 特に free/light の [slug].astro は当初 horseStats 未注入だったため重点的にガードする。
 *
 * 重い Astro レンダーは行わず、ソースの静的 import/呼び出し確認 + resolver 分岐の存在確認のみ。
 *
 * 実行: node src/utils/nankanHorseStatsInjection.guard.test.js （astro-site 直下から）
 */
import assert from 'assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log(`  ✅ ${name}`); } catch (e) { fail++; console.error(`  ❌ ${name}\n     ${e.message}`); } };
const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf-8');

// 各 nankan ページが injectHorseStatsNankanIntoData を呼ぶ（注入が外れたら horseStats 分岐が死ぬ）。
const PAGES = [
  ['light([slug])', 'src/pages/free-prediction/nankan/[slug].astro'],
  ['free index',    'src/pages/free-prediction/nankan/index.astro'],
  ['premium',       'src/pages/prediction/nankan/index.astro'],
];
for (const [label, rel] of PAGES) {
  t(`${label} が injectHorseStatsNankanIntoData を注入`, () => {
    const src = read(rel);
    assert.ok(/injectHorseStatsNankanIntoData/.test(src), `${rel} から injectHorseStatsNankanIntoData 注入が消えている`);
  });
}

// resolver: horseStats 分岐（horseStatsNankan.recentRacesDetailed）が存在し、legacy より前にある。
t('resolver に horseStats 分岐が存在し legacy(recentRaces素通し)より前にある', () => {
  const src = read('src/utils/getDisplayRecentRacesForNankan.js');
  assert.ok(/horseStatsNankan/.test(src) && /recentRacesDetailed/.test(src), 'resolver の horseStats 参照が消えている');
  const idxHs = src.indexOf('horseStatsRecentRacesNankan(horse)');
  const idxLegacy = src.indexOf('Array.isArray(horse.recentRaces)');
  assert.ok(idxHs > -1, 'horseStats fallback 呼び出しが消えている');
  assert.ok(idxLegacy > -1, 'legacy 素通しが見つからない');
  assert.ok(idxHs < idxLegacy, 'horseStats fallback が legacy 素通しより後ろにある（順序退行）');
});

console.log(`\nnankanHorseStatsInjection.guard (KI): ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
