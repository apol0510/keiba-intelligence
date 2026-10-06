/**
 * displayedBets.js — 会員に表示した馬単の組み合わせを凍結し、その組み合わせを 1 単位（100 円）ずつ買った成績を計算する
 *
 * 2026-10-06 MK: 公開成績は「実際に顧客へ表示した買い目」と整合する方式へ整理する。
 *   - 表示は `buildBettingPlan`（RaceEntryTable の買い目パネル）と同じ関数で組み合わせを作る（別ロジックを持たない）。
 *   - メインレース判定も表示と同じ（予想ファイルの会場ごとのレース数 → `isMainRace`。RaceDayBoard と同じ）。
 *   - 🔴 「抑え」は表示上の参考馬で、組み合わせ（＝判定・集計の対象）に入れない（表示パネルと同じ）。
 *   - 🔴 凍結は**最初に見た版が勝つ**（公開後に予想ファイルが書き換わっても、凍結済みの組み合わせは変えない）。
 *
 * 🔴 回収率は**内部計測のみ**（顧客画面に出さない・2026-10-06 MK）。data/stats/displayedSummary.json も内部 KPI。
 * 顧客画面が使うのは的中・AI選定の組数・判定だけ。AI上位表示（top）の成績も内部集計（将来、別々に評価するため）。
 */

import { createHash } from 'node:crypto';
import { linesOf, tiersForVenue } from '../../utils/displayedSelection.js';

export const SCHEMA = 'ki_displayed_bets.v1';
export const UNIT_YEN = 100;
/**
 * 内部 KPI（displayedSummary）の集計起点。買い目パネル（展開した組の表示）の公開日（2026-08-30・63345ab6/4128c731）。
 * それより前は組み合わせとして表示していないため、全期間の日別（displayedReturn）にだけ含める。
 */
export const PUBLIC_FROM = '2026-08-30';

