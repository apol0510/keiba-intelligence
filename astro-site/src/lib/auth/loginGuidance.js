/**
 * loginGuidance.js — /login でログインリンクを送れなかったときの案内
 *
 * 正本: docs/measurements/LOGIN_GUIDANCE_2026_10.md
 *
 * 背景（2026-10-19 の本番導線監査）:
 *   未登録のアドレスを入れると「アカウントが見つかりません。料金プランからご登録ください。」と出て、
 *   無料で始められる人を有料プランのページへ案内していた（ログイン画面下の案内も同じ）。
 *
 * 🔴 応答の意味（404 = 未登録・403 = 停止中）は変えない。表示だけを決める。
 * 🔴 文言は固定文字列。入力された email を表示に使わない。
 */

/**
 * @param {number} status send-magic-link の HTTP 状態
 * @returns {{message: string, register: boolean}} register=true なら無料会員登録への導線を出す
 */
export function loginFailureCopy(status) {
  if (status === 404) {
    return {
      message: 'このメールアドレスは登録されていません。入力に誤りがないかご確認ください。はじめての方は無料会員登録から始められます。',
      register: true,
    };
  }
  if (status === 403) {
    return {
      message: 'このアカウントではログインできません。お問い合わせページからご連絡ください。',
      register: false,
    };
  }
  return { message: 'エラーが発生しました。時間をおいてもう一度お試しください。', register: false };
}
