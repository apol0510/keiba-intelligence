/**
 * redeemHandler.js — 交換申込のサーバー側処理（M-2 / M-3 / M-6 / TBD-12）
 *
 * 正本: docs/MEMBERSHIP_REWARDS.md §7.9
 *
 * 🔴 **信用してよいのは session の email だけ。**
 *    クライアントが送る email / ポイント数 / 必要ポイント / 資格 / 価格は **一切見ない**。
 *    必要ポイントは公開中のカタログから引き直し、残高は台帳から数え直す。
 *
 * 🔴 **書く順序を変えないこと。**
 *    1. `RewardRedemptions` へ `requested`（＝**申込予約**）を積む
 *    2. 台帳からポイントを引く（冪等）
 *    3. **減算が成立したときだけ** `approved` へ進める
 *    逆にすると、キューへの書き込みが失敗したとき
 *    **ポイントだけ減って景品が届かない**状態になる。
 *
 * 🔴 **`requested` はまだ発送してよい状態ではない。**
 *    運用者が発送するのは **`approved` だけ**（`docs/MEMBERSHIP_REWARDS.md` §7.9）。
 *    2 が失敗すると `requested` のまま残る。これは
 *    「申込は受けたがポイントを引けていない」という**回復待ち**の状態である。
 *
 * 🔴 冪等 ＋ **回復**:
 *    同じ `requestId` の再送では、
 *      - `approved` / `shipped` / `cancelled` → 何もせず `already`
 *      - `requested` → **台帳の減算が入っているか確認し、無ければ引き直す**。
 *        成立したら `approved` へ進める。
 *    ここで無条件に `already` を返すと、**減算が永久に再試行されない**
 *    （2026-09-07 に仕様所有者が指摘。片側成功が回復不能だった）。
 *
 * 🔴 Netlify Function から切り離してあるのは、**I/O 抜きでテストできるようにする**ため。
 */

import { createCatalog } from './catalog.js';
import {
  summarizeRewards, resolveTenureMonths, readAccrualConfig, buildRedemptionEntry,
  buildEntryId, ENTRY_TYPE,
} from './rewards.js';
import { STORE_RESULT } from './store.js';
import {
  REDEEM_ERROR, REDEMPTION_STATUS, isValidRequestId, normalizeShippingAddress, validateRedemption,
  buildRedemptionId, buildRedemptionRecord, claimedMilestones, latestShippingAddress,
} from './redemption.js';

const json = (statusCode, payload) => Object.freeze({ statusCode, body: payload });

/** これ以上進めない（＝再送しても何もしない）状態。 */
const TERMINAL = Object.freeze([
  REDEMPTION_STATUS.APPROVED, REDEMPTION_STATUS.SHIPPED, REDEMPTION_STATUS.CANCELLED,
]);

/** その申込に対応する台帳エントリの id。存在すれば**減算済み**。 */
function redemptionEntryId(email, redemptionId) {
  return buildEntryId({ type: ENTRY_TYPE.REDEMPTION, email, ref: redemptionId });
}

/**
 * ポイント減算を**冪等に**成立させる。
 * @returns {'done'|'insufficient'|'unavailable'}
 */
async function settlePoints({ store, email, redemptionId, costPoints, summary, ledger, nowMs }) {
  if (costPoints <= 0) return 'done'; // 記念品はポイントを消費しない

  const wanted = redemptionEntryId(email, redemptionId);
  // 既に引かれているなら何もしない（二重減算を作らない）
  if (wanted && Array.isArray(ledger) && ledger.some((e) => e.entryId === wanted)) return 'done';

  const entry = buildRedemptionEntry({
    summary, costPoints, email, redemptionId, occurredAtMs: nowMs,
  });
  if (!entry) return 'insufficient';

  const applied = await store.appendEntry(email, entry);
  // 🔴 「減算が成立している」と言えるのは APPLIED / ALREADY だけ。
  //    それ以外（UNAVAILABLE / NOT_APPLICABLE / 未知の値）は**成立扱いにしない**。
  //    ここを取りこぼすと、引かれていないのに交換が進む。
  if (applied.status !== STORE_RESULT.APPLIED && applied.status !== STORE_RESULT.ALREADY) {
    return 'unavailable';
  }
  return 'done';
}

/**
 * 交換申込を処理する。
 *
 * @param {object} o
 * @param {object} o.store          membership store（`resolveMembershipStore` の戻り）
 * @param {object} o.catalogSource  景品カタログの生 JSON
 * @param {string} o.email          🔴 **session 由来の email のみ**
 * @param {object} o.input          クライアント入力（itemId / requestId / shipping）
 * @param {object} o.config         設定源（env 相当）
 * @param {number} o.nowMs
 */
