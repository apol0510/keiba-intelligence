/**
 * attentionMarks.js — 無料会員向けの「注目」印（序列を出さない印）
 *
 * 正本: docs/RENEWAL_2026_08.md §3 / §4
 *
 * ── 仕様（2026-08-29 確定）─────────────────────────────────────
 * 無料会員には **本命順位を推測できない印**だけを出す。
 *
 *   - ◎○▲△ のような **序列のある印を使わない**
 *   - **2〜5 頭**にだけ、**同一種類の印**（注目）を付ける
 *   - 出馬表は常に馬番昇順で並べるため、印の並び順からも序列は読めない
 *
 * 🔴 役割（本命 / 対抗 / 単穴 / 連下 …）そのものは画面に出さない。
 *    この関数が返すのは「注目に含まれる馬番の集合」だけであり、順序を持たない。
 *
 * 🔴 AI指数（pt）も無料会員には出さない。数値があれば順位が完全に復元できるため。
 *    数値の表示可否は呼び出し側（有料 tier のみ）で制御する。
 */

/** 注目の母集団とする役割（順序の意味は持たせない）。 */
export const ATTENTION_ROLES = Object.freeze(['本命', '対抗', '単穴', '連下最上位']);

export const ATTENTION_MIN = 2;
export const ATTENTION_MAX = 5;

/** 表示に使う単一の印。種類を増やすと序列に見えるため 1 種類だけ。 */
export const ATTENTION_MARK = '★';
export const ATTENTION_LABEL = '注目';

function ptOf(horse) {
  const v = horse?.pt;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * 注目印を付ける馬番の集合を返す。
 *
 * @param {Array} horses
 * @param {object} [o]
 * @param {number} [o.min=2]
 * @param {number} [o.max=5]
 * @returns {Set<number>} 馬番の集合（**順序を持たない**）
 */
export function attentionHorseNumbers(horses, { min = ATTENTION_MIN, max = ATTENTION_MAX } = {}) {
  const list = Array.isArray(horses) ? horses.filter((h) => h && h.horseNumber != null) : [];
  if (!list.length) return new Set();

  // 1) 役割が注目母集団に入る馬
  let picked = list.filter((h) => ATTENTION_ROLES.includes(h.role));

  // 2) 少なすぎる場合は pt の高い馬で補う（pt が無い馬は補充に使わない）
  if (picked.length < min) {
    const rest = list
      .filter((h) => !picked.includes(h) && ptOf(h) != null)
      .sort((a, b) => ptOf(b) - ptOf(a));
    for (const h of rest) {
      if (picked.length >= min) break;
      picked.push(h);
    }
  }

  // 3) 多すぎる場合は pt の高い順に上限まで絞る
  //    （集合として絞るだけで、画面には順序を出さない）
  if (picked.length > max) {
    picked = [...picked]
      .sort((a, b) => (ptOf(b) ?? -Infinity) - (ptOf(a) ?? -Infinity))
      .slice(0, max);
  }

  // 4) 出走頭数が少ないレースで全頭に印が付くのを避ける（印の意味が無くなるため）
  if (picked.length >= list.length && list.length > 0) {
    picked = [...picked]
      .sort((a, b) => (ptOf(b) ?? -Infinity) - (ptOf(a) ?? -Infinity))
      .slice(0, Math.max(0, list.length - 1));
  }

  return new Set(picked.map((h) => h.horseNumber));
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
