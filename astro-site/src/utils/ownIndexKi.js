/**
 * ownIndexKi.js — KI の独自指数（OWN_INDEX_KI_V1）。純関数。
 *
 * 独自指数 = 基礎点（公表されている指数・45 以上を評価）＋ 独自評価の点。KI は「近 5 走重視」:
 *   近走（近 5 走の重み付き着順）×2・上がり（近 3 走の最速）×1・コース（同じ競馬場の 3 着以内率）×1（ownIndex.js SITE_WEIGHTS.KI）。
 *   各項目で、評価する馬の中の上位 3 分の 1 が +重み、下位 3 分の 1 が −重み（全頭が同じ値の項目は使わない）。点は −4〜+4。
 *   並び = 独自指数の高い順 → 基礎点の高い順 → 馬番の小さい順（ownIndex.js ownOrder）。
 * サイトごとに重みを変えている（AK・HIBI・NANKAN PICKS と最終の印・役割・買い目を同じにしない・MK 2026-11-26）。
 * 検証（南関 2,399R・中央 2,699R・2026-02〜11-26）: 本命の単勝・複勝率、馬単の的中率・回収率は指数順と同等（docs/decisions.md 2026-11-26）。
 * 🛑 入力は前日に作られた予想ファイルと、開催日より前の確定結果だけ。
 */
import { ownIndexRaceWeighted, SITE_WEIGHTS } from './ownIndex.js';

export const OWN_INDEX_KI_VERSION = 'OWN_INDEX_KI_V1';
export const KI_WEIGHTS = SITE_WEIGHTS.KI;

/**
 * 1 レースの独自指数（ownIndex.js ownIndexRace と同じ形を返す）。
 * @param {Array<{ number, base, recent, jockey?, jockeyRecord? }>} horses recent は新しい順の過去走
 * @param {Map<string, { rides: number, wins: number }>} jockeyStats
 * @param {{ venueCode?: string }} ctx 今回の競馬場（コースの項目）
 */
export function ownIndexKiRace(horses, jockeyStats = new Map(), { venueCode = null } = {}) {
  return ownIndexRaceWeighted(horses, { weights: KI_WEIGHTS, venueCode, jockeyStats });
}

/** 公開する独自指数の値（順位を変えない単調変換・同じ値にならない）: round(1.15 × 独自指数 − 20) */
export function displayOwnIndex(ownIndex) {
  return Math.round(1.15 * ownIndex - 20);
}
