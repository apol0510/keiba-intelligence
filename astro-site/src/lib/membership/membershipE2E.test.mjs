/**
 * membershipE2E.test.mjs — 会員継続制度の通し検証
 *
 * 正本: docs/MEMBERSHIP_REWARDS.md §7.1
 *
 * 実際の会員の一生を、**本物の関数**で通す:
 *   Stripe 月額の開始 → 権限が開く → 毎月の付与 → 昇格 → 交換 →
 *   記念品の月 → 解約 → 90 日以内の再加入 → 90 日超過
 * ＋ 銀行振込の年払い（12 か月相当の一括付与）
 *
 * 外部 I/O は使わない（Airtable / Stripe を叩かない）。
 * 会員データは in-memory store、entitlement は本物の署名 Cookie を使う。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { signSession, SESSION_COOKIE_NAME } from '../auth/session.js';
import { resolveEntitlement } from '../auth/entitlement.js';
import { planTypeToTier, TIER } from '../auth/tiers.js';
import { MONTHLY_LIST_PRICE_YEN } from '../billing/plans.js';

import {
  ENTRY_TYPE, MONTHLY_POINTS, GRACE_DAYS, POINTS_STATUS, PERIOD_MONTHS,
  buildAccrualEntry, buildAnnualAccrualEntry, buildRedemptionEntry, buildPaidPeriodEntry,
  summarizeRewards, resolvePointsStatus, resolveTenureMonths, tenureMonthsFromLedger,
} from './rewards.js';
import { RANK } from './ranks.js';
import { ITEM_KIND, createCatalog, MILESTONE_MONTHS } from './catalog.js';
import { createContractPrice, contractPriceFromCheckoutSession, resolveReentryPrice, LOCK_STATUS } from './priceLock.js';
import { createInMemoryMembershipStore, STORE_RESULT } from './store.js';
import { buildMembershipView } from './membershipView.js';

const SECRET = 'e2e-signing-secret-not-a-real-key';
const DAY = 24 * 60 * 60 * 1000;
const EMAIL = 'member@example.com';
const OTHER = 'other@example.com';

/** 品目は未確定なので、E2E 用の最小カタログを作る（正本の交換ラインに従う）。 */
const CATALOG_SOURCE = {
  version: 1,
  status: 'published',
  items: [
    { id: 'small', name: '小の品', kind: ITEM_KIND.REDEEMABLE, costPoints: 600, valueYen: 500 },
    { id: 'large', name: '大の品', kind: ITEM_KIND.REDEEMABLE, costPoints: 1200, valueYen: 796 },
    { id: 'large-gold', name: '大の品（上位ランク限定）', kind: ITEM_KIND.REDEEMABLE, costPoints: 1200, valueYen: 796, minRank: RANK.GOLD },
    { id: 'm12', name: '12か月記念', kind: ITEM_KIND.MILESTONE, milestoneMonths: 12, valueYen: 700 },
  ],
};

/** 署名 Cookie を作って entitlement を解決する（本物の認可経路）。 */
function entitlementFor(tier, nowMs) {
  const signed = signSession({ email: EMAIL, tier, secret: SECRET, nowMs });
  assert.equal(signed.ok, true);
  return resolveEntitlement({
    cookieHeader: `${SESSION_COOKIE_NAME}=${encodeURIComponent(signed.token)}`,
    env: { SESSION_SIGNING_SECRET: SECRET },
    nowMs,
  });
}

/** ある月に「継続 n か月」となる起点を作る。 */
function startedAtFor(months, nowMs) {
  const d = new Date(nowMs);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, d.getUTCDate())).toISOString();
}

const view = ({ store, profile, ledger, nowMs, tier }) => buildMembershipView({
  entitlement: entitlementFor(tier, nowMs),
  profile,
  ledger,
  config: {},
  catalogSource: CATALOG_SOURCE,
  currentListPriceYen: MONTHLY_LIST_PRICE_YEN,
  nowMs,
});

/* ================================================================
   1. Stripe 月額の一生
   ================================================================ */

