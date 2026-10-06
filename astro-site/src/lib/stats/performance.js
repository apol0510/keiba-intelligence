/**
 * performance.js — 公開実績（的中率・回収率）の単一源
 *
 * 正本: docs/PERFORMANCE_STATS.md（算定式・除外規則・代表値）
 *
 * 🔴 公開ページの的中率・回収率・投資額・払戻は **すべて本モジュールから出す**。
 *    ページごとに足し算・割り算を書かない（`performanceSsot.test.mjs` が固定する）。
 *
 * ── 算定基準（`PERFORMANCE_BASIS`）──
 *   Premium の買い目パネルに表示した組み合わせ（`buildBettingPlan(...).combos`
 *   ＝ F3 で展開した全組・抑えは含めない）を、**各 1 点 100 円で全点購入した**とする。
 *
 *     投資額 = 表示した組の数 × 100
 *     払戻   = 的中したレースの馬単払戻（実額・加工なし・上限なし）
 *     的中   = 表示した組に、確定した 1 着→2 着の組が含まれる
 *     的中率 = 的中レース数 ÷ 集計レース数 × 100
 *     回収率 = 払戻 ÷ 投資額 × 100
 *
 *   開催・月・年・会場・通算は、レース単位の値を **足してから** 割る（率の平均を取らない）。
 *
 * 🔴 買い目・結果・払戻の保存データを書き換えない。読むだけ。
 * 🔴 archive に保存されている `betAmount` / `returnRate` / `hitRate`（旧 5 点基準）は
 *    公開表示に使わない（取込スクリプトの内部値として残っているだけ）。
 * 🔴 南関と JRA を混ぜない。合算は `combinedSummary` だけが行い、内訳も必ず返す。
 * 🔴 結果を見て個別レースの数字を直す処理・日付別の補正・表示上限（キャップ）を置かない。
 */

import { buildBettingPlan, UNIT_PRICE_YEN } from '../../utils/bettingPlan.js';
import { isMainRace } from '../../utils/mainRaceBetting.js';

/** 算定基準の識別子。基準を変えるときは正本（PERFORMANCE_STATS.md）と同時に変える。 */
export const PERFORMANCE_BASIS = 'displayed-all-combos-100yen';

/** 集計から除外する理由（推測で補わない）。 */
export const EXCLUDE_REASON = Object.freeze({
  NO_RESULT: 'no_result', // 1・2 着が無い（中止・未確定）
  NO_BETS: 'no_bets', // 買い目が無い
  PAYOUT_MISMATCH: 'payout_mismatch', // 保存された馬単払戻の組が 1・2 着と一致しない
});

const cache = new WeakMap();

/**
 * 1 レースの成績。
 * @param {object} race archive の race
 * @param {{ isMain: boolean }} o
 */
export function raceOutcome(race, { isMain }) {
  const first = Number(race?.result?.first?.number);
  const second = Number(race?.result?.second?.number);
  if (!first || !second) return { counted: false, reason: EXCLUDE_REASON.NO_RESULT };

  const plan = buildBettingPlan(race?.bettingLines ?? [], { isMain: !!isMain });
  const points = plan.combos.length;
  if (points === 0) return { counted: false, reason: EXCLUDE_REASON.NO_BETS };

  const combo = race?.umatan?.combination;
  if (combo != null && combo !== `${first}-${second}`) {
    return { counted: false, reason: EXCLUDE_REASON.PAYOUT_MISMATCH };
  }

  const hit = plan.combos.some((c) => c.first === first && c.second === second);
  const payout = hit ? Number(race?.umatan?.payout) || 0 : 0;
  return { counted: true, hit, points, investment: points * UNIT_PRICE_YEN, payout };
}

/**
 * 1 開催（archive の 1 エントリ）の成績。メインレースは会場ごとのレース数で判定する
 * （取込スクリプト・Premium 画面と同じ `isMainRace`）。
 * @param {object} entry
 * @param {{ venue?: string }} [o] 会場を指定すると、その会場のレースだけを数える（判定は開催全体の会場別レース数のまま）
 */
export function dayPerformance(entry, { venue } = {}) {
  const useCache = venue == null && entry && typeof entry === 'object';
  if (useCache && cache.has(entry)) return cache.get(entry);
  const races = Array.isArray(entry?.races) ? entry.races : [];
  const perVenue = {};
  for (const r of races) perVenue[r?.venue ?? ''] = (perVenue[r?.venue ?? ''] || 0) + 1;

  const acc = emptyAcc();
  for (const r of races) {
    if (venue != null && r?.venue !== venue) continue;
    const o = raceOutcome(r, { isMain: isMainRace(r?.raceNumber, perVenue[r?.venue ?? ''] || races.length) });
    addOutcome(acc, o);
  }
  acc.days = acc.races + acc.excluded > 0 ? 1 : 0;
  const out = finalize(acc);
  if (useCache) cache.set(entry, out);
  return out;
}

