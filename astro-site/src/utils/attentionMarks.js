/**
 * attentionMarks.js — 無料会員に見せる印（指数ベースの総合印）
 *
 * 正本: docs/RENEWAL_2026_08.md §2 R-3
 *
 * ── 考え方（2026-08-29 確定）─────────────────────────────────
 * 競馬新聞の「総合印」と同じ作り方をする。
 * 新聞は **記者ごとに ◎○▲△ を出し、それを 1 列に並べる**。
 * KI には記者がいない代わりに **指数がある**ので、
 * **指数 1 本を記者 1 人に見立てて** ◎○▲△ を出させ、合算する。
 *
 *   総合指数   … 1位◎ 2位○ 3位▲ 4〜7位△
 *   基礎指数   … 1位◎ 2位○ 3位▲ 4〜7位△
 *   調子指数   … 1位◎ 2位○ 3位▲ 4〜7位△
 *   スピード指数 … 1位◎ 2位○ 3位▲ 4〜7位△
 *   距離適性   … 1位◎ 2位○ 3位▲ 4〜7位△
 *   ────────────────────────
 *   合算 → 1 頭の印は '◎◎○▲' のように **同じ記号が重なる**
 *
 * 12 頭立て・5 軸の例（馬番順）:
 *
 *    馬番  印
 *     1    △
 *     2    ◎◎○▲
 *     3    ○○△
 *     4    ◎◎◎○
 *     5    △
 *     6    ◎○▲▲
 *     7   （空欄）
 *     8    ▲△
 *     9    ○▲△
 *    10    △
 *    11    △
 *    12   （空欄）
 *
 * 🔴 **1 頭だけを特別扱いする処理は入れない。**
 *    印の多さは「複数の指数が一致したか」の結果であって、
 *    順位から機械的に足したものではない。
 *    （2026-08-29 以前は最上位 1 頭に印を足していた。これは誤り。）
 *
 * ── 何を見せ、何を残すか ────────────────────────────────────
 * 馬単は **軸と相手の両方**がそろって初めて買える。
 *   - **本命は分かってよい**（指数が一致すれば自然に印が集まる）。
 *   - 守るのは **相手が誰か**。KI の買い目の相手は 5〜6 頭なので、
 *     △ を合計 10 頭前後に広く取り、そこから 5〜6 頭を絞れないようにする。
 *
 * ── 🔴 決めごと ───────────────────────────────────────────────
 *  - **ランダム・ダミーを使わない。** すべて実在の指数から決定論的に決まる。
 *  - **データが無い軸は使わない。** 値を捏造して軸を水増ししない。
 *    軸が減れば印も減る（JRA は上がり 3F 等が無いため軸が少なくなる）。
 *  - **役割語（本命 / 対抗 / …）は画面に出さない。** 返すのは印の文字だけ。
 *  - **必ず空欄の馬を残す**（全頭に印が付くと印の意味が消える）。
 *  - 画面の並びは常に馬番昇順（印の算出順とは別）。
 */

import { toComputerIndex } from './computerIndexContract.js';
import {
  calcFormTrend, calcSpeedIndex, calcStaminaRating,
  calcTrackCompatibility, calcDistanceFitness,
} from './featureScores.js';

export const MARK_SYMBOLS = Object.freeze(['◎', '○', '▲', '△']);

/** 1 軸が出す印。新聞の記者 1 人分に相当する。 */
const AXIS_MARKS = Object.freeze(['◎', '○', '▲']);

/** 使う軸の上限。◎ が 5 個を超えないようにするため。 */
export const MAX_AXES = 5;
/** 軸として採用する最低サンプル数（実データを持つ頭数）。 */
export const MIN_AXIS_SAMPLES = 3;

/** △ の総数の目安（合算後）。 */
export const POOL_TARGET = 10;
export const POOL_MAX = 14;

/**
 * 1 軸が △ を出す頭数（4 位から数えて何頭か）。
 *
 * 🔴 **4 で固定する。軸の本数でも頭数でも変えない。**
 *    南関 12 レースの実データで、△ の集合と買い目の相手の集合を突き合わせた結果:
 *
 *      △/軸 | 集合が完全一致したレース | 最大一致度
 *      -----|--------------------------|-----------
 *        2  | 0 / 12                   | 86%
 *        3  | **1 / 12（漏洩）**       | **100%**
 *        4  | 0 / 12                   | 78%
 *        5  | 0 / 12                   | 78%
 *
 *    3 では △ がそのまま買い目の相手リストになるレースが出た。
 *    5 以上にすると印の付いた馬がほぼ全頭 5 個ずつになり、
 *    「△△△△△」ばかりで印の意味が消える。4 が両方を満たす。
 */
export const DOWN_PER_AXIS = 4;

