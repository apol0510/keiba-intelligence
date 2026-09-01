/**
 * membership.test.mjs — 会員継続制度の不変条件
 *
 * 正本: docs/MEMBERSHIP_REWARDS.md
 *
 * ここで固定するのは「確定した構造」と「未確定を確定に見せない fail-closed」である。
 * 🔴 未確定の数値（TBD-1〜TBD-8）を期待値として書かないこと。
 *    テスト内で使う閾値・ポイント数は **テスト専用の任意値**であり、仕様値ではない。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  RANK, RANK_ORDER, RANK_LABEL, RANK_THRESHOLDS_UNSET,
  isRankThresholdsConfigured, resolveRank, readRankThresholds,
} from './ranks.js';
import {
  ENTRY_TYPE, ACCRUAL_UNSET, isAccrualConfigured, isValidEntry,
  buildEntryId, dedupeEntries, summarizeRewards,
  buildAccrualEntry, buildRedemptionEntry, readAccrualConfig,
} from './rewards.js';
import {
  ITEM_KIND, EMPTY_CATALOG, createCatalog, isCatalogPublished,
  redeemableItems, milestoneItems, exchangeView,
} from './catalog.js';
import {
  LOCK_STATUS, createContractPrice, contractPriceFromCheckoutSession,
  contractPriceFromSubscription, resolvePriceLock, resolveReentryPrice,
} from './priceLock.js';
import {
  STORE_RESULT, MEMBERSHIP_WRITE_ENV, isWriteEnabled,
  createDisabledMembershipStore, createInMemoryMembershipStore, resolveMembershipStore,
} from './store.js';
import {
  buildMembershipView, continuationMonths, PRICING_BENEFITS, RANK_LADDER, MEMBERSHIP_COPY,
} from './membershipView.js';
import { TIER } from '../auth/tiers.js';

/** テスト専用の任意値。**仕様値ではない**（TBD-2）。 */
const TEST_THRESHOLDS = Object.freeze({ bronze: 0, silver: 3, gold: 6, platinum: 12 });
/** テスト専用の任意値。**仕様値ではない**（TBD-1）。 */
const TEST_ACCRUAL = Object.freeze({ monthlyPoints: 100, rankBonusPoints: { gold: 20 } });

const ent = (tier) => ({ tier, tierLabel: tier });

/* ================================================================
   ランク（M-5）
   ================================================================ */

describe('会員ランク', () => {
  test('ランクは Bronze / Silver / Gold / Platinum の 4 段階（増やさない）', () => {
    assert.deepEqual(RANK_ORDER, ['bronze', 'silver', 'gold', 'platinum']);
    assert.deepEqual(
      RANK_ORDER.map((r) => RANK_LABEL[r]),
      ['Bronze', 'Silver', 'Gold', 'Platinum'],
    );
  });

  test('🔴 昇格月数は未設定（TBD-2）。既定値を持たない', () => {
    for (const r of RANK_ORDER) assert.equal(RANK_THRESHOLDS_UNSET[r], null);
    assert.equal(isRankThresholdsConfigured(RANK_THRESHOLDS_UNSET), false);
  });

  test('🔴 閾値未設定なら Bronze へ倒さず、ランクを返さない', () => {
    const r = resolveRank(24, RANK_THRESHOLDS_UNSET);
    assert.equal(r.configured, false);
    assert.equal(r.rank, null);
    assert.equal(r.rankLabel, null);
  });

  test('🔴 継続月数が不明ならランクを返さない', () => {
    const r = resolveRank(null, TEST_THRESHOLDS);
    assert.equal(r.monthsKnown, false);
    assert.equal(r.rank, null);
  });

  test('閾値が揃っていれば継続月数からランクと次の目標を出す', () => {
    const r = resolveRank(7, TEST_THRESHOLDS);
    assert.equal(r.rank, RANK.GOLD);
    assert.equal(r.nextRank, RANK.PLATINUM);
    assert.equal(r.monthsToNext, 5);
    assert.ok(r.progressRatio > 0 && r.progressRatio < 1);
  });

  test('最上位に到達したら次のランクは無い', () => {
    const r = resolveRank(99, TEST_THRESHOLDS);
    assert.equal(r.rank, RANK.PLATINUM);
    assert.equal(r.nextRank, null);
    assert.equal(r.progressRatio, 1);
  });

  test('順序が逆転・欠落・非整数の設定は未設定として扱う（推測補完しない）', () => {
    assert.equal(isRankThresholdsConfigured({ bronze: 0, silver: 6, gold: 3, platinum: 12 }), false);
    assert.equal(isRankThresholdsConfigured({ bronze: 0, silver: 3, gold: 3, platinum: 12 }), false);
    assert.equal(isRankThresholdsConfigured({ bronze: 1, silver: 3, gold: 6, platinum: 12 }), false);
    assert.equal(isRankThresholdsConfigured({ bronze: 0, silver: 3, gold: 6 }), false);
    assert.equal(isRankThresholdsConfigured({ bronze: 0, silver: 3.5, gold: 6, platinum: 12 }), false);
  });

  test('readRankThresholds: 壊れた JSON / 不正な設定は未設定へ倒す', () => {
    assert.equal(isRankThresholdsConfigured(readRankThresholds({ KI_RANK_THRESHOLDS: '{oops' })), false);
    assert.equal(isRankThresholdsConfigured(readRankThresholds({})), false);
    assert.equal(isRankThresholdsConfigured(readRankThresholds({ KI_RANK_THRESHOLDS: TEST_THRESHOLDS })), true);
  });
});

