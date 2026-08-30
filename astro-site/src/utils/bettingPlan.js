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
 * 🔴 **点数の意味に注意。** ここで数える点数は **表示した買い目の実点数**であり、
 *    `archiveResults` の回収率が使う投資基準（**全レース 5 点固定**）とは
 *    **別概念**である（BET_POINT_LOGIC.md の「出力フィールド」注記を参照）。
 *    画面でもその旨を添えること。
 */

/** 1 点あたりの購入額（円）。BET_POINT_LOGIC.md「1 点 100 円」。 */
export const UNIT_PRICE_YEN = 100;

/** 逆方向を追加する相手の上限。メインは 0（一方向のみ）。 */
export const REVERSE_TOP_K_MAIN = 0;
export const REVERSE_TOP_K_NORMAL = 3;

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
 * @param {string} [o.betType]
 */
export function buildBettingPlan(lines, { isMain = false, betType = '馬単' } = {}) {
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

  return Object.freeze({
    betType,
    isMain,
    reverseTopK,
    lines: parsed,
    combos,
    points: combos.length,
    amountYen: combos.length * UNIT_PRICE_YEN,
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
