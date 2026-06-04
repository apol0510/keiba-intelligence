/**
 * injectRecentHorseHistoriesNankan.js (keiba-intelligence)
 *
 * Phase 6 第3段階: 南関 recentHorseHistories を読み取り、対象馬に
 * `horse.recentRacesFromHistoriesNankan` を「別フィールドとして」追加する。
 *
 * 絶対方針:
 *   - horse.recentRaces は一切上書きしない（注入先は別フィールドのみ）
 *   - result.ok === true の馬だけ注入。fallback 時は何もしない
 *   - featureScores / generateAdvancedMetrics は horse.recentRaces のみ参照するため
 *     本フィールドは特徴量計算に一切入らない（接続しない）
 *   - debug/meta（source/matchedBy/warnings）は horse に永続化しない
 *
 * KI の南関データは予想JSON（{ eventInfo, predictions[] }）で、各ページが
 * 描画する horses 配列と同一インスタンスを直接ミューテートする。
 */

import { loadRecentHorseHistoriesNankan } from './loadRecentHorseHistoriesNankan.js';

const NANKAN_NAME_TO_CODE = { '大井': 'OOI', '川崎': 'KAW', '船橋': 'FUN', '浦和': 'URA' };
const NANKAN_SLUG_TO_CODE = { ooi: 'OOI', kawasaki: 'KAW', funabashi: 'FUN', urawa: 'URA' };
const NANKAN_CODES = new Set(['OOI', 'KAW', 'FUN', 'URA']);

/** 日本語会場名 / スラッグ / 3文字コード から3文字コードを得る */
export function nankanVenueCode(nameOrSlugOrCode) {
  if (!nameOrSlugOrCode) return null;
  const raw = String(nameOrSlugOrCode).trim();
  if (NANKAN_CODES.has(raw.toUpperCase())) return raw.toUpperCase(); // 既にコードならそのまま
  const s = raw.toLowerCase();
  if (NANKAN_SLUG_TO_CODE[s]) return NANKAN_SLUG_TO_CODE[s];
  const name = raw.replace('競馬場', '').replace('競馬', '').trim();
  return NANKAN_NAME_TO_CODE[name] || null;
}

/**
 * 予想JSON data（{ eventInfo:{date}, predictions:[{raceInfo:{raceNumber}, horses:[...]}] }）に
 * recentRacesFromHistoriesNankan を注入する。data.predictions[].horses[] を直接ミューテート。
 *
 * @param {object} data        予想JSON（ページが描画する実体）
 * @param {string} venueCode   OOI/KAW/FUN/URA
 * @param {string} [projectRoot]
 */
export function injectRecentHorseHistoriesNankanIntoData(data, venueCode, projectRoot) {
  if (!data || !venueCode) return;
  const date = data?.eventInfo?.date;
  if (!date) return;
  for (const race of (data.predictions || [])) {
    const rn = Number(race?.raceInfo?.raceNumber);
    if (!Number.isFinite(rn)) continue;
    for (const horse of (race?.horses || [])) {
      if (!horse) continue;
      const r = loadRecentHorseHistoriesNankan(
        date, venueCode,
        { raceNumber: rn, horseNumber: horse.horseNumber, horseName: horse.horseName },
        projectRoot ? { projectRoot } : {}
      );
      if (r.ok && Array.isArray(r.recentRaces) && r.recentRaces.length > 0) {
        horse.recentRacesFromHistoriesNankan = r.recentRaces; // 別フィールドのみ・recentRaces 不変
      }
    }
  }
}

export default injectRecentHorseHistoriesNankanIntoData;
