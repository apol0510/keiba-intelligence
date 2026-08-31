/**
 * archiveTotals.js — 公開実績の通算集計（トップページ等で使う）
 *
 * 正本: docs/RENEWAL_2026_08.md
 *
 * 🔴 数値を作らない。`archiveResults.json` / `archiveResultsJra.json` に保存されている
 *    実測値を足し合わせるだけ。恒等式は `BET_POINT_LOGIC.md` に従う:
 *
 *      returnRate = totalPayout / betAmount × 100
 *
 * 🔴 高配当を除外しない・点数を後から変えない（`docs/spec.md` §10 禁止変更）。
 * 🔴 集計値は **archive の蓄積に依存する時点値**であり、恒久的な仕様値ではない。
 *    「◯%を保証」といった表現に使わないこと。
 */

/** 1 カテゴリぶんの通算を出す。 */
export function totalsOf(entries) {
  const list = Array.isArray(entries) ? entries : [];
  let days = 0;
  let races = 0;
  let hits = 0;
  let betAmount = 0;
  let payout = 0;

  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    days += 1;
    races += Number(e.totalRaces) || 0;
    hits += Number(e.hitRaces) || 0;
    betAmount += Number(e.betAmount) || 0;
    payout += Number(e.totalPayout) || 0;
  }

  return {
    days,
    races,
    hits,
    betAmount,
    payout,
    // 分母 0 のときは null（0% と誤解される値を作らない）
    hitRate: races > 0 ? (hits / races) * 100 : null,
    returnRate: betAmount > 0 ? (payout / betAmount) * 100 : null,
  };
}

/** 南関 + JRA の合算。 */
export function combinedTotals(nankanEntries, jraEntries) {
  const n = totalsOf(nankanEntries);
  const j = totalsOf(jraEntries);
  const races = n.races + j.races;
  const hits = n.hits + j.hits;
  const betAmount = n.betAmount + j.betAmount;
  const payout = n.payout + j.payout;

  return {
    nankan: n,
    jra: j,
    all: {
      days: n.days + j.days,
      races,
      hits,
      betAmount,
      payout,
      hitRate: races > 0 ? (hits / races) * 100 : null,
      returnRate: betAmount > 0 ? (payout / betAmount) * 100 : null,
    },
  };
}

/** 表示用の丸め（小数第1位）。null は '—' を返す。 */
export function formatPercent(v) {
  return v == null ? '—' : `${v.toFixed(1)}%`;
}

export function formatCount(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('ja-JP') : '—';
}