/* ================================================================
   リワード（M-4 / 積み上げ）
   ================================================================ */

describe('KIリワード', () => {
  test('🔴 付与ポイント数は未設定（TBD-1）。既定値を持たない', () => {
    assert.equal(ACCRUAL_UNSET.monthlyPoints, null);
    assert.equal(isAccrualConfigured(ACCRUAL_UNSET), false);
    assert.equal(isAccrualConfigured({ monthlyPoints: 0 }), false);
    assert.equal(isAccrualConfigured({ monthlyPoints: -1 }), false);
  });

  test('🔴 付与設定が無ければ残高を 0 と表示せず pending を返す', () => {
    const s = summarizeRewards({ entries: [], accrual: ACCRUAL_UNSET, ledgerKnown: true });
    assert.equal(s.status, 'pending');
    assert.equal(s.reason, 'accrual_unset');
    assert.equal(s.balancePoints, null);
  });

  test('🔴 台帳が読めなければ pending（0 pt と言わない）', () => {
    const s = summarizeRewards({ entries: null, accrual: TEST_ACCRUAL, ledgerKnown: false });
    assert.equal(s.status, 'pending');
    assert.equal(s.reason, 'ledger_unavailable');
    assert.equal(s.balancePoints, null);
  });

  test('残高は台帳の合計。今月の積み上げは当月の付与だけ', () => {
    const now = Date.UTC(2026, 8, 15);
    const s = summarizeRewards({
      accrual: TEST_ACCRUAL,
      ledgerKnown: true,
      nowMs: now,
      entries: [
        { entryId: 'a1', type: ENTRY_TYPE.ACCRUAL, points: 100, occurredAtMs: Date.UTC(2026, 7, 3) },
        { entryId: 'a2', type: ENTRY_TYPE.ACCRUAL, points: 100, occurredAtMs: Date.UTC(2026, 8, 3) },
        { entryId: 'r1', type: ENTRY_TYPE.REDEMPTION, points: -50, occurredAtMs: Date.UTC(2026, 8, 5) },
      ],
    });
    assert.equal(s.status, 'ready');
    assert.equal(s.balancePoints, 150);
    assert.equal(s.monthAccrualPoints, 100);
    assert.equal(s.redemptions.length, 1);
  });

  test('🔴 同じ entryId は 1 件に畳む（二重付与しない）', () => {
    const e = { entryId: 'dup', type: ENTRY_TYPE.ACCRUAL, points: 100, occurredAtMs: 1 };
    assert.equal(dedupeEntries([e, { ...e }, { ...e }]).length, 1);
    const s = summarizeRewards({ entries: [e, { ...e }], accrual: TEST_ACCRUAL, ledgerKnown: true });
    assert.equal(s.balancePoints, 100);
  });

  test('符号の取り違えた行は集計に入れない', () => {
    assert.equal(isValidEntry({ entryId: 'x', type: ENTRY_TYPE.ACCRUAL, points: -1, occurredAtMs: 1 }), false);
    assert.equal(isValidEntry({ entryId: 'x', type: ENTRY_TYPE.REDEMPTION, points: 1, occurredAtMs: 1 }), false);
    assert.equal(isValidEntry({ entryId: 'x', type: 'unknown', points: 1, occurredAtMs: 1 }), false);
  });

  test('冪等キーは type / email / ref から一意に決まる', () => {
    const a = buildEntryId({ type: ENTRY_TYPE.ACCRUAL, email: 'A@Example.com', ref: 'in_1' });
    const b = buildEntryId({ type: ENTRY_TYPE.ACCRUAL, email: 'a@example.com', ref: 'in_1' });
    assert.equal(a, b);
    assert.notEqual(a, buildEntryId({ type: ENTRY_TYPE.ACCRUAL, email: 'a@example.com', ref: 'in_2' }));
    assert.equal(buildEntryId({ type: ENTRY_TYPE.ACCRUAL, email: '', ref: 'in_1' }), null);
  });

  test('🔴 付与設定が無ければ付与エントリを作らない（0 pt の行を作らない）', () => {
    const r = buildAccrualEntry({
      accrual: ACCRUAL_UNSET, rank: RANK.GOLD, email: 'a@example.com',
      periodRef: 'in_1', occurredAtMs: 1,
    });
    assert.equal(r, null);
  });

  test('長期会員優遇: ランク別の上乗せは設定があるときだけ加算する', () => {
    const base = buildAccrualEntry({
      accrual: TEST_ACCRUAL, rank: null, email: 'a@example.com', periodRef: 'in_1', occurredAtMs: 1,
    });
    const gold = buildAccrualEntry({
      accrual: TEST_ACCRUAL, rank: RANK.GOLD, email: 'a@example.com', periodRef: 'in_1', occurredAtMs: 1,
    });
    assert.equal(base.points, 100);
    assert.equal(gold.points, 120);
    assert.equal(base.entryId, gold.entryId, '冪等キーは付与額で変わらない');
  });

  test('🔴 残高不足の交換は作らない（マイナス残高を許さない）', () => {
    const summary = summarizeRewards({
      accrual: TEST_ACCRUAL, ledgerKnown: true,
      entries: [{ entryId: 'a1', type: ENTRY_TYPE.ACCRUAL, points: 100, occurredAtMs: 1 }],
    });
    assert.equal(buildRedemptionEntry({
      summary, costPoints: 101, email: 'a@example.com', redemptionId: 'rx1', occurredAtMs: 2,
    }), null);
    const ok = buildRedemptionEntry({
      summary, costPoints: 100, email: 'a@example.com', redemptionId: 'rx1', occurredAtMs: 2,
    });
    assert.equal(ok.points, -100);
  });

  test('🔴 集計が pending のときは交換エントリを作らない', () => {
    const summary = summarizeRewards({ entries: null, accrual: TEST_ACCRUAL, ledgerKnown: false });
    assert.equal(buildRedemptionEntry({
      summary, costPoints: 1, email: 'a@example.com', redemptionId: 'rx1', occurredAtMs: 2,
    }), null);
  });

  test('readAccrualConfig: 壊れた設定は未設定へ倒す', () => {
    assert.equal(isAccrualConfigured(readAccrualConfig({ KI_REWARD_ACCRUAL: 'nope' })), false);
    assert.equal(isAccrualConfigured(readAccrualConfig({})), false);
    assert.equal(isAccrualConfigured(readAccrualConfig({ KI_REWARD_ACCRUAL: TEST_ACCRUAL })), true);
  });
});

