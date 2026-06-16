/**
 * injectHorseStatsNankan.js (keiba-intelligence)
 *
 * 南関 horseStats（uma_info 元表統計）を読み、対象馬に
 * `horse.horseStatsNankan` を「別フィールドとして」追加する。
 *
 * 設計: keiba-data-shared-admin docs/nankan-uma-info-horse-stats-schema.md。
 *   既存 injectEntriesRecentRacesNankan.js の data traversal を踏襲。
 *
 * 絶対方針:
 *   - horse.recentRaces / recentRacesFromEntriesNankan / recentRacesFromHistoriesNankan /
 *     featureScores / importance / AI指数 / 印 / 買い目 / EV を一切上書きしない。
 *   - 注入先は horse.horseStatsNankan のみ。result.ok のときだけ注入。
 *   - featureScores は horse.recentRaces のみ参照するため本フィールドは特徴量に入らない。
 *   - 失敗は非致命（何もしない・既存表示維持）。
 *
 * マッチング: raceNo（race.raceInfo.raceNumber）+ horseNumber 主、horseName 補助。
 */

import { loadHorseStatsNankan } from './loadHorseStatsNankan.js';

/**
 * 予想JSON data（{ eventInfo:{date}, predictions:[{raceInfo:{raceNumber}, horses:[...]}] }）に
 * horseStatsNankan を注入する。data.predictions[].horses[] を直接ミューテート。
 *
 * @param {object} data        予想JSON（ページが描画する実体）
 * @param {string} venueCode   OOI/KAW/FUN/URA
 * @param {string} [projectRoot]
 */
export function injectHorseStatsNankanIntoData(data, venueCode, projectRoot) {
  if (!data || !venueCode) return;
  const date = data?.eventInfo?.date;
  if (!date) return;
  for (const race of (data.predictions || [])) {
    const rn = Number(race?.raceInfo?.raceNumber);
    if (!Number.isFinite(rn)) continue;
    for (const horse of (race?.horses || [])) {
      if (!horse) continue;
      const r = loadHorseStatsNankan(
        { date, venue: venueCode, raceNo: rn, horseNumber: horse.horseNumber, horseName: horse.horseName },
        projectRoot ? { projectRoot } : {}
      );
      if (r.ok && r.horseStats) {
        // 別フィールドのみ・recentRaces / featureScores は不変
        horse.horseStatsNankan = r.horseStats;
      }
    }
  }
}

export default injectHorseStatsNankanIntoData;
