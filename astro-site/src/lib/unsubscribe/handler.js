/**
 * 配信停止ページの要求処理（純粋・I/O は注入）
 *
 * 🔴 GET は**確認画面を出すだけ**。解除は POST でのみ確定する。
 * 🔴 失敗理由は画面へ出さない（`OUTCOME` の区分のみ）。
 * 🔴 email / recipientRef を画面へ出さない。
 */

import {
  OUTCOME, verifyUnsubscribeToken, operationId,
  issueCsrfToken, verifyCsrfToken, buildAuditEntry,
} from './token.js';
import { STORE_RESULT } from './store.js';

export const CSRF_COOKIE_NAME = 'ki_unsub_csrf';

/** rate limit の既定（未認証エンドポイント）。 */
export const RATE_LIMIT = Object.freeze({ GET: 30, POST: 10, WINDOW_MS: 10 * 60 * 1000 });

/** 画面表示に必要な最小情報（🔴 PII を含めない）。 */
function view(outcome, extra = {}) {
  return Object.freeze({ outcome, ...extra });
}

/**
 * GET: 確認画面の内容を決める。
 *
 * @param {object} o
 * @param {string|null} o.token
 * @param {string} o.secret
 * @param {number} o.nowMs
 * @param {object} o.rateLimiter
 * @param {string} o.clientKey   🔴 email を使わない（IP など）
 * @returns {{status:number, view:object, csrf:{token:string, cookie:string}|null, audit:object}}
 */
export function handleGet({ token, secret, nowMs, rateLimiter, clientKey } = {}) {
  const rl = rateLimiter.tryConsume(`get:${clientKey}`, nowMs);
  if (!rl.allowed) {
    return Object.freeze({
      status: 429, view: view(OUTCOME.INVALID, { rateLimited: true }), csrf: null,
      audit: buildAuditEntry({ outcome: 'rate_limited', atMs: nowMs }),
    });
  }

  const v = verifyUnsubscribeToken({ token, secret, nowMs });
  if (!v.ok) {
    // 🔴 expired と invalid だけを区別して見せる（内部理由は出さない）
    return Object.freeze({
      status: v.outcome === OUTCOME.EXPIRED ? 410 : 400,
      view: view(v.outcome), csrf: null,
      audit: buildAuditEntry({ outcome: v.outcome, atMs: nowMs }),
    });
  }

  const csrf = issueCsrfToken({ unsubscribeToken: token, nowMs, secret });
  return Object.freeze({
    status: 200,
    view: view(OUTCOME.CONFIRMABLE, { scope: v.claims.scope }),
    csrf: Object.freeze({ token: csrf, cookie: buildCsrfCookie(csrf) }),
    audit: buildAuditEntry({ operationId: operationId(v.claims), outcome: OUTCOME.CONFIRMABLE, atMs: nowMs }),
  });
}

/**
 * POST: 解除を確定する。
 *
 * @param {object} o
 * @param {string|null} o.token
 * @param {string|null} o.csrfForm
 * @param {string|null} o.csrfCookie
 * @param {string} o.secret
 * @param {number} o.nowMs
 * @param {object} o.rateLimiter
 * @param {string} o.clientKey
 * @param {object} o.store        `apply({operationId, recipientRef, scope, campaignId, nowMs})`
 * @returns {Promise<{status:number, view:object, audit:object}>}
 */
export async function handlePost({
  token, csrfForm, csrfCookie, secret, nowMs, rateLimiter, clientKey, store,
} = {}) {
  const rl = rateLimiter.tryConsume(`post:${clientKey}`, nowMs);
  if (!rl.allowed) {
    return Object.freeze({
      status: 429, view: view(OUTCOME.INVALID, { rateLimited: true }),
      audit: buildAuditEntry({ outcome: 'rate_limited', atMs: nowMs }),
    });
  }

  const v = verifyUnsubscribeToken({ token, secret, nowMs });
  if (!v.ok) {
    return Object.freeze({
      status: v.outcome === OUTCOME.EXPIRED ? 410 : 400,
      view: view(v.outcome),
      audit: buildAuditEntry({ outcome: v.outcome, atMs: nowMs }),
    });
  }

  // 🔴 CSRF は token 検証の**後**に見る（どちらも fail-closed）
  const csrf = verifyCsrfToken({
    formValue: csrfForm, cookieValue: csrfCookie, unsubscribeToken: token, nowMs, secret,
  });
  if (!csrf.ok) {
    return Object.freeze({
      status: 403, view: view(OUTCOME.INVALID),
      audit: buildAuditEntry({ outcome: 'csrf_rejected', atMs: nowMs }),
    });
  }

  const opId = operationId(v.claims);
  const applied = await store.apply({
    operationId: opId,
    recipientRef: v.claims.recipientRef,
    scope: v.claims.scope,
    campaignId: v.claims.campaignId,
    nowMs,
  });

  if (applied.result === STORE_RESULT.UNAVAILABLE) {
    // 🔴 解除できていないのに「完了」と表示しない
    return Object.freeze({
      status: 503, view: view(OUTCOME.INVALID, { temporarilyUnavailable: true }),
      audit: buildAuditEntry({ operationId: opId, outcome: 'unavailable', atMs: nowMs }),
    });
  }

  const outcome = applied.result === STORE_RESULT.ALREADY
    ? OUTCOME.ALREADY_UNSUBSCRIBED
    : OUTCOME.COMPLETED;

  return Object.freeze({
    status: 200, view: view(outcome),
    audit: buildAuditEntry({ operationId: opId, outcome, atMs: nowMs }),
  });
}

/** CSRF cookie（HttpOnly・SameSite=Lax・Secure・パス限定）。 */
export function buildCsrfCookie(value) {
  return `${CSRF_COOKIE_NAME}=${value}; Path=/unsubscribe; HttpOnly; Secure; SameSite=Lax; Max-Age=1800`;
}

/** cookie ヘッダから CSRF 値を取り出す。 */
export function readCsrfCookie(cookieHeader) {
  if (typeof cookieHeader !== 'string' || !cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === CSRF_COOKIE_NAME) return rest.join('=') || null;
  }
  return null;
}
