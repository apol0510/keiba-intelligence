/**
 * redemption.test.mjs — 交換申込（M11 / TBD-12）の不変条件
 *
 * 正本: docs/MEMBERSHIP_REWARDS.md §7.9
 *
 * ここで固定するのは次の 5 点。
 *   1. クライアントの申告（ポイント数・資格・価格・email）を信用しない
 *   2. 他会員の残高・住所・交換履歴が見えない
 *   3. 二重クリック・再送で二重減算／二重交換／二重発送依頼にならない
 *   4. 記念品はポイントを消費しない・S-2 を崩さない
 *   5. 住所は snapshot として残り、過去のレコードが書き換わらない
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createCatalog, ITEM_KIND } from './catalog.js';
import {
  REDEEM_ERROR, REDEMPTION_STATUS, normalizeShippingAddress, validateRedemption,
  buildRedemptionId, buildRedemptionRecord, claimedMilestones, latestShippingAddress,
  isValidRequestId,
} from './redemption.js';
import { handleRedeem, readRedeemContext } from './redeemHandler.js';
import { createInMemoryMembershipStore, createDisabledMembershipStore, STORE_RESULT } from './store.js';
import { buildAccrualEntry, ACCRUAL } from './rewards.js';

import catalogSource from '../../data/membership/rewardCatalog.json' with { type: 'json' };

const CATALOG = createCatalog(catalogSource);
const ME = 'me@example.test';
const OTHER = 'other@example.test';
const NOW = Date.parse('2026-09-07T03:00:00Z');

const ADDRESS = Object.freeze({
  recipientName: '受取 太郎',
  postalCode: '1000001',
  address: '東京都千代田区千代田1-1',
});

const REQ = 'req-abcdefgh-0001';

/** 指定ポイントぶんの付与エントリを作る（100pt/月 × n）。 */
function ledgerWithPoints(points, email = ME) {
  const months = points / ACCRUAL.monthlyPoints;
  return Array.from({ length: months }, (_, i) => buildAccrualEntry({
    email,
    periodRef: `inv_${email}_${i}`,
    occurredAtMs: Date.parse('2026-01-01T00:00:00Z') + i * 86400000,
    accrual: ACCRUAL,
  })).filter(Boolean);
}

function storeWith({ points = 0, otherPoints = 0, redemptions = {} } = {}) {
  return createInMemoryMembershipStore({
    profiles: {
      [ME]: { membershipStartedAtIso: '2026-01-01', cancelledAtIso: null },
      [OTHER]: { membershipStartedAtIso: '2026-01-01', cancelledAtIso: null },
    },
    ledgers: {
      [ME]: ledgerWithPoints(points),
      [OTHER]: ledgerWithPoints(otherPoints, OTHER),
    },
    redemptions: { [ME]: [], [OTHER]: [], ...redemptions },
  });
}

const call = (store, input, nowMs = NOW, email = ME) => handleRedeem({
  store, catalogSource, email, input, config: {}, nowMs,
});

const baseInput = (itemId, requestId = REQ) => ({ itemId, requestId, shipping: { ...ADDRESS } });

/* ================================================================
   住所（TBD-12）
   ================================================================ */

describe('発送先住所', () => {
  test('必須は受取人氏名・郵便番号・住所の 3 つだけ', () => {
    const r = normalizeShippingAddress(ADDRESS);
    assert.equal(r.ok, true);
    assert.deepEqual(Object.keys(r.address).sort(), ['address', 'postalCode', 'recipientName']);
  });

  test('郵便番号はハイフン有無どちらでも受け、数字 7 桁へ揃える', () => {
    assert.equal(normalizeShippingAddress({ ...ADDRESS, postalCode: '100-0001' }).address.postalCode, '1000001');
    assert.equal(normalizeShippingAddress({ ...ADDRESS, postalCode: '１00-0001' }).ok, false);
  });

  test('🔴 欠けている項目があれば受け付けない', () => {
    for (const missing of ['recipientName', 'postalCode', 'address']) {
      const bad = { ...ADDRESS, [missing]: '' };
      assert.equal(normalizeShippingAddress(bad).ok, false, `${missing} が空でも通ってしまう`);
    }
  });

  test('長すぎる入力は受け付けない', () => {
    assert.equal(normalizeShippingAddress({ ...ADDRESS, address: 'あ'.repeat(201) }).ok, false);
    assert.equal(normalizeShippingAddress({ ...ADDRESS, recipientName: 'あ'.repeat(101) }).ok, false);
  });

  test('直近の発送先を初期表示に使える（会員が修正できる前提）', () => {
    const recs = [
      { requestedAtMs: 1, shipping: { recipientName: '旧', postalCode: '1000001', address: '旧住所' } },
      { requestedAtMs: 2, shipping: { recipientName: '新', postalCode: '1500001', address: '新住所' } },
    ];
    assert.equal(latestShippingAddress(recs).recipientName, '新');
  });
});

