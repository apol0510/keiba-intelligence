/**
 * adminAuth.js — メルマガ配信管理 API の管理者認証と CORS（判定のみ・I/O を持たない）
 *
 * 対象: `create-broadcast` / `send-broadcast` / `send-test` / `get-broadcast` / `get-broadcasts`
 *
 * ── なぜあるか（registry e1f0c2ce）────────────────────────────────
 * 従来は **リクエスト body のメールアドレス**が `ADMIN_EMAILS` に含まれるかだけで
 * 管理者を判定していた。body は誰でも書けるので、管理者のアドレスを知っていれば
 * 有料会員への一斉配信を誰でも起動できた。しかも `ADMIN_EMAILS` が未設定だと
 * `''.split(',')` が `['']` になり、**空文字のアドレスで通ってしまう**。
 * `get-broadcast(s)` は認証なし・CORS `*` で、配信本文と作成者アドレスを誰でも読めた。
 *
 * ── 🔴 安全契約（ここを緩めない）─────────────────────────────────
 *  1. 管理者の証明は **サーバー側の秘密値（env `KI_ADMIN_API_KEY`）だけ**。
 *     body・クエリ・メールアドレスは証明に使わない。
 *  2. 秘密値は **ヘッダー（`X-KI-Admin-Key`）でのみ**受け取る。body / クエリは見ない
 *     （URL・アクセスログ・Referer に残さないため）。
 *  3. env が未設定・短すぎる（32 文字未満）なら **常に 403**（fail-closed）。
 *  4. 照合は **timing-safe**。長さの違いも漏らさないよう、SHA-256 にそろえてから比べる。
 *  5. 拒否理由はレスポンスに出さない（全て同じ 403 本文）。秘密値を log / レスポンスに含めない。
 *  6. CORS は **`*` を返さない**。KI 自身の origin（本番 / www、および同一ホスト）だけ。
 *     それ以外の `Origin` からのリクエストは鍵があっても 403。
 *
 * 既存の認証（セッション Cookie）は会員 tier（free / light / premium）しか持たず、
 * 管理者の概念が無い。そのため `uatLogin.js` / `previewMode.js` と同じ
 * 「env の合言葉を timing-safe に照合する」方式を、ヘッダー受け取りで採用した。
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { isAllowedSiteHost } from '../http/siteOrigin.js';

/** 秘密値を置く env のキー名（🔴 値は扱わない）。 */
export const ADMIN_API_KEY_ENV = 'KI_ADMIN_API_KEY';

/** 秘密値を受け取るヘッダー名（Netlify は小文字で渡す）。 */
export const ADMIN_KEY_HEADER = 'x-ki-admin-key';

/** これより短い秘密値は設定ミスとして扱い、成立させない。 */
export const ADMIN_KEY_MIN_LENGTH = 32;

/** CORS で許可する KI 自身の origin。 */
export const ADMIN_ALLOWED_ORIGINS = Object.freeze([
  'https://keiba-intelligence.jp',
  'https://www.keiba-intelligence.jp',
]);

/** 拒否理由（ログ用。レスポンスには出さない）。 */
export const ADMIN_DENY = Object.freeze({
  NOT_CONFIGURED: 'not_configured',
  MISSING_KEY: 'missing_key',
  INVALID_KEY: 'invalid_key',
  ORIGIN_FORBIDDEN: 'origin_forbidden',
});

/** 拒否時のレスポンス本文（理由を問わず同じ）。 */
export const ADMIN_FORBIDDEN_BODY = Object.freeze({ error: 'Forbidden: Admin access required' });

/** ヘッダーを大文字小文字を区別せずに読む。 */
export function readHeader(headers, name) {
  if (!headers || typeof headers !== 'object') return '';
  const want = String(name).toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (String(k).toLowerCase() === want) {
      if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : '';
      return typeof v === 'string' ? v : '';
    }
  }
  return '';
}

const sha256 = (s) => createHash('sha256').update(String(s), 'utf8').digest();

/** timing-safe 照合。どちらかが空・非文字列なら false。 */
export function adminKeyMatches(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  if (!provided || !expected) return false;
  return timingSafeEqual(sha256(provided), sha256(expected));
}

/** env の秘密値（前後空白は除く）。未設定・短すぎるなら null。 */
export function configuredAdminKey(env = {}) {
  const raw = env?.[ADMIN_API_KEY_ENV];
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  return v.length >= ADMIN_KEY_MIN_LENGTH ? v : null;
}

/**
 * 許可された origin なら、その origin 文字列を返す。許可しないなら null。
 * - 本番 / www
 * - リクエスト自身のホストと同じ origin（Deploy Preview・ローカル開発の同一オリジン呼び出し）
 */