describe('E2E: Stripe 月額', () => {
  test('契約開始 → 権限が開き、契約価格が保存される', async () => {
    const now = Date.UTC(2026, 8, 1);
    const store = createInMemoryMembershipStore();

    // Stripe の checkout.session.completed 相当（webhook が書く PlanType を tier へ）
    const session = {
      currency: 'jpy', amount_total: 3980,
      line_items: { data: [{ price: { id: 'price_premium_v1' } }] },
      metadata: { ki_plan: 'premium', ki_email: EMAIL },
    };
    assert.equal(planTypeToTier('premium'), TIER.PREMIUM);

    const contract = contractPriceFromCheckoutSession(session, { nowIso: new Date(now).toISOString() });
    assert.equal(contract.amountYen, 3980);
    const saved = await store.saveContractPrice(EMAIL, contract);
    assert.equal(saved.status, STORE_RESULT.APPLIED);

    // 権限（本物の署名 Cookie 経由）
    const ent = entitlementFor(TIER.PREMIUM, now);
    assert.equal(ent.showBetting, true, '有料は買い目が見える');
    assert.equal(ent.showMarks, true);

    // 会員クラブの表示
    const v = view({
      store, profile: (await store.readProfile(EMAIL)).profile,
      ledger: [], nowMs: now, tier: TIER.PREMIUM,
    });
    assert.equal(v.priceLock.status, LOCK_STATUS.LOCKED);
    assert.equal(v.priceLock.contractPriceYen, 3980);
    assert.equal(v.priceLock.cheaperThanCurrent, true, '正規 ¥5,000 より安く据え置かれている');
  });

  test('毎月の付与 → 3 か月で Silver → 6 か月で小の品が交換できる', async () => {
    const store = createInMemoryMembershipStore();
    const now = Date.UTC(2026, 8, 15);

    // 6 か月ぶんの付与（Stripe の invoice ごと）
    for (let i = 1; i <= 6; i++) {
      const e = buildAccrualEntry({
        email: EMAIL, periodRef: `in_${i}`, occurredAtMs: Date.UTC(2026, 2 + i, 1),
      });
      assert.equal(e.points, MONTHLY_POINTS);
      const r = await store.appendEntry(EMAIL, e);
      assert.equal(r.status, STORE_RESULT.APPLIED);
    }

    const ledger = (await store.readLedger(EMAIL)).entries;
    const v = view({
      store,
      profile: { membershipStartedAtIso: startedAtFor(6, now) },
      ledger, nowMs: now, tier: TIER.PREMIUM,
    });

    assert.equal(v.months.value, 6);
    assert.equal(v.rank.rank, RANK.SILVER, '3 か月で Silver、Gold は 12 か月');
    assert.equal(v.rank.nextRank, RANK.GOLD);
    assert.equal(v.rank.monthsToNext, 6);
    assert.equal(v.rewards.balancePoints, 600);
    assert.deepEqual(v.gifts.available.map((i) => i.id), ['small'], '600pt で小の品が交換できる');
    assert.equal(v.gifts.next.item.id, 'large');
    assert.equal(v.gifts.next.remainingPoints, 600);
  });

  test('交換 → 残高が減り、履歴に残る', async () => {
    const store = createInMemoryMembershipStore();
    const now = Date.UTC(2026, 8, 15);
    for (let i = 1; i <= 6; i++) {
      await store.appendEntry(EMAIL, buildAccrualEntry({
        email: EMAIL, periodRef: `in_${i}`, occurredAtMs: Date.UTC(2026, 2 + i, 1),
      }));
    }
    let ledger = (await store.readLedger(EMAIL)).entries;
    const summary = summarizeRewards({ entries: ledger, ledgerKnown: true, nowMs: now });

    const redemption = buildRedemptionEntry({
      summary, costPoints: 600, email: EMAIL, redemptionId: 'rx_1', occurredAtMs: now,
    });
    assert.equal(redemption.points, -600);
    await store.appendEntry(EMAIL, redemption);

    // 🔴 同じ交換 ID をもう一度送っても二重に引かれない
    const again = await store.appendEntry(EMAIL, redemption);
    assert.equal(again.status, STORE_RESULT.ALREADY);

    ledger = (await store.readLedger(EMAIL)).entries;
    const v = view({
      store, profile: { membershipStartedAtIso: startedAtFor(6, now) },
      ledger, nowMs: now, tier: TIER.PREMIUM,
    });
    assert.equal(v.rewards.balancePoints, 0);
    assert.equal(v.history.status, 'ready');
    assert.equal(v.history.items.length, 1);
    assert.equal(v.history.items[0].ref, 'rx_1');
    assert.equal(v.gifts.available.length, 0, '残高が無ければ交換候補は出ない');
  });

  test('🔴 残高を超える交換は作れない（マイナス残高にならない）', async () => {
    const now = Date.UTC(2026, 8, 15);
    const summary = summarizeRewards({
      entries: [{ entryId: 'a1', type: ENTRY_TYPE.ACCRUAL, points: 600, occurredAtMs: 1 }],
      ledgerKnown: true, nowMs: now,
    });
    assert.equal(buildRedemptionEntry({
      summary, costPoints: 1200, email: EMAIL, redemptionId: 'rx_2', occurredAtMs: now,
    }), null);
  });

  test('12 か月: Gold になり、記念品の月は通常交換を止める', async () => {
    const store = createInMemoryMembershipStore();
    const now = Date.UTC(2026, 8, 15);
    for (let i = 1; i <= 12; i++) {
      await store.appendEntry(EMAIL, buildAccrualEntry({
        email: EMAIL, periodRef: `in_${i}`, occurredAtMs: Date.UTC(2025, 8 + i, 1),
      }));
    }
    const ledger = (await store.readLedger(EMAIL)).entries;
    const v = view({
      store, profile: { membershipStartedAtIso: startedAtFor(12, now) },
      ledger, nowMs: now, tier: TIER.PREMIUM,
    });

    assert.equal(v.months.value, 12);
    assert.equal(v.months.source, 'ledger', '継続月数は支払い済み期間から数える');
    assert.equal(v.rank.rank, RANK.GOLD);
    assert.equal(v.rewards.balancePoints, 1200);
    // 🔴 保守ライン S-2: 12 か月目は記念品の月なので通常交換を出さない
    assert.equal(v.gifts.blockedByMilestone, true);
    assert.equal(v.gifts.available.length, 0);
    assert.ok(MILESTONE_MONTHS.includes(12));

    // 翌月ぶんの支払いが成功すると 13 か月になり、交換できる
    await store.appendEntry(EMAIL, buildAccrualEntry({
      email: EMAIL, periodRef: 'in_13', occurredAtMs: Date.UTC(2026, 8, 1),
    }));
    const next = view({
      store, profile: { membershipStartedAtIso: startedAtFor(13, now) },
      ledger: (await store.readLedger(EMAIL)).entries, nowMs: now, tier: TIER.PREMIUM,
    });
    assert.equal(next.months.value, 13);
    assert.equal(next.gifts.blockedByMilestone, false);
    assert.deepEqual(next.gifts.available.map((i) => i.id).sort(), ['large', 'large-gold', 'small']);
  });
});