/* ================================================================
   クライアントの申告を信用しない
   ================================================================ */

describe('🔴 クライアントの申告を信用しない', () => {
  test('必要ポイントはカタログから引く（client の costPoints を見ない）', async () => {
    const store = storeWith({ points: 600 });
    // 1,200pt の品を「600pt です」と偽って申告しても通らない
    const res = await call(store, { ...baseInput('rice-450g-1200'), costPoints: 600, balancePoints: 999999 });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, REDEEM_ERROR.INSUFFICIENT_POINTS);
  });

  test('client の balancePoints / tier / rank を見ない', async () => {
    const store = storeWith({ points: 0 });
    const res = await call(store, {
      ...baseInput('rice-300g-600'),
      balancePoints: 100000, tier: 'premium', rank: 'platinum', eligible: true,
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, REDEEM_ERROR.INSUFFICIENT_POINTS);
  });

  test('🔴 client の email では会員を識別しない（session の email だけ）', async () => {
    const store = storeWith({ points: 600, otherPoints: 6000 });
    // 他会員の email を名乗っても、引かれるのは自分の残高
    const res = await call(store, { ...baseInput('rice-450g-1200'), email: OTHER });
    assert.equal(res.statusCode, 400, '他会員を名乗って 1,200pt を通してはいけない');

    const snap = store.snapshot();
    assert.equal(snap.redemptions[OTHER].length, 0, '他会員に発送依頼が入っている');
    assert.equal(snap.ledgers[OTHER].length, 60, '他会員の台帳が変わっている');
  });

  test('カタログに無い item は受け付けない', async () => {
    const store = storeWith({ points: 6000 });
    const res = await call(store, baseInput('gold-bar-9999'));
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, REDEEM_ERROR.UNKNOWN_ITEM);
  });

  test('冪等キーの形が不正なら受け付けない', async () => {
    const store = storeWith({ points: 6000 });
    for (const bad of ['', 'short', 'x'.repeat(65), 'has space!!!!', null]) {
      assert.equal(isValidRequestId(bad), false);
      const res = await call(store, { ...baseInput('rice-300g-600'), requestId: bad });
      assert.equal(res.statusCode, 400);
    }
  });
});

/* ================================================================
   二重交換の防止
   ================================================================ */

describe('🔴 二重クリック・再送で二重にならない', () => {
  test('同じ requestId を 2 回送っても 1 回しか引かれない', async () => {
    // 🔴 7 か月＝記念品の月ではない（12 / 24 か月なら S-2 で止まるのが正しい）
    const store = storeWith({ points: 700 });

    const first = await call(store, baseInput('rice-300g-600'));
    assert.equal(first.statusCode, 200);
    assert.equal(first.body.status, 'requested');

    const second = await call(store, baseInput('rice-300g-600'));
    assert.equal(second.statusCode, 200);
    assert.equal(second.body.status, 'already', '2 回目が新しい申込になっている');

    const snap = store.snapshot();
    assert.equal(snap.redemptions[ME].length, 1, '発送依頼が二重に入った');
    const redemptionEntries = snap.ledgers[ME].filter((e) => e.type === 'redemption');
    assert.equal(redemptionEntries.length, 1, '二重減算が起きた');
    assert.equal(redemptionEntries[0].points, -600);
  });

  test('3 回・4 回と再送しても増えない', async () => {
    const store = storeWith({ points: 700 });
    for (let i = 0; i < 4; i++) await call(store, baseInput('coffee-50g-600'));

    const snap = store.snapshot();
    assert.equal(snap.redemptions[ME].length, 1);
    assert.equal(snap.ledgers[ME].filter((e) => e.type === 'redemption').length, 1);
  });

  test('requestId を変えれば別の申込になるが、残高が足りなければ止まる', async () => {
    const store = storeWith({ points: 600 });

    const ok = await call(store, baseInput('rice-300g-600', 'req-aaaaaaaa-0001'));
    assert.equal(ok.statusCode, 200);

    // 札を変えて送り直しても、残高 0 なので通らない
    const again = await call(store, baseInput('rice-300g-600', 'req-bbbbbbbb-0002'));
    assert.equal(again.statusCode, 400);
    assert.equal(again.body.error, REDEEM_ERROR.INSUFFICIENT_POINTS);

    assert.equal(store.snapshot().redemptions[ME].length, 1);
  });

  test('🔴 キューへ積めなければポイントを引かない（順序の保証）', async () => {
    const store = storeWith({ points: 700 });
    const failing = Object.freeze({
      ...store,
      async appendRedemption() {
        return Object.freeze({ status: STORE_RESULT.UNAVAILABLE, reason: 'schema_missing', writes: 0 });
      },
    });

    const res = await call(failing, baseInput('rice-300g-600'));
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error, 'redemption_not_ready');
    assert.equal(store.snapshot().ledgers[ME].filter((e) => e.type === 'redemption').length, 0,
      '🔴 発送依頼が積めていないのにポイントだけ減っている');
  });
});

