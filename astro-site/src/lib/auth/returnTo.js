/**
 * returnTo.js — ログイン後に「元のページ」へ戻すための戻り先（許可リスト方式）
 *
 * 正本: docs/measurements/LOGIN_RETURN_TO_2026_10.md（registry e52a3c07）
 *
 * 背景:
 *   ログイン後の戻り先は常に `/mypage` だった。セッションが切れた有料会員が
 *   `/prediction/*` を開くと無料版が表示され、ログインしてもマイページへ飛ばされて
 *   元の予想ページへ戻れなかった（会員の継続利用を損なう）。
 *
 * 仕組み（購入意図 `purchaseIntent.js` の `intentQuery` / `resumePathFor` と同じ流れ）:
 *   ログイン入口（予想ページのゲスト帯のリンク・/login）
 *     → send-magic-link（`next` をマジックリンクのクエリへ。`returnToQuery`）
 *     → メールのリンク → /auth/verify → verify-magic-link
 *     → `resumePathFor(intent, normalizeReturnTo(next) || '/mypage')`
 *   🔴 購入意図があれば購入の続きが優先（`resumePathFor` がそちらを返す）。
 *
 * 🔴 open redirect を作らない:
 *    - 受け付けるのは **同一サイトの相対パスで、下の許可リストに一致するものだけ**。
 *    - 文字は英数字・`-`・`_`・`/` だけ。`//`・`\`・`%`（エンコード）・`.`（`..`）・
 *      空白・制御文字・クエリ・ハッシュ・スキーム（`https:` `javascript:` 等）はすべて拒否。
 *    - 長すぎる値（RETURN_TO_MAX_LENGTH 超）は拒否。
 *    - 拒否したら **null**（呼び出し側は従来の `/mypage` に倒す＝fail-closed）。
 * 🔴 email・token は扱わない。戻り先は認可に一切使わない（tier は Cookie だけで決まる）。
 */

/** 戻り先を運ぶクエリ名（/login・マジックリンク・/auth/verify で共通）。 */
export const RETURN_PARAM = 'next';

/** 受け付ける最大長。これを超える値は拒否する。 */
export const RETURN_TO_MAX_LENGTH = 200;

/** パスの 1 区切り（英数字・`-`・`_` のみ。`.` を許さないので `..` も通らない）。 */
const SEG = '[A-Za-z0-9_-]+';

/**
 * 戻り先として許可するパス（GA4 の分類名つき）。
 * 🔴 ここに無いパス（/admin・/pricing・/login・外部 URL 等）へは戻さない。
 */
const ALLOWED = [
  { kind: 'mypage', re: /^\/mypage\/?$/ },
  { kind: 'prediction', re: new RegExp(`^/prediction(?:/${SEG})*/?$`) },
  { kind: 'free_prediction', re: new RegExp(`^/free-prediction(?:/${SEG})*/?$`) },
  { kind: 'results', re: new RegExp(`^/results(?:-jra)?/?$`) },
  { kind: 'results', re: new RegExp(`^/results(?:/${SEG})+/?$`) },
];

function match(path) {
  return ALLOWED.find((a) => a.re.test(path)) || null;
}

/**
 * 入力を正規化する。許可リストに一致しない値はすべて **null**。
 * 🔴 trim・decode・URL 解釈はしない（値をそのまま検査する。`%` を含む値は拒否）。
 */
export function normalizeReturnTo(value) {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > RETURN_TO_MAX_LENGTH) return null;
  if (value[0] !== '/') return null;
  return match(value) ? value : null;
}

/**
 * マジックリンクへ付ける戻り先のクエリ（先頭の `&` を含む）。
 * 戻り先が無い・不正なら空文字（＝従来どおりのリンク）。
 */
export function returnToQuery(value) {
  const v = normalizeReturnTo(value);
  return v ? `&${RETURN_PARAM}=${encodeURIComponent(v)}` : '';
}

/**
 * GA4 用の分類（固定の列挙値。パスそのものは送らない）。
 * @returns {'mypage'|'prediction'|'free_prediction'|'results'|'none'}
 */
export function returnToKind(value) {
  const v = normalizeReturnTo(value);
  return v ? match(v).kind : 'none';
}

/**
 * 無料ページの戻り先に対応する有料ページ（無ければ null）。
 *
 * 未ログインで `/prediction/*` を開くと有料ページは無料ページ（`/free-prediction/*`）へ 302 する
 * （`paidPageRedirect`）。そのため戻り先は無料ページになり、無料ページは有料会員にも「無料の見え方」を出す。
 * 買い目を見られる会員を元の有料ページへ戻すため、呼び出し側（verify-magic-link）が
 * **買い目を見られる会員のときだけ**この対応を使う。
 *
 * 🔴 対応は有料ページの 302 の逆（固定の対応だけ）。値から URL を組み立てない。
 * 🔴 有料ページ自身が Cookie で判定するので、ここで権限は決まらない（誤って送っても無料ページへ戻るだけ）。
 *   - /free-prediction/nankan          → /prediction/nankan
 *   - /free-prediction/nankan/<slug>   → /prediction/<slug>（`archive` を除く）
 *   - /free-prediction/jra             → /prediction/jra
 *   - それ以外（/free-prediction/jra/<日付>・archive 等）は対応なし
 */
export function paidEquivalentPath(value) {
  const v = normalizeReturnTo(value);
  if (!v) return null;
  const path = v.length > 1 && v.endsWith('/') ? v.slice(0, -1) : v;
  if (path === '/free-prediction/nankan') return '/prediction/nankan';
  if (path === '/free-prediction/jra') return '/prediction/jra';
  const m = /^\/free-prediction\/nankan\/([A-Za-z0-9_-]+)$/.exec(path);
  if (m && m[1] !== 'archive') return `/prediction/${m[1]}`;
  return null;
}

/**
 * /login へのリンク。いまのページが許可リストにあれば `?next=` を付ける。
 * @param {string} pathname 現在のページのパス（`Astro.url.pathname` 等）
 */
export function loginHrefFor(pathname) {
  const v = normalizeReturnTo(pathname);
  return v && v !== '/mypage' ? `/login?${RETURN_PARAM}=${encodeURIComponent(v)}` : '/login';
}

/**
 * 直前のページ（`document.referrer`）から戻り先を取る（ヘッダーの「ログイン」等、
 * `next` を付けられないリンクから来たときの補助）。
 * 🔴 同一オリジンのときだけ、パス部分だけを許可リストで検査する（クエリ・ハッシュは捨てる）。
 */
export function returnToFromReferrer(referrer, origin) {
  if (typeof referrer !== 'string' || !referrer || typeof origin !== 'string' || !origin) return null;
  let u;
  try {
    u = new URL(referrer);
  } catch {
    return null;
  }
  if (u.origin !== origin) return null;
  return normalizeReturnTo(u.pathname);
}
