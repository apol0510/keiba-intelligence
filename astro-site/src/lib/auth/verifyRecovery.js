/**
 * verifyRecovery.js — ログインリンクが使えなかったときの案内（/auth/verify）
 *
 * 正本: docs/measurements/LOGIN_RECOVERY_2026_10.md
 *
 * 背景（2026-10-19 の本番導線監査）:
 *   ログインリンクは 1 回だけ・15 分で無効になる。メールアプリ内のブラウザで開いたあと
 *   「Safari で開く」等で同じリンクをもう一度開くと、2 回目は必ず「使用済み」になる。
 *   以前の画面は「認証失敗」「トークンが…」「もう一度ログインしてください」だけで、
 *   - すでにログインできている端末でも失敗として止まっていた
 *   - 何が起きたのか・次に何をすればよいかが分からなかった
 *
 * 🔴 認証の意味（1 回だけ・15 分）は変えない。ここは表示と遷移の案内だけ。
 * 🔴 文言は固定文字列。URL・token・email を表示に使わない。
 */

/** in-app ブラウザで開いた人向けの共通の補足（使用済み・期限切れのとき）。 */
const BROWSER_HINT =
  'ログインは、リンクを開いたブラウザでだけ有効になります。メールアプリの中で開くと、'
  + 'いつものブラウザ（Safari・Chrome など）ではログインしていない状態になります。'
  + 'いつものブラウザで使う場合は、新しいリンクのメールでリンクを長押しし、ブラウザで開いてください。';

/**
 * verify の結果（`verifyResultOf` の列挙値）から表示文言を決める。
 * @param {string} result ok|expired|used|not_found|error
 * @returns {{title: string, message: string, hint?: string}}
 */
export function verifyFailureCopy(result) {
  switch (result) {
    case 'used':
      return {
        title: 'このリンクは使用済みです',
        message: 'ログインリンクは 1 回だけ使えます。下のボタンから新しいリンクを受け取ってください。',
        hint: BROWSER_HINT,
      };
    case 'expired':
      return {
        title: 'リンクの有効期限が切れています',
        message: 'ログインリンクの有効期限は送信から 15 分です。下のボタンから新しいリンクを受け取ってください。',
        hint: BROWSER_HINT,
      };
    case 'not_found':
      return {
        title: 'リンクを確認できませんでした',
        message: 'リンクが古いか、途中で切れている可能性があります。下のボタンから新しいリンクを受け取ってください。',
      };
    default:
      return {
        title: 'ログインできませんでした',
        message: '一時的なエラーの可能性があります。時間をおいて、新しいリンクを受け取ってください。',
      };
  }
}

/**
 * get-session の応答が「この端末はログイン済み」か。
 * 🔴 判定はサーバーが署名付き Cookie を検証した結果だけ（sessionStorage 等の自己申告は見ない）。
 * @param {number} status
 * @param {unknown} body
 */
export function isSignedInSession(status, body) {
  return status === 200 && !!body && typeof body === 'object' && body.authenticated === true;
}