/* ================================================================
   記念品（M-6）
   ================================================================ */

describe('継続記念品', () => {
  test('🔴 ポイントを消費しない', async () => {
    const store = storeWith({ points: 1200 });
    const res = await handleRedeem({
      store, catalogSource, email: ME, config: {},
      input: baseInput('rice-300g-m12'),
      // 12 か月の節目そのものは通常交換を止めるが、記念品の申込は受ける
      nowMs: NOW,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.costPoints, 0);

    const snap = store.snapshot();
    assert.equal(snap.ledgers[ME].filter((e) => e.type === 'redemption').length, 0,
      '記念品でポイントが引かれている');
    assert.equal(snap.redemptions[ME][0].kind, ITEM_KIND.MILESTONE);
  });

  test('🔴 到達していない節目は受け付けない', async () => {
    const store = storeWith({ points: 1200 }); // 台帳は 12 か月ぶん
    const res = await call(store, baseInput('rice-450g-m24'));
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, REDEEM_ERROR.MILESTONE_NOT_REACHED);
  });

  test('🔴 同じ節目を 2 回もらえない（札を変えても）', async () => {
    const store = storeWith({ points: 1200 });
    const first = await call(store, baseInput('rice-300g-m12', 'req-cccccccc-0001'));
    assert.equal(first.statusCode, 200);

    // 別の品・別の札でも、12 か月の記念品は 1 回だけ
    const second = await call(store, baseInput('coffee-50g-m12', 'req-dddddddd-0002'));
    assert.equal(second.statusCode, 400);
    assert.equal(second.body.error, REDEEM_ERROR.MILESTONE_ALREADY_CLAIMED);
  });

  test('claimedMilestones は cancelled を数えない', () => {
    const recs = [
      { kind: ITEM_KIND.MILESTONE, milestoneMonths: 12, status: REDEMPTION_STATUS.CANCELLED },
      { kind: ITEM_KIND.MILESTONE, milestoneMonths: 24, status: REDEMPTION_STATUS.SHIPPED },
    ];
    assert.deepEqual(claimedMilestones(recs), [24]);
  });
});

/* ================================================================
   保守ライン S-2 を崩さない
   ================================================================ */

