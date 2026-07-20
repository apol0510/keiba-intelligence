/**
 * computerIndexContract.js
 *
 * `computerIndex`（真コンピ指数）の契約。本リポジトリ内の唯一の判定点。
 *
 * ── 契約 ────────────────────────────────────────────────────────────
 * 有効値は **10–99 の整数**のみ。null / 空 / 1–9 / 100 以上 / 非整数 / 非数値は
 * **値なし**として扱い、正本値として使用しない。
 * 契約外の値を 0 / 10 / 50 等へ置換しない。推測補完もしない（fail-closed）。
 *
 * ── なぜ必要か ──────────────────────────────────────────────────────
 * shared の JRA racebook には、PDF 由来 XML の「人気指数」列が computerIndex として
 * 書き込まれていた期間がある。この列は埋め込みフォントの PUA 文字で描画されるため、
 * 生成側の PUA 除去で桁が落ち、1〜9 の残骸だけが真コンピ指数を騙って残っていた。
 *
 * 本リポジトリは analytics-keiba と違い `sourceComputerIndex` を持たず、
 * racebook の値を直接使うため、この偽値が
 *   - `normalizePrediction.js` の role/rawScore 判定
 *   - JRA 予想3画面の「総合pt」バッジ（`computerIndex + 10` を表示）
 * にそのまま入っていた（例: 1/4/8 → 総合pt 11/14/18）。
 *
 * 生成側の恒久対策は keiba-data-shared-admin 側で行われた（同 repo docs/decisions.md
 * 2026-07-20「computerIndex は真コンピ指数(10-99)だけを保持し、偽値を正本生成側で止める」）。
 * ただし **shared に既に保存済みの不良データ**と、本リポジトリに **既に取り込み済みの
 * データ**は残るため、consumer 側でも契約外値を有効値として扱わない防御が要る。
 *
 * 有効域 10–99 は新設値ではなく、既存契約に一致させたものである
 *   - keiba-data-shared-admin `netlify/lib/computer-index-contract.mjs`
 *   - keiba-data-shared-admin `scripts/validate-computer-racebook-join.mjs`
 *   - analytics-keiba の `>= 10` スケールガード
 *
 * ── 触ってはいけないこと ────────────────────────────────────────────
 * 有効域の拡大・0 補完の許可は、不要馬誤判定と誤った総合pt表示の再発に直結する。
 */

/** 真コンピ指数の下限（これ未満は別スケールの値とみなす） */
export const COMPUTER_INDEX_MIN = 10;
/** 真コンピ指数の上限 */
export const COMPUTER_INDEX_MAX = 99;

/**
 * 任意の入力を真コンピ指数へ正規化する。
 * 契約を満たさない場合は null（＝値なし）を返す。推測補完はしない。
 *
 * @param {unknown} raw
 * @returns {number|null} 10–99 の整数、または null
 */
export function toComputerIndex(raw) {
  if (raw == null) return null;
  if (typeof raw === 'boolean') return null;
  const s = String(raw).trim();
  if (s === '') return null;
  // 全角数字は半角へ寄せる（PDF 由来の表記ゆれ）
  const half = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  // 数字のみを受理する。小数・符号・単位付き・PUA 残骸混じりは受理しない。
  if (!/^\d{1,3}$/.test(half)) return null;
  const n = Number(half);
  if (!Number.isInteger(n)) return null;
  if (n < COMPUTER_INDEX_MIN || n > COMPUTER_INDEX_MAX) return null;
  return n;
}

/**
 * 真コンピ指数として有効か。
 * @param {unknown} raw
 * @returns {boolean}
 */
export function isValidComputerIndex(raw) {
  return toComputerIndex(raw) !== null;
}

/**
 * 契約を満たす値を **保存形式（文字列）** で返す。満たさなければ null。
 *
 * 取り込み結果 JSON の `computerIndex` は従来から文字列で保存されている。
 * 契約ゲートを通した結果として型が number へ変わると、既存データとの型不一致という
 * 別の非互換を作ってしまうため、取込境界ではこちらを使う（表示・判定側は数値の
 * `toComputerIndex` を使う）。
 *
 * @param {unknown} raw
 * @returns {string|null}
 */
export function toComputerIndexString(raw) {
  const n = toComputerIndex(raw);
  return n == null ? null : String(n);
}
