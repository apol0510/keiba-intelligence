/**
 * attentionMarks.js — 無料会員に見せる印（重複付与・ヒモは広め）
 *
 * 正本: docs/RENEWAL_2026_08.md §2 R-3
 *
 * ── 仕様（2026-08-29 確定）─────────────────────────────────────
 * 「印」は 1 列。**1 頭に複数の印**が付く（新聞で複数の記者印が並ぶのと同じ密度）。
 *
 *   ◎ … 3〜5 頭
 *   ○ … 3〜5 頭
 *   ▲ … 3〜5 頭
 *   △ … 約 10 頭（ヒモ。**買い目の相手 5〜6 頭より広く**取る）
 *   それ以外は空欄
 *
 * 評価順のバンドを重ねる。12 頭立ての例:
 *
 *   評価順  1    2     3     4     5     6   7   8   9   10  11〜
 *   ◎     ●    ●     ●     ●
 *   ○          ●     ●     ●     ●
 *   ▲                            ●     ●   ●   ●   ●
 *   △     ●    ●     ●     ●     ●     ●   ●   ●   ●   ●
 *   表示  ◎△  ◎○△  ◎○△  ◎○△  ○▲△  ▲△ ▲△ ▲△ ▲△  △  （空欄）
 *
 * ── 何を見せ、何を残すか ────────────────────────────────────
 * 馬単は **軸と相手の両方**がそろって初めて買える。
 *
 *   - **本命は分かってよい**（○ は評価順 2 位から始まるため、
 *     評価最上位だけが「◎ と △ のみ」という一意の組み合わせになる）。
 *   - 守るのは **相手が誰か**。KI の買い目の相手は 5〜6 頭
 *     （実データ 48 レースで確認）。△ を約 10 頭と広く取ることで、
 *     そこから正解の 5〜6 頭は絞り込めない。
 *
 * ── 🔴 決めごと ───────────────────────────────────────────────
 *  - **ランダム・ダミーを使わない。** 印は既存の KI 評価
 *    （役割の順序 → pt 降順 → 馬番昇順）から決定論的に算出する。
 *  - **役割語（本命 / 対抗 / …）は画面に出さない。** 返すのは印の文字だけ。
 *  - **必ず空欄の馬を残す**（全頭に印が付くと印の意味が消える）。
 *  - 画面の並びは常に馬番昇順（印の算出順とは別）。
 */

export const MARK_SYMBOLS = Object.freeze(['◎', '○', '▲', '△']);

/** ◎○▲ の頭数の目安。 */
export const MARK_COUNT_MIN = 3;
export const MARK_COUNT_MAX = 5;
/** △ の目安（買い目の相手 5〜6 頭より広く保つ）。 */
export const POOL_TARGET = 10;
export const POOL_MAX = 14;
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

function ptOf(horse) {
  const v = horse?.pt;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * KI 評価順に並べる（決定論的）。
 * 役割の順序 → pt 降順 → 馬番昇順。同じ入力からは常に同じ並び。
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
 * 🔴 ○ は必ず評価順 **2 位から**始まる。
 *    これにより評価最上位だけが「◎△」という一意の組み合わせになり、
 *    本命が分かる（2026-08-29 の仕様変更で「分かってよい」ことになった）。
 */
export function computeMarkBands(fieldSize) {
  const n = Number.isInteger(fieldSize) ? fieldSize : 0;
  if (n < 3) return { pool: 0, double: 0, circle: [0, 0], filled: [0, 0] };

  // △ の頭数。必ず空欄を残す。
  // 🔴 少頭数では「残せるだけ広く」取る（△ が狭いと相手を絞り込めてしまう）。
  const cap = Math.min(POOL_MAX, n - minBlankFor(n));
  const pool = n < SMALL_FIELD ? Math.max(3, cap) : clamp(Math.round(n * 0.8), 3, cap);
  if (pool < MARK_COUNT_MIN) return { pool, double: 0, circle: [0, 0], filled: [0, 0] };

  const double = Math.min(pool, clamp(Math.round(pool * 0.4), MARK_COUNT_MIN, MARK_COUNT_MAX));

  const circleCount = clamp(Math.round(pool * 0.4), MARK_COUNT_MIN, MARK_COUNT_MAX);
  const circleStart = 2;                                   // 🔴 必ず 2 位から
  const circleEnd = Math.min(pool, circleStart + circleCount - 1);

  const filledCount = clamp(Math.round(pool * 0.5), MARK_COUNT_MIN, MARK_COUNT_MAX);
  const filledStart = Math.min(pool, circleEnd);           // ○ の末尾と 1 頭重ねる
  const filledEnd = Math.min(pool, filledStart + filledCount - 1);

  return { pool, double, circle: [circleStart, circleEnd], filled: [filledStart, filledEnd] };
}

const inBand = (rank, [start, end]) => start > 0 && rank >= start && rank <= end;

/**
 * 馬番 → 印文字列（例: '◎△' / '◎○△' / '▲△' / ''）の Map を作る。
 */
export function assignFreeMarks(horses) {
  const ordered = evaluationOrder(horses);
  const bands = computeMarkBands(ordered.length);
  const out = new Map();

  ordered.forEach((horse, i) => {
    const rank = i + 1;
    let marks = '';
    if (bands.double > 0 && rank <= bands.double) marks += '◎';
    if (inBand(rank, bands.circle)) marks += '○';
    if (inBand(rank, bands.filled)) marks += '▲';
    if (bands.pool > 0 && rank <= bands.pool) marks += '△';
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