/* ================================================================
   景品カタログ（M-2 / M-3 / M-6）
   ================================================================ */

describe('景品カタログ', () => {
  test('🔴 リポジトリ同梱のカタログは未公開（架空の商品を持たない）', async () => {
    const raw = (await import('../../data/membership/rewardCatalog.json', { with: { type: 'json' } })).default;
    assert.equal(raw.status, 'draft');
    assert.deepEqual(raw.items, []);
    assert.equal(isCatalogPublished(createCatalog(raw)), false);
  });

  test('🔴 draft のカタログは空として扱う（下書きを客へ出さない）', () => {
    const c = createCatalog({
      version: 1, status: 'draft',
      items: [{ id: 'x', name: 'テスト品', kind: ITEM_KIND.REDEEMABLE, costPoints: 10 }],
    });
    assert.equal(c.items.length, 0);
    assert.equal(isCatalogPublished(c), false);
  });

  test('必要ポイントが無い redeemable は除外する（TBD-3 未確定の item を出さない）', () => {
    const c = createCatalog({
      version: 1, status: 'published',
      items: [
        { id: 'ok', name: 'A', kind: ITEM_KIND.REDEEMABLE, costPoints: 10 },
        { id: 'ng', name: 'B', kind: ITEM_KIND.REDEEMABLE },
        { id: 'ng2', name: 'C', kind: ITEM_KIND.REDEEMABLE, costPoints: 0 },
      ],
    });
    assert.deepEqual(redeemableItems(c).map((i) => i.id), ['ok']);
  });

  test('継続記念品はポイント交換と別枠で持てる', () => {
    const c = createCatalog({
      version: 1, status: 'published',
      items: [
        { id: 'm1', name: '記念品', kind: ITEM_KIND.MILESTONE, milestoneMonths: 12 },
        { id: 'r1', name: '交換品', kind: ITEM_KIND.REDEEMABLE, costPoints: 10 },
      ],
    });
    assert.deepEqual(milestoneItems(c).map((i) => i.id), ['m1']);
    assert.deepEqual(redeemableItems(c).map((i) => i.id), ['r1']);
  });

  test('カタログはデータ駆動で差し替えられる（コードに商品を固定しない）', () => {
    const c1 = createCatalog({ version: 1, status: 'published', items: [{ id: 'a', name: 'A', kind: ITEM_KIND.REDEEMABLE, costPoints: 5 }] });
    const c2 = createCatalog({ version: 2, status: 'published', items: [{ id: 'b', name: 'B', kind: ITEM_KIND.REDEEMABLE, costPoints: 7 }] });
    assert.deepEqual(c1.items.map((i) => i.id), ['a']);
    assert.deepEqual(c2.items.map((i) => i.id), ['b']);
  });

  test('🔴 残高が未確定なら「あと◯pt」を出さない', () => {
    const c = createCatalog({ version: 1, status: 'published', items: [{ id: 'a', name: 'A', kind: ITEM_KIND.REDEEMABLE, costPoints: 500 }] });
    const v = exchangeView({ catalog: c, balancePoints: null, rank: null });
    assert.equal(v.status, 'pending');
    assert.equal(v.next, null);
    assert.equal(v.available.length, 0);
  });

  test('交換可能・次の目標を残高から出す', () => {
    const c = createCatalog({
      version: 1, status: 'published',
      items: [
        { id: 'cheap', name: 'A', kind: ITEM_KIND.REDEEMABLE, costPoints: 100 },
        { id: 'mid', name: 'B', kind: ITEM_KIND.REDEEMABLE, costPoints: 300 },
        { id: 'far', name: 'C', kind: ITEM_KIND.REDEEMABLE, costPoints: 900 },
      ],
    });
    const v = exchangeView({ catalog: c, balancePoints: 150, rank: null });
    assert.deepEqual(v.available.map((i) => i.id), ['cheap']);
    assert.equal(v.next.item.id, 'mid');
    assert.equal(v.next.remainingPoints, 150);
  });

  test('🔴 ランク条件付きの景品は、ランク未確定なら出さない（fail-closed）', () => {
    const c = createCatalog({
      version: 1, status: 'published',
      items: [{ id: 'gold-only', name: 'G', kind: ITEM_KIND.REDEEMABLE, costPoints: 10, minRank: RANK.GOLD }],
    });
    assert.equal(exchangeView({ catalog: c, balancePoints: 999, rank: null }).available.length, 0);
    assert.equal(exchangeView({ catalog: c, balancePoints: 999, rank: RANK.SILVER }).available.length, 0);
    assert.equal(exchangeView({ catalog: c, balancePoints: 999, rank: RANK.PLATINUM }).available.length, 1);
  });

  test('空カタログの既定は EMPTY_CATALOG', () => {
    assert.equal(createCatalog(null).items.length, 0);
    assert.equal(EMPTY_CATALOG.items.length, 0);
  });
});

