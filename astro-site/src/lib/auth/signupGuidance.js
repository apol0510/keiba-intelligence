/**
 * signupGuidance.js — 無料会員登録の「確認メールを送った後」の案内
 *
 * 正本: docs/measurements/SIGNUP_COMPLETION_2026_10.md
 *
 * 背景（2026-10-20 の顧客集計・件数のみ）:
 *   顧客 186 件のうち 34 件が確認リンクを一度も開いていない（pending）。10 月の登録の約 4 割。
 *   登録画面は「✅ 登録完了メールを送信しました。メールをご確認ください。」の 1 行だけで、
 *   どのアドレスへ送ったか・迷惑メールフォルダ・有効期限・届かないときの再送が分からなかった。
 *
 * 🔴 新しいメールの種類は作らない。再送は既存の send-magic-link（ログインリンク）を本人が押したときだけ呼ぶ。
 * 🔴 有効期限（15 分）は send-magic-link / register-free の既存値。ここでは表示するだけで変えない。
 * 🔴 GA4 へは固定の列挙値（source=signup|login）だけを送る。email は送らない。
 */

/** マジックリンクに付ける「登録から来た」目印のクエリ名と値（固定）。 */
export const SIGNUP_SOURCE_PARAM = 'src';
export const SIGNUP_SOURCE = 'signup';

/** 再送ボタンを押した後、次に押せるまでの秒数（連打でメールが重ならないように）。 */
export const RESEND_COOLDOWN_SEC = 60;

/** 確認リンクの有効期限（分）。send-magic-link / register-free の既存値の表示用。 */
export const LINK_VALID_MINUTES = 15;

/**
 * 画面表示用に、本人のメールアドレスを一部伏せる。ドメインは誤入力に気づけるよう全部出す。
 * 例: "abcdef@example.jp" → "abc***@example.jp"、"ab@example.jp" → "a***@example.jp"
 * @param {unknown} email
 * @returns {string} 解釈できなければ空文字（呼び出し側は表示しない）
 */
export function maskEmailForDisplay(email) {
  if (typeof email !== 'string') return '';
  const s = email.trim();
  const at = s.lastIndexOf('@');
  if (at <= 0 || at === s.length - 1) return '';
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  const keep = local.length >= 6 ? 3 : 1;
  return `${local.slice(0, keep)}***@${domain}`;
}

/**
 * マジックリンクに付けるクエリ（登録から来たときだけ `&src=signup`）。それ以外の値は付けない。
 * @param {unknown} source
 */
export function signupSourceQuery(source) {
  return source === SIGNUP_SOURCE ? `&${SIGNUP_SOURCE_PARAM}=${SIGNUP_SOURCE}` : '';
}

/**
 * /auth/verify の URL クエリから GA4 用の列挙値を決める。`signup` 以外はすべて `login`。
 * @param {unknown} value `src` クエリの値
 * @returns {'signup' | 'login'}
 */
export function verifySourceOf(value) {
  return value === SIGNUP_SOURCE ? 'signup' : 'login';
}

/**
 * 再送（send-magic-link）の結果の表示文言。固定文字列で、入力値を含めない。
 * @param {number} status
 * @returns {{ok: boolean, message: string}}
 */
export function resendResultCopy(status) {
  if (status >= 200 && status < 300) {
    return { ok: true, message: '確認メールをもう一度送りました（件名「【KEIBA Intelligence】ログインリンク」）。いちばん新しいメールのリンクを開いてください。' };
  }
  if (status === 404 || status === 403) {
    return { ok: false, message: '再送できませんでした。お手数ですが、お問い合わせページからご連絡ください。' };
  }
  return { ok: false, message: '再送できませんでした。時間をおいてもう一度お試しください。' };
}
