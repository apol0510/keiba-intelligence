/**
 * bettingPlan.js — 表示中の買い目を「実際に買う組み合わせ」へ展開する（**表示専用**）
 *
 * 正本: docs/RENEWAL_2026_08.md §4.4 / BET_POINT_LOGIC.md
 *
 * 用途は有料 tier の「買い目を抽出」パネル。
 * 買い目の文字列（例 `"4-6.8.12.3.11.9(抑え10.7.5)"`）を、
 * **馬単の組み合わせ・抑え・点数・購入額**へ分解して一目で読めるようにする。
 *
 * ── 展開ルール（BET_POINT_LOGIC.md「的中判定（F3 方向ルール）」と同一）──
 *
 *   | レース種別   | reverseTopK | 買い目 |
 *   |---|---|---|
 *   | メインレース | 0 | 本命軸 → 評価上位5頭の**一方向のみ**。逆方向なし |
 *   | 通常レース   | 3 | 各軸 → 相手全頭への前進 ＋ **評価上位1〜3位のみ**逆方向 |
 *
 *   - 買い目文字列の相手の並び順（左→右）＝ KI の評価順位。
 *   - 🔴 **抑え `(抑え...)` は買わない**（F3 では生成しない・候補外）。
 *     点数にも購入額にも含めない。画面には「参考」として別枠で出す。
 *   - 複数行が同じ組み合わせを生むことがあるため（軸を入れ替えた 2 行など）、
 *     **順序付きの組（1着→2着）で重複を除く**。
 *
 * 🔴 **的中判定には使わない。** 的中判定の単一源は `umatanHit.js` の `checkUmatanHit`。
 *    本モジュールは同じ方向ルールで「買う組み合わせを画面に並べる」だけで、
 *    結果との突き合わせは一切しない。
 *
 * ── 推奨購入点数（2026-08-30 仕様所有者の指示）──
 * 見出しに出す **点数と購入額だけ**を「推奨購入点数」にする。
 * 出走頭数に応じて決め、**12 点を超えない**（CLAUDE.md「ユーザーは10点超の買い目を嫌う」）。
 *
 * 🔴 **買い目そのものは減らさない。** 組み合わせは展開した全点を表示する。
 *    推奨点数は「このうち何点ぶん買うことを勧めるか」という目安であり、
 *    買い目を絞り込むためのものではない（2026-08-30 の指示で明確化）。
 *
 * 🔴 **点数の意味に注意（3 つある）。**
 *    1. **推奨購入点数** … 本モジュールが画面に出す数（頭数依存・最大 12）
 *    2. **展開した組の総数** … F3 で成立する組（通常レースは 16 点になることもある）
 *    3. **回収率の投資基準** … `archiveResults` が使う **全レース 5 点固定**
 *    3 は BET_POINT_LOGIC.md の仕様であり、1 とは別概念である。
 *    🔴 画面には **2 の組み合わせをすべて出し、見出しの点数だけ 1 を出す**。
 *       したがって「表示されている組の数」と「見出しの点数」は一致しないことがある。
 */

/** 1 点あたりの購入額（円）。BET_POINT_LOGIC.md「1 点 100 円」。 */
export const UNIT_PRICE_YEN = 100;

/** 逆方向を追加する相手の上限。メインは 0（一方向のみ）。 */
export const REVERSE_TOP_K_MAIN = 0;
export const REVERSE_TOP_K_NORMAL = 3;

/** 推奨購入点数の上限。**ここを 12 より大きくしない**。 */
export const MAX_RECOMMENDED_POINTS = 12;

/**
 * 出走頭数 → 推奨購入点数。
 * 頭数が増えるほど手広く、少頭数では絞る。上限は 12 点。
 */
export const RECOMMENDED_POINTS_BY_FIELD = Object.freeze([
  { maxField: 8, points: 6 },
  { maxField: 11, points: 8 },
  { maxField: 14, points: 10 },
  { maxField: Infinity, points: MAX_RECOMMENDED_POINTS },
]);

/**
 * 推奨購入点数を決める。
 * @param {number} fieldSize 出走頭数
 * @param {number} available 展開できた組の数（これを超えない）
 */