/* ================================================================
   継続価格ロック（M-1）
   ================================================================ */

describe('継続価格ロック', () => {
  test('契約価格は会員単位で保持できる形を持つ', () => {
    const c = createContractPrice({
      amountYen: 3980, currency: 'jpy', priceId: 'price_test', startedAtIso: '2026-09-01T00:00:00.000Z',
    });
    assert.equal(c.amountYen, 3980);
    assert.equal(c.priceId, 'price_test');
  });

  test('🔴 金額・通貨・Price ID が欠けたら null（¥3,980 を推測で当てない）', () => {
    assert.equal(createContractPrice({ currency: 'jpy', priceId: 'p', startedAtIso: '2026-09-01T00:00:00.000Z' }), null);
    assert.equal(createContractPrice({ amountYen: 3980, priceId: 'p', startedAtIso: '2026-09-01T00:00:00.000Z' }), null);
    assert.equal(createContractPrice({ amountYen: 3980, currency: 'jpy', startedAtIso: '2026-09-01T00:00:00.000Z' }), null);
    assert.equal(createContractPrice({ amountYen: 0, currency: 'jpy', priceId: 'p', startedAtIso: '2026-09-01T00:00:00.000Z' }), null);
  });

  test('Checkout Session から契約価格を取り出す（JPY のみ）', () => {
    const session = {
      currency: 'jpy',
      amount_total: 3980,
      line_items: { data: [{ price: { id: 'price_x' } }] },
    };
    const c = contractPriceFromCheckoutSession(session, { nowIso: '2026-09-01T00:00:00.000Z' });
    assert.equal(c.amountYen, 3980);
    assert.equal(c.priceId, 'price_x');

    assert.equal(contractPriceFromCheckoutSession({ ...session, currency: 'usd' }), null, 'JPY 以外は扱わない');
    assert.equal(contractPriceFromCheckoutSession({ ...session, amount_total: null }), null);
    assert.equal(contractPriceFromCheckoutSession(null), null);
  });

  test('Subscription からも契約価格を取り出せる', () => {
    const sub = { items: { data: [{ price: { id: 'price_y', currency: 'jpy', unit_amount: 3980 } }] } };
    const c = contractPriceFromSubscription(sub, { nowIso: '2026-09-01T00:00:00.000Z' });
    assert.equal(c.priceId, 'price_y');
    assert.equal(contractPriceFromSubscription({ items: { data: [] } }), null);
  });

  test('🔴 契約価格が未保存なら unknown（準備中）。無料会員は not_applicable', () => {
    assert.equal(resolvePriceLock({ isPaid: true, contract: null }).status, LOCK_STATUS.UNKNOWN);
    assert.equal(resolvePriceLock({ isPaid: false, contract: null }).status, LOCK_STATUS.NOT_APPLICABLE);
  });

  test('契約価格があればロック状態を返す', () => {
    const c = createContractPrice({ amountYen: 3980, currency: 'jpy', priceId: 'p', startedAtIso: '2026-09-01T00:00:00.000Z' });
    const r = resolvePriceLock({ isPaid: true, contract: c, currentListPriceYen: 5000 });
    assert.equal(r.status, LOCK_STATUS.LOCKED);
    assert.equal(r.contractPriceYen, 3980);
    assert.equal(r.cheaperThanCurrent, true);
  });

  test('🔴 再加入時の価格は未確定（TBD-8）。勝手に決めない', () => {
    const r = resolveReentryPrice();
    assert.equal(r.decided, false);
    assert.equal(r.priceYen, null);
  });
});

