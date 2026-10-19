/**
 * formula.js — Airtable の filterByFormula に値を埋め込むための共通部品
 *
 * 🔴 背景（2026-10-19・registry 5a5dd591）:
 *    `verify-magic-link` は URL の token を `{Token} = "<token>"` へそのまま埋め込んでいた。
 *    `send-magic-link` / `register-free` / `bank-transfer-application` も、リクエストの email を
 *    エスケープせずに式へ入れていた。`"` を含む値を送ると文字列リテラルを閉じて
 *    任意の式（`TRUE()` / `OR(...)` 等）を足せる＝別の顧客・別の token に一致させられる。
 *
 *    一部（stripe-webhook / refresh-session / start-purchase / airtableStore）は `"` だけを
 *    エスケープしていたが、`\` をエスケープしないと `\"` を送られたときに
 *    `\\"`（＝エスケープされた `\` ＋ 文字列の終端）となり、同じく式を閉じられる。
 *
 * 🔴 ルール: ユーザー由来・外部由来の値を式へ入れるときは **必ず** `escapeFormulaString` を通す。
 *    先に `\` を、次に `"` をエスケープする（順序を逆にすると `"` 用に足した `\` が二重になる）。
 *    エスケープ後の値は **必ず二重引用符の中**に置く（`{F} = "${escapeFormulaString(v)}"`）。
 *
 * ここでは「入力の形式検証」（email の形）も持つ。エスケープは最後の防御で、
 * 形式検証は「そもそも Airtable へ問い合わせない」ための前段である。両方を使う。
 */

/**
 * Airtable の式の文字列リテラル（二重引用符）に入れる値をエスケープする。
 * null / undefined は空文字として扱う（式を壊さない）。
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeFormulaString(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** RFC 5321 のアドレス長上限。 */
export const EMAIL_MAX_LENGTH = 254;

/**
 * WHATWG（`<input type="email">`）と同じ local-part の文字集合に、ドメインに 1 つ以上の `.` を要求する。
 * `"` `\` 空白・制御文字・`(` `)` `,` `;` `<` `>` は local-part に入らない。
 */
const EMAIL_RE =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/**
 * email の形式検証。前後の空白は許さない（ブラウザの type="email" は送信前に除去する）。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidEmail(value) {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > EMAIL_MAX_LENGTH) return false;
  return EMAIL_RE.test(value);
}
