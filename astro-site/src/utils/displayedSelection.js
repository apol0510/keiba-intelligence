/**
 * displayedSelection.js — 会員に表示する「AI上位表示 / AI全選定」を、表示と同じ入力から作る（単一の定義）
 *
 * 2026-10-06 MK: Premium 表示・AI選定組数・公開時凍結・的中判定・回収率でズレが出ない構造にする。
 *   - 買い目の行: 予想の `bettingLines`（配列 or `{ umatan: [...] }`）。RaceDayBoard の bettingLinesOf と同じ
 *   - メインレース: 会場の予想レース数 → `isMainRace`（RaceDayBoard と同じ）
 *   - 出走頭数: 予想の `horses.length`（RaceNewspaper と同じ）
 *   - 組の並び・上位の範囲: `bettingPlan.selectionTiers`
 * 結果ページ・凍結（scripts/freezeDisplayedBets）・成績はこのモジュールを使う。
 */
import { selectionTiers } from './bettingPlan.js';
import { isMainRace } from './mainRaceBetting.js';

export function linesOf(race) {
  const b = race?.bettingLines;
  const arr = Array.isArray(b) ? b : (b && Array.isArray(b.umatan) ? b.umatan : []);
  return arr.filter((l) => typeof l === 'string' && l.trim());
}

/**
 * 1 会場ぶんの予想 → `Map<raceNumber, { isMain, fieldSize, rule, all, top }>`。
 * @param {object[]} predictions 会場の予想（表示に使うものと同じ配列）
 */
export function tiersForVenue(predictions) {
  const list = Array.isArray(predictions) ? predictions : [];
  const total = list.length;
  const out = new Map();
  for (const race of list) {
    const rn = race?.raceInfo?.raceNumber;
    if (rn == null) continue;
    const lines = linesOf(race);
    const isMain = isMainRace(rn, total);
    const fieldSize = Array.isArray(race?.horses) ? race.horses.length : 0;
    const t = lines.length ? selectionTiers(lines, { isMain, fieldSize }) : { rule: null, all: [], top: [] };
    out.set(Number(rn), { isMain, fieldSize, ...t });
  }
  return out;
}

/** 確定した 1・2 着がどの段階で含まれるか: 'top' | 'all' | null。 */
export function hitTier(tiers, first, second) {
  if (!tiers || first == null || second == null) return null;
  const key = `${String(first).padStart(2, '0')}>${String(second).padStart(2, '0')}`;
  if (tiers.top.includes(key)) return 'top';
  if (tiers.all.includes(key)) return 'all';
  return null;
}
