/**
 * nankanHorseStatsInjection.guard.test.js (keiba-intelligence)
 *
 * 南関 horseStats 近走 fallback の「配線が外れる退行」を静的に検知する guard（Node標準 assert）。
 * getDisplayRecentRacesForNankan が horseStats を採用できるのは、各ページが
 * horse.horseStatsNankan を注入している前提。注入呼び出しが削除されると resolver の
 * horseStats 分岐は無音で死ぬ（racebook 4走へ退行）ため、注入サイトの存在を固定する。
 * 特に free/light の [slug].astro は当初 horseStats 未注入だったため重点的にガードする。
 *
 * 2026-08-28 更新（docs/RENEWAL_2026_08.md）:
 *   注入は各ページ直書きから **共通ローダー `src/lib/prediction/loadRaceDay.js`** へ集約された。
 *   ガードの意図（3 経路すべてで注入が生きていること）は変えず、
 *   「直接呼ぶ」か「注入を行う共通ローダーを使う」かのいずれかを満たすことを検証する。
 *   併せて共通ローダー側が注入を落としていないことも固定する（単一点の退行防止）。
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
/** 注入を行う共通ローダー。ここが注入をやめると全経路が無音で退行する。 */
const SHARED_LOADER = 'src/lib/prediction/loadRaceDay.js';
const LOADER_FNS = ['loadNankanRaceDay', 'loadNankanRaceDayBySlug'];

for (const [label, rel] of PAGES) {
  t(`${label} が horseStats 注入経路を持つ（直接呼び出し or 共通ローダー経由）`, () => {
    const src = read(rel);
    const direct = /injectHorseStatsNankanIntoData/.test(src);
    const viaLoader = /loadRaceDay(\.js)?['"]/.test(src) && LOADER_FNS.some((fn) => src.includes(fn));
    assert.ok(
      direct || viaLoader,
      `${rel} が horseStats 注入に到達していない（直接呼び出しも共通ローダー利用も無い）`,
    );
  });
}

// 共通ローダー: 注入呼び出しが残っていること（集約先が落ちると全経路が死ぬ）。
t('共通ローダーが injectHorseStatsNankanIntoData を注入', () => {
  const src = read(SHARED_LOADER);
  assert.ok(
    /injectHorseStatsNankanIntoData\(/.test(src),
    `${SHARED_LOADER} から injectHorseStatsNankanIntoData 呼び出しが消えている`,
  );
  for (const fn of LOADER_FNS) {
    assert.ok(src.includes(`export function ${fn}`), `${SHARED_LOADER} に ${fn} が無い`);
  }
});

// 共通ローダー: 南関の過去走 resolver が getDisplayRecentRacesForNankan を通ること。
t('共通ローダーの南関 resolver が getDisplayRecentRacesForNankan を使う', () => {
  const src = read(SHARED_LOADER);
  assert.ok(
    /getDisplayRecentRacesForNankan\(/.test(src),
    `${SHARED_LOADER} が resolver を経由していない（horseStats 分岐が使われない）`,
  );
});

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
