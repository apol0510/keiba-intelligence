/**
 * contractFields.js — マイページ表示用に、ログイン中の本人の契約列だけを Airtable から読む（読み取りのみ）
 *
 * 正本: docs/measurements/CONTRACT_ENDED_VISIBILITY_2026_10.md
 *
 * 🔴 email はサーバーが検証した署名付きセッションの値だけを渡すこと（クエリ・本文の申告は使わない）。
 * 🔴 返すのは契約状態の判定に要る列だけ（PlanType / Status / ExpirationDate / 有効期限 / CancelledAt）。
 *    他の列（氏名など）は呼び出し側へ渡さない。ログにも出さない。
 * 🔴 失敗・タイムアウト・設定なしは null（表示を出さないだけ。ページは従来どおり描く）。
 *    `fields[]` で列を絞らない: 列が無い base（CancelledAt 未作成）だと 422 で全体が読めなくなるため。
 */

import { escapeFormulaString, isValidEmail } from '../airtable/formula.js';

export const CONTRACT_FIELD_NAMES = Object.freeze(['PlanType', 'Status', 'ExpirationDate', '有効期限', 'CancelledAt']);

/**
 * @param {{email: string, env: Record<string, string|undefined>, fetchImpl?: Function, timeoutMs?: number}} opts
 * @returns {Promise<Record<string, unknown>|null>}
 */
export async function readContractFields({ email, env, fetchImpl, timeoutMs = 2500 } = {}) {
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
    for (const k of CONTRACT_FIELD_NAMES) if (k in f) out[k] = f[k];
    return out;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