/* ================================================================
   2. 解約と再加入（90 日）
   ================================================================ */

describe('E2E: 解約 → 再加入', () => {
  const now = Date.UTC(2026, 8, 15);
  const contract = createContractPrice({
    amountYen: 3980, currency: 'jpy', priceId: 'price_premium_v1', startedAtIso: '2026-02-01T00:00:00.000Z',
  });
  const ledger = [{ entryId: 'a1', type: ENTRY_TYPE.ACCRUAL, points: 600, occurredAtMs: Date.UTC(2026, 7, 1) }];

  test('解約直後: 権限は free へ、ポイントは 90 日保持される', () => {
    const cancelledAtIso = new Date(now - 5 * DAY).toISOString();

    // 権限（Stripe の subscription.deleted → PlanType=free）
    const ent = entitlementFor(planTypeToTier('free'), now);
    assert.equal(ent.showBetting, false, '買い目は閉じる');
    assert.equal(ent.showMarks, true, '印は無料会員として残る');

    const v = view({ profile: { cancelledAtIso, contractPrice: contract }, ledger, nowMs: now, tier: TIER.FREE });
    assert.equal(v.rewards.status, 'ready');
    assert.equal(v.rewards.balancePoints, 600, '解約してもすぐには消えない');
    assert.equal(v.rewards.pointsStatus, POINTS_STATUS.GRACE);
    assert.equal(v.rewards.daysLeft, GRACE_DAYS - 5);
  });

  test('90 日以内の再加入: ポイントと旧価格が戻る', () => {
    const cancelledAtIso = new Date(now - 89 * DAY).toISOString();

    const points = resolvePointsStatus({ cancelledAtIso, nowMs: now });
    assert.equal(points.status, POINTS_STATUS.GRACE);

    const reentry = resolveReentryPrice({ contract, cancelledAtIso, nowMs: now });
    assert.equal(reentry.restored, true);
    assert.equal(reentry.priceYen, 3980);
    assert.equal(reentry.priceId, 'price_premium_v1', 'Checkout には旧 Price ID を渡す');

    // 再加入後は premium として通常どおり見える
    const v = view({ profile: { contractPrice: contract }, ledger, nowMs: now, tier: TIER.PREMIUM });
    assert.equal(v.rewards.balancePoints, 600);
    assert.equal(v.priceLock.status, LOCK_STATUS.LOCKED);
    assert.equal(v.priceLock.contractPriceYen, 3980);
  });

  test('🔴 90 日超過: ポイントは失効し、価格は新価格になる', () => {
    const cancelledAtIso = new Date(now - 91 * DAY).toISOString();

    const v = view({ profile: { cancelledAtIso, contractPrice: contract }, ledger, nowMs: now, tier: TIER.FREE });
    assert.equal(v.rewards.status, 'expired');
    assert.equal(v.rewards.balancePoints, null, '失効後は残高を出さない');

    const reentry = resolveReentryPrice({ contract, cancelledAtIso, nowMs: now });
    assert.equal(reentry.restored, false);
    assert.equal(reentry.priceYen, null, '新価格（現行の Price）で申し込む');
  });

  test('境界: ちょうど 90 日でポイントと価格ロックが同時に切れる', () => {
    const at89 = new Date(now - 89 * DAY).toISOString();
    const at90 = new Date(now - 90 * DAY).toISOString();
    assert.equal(resolvePointsStatus({ cancelledAtIso: at89, nowMs: now }).status, POINTS_STATUS.GRACE);
    assert.equal(resolveReentryPrice({ contract, cancelledAtIso: at89, nowMs: now }).restored, true);
    assert.equal(resolvePointsStatus({ cancelledAtIso: at90, nowMs: now }).status, POINTS_STATUS.EXPIRED);
    assert.equal(resolveReentryPrice({ contract, cancelledAtIso: at90, nowMs: now }).restored, false);
  });
});

