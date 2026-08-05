/**
 * 配信停止 token の検証（`unsub-v1`）— 純粋・fail-closed
 *
 * 🔴 この実装は **KMA（keiba-marketing-automation）が定義する契約の検証側**である。
 *    正本: keiba-marketing-automation の `engine/tenancy/policy/unsubscribe-token.js`
 *    署名材料・claims・version を**片側だけ変更してはならない**。
 *
 * 🔴 設計要件（KMA 契約と同一）:
 *   - メールアドレスを URL へ平文で含めない（token は `recipientRef` のみを持つ）
 *   - `tenantId` をブラウザ入力だけで信用しない（server 側の期待値と照合する）
 *   - 署名検証は timing-safe
 *   - 改竄 / 期限切れ / tenant 不一致 / 未知 version / 壊れた形式 は **すべて拒否**
 *   - 失敗理由を画面へ出さない（利用者へは `USER_FACING_OUTCOME` の区分のみ）
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** 🔴 KMA と一致させる。片側だけ上げない。 */
export const UNSUBSCRIBE_TOKEN_VERSION = 'unsub-v1';

/** この解除ページが担当する tenant。🔴 URL や payload から取らない。 */
export const EXPECTED_TENANT_ID = 'keiba-intelligence';

export const UNSUBSCRIBE_SCOPE = Object.freeze({
  MARKETING_ALL: 'marketing-all',
  CAMPAIGN: 'campaign',
});

const KNOWN_SCOPES = Object.freeze(Object.values(UNSUBSCRIBE_SCOPE));

/** 内部用の失敗理由（🔴 画面へ出さない）。 */
export const REJECT = Object.freeze({
  OK: 'ok',
  MALFORMED: 'malformed',
  VERSION_UNKNOWN: 'version_unknown',
  TENANT_MISSING: 'tenant_missing',
  TENANT_MISMATCH: 'tenant_mismatch',
  RECIPIENT_MISSING: 'recipient_missing',
  SCOPE_UNKNOWN: 'scope_unknown',
  NONCE_MISSING: 'nonce_missing',
  ISSUED_AT_MISSING: 'issued_at_missing',
  EXPIRES_AT_MISSING: 'expires_at_missing',
  SECRET_MISSING: 'secret_missing',
  SIGNATURE_INVALID: 'signature_invalid',
  EXPIRED: 'expired',
  NOT_YET_VALID: 'not_yet_valid',
  TIME_UNKNOWN: 'time_unknown',
});

/** 画面に出してよい区分（🔴 これ以外を利用者へ見せない）。 */
export const OUTCOME = Object.freeze({
  CONFIRMABLE: 'confirmable',
  EXPIRED: 'expired',
  INVALID: 'invalid',
  ALREADY_UNSUBSCRIBED: 'already-unsubscribed',
  COMPLETED: 'completed',
});

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

/** 🔴 KMA 側と同一の材料組み立て（区切りは NUL。ソースでは必ずエスケープ表記で書く）。 */
export function canonicalizeClaims(c) {
  return [
    UNSUBSCRIBE_TOKEN_VERSION,
    c.tenantId,
    c.recipientRef,
    c.scope,
    c.campaignId ?? '',
    String(c.issuedAtMs),
    String(c.expiresAtMs),
    c.nonce,
  ].join('\u0000');
}

/**
 * token を検証する。
 *
 * @param {object} o
 * @param {string} o.token
 * @param {string} o.secret            env から解決した tenant 専用 secret
 * @param {number} o.nowMs
 * @param {string} [o.expectedTenantId]
 * @returns {{ok:boolean, reason:string, outcome:string, claims:object|null}}
 */
