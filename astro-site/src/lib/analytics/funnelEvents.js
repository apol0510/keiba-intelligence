/**
 * funnelEvents.js — 集客 → 無料登録 → 購入の GA4 計測（PII なし）
 *
 * 正本: docs/measurements/FUNNEL_2026_10.md
 *
 * 背景（2026-10-19 診断）:
 *   GA4 には page_view とマイページ（退会・ポータル）のイベントしか無く、
 *   「料金ページへ来た人のうち何人が申し込みを押し、メール確認を通り、
 *   Stripe へ進み、戻ってきたか」を 1 段も数えられなかった。
 *   さらに `/auth/verify?token=…&email=…` の page_view が **メールアドレスと
 *   ログイン用トークンをそのまま GA4 へ送っていた**（page_location / page_referrer）。
 *
 * 契約（既存のマイページ計測 `ki_*` と同じ）:
 *   🔴 email・ID・token・氏名など個人や認証に結びつく値を送らない。
 *   🔴 送れるのは下の **固定のイベント名** と **固定のキー** だけ。値は短い英数字の列挙値。
 *   🔴 gtag が無い（広告ブロック・未読み込み）ときは何もしない。計測の失敗で導線を止めない。
 */

/** 送ってよいイベント名（これ以外は送らない）。 */
export const FUNNEL_EVENTS = Object.freeze({
  /** 料金ページへのリンクを押した `{placement}` */
  PRICING_LINK_CLICK: 'ki_pricing_link_click',
  /** 無料登録フォームの結果 `{result: sent|resent|already|mismatch|error}` */
  SIGNUP_RESULT: 'ki_signup_result',
  /** 登録後の画面で「確認メールを再送」を押した結果 `{result: sent|error}`（SIGNUP_COMPLETION_2026_10.md） */
  SIGNUP_RESEND_RESULT: 'ki_signup_resend_result',
  /** 「このプランを申し込む」を押した（認証から戻った自動再開を含む）`{plan, resumed}` */
  CHECKOUT_CLICK: 'ki_checkout_click',
  /** 未ログインのためメール確認フォームを開いた `{plan}` */
  PURCHASE_AUTH_OPEN: 'ki_purchase_auth_open',
  /** 購入導線の確認メール送信結果 `{plan, result: sent|error}` */
  PURCHASE_EMAIL_RESULT: 'ki_purchase_email_result',
  /** Stripe Checkout へ移動する直前 `{plan}` */
  CHECKOUT_REDIRECT: 'ki_checkout_redirect',
  /** Checkout を開けなかった `{plan}` */
  CHECKOUT_ERROR: 'ki_checkout_error',
  /** Stripe からキャンセルで戻った */
  CHECKOUT_CANCELLED: 'ki_checkout_cancelled',
  /** Stripe から success_url（/mypage?checkout=success）へ戻った */
  CHECKOUT_RETURN: 'ki_checkout_return',
  /** 戻った後の権限反映 `{result: changed|pending}` */
  CHECKOUT_SYNCED: 'ki_checkout_synced',
  /** /login のログインリンク送信結果 `{result: sent|not_found|blocked|error, return_to}`（LOGIN_GUIDANCE_2026_10.md・return_to は LOGIN_RETURN_TO_2026_10.md） */
  LOGIN_LINK_RESULT: 'ki_login_link_result',
  /** マジックリンクの確認結果 `{result: ok|expired|used|not_found|error, intent: purchase|none, return_to: prediction|free_prediction|results|mypage|none, source: signup|login}`（source は SIGNUP_COMPLETION_2026_10.md） */
  LOGIN_VERIFY_RESULT: 'ki_login_verify_result',
  /** リンクが使えなかった後の分岐 `{result: signed_in|relogin}`（この端末がログイン済みだったか。LOGIN_RECOVERY_2026_10.md） */
  VERIFY_FALLBACK: 'ki_verify_fallback',
});

const EVENT_NAMES = new Set(Object.values(FUNNEL_EVENTS));

/** 送ってよいキー（これ以外は落とす）。 */
const ALLOWED_KEYS = new Set(['placement', 'plan', 'result', 'resumed', 'intent', 'return_to', 'source']);

/** 値は短い英数字・`_`・`-` だけ。`@` や `.` を含む値（email 等）はここで弾かれる。 */
const VALUE_RE = /^[a-z0-9_-]{1,40}$/i;

/**
 * 送信用のパラメータを作る。許可キー以外・形式外の値は黙って落とす。
 * @param {Record<string, unknown>} params
 * @returns {Record<string, string>}
 */
