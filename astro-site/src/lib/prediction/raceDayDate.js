/**
 * raceDayDate.js — 開催日（`YYYY-MM-DD`）の表示用フォーマット
 *
 * 🔴 **timezone に依存させない。**
 *
 * 旧実装は `new Date(`${d}T00:00:00+09:00`).getDay()` だった。
 * `getDay()` は **実行環境のローカル時刻**で曜日を返すため、
 * Netlify（UTC）でビルドすると JST 0:00 = 前日 15:00 UTC になり、
 * **1 日前の曜日**が出る。
 *
 *   2026-09-04（金）→ UTC では 2026-09-03（木）と数えられ「木」と表示された
 *
 * `Date.UTC(y, m-1, d)` で作った時刻を `getUTCDay()` で読めば、
 * **暦日そのものから曜日を数える**ので、どの環境でも同じ結果になる。
 *
 * 🔴 ここに `getDay()` / `new Date(文字列)` を戻さないこと。
 *    `new Date('2026-09-04')` も UTC 解釈で、ローカルが西半球だと前日になる。
 */

const WEEKDAYS = Object.freeze(['日', '月', '火', '水', '木', '金', '土']);
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` を数値へ。形が違う・存在しない日付なら null。 */
function partsOf(d) {
  const m = typeof d === 'string' ? d.match(DATE_RE) : null;
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  const utc = new Date(Date.UTC(y, mo - 1, day));
  // 存在しない日付（2026-02-30 等）は別の日へ繰り上がるので弾く
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== mo - 1 || utc.getUTCDate() !== day) {
    return null;
  }
  return { y, mo, day, utc };
}

/**
 * 曜日（`日`〜`土`）を返す。判定できなければ空文字。
 * 🔴 実行環境の timezone に影響されない。
 */
export function weekdayOf(d) {
  const p = partsOf(d);
  return p ? (WEEKDAYS[p.utc.getUTCDay()] || '') : '';
}

/**
 * `9月4日(金)` の形にする。判定できなければ入力をそのまま返す
 * （表示を空にして日付を失わないため）。
 */
export function formatRaceDate(d) {
  const p = partsOf(d);
  if (!p) return typeof d === 'string' ? d : '';
  return `${p.mo}月${p.day}日(${weekdayOf(d)})`;
}
