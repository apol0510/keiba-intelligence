/**
 * bettingLineHorses.js — 買い目の文字列から馬番を取り出す（**表示専用**）
 *
 * 正本: docs/RENEWAL_2026_08.md §4.4
 *
 * 用途は「買い目に出てくる馬だけ出馬表に残す」抽出ボタン（有料 tier 限定）。
 *
 * 🔴 **的中判定には使わない。** 的中判定の単一源は `umatanHit.js` の `checkUmatanHit` であり、
 *    そちらは軸・本線相手・方向（F3）を厳密に扱う。本モジュールは
 *    **画面に印字されている馬番をそのまま拾うだけ**で、方向も点数も解釈しない。
 *    ここを的中判定へ流用すると、抑えを買ったことにする等の誤りが起きる。
 *
 * 対応する形式（既存 archive / 予想データに実在するもの）:
 *   "4-6.8.12.3.11.9"            … 軸 4、相手 6/8/12/3/11/9
 *   "4-6.8.12(抑え10.7.5)"        … 抑えも **画面に出ている**ので拾う
 *   "3-5.7.8.10.12"              … メインレース 10 点形式
 */

/** 軸だけを取り出す（1 行あたり 1 頭）。 */
export function parseAxisHorses(lines) {
  const out = new Set();
  for (const line of toLines(lines)) {
    const m = line.match(/^\s*(\d+)\s*-/);
    if (m) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n > 0) out.add(n);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * 買い目に出てくる馬番をすべて取り出す（軸・本線相手・抑え）。
 * 画面に印字されている馬番と一致させるため、抑えも含める。
 */
export function parseBettingHorses(lines) {
  const out = new Set();
  for (const line of toLines(lines)) {
    for (const m of line.matchAll(/\d+/g)) {
      const n = Number(m[0]);
      if (Number.isInteger(n) && n > 0 && n <= 18) out.add(n);
    }
  }
  return [...out].sort((a, b) => a - b);
}

function toLines(lines) {
  if (typeof lines === 'string') return [lines];
  if (!Array.isArray(lines)) return [];
  return lines.filter((l) => typeof l === 'string' && l.trim());
}
