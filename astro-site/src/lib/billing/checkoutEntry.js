/**
 * checkoutEntry.js — Stripe Checkout の metadata `ki_entry`（どの状態の顧客が申し込んだか）を決める
 *
 * 正本: docs/measurements/CHECKOUT_ATTRIBUTION_2026_10.md
 *
 * 背景（2026-10-20）:
 *   GA4 は読めず、Checkout には ki_plan / ki_email / ki_price_id しか無いため、
 *   「新規登録直後の人・無料会員・元会員（期限切れ / 退会）のどこから購入が来ているか」を
 *   Stripe 側で集計できなかった（9 月売上 ¥31,840・再契約の把握ができない）。
 *
 * 🔴 値は固定の列挙値だけ（new | free | pending | lapsed | withdrawn）。分類できなければ **付けない**。
 *    email・顧客 ID・日付など個人に結びつく値・自由文を ki_entry に入れない。
 * 🔴 判定はサーバー側の顧客レコード（署名付きセッションの email で読む）だけ。クライアントの申告は使わない。
 * 🔴 表示・計測専用。課金・権限（tier）・価格の判定には使わない。読み取りに失敗しても Checkout は止めない。
 *    有料の閲覧権の判定は paidEntitlement.js を呼ぶだけで、条件を複製・変更しない。
 */

import { TIER, planTypeToTier, tierAtLeast } from '../auth/tiers.js';
import { customerSessionTier, isPaidPlanType, isPaidStatus, expiryState } from '../auth/paidEntitlement.js';
import { escapeFormulaString, isValidEmail } from '../airtable/formula.js';

export const CHECKOUT_ENTRY = Object.freeze({
  /** 無料登録から 24 時間以内（登録 → 確認 → そのまま申込） */
  NEW: 'new',
  /** 無料会員（登録から 24 時間超） */
  FREE: 'free',
  /** 確認・入金確認前（Status=pending。銀行振込の申込直後など） */
  PENDING: 'pending',
  /** 有料プラン・契約中 Status のまま有効期限が過ぎた元会員 */
  LAPSED: 'lapsed',
  /** 契約終了・退会の記録がある元会員（Status=inactive / CancelledAt） */
  WITHDRAWN: 'withdrawn',
});

export const CHECKOUT_ENTRY_VALUES = Object.freeze(Object.values(CHECKOUT_ENTRY));

export const NEW_WINDOW_MS = 24 * 60 * 60 * 1000;

/** 分類に使う列（これ以外は読み取り結果から捨てる）。 */
export const ENTRY_FIELD_NAMES = Object.freeze(['PlanType', 'Status', 'ExpirationDate', '有効期限', 'CancelledAt', 'CreatedAt']);

/**
 * @param {object|null|undefined} fields Airtable Customers の fields
 * @param {number} nowMs
 * @returns {'new'|'free'|'pending'|'lapsed'|'withdrawn'|null} 分類できない（有料の閲覧権がある・不明）なら null
 */
export function checkoutEntryOf(fields, nowMs) {
  if (!fields || typeof fields !== 'object') return null;
  const f = fields;

  // 有料の閲覧権がある人のプラン変更は対象外（列挙値に無い）
  if (tierAtLeast(customerSessionTier(f, nowMs), TIER.LIGHT)) return null;

  if (f.Status === 'pending') return CHECKOUT_ENTRY.PENDING;

  const hasCancelled = typeof f.CancelledAt === 'string' && Number.isFinite(Date.parse(f.CancelledAt));
  if (f.Status === 'inactive' || hasCancelled) return CHECKOUT_ENTRY.WITHDRAWN;

  const expiry = expiryState(f.ExpirationDate || f['有効期限'] || null, nowMs);
  if (isPaidPlanType(f.PlanType) && isPaidStatus(f.Status) && expiry === 'expired') return CHECKOUT_ENTRY.LAPSED;

  if (f.Status === 'active' && !tierAtLeast(planTypeToTier(f.PlanType || 'free-registered'), TIER.LIGHT)) {
    const created = typeof f.CreatedAt === 'string' ? Date.parse(f.CreatedAt) : NaN;
    if (Number.isFinite(created) && created <= nowMs && nowMs - created <= NEW_WINDOW_MS) return CHECKOUT_ENTRY.NEW;
    return CHECKOUT_ENTRY.FREE;
  }
  return null;
}

/**
 * Checkout の metadata に足すもの。列挙値以外は何も足さない。
 * @param {unknown} entry
 * @returns {{ki_entry?: string}}
 */
export function entryMetadata(entry) {
  return typeof entry === 'string' && CHECKOUT_ENTRY_VALUES.includes(entry) ? { ki_entry: entry } : {};
}

/**
 * セッションの email で Customers を 1 件読み、分類に使う列だけ返す（読み取りのみ）。失敗・タイムアウトは null。
 * `fields[]` で絞らない（列が無い base だと 422 で全体が読めなくなるため）。
 * @param {{email: string, env: Record<string, string|undefined>, fetchImpl?: Function, timeoutMs?: number}} opts
 */
export async function readEntryFields({ email, env, fetchImpl, timeoutMs = 2000 } = {}) {
  const apiKey = env?.AIRTABLE_API_KEY;
  const baseId = env?.AIRTABLE_BASE_ID;
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!apiKey || !baseId || !doFetch || !isValidEmail(email)) return null;

  const formula = encodeURIComponent(`{Email} = "${escapeFormulaString(email)}"`);
  const url = `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/Customers?maxRecords=1&filterByFormula=${formula}`;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await doFetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      ...(ctrl ? { signal: ctrl.signal } : {}),
    });
    if (!res || !res.ok) return null;
    const data = await res.json();
    const f = data?.records?.[0]?.fields;
    if (!f || typeof f !== 'object') return null;
    const out = {};
    for (const k of ENTRY_FIELD_NAMES) if (k in f) out[k] = f[k];
    return out;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
