/**
 * redemption.js — プレゼント交換・継続記念品の申込（M-2 / M-3 / M-6 / TBD-12）
 *
 * 正本: docs/MEMBERSHIP_REWARDS.md §7.9（発送先住所）／§7.8（品目）
 *
 * 🔴 **安全契約（ここが崩れると事故になる）**
 *   - 会員の識別は **session / auth 側の email だけ**。クライアントが送る email は使わない。
 *   - **クライアントが送るポイント数・必要ポイント・資格・価格を信用しない。**
 *     必要ポイントは**現在のカタログ**から引き直す。
 *   - 交換できる item かどうかは、**公開中のカタログに実在するか**で判定する。
 *   - 記念品（milestone）は **ポイントを消費しない**。
 *   - 通常交換は **記念品の月（12 / 24 か月）には受け付けない**（保守ライン S-2）。
 *
 * 🔴 **住所の扱い（TBD-12 確定・§7.9）**
 *   - 申込のたびに会員本人から取る。必須は **受取人氏名・郵便番号・住所**の 3 つだけ。
 *   - `RewardRedemptions` に **発送時点の snapshot** として保存する。
 *   - 住所変更で**過去のレコードを書き換えない**。
 *   - 発送後の自動削除・保管日数・削除 cron・住所専用テーブルは**作らない**。
 *
 * 🔴 本モジュールは **I/O を持たない**（純関数）。保存は `store.js` / `airtableStore.js`。
 */

import { ITEM_KIND, redeemableItems, milestoneItems, isMilestoneMonth } from './catalog.js';

/** 申込の状態。`docs/MEMBERSHIP_DATA_MIGRATION.md` §2.3 の既存案をそのまま使う。 */
export const REDEMPTION_STATUS = Object.freeze({
  REQUESTED: 'requested',
  APPROVED: 'approved',
  SHIPPED: 'shipped',
  CANCELLED: 'cancelled',
});

const STATUSES = Object.freeze(Object.values(REDEMPTION_STATUS));

/** 拒否の理由。🔴 会員へ返してよい短い符号だけ（内部情報を混ぜない）。 */
export const REDEEM_ERROR = Object.freeze({
  NOT_PUBLISHED: 'catalog_not_published',
  UNKNOWN_ITEM: 'unknown_item',
  INVALID_REQUEST_ID: 'invalid_request_id',
  INVALID_ADDRESS: 'invalid_address',
  BALANCE_UNKNOWN: 'balance_unknown',
  INSUFFICIENT_POINTS: 'insufficient_points',
  MILESTONE_BLOCKS_EXCHANGE: 'milestone_month_blocks_exchange',
  MILESTONE_NOT_REACHED: 'milestone_not_reached',
  MILESTONE_ALREADY_CLAIMED: 'milestone_already_claimed',
  POINTS_EXPIRED: 'points_expired',
});

/** 住所欄の上限。長すぎる入力をそのまま保存しない（Airtable 側も守る）。 */
export const ADDRESS_LIMITS = Object.freeze({
  RECIPIENT_NAME: 100,
  POSTAL_CODE: 8,
  ADDRESS: 200,
});

/**
 * 冪等キーの形。クライアントが申込ごとに 1 つ作って送る。
 *
 * 🔴 これは**重複排除のための札**であって、資格の申告ではない。
 *    同じ札で 2 回来たら 2 回目は何もしない（二重減算・二重発送依頼を防ぐ）。
 *    札を変えて送り直されても、**残高の再計算**が過剰交換を止める。
 */
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function isValidRequestId(v) {
  return typeof v === 'string' && REQUEST_ID_RE.test(v);
}

const trimmed = (v) => (typeof v === 'string' ? v.trim() : '');

/** 郵便番号は日本の 7 桁（ハイフン任意）。保存は数字 7 桁へ揃える。 */
function normalizePostalCode(v) {
  const raw = trimmed(v).replace(/[-‐−ー―\s]/g, '');
  return /^\d{7}$/.test(raw) ? raw : null;
}

/**
 * 発送先を正規化する。必須は **受取人氏名・郵便番号・住所**の 3 つだけ（§7.9）。
 *
 * 🔴 これ以上の必須項目を足さない。発送に要らないものを集めない。
 * @returns {{ok: true, address: object} | {ok: false, error: string}}
 */
export function normalizeShippingAddress(input) {
  const recipientName = trimmed(input?.recipientName);
  const postalCode = normalizePostalCode(input?.postalCode);
  const address = trimmed(input?.address);

  if (!recipientName || recipientName.length > ADDRESS_LIMITS.RECIPIENT_NAME) {
    return { ok: false, error: REDEEM_ERROR.INVALID_ADDRESS };
  }
  if (!postalCode) return { ok: false, error: REDEEM_ERROR.INVALID_ADDRESS };
  if (!address || address.length > ADDRESS_LIMITS.ADDRESS) {
    return { ok: false, error: REDEEM_ERROR.INVALID_ADDRESS };
  }

  return { ok: true, address: Object.freeze({ recipientName, postalCode, address }) };
}

/** 交換 ID。会員 ＋ item ＋ 冪等キーで決まる（同じ申込は同じ ID）。 */
export function buildRedemptionId({ email, itemId, requestId } = {}) {
  const e = trimmed(email).toLowerCase();
  if (!e || !trimmed(itemId) || !isValidRequestId(requestId)) return null;
  return `${e}:${trimmed(itemId)}:${requestId}`;
}