/* ================================================================
   永続化（fail-closed）
   ================================================================ */

describe('永続化', () => {
  test('🔴 既定は disabled。読み書きとも unavailable', async () => {
    const s = createDisabledMembershipStore();
    assert.equal(s.enabled, false);
    assert.equal((await s.readProfile('a@example.com')).status, STORE_RESULT.UNAVAILABLE);
    assert.equal((await s.readLedger('a@example.com')).status, STORE_RESULT.UNAVAILABLE);
    assert.equal((await s.appendEntry('a@example.com', {})).writes, 0);
    assert.equal((await s.saveContractPrice('a@example.com', {})).writes, 0);
  });

  test('🔴 env フラグが無い / アダプタが無い → disabled', () => {
    assert.equal(isWriteEnabled({}), false);
    assert.equal(isWriteEnabled({ [MEMBERSHIP_WRITE_ENV]: 'yes' }), false);
    assert.equal(isWriteEnabled({ [MEMBERSHIP_WRITE_ENV]: 'true' }), true);

    assert.equal(resolveMembershipStore({ env: {}, adapter: createInMemoryMembershipStore() }).enabled, false);
    assert.equal(resolveMembershipStore({ env: { [MEMBERSHIP_WRITE_ENV]: 'true' }, adapter: null }).enabled, false);
    assert.equal(
      resolveMembershipStore({ env: { [MEMBERSHIP_WRITE_ENV]: 'true' }, adapter: createInMemoryMembershipStore() }).enabled,
      true,
    );
  });

  test('台帳への追記は冪等（同じ entryId で二度書かない）', async () => {
    const s = createInMemoryMembershipStore();
    const entry = { entryId: 'accrual:a@example.com:in_1', type: ENTRY_TYPE.ACCRUAL, points: 100, occurredAtMs: 1 };
    assert.equal((await s.appendEntry('a@example.com', entry)).status, STORE_RESULT.APPLIED);
    assert.equal((await s.appendEntry('a@example.com', entry)).status, STORE_RESULT.ALREADY);
    assert.equal(s.writeCount(), 1);
  });

  test('🔴 契約価格は上書きしない（加入時の価格を維持するのが制度の目的）', async () => {
    const s = createInMemoryMembershipStore();
    const first = createContractPrice({ amountYen: 3980, currency: 'jpy', priceId: 'p1', startedAtIso: '2026-09-01T00:00:00.000Z' });
    const later = createContractPrice({ amountYen: 5000, currency: 'jpy', priceId: 'p2', startedAtIso: '2027-01-01T00:00:00.000Z' });
    assert.equal((await s.saveContractPrice('a@example.com', first)).status, STORE_RESULT.APPLIED);
    assert.equal((await s.saveContractPrice('a@example.com', later)).status, STORE_RESULT.ALREADY);
    assert.equal((await s.readProfile('a@example.com')).profile.contractPrice.amountYen, 3980);
  });

  test('会員ごとに独立している（他会員へ混入しない）', async () => {
    const s = createInMemoryMembershipStore();
    await s.appendEntry('a@example.com', { entryId: 'e1', type: ENTRY_TYPE.ACCRUAL, points: 100, occurredAtMs: 1 });
    assert.equal((await s.readLedger('b@example.com')).entries.length, 0);
  });
});

