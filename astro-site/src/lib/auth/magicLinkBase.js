/**
 * magicLinkBase.js — マジックリンクの送信先（origin）を決める
 *
 * 正本: docs/RENEWAL_2026_08.md §7（認証）
 *
 * 背景:
 *   `send-magic-link.js` は送信先を本番ドメインへ **ハードコード**していた。
 *   そのため Deploy Preview / ブランチデプロイでログインを試みても、
 *   メールのリンクは必ず本番へ飛び、**そのデプロイにはセッションが付かない**
 *   （Cookie はホストごとに分かれるため）。Test Mode の E2E がここで詰まる。
 *
 * 🔴 **この値はマジックリンク（＝ワンタイムのログイン token）の宛先である。**
 *    任意のホストを許すと、token を第三者のドメインへ送り出せてしまう。
 *    そのため **許可リストに載ったホストしか受け付けない**。
 *
 * 🔴 fail-closed:
 *    未設定 / 空 / 壊れた値 / 許可外ホスト / http（localhost を除く）/
 *    パスやクエリ付き → **すべて本番 URL へ倒す**。
 *    「production 以外へ勝手に倒す」ことは絶対にしない。
 *
 * 🔴 本関数は **認証の意味・有効期限・認可条件を一切変えない**。
 *    変えるのは「リンクをどのホストへ向けるか」だけ。
 */

/** 上書きが無いときの送信先（従来どおり）。 */
export const DEFAULT_MAGIC_LINK_BASE = 'https://keiba-intelligence.jp';

/** 上書きに使う環境変数名（🔴 値はログへ出さない）。 */
export const MAGIC_LINK_BASE_ENV = 'MAGIC_LINK_BASE_URL';

/**
 * 受け入れるホスト。
 *
 * - 本番と www
 * - Netlify の払い出しホスト（Deploy Preview / ブランチデプロイ）
 *   → `*.netlify.app` のみ。サブドメインの中身は Netlify が採番する
 * - ローカル開発
 */
function isAllowedHost(url) {
  const h = url.hostname.toLowerCase();

  if (h === 'keiba-intelligence.jp' || h === 'www.keiba-intelligence.jp') {
    return url.protocol === 'https:';
  }
  // Netlify のプレビュー / ブランチデプロイ
  if (h === 'netlify.app' || h.endsWith('.netlify.app')) {
    return url.protocol === 'https:';
  }
  // ローカル開発のみ http を許す
  if (h === 'localhost' || h === '127.0.0.1') {
    return url.protocol === 'http:' || url.protocol === 'https:';
  }
  return false;
}

/**
 * マジックリンクの origin を決める。
 *
 * @param {object} env 環境変数（`process.env` 等）
 * @returns {string} 末尾スラッシュ無しの origin。判断できなければ本番 URL
 */
export function resolveMagicLinkBase(env) {
  const raw = env && typeof env === 'object' ? env[MAGIC_LINK_BASE_ENV] : null;
  if (typeof raw !== 'string' || !raw.trim()) return DEFAULT_MAGIC_LINK_BASE;

  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return DEFAULT_MAGIC_LINK_BASE; // 🔴 壊れた値では本番へ倒す
  }

  // 🔴 origin だけを受け付ける。パス・クエリ・ハッシュ・認証情報が付いていたら拒否
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    return DEFAULT_MAGIC_LINK_BASE;
  }
  if (!isAllowedHost(url)) return DEFAULT_MAGIC_LINK_BASE;

  return url.origin;
}

/**
 * マジックリンクの URL を組み立てる。
 *
 * @param {string} token ワンタイム token
 * @param {object} env
 * @returns {string|null} token が無ければ null（リンクを作らない）
 */
export function buildMagicLinkUrl(token, env) {
  if (typeof token !== 'string' || !token.trim()) return null;
  return `${resolveMagicLinkBase(env)}/auth/verify?token=${encodeURIComponent(token.trim())}`;
}
