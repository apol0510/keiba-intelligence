/**
 * exacta/stats.js — AI が採用した組み合わせを 1 単位（100 円）ずつ買った成績（再現可能な唯一の定義）
 *
 * 正本: KAO `docs/ki-dynamic-selection.md` §4.2・KAO D-160
 *
 *   投資   = Σ（BUY のレース）Σ（返還でない選択）100 円
 *   払戻   = Σ（的中した選択）100 円あたり払戻
 *   回収率 = 払戻 ÷ 投資 × 100
 *   的中率 = 的中したレース ÷ BUY のレース（見送りは分母に入れず、件数を別に出す）
 *
 * 🔴 入力は公開データだけ（選択 ＋ 確定払戻）。オッズを使わない＝誰でも同じ数字を再計算できる。
 * 🔴 結果が未着のレースは数えない（推測しない）。返還は確定データに書かれた馬番だけ。
 */

export const UNIT_YEN = 100;

/**
 * @param {Map<string, object>|object[]} selections `ki_exacta_selection.v1`
 * @param {Map<string, {first:string, second:string, payoutPer100:number, voidHorses?:string[]}>} results
 */
export function settle(selections, results) {
  const rows = selections instanceof Map ? [...selections.values()] : selections;
  const races = [];
  let invest = 0;
  let payout = 0;
  let buyRaces = 0;
  let hitRaces = 0;
  let skipped = 0;
  let unsettled = 0;
  for (const row of [...rows].sort((a, b) => (a.race_id < b.race_id ? -1 : 1))) {
    if (row.outcome !== 'BUY') { skipped += 1; continue; }
    const res = results.get(row.race_id);
    if (!res) { unsettled += 1; continue; }
    const voids = new Set(res.voidHorses || []);
    let stake = 0;
    let ret = 0;
    let hit = false;
    for (const sel of row.selections) {
      const [a, b] = sel.split('>');
      if (voids.has(a) || voids.has(b)) continue;   // 返還（投資に数えない）
      stake += UNIT_YEN;
      if (a === res.first && b === res.second) {
        ret += res.payoutPer100 * (UNIT_YEN / 100);
        hit = true;
      }
    }
    if (stake === 0) { unsettled += 1; continue; }
    buyRaces += 1;
    if (hit) hitRaces += 1;
    invest += stake;
    payout += ret;
    races.push({ raceId: row.race_id, stake, payout: ret, hit, decisionId: row.decision_id || null });
  }
  return {
    races,
    totals: {
      invest, payout, buyRaces, hitRaces, skipped, unsettled,
      returnRate: invest > 0 ? Math.round((payout / invest) * 1000) / 10 : null,
      hitRate: buyRaces > 0 ? Math.round((hitRaces / buyRaces) * 1000) / 10 : null,
    },
  };
}
