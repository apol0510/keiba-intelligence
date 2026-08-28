/**
 * frameNumber.js — 枠番の算出
 *
 * 正本: docs/RENEWAL_2026_08.md §4.2
 *
 * 枠番は **馬番と出走頭数から一意に決まる**（推測ではなく規則）。
 *
 *   - 8 頭以下 … 枠番 = 馬番
 *   - 9 頭以上 … 8 枠へ均等に割り、余りは **枠番の大きい側**へ 1 頭ずつ足す
 *     （q = ⌊頭数 / 8⌋、r = 頭数 mod 8 として、枠 1〜(8−r) は q 頭、枠 (9−r)〜8 は q+1 頭）
 *
 * 例: 18 頭 → 枠1〜6 が 2 頭、枠7・8 が 3 頭
 *     （枠7 = 馬番13,14,15 / 枠8 = 馬番16,17,18）
 *
 * 検証: `src/data/horseStats/nankan/**` の実データ 5,039 件と照合し **不一致 0**。
 *
 * 🔴 データに明示の枠番があるときは**そちらを優先**する（本関数は fallback）。
 * 🔴 頭数・馬番が不明なときは null を返す（推測しない）。
 */

/**
 * @param {number} horseNumber 馬番（1 始まり）
 * @param {number} fieldSize   出走頭数
 * @returns {number|null} 1〜8、または null
 */
export function calcFrameNumber(horseNumber, fieldSize) {
  const n = Number(horseNumber);
  const total = Number(fieldSize);
  if (!Number.isInteger(n) || n < 1) return null;
  if (!Number.isInteger(total) || total < 1) return null;
  if (n > total) return null;

  if (total <= 8) return n;

  const q = Math.floor(total / 8);
  const r = total % 8;

  let acc = 0;
  for (let bracket = 1; bracket <= 8; bracket += 1) {
    const size = q + (bracket > 8 - r ? 1 : 0);
    if (n <= acc + size) return bracket;
    acc += size;
  }
  return 8;
}

/**
 * 馬オブジェクトから枠番を解決する。
 * データに枠番があればそれを使い、無ければ規則で算出する。
 *
 * @param {object} horse
 * @param {number} fieldSize
 * @returns {number|null}
 */
export function resolveFrameNumber(horse, fieldSize) {
  const explicit = horse?.frameNumber ?? horse?.wakuNumber ?? horse?.horseStatsNankan?.frameNumber;
  const e = Number(explicit);
  if (Number.isInteger(e) && e >= 1 && e <= 8) return e;
  return calcFrameNumber(horse?.horseNumber, fieldSize);
}