export function recommendedPoints(fieldSize, available) {
  const n = Number(fieldSize);
  const cap = Number.isFinite(Number(available)) ? Math.max(0, Number(available)) : 0;
  if (!Number.isFinite(n) || n <= 0) return Math.min(cap, MAX_RECOMMENDED_POINTS);
  const row = RECOMMENDED_POINTS_BY_FIELD.find((r) => n <= r.maxField);
  return Math.min(cap, row ? row.points : MAX_RECOMMENDED_POINTS, MAX_RECOMMENDED_POINTS);
}

/**
 * 1 行を軸・相手・抑えへ分解する。
 * @returns {{axis:number, partners:number[], hold:number[]}|null}
 */
export function parseBettingLine(line) {
  if (typeof line !== 'string') return null;
  const m = line.trim().match(/^(\d+)\s*-\s*(.+)$/);
  if (!m) return null;

  const axis = Number(m[1]);
  if (!isHorseNumber(axis)) return null;

  const rest = m[2];
  const holdMatch = rest.match(/[（(]\s*抑え\s*([^）)]*)[）)]/);
  const hold = holdMatch ? toNumbers(holdMatch[1]) : [];
  const partners = toNumbers(rest.replace(/[（(]\s*抑え[^）)]*[）)]/, ''))
    .filter((n) => n !== axis);

  if (!partners.length) return null;
  return { axis, partners, hold };
}

/**
 * 買い目一式を展開する。
 *
 * @param {string[]|string} lines
 * @param {object} [o]
 * @param {boolean} [o.isMain] メインレースか（`mainRaceBetting.isMainRace` の結果を渡す）
 * @param {number} [o.fieldSize] 出走頭数（推奨購入点数の算出に使う）
 * @param {string} [o.betType]
 */
export function buildBettingPlan(lines, { isMain = false, fieldSize = 0, betType = '馬単' } = {}) {
  const parsed = toLines(lines).map(parseBettingLine).filter(Boolean);
  const reverseTopK = isMain ? REVERSE_TOP_K_MAIN : REVERSE_TOP_K_NORMAL;

  /** 順序付きの組。'first-second' をキーに重複を除く。 */
  const seen = new Set();
  const combos = [];
  const push = (first, second) => {
    if (first === second) return;
    const key = `${first}-${second}`;
    if (seen.has(key)) return;
    seen.add(key);
    combos.push({ first, second });
  };

  for (const line of parsed) {
    // 前進: 軸が 1 着、相手が 2 着
    for (const p of line.partners) push(line.axis, p);
    // 逆方向: 評価上位 reverseTopK 頭のみ、相手が 1 着・軸が 2 着
    for (let i = 0; i < Math.min(reverseTopK, line.partners.length); i++) {
      push(line.partners[i], line.axis);
    }
  }

  // 抑えは買わない。全行をまとめて参考表示するだけ
  const hold = [...new Set(parsed.flatMap((l) => l.hold))].sort((a, b) => a - b);

  // 🔴 見出しに出す推奨購入点数。**combos は絞らない**（買い目を減らさない）
  const points = recommendedPoints(fieldSize, combos.length);

  return Object.freeze({
    betType,
    isMain,
    reverseTopK,
    // 軸ごとの内訳。🔴 相手は **馬番昇順**で見せる（評価順は画面に出さない）
    lines: parsed.map((l) => Object.freeze({
      axis: l.axis,
      partners: [...l.partners].sort((a, b) => a - b),
      hold: [...l.hold].sort((a, b) => a - b),
    })),
    // 🔴 展開した組の全体。**絞らずにすべて画面へ出す**
    combos,
    // 見出しに出す推奨購入点数（買い目の点数ではない）
    points,
    amountYen: points * UNIT_PRICE_YEN,
    // 展開した組の総数（＝ combos.length）
    expandedPoints: combos.length,
    hold,
    unitPriceYen: UNIT_PRICE_YEN,
  });
}

/* ---------- 内部 ---------- */

function isHorseNumber(n) {
  return Number.isInteger(n) && n >= 1 && n <= 18;
}

function toNumbers(s) {
  const out = [];
  for (const m of String(s ?? '').matchAll(/\d+/g)) {
    const n = Number(m[0]);
    if (isHorseNumber(n) && !out.includes(n)) out.push(n);
  }
  return out;
}

function toLines(lines) {
  if (typeof lines === 'string') return [lines];
  if (!Array.isArray(lines)) return [];
  return lines.filter((l) => typeof l === 'string' && l.trim());
}
