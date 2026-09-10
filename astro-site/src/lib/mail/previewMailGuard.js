/**
 * previewMailGuard.js — 本番以外のホストから**メールを送らせない**（純関数）
 *
 * 正本: `docs/decisions.md`（2026-09-11「プレビュー環境からのメール送信を止める」）
 *
 * 背景（2026-09-10 に実際に起きた）:
 *   Stripe Test Mode の QA を branch deploy で行っていたとき、QA の画面から
 *   マジックリンクを要求したら **production の SendGrid アカウントで実際にメールが飛んだ**。
 *   `SENDGRID_API_KEY` は `all` スコープで、branch deploy にも production の値が入るため。
 *   宛先は受信できない QA 用アドレスだったので、**バウンスが本番の送信者評価に付いた**。
 *
 * 🔴 これは「production 完全隔離」と矛盾する。
 *    env をコンテキスト別へ割るより、**コードで塞ぐほうが安全**:
 *      - `AIRTABLE_*` と同じ危険な env 変換をしなくて済む
 *      - Deploy Preview / ブランチデプロイ / localhost を**まとめて**塞げる
 *      - テストで固定できる
 *
 * 🔴 判定は `previewMode.js` の `isPreviewHost()` に一本化する。
 *    本番ホスト（`keiba-intelligence.jp` / `www.`）では **常に false**＝送信は従来どおり。
 *    ホストが読めないときも false（＝止めない）。本番のメールを誤って止めないため。
 */

import { isPreviewHost } from '../auth/previewMode.js';

/** ブロックしたときに返す本文（呼び出し側で JSON.stringify する）。 */
export const PREVIEW_MAIL_BLOCKED = Object.freeze({
  error: 'mail_disabled_on_preview',
  message: 'この環境（プレビュー / QA）からはメールを送信できません。本番サイトからお試しください。',
});

/** ブロック時の HTTP ステータス。 */
export const PREVIEW_MAIL_BLOCKED_STATUS = 503;

/**
 * このリクエストからのメール送信を止めるべきか。
 *
 * @param {object} headers  Netlify Functions の `event.headers`
 * @returns {boolean} true なら **送信も、送信に付随する書き込みも行わない**
 */
export function isMailSendBlocked(headers) {
  const h = headers || {};
  return isPreviewHost(h.host || h.Host || '');
}