/**
 * 申込を**サーバー側で**検証する。
 *
 * 🔴 `costPoints` は引数で受け取らない。**カタログから引く**。
 *    クライアントが「600pt の品です」と申告しても、それは一切見ない。
 *
 * @param {object}   p
 * @param {object}   p.catalog        公開中のカタログ（`createCatalog` 済み）
 * @param {string}   p.itemId         会員が選んだ景品
 * @param {object}   p.summary        `summarizeRewards()` の結果（残高の正本）
 * @param {number|null} p.months      継続月数（不明なら null）
 * @param {string[]} p.claimedMilestoneMonths 既に申込済みの記念品の月
 * @returns {{ok: true, item: object, costPoints: number, kind: string} | {ok: false, error: string}}
 */
export function validateRedemption({
  catalog, itemId, summary, months = null, claimedMilestoneMonths = [],
} = {}) {
  const redeemables = redeemableItems(catalog);
  const milestones = milestoneItems(catalog);
  if (!redeemables.length && !milestones.length) {
    return { ok: false, error: REDEEM_ERROR.NOT_PUBLISHED };
  }

  const id = trimmed(itemId);
  const item = [...redeemables, ...milestones].find((i) => i.id === id) || null;
  if (!item) return { ok: false, error: REDEEM_ERROR.UNKNOWN_ITEM };

  if (item.kind === ITEM_KIND.MILESTONE) {
    // 🔴 記念品はポイントを消費しない。到達している節目のものだけ受け付ける。
    if (!Number.isInteger(months) || months < item.milestoneMonths) {
      return { ok: false, error: REDEEM_ERROR.MILESTONE_NOT_REACHED };
    }
    if (claimedMilestoneMonths.includes(item.milestoneMonths)) {
      return { ok: false, error: REDEEM_ERROR.MILESTONE_ALREADY_CLAIMED };
    }
    return { ok: true, item, costPoints: 0, kind: ITEM_KIND.MILESTONE };
  }

  // ここから通常交換
  // 🔴 保守ライン S-2: 記念品の月は通常交換を受け付けない
  if (isMilestoneMonth(months)) {
    return { ok: false, error: REDEEM_ERROR.MILESTONE_BLOCKS_EXCHANGE };
  }
  if (!summary || summary.status !== 'ready' || !Number.isInteger(summary.balancePoints)) {
    // 🔴 台帳が読めていない＝残高不明。0 と決めつけず、交換もさせない。
    return { ok: false, error: REDEEM_ERROR.BALANCE_UNKNOWN };
  }
  if (summary.pointsStatus?.status === 'expired') {
    return { ok: false, error: REDEEM_ERROR.POINTS_EXPIRED };
  }
  if (summary.balancePoints < item.costPoints) {
    return { ok: false, error: REDEEM_ERROR.INSUFFICIENT_POINTS };
  }

  return { ok: true, item, costPoints: item.costPoints, kind: ITEM_KIND.REDEEMABLE };
}

/**
 * 保存する交換レコードを作る。
 *
 * 🔴 住所は**この申込時点の写し**。あとで会員が住所を変えても、
 *    このレコードは書き換えない（どこへ送ったかの記録が消えるため。§7.9）。
 */
export function buildRedemptionRecord({
  redemptionId, email, item, costPoints, address, occurredAtMs,
} = {}) {
  if (!trimmed(redemptionId) || !trimmed(email) || !item) return null;
  if (!Number.isInteger(costPoints) || costPoints < 0) return null;
  if (!address || !address.recipientName || !address.postalCode || !address.address) return null;
  if (!Number.isFinite(occurredAtMs)) return null;

  return Object.freeze({
    redemptionId,
    email: trimmed(email).toLowerCase(),
    itemId: item.id,
    itemName: item.name,
    kind: item.kind,
    costPoints,
    milestoneMonths: item.kind === ITEM_KIND.MILESTONE ? item.milestoneMonths : null,
    status: REDEMPTION_STATUS.REQUESTED,
    requestedAtMs: occurredAtMs,
    shipping: Object.freeze({ ...address }),
  });
}

/** 既に申込済みの記念品の月。 */
export function claimedMilestones(records) {
  if (!Array.isArray(records)) return [];
  return records
    .filter((r) => r && r.kind === ITEM_KIND.MILESTONE
      && r.status !== REDEMPTION_STATUS.CANCELLED
      && Number.isInteger(r.milestoneMonths))
    .map((r) => r.milestoneMonths);
}

/**
 * 次回の申込で初期表示する発送先（直近のもの）。
 *
 * 🔴 初期表示するだけで、**会員が確認・修正できること**が前提（§7.9）。
 *    勝手に確定させない。
 */
export function latestShippingAddress(records) {
  if (!Array.isArray(records) || !records.length) return null;
  const withAddress = records
    .filter((r) => r && r.shipping && r.shipping.recipientName && r.shipping.postalCode)
    .sort((a, b) => (b.requestedAtMs || 0) - (a.requestedAtMs || 0));
  return withAddress.length ? Object.freeze({ ...withAddress[0].shipping }) : null;
}

export function isValidStatus(v) {
  return STATUSES.includes(v);
}
