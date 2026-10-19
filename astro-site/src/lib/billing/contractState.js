/**
 * contractState.js — 顧客レコード（Airtable Customers）から「有料契約がいまどうなっているか」を表示用に決める
 *
 * 正本: docs/measurements/CONTRACT_ENDED_VISIBILITY_2026_10.md
 *
 * 背景（2026-10-20 顧客集計・件数のみ）:
 *   有料の閲覧権がある 8 件に対し、契約期間が過ぎた元会員が 7 件（Status は active のまま・有効期限が過去）、
 *   契約終了（inactive）が 5 件。マイページはこの人たちにも無料会員と同じ表示で、
 *   「契約が終わった」ことも「いつ終わったか」も分からなかった。
 *
 * 🔴 表示専用。**権限（tier）の判定には使わない。** 有料閲覧の可否は従来どおり
 *    paidEntitlement.js（customerSessionTier）が決めた署名付きセッションだけが決める。
 *    ここは customerSessionTier を「呼ぶだけ」で、条件を複製・変更しない。
 * 🔴 書き込みはしない。読めない値は推測しない（日付が読めなければ endedOn=null）。
 *
 * 状態:
 *   active … 有料の閲覧権がある（customerSessionTier が light 以上）
 *   lapsed … 有料 PlanType・Status は active / payment_failed のまま、有効期限が過去（更新されなかった）
 *   ended  … 契約終了の記録がある（Status=inactive、または解約日 CancelledAt がある）
 *   none   … 有料契約の記録がない（無料登録・未確認・入金確認前など）
 */

import { TIER, tierAtLeast } from '../auth/tiers.js';
import { customerSessionTier, isPaidPlanType, isPaidStatus, expiryState } from '../auth/paidEntitlement.js';

export const CONTRACT_STATE = Object.freeze({
  ACTIVE: 'active',
  LAPSED: 'lapsed',
  ENDED: 'ended',
  NONE: 'none',
});

const JST = 'Asia/Tokyo';

/**
 * 日付・日時の値を JST の 'YYYY-MM-DD' にする。読めなければ null。
 * Airtable の日付だけの列（'2026-10-15'）は UTC 0 時として読まれ、JST でも同じ日になる。
 * @param {unknown} raw
 * @returns {string|null}
 */
export function toJstDate(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const t = Date.parse(raw.trim());
  if (!Number.isFinite(t)) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: JST, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(t));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * @param {object|null|undefined} fields Airtable Customers の fields（PlanType / Status / ExpirationDate / 有効期限 / CancelledAt）
 * @param {number} nowMs
 * @returns {{state: 'active'|'lapsed'|'ended'|'none', endedOn: string|null}} endedOn は JST の 'YYYY-MM-DD'
 */
export function contractState(fields, nowMs) {
  const f = fields && typeof fields === 'object' ? fields : {};
  const none = { state: CONTRACT_STATE.NONE, endedOn: null };

  if (tierAtLeast(customerSessionTier(f, nowMs), TIER.LIGHT)) {
    return { state: CONTRACT_STATE.ACTIVE, endedOn: null };
  }

  const rawExpiry = f.ExpirationDate || f['有効期限'] || null;
  const expiry = expiryState(rawExpiry, nowMs);
  const cancelledOn = toJstDate(f.CancelledAt);

  // 有料プラン・契約中の Status のまま、有効期限だけが過ぎた（更新されなかった）
  if (isPaidPlanType(f.PlanType) && isPaidStatus(f.Status) && expiry === 'expired') {
    return { state: CONTRACT_STATE.LAPSED, endedOn: toJstDate(rawExpiry) };
  }

  // 契約終了の記録（Stripe webhook・退会が inactive / CancelledAt を書く）
  if (f.Status === 'inactive' || cancelledOn) {
    const endedOn = cancelledOn || (expiry === 'expired' ? toJstDate(rawExpiry) : null);
    return { state: CONTRACT_STATE.ENDED, endedOn };
  }

  return none;
}

/**
 * マイページに出す 1 行（固定文言）。active / none は null（何も出さない）。
 * @param {{state: string, endedOn: string|null}} cs
 * @returns {string|null}
 */
export function contractEndedNotice(cs) {
  if (!cs || (cs.state !== CONTRACT_STATE.LAPSED && cs.state !== CONTRACT_STATE.ENDED)) return null;
  const m = typeof cs.endedOn === 'string' ? cs.endedOn.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!m) return '有料プランのご契約期間は終了しました。';
  return `ご契約期間は${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日に終了しました。`;
}