/** 会場を含む開催だけを選ぶ（レースの `venue` で判定）。 */
export function entriesWithVenue(entries, venue) {
  return (Array.isArray(entries) ? entries : []).filter(
    (e) => Array.isArray(e?.races) && e.races.some((r) => r?.venue === venue),
  );
}

/** 会場別の通算（その会場のレースだけを足してから割る）。 */
export function venueSummary(entries, venue) {
  const acc = emptyAcc();
  for (const e of entriesWithVenue(entries, venue)) {
    const d = dayPerformance(e, { venue });
    for (const k of ['days', 'races', 'hits', 'points', 'investment', 'payout', 'excluded']) acc[k] += d[k];
  }
  return finalize(acc);
}

/** 複数開催の合計（足してから割る）。 */
export function summarize(entries) {
  const acc = emptyAcc();
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || typeof e !== 'object') continue;
    const d = dayPerformance(e);
    acc.days += d.days;
    acc.races += d.races;
    acc.hits += d.hits;
    acc.points += d.points;
    acc.investment += d.investment;
    acc.payout += d.payout;
    acc.excluded += d.excluded;
  }
  return finalize(acc);
}

/** 南関・JRA の内訳と合算。 */
export function combinedSummary(nankanEntries, jraEntries) {
  const nankan = summarize(nankanEntries);
  const jra = summarize(jraEntries);
  const acc = emptyAcc();
  for (const s of [nankan, jra]) {
    for (const k of ['days', 'races', 'hits', 'points', 'investment', 'payout', 'excluded']) acc[k] += s[k];
  }
  return { nankan, jra, all: finalize(acc) };
}

/** `YYYY-MM` ごとの成績（新しい順）。 */
export function monthlySummaries(entries) {
  const groups = new Map();
  for (const e of Array.isArray(entries) ? entries : []) {
    const key = String(e?.date ?? '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, list]) => ({ key, year: key.slice(0, 4), month: key.slice(5, 7), entries: list, ...summarize(list) }));
}

/**
 * 成績を載せるページの注記（全ページ共通・文言をページごとに書かない）。
 * 🔴 基準を変えたらここと正本を同時に変える。
 */
export const BASIS_NOTE_LINES = Object.freeze([
  '※ 的中率・回収率は、買い目に表示した組み合わせ（抑えを除く）をすべて各100円で購入した場合の計算値です（回収率 = 払戻 ÷ 投資 × 100）。高配当も除外していません。',
  '※ 着順と馬単払戻の組み合わせが一致しないレースは、推測で補わず集計に含めていません。',
  '※ 実際の収支はお客様の購入点数・金額配分により異なります。過去の実績は将来の結果を保証するものではありません。馬券購入は自己責任でお願いいたします。',
]);

/** 収支の符号付き表示（+¥1,000 / −¥1,000）。 */
export function formatSignedYen(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  return `${v < 0 ? '−' : '+'}¥${Math.abs(v).toLocaleString('ja-JP')}`;
}

/** 表示用の丸め（小数第 1 位）。null は '—'。全ページ共通。 */
export function formatPercent(v) {
  return typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(1)}%` : '—';
}

export function formatYen(v) {
  return typeof v === 'number' && Number.isFinite(v) ? `¥${v.toLocaleString('ja-JP')}` : '—';
}

export function formatCount(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('ja-JP') : '—';
}

/* ---------- 内部 ---------- */

function emptyAcc() {
  return { days: 0, races: 0, hits: 0, points: 0, investment: 0, payout: 0, excluded: 0 };
}

function addOutcome(acc, o) {
  if (!o.counted) {
    acc.excluded += 1;
    return;
  }
  acc.races += 1;
  if (o.hit) acc.hits += 1;
  acc.points += o.points;
  acc.investment += o.investment;
  acc.payout += o.payout;
}

function finalize(acc) {
  return Object.freeze({
    basis: PERFORMANCE_BASIS,
    ...acc,
    profit: acc.payout - acc.investment,
    // 分母 0 は null（0% と誤解される値を作らない）
    hitRate: acc.races > 0 ? round1((acc.hits / acc.races) * 100) : null,
    returnRate: acc.investment > 0 ? round1((acc.payout / acc.investment) * 100) : null,
  });
}

function round1(x) {
  return Math.round(x * 10) / 10;
}