export function sanitizeFunnelParams(params) {
  const out = {};
  if (!params || typeof params !== 'object') return out;
  for (const [k, v] of Object.entries(params)) {
    if (!ALLOWED_KEYS.has(k)) continue;
    if (typeof v !== 'string' || !VALUE_RE.test(v)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * GA4 へイベントを送る。送らなかったときは false。
 * @param {string} name FUNNEL_EVENTS のいずれか
 * @param {Record<string, unknown>} [params]
 * @param {{ gtag?: Function }} [win]
 */
export function trackFunnel(name, params = {}, win = typeof window !== 'undefined' ? window : undefined) {
  if (!EVENT_NAMES.has(name)) return false;
  try {
    if (!win || typeof win.gtag !== 'function') return false;
    win.gtag('event', name, sanitizeFunnelParams(params));
    return true;
  } catch {
    return false;
  }
}

/**
 * 料金ページへのリンクがどこにあったか（固定の列挙値）。
 * 明示の `data-ki-placement` を最優先し、無ければヘッダー / フッター / 本文。
 * @param {Element} link
 */
export function placementOf(link) {
  try {
    const explicit = link.closest('[data-ki-placement]');
    if (explicit) {
      const v = explicit.getAttribute('data-ki-placement') || '';
      if (VALUE_RE.test(v)) return v;
    }
    if (link.closest('nav, .main-nav')) return 'nav';
    if (link.closest('footer')) return 'footer';
  } catch { /* 古いブラウザ */ }
  return 'body';
}

/** `/pricing` 宛ての同一サイト内リンクか（クエリ・ハッシュ付きを含む）。 */
export function isPricingHref(href, origin) {
  if (typeof href !== 'string' || !href) return false;
  try {
    const u = new URL(href, origin);
    return u.origin === origin && /^\/pricing\/?$/.test(u.pathname);
  } catch {
    return false;
  }
}

/** verify-magic-link の応答を結果の列挙値にする（文言・token は使わない）。 */
export function verifyResultOf(status, ok, errorCode) {
  if (ok) return 'ok';
  if (status === 404) return 'not_found';
  if (status === 403) return errorCode === 'Token already used' ? 'used' : 'expired';
  return 'error';
}

/** send-magic-link の HTTP 状態を結果の列挙値にする（文言・email は使わない）。 */
export function loginLinkResultOf(status) {
  if (status >= 200 && status < 300) return 'sent';
  if (status === 404) return 'not_found';
  if (status === 403) return 'blocked';
  return 'error';
}

/* ------------------------------------------------------------------
   GA4 標準のコンバージョン（2026-11-13・KAO docs/offsite-presence/README.md §6）
   ------------------------------------------------------------------
   上の `ki_*` は途中の段を数えるためのもの。検索・AI 経由の「登録」「購入」を
   GA4 の経路別に数えるには、GA4 標準の `sign_up` / `purchase` が要る（これまで 0 件だった）。

   🔴 送るのは固定のキーだけ（method / currency / value / plan）。email・会員 ID・token・
      Stripe の ID は送らない（transaction_id も送らない。重複はこのブラウザの印で防ぐ）。
   🔴 同じブラウザで 1 回だけ（localStorage の印）。再読み込み・戻るで二重に数えない。
   🔴 売上の正本は Stripe。GA4 の値は経路別の比較に使うだけ。
*/

/** 標準イベントの名前（これ以外は送らない）。 */
export const STANDARD_CONVERSIONS = Object.freeze({ SIGN_UP: 'sign_up', PURCHASE: 'purchase' });

const ONCE_PREFIX = 'ki_conv_sent:';

function sendOnce(win, onceKey, name, params) {
  try {
    if (!win || typeof win.gtag !== 'function') return false;
    const store = win.localStorage;
    const key = ONCE_PREFIX + onceKey;
    try { if (store && store.getItem(key)) return false; } catch { /* 読めなくても送る */ }
    win.gtag('event', name, params);
    try { if (store) store.setItem(key, '1'); } catch { /* 書けなくてもよい */ }
    return true;
  } catch {
    return false;
  }
}

/**
 * 無料会員の登録完了（登録の確認リンクでログインできた）。
 * @param {{ gtag?: Function, localStorage?: Storage }} [win]
 */
export function trackSignUp(win = typeof window !== 'undefined' ? window : undefined) {
  return sendOnce(win, 'sign_up', STANDARD_CONVERSIONS.SIGN_UP, { method: 'email' });
}

/**
 * 有料プランの購入完了（決済から戻り、権限の反映を確認できた）。
 * @param {{ planId: string, priceYen: number }} purchase 価格は plans.js の実売価格（請求額の正本は Stripe）
 * @param {{ gtag?: Function, localStorage?: Storage }} [win]
 */
export function trackPurchase(purchase, win = typeof window !== 'undefined' ? window : undefined) {
  const planId = purchase && typeof purchase.planId === 'string' && VALUE_RE.test(purchase.planId) ? purchase.planId : null;
  const value = purchase && Number.isInteger(purchase.priceYen) && purchase.priceYen > 0 ? purchase.priceYen : null;
  if (!planId || value === null) return false;
  // 同じプランを解約後に買い直すことはあるが、同じブラウザで同じ日に 2 回は数えない
  const day = new Date().toISOString().slice(0, 10);
  return sendOnce(win, `purchase:${planId}:${day}`, STANDARD_CONVERSIONS.PURCHASE, { currency: 'JPY', value, plan: planId });
}
