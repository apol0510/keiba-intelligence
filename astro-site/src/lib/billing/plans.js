/**
 * plans.js — 課金プランの単一定義
 *
 * 正本: docs/RENEWAL_2026_08.md §6
 *
 * ── 2026-08-30 改定（仕様所有者の指示）─────────────────────────
 *  - **ライトプランは保留**。`/pricing` に導線を出さない（`PLANS` から外す）。
 *    「ライト＝南関のみ」という **会場で分ける概念は廃止**した。
 *    有料 tier はすべて **南関東＋中央競馬**が見える。
 *  - **プレミアム限定コンテンツ（詳細レポート・穴馬・優先配信）は廃止**。
 *    実装が無いものを訴求しない。
 *  - **月額はプレミアムの 1 本のみ**。正規 ¥5,000 → 割引 ¥3,980（Stripe 決済）。
 *  - **銀行振込は年払い ¥39,800 のみ**（買い切り・月払いは非表示）。
 *
 * ── 🔴 金額の扱い ─────────────────────────────────────────────
 * **実際に請求される金額の正本は Stripe の Price**。ここに書く数値は
 * **画面に出す表示用**であり、請求には使わない。
 *   - 取り消し線の「正規価格」は請求されない金額なので、コード側の値をそのまま出す。
 *   - 実売価格は Stripe から取得した金額で **上書きする**（食い違ったら Stripe が正）。
 *   - Stripe が取得できないときは `MONTHLY_PRICE_YEN` を出す（fail-open ではなく、
 *     Price ID が未設定なら購入ボタン自体を出さないため、金額だけが独り歩きしない）。
 * 価格を変えるときは **Stripe の Price と本ファイルの両方**を直すこと。
 */

import { TIER } from '../auth/tiers.js';

/** 月額プレミアムの正規価格（取り消し線・請求されない）。 */
export const MONTHLY_LIST_PRICE_YEN = 5000;
/** 月額プレミアムの実売価格（Stripe の Price と一致させること）。 */
export const MONTHLY_PRICE_YEN = 3980;
/** 銀行振込の年払い価格。 */
export const BANK_YEARLY_PRICE_YEN = 39800;

/**
 * プラン定義。
 *   id        … 内部識別子（Stripe metadata へ入れて webhook で tier を復元する）
 *   tier      … このプランが与える tier
 *   priceEnv  … Stripe Price ID を持つ環境変数名（**値は持たない**）
 *   features  … 画面に出す訴求（**実装があるものだけ**書く）
 *
 * 🔴 `venueAccess` は持たない。会場で分けないため（2026-08-30 廃止）。
 */
export const PLANS = Object.freeze([
  Object.freeze({
    id: 'premium',
    tier: TIER.PREMIUM,
    name: 'プレミアム',
    tagline: '南関東＋中央競馬のすべて',
    priceEnv: 'STRIPE_PRICE_PREMIUM',
    listPriceYen: MONTHLY_LIST_PRICE_YEN,
    priceYen: MONTHLY_PRICE_YEN,
    features: Object.freeze([
      '南関東4場・全レースの馬単買い目',
      '中央競馬（JRA）全レースの馬単買い目',
      'AI指数の数値とAI結論',
      '全頭の馬柱・AI短評・展開予想',
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
    // 🔴 表示用。請求額は Stripe が正本（クライアント側で上書きする）
    listPriceYen: plan.listPriceYen ?? null,
    priceYen: plan.priceYen ?? null,
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
