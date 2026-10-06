/**
 * displayedBets.js — 会員に表示した馬単の組み合わせを凍結し、その組み合わせを 1 単位（100 円）ずつ買った成績を計算する
 *
 * 2026-10-06 MK: 公開成績は「実際に顧客へ表示した買い目」と整合する方式へ整理する。
 *   - 表示は `buildBettingPlan`（RaceEntryTable の買い目パネル）と同じ関数で組み合わせを作る（別ロジックを持たない）。
 *   - メインレース判定も表示と同じ（予想ファイルの会場ごとのレース数 → `isMainRace`。RaceDayBoard と同じ）。
 *   - 🔴 「抑え」は表示上の参考馬で、組み合わせ（＝判定・集計の対象）に入れない（表示パネルと同じ）。
 *   - 🔴 凍結は**最初に見た版が勝つ**（公開後に予想ファイルが書き換わっても、凍結済みの組み合わせは変えない）。
 *
 * 本モジュールは表示に使わない（顧客向けの数字は、表示買い目基準の系列が揃ってから MK が判断して出す）。
 */

import { createHash } from 'node:crypto';
import { buildBettingPlan } from '../../utils/bettingPlan.js';
import { isMainRace } from '../../utils/mainRaceBetting.js';

export const SCHEMA = 'ki_displayed_bets.v1';
export const UNIT_YEN = 100;

export function sha256(obj) {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

/** 予想 1 会場ぶん（`predictions[]`）→ レースごとの表示組み合わせ（`"07>03"`）。 */
export function displayedRaces(predictions) {
  const list = Array.isArray(predictions) ? predictions : [];
  const total = list.length;
  return list
    .map((race) => {
      const rn = race?.raceInfo?.raceNumber ?? null;
      const lines = Array.isArray(race?.bettingLines) ? race.bettingLines : (race?.bettingLines?.umatan || []);
      const valid = (Array.isArray(lines) ? lines : []).filter((l) => typeof l === 'string' && l.trim());
      const isMain = rn != null && isMainRace(rn, total);
      const plan = valid.length ? buildBettingPlan(valid, { isMain, fieldSize: (race?.horses || []).length }) : null;
      const combos = plan ? plan.combos.map((c) => `${String(c.first).padStart(2, '0')}>${String(c.second).padStart(2, '0')}`) : [];
      return { raceNumber: rn, isMain, combos, linesHash: sha256(valid) };
    })
    .filter((r) => r.raceNumber != null)
    .sort((a, b) => a.raceNumber - b.raceNumber);
}

/**
 * 凍結レコードを作る / 既存と突き合わせる。
 * @returns {{ record: object, changed: boolean, drift: number[] }}
 *   `changed` = 新しく書くべきか（既存が無いときだけ true）。`drift` = 既存と組み合わせが違うレース番号（記録のみ・上書きしない）。
 */
export function freeze({ market, date, venue, predictions, nowIso, existing = null, backfilled = false }) {
  const races = displayedRaces(predictions);
  if (existing) {
    const before = new Map((existing.races || []).map((r) => [r.raceNumber, r.combos.join(',')]));
    const drift = races.filter((r) => before.has(r.raceNumber) && before.get(r.raceNumber) !== r.combos.join(',')).map((r) => r.raceNumber);
    return { record: existing, changed: false, drift };
  }
  const record = { schema: SCHEMA, market, date, venue, frozenAt: nowIso, backfilled: !!backfilled, races };
  record.recordHash = sha256({ market, date, venue, races });
  return { record, changed: true, drift: [] };
}

/**
 * 凍結した表示組み合わせ × 確定結果 → 1 単位ずつ買った成績。
 * @param {object[]} frozen `ki_displayed_bets.v1`
 * @param {Map<string, {first:string, second:string, payoutPer100:number}>} results key = `${market}|${date}|${venue}|${raceNumber}`
 */
export function displayedReturn(frozen, results) {
  const days = [];
  for (const f of frozen) {
    let stake = 0; let payout = 0; let races = 0; let hits = 0; let unsettled = 0;
    for (const r of f.races) {
      if (!r.combos.length) continue;
      const res = results.get(`${f.market}|${f.date}|${f.venue}|${r.raceNumber}`);
      if (!res) { unsettled += 1; continue; }
      races += 1;
      stake += r.combos.length * UNIT_YEN;
      if (r.combos.includes(`${res.first}>${res.second}`)) { hits += 1; payout += res.payoutPer100 * (UNIT_YEN / 100); }
    }
    days.push({ market: f.market, date: f.date, venue: f.venue, races, hits, stake, payout, unsettled,
      returnRate: stake > 0 ? Math.round((payout / stake) * 1000) / 10 : null, backfilled: !!f.backfilled });
  }
  const sum = (m) => days.filter((d) => !m || d.market === m).reduce((a, d) => ({
    races: a.races + d.races, hits: a.hits + d.hits, stake: a.stake + d.stake, payout: a.payout + d.payout,
  }), { races: 0, hits: 0, stake: 0, payout: 0 });
  const totals = {};
  for (const m of ['nankan', 'jra', null]) {
    const t = sum(m);
    totals[m || 'all'] = { ...t, returnRate: t.stake > 0 ? Math.round((t.payout / t.stake) * 1000) / 10 : null,
      hitRate: t.races > 0 ? Math.round((t.hits / t.races) * 1000) / 10 : null };
  }
  return { days: days.sort((a, b) => (a.date + a.venue < b.date + b.venue ? -1 : 1)), totals };
}
