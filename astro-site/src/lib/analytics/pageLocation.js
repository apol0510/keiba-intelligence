/**
 * pageLocation.js — GA4 に渡す URL から個人情報・認証情報を落とす
 *
 * 正本: docs/measurements/FUNNEL_2026_10.md §2
 *
 * 🔴 2026-10-19 判明: マジックリンク `/auth/verify?token=…&email=…` の page_view が、
 *    メールアドレスとログイン用トークンを GA4 の page_location に載せていた。
 *    遷移先ページの page_referrer（同一サイトは完全な URL が入る）にも同じ値が残っていた。
 *
 * 方針は **許可リスト**（fail-closed）: 集客の分析に要るクエリ（utm_* / 広告クリック ID /
 * 導線の固定値）だけ残し、それ以外のクエリはすべて落とす。ハッシュも落とす。
 *
 * 🔴 この関数は BaseLayout の `is:inline` スクリプトへ **関数の文字列のまま** 埋め込む
 *    （`sanitizeAnalyticsUrl.toString()`）。外側の変数・import を参照しないこと。
 *    参照すると inline 側で ReferenceError になり、GA4 の初期化ごと止まる。
 *
 * @param {string} href
 * @returns {string} 落とした後の URL。解釈できなければ空文字（呼び出し側は送らない）
 */
export function sanitizeAnalyticsUrl(href) {
  if (typeof href !== 'string' || href === '') return '';
  var keep = {
    utm_source: 1, utm_medium: 1, utm_campaign: 1, utm_term: 1, utm_content: 1, utm_id: 1,
    gclid: 1, gbraid: 1, wbraid: 1, fbclid: 1, yclid: 1, msclkid: 1,
    ref: 1, checkout: 1, resume: 1,
  };
  var u;
  try { u = new URL(href); } catch (e) { return ''; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  var out = [];
  u.searchParams.forEach(function (v, k) {
    if (keep[k] !== 1) return;
    // 許可キーでも、メールアドレスらしい値は落とす（utm に貼り付けられる事故への保険）
    if (v.indexOf('@') !== -1 || /%40/i.test(v)) return;
    out.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
  });
  return u.origin + u.pathname + (out.length ? '?' + out.join('&') : '');
}

/**
 * BaseLayout の GA4 初期化スクリプト本体（inline 用の文字列）。
 * `set` で全ヒット（page_view と以後のイベント）の page_location / page_referrer を差し替える。
 * @param {string} measurementId
 */
export function ga4BootstrapScript(measurementId) {
  if (!/^G-[A-Z0-9]+$/.test(measurementId)) throw new Error('invalid GA4 measurement id');
  return [
    'window.dataLayer = window.dataLayer || [];',
    'function gtag(){dataLayer.push(arguments);}',
    'window.gtag = gtag;',
    '(function(){',
    '  var kiSanitize = ' + sanitizeAnalyticsUrl.toString() + ';',
    '  var p = { page_location: kiSanitize(window.location.href) };',
    '  var r = kiSanitize(document.referrer || "");',
    '  p.page_referrer = r;',
    '  gtag("js", new Date());',
    '  gtag("set", p);',
    '  gtag("config", ' + JSON.stringify(measurementId) + ', p);',
    '})();',
  ].join('\n');
}
