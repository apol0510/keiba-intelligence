/**
 * siteOrigin.js — 「このデプロイの公開 origin」を決める（共有ポリシー）
 *
 * 背景:
 *   Netlify Functions は自分の公開 URL を知らないため、`success_url` /
 *   `cancel_url` / `return_url` はリクエストの `Origin` / `Host` から復元する。
 *   従来の許可リストは本番と `keiba-intelligence.netlify.app` だけで、
 *   **ブランチデプロイ / Deploy Preview からの Checkout が本番へ戻されていた**。
 *
 * 🔴 リダイレクト先になる値なので、**許可リストのホストしか受け付けない**。
 *    任意の Origin を信じると、決済後の戻り先を第三者サイトへ向けられる。
 *
 * 🔴 判断できないときは **本番へ倒す**（fail-closed）。
 *    `magicLinkBase.js` と同じホスト方針をここへ一本化してある。
 */

/** 判断できないときの既定（従来どおり）。 */
export const DEFAULT_SITE_ORIGIN = 'https://keiba-intelligence.jp';

/**
 * 受け入れるホストか。
 * - 本番 / www … https のみ
 * - `*.netlify.app`（ブランチデプロイ・Deploy Preview）… https のみ
 * - localhost / 127.0.0.1 … http も可（ローカル開発）
 */
export function isAllowedSiteHost(url) {
  if (!url || typeof url.hostname !== 'string') return false;
  const h = url.hostname.toLowerCase();

  if (h === 'keiba-intelligence.jp' || h === 'www.keiba-intelligence.jp') {
    return url.protocol === 'https:';
  }
  if (h === 'netlify.app' || h.endsWith('.netlify.app')) {
    return url.protocol === 'https:';
  }
  if (h === 'localhost' || h === '127.0.0.1') {
    return url.protocol === 'http:' || url.protocol === 'https:';
  }
  return false;
}

/** 文字列が許可された origin か（origin 以外の要素が付いていたら拒否）。 */
export function normalizeSiteOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) return null;
  if (!isAllowedSiteHost(url)) return null;
  return url.origin;
}

/**
 * リクエストから公開 origin を決める。
 *
 * 優先順:
 *   1. `Origin` ヘッダーが許可ホストなら、それ
 *   2. `Host` ヘッダーが許可ホストなら、それを組み立てる（localhost は http）
 *   3. どちらも駄目なら **本番**
 */
export function resolveSiteOrigin(headers) {
  const h = headers || {};
  const origin = normalizeSiteOrigin(h.origin || h.Origin || '');
  if (origin) return origin;

  const host = String(h.host || h.Host || '').trim();
  if (host) {
    const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1');
    const candidate = normalizeSiteOrigin(`${isLocal ? 'http' : 'https'}://${host}`);
    if (candidate) return candidate;
  }
  return DEFAULT_SITE_ORIGIN;
}
