/**
 * uatLogin.js — 恒久 UAT 環境の専用ログイン（判定のみ・I/O を持たない）
 *
 * 正本: docs/UAT_PERMANENT_ENV.md
 *
 * ── 何のためにあるか ──────────────────────────────────────────────
 * 管理者が **実ユーザー体験を定期的に目視確認する**ための、UAT 環境限定の
 * ログイン経路。UAT では magic link を使えない（`previewMailGuard` が
 * プレビュー系ホストの送信をすべて 503 で止める。production SendGrid の
 * バウンス事故を防ぐ安全契約なので緩めない）。
 *
 * ── 🔴 安全契約（ここを緩めない）─────────────────────────────────
 *  1. **本番ホストでは常に無効。** `isPreviewHost()` が false なら、
 *     メソッドを問わず 404。エンドポイントの存在自体を本番に晒さない。
 *  2. **合言葉 env（`UAT_LOGIN_KEY`）が未設定なら成立しない**（fail-closed / 503）。
 *  3. **合言葉は URL に載せない。** 受け取りは POST の body のみ。
 *     GET は合言葉を受け付けず、フォームを返すだけ（クエリ・履歴・
 *     Referer・アクセスログに合言葉を残さないため）。
 *  4. 合言葉の照合は **timing-safe**。長さが違えば即座に拒否する。
 *  5. 不一致は **404**（「合言葉が違う」と教えない）。
 *  6. 🔴 **発行できるのは固定 1 アドレスの `free` セッションだけ。**
 *     宛先メールも tier も**リクエストから受け取らない**。
 *     この関数は **有料 tier を発行できない**。premium は必ず
 *     Test Mode の実決済 → `stripe-webhook` → `refresh-session` を
 *     通ってのみ成立する（＝確認したい体験そのものを迂回しない）。
 *  7. 合言葉を message / log / レスポンスに含めない。
 *
 * ── なぜホスト名で判定するか ─────────────────────────────────────
 * `previewMode.js` と同じ理由。Netlify の `CONTEXT` はビルド時変数で
 * SSR 関数のランタイムで確実に読める保証がないが、ホスト名は Netlify の
 * ルーティングそのものなので判定が実態とずれない。
 */

import { timingSafeEqual } from 'node:crypto';
import { isPreviewHost } from './previewMode.js';
import { TIER } from './tiers.js';

/** 合言葉を置く env のキー名（🔴 値は扱わない）。 */
export const UAT_LOGIN_KEY_ENV = 'UAT_LOGIN_KEY';

/**
 * 🔴 発行先の固定アドレス。**リクエストから受け取らない。**
 * UAT base の `Customers` にこのアドレスの行を 1 件だけ作る。
 */
export const UAT_MEMBER_EMAIL = 'uat@keiba-intelligence.jp';

/**
 * 🔴 発行する tier。**free 固定。**
 * ここを premium にすると「決済を通さずに有料が見える」ようになり、
 * UAT で確認したい体験そのものを壊す。
 */
export const UAT_LOGIN_TIER = TIER.FREE;

/** 判定結果。 */
export const UAT_OUTCOME = Object.freeze({
  /** 本番ホスト / 合言葉不一致。存在しないものとして扱う。 */
  NOT_FOUND: 'not_found',
  /** 合言葉 env が未設定。fail-closed。 */
  NOT_CONFIGURED: 'not_configured',
  /** GET。合言葉を受け付けず、フォームだけ返す。 */
  FORM: 'form',
  /** POST かつ合言葉一致。セッションを発行してよい。 */
  OK: 'ok',
  /** GET / POST 以外。 */
  METHOD_NOT_ALLOWED: 'method_not_allowed',
});

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

/** 合言葉の timing-safe 照合。未設定・空・不一致はすべて false。 */
export function uatKeyMatches(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * UAT ログインの判定。**I/O を持たない純関数。**
 *
 * @param {object} o
 * @param {string} o.host           リクエストの Host ヘッダー
 * @param {string} o.method         HTTP メソッド
 * @param {object} [o.env]          `UAT_LOGIN_KEY` を含む env
 * @param {string|null} [o.providedKey] POST body から取り出した合言葉
 * @returns {{ outcome: string, statusCode: number }}
 */
export function decideUatLogin({ host, method, env = {}, providedKey = null } = {}) {
  const done = (outcome, statusCode) => Object.freeze({ outcome, statusCode });

  // 契約 1: 本番ホストでは、メソッドを問わず存在しないものとして扱う
  if (!isPreviewHost(host)) return done(UAT_OUTCOME.NOT_FOUND, 404);

  // 契約 2: 合言葉 env が未設定なら成立しない
  const expected = env?.[UAT_LOGIN_KEY_ENV];
  if (!isNonEmptyString(expected)) return done(UAT_OUTCOME.NOT_CONFIGURED, 503);

  const m = typeof method === 'string' ? method.toUpperCase() : '';

  // 契約 3: GET は合言葉を受け付けない。フォームを返すだけ
  if (m === 'GET') return done(UAT_OUTCOME.FORM, 200);

  if (m !== 'POST') return done(UAT_OUTCOME.METHOD_NOT_ALLOWED, 405);

  // 契約 4 / 5: timing-safe 照合。不一致は 404
  if (!uatKeyMatches(providedKey, expected.trim())) return done(UAT_OUTCOME.NOT_FOUND, 404);

  return done(UAT_OUTCOME.OK, 302);
}

/**
 * POST body から合言葉を取り出す。
 * `application/x-www-form-urlencoded`（HTML フォーム）と JSON の両方を受ける。
 * 🔴 クエリ文字列は**見ない**（契約 3）。
 *
 * @returns {string|null}
 */
export function extractUatKey(body, contentType = '') {
  if (typeof body !== 'string' || body.length === 0) return null;
  const ct = typeof contentType === 'string' ? contentType.toLowerCase() : '';

  if (ct.includes('application/json')) {
    try {
      const parsed = JSON.parse(body);
      const v = parsed?.key;
      return isNonEmptyString(v) ? v : null;
    } catch {
      return null;
    }
  }

  try {
    const v = new URLSearchParams(body).get('key');
    return isNonEmptyString(v) ? v : null;
  } catch {
    return null;
  }
}
