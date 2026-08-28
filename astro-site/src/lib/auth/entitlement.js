/**
 * entitlement.js — 「この閲覧者に何を描画してよいか」の単一判定
 *
 * 正本: docs/RENEWAL_2026_08.md §3 / §7
 *
 * 🔴 これがサーバー側認可の唯一の入口である。
 *    ページ側で sessionStorage / localStorage を読んで権限を決めてはいけない
 *    （2026-08-17 監査 A-3）。クライアント保存値は表示補助にのみ使う。
 *
 * 🔴 fail-closed:
 *    署名鍵未設定 / Cookie 無し / 署名不正 / 期限切れ / 例外 → **すべて guest**。
 *    guest は印も買い目も見られない（馬柱・過去走・特徴量・文章は見られる）。
 */

import {
  TIER, canSeeMarks, canSeeBetting, canSeePremiumExtras,
  tierLabel, tierAtLeast, applyExpiry, normalizeVenueAccess,
} from './tiers.js';
import { verifySession, readSessionToken } from './session.js';
import { applyPreview } from './previewMode.js';

export { TIER } from './tiers.js';

/** 署名鍵を持つ env のキー名（🔴 値は扱わない）。 */
export const SESSION_SECRET_ENV = 'SESSION_SIGNING_SECRET';

/** guest の既定 entitlement。例外時は必ずこれへ倒す。 */
function guestEntitlement(reason) {
  return Object.freeze({
    tier: TIER.GUEST,
    tierLabel: tierLabel(TIER.GUEST),
    email: null,
    venueAccess: 'all',
    authenticated: false,
    reason,
    showMarks: false,
    showBetting: false,
    showPremiumExtras: false,
    expiresAtMs: null,
  });
}

/**
 * env から署名鍵を取り出す。Astro（import.meta.env）と Netlify Functions（process.env）の
 * どちらからも呼べるよう、env オブジェクトを引数で受け取る。
 */
export function resolveSessionSecret(env) {
  const src = env || {};
  const v = src[SESSION_SECRET_ENV];
  return typeof v === 'string' && v.trim() ? v : null;
}

/**
 * Cookie ヘッダーから entitlement を決める。
 *
 * @param {object} o
 * @param {string|null} o.cookieHeader  リクエストの Cookie ヘッダー
 * @param {object} o.env                署名鍵を含む env
 * @param {number} [o.nowMs]
 * @param {string} [o.venue]            'nankan' | 'jra'。買い目の会場判定に使う
 * @returns {Readonly<object>}
 */
export function resolveEntitlement({ cookieHeader, env, nowMs = Date.now(), venue } = {}) {
  try {
    const secret = resolveSessionSecret(env);
    if (!secret) return guestEntitlement('secret_missing');

    const token = readSessionToken(cookieHeader);
    if (!token) return guestEntitlement('no_session');

    const verified = verifySession({ token, secret, nowMs });
    if (!verified.ok) return guestEntitlement(verified.reason);

    const s = verified.session;
    // セッション内の tier は署名済みだが、有効期限切れの有料は free へ落とす
    const tier = applyExpiry(s.tier, null, nowMs);
    const venueAccess = normalizeVenueAccess(s.venueAccess);

    return Object.freeze({
      tier,
      tierLabel: tierLabel(tier),
      email: s.email,
      venueAccess,
      authenticated: tierAtLeast(tier, TIER.FREE),
      reason: 'ok',
      showMarks: canSeeMarks(tier),
      showBetting: canSeeBetting(tier, { venue, venueAccess }),
      showPremiumExtras: canSeePremiumExtras(tier),
      expiresAtMs: s.expiresAtMs,
    });
  } catch {
    // 例外の内容は握りつぶす（secret を含みうるため）。必ず guest へ倒す。
    return guestEntitlement('exception');
  }
}

/**
 * Astro ページ用のショートカット。
 *
 * 使い方（.astro の frontmatter）:
 *   const ent = entitlementFromAstro(Astro, { venue: 'nankan' });
 *   if (ent.showBetting) { ... }
 */
export function entitlementFromAstro(Astro, { venue, nowMs } = {}) {
  const cookieHeader = Astro?.request?.headers?.get?.('cookie') || null;
  // import.meta.env は Astro のビルド/実行時 env。Netlify では process.env も併用する。
  const env = {
    ...(typeof process !== 'undefined' && process.env ? process.env : {}),
    ...(import.meta && import.meta.env ? import.meta.env : {}),
  };
  const base = resolveEntitlement({ cookieHeader, env, venue, nowMs });

  // Deploy Preview 限定の「無料会員の見え方」プレビュー（本番ホストでは無効・印までしか開かない）
  return applyPreview(base, {
    host: Astro?.request?.headers?.get?.('host') || '',
    searchParams: Astro?.url?.searchParams || null,
  });
}

/**
 * 「印を出してよいか」「買い目を出してよいか」だけを取り出した描画用ビュー。
 * コンポーネントへはこの形で渡す（entitlement 全体を渡さない＝ email を UI へ漏らさない）。
 */
export function viewFlags(entitlement) {
  const e = entitlement || guestEntitlement('missing');
  return Object.freeze({
    tier: e.tier,
    tierLabel: e.tierLabel,
    showMarks: !!e.showMarks,
    showBetting: !!e.showBetting,
    showPremiumExtras: !!e.showPremiumExtras,
    authenticated: !!e.authenticated,
    // Deploy Preview の見え方プレビュー中か（画面に明示するために渡す）
    preview: !!e.preview,
  });
}

/** guest 用の描画フラグ（テスト・フォールバック用）。 */
export const GUEST_VIEW = viewFlags(guestEntitlement('default'));
