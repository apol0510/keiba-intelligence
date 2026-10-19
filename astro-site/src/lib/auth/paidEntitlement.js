/**
 * paidEntitlement.js — 顧客レコード（Airtable Customers）から、新しく発行するセッションの tier を決める
 *
 * 正本: docs/measurements/LOGIN_RECOVERY_2026_10.md §「ログイン可否と有料権限の分離」
 *       （MK 2026-10-19: ログイン可能な状態と有料閲覧権限は厳密に分離する）
 *
 * 呼び出し元はセッションを **発行する** 2 か所だけ:
 *   - `verify-magic-link`（ログイン）
 *   - `refresh-session`（決済直後などの出し直し）
 * ページ・API の認可（`entitlement.js`）は、ここで決めて署名した Cookie の tier を読む。
 *
 * 背景:
 *   以前は tier を `PlanType` と有効期限だけで決めていた。`send-magic-link` が active 以外を
 *   止めていたので、事実上「ログインできる＝active」だったが、ログインリンクを
 *   pending / inactive / payment_failed にも送るようにした（loginEligibility.js）ことで、
 *   **「ログインできる」と「有料が見られる」を別々に判定する必要**ができた。
 *   たとえば次のレコードは、旧ロジックのままだと premium のセッションになる:
 *     - inactive で PlanType=premium が残り、退会記録（Blobs）が無い（記録が不完全）
 *     - 銀行振込の申込直後（Status=pending・PlanType=premium・入金未確認）
 *
 * 🔴 有料 tier（light 以上）を出す条件（すべて満たすときだけ）:
 *   1. PlanType が有料（`planTypeToTier` が light / premium）
 *   2. Status が `PAID_STATUSES`（active / payment_failed）のどれか。
 *      - active         … 契約中（Stripe webhook・入金確認が書く）
 *      - payment_failed … 決済失敗。正本上アクセスは即時停止しない（MEMBERSHIP_REWARDS.md §7.7・TBD-10）。
 *                         Stripe が諦めると webhook が inactive / free に戻す
 *      - それ以外（inactive / pending / cancelled / suspended / 空 / 未知 / 型違い）は **free**
 *   3. 有効期限（ExpirationDate / 有効期限）が
 *      - 無い         … そのまま（Stripe 月額会員は有効期限を持たない。契約状態は Status で表す）
 *      - 未来         … そのまま
 *      - 過去         … free
 *      - 読めない値   … 🔴 free（fail-closed。`applyExpiry` は誤剥奪防止で落とさないが、発行側では有料を出さない）
 *   4. 退会記録（Blobs）で未反映なら free（`tierForNewSession`。呼び出し側で適用する）
 *
 * 🔴 ここは **降格しかしない**。有料 tier の出どころは従来どおり PlanType だけ。
 * 🔴 正しく記録された active 会員（PlanType 有料・期限なし or 未来）の tier は変わらない。
 */

import { TIER, planTypeToTier, tierAtLeast } from './tiers.js';

/** 有料 tier を出してよい Status。これ以外（未知・空を含む）は free まで。 */
export const PAID_STATUSES = Object.freeze(['active', 'payment_failed']);

/** PlanType が有料プラン（light 以上）か。Status・期限は見ない。 */
export function isPaidPlanType(planType) {
  return tierAtLeast(planTypeToTier(planType), TIER.LIGHT);
}

/** Status が有料を出してよい値か。 */
export function isPaidStatus(status) {
  return typeof status === 'string' && PAID_STATUSES.includes(status);
}

/**
 * 有効期限の判定。
 * @returns {'none'|'valid'|'expired'|'invalid'}
 */
export function expiryState(raw, nowMs) {
  if (raw == null || raw === '') return 'none';
  if (typeof raw === 'string' && raw.trim() === '') return 'none';
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return 'invalid';
  return t < nowMs ? 'expired' : 'valid';
}

/**
 * 顧客レコード → これから発行するセッションの tier（退会記録の適用前）。
 *
 * 🔴 認証済み（メール所有を確認した）顧客レコードに対してのみ呼ぶこと。guest は返さない。
 *
 * @param {object} fields Airtable Customers の fields
 * @param {number} nowMs
 * @returns {'free'|'light'|'premium'}
 */
export function customerSessionTier(fields, nowMs) {
  const f = fields && typeof fields === 'object' ? fields : {};
  const planTier = planTypeToTier(f.PlanType || 'free-registered');
  if (!tierAtLeast(planTier, TIER.LIGHT)) return planTier;
  if (!isPaidStatus(f.Status)) return TIER.FREE;
  const exp = expiryState(f.ExpirationDate || f['有効期限'] || null, nowMs);
  if (exp === 'expired' || exp === 'invalid') return TIER.FREE;
  return planTier;
}