export function sha256(obj) {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

/**
 * 予想 1 会場ぶん（`predictions[]`）→ レースごとの表示組み合わせ（`"07>03"`）。
 * `combos` = AI全選定・`top` = AI上位表示（`combos` の先頭・`topRule`）。定義は utils/displayedSelection（表示と同じ）。
 */
export function displayedRaces(predictions) {
  const list = Array.isArray(predictions) ? predictions : [];
  const tiers = tiersForVenue(list);
  return list
    .map((race) => {
      const rn = race?.raceInfo?.raceNumber ?? null;
      const t = rn != null ? tiers.get(Number(rn)) : null;
      return { raceNumber: rn, isMain: !!t?.isMain, fieldSize: t?.fieldSize ?? 0, combos: t?.all ?? [], top: t?.top ?? [],
        topRule: t?.rule ?? null, linesHash: sha256(linesOf(race)) };
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
    // AI上位表示（top）が無い旧レコードは、組み合わせが一致するレースに限り top を補う（AI全選定 combos は変えない）
    const now = new Map(races.map((r) => [r.raceNumber, r]));
    let augmented = false;
    const merged = (existing.races || []).map((r) => {
      if (Array.isArray(r.top)) return r;
      const n = now.get(r.raceNumber);
      if (!n || n.combos.join(',') !== r.combos.join(',')) return r;
      augmented = true;
      return { ...r, fieldSize: n.fieldSize, top: n.top, topRule: n.topRule };
    });
    if (!augmented) return { record: existing, changed: false, drift };
    const record = { ...existing, races: merged, topAugmentedAt: nowIso };
    record.recordHash = sha256({ market: record.market, date: record.date, venue: record.venue, races: merged });
    return { record, changed: true, drift };
  }
  const record = { schema: SCHEMA, market, date, venue, frozenAt: nowIso, backfilled: !!backfilled, races };
  record.recordHash = sha256({ market, date, venue, races });
  return { record, changed: true, drift: [] };
}

/**
 * archive（確定した馬単の組と 100 円払戻）→ 成績計算の正解。
 * 🔴 着順（result）と馬単の払戻の組が食い違うレースは推測せず除外する（`conflicts`）。
 * @param {Array<[string, object[]]>} archives `[['nankan', archiveResults], ['jra', archiveResultsJra]]`
 */
export function resultsFromArchive(archives) {
  const results = new Map();
  const conflicts = [];
  for (const [market, arr] of archives) {
    for (const day of arr || []) {
      for (const r of day.races || []) {
        const [a, b] = String(r?.umatan?.combination || '').split('-');
        if (!a || !b || !Number.isFinite(Number(r?.umatan?.payout))) continue;
        const venue = r.venue || day.venue;
        if (Number(r?.result?.first?.number) !== Number(a) || Number(r?.result?.second?.number) !== Number(b)) {
          conflicts.push(`${market} ${day.date} ${venue} ${r.raceNumber}R`);
          continue;
        }
        results.set(`${market}|${day.date}|${venue}|${r.raceNumber}`, {
          first: String(a).padStart(2, '0'), second: String(b).padStart(2, '0'), payoutPer100: Number(r.umatan.payout),
        });
      }
    }
  }
  return { results, conflicts };
}

const rate = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

/**
 * 凍結した表示組み合わせ × 確定結果 → 1 単位ずつ買った成績（AI全選定・AI上位表示を別々に）。
 * @param {object[]} frozen `ki_displayed_bets.v1`
 * @param {Map<string, {first:string, second:string, payoutPer100:number}>} results key = `${market}|${date}|${venue}|${raceNumber}`
 * @param {{ from?: string }} [opts] `from` 以降の日だけ合計する（日別は全件）
 */
export function displayedReturn(frozen, results, { from = null } = {}) {
  const days = [];
  for (const f of frozen) {
    const d = { market: f.market, date: f.date, venue: f.venue, races: 0, hits: 0, stake: 0, payout: 0, combos: 0, unsettled: 0,
      top: { races: 0, hits: 0, stake: 0, payout: 0 }, backfilled: !!f.backfilled };
    for (const r of f.races) {
      if (!r.combos.length) continue;
      const res = results.get(`${f.market}|${f.date}|${f.venue}|${r.raceNumber}`);
      if (!res) { d.unsettled += 1; continue; }
      const key = `${res.first}>${res.second}`;
      d.races += 1; d.combos += r.combos.length; d.stake += r.combos.length * UNIT_YEN;
      if (r.combos.includes(key)) { d.hits += 1; d.payout += res.payoutPer100 * (UNIT_YEN / 100); }
      if (Array.isArray(r.top) && r.top.length) {
        d.top.races += 1; d.top.stake += r.top.length * UNIT_YEN;
        if (r.top.includes(key)) { d.top.hits += 1; d.top.payout += res.payoutPer100 * (UNIT_YEN / 100); }
      }
    }
    d.returnRate = rate(d.payout, d.stake);
    d.hitRate = rate(d.hits, d.races);
    d.top.returnRate = rate(d.top.payout, d.top.stake);
    d.top.hitRate = rate(d.top.hits, d.top.races);
    days.push(d);
  }
  days.sort((a, b) => (a.date + a.venue < b.date + b.venue ? -1 : 1));
  const totals = {};
  for (const m of ['nankan', 'jra', null]) {
    const ds = days.filter((d) => (!m || d.market === m) && (!from || d.date >= from) && d.races > 0);
    const add = (k, sub) => ds.reduce((a, d) => a + (sub ? d[sub][k] : d[k]), 0);
    const t = { races: add('races'), hits: add('hits'), stake: add('stake'), payout: add('payout'), combos: add('combos'),
      from: ds[0]?.date ?? null, to: ds[ds.length - 1]?.date ?? null,
      top: { races: add('races', 'top'), hits: add('hits', 'top'), stake: add('stake', 'top'), payout: add('payout', 'top') } };
    t.returnRate = rate(t.payout, t.stake); t.hitRate = rate(t.hits, t.races);
    t.avgCombos = t.races > 0 ? Math.round((t.combos / t.races) * 10) / 10 : null;
    t.top.returnRate = rate(t.top.payout, t.top.stake); t.top.hitRate = rate(t.top.hits, t.top.races);
    totals[m || 'all'] = t;
  }
  return { days, totals };
}