/* ================================================================
   3. 銀行振込の年払い
   ================================================================ */

describe('E2E: 銀行振込の年払い ¥39,800', () => {
  test('12 か月相当（1,200 pt）を一括付与し、月額会員と同じ扱いになる', async () => {
    const store = createInMemoryMembershipStore();
    const now = Date.UTC(2026, 8, 15);

    const e = buildAnnualAccrualEntry({ email: EMAIL, termRef: 'bank_2026_1', occurredAtMs: Date.UTC(2025, 8, 15) });
    assert.equal(e.points, MONTHLY_POINTS * 12);
    await store.appendEntry(EMAIL, e);

    // 🔴 同じ年払い期を二度処理しても二重付与しない
    assert.equal((await store.appendEntry(EMAIL, e)).status, STORE_RESULT.ALREADY);

    let v = view({
      store, profile: { membershipStartedAtIso: startedAtFor(12, now) },
      ledger: (await store.readLedger(EMAIL)).entries, nowMs: now, tier: TIER.PREMIUM,
    });
    assert.equal(v.rewards.balancePoints, 1200);
    assert.equal(v.months.value, 12, '年払い 1 期で 12 か月ぶん数える');
    assert.equal(v.rank.rank, RANK.GOLD, '年払いでも継続月数でランクが上がる');
    // 12 か月目は記念品の月なので通常交換は止まる（保守ライン S-2）
    assert.equal(v.gifts.blockedByMilestone, true);

    // 翌期（月額へ移行した場合など）の支払いが成功すると交換できる
    await store.appendEntry(EMAIL, buildAccrualEntry({
      email: EMAIL, periodRef: 'in_next', occurredAtMs: Date.UTC(2026, 8, 15),
    }));
    v = view({
      store, profile: { membershipStartedAtIso: startedAtFor(13, now) },
      ledger: (await store.readLedger(EMAIL)).entries, nowMs: now, tier: TIER.PREMIUM,
    });
    assert.equal(v.months.value, 13);
    assert.deepEqual(v.gifts.available.map((i) => i.id).sort(), ['large', 'large-gold', 'small']);
  });
});

/* ================================================================
   3.5 支払い失敗と再決済（TBD-10・§7.7）
   ================================================================ */

