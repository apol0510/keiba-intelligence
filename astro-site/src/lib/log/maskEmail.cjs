/**
 * ログ用のメールアドレス マスク（KI 共通・唯一の正本）
 *
 * 🔴 会員のメールアドレスを Netlify Functions のログへ平文で出さない（2026-10-19 MK 指示）。
 *    ログに出すときは必ずこのモジュールを通す。
 *
 *    - maskEmail(email)      : 1 件のアドレスを `a***@example.com` 形式にする
 *                              （先頭 1 文字 + *** + @ドメイン。ドメインは障害切り分け用に残す）
 *    - redactEmails(value)   : 文字列・Error・オブジェクト中に埋め込まれたアドレスを
 *                              すべて maskEmail 形式へ置き換えた **文字列** を返す
 *                              （SendGrid / Airtable のエラー本文、Error.message / stack、
 *                               filterByFormula を含む URL 等）
 *
 * ⚠️ ログ出力専用。送信先・保存値・レスポンスには使わない（挙動を変えない）。
 *
 * 📌 CommonJS（.cjs）にしているのは、`exports.handler` 形式の関数（require）と
 *    ESM の関数・テスト（import）の両方から同じ実装を読むため。
 */

'use strict';

// ログ中のアドレス検出用（厳密な RFC 判定ではなく「漏らさない」側に倒した近似）
const EMAIL_IN_TEXT = /(?<!%[0-9A-Fa-f]?)[A-Za-z0-9._+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+/g;
// URL エンコードされたアドレス（@ → %40、+ → %2B。filterByFormula 入りの URL 等）。
// ローカル部に他の %XX を含めず、`%XX` の 16 進桁から始めないのは、
// `%22`（"）等の前置きをアドレスの一部と誤認しないため。
const EMAIL_IN_ENCODED_TEXT = /(?<!%[0-9A-Fa-f]?)(?:%2B|[A-Za-z0-9._\-])+%40[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+/gi;

/**
 * @param {unknown} email
 * @returns {string} `a***@example.com`。アドレスでない・空なら `(none)` / `***`
 */
function maskEmail(email) {
  if (email === null || email === undefined) return '(none)';
  const s = String(email).trim();
  if (!s) return '(none)';
  const at = s.lastIndexOf('@');
  if (at <= 0 || at === s.length - 1) return '***';
  const domain = s.slice(at + 1).toLowerCase();
  return `${s[0]}***@${domain}`;
}

function maskMatch(m, sep) {
  const at = m.toLowerCase().lastIndexOf(sep);
  return `${m[0]}***${sep}${m.slice(at + sep.length).toLowerCase()}`;
}

function redactString(s) {
  return s
    .replace(EMAIL_IN_ENCODED_TEXT, (m) => maskMatch(m, '%40'))
    .replace(EMAIL_IN_TEXT, (m) => maskMatch(m, '@'));
}

/**
 * @param {unknown} value 文字列 / Error / オブジェクト / その他
 * @returns {string} アドレスをマスクした文字列
 */
function redactEmails(value) {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'string') return redactString(value);
  if (value instanceof Error) {
    // stack は先頭に `Name: message` を含む。無ければ name / message から作る
    const text = value.stack || `${value.name || 'Error'}: ${value.message || ''}`;
    return redactString(String(text));
  }
  if (typeof value === 'object') {
    let text;
    try {
      text = JSON.stringify(value);
    } catch {
      text = Object.prototype.toString.call(value);
    }
    return redactString(String(text));
  }
  return redactString(String(value));
}

module.exports = { maskEmail, redactEmails };
