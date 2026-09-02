/**
 * purchaseIntent.js — 「購入するつもりだった」を認証をまたいで安全に持ち越す
 *
 * 正本: docs/RENEWAL_2026_08.md §6（課金）/ §7（認可）
 *
 * 背景:
 *   未ログインで「このプランを申し込む」を押すと Checkout が 401 になり、
 *   `/login` へ飛ばされて **購入導線が途切れて**いた。
 *   登録 → 認証 → Checkout を 1 本に繋ぐため、購入意図を持ち越す。
 *
 * 🔴 **URL は持ち越さない。** 持ち越すのは **プラン id だけ**である。
 *    戻り先のパスは受け取った値から作らず、**サーバー側が固定文字列で決める**。
 *    URL を受け取って飛ばす作りにすると open redirect になる。
 *
 * 🔴 認証・認可の契約は変えない。
 *    - Checkout は従来どおり **セッションのある利用者だけ**
 *    - email は **セッション由来**のものだけを使う（意図には含めない）
 *    - 意図があっても tier は変わらない。付与は Stripe の webhook だけが行う
 */

import { PLANS } from './plans.js';

/** 意図を運ぶクエリ名（マジックリンク・戻り先の両方で使う）。 */
export const INTENT_PARAM = 'intent';
/** 認証後に「購入を再開する」ことを示す戻り先のクエリ名。 */
export const RESUME_PARAM = 'resume';

/**
 * 購入意図として受け付けるプラン id か。
 * 🔴 `plans.js` に定義があるものだけ。保留中・未知の id は受け付けない。
 */
export function isPurchasableIntent(planId) {
  if (typeof planId !== 'string' || !planId.trim()) return false;
  return PLANS.some((p) => p.id === planId.trim());
}

/**
 * 入力を正規化する。受け付けられない値は **null**（意図なし扱い）。
 * 🔴 ここで弾いておけば、以降どこにも未検証の値が流れない。
 */
export function normalizeIntent(value) {
  if (Array.isArray(value)) return null;
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return isPurchasableIntent(v) ? v : null;
}

/**
 * マジックリンクへ付ける意図のクエリ（先頭の `&` を含む）。
 * 意図が無ければ空文字（＝従来どおりのリンク）。
 */
export function intentQuery(planId) {
  const v = normalizeIntent(planId);
  return v ? `&${INTENT_PARAM}=${encodeURIComponent(v)}` : '';
}

/**
 * 認証後の戻り先を決める。
 *
 * 🔴 **同一オリジンの固定パスしか返さない。** 受け取った値を URL として使わない。
 *
 * @param {string|null} planId  持ち越されたプラン id
 * @param {string} fallback     意図が無いときの戻り先（従来の挙動）
 */
export function resumePathFor(planId, fallback) {
  const v = normalizeIntent(planId);
  if (!v) return fallback;
  return `/pricing?${RESUME_PARAM}=${encodeURIComponent(v)}`;
}
