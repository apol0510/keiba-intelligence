/**
 * plans.js — 課金プランの単一定義
 *
 * 正本: docs/RENEWAL_2026_08.md §6
 *
 * 🔴 **価格をコードに書かない。**
 *    仕様所有者の確定事項 U-3 により価格は未確定であり、改修完了後に決める。
 *    金額の正本は **Stripe 側の Price** であり、本モジュールは Price ID を env から受け取るだけ。
 *    → 価格変更は Stripe 管理画面の操作だけで完了し、コード変更・デプロイを要さない。
 *
 * 🔴 Price ID が未設定のプランは **購入導線を出さない**（「準備中」と表示する）。
 *    推測価格・仮の金額を画面へ出してはいけない。
 */

import { TIER } from '../auth/tiers.js';

/**
 * プラン定義。
 *   id        … 内部識別子（Stripe metadata へ入れて webhook で tier を復元する）
 *   tier      … このプランが与える tier
 *   priceEnv  … Stripe Price ID を持つ環境変数名（**値は持たない**）
 *   features  … 画面に出す訴求（価格を含めない）
 */
export const PLANS = Object.freeze([
  Object.freeze({
    id: 'light',
    tier: TIER.LIGHT,
    name: 'ライト',
    tagline: '南関東の買い目をまるごと',
    priceEnv: 'STRIPE_PRICE_LIGHT',
    venueAccess: 'nankan',
    features: Object.freeze([
      '南関東4場・全レースの馬単買い目',
      '印（◎○▲△）とAI総合pt',
      '全頭の馬柱・AI短評・展開予想',
      '開催日の注目馬・穴馬メール',
    ]),
  }),
  Object.freeze({
    id: 'premium',
    tier: TIER.PREMIUM,
    name: 'プレミアム',
    tagline: '南関東＋中央のすべて',
    priceEnv: 'STRIPE_PRICE_PREMIUM',
    venueAccess: 'all',
    recommended: true,
    features: Object.freeze([
      'ライトのすべて',
      '中央競馬（JRA）全レースの馬単買い目',
      'メインレースの詳細レポート',
      '穴馬レポート',
      '優先メルマガ',
    ]),
  }),
]);

export function planById(id) {
  return PLANS.find((p) => p.id === id) || null;
}

/** Stripe Price ID を env から引く。未設定なら null（＝購入導線を出さない）。 */
export function priceIdFor(plan, env) {
  if (!plan) return null;
  const v = (env || {})[plan.priceEnv];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Stripe metadata から tier / venueAccess を復元する（webhook 用）。 */
export function planFromMetadata(metadata) {
  const id = metadata && typeof metadata.ki_plan === 'string' ? metadata.ki_plan : '';
  return planById(id);
}

/** そのプランが購入可能か（Price ID が設定されているか）。 */
export function isPurchasable(plan, env) {
  return !!priceIdFor(plan, env);
}

/** 画面へ渡す形（Price ID そのものは渡さない）。 */
export function publicPlanView(plan, env) {
  return Object.freeze({
    id: plan.id,
    name: plan.name,
    tagline: plan.tagline,
    tier: plan.tier,
    features: plan.features,
    recommended: !!plan.recommended,
    purchasable: isPurchasable(plan, env),
  });
}

export function publicPlans(env) {
  return PLANS.map((p) => publicPlanView(p, env));
}

/* ------------------------------------------------------------------
   Stripe 秘密鍵まわり（🔴 名前だけを扱う。値をログ・文書へ出さない）
   ------------------------------------------------------------------ */

export const STRIPE_ENV = Object.freeze({
  SECRET_KEY: 'STRIPE_SECRET_KEY',
  WEBHOOK_SECRET: 'STRIPE_WEBHOOK_SECRET',
  PORTAL_RETURN_URL: 'STRIPE_PORTAL_RETURN_URL',
});

/** 秘密鍵が設定されているか。未設定なら Stripe 経路は 503 で止める（fail-closed）。 */
export function hasStripeSecret(env) {
  const v = (env || {})[STRIPE_ENV.SECRET_KEY];
  return typeof v === 'string' && v.trim().length > 0;
}
