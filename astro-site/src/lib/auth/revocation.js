/**
 * revocation.js — 退会（有料契約の終了）時に、発行済みの有料セッションを無効にする
 *
 * 正本: docs/WITHDRAWAL_2026_10.md §4
 *
 * 背景:
 *   `ki_session` は **発行時点の tier を署名して固定**している（最長 7 日）。
 *   そのため Stripe の契約を即時終了して Airtable を free に戻しても、
 *   退会操作をしなかった別の端末の Cookie は premium のまま残り、有料ページを見られてしまう。
 *   「退会したら残り期間があっても即時利用不可」（2026-10-06 MK 確定）を満たすため、
 *   退会の時刻をサーバー側に記録し、それ以前に発行された有料セッションを free として扱う。
 *
 * 記録（Netlify Blobs `ki-entitlement-revocations`、key = email の SHA-256）:
 *   { revokedAtMs, confirmed, subscriptionId }
 *     - revokedAtMs   … これ以前に発行された有料セッションは free として扱う
 *     - confirmed     … webhook が会員状態（Airtable）を free に反映済みか。
 *                       false の間は Airtable がまだ premium のことがあるので、
 *                       新しいセッションを発行する側（ログイン・refresh）も有料 tier を出さない
 *     - subscriptionId… どの契約の終了か（webhook の重複・取り違え防止）
 *
 * 🔴 email そのものは保存しない（key はハッシュ、値に email を入れない）。
 * 🔴 ここで扱うのは **降格だけ**。この記録から有料 tier が生まれることはない。
 * 🔴 Blobs が読めないときは **Cookie / Airtable の tier をそのまま使う**（ログを残す）。
 *    退会した端末そのものは退会応答で free の Cookie に差し替えるので、この経路に依存しない。
 */

import { createHash } from 'node:crypto';
import { TIER, tierAtLeast } from './tiers.js';

export const REVOCATION_STORE = 'ki-entitlement-revocations';

/** email → 記録のキー。大文字小文字・前後空白の違いで別人にしない。 */
export function revocationKey(email) {
  const norm = String(email || '').trim().toLowerCase();
  if (!norm) return null;
  return `v1-${createHash('sha256').update(norm, 'utf8').digest('hex')}`;
}

/** 有料 tier（light 以上）か。 */
export function isPaidTier(tier) {
  return tierAtLeast(tier, TIER.LIGHT);
}

/** 記録の形を検査する。壊れていれば null（＝記録なし扱い）。 */
export function parseRevocation(raw) {
  if (!raw) return null;
  let v = raw;
  if (typeof raw === 'string') {
    try { v = JSON.parse(raw); } catch { return null; }
  }
  if (!v || typeof v !== 'object' || !Number.isFinite(v.revokedAtMs) || v.revokedAtMs <= 0) return null;
  return {
    revokedAtMs: v.revokedAtMs,
    confirmed: v.confirmed === true,
    subscriptionId: typeof v.subscriptionId === 'string' ? v.subscriptionId : null,
  };
}

/**
 * 発行済みセッションの tier を、退会記録で補正する（ページ・API の認可側）。
 * 🔴 有料 tier で、退会時刻以前に発行されたものだけを free にする。
 */
export function tierAfterRevocation({ tier, issuedAtMs }, revocation) {
  if (!revocation || !isPaidTier(tier)) return tier;
  if (!Number.isFinite(issuedAtMs) || issuedAtMs <= revocation.revokedAtMs) return TIER.FREE;
  return tier;
}

/**
 * これから発行するセッションの tier を補正する（ログイン・refresh-session の発行側）。
 * 🔴 webhook が会員状態を反映するまで（confirmed=false）は、Airtable が premium でも有料を出さない。
 *    反映後は Airtable が正（再契約で premium に戻った人を落とさない）。
 */
export function tierForNewSession(tier, revocation) {
  if (!revocation || !isPaidTier(tier)) return tier;
  return revocation.confirmed ? tier : TIER.FREE;
}

/**
 * 記録の次の値を作る（純関数）。
 *   - 退会操作（stripe-subscription）: confirmed=false で書く
 *   - webhook（契約終了）: 同じ契約の記録があれば時刻を保ったまま confirmed=true、
 *     無ければ（ポータル・管理画面・期間末の終了など）いまの時刻で confirmed=true
 *   - webhook（新規契約）: 既存記録を confirmed=true にする（時刻は変えない）
 */
export function nextRevocation(prev, { kind, nowMs, subscriptionId = null }) {
  const p = parseRevocation(prev);
  if (kind === 'withdraw') {
    return { revokedAtMs: nowMs, confirmed: false, subscriptionId };
  }
  if (kind === 'ended') {
    if (p && subscriptionId && p.subscriptionId === subscriptionId) {
      return { ...p, confirmed: true };
    }
    return { revokedAtMs: Math.max(nowMs, p?.revokedAtMs || 0), confirmed: true, subscriptionId };
  }
  if (kind === 'started') {
    return p ? { ...p, confirmed: true } : null;
  }
  throw new Error(`unknown revocation kind: ${kind}`);
}

/**
 * Blobs のストアを開く。
 * v1 関数（Lambda 互換）は `event.blobs` から connectLambda で環境をつなぐ必要がある。
 * Astro SSR（v2）は event を渡さなくてよい。
 */
export async function openRevocationStore(event) {
  const { getStore, connectLambda } = await import('@netlify/blobs');
  if (event?.blobs && typeof connectLambda === 'function') connectLambda(event);
  return getStore(REVOCATION_STORE);
}

/**
 * 記録を読む。🔴 読めなければ null を返し、理由をログに残す（呼び出し側は現状の tier を使う）。
 * @returns {Promise<{revocation: object|null, ok: boolean}>}
 */
export async function readRevocation(email, { event, store } = {}) {
  const key = revocationKey(email);
  if (!key) return { revocation: null, ok: true };
  try {
    const s = store || await openRevocationStore(event);
    const raw = await s.get(key);
    return { revocation: parseRevocation(raw), ok: true };
  } catch (err) {
    console.error('⚠️ revocation: read failed:', err?.name || 'error');
    return { revocation: null, ok: false };
  }
}

/**
 * 記録を更新する。🔴 失敗は throw する（呼び出し側が再送・ログを決める）。
 * @returns {Promise<object|null>} 書いた値（書く必要が無ければ null）
 */
export async function updateRevocation(email, change, { event, store } = {}) {
  const key = revocationKey(email);
  if (!key) return null;
  const s = store || await openRevocationStore(event);
  const prev = await s.get(key);
  const next = nextRevocation(prev, change);
  if (!next) return null;
  await s.set(key, JSON.stringify(next));
  return next;
}
