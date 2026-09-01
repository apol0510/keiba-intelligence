/**
 * priceLock.js — 継続価格ロック（M-1）
 *
 * 正本: docs/MEMBERSHIP_REWARDS.md §3.1
 *
 * 制度: **契約中は、その会員が加入した契約価格を維持できる。**
 * 将来の新規価格を変更できるよう、**契約時価格を会員単位で保持する**。
 *
 * 🔴 実効はどこにあるか:
 *    Stripe のサブスクは **契約時の Price に紐づいたまま**である。
 *    新規価格を変えるときは **新しい Price を作って切り替える**（既存 Price を書き換えない）。
 *    したがってロックの実効は Stripe 側にあり、ここで保持する値は
 *    **画面表示と監査のための写し**である（請求額の正本は Stripe）。
 *
 * 🔴 未確定（TBD-8）: **解約後の再加入価格 / 価格ロックの復活条件は決まっていない。**
 *    `resolveReentryPrice()` は必ず「未確定」を返す。ここで勝手に
 *    「再加入も同額」「再加入は新価格」のどちらかへ倒してはいけない。
 */

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isPositiveInt = (v) => Number.isInteger(v) && v > 0;

/** 価格ロックの状態。 */
export const LOCK_STATUS = Object.freeze({
  /** 契約中で、契約時価格が保持されている */
  LOCKED: 'locked',
  /** 契約はあるが、契約時価格が未保存（表示は「準備中」） */
  UNKNOWN: 'unknown',
  /** 有料契約が無い（無料会員・ゲスト） */
  NOT_APPLICABLE: 'not_applicable',
});

/**
 * 契約価格のスナップショットを作る。
 *
 * 🔴 金額が読めない・0 以下・通貨が無い場合は **null を返す**。
 *    ¥3,980 を「たぶんこれだろう」と当てはめない（推測補完の禁止）。
 */
export function createContractPrice({ amountYen, currency, priceId, startedAtIso } = {}) {
  if (!isPositiveInt(amountYen)) return null;
  if (!isNonEmptyString(currency)) return null;
  if (!isNonEmptyString(priceId)) return null;
  if (!isNonEmptyString(startedAtIso) || !Number.isFinite(Date.parse(startedAtIso))) return null;

  return Object.freeze({
    amountYen,
    currency: currency.trim().toLowerCase(),
    priceId: priceId.trim(),
    startedAtIso: startedAtIso.trim(),
  });
}

/**
 * Stripe の Checkout Session から契約価格を取り出す。
 *
 * 使う値:
 *   - `amount_total`（実際に請求された額）
 *   - `currency`
 *   - `line_items.data[0].price.id`（拡張して取得している場合のみ）
 *
 * 🔴 JPY は最小単位が「円」なので割らない。他通貨は **扱わない**（null を返す）。
 *    通貨ごとの最小単位を推測で割ると請求額の写しが狂うため。
 */
export function contractPriceFromCheckoutSession(session, { nowIso } = {}) {
  if (!session || typeof session !== 'object') return null;
  const currency = typeof session.currency === 'string' ? session.currency.toLowerCase() : null;
  if (currency !== 'jpy') return null;

  const amount = session.amount_total;
  if (!isPositiveInt(amount)) return null;

  const priceId = session?.line_items?.data?.[0]?.price?.id
    || session?.metadata?.ki_price_id
    || null;
  if (!isNonEmptyString(priceId)) return null;

  return createContractPrice({
    amountYen: amount,
    currency,
    priceId,
    startedAtIso: isNonEmptyString(nowIso) ? nowIso : new Date().toISOString(),
  });
}

/**
 * Stripe の Subscription から契約価格を取り出す（webhook の updated 経路用）。
 */
export function contractPriceFromSubscription(sub, { nowIso } = {}) {
  if (!sub || typeof sub !== 'object') return null;
  const price = sub?.items?.data?.[0]?.price;
  if (!price || typeof price !== 'object') return null;

  const currency = typeof price.currency === 'string' ? price.currency.toLowerCase() : null;
  if (currency !== 'jpy') return null;
  if (!isPositiveInt(price.unit_amount)) return null;
  if (!isNonEmptyString(price.id)) return null;

  return createContractPrice({
    amountYen: price.unit_amount,
    currency,
    priceId: price.id,
    startedAtIso: isNonEmptyString(nowIso) ? nowIso : new Date().toISOString(),
  });
}

/**
 * 画面へ出す価格ロックの状態。
 *
 * @param {object} o
 * @param {boolean} o.isPaid       有料契約中か（tier >= light）
 * @param {object|null} o.contract `createContractPrice` の戻り
 * @param {number|null} o.currentListPriceYen 現在の新規価格（表示用。plans.js 由来）
 */
export function resolvePriceLock({ isPaid, contract, currentListPriceYen = null } = {}) {
  if (!isPaid) {
    return Object.freeze({
      status: LOCK_STATUS.NOT_APPLICABLE,
      contractPriceYen: null,
      contractStartedAtIso: null,
      /** 現在の新規価格より安く据え置かれているか。判断できないときは null */
      cheaperThanCurrent: null,
    });
  }
  if (!contract) {
    return Object.freeze({
      status: LOCK_STATUS.UNKNOWN,
      contractPriceYen: null,
      contractStartedAtIso: null,
      cheaperThanCurrent: null,
    });
  }

  const cheaper = isPositiveInt(currentListPriceYen)
    ? contract.amountYen < currentListPriceYen
    : null;

  return Object.freeze({
    status: LOCK_STATUS.LOCKED,
    contractPriceYen: contract.amountYen,
    contractStartedAtIso: contract.startedAtIso,
    cheaperThanCurrent: cheaper,
  });
}

/**
 * 解約後に再加入した場合の価格。
 *
 * 🔴 **TBD-8: 未確定。** 仕様所有者が決めるまで、常に「未確定」を返す。
 *    ここで既定を決めると、実際の請求（Stripe）と食い違う案内を出すことになる。
 */
export function resolveReentryPrice() {
  return Object.freeze({
    decided: false,
    reason: 'tbd_8_reentry_price_undecided',
    priceYen: null,
  });
}
