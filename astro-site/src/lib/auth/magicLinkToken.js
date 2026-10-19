/**
 * magicLinkToken.js — マジックリンク token の形式検証
 *
 * 🔴 `verify-magic-link` は token を Airtable へ問い合わせる **前に** ここで検証し、
 *    形式が違えば 400 を返して問い合わせない（registry 5a5dd591・式インジェクション対策）。
 *
 * 受け付ける形式は、token を発行している 2 経路が実際に作るものだけ:
 *   1. `send-magic-link` … `uuid` の v4（小文字 16 進・ハイフン区切り 36 文字）
 *   2. `register-free`   … `Math.random().toString(36).substring(2, 15)` × 2 の連結
 *                          （小文字英数字・最大 26 文字。乱数次第で短くなりうるので下限は 1）
 *
 * 🔴 発行側の形式を変えたら、ここと test（magicLinkToken.test.mjs）を同時に変えること。
 *    ここで落ちると正規のリンクでもログインできなくなる。
 */

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REGISTER_FREE_TOKEN_RE = /^[0-9a-z]{1,26}$/;

/**
 * @param {unknown} token
 * @returns {boolean}
 */
export function isValidMagicLinkToken(token) {
  if (typeof token !== 'string') return false;
  return UUID_V4_RE.test(token) || REGISTER_FREE_TOKEN_RE.test(token);
}