export function allowedRequestOrigin(headers) {
  const origin = readHeader(headers, 'origin').trim();
  if (!origin) return null;
  if (ADMIN_ALLOWED_ORIGINS.includes(origin)) return origin;

  let url;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  const host = readHeader(headers, 'host').trim().toLowerCase();
  if (host && url.host.toLowerCase() === host && isAllowedSiteHost(url)) return url.origin;
  return null;
}

/** `Origin` ヘッダーが無い（ブラウザ以外・同一オリジン GET）か、許可された origin か。 */
export function isRequestOriginAllowed(headers) {
  const origin = readHeader(headers, 'origin').trim();
  if (!origin) return true;
  return allowedRequestOrigin(headers) !== null;
}

/** 管理 API の CORS ヘッダー。🔴 `*` は返さない。 */
export function adminCorsHeaders(headers, methods) {
  const out = {
    'Access-Control-Allow-Headers': 'Content-Type, X-KI-Admin-Key',
    'Access-Control-Allow-Methods': methods,
    Vary: 'Origin',
    'Cache-Control': 'no-store',
  };
  const origin = allowedRequestOrigin(headers);
  if (origin) out['Access-Control-Allow-Origin'] = origin;
  return out;
}

/**
 * 管理者として扱ってよいか。**I/O を持たない純関数。**
 *
 * @param {object} o
 * @param {object} o.headers  Netlify Functions の `event.headers`
 * @param {object} [o.env]    `KI_ADMIN_API_KEY` を含む env
 * @returns {{ ok: true } | { ok: false, reason: string, statusCode: 403 }}
 */
export function decideAdminAccess({ headers, env = {} } = {}) {
  const deny = (reason) => Object.freeze({ ok: false, reason, statusCode: 403 });

  const expected = configuredAdminKey(env);
  if (!expected) return deny(ADMIN_DENY.NOT_CONFIGURED);

  if (!isRequestOriginAllowed(headers)) return deny(ADMIN_DENY.ORIGIN_FORBIDDEN);

  const provided = readHeader(headers, ADMIN_KEY_HEADER).trim();
  if (!provided) return deny(ADMIN_DENY.MISSING_KEY);
  if (!adminKeyMatches(provided, expected)) return deny(ADMIN_DENY.INVALID_KEY);

  return Object.freeze({ ok: true });
}

/**
 * 管理 API の入口をまとめて処理する。
 *
 * - OPTIONS → 204（CORS ヘッダーのみ。許可 origin 以外には Allow-Origin を付けない）
 * - 許可メソッド以外 → 405
 * - 管理者でない → 403（**それ以降の処理・書き込み・送信は一切行わない**）
 *
 * @returns {{ headers: object, response: object|null }}
 *   `response` が null でなければ、呼び出し側はそれをそのまま返して終わること。
 */
export function guardAdminRequest(event, { method, env = {} } = {}) {
  const reqHeaders = event?.headers || {};
  const headers = adminCorsHeaders(reqHeaders, `${method}, OPTIONS`);
  const httpMethod = String(event?.httpMethod || '').toUpperCase();

  if (httpMethod === 'OPTIONS') {
    return { headers, response: { statusCode: 204, headers, body: '' } };
  }
  if (httpMethod !== method) {
    return {
      headers,
      response: { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) },
    };
  }

  const decision = decideAdminAccess({ headers: reqHeaders, env });
  if (!decision.ok) {
    console.warn('⚠️ admin API denied:', decision.reason);
    return {
      headers,
      response: { statusCode: 403, headers, body: JSON.stringify(ADMIN_FORBIDDEN_BODY) },
    };
  }
  return { headers, response: null };
}

/**
 * テスト送信の宛先として許可するアドレス（`ADMIN_EMAILS` と `ADMIN_EMAIL`）。
 * 🔴 これは **認証ではなく宛先の制限**。空文字は含めない（従来の `['']` 事故を防ぐ）。
 */
export function adminRecipientAllowlist(env = {}) {
  const list = [env?.ADMIN_EMAILS, env?.ADMIN_EMAIL]
    .filter((v) => typeof v === 'string')
    .flatMap((v) => v.split(','))
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0 && s.includes('@'));
  return [...new Set(list)];
}

/** 宛先が許可リストに含まれるか（大文字小文字は区別しない）。 */
export function isAllowedTestRecipient(email, env = {}) {
  if (typeof email !== 'string' || !email.trim()) return false;
  return adminRecipientAllowlist(env).includes(email.trim().toLowerCase());
}