/* ================================================================
   表示ビュー
   ================================================================ */

describe('会員クラブの表示ビュー', () => {
  test('🔴 何も設定されていない本番既定では、すべて pending（架空値を出さない）', () => {
    const v = buildMembershipView({ entitlement: ent(TIER.PREMIUM), config: {}, catalogSource: null });
    assert.equal(v.isPaid, true);
    assert.equal(v.months.status, 'pending');
    assert.equal(v.rank.status, 'pending');
    assert.equal(v.rank.rank, null);
    assert.equal(v.rewards.status, 'pending');
    assert.equal(v.rewards.balancePoints, null);
    assert.equal(v.gifts.status, 'pending');
    assert.equal(v.gifts.catalogPublished, false);
    assert.equal(v.priceLock.status, LOCK_STATUS.UNKNOWN);
    assert.equal(v.history.items.length, 0);
  });

  test('無料会員でも例外を投げず、価格ロックは not_applicable', () => {
    const v = buildMembershipView({ entitlement: ent(TIER.FREE), config: {} });
    assert.equal(v.isPaid, false);
    assert.equal(v.priceLock.status, LOCK_STATUS.NOT_APPLICABLE);
  });

  test('entitlement が無くても落ちない（guest 扱い）', () => {
    const v = buildMembershipView({});
    assert.equal(v.tier, TIER.GUEST);
    assert.equal(v.isPaid, false);
  });

  test('設定・台帳が揃えば実データを出す', () => {
    const now = Date.UTC(2026, 8, 15);
    const v = buildMembershipView({
      entitlement: ent(TIER.PREMIUM),
      profile: {
        membershipStartedAtIso: '2026-02-15T00:00:00.000Z',
        contractPrice: createContractPrice({ amountYen: 3980, currency: 'jpy', priceId: 'p', startedAtIso: '2026-02-15T00:00:00.000Z' }),
      },
      ledger: [{ entryId: 'a1', type: ENTRY_TYPE.ACCRUAL, points: 100, occurredAtMs: Date.UTC(2026, 8, 3) }],
      config: { KI_RANK_THRESHOLDS: TEST_THRESHOLDS, KI_REWARD_ACCRUAL: TEST_ACCRUAL },
      catalogSource: { version: 1, status: 'published', items: [{ id: 'a', name: 'A', kind: ITEM_KIND.REDEEMABLE, costPoints: 300 }] },
      currentListPriceYen: 5000,
      nowMs: now,
    });
    assert.equal(v.months.value, 7);
    assert.equal(v.rank.rank, RANK.GOLD);
    assert.equal(v.rewards.balancePoints, 100);
    assert.equal(v.rewards.monthAccrualPoints, 100);
    assert.equal(v.gifts.next.remainingPoints, 200);
    assert.equal(v.priceLock.status, LOCK_STATUS.LOCKED);
    assert.equal(v.priceLock.contractPriceYen, 3980);
  });

  test('🔴 特典履歴: 台帳が読めないときは ready にしない（0件と同じ扱いにしない）', () => {
    // 付与設定も台帳も無い本番既定 → pending
    const pending = buildMembershipView({ entitlement: ent(TIER.PREMIUM), config: {} });
    assert.equal(pending.history.status, 'pending');
    assert.equal(pending.history.items.length, 0);

    // 設定はあるが台帳が読めない → pending（「まだありません」と言い切らない）
    const unreadable = buildMembershipView({
      entitlement: ent(TIER.PREMIUM),
      ledger: null,
      config: { KI_REWARD_ACCRUAL: TEST_ACCRUAL },
    });
    assert.equal(unreadable.history.status, 'pending');

    // 台帳が読めて交換が 0 件 → ready（本当に受け取っていない）
    const empty = buildMembershipView({
      entitlement: ent(TIER.PREMIUM),
      ledger: [],
      config: { KI_REWARD_ACCRUAL: TEST_ACCRUAL },
    });
    assert.equal(empty.history.status, 'ready');
    assert.equal(empty.history.items.length, 0);

    // 交換がある → ready かつ件数あり
    const withHistory = buildMembershipView({
      entitlement: ent(TIER.PREMIUM),
      ledger: [
        { entryId: 'a1', type: ENTRY_TYPE.ACCRUAL, points: 500, occurredAtMs: 1 },
        { entryId: 'r1', type: ENTRY_TYPE.REDEMPTION, points: -100, occurredAtMs: 2, ref: 'rx1' },
      ],
      config: { KI_REWARD_ACCRUAL: TEST_ACCRUAL },
    });
    assert.equal(withHistory.history.status, 'ready');
    assert.equal(withHistory.history.items.length, 1);
    assert.equal(withHistory.history.items[0].ref, 'rx1');
  });

  test('継続月数: 起点が無ければ null（起点の定義は TBD-9）', () => {
    assert.equal(continuationMonths(null, Date.now()), null);
    assert.equal(continuationMonths('not-a-date', Date.now()), null);
    assert.equal(continuationMonths('2027-01-01T00:00:00.000Z', Date.UTC(2026, 8, 1)), null, '未来の起点は認めない');
    assert.equal(continuationMonths('2026-02-15T00:00:00.000Z', Date.UTC(2026, 8, 14)), 6, '応当日前は繰り上げない');
    assert.equal(continuationMonths('2026-02-15T00:00:00.000Z', Date.UTC(2026, 8, 15)), 7);
  });

  test('🔴 ビューは認可フラグを作らない（ランクを認可に使わせない）', () => {
    const v = buildMembershipView({ entitlement: ent(TIER.PREMIUM), config: {} });
    for (const forbidden of ['showMarks', 'showBetting', 'canSeeBetting', 'canSeeMarks']) {
      assert.equal(forbidden in v, false, `会員クラブのビューに ${forbidden} があってはいけない`);
    }
  });

  test('ランクの梯子は 4 段階を順に持つ（UI が描くため）', () => {
    assert.deepEqual(RANK_LADDER.map((r) => r.label), ['Bronze', 'Silver', 'Gold', 'Platinum']);
  });

  test('🔴 /pricing の訴求に未確定の数値・景品名を含めない', () => {
    const text = PRICING_BENEFITS.map((b) => `${b.title} ${b.body}`).join(' ');
    assert.match(text, /Bronze/);
    assert.match(text, /KIリワード/);
    assert.doesNotMatch(text, /\d+\s*(pt|ポイント|P)\b/, 'ポイント数を書かない');
    assert.doesNotMatch(text, /\d+\s*か月(目|後)/, '必要月数を書かない');
    assert.doesNotMatch(text, /コーヒー|お米|米|お菓子|菓子/, '商品名を固定しない');
  });

  test('未確定の表現は「準備中」に統一する', () => {
    assert.equal(MEMBERSHIP_COPY.pending, '準備中');
  });
});