describe('🔴 S-2: 記念品の月は通常交換を受け付けない', () => {
  test('12 / 24 か月ちょうどの月は通常交換が止まる', () => {
    for (const months of [12, 24]) {
      const r = validateRedemption({
        catalog: CATALOG,
        itemId: 'rice-300g-600',
        summary: { status: 'ready', balancePoints: 99999, pointsStatus: { status: 'active' } },
        months,
      });
      assert.equal(r.ok, false);
      assert.equal(r.error, REDEEM_ERROR.MILESTONE_BLOCKS_EXCHANGE);
    }
  });

  test('節目でない月は通常交換できる', () => {
    const r = validateRedemption({
      catalog: CATALOG,
      itemId: 'rice-300g-600',
      summary: { status: 'ready', balancePoints: 600, pointsStatus: { status: 'active' } },
      months: 7,
    });
    assert.equal(r.ok, true);
    assert.equal(r.costPoints, 600);
  });

  test('🔴 残高が読めていないなら交換させない（0 と決めつけない）', () => {
    const r = validateRedemption({
      catalog: CATALOG, itemId: 'rice-300g-600',
      summary: { status: 'pending', balancePoints: null }, months: 7,
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, REDEEM_ERROR.BALANCE_UNKNOWN);
  });

  test('🔴 失効した残高では交換できない', () => {
    const r = validateRedemption({
      catalog: CATALOG, itemId: 'rice-300g-600',
      summary: { status: 'ready', balancePoints: 600, pointsStatus: { status: 'expired' } },
      months: 7,
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, REDEEM_ERROR.POINTS_EXPIRED);
  });
});

/* ================================================================
   他会員の分離 / fail-closed
   ================================================================ */

describe('🔴 他会員の情報が見えない', () => {
  test('自分の交換履歴・住所だけが返る', async () => {
    const store = storeWith({
      points: 700,
      redemptions: {
        [OTHER]: [{
          redemptionId: `${OTHER}:rice-300g-600:req-zzzzzzzz-0001`,
          email: OTHER, itemId: 'rice-300g-600', kind: ITEM_KIND.REDEEMABLE,
          status: REDEMPTION_STATUS.SHIPPED, requestedAtMs: 1,
          shipping: { recipientName: '他人', postalCode: '9999999', address: '他人の住所' },
        }],
      },
    });

    const mine = await readRedeemContext({ store, email: ME });
    assert.equal(mine.records.length, 0);
    assert.equal(mine.lastAddress, null, '他会員の住所が初期表示に漏れている');

    await call(store, baseInput('rice-300g-600'));
    const after = await readRedeemContext({ store, email: ME });
    assert.equal(after.records.length, 1);
    assert.equal(after.lastAddress.recipientName, ADDRESS.recipientName);
  });

  test('🔴 ログインしていなければ 401', async () => {
    const store = storeWith({ points: 1200 });
    const res = await handleRedeem({ store, catalogSource, email: null, input: baseInput('rice-300g-600') });
    assert.equal(res.statusCode, 401);
  });

  test('🔴 store が無効なら 503（ポイントは減らない）', async () => {
    const store = createDisabledMembershipStore('not_configured');
    const res = await call(store, baseInput('rice-300g-600'));
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error, 'redemption_not_ready');
  });

  test('readRedeemContext は読めないとき known:false（0 件と言い切らない）', async () => {
    const store = createDisabledMembershipStore('not_configured');
    const ctx = await readRedeemContext({ store, email: ME });
    assert.equal(ctx.known, false);
    assert.equal(ctx.lastAddress, null);
  });
});

/* ================================================================
   住所の snapshot
   ================================================================ */

describe('🔴 住所は発送時点の snapshot として残る', () => {
  test('2 回目に住所を変えても 1 回目のレコードは変わらない', async () => {
    // 600pt × 2 回ぶん。13 か月＝記念品の月ではない
    const store = storeWith({ points: 1300 });

    await call(store, baseInput('rice-300g-600', 'req-eeeeeeee-0001'));
    const moved = {
      itemId: 'coffee-50g-600',
      requestId: 'req-ffffffff-0002',
      shipping: { recipientName: '受取 太郎', postalCode: '5300001', address: '大阪府大阪市北区梅田1-1' },
    };
    await call(store, moved);

    const recs = store.snapshot().redemptions[ME];
    assert.equal(recs.length, 2);
    assert.equal(recs[0].shipping.address, ADDRESS.address, '過去の発送先が書き換わっている');
    assert.equal(recs[1].shipping.address, moved.shipping.address);
  });

  test('減算まで通れば approved（＝発送してよい状態）になる', async () => {
    const store = storeWith({ points: 700 });
    const res = await call(store, baseInput('rice-300g-600'));
    assert.equal(res.body.redemptionStatus, REDEMPTION_STATUS.APPROVED);
    assert.equal(store.snapshot().redemptions[ME][0].status, REDEMPTION_STATUS.APPROVED);
  });

  test('buildRedemptionRecord は住所が欠けていれば作らない', () => {
    const base = {
      redemptionId: 'x', email: ME, item: { id: 'a', name: 'A', kind: ITEM_KIND.REDEEMABLE },
      costPoints: 600, occurredAtMs: NOW,
    };
    assert.equal(buildRedemptionRecord({ ...base, address: null }), null);
    assert.equal(buildRedemptionRecord({ ...base, address: { recipientName: 'x' } }), null);
    assert.ok(buildRedemptionRecord({ ...base, address: ADDRESS }));
  });

  test('交換 ID は会員 ＋ item ＋ 冪等キーで決まる', () => {
    const id = buildRedemptionId({ email: ME, itemId: 'rice-300g-600', requestId: REQ });
    assert.equal(id, `${ME}:rice-300g-600:${REQ}`);
    assert.equal(buildRedemptionId({ email: ME, itemId: 'rice-300g-600', requestId: 'bad' }), null);
  });
});

/* ================================================================
   🔴 片側成功からの回復（2026-09-07 の指摘）
   ================================================================ */

/** 台帳への書き込みだけを失敗させる store。 */
function ledgerFailing(store) {
  return Object.freeze({
    ...store,
    async appendEntry() {
      return Object.freeze({ status: STORE_RESULT.UNAVAILABLE, reason: 'write_failed:500', writes: 0 });
    },
  });
}

describe('🔴 キューだけ成功して減算が失敗しても回復する', () => {
  test('再送で減算が 1 回だけ成立し、approved になる', async () => {
    const store = storeWith({ points: 700 });

    // 1 回目: キューは積めたが台帳が落ちる
    const first = await call(ledgerFailing(store), baseInput('rice-300g-600'));
    assert.equal(first.statusCode, 503);

    let snap = store.snapshot();
    assert.equal(snap.redemptions[ME].length, 1, 'キューには積まれている');
    assert.equal(snap.redemptions[ME][0].status, REDEMPTION_STATUS.REQUESTED,
      '🔴 減算前なのに approved になっている');
    assert.equal(snap.ledgers[ME].filter((e) => e.type === 'redemption').length, 0,
      'ポイントだけ減っている');

    // 2 回目（同じ requestId）: 減算が回復して approved になる
    const second = await call(store, baseInput('rice-300g-600'));
    assert.equal(second.statusCode, 200);
    assert.equal(second.body.redemptionStatus, REDEMPTION_STATUS.APPROVED);

    snap = store.snapshot();
    assert.equal(snap.redemptions[ME].length, 1, '交換行が増えている');
    const deductions = snap.ledgers[ME].filter((e) => e.type === 'redemption');
    assert.equal(deductions.length, 1, '🔴 減算が 1 回だけ成立していない');
    assert.equal(deductions[0].points, -600);
  });

  test('🔴 減算が失敗している間、その申込は発送対象（approved）にならない', async () => {
    const store = storeWith({ points: 700 });
    const failing = ledgerFailing(store);

    await call(failing, baseInput('rice-300g-600'));
    await call(failing, baseInput('rice-300g-600'));
    await call(failing, baseInput('rice-300g-600'));

    const recs = store.snapshot().redemptions[ME];
    assert.equal(recs.length, 1, '再送のたびに交換行が増えている');
    assert.equal(recs[0].status, REDEMPTION_STATUS.REQUESTED,
      '🔴 引けていない申込が発送対象になっている');
  });

  test('🔴 既に減算済みの再送では二重に引かない', async () => {
    const store = storeWith({ points: 700 });

    await call(store, baseInput('rice-300g-600'));      // 正常に完了（approved）
    await call(store, baseInput('rice-300g-600'));      // 再送
    await call(store, baseInput('rice-300g-600'));      // さらに再送

    const deductions = store.snapshot().ledgers[ME].filter((e) => e.type === 'redemption');
    assert.equal(deductions.length, 1, '🔴 二重減算が起きた');
    assert.equal(store.snapshot().redemptions[ME].length, 1);
  });

  test('approved / shipped の再送は何も書かない', async () => {
    const store = storeWith({ points: 700 });
    await call(store, baseInput('rice-300g-600'));

    // 運用者が発送済みにした状態を模す
    await store.updateRedemptionStatus(ME, `${ME}:rice-300g-600:${REQ}`, REDEMPTION_STATUS.SHIPPED);
    const before = store.writeCount();

    const res = await call(store, baseInput('rice-300g-600'));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'already');
    assert.equal(res.body.redemptionStatus, REDEMPTION_STATUS.SHIPPED);
    assert.equal(store.writeCount(), before, '🔴 shipped の申込に書き込みが走った');
  });

  test('回復時に残高が足りなくなっていたら approved にしない', async () => {
    const store = storeWith({ points: 700 });

    // キューだけ積まれた状態を作る
    await call(ledgerFailing(store), baseInput('rice-300g-600'));

    // その間に別の交換で残高を使い切る
    await call(store, baseInput('coffee-50g-600', 'req-99999999-0009'));

    const res = await call(store, baseInput('rice-300g-600'));
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, REDEEM_ERROR.INSUFFICIENT_POINTS);

    const stuck = store.snapshot().redemptions[ME].find((r) => r.redemptionId.endsWith(REQ));
    assert.equal(stuck.status, REDEMPTION_STATUS.REQUESTED,
      '🔴 引けていないのに発送対象になっている');
  });

  test('記念品は 0pt のまま approved になる（台帳を触らない）', async () => {
    const store = storeWith({ points: 1200 });
    const res = await call(store, baseInput('rice-300g-m12'));

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.costPoints, 0);
    assert.equal(res.body.redemptionStatus, REDEMPTION_STATUS.APPROVED);

    const snap = store.snapshot();
    assert.equal(snap.redemptions[ME][0].status, REDEMPTION_STATUS.APPROVED);
    assert.equal(snap.ledgers[ME].filter((e) => e.type === 'redemption').length, 0,
      '記念品でポイントが引かれている');
  });
});