describe('E2E: 支払い失敗 → 保留 → 再決済', () => {
  const now = Date.UTC(2026, 8, 15);

  /** 支払いが成功した請求期間だけを台帳へ積む（webhook の payment_succeeded 相当）。 */
  const paid = (invoiceRef, atMs, periodMonths = PERIOD_MONTHS.MONTHLY) => buildPaidPeriodEntry({
    email: EMAIL, invoiceRef, periodMonths, occurredAtMs: atMs,
  });

  test('🔴 支払いが失敗した期間は付与されず、継続月数も増えない', async () => {
    const store = createInMemoryMembershipStore();
    // 3 か月ぶん成功
    for (let i = 1; i <= 3; i++) await store.appendEntry(EMAIL, paid(`in_${i}`, Date.UTC(2026, 5 + i, 1)));
    // 4 か月目は失敗 → **何も積まない**（webhook は payment_failed で付与を呼ばない）

    const ledger = (await store.readLedger(EMAIL)).entries;
    const tenure = resolveTenureMonths({ entries: ledger, ledgerKnown: true, nowMs: now });
    assert.equal(tenure.months, 3, '失敗した期間は継続月数に入らない');
    assert.equal(tenure.source, 'ledger');

    const s = summarizeRewards({ entries: ledger, ledgerKnown: true, nowMs: now });
    assert.equal(s.balancePoints, 300, '失敗した期間のポイントは付かない');
  });

  test('🔴 認可は支払い失敗で変わらない（リワードだけが保留される）', () => {
    // `invoice.payment_failed` は Status を変えるだけ。PlanType は premium のまま
    const ent = entitlementFor(TIER.PREMIUM, now);
    assert.equal(ent.showBetting, true, '支払い失敗でアクセスを即時停止しない');
    assert.equal(ent.showMarks, true);

    // 一方でリワードは増えていない（台帳に期間が積まれていない）
    const v = view({ profile: {}, ledger: [], nowMs: now, tier: TIER.PREMIUM });
    assert.equal(v.months.status, 'pending', '起点も台帳も無ければ月数は出さない');
    assert.equal(v.rewards.balancePoints, 0, '台帳は読めているが期間が無いので 0');
  });

  test('🔴 再決済が成功したら、その期間ぶんが 1 回だけ反映される', async () => {
    const store = createInMemoryMembershipStore();
    for (let i = 1; i <= 3; i++) await store.appendEntry(EMAIL, paid(`in_${i}`, Date.UTC(2026, 5 + i, 1)));

    // 4 か月目: 失敗 → 再試行で成功（Stripe は同じ invoice を再請求する）
    const retried = paid('in_4', Date.UTC(2026, 9, 1));
    assert.equal((await store.appendEntry(EMAIL, retried)).status, STORE_RESULT.APPLIED);

    let ledger = (await store.readLedger(EMAIL)).entries;
    assert.equal(resolveTenureMonths({ entries: ledger, ledgerKnown: true, nowMs: now }).months, 4);
    assert.equal(summarizeRewards({ entries: ledger, ledgerKnown: true, nowMs: now }).balancePoints, 400);

    // 🔴 Stripe が同じ invoice の成功を再送しても二重に付かない
    assert.equal((await store.appendEntry(EMAIL, retried)).status, STORE_RESULT.ALREADY);
    assert.equal((await store.appendEntry(EMAIL, paid('in_4', Date.UTC(2026, 9, 2)))).status, STORE_RESULT.ALREADY,
      '同じ請求期間なら発生時刻が違っても二重付与しない');

    ledger = (await store.readLedger(EMAIL)).entries;
    assert.equal(tenureMonthsFromLedger(ledger), 4, '再送で月数が増えていない');
    assert.equal(summarizeRewards({ entries: ledger, ledgerKnown: true, nowMs: now }).balancePoints, 400);
  });

  test('🔴 未払いのまま終了した期間には付与しない', async () => {
    const store = createInMemoryMembershipStore();
    for (let i = 1; i <= 3; i++) await store.appendEntry(EMAIL, paid(`in_${i}`, Date.UTC(2026, 5 + i, 1)));
    // in_4 は最後まで支払われず解約。成功イベントが来ないので台帳には何も入らない

    const cancelledAtIso = new Date(now - 10 * DAY).toISOString();
    const ledger = (await store.readLedger(EMAIL)).entries;
    const v = view({ profile: { cancelledAtIso }, ledger, nowMs: now, tier: TIER.FREE });

    assert.equal(v.months.value, 3, '未払いの 4 か月目は数えない');
    assert.equal(v.rewards.balancePoints, 300, '未払い期間のポイントは付かない');
    assert.equal(v.rewards.pointsStatus, POINTS_STATUS.GRACE, '解約後 90 日は保持される');
  });

  test('年払いは 1 期で 12 か月ぶん数える', () => {
    const annual = buildPaidPeriodEntry({
      email: EMAIL, invoiceRef: 'in_annual', periodMonths: PERIOD_MONTHS.ANNUAL, occurredAtMs: 1,
    });
    assert.equal(annual.points, 1200);
    assert.equal(annual.periodMonths, 12);
    assert.equal(tenureMonthsFromLedger([annual]), 12);
  });

  test('🔴 webhook が遅れて届いても、付与日時は実際の支払い成功時刻になる', async () => {
    const store = createInMemoryMembershipStore();
    // 8 月分の支払いが成功したが、webhook が 9 月に遅延して届いた場合
    const actuallyPaidAt = Date.UTC(2026, 7, 20);   // 実際の支払い成功時刻（Stripe の paid_at）
    await store.appendEntry(EMAIL, paid('in_aug', actuallyPaidAt));

    const ledger = (await store.readLedger(EMAIL)).entries;
    const s = summarizeRewards({ entries: ledger, ledgerKnown: true, nowMs: now });

    assert.equal(s.balancePoints, 100);
    assert.equal(s.monthAccrualPoints, 0,
      '🔴 8 月の支払いが「今月（9月）の積み上げ」に混ざってはいけない');

    // 受信時刻を使っていたら 9 月扱いになり、ここが 100 になってしまう
    const wrong = summarizeRewards({
      entries: [paid('in_aug_wrong', now)], ledgerKnown: true, nowMs: now,
    });
    assert.equal(wrong.monthAccrualPoints, 100, '対比: 受信時刻で積むと当月に入ってしまう');
  });

  test('🔴 遅延再送・順序入れ替えでも二重付与しない', async () => {
    const store = createInMemoryMembershipStore();
    const aug = paid('in_aug', Date.UTC(2026, 7, 20));
    const sep = paid('in_sep', Date.UTC(2026, 8, 20));

    // 9 月分が先に届き、そのあと 8 月分が遅れて届く
    await store.appendEntry(EMAIL, sep);
    await store.appendEntry(EMAIL, aug);
    // それぞれが再送される
    assert.equal((await store.appendEntry(EMAIL, aug)).status, STORE_RESULT.ALREADY);
    assert.equal((await store.appendEntry(EMAIL, sep)).status, STORE_RESULT.ALREADY);
    // 同じ請求期間で発生時刻だけ違うものが来ても増えない
    assert.equal((await store.appendEntry(EMAIL, paid('in_aug', Date.UTC(2026, 7, 21)))).status, STORE_RESULT.ALREADY);

    const ledger = (await store.readLedger(EMAIL)).entries;
    assert.equal(ledger.length, 2, '台帳に 2 行だけ');
    assert.equal(tenureMonthsFromLedger(ledger), 2);
    assert.equal(summarizeRewards({ entries: ledger, ledgerKnown: true, nowMs: now }).balancePoints, 200);
  });

  test('🔴 interval_count 欠落: invoice → 付与判定 → 台帳 まで通して付与されない', async () => {
    const { periodMonthsFromInvoice, paidAtMsFromInvoice } =
      await import('../../../netlify/functions/stripe-webhook.js');

    const store = createInMemoryMembershipStore();
    // 先に 2 期ぶん正常に積んでおく（あとで増えていないことを確認するため）
    await store.appendEntry(EMAIL, paid('in_1', Date.UTC(2026, 6, 20)));
    await store.appendEntry(EMAIL, paid('in_2', Date.UTC(2026, 7, 20)));
    const beforeWrites = store.writeCount();

    // interval_count が欠落した invoice が届いた
    const invoice = {
      id: 'in_no_count',
      status_transitions: { paid_at: Math.floor(Date.UTC(2026, 8, 1) / 1000) },
      lines: { data: [{ price: { recurring: { interval: 'month' } } }] },
    };

    // webhook が行う判定をそのまま通す
    const periodMonths = periodMonthsFromInvoice(invoice);
    assert.equal(periodMonths, null, '🔴 1 で補完している');

    const occurredAtMs = paidAtMsFromInvoice(invoice);
    assert.ok(Number.isFinite(occurredAtMs), '支払い時刻は取れている（欠落しているのは間隔だけ）');

    // 判定が null なので付与エントリを作らない → 台帳は増えない
    const entry = buildPaidPeriodEntry({ email: EMAIL, invoiceRef: invoice.id, periodMonths, occurredAtMs });
    assert.equal(entry, null);
    assert.equal(store.writeCount(), beforeWrites, '台帳へ書き込まれている');

    const ledger = (await store.readLedger(EMAIL)).entries;
    assert.equal(ledger.length, 2, '保留されず付与されている');
    assert.equal(tenureMonthsFromLedger(ledger), 2, '継続月数が増えている');
    assert.equal(summarizeRewards({ entries: ledger, ledgerKnown: true, nowMs: now }).balancePoints, 200);

    // 🔴 あとで正しい interval_count 付きで再送されれば、そのとき 1 回だけ付く
    const fixed = { ...invoice, lines: { data: [{ price: { recurring: { interval: 'month', interval_count: 1 } } }] } };
    const retryMonths = periodMonthsFromInvoice(fixed);
    assert.equal(retryMonths, 1);
    const retryEntry = buildPaidPeriodEntry({
      email: EMAIL, invoiceRef: fixed.id, periodMonths: retryMonths, occurredAtMs: paidAtMsFromInvoice(fixed),
    });
    assert.equal((await store.appendEntry(EMAIL, retryEntry)).status, STORE_RESULT.APPLIED);
    assert.equal((await store.appendEntry(EMAIL, retryEntry)).status, STORE_RESULT.ALREADY, '再送で二重付与しない');

    const after = (await store.readLedger(EMAIL)).entries;
    assert.equal(tenureMonthsFromLedger(after), 3);
    assert.equal(summarizeRewards({ entries: after, ledgerKnown: true, nowMs: now }).balancePoints, 300);
  });

  test('🔴 請求間隔が判定できない期間は付与しない（月額へ丸めない）', () => {
    // 呼び出し側（webhook）が periodMonths=null を渡さない設計だが、
    // 万一 0 や負数が来ても付与エントリを作らないことを固定する
    for (const bad of [0, -1, 1.5, null, undefined, 'month']) {
      assert.equal(
        buildPaidPeriodEntry({ email: EMAIL, invoiceRef: 'in_bad', periodMonths: bad, occurredAtMs: now }),
        null,
        `periodMonths=${bad} で付与エントリを作っている`,
      );
    }
  });

  test('🔴 支払い時刻が無ければ付与エントリを作らない', () => {
    for (const bad of [null, undefined, NaN, 'x']) {
      assert.equal(
        buildPaidPeriodEntry({ email: EMAIL, invoiceRef: 'in_bad', periodMonths: 1, occurredAtMs: bad }),
        null,
        `occurredAtMs=${bad} で付与エントリを作っている`,
      );
    }
  });

  test('四半期払い（3 か月）はそのぶん数える（月額へ潰さない）', () => {
    const q = buildPaidPeriodEntry({ email: EMAIL, invoiceRef: 'in_q', periodMonths: 3, occurredAtMs: now });
    assert.equal(q.points, 300);
    assert.equal(q.periodMonths, 3);
    assert.equal(tenureMonthsFromLedger([q]), 3);
  });

  test('台帳が無い既存会員は起点（支払い成功日）からの経過で数える（TBD-9 の後方互換）', () => {
    const startedAtIso = startedAtFor(7, now);
    const t = resolveTenureMonths({ entries: [], ledgerKnown: true, startedAtIso, nowMs: now });
    assert.equal(t.months, 7);
    assert.equal(t.source, 'legacy');
  });

  test('🔴 起点も台帳も無ければ pending（0 か月＝Bronze へ倒さない）', () => {
    const t = resolveTenureMonths({ entries: [], ledgerKnown: true, startedAtIso: null, nowMs: now });
    assert.equal(t.status, 'pending');
    assert.equal(t.months, null);

    const v = view({ profile: {}, ledger: [], nowMs: now, tier: TIER.PREMIUM });
    assert.equal(v.rank.status, 'pending');
    assert.equal(v.rank.rank, null, '起点不明の会員を Bronze で表示しない');
  });
});