export async function handleRedeem({
  store, catalogSource, email, input = {}, config = {}, nowMs = Date.now(),
} = {}) {
  if (!email) return json(401, { error: 'login_required' });

  const requestId = input.requestId;
  if (!isValidRequestId(requestId)) {
    return json(400, { error: REDEEM_ERROR.INVALID_REQUEST_ID });
  }

  const addr = normalizeShippingAddress(input.shipping);
  if (!addr.ok) return json(400, { error: addr.error });

  const catalog = createCatalog(catalogSource);

  // ---- 残高と継続月数を「こちら側で」数え直す ----
  const [ledgerRes, profileRes, redemptionsRes] = await Promise.all([
    store.readLedger(email),
    store.readProfile(email),
    store.readRedemptions(email),
  ]);

  const ledgerKnown = ledgerRes.status === STORE_RESULT.APPLIED && Array.isArray(ledgerRes.entries);
  const ledger = ledgerKnown ? ledgerRes.entries : null;
  const profile = profileRes.status === STORE_RESULT.APPLIED ? profileRes.profile : null;

  // 🔴 交換履歴が読めないなら受け付けない。記念品の二重申込を見逃すため。
  if (redemptionsRes.status !== STORE_RESULT.APPLIED || !Array.isArray(redemptionsRes.records)) {
    return json(503, { error: 'redemption_not_ready' });
  }
  const records = redemptionsRes.records;

  const summary = summarizeRewards({
    entries: ledger,
    accrual: readAccrualConfig(config),
    ledgerKnown,
    cancelledAtIso: profile?.cancelledAtIso || null,
    nowMs,
  });
  const tenure = resolveTenureMonths({
    entries: ledger,
    ledgerKnown,
    startedAtIso: profile?.membershipStartedAtIso || null,
    nowMs,
  });
  const months = tenure.status === 'ready' ? tenure.months : null;

  // ---- 同じ申込の再送: 状態を見て「完了」か「回復」かを決める ----
  //  🔴 ここで無条件に `already` を返すと、キューだけ作れて減算が失敗した申込が
  //     永久に回復しない（＝交換行だけ残る）。
  const existingId = buildRedemptionId({ email, itemId: input.itemId, requestId });
  const existing = existingId ? records.find((r) => r.redemptionId === existingId) : null;

  if (existing) {
    if (TERMINAL.includes(existing.status)) {
      return json(200, {
        status: 'already',
        redemptionId: existing.redemptionId,
        itemName: existing.itemName || null,
        costPoints: existing.costPoints ?? null,
        redemptionStatus: existing.status,
      });
    }

    // `requested` のまま = 減算が済んでいない可能性がある。引き直して回復させる。
    const cost = Number.isInteger(existing.costPoints) && existing.costPoints > 0
      ? existing.costPoints : 0;
    const settled = await settlePoints({
      store, email, redemptionId: existing.redemptionId, costPoints: cost, summary, ledger, nowMs,
    });
    if (settled === 'unavailable') return json(503, { error: 'redemption_not_ready' });
    if (settled === 'insufficient') {
      // 🔴 `approved` にしない。発送対象にならないまま残す。
      return json(400, { error: REDEEM_ERROR.INSUFFICIENT_POINTS });
    }

    const promoted = await store.updateRedemptionStatus(
      email, existing.redemptionId, REDEMPTION_STATUS.APPROVED);
    if (promoted.status === STORE_RESULT.UNAVAILABLE) {
      return json(503, { error: 'redemption_not_ready' });
    }
    return json(200, {
      status: 'already',
      redemptionId: existing.redemptionId,
      itemName: existing.itemName || null,
      costPoints: cost,
      redemptionStatus: REDEMPTION_STATUS.APPROVED,
    });
  }

  // ---- カタログ側の実体で検証（クライアントの申告は使わない）----
  const check = validateRedemption({
    catalog,
    itemId: input.itemId,
    summary,
    months,
    claimedMilestoneMonths: claimedMilestones(records),
  });
  if (!check.ok) {
    const status = check.error === REDEEM_ERROR.NOT_PUBLISHED ? 503 : 400;
    return json(status, { error: check.error });
  }

  const redemptionId = buildRedemptionId({ email, itemId: check.item.id, requestId });
  if (!redemptionId) return json(400, { error: REDEEM_ERROR.INVALID_REQUEST_ID });

  const record = buildRedemptionRecord({
    redemptionId,
    email,
    item: check.item,
    costPoints: check.costPoints,
    address: addr.address,
    occurredAtMs: nowMs,
  });
  if (!record) return json(400, { error: REDEEM_ERROR.INVALID_ADDRESS });

  // ---- 1. 発送キューへ `requested`（申込予約）を積む ----
  //     🔴 ここが失敗したらポイントは引かない。
  const queued = await store.appendRedemption(email, record);
  if (queued.status === STORE_RESULT.UNAVAILABLE) {
    return json(503, { error: 'redemption_not_ready' });
  }

  // ---- 2. 通常交換だけポイントを引く（記念品は消費しない）----
  const settled = await settlePoints({
    store, email, redemptionId, costPoints: check.costPoints, summary, ledger, nowMs,
  });
  if (settled === 'unavailable') {
    // 🔴 `requested` のまま残す。発送対象にはならず、再送で回復できる。
    return json(503, { error: 'redemption_not_ready' });
  }
  if (settled === 'insufficient') {
    return json(400, { error: REDEEM_ERROR.INSUFFICIENT_POINTS });
  }

  // ---- 3. 減算が成立したときだけ発送してよい状態へ進める ----
  const promoted = await store.updateRedemptionStatus(email, redemptionId, REDEMPTION_STATUS.APPROVED);
  if (promoted.status === STORE_RESULT.UNAVAILABLE) {
    return json(503, { error: 'redemption_not_ready' });
  }

  return json(200, {
    status: 'requested',
    redemptionId,
    itemName: check.item.name,
    costPoints: check.costPoints,
    redemptionStatus: REDEMPTION_STATUS.APPROVED,
  });
}

/**
 * 申込フォームの初期表示に使う情報を返す。
 *
 * 🔴 **自分のぶんだけ**。他会員の住所・履歴は返らない（email で絞って読む）。
 * 🔴 直近の発送先は**初期表示のためだけ**。会員が確認・修正できることが前提（§7.9）。
 */
export async function readRedeemContext({ store, email } = {}) {
  if (!email) return Object.freeze({ known: false, lastAddress: null, records: [] });
  const res = await store.readRedemptions(email);
  if (res.status !== STORE_RESULT.APPLIED || !Array.isArray(res.records)) {
    return Object.freeze({ known: false, lastAddress: null, records: [] });
  }
  return Object.freeze({
    known: true,
    lastAddress: latestShippingAddress(res.records),
    records: res.records,
  });
}
