/**
 * injectEntriesRecentRacesNankan.js (keiba-intelligence) — PR-F5f-1
 *
 * 南関 entries(出馬表)由来の近走を読み取り、対象馬に
 * `horse.recentRacesFromEntriesNankan` を「別フィールドとして」追加する。
 *
 * 設計: keiba-data-shared-admin docs/nankan-horse-detail-display-plan.md §32（馬詳細専用）。
 *   既存 injectRecentHorseHistoriesNankan.js の data traversal を踏襲。
 *
 * 絶対方針（§32）:
 *   - **`horse.recentRaces` を一切上書きしない**（注入先は別フィールドのみ）。
 *   - **`horse.recentRacesFromHistoriesNankan` を一切上書きしない**（recentHorseHistories と独立）。
 *   - **entries は recentHorseHistories の fallback にしない**（getDisplayRecentRacesForNankan を import しない・変更しない）。
 *   - result.ok === true かつ recentRaces.length > 0 の馬だけ注入。fallback 時は何もしない。
 *   - full venue guard（R01-only/partial skip）は loadEntriesNankan に委譲。
 *   - **record は触らない**（mapper が record を除外済み）。
 *   - featureScores / 特徴量計算 / AI指数 / 印 / 買い目 / 穴馬 には接続しない
 *     （featureScores は horse.recentRaces のみ参照するため本フィールドは特徴量に入らない）。
 *   - debug/meta（source/matchedBy/warnings）は horse に永続化しない。
 *
 * KI の南関データは予想JSON（{ eventInfo, predictions[] }）で、各ページが描画する
 * horses 配列と同一インスタンスを直接ミューテートする。
 */

import { loadEntriesNankan } from './loadEntriesNankan.js';

/**
 * 予想JSON data（{ eventInfo:{date}, predictions:[{raceInfo:{raceNumber}, horses:[...]}] }）に
 * recentRacesFromEntriesNankan を注入する。data.predictions[].horses[] を直接ミューテート。
 *
 * @param {object} data        予想JSON（ページが描画する実体）
 * @param {string} venueCode   OOI/KAW/FUN/URA
 * @param {string} [projectRoot]
 */
export function injectEntriesRecentRacesNankanIntoData(data, venueCode, projectRoot) {
  if (!data || !venueCode) return;
  const date = data?.eventInfo?.date;
  if (!date) return;
  for (const race of (data.predictions || [])) {
    const rn = Number(race?.raceInfo?.raceNumber);
    if (!Number.isFinite(rn)) continue;
    for (const horse of (race?.horses || [])) {
      if (!horse) continue;
      const r = loadEntriesNankan(
        date, venueCode,
        { raceNumber: rn, horseNumber: horse.horseNumber, horseName: horse.horseName },
        projectRoot ? { projectRoot } : {}
      );
      if (r.ok && Array.isArray(r.recentRaces) && r.recentRaces.length > 0) {
        // 別フィールドのみ・recentRaces / recentRacesFromHistoriesNankan は不変
        horse.recentRacesFromEntriesNankan = r.recentRaces;
      }
    }
  }
}

export default injectEntriesRecentRacesNankanIntoData;
