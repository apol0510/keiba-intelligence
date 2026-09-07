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
 *    1. `RewardRedemptions`（発送キュー）へ積む
 *    2. 成功したときだけ台帳からポイントを引く
 *    逆にすると、キューへの書き込みが失敗したとき
 *    **ポイントだけ減って景品が届かない**状態になる。
 *
 * 🔴 冪等: `requestId` が同じなら 2 回目以降は **何も書かない**。
 *    二重クリック・再送で二重減算・二重発送依頼にならない。
 *
 * 🔴 Netlify Function から切り離してあるのは、**I/O 抜きでテストできるようにする**ため。
 */

import { createCatalog } from './catalog.js';
import {
  summarizeRewards, resolveTenureMonths, readAccrualConfig, buildRedemptionEntry,
} from './rewards.js';
import { STORE_RESULT } from './store.js';
import {
  REDEEM_ERROR, isValidRequestId, normalizeShippingAddress, validateRedemption,
  buildRedemptionId, buildRedemptionRecord, claimedMilestones, latestShippingAddress,
} from './redemption.js';

const json = (statusCode, payload) => Object.freeze({ statusCode, body: payload });

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

  // ---- 🔴 冪等の短絡は「残高を見る前」に置く ----
  //    先に残高を見ると、1 回目で引かれたあとの 2 回目が
  //    `insufficient_points` になり、成功した申込が失敗として返ってしまう。
  const earlyId = buildRedemptionId({ email, itemId: input.itemId, requestId });
  const done = earlyId ? records.find((r) => r.redemptionId === earlyId) : null;
  if (done) {
    return json(200, {
      status: 'already',
      redemptionId: done.redemptionId,
      itemName: done.itemName || null,
      costPoints: done.costPoints ?? null,
    });
  }

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

  // ---- 1. 発送キューへ積む（ここが失敗したらポイントは引かない）----
  const queued = await store.appendRedemption(email, record);
  if (queued.status === STORE_RESULT.UNAVAILABLE) {
    return json(503, { error: 'redemption_not_ready' });
  }

  // ---- 2. 通常交換だけポイントを引く（記念品は消費しない）----
  if (check.costPoints > 0) {
    const entry = buildRedemptionEntry({
      summary,
      costPoints: check.costPoints,
      email,
      redemptionId,
      occurredAtMs: nowMs,
    });
    if (!entry) {
      // ここへ来るのは残高が足りない場合。キューは冪等なので再送で回復できる。
      return json(400, { error: REDEEM_ERROR.INSUFFICIENT_POINTS });
    }
    const applied = await store.appendEntry(email, entry);
    if (applied.status === STORE_RESULT.UNAVAILABLE) {
      return json(503, { error: 'redemption_not_ready' });
    }
  }

  return json(200, {
    status: queued.status === STORE_RESULT.ALREADY ? 'already' : 'requested',
    redemptionId,
    itemName: check.item.name,
    costPoints: check.costPoints,
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