/* ================================================================
   4. fail-closed / 混入防止 / 認可の回帰
   ================================================================ */

describe('E2E: 安全性', () => {
  const now = Date.UTC(2026, 8, 15);

  test('🔴 台帳が読めないときは残高を 0 と言わない', () => {
    const v = view({ profile: { membershipStartedAtIso: startedAtFor(6, now) }, ledger: null, nowMs: now, tier: TIER.PREMIUM });
    assert.equal(v.rewards.status, 'pending');
    assert.equal(v.rewards.balancePoints, null);
    assert.equal(v.gifts.status, 'pending');
    assert.equal(v.history.status, 'pending');
  });

  test('🔴 継続月数が不明ならランクを出さない（Bronze へ倒さない）', () => {
    const v = view({ profile: {}, ledger: [], nowMs: now, tier: TIER.PREMIUM });
    assert.equal(v.months.status, 'pending');
    assert.equal(v.rank.status, 'pending');
    assert.equal(v.rank.rank, null);
  });

  test('🔴 他会員のポイントが混ざらない', async () => {
    const store = createInMemoryMembershipStore();
    await store.appendEntry(EMAIL, buildAccrualEntry({ email: EMAIL, periodRef: 'in_1', occurredAtMs: 1 }));
    await store.appendEntry(EMAIL, buildAccrualEntry({ email: EMAIL, periodRef: 'in_2', occurredAtMs: 2 }));
    await store.appendEntry(OTHER, buildAccrualEntry({ email: OTHER, periodRef: 'in_1', occurredAtMs: 1 }));

    assert.equal((await store.readLedger(EMAIL)).entries.length, 2);
    assert.equal((await store.readLedger(OTHER)).entries.length, 1);

    // 冪等キーに email が入っているので、同じ periodRef でも別会員として扱われる
    const a = buildAccrualEntry({ email: EMAIL, periodRef: 'in_1', occurredAtMs: 1 });
    const b = buildAccrualEntry({ email: OTHER, periodRef: 'in_1', occurredAtMs: 1 });
    assert.notEqual(a.entryId, b.entryId);
  });

  test('🔴 一方の解約が他方へ波及しない', async () => {
    const store = createInMemoryMembershipStore();
    await store.appendEntry(EMAIL, buildAccrualEntry({ email: EMAIL, periodRef: 'in_1', occurredAtMs: 1 }));
    await store.appendEntry(OTHER, buildAccrualEntry({ email: OTHER, periodRef: 'in_1', occurredAtMs: 1 }));

    const cancelled = new Date(now - 91 * DAY).toISOString();
    const a = summarizeRewards({ entries: (await store.readLedger(EMAIL)).entries, ledgerKnown: true, cancelledAtIso: cancelled, nowMs: now });
    const b = summarizeRewards({ entries: (await store.readLedger(OTHER)).entries, ledgerKnown: true, cancelledAtIso: null, nowMs: now });
    assert.equal(a.status, 'expired');
    assert.equal(b.status, 'ready');
    assert.equal(b.balancePoints, 100);
  });

  test('🔴 認可の回帰: guest / free / premium の見え方が変わっていない', () => {
    const guest = resolveEntitlement({ cookieHeader: null, env: { SESSION_SIGNING_SECRET: SECRET }, nowMs: now });
    assert.equal(guest.tier, TIER.GUEST);
    assert.equal(guest.showMarks, false);
    assert.equal(guest.showBetting, false);

    const free = entitlementFor(TIER.FREE, now);
    assert.equal(free.showMarks, true);
    assert.equal(free.showBetting, false);

    const premium = entitlementFor(TIER.PREMIUM, now);
    assert.equal(premium.showBetting, true);
  });

  test('🔴 会員クラブのビューは認可フラグを作らない', () => {
    const v = view({ profile: { membershipStartedAtIso: startedAtFor(24, now) }, ledger: [], nowMs: now, tier: TIER.PREMIUM });
    for (const forbidden of ['showMarks', 'showBetting']) {
      assert.equal(forbidden in v, false);
    }
    assert.equal(v.rank.rank, RANK.PLATINUM, 'ランクは最上位でも認可には影響しない');
  });

  test('🔴 署名鍵が無ければ guest（会員クラブも出ない）', () => {
    const ent = resolveEntitlement({ cookieHeader: 'ki_session=whatever', env: {}, nowMs: now });
    assert.equal(ent.tier, TIER.GUEST);
    const v = buildMembershipView({ entitlement: ent, profile: null, ledger: null, config: {}, catalogSource: CATALOG_SOURCE, nowMs: now });
    assert.equal(v.isPaid, false);
    assert.equal(v.priceLock.status, LOCK_STATUS.NOT_APPLICABLE);
  });
});