/**
 * 必ず残す空欄の頭数。
 * 🔴 少頭数（12 頭未満）では 1 頭に減らす。
 *    空欄を 2 頭残すと △ が狭くなり、買い目の相手（5〜6 頭）を
 *    絞り込めてしまうため（8 頭立てで実際に発生した）。
 */
export const MIN_BLANK_LARGE = 2;
export const MIN_BLANK_SMALL = 1;
export const SMALL_FIELD = 12;

export function minBlankFor(fieldSize) {
  return fieldSize >= SMALL_FIELD ? MIN_BLANK_LARGE : MIN_BLANK_SMALL;
}

/** KI 評価の順序（役割 → pt → 馬番）。**画面には出さない**。 */
const ROLE_ORDER = Object.freeze({
  本命: 1, 対抗: 2, 単穴: 3, 連下最上位: 4, 連下: 5, 補欠: 6, 無: 7,
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function ptOf(horse) {
  return num(horse?.pt);
}

/**
 * KI 評価順に並べる（決定論的）。
 * 役割の順序 → pt 降順 → 馬番昇順。同じ入力からは常に同じ並び。
 * 🔴 これは **同点のときの並び順を決めるためだけ**に使う。
 *    印そのものはここから作らない（指数から作る）。
 */
export function evaluationOrder(horses) {
  const list = Array.isArray(horses) ? horses.filter((h) => h && h.horseNumber != null) : [];
  return [...list].sort((a, b) => {
    const ra = ROLE_ORDER[a?.role] ?? 99;
    const rb = ROLE_ORDER[b?.role] ?? 99;
    if (ra !== rb) return ra - rb;
    const pa = ptOf(a);
    const pb = ptOf(b);
    if (pa != null && pb != null && pa !== pb) return pb - pa;
    if (pa == null && pb != null) return 1;
    if (pa != null && pb == null) return -1;
    return Number(a.horseNumber) - Number(b.horseNumber);
  });
}

/**
 * 印を付ける候補（プール）の頭数。
 * 🔴 必ず空欄を残す。少頭数では「残せるだけ広く」取る。
 */
export function poolSizeFor(fieldSize) {
  const n = Number.isInteger(fieldSize) ? fieldSize : 0;
  if (n < 3) return 0;
  const cap = Math.min(POOL_MAX, n - minBlankFor(n));
  return n < SMALL_FIELD ? Math.max(3, cap) : clamp(Math.round(n * 0.8), 3, cap);
}

/* ============================================================
   評価軸（＝新聞の記者）の定義
   ============================================================ */

const hasRank = (races) => races.some((r) => num(r?.rank) != null);
const hasLast3f = (races) => races.some((r) => num(r?.last3f) != null && r.last3f > 0);
const hasDistance = (races) => races.some((r) => num(r?.distanceMeters) != null && r.distanceMeters > 0);
const hasVenue = (races) => races.some((r) => typeof r?.venue === 'string' && r.venue.trim());
const hasPace = (races) => races.some((r) => (typeof r?.paceType === 'string' && r.paceType.trim()) || (num(r?.last3f) != null && r.last3f > 0));

/**
 * 軸の一覧。**優先順**に並べる（上から使える分だけ最大 MAX_AXES 本）。
 * `value` は「高いほど強い」で統一する。
 * `has` は **その馬に実データがあるか**。無ければその軸では評価しない。
 */
export const AXES = Object.freeze([
  {
    key: 'total', label: '総合指数',
    has: (h) => ptOf(h) != null,
    value: (h) => ptOf(h),
  },
  {
    key: 'base', label: '基礎指数',
    has: (h) => toComputerIndex(h?.computerIndex) != null,
    value: (h) => toComputerIndex(h?.computerIndex),
  },
  {
    key: 'form', label: '調子指数',
    has: (_h, races) => hasRank(races),
    value: (_h, races) => calcFormTrend(races),
  },
  {
    key: 'speed', label: 'スピード指数',
    has: (_h, races) => hasLast3f(races),
    value: (_h, races) => calcSpeedIndex(races),
  },
  {
    key: 'distance', label: '距離適性',
    has: (_h, races, info) => num(info?.distance) != null && info.distance > 0 && hasDistance(races),
    value: (_h, races, info) => calcDistanceFitness(races, info?.distance),
  },
  {
    key: 'track', label: 'コース適性',
    has: (_h, races, info) => !!info?.venue && hasVenue(races),
    value: (_h, races, info) => calcTrackCompatibility(races, info?.venue),
  },
  {
    key: 'stamina', label: 'スタミナ指数',
    has: (_h, races) => hasPace(races),
    value: (_h, races) => calcStaminaRating(races),
  },
]);

/** レース情報を正規化する（距離は数値、会場は文字列）。 */
function normalizeRaceInfo(info) {
  const d = num(info?.distance) ?? num(info?.distanceMeters) ?? num(Number(info?.distance));
  return {
    venue: typeof info?.venue === 'string' && info.venue.trim() ? info.venue.trim() : null,
    distance: d != null && d > 0 ? d : null,
  };
}

/**
 * このレースで実際に使える軸を決める。
 *
 * 採用条件:
 *   1. プール内で **実データを持つ馬が MIN_AXIS_SAMPLES 頭以上**
 *   2. その値が **全頭同じではない**（同じなら順位が付かず、軸として無意味）
 *
 * @returns {Array<{key:string,label:string,values:Map<number,number>}>}
 */
export function availableAxes(pool, pastRacesOf, raceInfo) {
  const info = normalizeRaceInfo(raceInfo);
  const out = [];

  for (const axis of AXES) {
    if (out.length >= MAX_AXES) break;

    const values = new Map();
    for (const h of pool) {
      const races = pastRacesOf ? (pastRacesOf(h) || []) : [];
      if (!axis.has(h, races, info)) continue;
      const v = num(axis.value(h, races, info));
      if (v == null) continue;
      values.set(h.horseNumber, v);
    }

    if (values.size < MIN_AXIS_SAMPLES) continue;
    const distinct = new Set(values.values());
    if (distinct.size < 2) continue; // 全頭同じ値 = 順位が付かない

    out.push({ key: axis.key, label: axis.label, values });
  }

  return out;
}

/**
 * 1 軸あたりの △ の頭数。プールに収まらない分だけ削る。
 * 🔴 軸の本数では変えない（`DOWN_PER_AXIS` の根拠を参照）。
 */
export function downPerAxis(poolSize) {
  const n = Number.isInteger(poolSize) ? poolSize : 0;
  return clamp(n - AXIS_MARKS.length, 0, DOWN_PER_AXIS);
}

/**
 * 馬番 → 印文字列（例: '◎◎○▲' / '▲△' / ''）の Map を作る。
 *
 * @param {any[]} horses
 * @param {object} [opts]
 * @param {(h:any)=>any[]} [opts.pastRacesOf] 正規化済み過去走を返す関数
 * @param {object} [opts.raceInfo] `{ venue, distance }`
 */
export function assignFreeMarks(horses, opts = {}) {
  const { pastRacesOf, raceInfo } = opts;

  const ordered = evaluationOrder(horses);
  const out = new Map();
  for (const h of ordered) out.set(h.horseNumber, '');

  const pool = ordered.slice(0, poolSizeFor(ordered.length));
  if (!pool.length) return out;

  const axes = availableAxes(pool, pastRacesOf, raceInfo);
  if (!axes.length) return out;

  // 同点のときの並び順（評価順）。決定論的にするため。
  const tieBreak = new Map(ordered.map((h, i) => [h.horseNumber, i]));
  const downCount = downPerAxis(pool.length);

  // 馬番 → 記号ごとの個数
  const tally = new Map(pool.map((h) => [h.horseNumber, new Map()]));
  const bump = (no, sym) => {
    const t = tally.get(no);
    if (t) t.set(sym, (t.get(sym) || 0) + 1);
  };

  for (const axis of axes) {
    const ranked = [...axis.values.entries()]
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return (tieBreak.get(a[0]) ?? 99) - (tieBreak.get(b[0]) ?? 99);
      })
      .map(([no]) => no);

    AXIS_MARKS.forEach((sym, i) => {
      if (ranked[i] != null) bump(ranked[i], sym);
    });
    for (let i = 0; i < downCount; i++) {
      const no = ranked[AXIS_MARKS.length + i];
      if (no != null) bump(no, '△');
    }
  }

  // 記号は ◎ → ○ → ▲ → △ の順に並べる（同じ記号は連続させる）
  for (const [no, t] of tally) {
    let s = '';
    for (const sym of MARK_SYMBOLS) s += sym.repeat(t.get(sym) || 0);
    out.set(no, s);
  }

  return out;
}

/** 印ごとの頭数（検証・テスト用）。同じ記号が重なっても 1 頭と数える。 */
export function markCounts(horses, opts) {
  const marks = [...assignFreeMarks(horses, opts).values()];
  const counts = {};
  for (const s of MARK_SYMBOLS) counts[s] = marks.filter((m) => m.includes(s)).length;
  counts.blank = marks.filter((m) => m === '').length;
  return counts;
}

/** 出馬表の並び順。**常に馬番昇順**（評価順に並べ替えない）。 */
export function sortByHorseNumber(horses) {
  return [...(Array.isArray(horses) ? horses : [])]
    .sort((a, b) => {
      const x = Number(a?.horseNumber);
      const y = Number(b?.horseNumber);
      if (!Number.isFinite(x) && !Number.isFinite(y)) return 0;
      if (!Number.isFinite(x)) return 1;
      if (!Number.isFinite(y)) return -1;
      return x - y;
    });
}
