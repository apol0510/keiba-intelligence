/**
 * rewardScope.js — 継続リワードの**対象範囲**を決める（純関数・I/O なし）
 *
 * 正本: `docs/MEMBERSHIP_REWARDS.md` §7.10（2026-09-11 確定）
 *
 * 確定した位置づけ:
 *   - 継続リワード（ランク / 継続月数 / KIリワード / 継続特典・交換品）の**主対象**は
 *     **クレジットカードによる継続決済**の会員
 *   - **銀行振込**の月払い・年払い会員は、**現在の契約・閲覧権限を変更しない**。
 *     クレジット継続決済へ**移行すると**継続リワードを受けられる導線とする（強制移行はしない）
 *   - **買い切り・永久会員**は**ポイント蓄積の主対象にしない**。
 *     代わりに**専用の称号・バッジ**を与える方向（名称は未確定）
 *
 * 🔴 fail-closed の原則:
 *   1. **根拠のある値だけ**で判定する。`CreatedAt`（申込日）を加入日として使わない
 *   2. 判定できないものは **`UNKNOWN`**。既定へ丸めない・推測しない
 *   3. 既存会員の**契約・閲覧権限（entitlement）を変えない**。
 *      本モジュールは **表示と付与対象の判定だけ**を行い、認可には一切関与しない
 */

/** 支払い方法（**証拠から判定できたものだけ**）。 */
export const PAYMENT_METHOD = Object.freeze({
  /** クレジットカードの継続決済（Stripe サブスクリプション） */
  CREDIT: 'credit',
  /** 銀行振込 */
  BANK: 'bank',
  /** 🔴 判定できない。推測しない */
  UNKNOWN: 'unknown',
});

/** 継続リワードにおける位置づけ。 */
export const REWARD_SCOPE = Object.freeze({
  /** 継続ポイントを積む主対象 */
  ACCRUING: 'accruing',
  /** 🔴 ポイント蓄積の対象にしない。称号・バッジで扱う（買い切り・永久会員） */
  TITLE_ONLY: 'title-only',
  /** 🔴 判定できない。付与も称号も勝手に決めない */
  UNKNOWN: 'unknown',
});

/**
 * 買い切り・永久会員を表す `plan_type`。
 *
 * 🔴 ここに無い値を「たぶん買い切り」と推測しない。
 *    実データの `plan_type` は `lifetime` / `yearly` / `light` /
 *    `monthly-nankan` / `monthly-jra`（`AIRTABLE_SCHEMA` の singleSelect）。
 */
export const LIFETIME_PLAN_TYPES = Object.freeze(['lifetime']);

/** 銀行振込の契約価格 ID に付く接頭辞（`bankTransfer.js` と同じ規約）。 */
export const BANK_CONTRACT_PREFIX = 'bank:';
/** Stripe の Price ID に付く接頭辞。 */
export const STRIPE_PRICE_PREFIX = 'price_';

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** 買い切り・永久会員か。**判定できないときは false**（＝勝手に称号側へ倒さない）。 */
export function isLifetimePlan(planType) {
  const v = str(planType).toLowerCase();
  return !!v && LIFETIME_PLAN_TYPES.includes(v);
}

/**
 * 支払い方法を**証拠から**判定する。
 *
 * 根拠にしてよいもの（いずれも repo 内の正本データ）:
 *   - `ContractPriceId` … `bank:*` なら銀行振込 / `price_*` なら Stripe（クレジット）
 *   - `PaymentMethod`   … `Bank Transfer` なら銀行振込
 *
 * 🔴 `CreatedAt` / `PlanType` / 金額からは**判定しない**（申込日も権限も支払い方法ではない）。
 * 🔴 両者が食い違う場合は **UNKNOWN**（どちらかへ寄せない）。
 */
export function resolvePaymentMethod({ contractPriceId, paymentMethod } = {}) {
  const id = str(contractPriceId);
  const pm = str(paymentMethod).toLowerCase();

  const fromId = id.startsWith(BANK_CONTRACT_PREFIX) ? PAYMENT_METHOD.BANK
    : id.startsWith(STRIPE_PRICE_PREFIX) ? PAYMENT_METHOD.CREDIT
      : PAYMENT_METHOD.UNKNOWN;

  const fromPm = pm === 'bank transfer' ? PAYMENT_METHOD.BANK : PAYMENT_METHOD.UNKNOWN;

  if (fromId !== PAYMENT_METHOD.UNKNOWN && fromPm !== PAYMENT_METHOD.UNKNOWN && fromId !== fromPm) {
    return PAYMENT_METHOD.UNKNOWN; // 🔴 食い違いは推測しない
  }
  if (fromId !== PAYMENT_METHOD.UNKNOWN) return fromId;
  return fromPm;
}

/**
 * その会員が継続リワードのどの扱いになるか。
 *
 * @returns {{ scope: string, method: string, reason: string }}
 */
export function resolveRewardScope({ planType, contractPriceId, paymentMethod } = {}) {
  const method = resolvePaymentMethod({ contractPriceId, paymentMethod });

  // 🔴 買い切りは支払い方法によらずポイント蓄積の対象にしない
  if (isLifetimePlan(planType)) {
    return Object.freeze({ scope: REWARD_SCOPE.TITLE_ONLY, method, reason: 'lifetime_plan' });
  }
  if (method === PAYMENT_METHOD.CREDIT) {
    return Object.freeze({ scope: REWARD_SCOPE.ACCRUING, method, reason: 'credit_subscription' });
  }
  if (method === PAYMENT_METHOD.BANK) {
    // 🟡 銀行振込の既存の積算を**この変更では止めない**（既存会員の残高・ランクを下げないため）。
    //    止めるかどうかは未確定（`docs/MEMBERSHIP_REWARDS.md` §7.10 TBD-14）。
    return Object.freeze({ scope: REWARD_SCOPE.ACCRUING, method, reason: 'bank_transfer_legacy' });
  }
  return Object.freeze({ scope: REWARD_SCOPE.UNKNOWN, method, reason: 'insufficient_evidence' });
}

/**
 * 🔴 **付与してはいけない**と断定できるか。
 *
 * 断定できるのは「買い切りだと**証拠から分かる**」ときだけ。
 * 判定できない会員の付与は**止めない**（支払っている会員の付与を落とさないため）。
 * ここでの fail-closed は「**根拠なく付与しない**」ではなく
 * 「**根拠なく既存の付与を止めない**」側に置いてある。誤って止めると
 * 支払い済みの月が永久に欠落する（台帳は再生成できない）。
 */
export function isAccrualForbidden({ planType } = {}) {
  return isLifetimePlan(planType);
}