export function verifyUnsubscribeToken({
  token, secret, nowMs, expectedTenantId = EXPECTED_TENANT_ID,
} = {}) {
  const deny = (reason, outcome = OUTCOME.INVALID) =>
    Object.freeze({ ok: false, reason, outcome, claims: null });

  if (!isNonEmptyString(expectedTenantId)) return deny(REJECT.TENANT_MISSING);
  if (!isNonEmptyString(secret)) return deny(REJECT.SECRET_MISSING);
  if (!isNonEmptyString(token)) return deny(REJECT.MALFORMED);

  const parts = token.trim().split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return deny(REJECT.MALFORMED);

  let claims;
  try {
    claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    return deny(REJECT.MALFORMED);
  }
  if (!claims || typeof claims !== 'object') return deny(REJECT.MALFORMED);
  if (claims.v !== UNSUBSCRIBE_TOKEN_VERSION) return deny(REJECT.VERSION_UNKNOWN);

  if (!isNonEmptyString(claims.tenantId)) return deny(REJECT.TENANT_MISSING);
  // 🔴 他 tenant（例: 別ブランド）の token をこのページで処理しない。
  //    どの tenant かは利用者へ教えない（invalid へ丸める）。
  if (claims.tenantId !== expectedTenantId.trim()) return deny(REJECT.TENANT_MISMATCH);
  if (!isNonEmptyString(claims.recipientRef)) return deny(REJECT.RECIPIENT_MISSING);
  if (!KNOWN_SCOPES.includes(claims.scope)) return deny(REJECT.SCOPE_UNKNOWN);
  if (!isNonEmptyString(claims.nonce)) return deny(REJECT.NONCE_MISSING);
  if (!Number.isFinite(claims.issuedAtMs)) return deny(REJECT.ISSUED_AT_MISSING);
  if (!Number.isFinite(claims.expiresAtMs)) return deny(REJECT.EXPIRES_AT_MISSING);

  // 🔴 署名を期限より先に検証する（改竄された期限を信用しない）
  const expected = createHmac('sha256', secret).update(canonicalizeClaims(claims), 'utf8').digest('base64url');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(parts[1], 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return deny(REJECT.SIGNATURE_INVALID);

  if (!Number.isFinite(nowMs)) return deny(REJECT.TIME_UNKNOWN);
  if (nowMs > claims.expiresAtMs) return deny(REJECT.EXPIRED, OUTCOME.EXPIRED);
  if (nowMs < claims.issuedAtMs) return deny(REJECT.NOT_YET_VALID);

  return Object.freeze({
    ok: true, reason: REJECT.OK, outcome: OUTCOME.CONFIRMABLE, claims: Object.freeze({ ...claims }),
  });
}

/** 冪等キー。🔴 tenant 込み・email を含まない。 */
export function operationId(claims) {
  return `${claims.tenantId}/unsubscribe/${claims.scope}/${claims.recipientRef}/${claims.nonce}`;
}

// ── CSRF（double-submit ＋ 署名・unsubscribe token に束縛） ──────────────────

export const CSRF_REJECT = Object.freeze({
  OK: 'ok', MISSING: 'missing', MISMATCH: 'mismatch', INVALID: 'invalid', EXPIRED: 'expired',
});

export const CSRF_TTL_MS = 30 * 60 * 1000;

export function issueCsrfToken({ unsubscribeToken, nowMs, secret, ttlMs = CSRF_TTL_MS } = {}) {
  if (!isNonEmptyString(unsubscribeToken) || !isNonEmptyString(secret) || !Number.isFinite(nowMs)) {
    throw new Error('issueCsrfToken: invalid arguments');
  }
  const exp = nowMs + ttlMs;
  const sig = createHmac('sha256', secret)
    .update(['csrf-v1', unsubscribeToken, String(exp)].join('\u0000'), 'utf8').digest('base64url');
  return `${exp}.${sig}`;
}

export function verifyCsrfToken({ formValue, cookieValue, unsubscribeToken, nowMs, secret } = {}) {
  const deny = (reason) => Object.freeze({ ok: false, reason });
  if (!isNonEmptyString(formValue) || !isNonEmptyString(cookieValue)) return deny(CSRF_REJECT.MISSING);
  if (!isNonEmptyString(secret) || !isNonEmptyString(unsubscribeToken)) return deny(CSRF_REJECT.INVALID);

  const f = Buffer.from(formValue.trim(), 'utf8');
  const c = Buffer.from(cookieValue.trim(), 'utf8');
  if (f.length !== c.length || !timingSafeEqual(f, c)) return deny(CSRF_REJECT.MISMATCH);

  const parts = formValue.trim().split('.');
  if (parts.length !== 2) return deny(CSRF_REJECT.INVALID);
  const exp = Number(parts[0]);
  if (!Number.isFinite(exp)) return deny(CSRF_REJECT.INVALID);

  const expected = createHmac('sha256', secret)
    .update(['csrf-v1', unsubscribeToken, String(exp)].join('\u0000'), 'utf8').digest('base64url');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(parts[1], 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return deny(CSRF_REJECT.INVALID);

  if (!Number.isFinite(nowMs) || nowMs > exp) return deny(CSRF_REJECT.EXPIRED);
  return Object.freeze({ ok: true, reason: CSRF_REJECT.OK });
}

// ── rate limit（未認証エンドポイント向け・固定窓） ──────────────────────────

export function createFixedWindowRateLimiter({ limit, windowMs } = {}) {
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('rate limiter: limit must be > 0');
  if (!Number.isInteger(windowMs) || windowMs <= 0) throw new Error('rate limiter: windowMs must be > 0');
  const buckets = new Map();
  return Object.freeze({
    tryConsume(key, nowMs) {
      if (!isNonEmptyString(key) || !Number.isFinite(nowMs)) throw new Error('tryConsume: invalid arguments');
      const start = Math.floor(nowMs / windowMs) * windowMs;
      const cur = buckets.get(key);
      if (!cur || cur.windowStart !== start) {
        buckets.set(key, { windowStart: start, count: 1 });
        return Object.freeze({ allowed: true, retryAfterMs: 0 });
      }
      if (cur.count >= limit) return Object.freeze({ allowed: false, retryAfterMs: start + windowMs - nowMs });
      cur.count += 1;
      return Object.freeze({ allowed: true, retryAfterMs: 0 });
    },
  });
}

/**
 * 監査ログ 1 行（🔴 PII を含めない）。
 * `operationId` はそのまま出さず hash 化して相関のみ取れるようにする。
 */
export function buildAuditEntry({ operationId: opId, outcome, atMs, tenantId = EXPECTED_TENANT_ID } = {}) {
  const correlationId = isNonEmptyString(opId)
    ? createHmac('sha256', 'audit-correlation-v1').update(opId, 'utf8').digest('hex').slice(0, 16)
    : null;
  return Object.freeze({ tenantId, correlationId, outcome, atMs });
}
