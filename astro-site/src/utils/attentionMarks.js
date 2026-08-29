/**
 * attentionMarks.js — 無料会員向けの印（範囲を広げ、本命を一意に特定させない）
 *
 * 正本: docs/RENEWAL_2026_08.md §3 / §4
 *
 * ── 仕様（2026-08-29 改訂）─────────────────────────────────────
 * 「印」は **1 列だけ**。1 頭に **複数の印を重複して付ける**。
 *
 *   ◎ … 3〜5 頭
 *   ○ … 3〜5 頭
 *   ▲ … 3〜5 頭
 *   △ … 約 10 頭
 *   それ以外の馬は **空欄**
 *
 * 各印の範囲は KI 評価順の帯（バンド）として重なり合う。
 * 例（△=10 頭のレース）:
 *
 *   評価順  1   2   3   4   5   6   7   8   9  10  11〜
 *   ◎     ●   ●   ●   ●
 *   ○             ●   ●   ●   ●
 *   ▲                     ●   ●   ●   ●   ●
 *   △     ●   ●   ●   ●   ●   ●   ●   ●   ●   ●
 *   表示  ◎△ ◎△ ◎○△ ◎○△ ○△ ○▲△ ▲△ ▲△ ▲△ ▲△ （空欄）
 *
 * 🔴 **最上位の 2 頭は必ず同じ印の組み合わせになる**（◎ は 3 頭以上、
 *    ○ と ▲ は評価順 3 位以降から始まるため）。
 *    したがって印の組み合わせから **本命を一意に特定できない**。
 *
 * 🔴 **ランダム・ダミーを使わない。** 印は既存の KI 評価
 *    （役割の順序 → pt 降順 → 馬番昇順）から決定論的に算出する。
 *    同じ入力からは常に同じ印になる。
 *
 * 🔴 役割語（本命 / 対抗 / …）そのものは画面に出さない。
 *    本モジュールが返すのは印の文字列だけであり、役割名を含まない。
 */

/** 表示に使う印。この順序は **表示順**であり、評価順の情報ではない。 */
export const MARK_SYMBOLS = Object.freeze(['◎', '○', '▲', '△']);

/** 各印の頭数の目安。 */
export const MARK_COUNT_MIN = 3;
export const MARK_COUNT_MAX = 5;
export const TRIANGLE_TARGET = 10;

/** KI 評価の順序（役割 → pt → 馬番）。**画面には出さない**。 */
const ROLE_ORDER = Object.freeze({
  本命: 1, 対抗: 2, 単穴: 3, 連下最上位: 4, 連下: 5, 補欠: 6, 無: 7,
});

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function ptOf(horse) {
  const v = horse?.pt;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * KI 評価順に並べる（決定論的）。
 * 役割の順序 → pt 降順 → 馬番昇順。同じ入力からは常に同じ並び。
 *
 * 🔴 この並びは **印の算出にだけ使う**。画面の並びは常に馬番昇順。
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
 * 出走頭数から各印のバンド（評価順の範囲・1 始まり・両端含む）を決める。
 *
 * 🔴 ○ と ▲ の開始位置は **必ず 3 位以降**。◎ は 3 頭以上。
 *    これにより評価順 1 位と 2 位の印が必ず一致し、本命を特定できない。
 *
 * @param {number} fieldSize 出走頭数
 */
export function computeMarkBands(fieldSize) {
  const n = Number.isInteger(fieldSize) ? fieldSize : 0;
  if (n <= 0) return { triangleEnd: 0, doubleEnd: 0, circle: [0, 0], filled: [0, 0] };

  // △ の頭数。空欄の馬を必ず残す（印の意味が消えるため）。
  const d = n <= 3 ? Math.max(0, n - 1) : Math.min(TRIANGLE_TARGET, n - 2);
  if (d < MARK_COUNT_MIN) {
    // 極小頭数では △ のみ（バンドを作れない）
    return { triangleEnd: d, doubleEnd: 0, circle: [0, 0], filled: [0, 0] };
  }

  const doubleEnd = Math.min(d, clamp(Math.round(d * 0.4), MARK_COUNT_MIN, MARK_COUNT_MAX));
  const circleCount = clamp(Math.round(d * 0.4), MARK_COUNT_MIN, MARK_COUNT_MAX);
  const circleStart = 3;                                   // 🔴 必ず 3 位以降
  const circleEnd = Math.min(d, circleStart + circleCount - 1);

  const filledCount = clamp(Math.round(d * 0.5), MARK_COUNT_MIN, MARK_COUNT_MAX);
  const filledEnd = d;
  const filledStart = Math.max(3, filledEnd - filledCount + 1); // 🔴 必ず 3 位以降

  return {
    triangleEnd: d,
    doubleEnd,
    circle: [circleStart, circleEnd],
    filled: [filledStart, filledEnd],
  };
}

const inBand = (rank, [start, end]) => start > 0 && rank >= start && rank <= end;

/**
 * 馬番 → 印文字列（例: '◎△' / '○▲△' / ''）の Map を作る。
 *
 * @param {Array} horses
 * @returns {Map<number, string>}
 */
export function assignFreeMarks(horses) {
  const ordered = evaluationOrder(horses);
  const bands = computeMarkBands(ordered.length);
  const out = new Map();

  ordered.forEach((horse, i) => {
    const rank = i + 1;
    let marks = '';
    if (bands.doubleEnd > 0 && rank <= bands.doubleEnd) marks += '◎';
    if (inBand(rank, bands.circle)) marks += '○';
    if (inBand(rank, bands.filled)) marks += '▲';
    if (bands.triangleEnd > 0 && rank <= bands.triangleEnd) marks += '△';
    out.set(horse.horseNumber, marks);
  });

  return out;
}

/** 印ごとの頭数（検証・テスト用）。 */
export function markCounts(horses) {
  const marks = [...assignFreeMarks(horses).values()];
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
