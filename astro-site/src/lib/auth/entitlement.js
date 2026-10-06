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
  TIER, canSeeMarks, canSeeBetting,
  tierLabel, tierAtLeast, applyExpiry,
} from './tiers.js';
import { verifySession, readSessionToken } from './session.js';
import { applyPreview } from './previewMode.js';
import { readRevocation, tierAfterRevocation, isPaidTier } from './revocation.js';

export { TIER } from './tiers.js';

/** 署名鍵を持つ env のキー名（🔴 値は扱わない）。 */
export const SESSION_SECRET_ENV = 'SESSION_SIGNING_SECRET';

/** guest の既定 entitlement。例外時は必ずこれへ倒す。 */
function guestEntitlement(reason) {
  return Object.freeze({
    tier: TIER.GUEST,
    tierLabel: tierLabel(TIER.GUEST),
    email: null,
    authenticated: false,
    reason,
    showMarks: false,
    showBetting: false,
    expiresAtMs: null,
    issuedAtMs: null,
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
 * @returns {Readonly<object>}
 *
 * 🔴 会場（venue）は受け取らない。買い目は会場で分けない（2026-08-30）。
 */
export function resolveEntitlement({ cookieHeader, env, nowMs = Date.now() } = {}) {
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

    return Object.freeze({
      tier,
      tierLabel: tierLabel(tier),
      email: s.email,
      authenticated: tierAtLeast(tier, TIER.FREE),
      reason: 'ok',
      showMarks: canSeeMarks(tier),
      showBetting: canSeeBetting(tier),
      expiresAtMs: s.expiresAtMs,
      issuedAtMs: s.issuedAtMs,
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
 *   const ent = entitlementFromAstro(Astro);
 *   if (ent.showBetting) { ... }
 *
 * 🔴 `venue` は受け取らない（会場で分けない）。
 */
export function entitlementFromAstro(Astro, { nowMs } = {}) {
  const cookieHeader = Astro?.request?.headers?.get?.('cookie') || null;
  // import.meta.env は Astro のビルド/実行時 env。Netlify では process.env も併用する。
  const env = {
    ...(typeof process !== 'undefined' && process.env ? process.env : {}),
    ...(import.meta && import.meta.env ? import.meta.env : {}),
  };
  const base = resolveEntitlement({ cookieHeader, env, nowMs });

  // Deploy Preview 限定のプレビュー表示（本番ホストでは常に無効）
  //   ?view=free              … 合言葉なし。印まで
  //   ?view=light|premium&key= … 合言葉（env PREVIEW_PAID_KEY）が一致したときだけ
  return applyPreview(base, {
    host: Astro?.request?.headers?.get?.('host') || '',
    searchParams: Astro?.url?.searchParams || null,
    env,
  });
}

/**
 * entitlement に退会記録を当てる（docs/WITHDRAWAL_2026_10.md §4）。
 *
 * 🔴 有料 tier のときだけ Blobs を読む（guest / free には追加の I/O を発生させない）。
 * 🔴 降格しかしない。退会時刻以前に発行された有料セッションは free として扱う。
 * 🔴 Deploy Preview の見え方プレビュー（`preview`）は本番ホストでは成立しないので対象外。
 *
 * @param {object} ent  resolveEntitlement / entitlementFromAstro の戻り値
 * @param {object} [o]
 * @param {object} [o.event]  v1 関数の event（Blobs 環境の接続に使う）
 * @param {object} [o.store]  テスト用
 */
export async function applyRevocation(ent, { event, store } = {}) {
  if (!ent || ent.preview || !ent.email || !isPaidTier(ent.tier)) return ent;
  const { revocation } = await readRevocation(ent.email, { event, store });
  const tier = tierAfterRevocation({ tier: ent.tier, issuedAtMs: ent.issuedAtMs }, revocation);
  if (tier === ent.tier) return ent;
  return Object.freeze({
    ...ent,
    tier,
    tierLabel: tierLabel(tier),
    authenticated: tierAtLeast(tier, TIER.FREE),
    reason: 'revoked',
    showMarks: canSeeMarks(tier),
    showBetting: canSeeBetting(tier),
  });
}

/** Astro ページ用（有料の描画・有料ページの入場判定はこれを使う）。 */
export async function checkedEntitlementFromAstro(Astro, opts = {}) {
  return applyRevocation(entitlementFromAstro(Astro, opts));
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
    authenticated: !!e.authenticated,
    // Deploy Preview の見え方プレビュー中か（画面に明示するために渡す）
    preview: !!e.preview,
  });
}

/** guest 用の描画フラグ（テスト・フォールバック用）。 */
export const GUEST_VIEW = viewFlags(guestEntitlement('default'));

/**
 * 無料ページ（`/free-prediction/*`）用の描画ビュー。
 *
 * 🔴 **tier を問わず買い目を出さない**（2026-09-03 仕様所有者の指示）。
 *    有料会員が無料ページを開いても「無料の見え方」になる。
 *    買い目・AI指数・AI結論は `showBetting` が束ねているので、
 *    ここを false にすることで**組み立て自体が起きない**（CSS で隠すのではない）。
 *
 * 🔴 印（`showMarks`）は tier どおりに残す。
 *    無料会員に印を見せるのが無料ページの目的そのものだから。
 */
export function freePageViewFlags(entitlement) {
  const v = viewFlags(entitlement);
  return Object.freeze({ ...v, showBetting: false });
}

/**
 * 有料ページ（`/prediction/*`）へ入れるか。
 *
 * 🔴 **買い目を出せない tier は入れない**（2026-09-03 仕様所有者の指示）。
 *    以前は同じ URL を tier で出し分けていたが、
 *    「無料会員が pro 予想にアクセスできてしまう」ため URL で分ける方式へ戻した。
 *
 * 🔴 fail-closed。判定できなければ**入れない**。
 *
 * @returns {string|null} 追い出す先。入ってよければ null
 */
export function paidPageRedirect(view, freeHref) {
  if (view && view.showBetting === true) return null;
  return typeof freeHref === 'string' && freeHref ? freeHref : '/pricing';
}
