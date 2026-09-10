/**
 * rewardScope.test.mjs — 継続リワードの対象範囲と、移行時の引継ぎ
 *
 * 正本: `docs/MEMBERSHIP_REWARDS.md` §7.10（2026-09-11 確定）
 *
 * ここで固定するのは 9 点:
 *   1. クレジット継続会員の通常積算
 *   2. 銀行振込 → クレジット移行時の継続月数の引継ぎ
 *   3. 引き継いだ月数に応じたランクの継続
 *   4. `MembershipStartedAt` の保持
 *   5. 🔴 `CreatedAt` を加入日として使わない
 *   6. 🔴 根拠不明の期間を推測しない
 *   7. 🔴 買い切り会員への継続ポイント誤付与の防止
 *   8. 🔴 既存 entitlement（認可）を壊さない
 *   9. 🔴 他会員への混入防止
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  PAYMENT_METHOD, REWARD_SCOPE, LIFETIME_PLAN_TYPES,
  isLifetimePlan, resolvePaymentMethod, resolveRewardScope, isAccrualForbidden,
} from './rewardScope.js';
import {
  ENTRY_TYPE, MONTHLY_POINTS, PERIOD_MONTHS,
  buildAccrualEntry, buildAnnualAccrualEntry, resolveTenureMonths,
} from './rewards.js';
import { RANK, resolveRank, RANK_THRESHOLDS } from './ranks.js';
import { createAirtableMembershipStore, CUSTOMER_FIELDS } from './airtableStore.js';
import { STORE_RESULT, createInMemoryMembershipStore } from './store.js';
import { buildMembershipView } from './membershipView.js';
import { TIER } from '../auth/tiers.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const EMAIL = 'member@example.com';
const OTHER = 'other@example.com';
const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString();
const ms = (y, m, d) => Date.UTC(y, m - 1, d);

/** 台帳（月次 accrual）を作る。 */
const monthly = (email, from, count) => Array.from({ length: count }, (_, i) => buildAccrualEntry({
  email, periodRef: `in_${i + 1}`, occurredAtMs: ms(from.y + Math.floor((from.m - 1 + i) / 12), ((from.m - 1 + i) % 12) + 1, from.d),
}));

/* ================================================================
   1. 対象範囲の判定（支払い方法・買い切り）
   ================================================================ */

describe('対象範囲の判定', () => {
  test('クレジット継続決済は積算の主対象', () => {
    const r = resolveRewardScope({ planType: 'monthly-nankan', contractPriceId: 'price_abc123' });
    assert.equal(r.method, PAYMENT_METHOD.CREDIT);
    assert.equal(r.scope, REWARD_SCOPE.ACCRUING);
  });

  test('銀行振込は契約・権限を変えない（積算は現状維持）', () => {
    const r = resolveRewardScope({ planType: 'yearly', contractPriceId: 'bank:yearly' });
    assert.equal(r.method, PAYMENT_METHOD.BANK);
    // 🟡 止めるかは未確定（TBD-14）。この変更では既存会員の残高を下げない
    assert.equal(r.scope, REWARD_SCOPE.ACCRUING);
    assert.equal(r.reason, 'bank_transfer_legacy');
  });

  test('`PaymentMethod` からも銀行振込と分かる', () => {
    assert.equal(resolvePaymentMethod({ paymentMethod: 'Bank Transfer' }), PAYMENT_METHOD.BANK);
  });

  test('🔴 買い切りはポイント蓄積の対象にせず、称号側で扱う', () => {
    for (const pt of LIFETIME_PLAN_TYPES) {
      const r = resolveRewardScope({ planType: pt, contractPriceId: 'bank:yearly' });
      assert.equal(r.scope, REWARD_SCOPE.TITLE_ONLY, `${pt} が積算対象になっている`);
      assert.equal(isLifetimePlan(pt), true);
    }
    // 支払い方法によらず買い切りが優先される
    assert.equal(resolveRewardScope({ planType: 'lifetime', contractPriceId: 'price_abc123' }).scope,
      REWARD_SCOPE.TITLE_ONLY);
  });

  test('🔴 根拠が無ければ UNKNOWN（推測しない）', () => {
    for (const input of [{}, { contractPriceId: '' }, { contractPriceId: 'unknown_x' },
      { planType: 'yearly' }, { paymentMethod: 'クレジット' }]) {
      assert.equal(resolveRewardScope(input).scope, REWARD_SCOPE.UNKNOWN, JSON.stringify(input));
    }
    // 🔴 「lifetime っぽい」で買い切り扱いにしない
    for (const pt of ['LIFETIME_PLUS', 'perpetual', '買い切り', 'life', null, undefined, 0]) {
      assert.equal(isLifetimePlan(pt), false, String(pt));
    }
    // 大文字小文字と前後空白だけは吸収する（同じ値の表記ゆれ）
    assert.equal(isLifetimePlan(' Lifetime '), true);
  });

  test('🔴 証拠が食い違うときは UNKNOWN（どちらかへ寄せない）', () => {
    assert.equal(resolvePaymentMethod({ contractPriceId: 'price_abc123', paymentMethod: 'Bank Transfer' }),
      PAYMENT_METHOD.UNKNOWN);
  });
});

/* ================================================================
   2. クレジット継続会員の通常積算
   ================================================================ */

describe('クレジット継続会員の通常積算', () => {
  test('毎月の支払い成功ぶんだけ月数とポイントが増える', () => {
    for (const [n, rank] of [[1, RANK.BRONZE], [3, RANK.SILVER], [12, RANK.GOLD], [24, RANK.PLATINUM]]) {
      const entries = monthly(EMAIL, { y: 2026, m: 1, d: 10 }, n);
      const t = resolveTenureMonths({
        entries, ledgerKnown: true, startedAtIso: iso(2026, 1, 10), nowMs: ms(2028, 12, 31),
      });
      assert.equal(t.months, n);
      assert.equal(t.source, 'ledger');
      assert.equal(resolveRank(t.months, RANK_THRESHOLDS).rank, rank);
      assert.equal(entries.reduce((s, e) => s + e.points, 0), MONTHLY_POINTS * n);
    }
  });
});

/* ================================================================
   3. 銀行振込 → クレジット移行の引継ぎ
   ================================================================ */

describe('銀行振込 → クレジット継続決済への移行', () => {
  test('🔴 台帳に銀行振込ぶんがある場合、そのまま積み上がる', () => {
    // 年払い 1 期（12 か月）→ 翌月からクレジットで月次
    const bank = buildAnnualAccrualEntry({ email: EMAIL, termRef: 'bank_2025', occurredAtMs: ms(2025, 9, 10) });
    const credit = monthly(EMAIL, { y: 2026, m: 9, d: 10 }, 1);
    const t = resolveTenureMonths({
      entries: [bank, ...credit], ledgerKnown: true, startedAtIso: iso(2025, 9, 10), nowMs: ms(2026, 9, 20),
    });
    assert.equal(t.months, PERIOD_MONTHS.ANNUAL + 1, '年払い 12 か月 + クレジット 1 か月');
    assert.equal(resolveRank(t.months, RANK_THRESHOLDS).rank, RANK.GOLD);
  });

  test('🔴 台帳より前の期間も、起点が保存されていれば引き継ぐ', () => {
    // 台帳が動く前から銀行振込で続けていた会員が、2026-09-10 にクレジットへ移行
    const credit = monthly(EMAIL, { y: 2026, m: 9, d: 10 }, 1);
    const t = resolveTenureMonths({
      entries: credit, ledgerKnown: true, startedAtIso: iso(2025, 4, 10), nowMs: ms(2026, 9, 20),
    });
    assert.equal(t.months, 17 + 1, '起点 2025-04-10 → 台帳初回 2026-09-10 の 17 か月を引き継ぐ');
    assert.equal(t.source, 'ledger+carried');
    assert.equal(resolveRank(t.months, RANK_THRESHOLDS).rank, RANK.GOLD, '🔴 移行でランクが落ちない');
  });

  test('🔴 引継ぎで月数が減らない（移行前 ≦ 移行後）', () => {
    const startedAtIso = iso(2025, 4, 10);
    const before = resolveTenureMonths({ entries: [], ledgerKnown: true, startedAtIso, nowMs: ms(2026, 9, 9) });
    const after = resolveTenureMonths({
      entries: monthly(EMAIL, { y: 2026, m: 9, d: 10 }, 1), ledgerKnown: true, startedAtIso, nowMs: ms(2026, 9, 20),
    });
    assert.ok(after.months >= before.months, `🔴 移行で ${before.months} → ${after.months} に減った`);
  });

  test('起点と台帳初回が同じ日なら二重に数えない', () => {
    const entries = monthly(EMAIL, { y: 2026, m: 9, d: 10 }, 3);
    const t = resolveTenureMonths({
      entries, ledgerKnown: true, startedAtIso: iso(2026, 9, 10), nowMs: ms(2026, 12, 1),
    });
    assert.equal(t.months, 3);
    assert.equal(t.source, 'ledger');
  });

  test('🔴 起点が台帳初回より後でも足し込まない（負の期間を作らない）', () => {
    const entries = monthly(EMAIL, { y: 2026, m: 1, d: 10 }, 3);
    const t = resolveTenureMonths({
      entries, ledgerKnown: true, startedAtIso: iso(2026, 6, 10), nowMs: ms(2026, 12, 1),
    });
    assert.equal(t.months, 3);
  });
});

/* ================================================================
   4-6. 起点の保持 / CreatedAt 禁止 / 推測禁止
   ================================================================ */

describe('起点（MembershipStartedAt）の扱い', () => {
  test('🔴 起点が無ければ pending（0 か月＝Bronze へ倒さない）', () => {
    for (const startedAtIso of [null, undefined, '', '   ', 'not-a-date']) {
      const t = resolveTenureMonths({ entries: [], ledgerKnown: true, startedAtIso, nowMs: ms(2026, 9, 20) });
      assert.equal(t.status, 'pending', String(startedAtIso));
      assert.equal(t.months, null);
    }
  });

  test('🔴 起点が読めなくても台帳ぶんは失わない', () => {
    const t = resolveTenureMonths({
      entries: monthly(EMAIL, { y: 2026, m: 9, d: 10 }, 2), ledgerKnown: true, startedAtIso: null, nowMs: ms(2026, 11, 1),
    });
    assert.equal(t.months, 2, '起点不明でも台帳の 2 か月は数える');
    assert.equal(t.source, 'ledger');
  });

  test('🔴 `CreatedAt` を加入日として使わない', () => {
    // 書き込む列に CreatedAt が入っていない
    assert.equal(Object.values(CUSTOMER_FIELDS).includes('CreatedAt'), false);
    // 継続月数の計算に CreatedAt が現れない
    for (const f of ['src/lib/membership/rewards.js', 'src/lib/membership/membershipView.js',
      'src/lib/membership/rewardScope.js']) {
      const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      assert.equal(/CreatedAt|createdTime/.test(src), false, `🔴 ${f} が申込日を見ている`);
    }
    // 起点として書くのは MembershipStartedAt だけ
    assert.equal(CUSTOMER_FIELDS.STARTED_AT, 'MembershipStartedAt');
  });
});

/* ================================================================
   7. 買い切り会員への誤付与防止（store の出口で止める）
   ================================================================ */

describe('買い切り会員への継続ポイント誤付与', () => {
  const stubFetch = (handler) => {
    const calls = [];
    const impl = async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
      const r = await handler(String(url), init);
      return { ok: r.status >= 200 && r.status < 300, status: r.status, async json() { return r.body ?? {}; }, async text() { return ''; } };
    };
    impl.writes = () => calls.filter((c) => c.method !== 'GET');
    return impl;
  };
  const store = (fetchImpl) => createAirtableMembershipStore({ apiKey: 'k', baseId: 'appTest', fetchImpl });
  const accrual = buildAccrualEntry({ email: EMAIL, periodRef: 'in_1', occurredAtMs: ms(2026, 9, 10) });

  const customerRow = (planType) => ({
    status: 200, body: { records: [{ id: 'rec1', fields: { Email: EMAIL, ...(planType ? { plan_type: planType } : {}) } }] },
  });

  test('🔴 買い切り会員には積まない（POST を投げない）', async () => {
    const f = stubFetch(async (url) => (url.includes('RewardLedger')
      ? { status: 200, body: { records: [] } }
      : customerRow('lifetime')));
    const r = await store(f).appendEntry(EMAIL, accrual);
    // 🔴 仕様どおりの非付与。**書込失敗（UNAVAILABLE）と区別する**
    assert.equal(r.status, STORE_RESULT.NOT_APPLICABLE);
    assert.notEqual(r.status, STORE_RESULT.UNAVAILABLE,
      '🔴 UNAVAILABLE にすると webhook が 500 を返して Stripe が再送し続ける');
    assert.equal(r.reason, 'lifetime_not_accruing');
    assert.equal(f.writes().length, 0, '🔴 台帳へ書いている');
  });

  test('買い切り以外には従来どおり積む', async () => {
    for (const planType of ['yearly', 'monthly-nankan', 'light']) {
      const f = stubFetch(async (url, init) => (init.method === 'POST'
        ? { status: 200, body: { records: [{ id: 'recNEW' }] } }
        : url.includes('RewardLedger') ? { status: 200, body: { records: [] } } : customerRow(planType)));
      const r = await store(f).appendEntry(EMAIL, accrual);
      assert.equal(r.status, STORE_RESULT.APPLIED, planType);
      assert.equal(f.writes().length, 1, planType);
    }
  });

  test('🔴 判定できないときは止めない（支払い済みの月を落とさない）', async () => {
    for (const planType of [null, '', 'unknown-plan']) {
      const f = stubFetch(async (url, init) => (init.method === 'POST'
        ? { status: 200, body: { records: [{ id: 'recNEW' }] } }
        : url.includes('RewardLedger') ? { status: 200, body: { records: [] } } : customerRow(planType)));
      const r = await store(f).appendEntry(EMAIL, accrual);
      assert.equal(r.status, STORE_RESULT.APPLIED, `plan_type=${planType} で止めている`);
    }
  });

  test('🔴 会員レコードが読めなくても止めない', async () => {
    const f = stubFetch(async (url, init) => (init.method === 'POST'
      ? { status: 200, body: { records: [{ id: 'recNEW' }] } }
      : url.includes('RewardLedger') ? { status: 200, body: { records: [] } } : { status: 200, body: { records: [] } }));
    const r = await store(f).appendEntry(EMAIL, accrual);
    assert.equal(r.status, STORE_RESULT.APPLIED);
  });

  test('交換（redemption）は買い切り会員でも止めない', () => {
    assert.equal(isAccrualForbidden({ planType: 'lifetime' }), true);
    // 止めるのは accrual だけであることをコードで固定
    const src = read('src/lib/membership/airtableStore.js');
    assert.match(src, /if \(entry\.type === ENTRY_TYPE\.ACCRUAL\) \{/);
  });
});

/* ================================================================
   8. 既存 entitlement を壊さない
   ================================================================ */

describe('既存 entitlement（認可）を壊さない', () => {
  test('🔴 rewardScope は認可に関与しない', () => {
    // 「認可には関与しない」という説明はコメントに書いてあるので、**コードだけ**を見る
    const src = read('src/lib/membership/rewardScope.js')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const bad of ['showBetting', 'showMarks', 'authenticated', 'entitlement', 'resolveEntitlement', 'tier']) {
      assert.equal(src.includes(bad), false, `🔴 rewardScope が ${bad} を触っている`);
    }
    // 認可モジュールを import していない
    assert.equal(/from '\.\.\/auth\//.test(src), false, '🔴 rewardScope が auth を import している');
  });

  test('🔴 ランク・継続月数が変わっても表示権限は entitlement のまま', () => {
    const mk = (entries, startedAtIso) => buildMembershipView({
      entitlement: { tier: TIER.PREMIUM, authenticated: true, email: EMAIL, showBetting: true, showMarks: false },
      profile: { membershipStartedAtIso: startedAtIso }, ledger: entries, nowMs: ms(2026, 9, 20),
    });
    const low = mk(monthly(EMAIL, { y: 2026, m: 9, d: 10 }, 1), iso(2026, 9, 10));
    const high = mk(monthly(EMAIL, { y: 2026, m: 9, d: 10 }, 1), iso(2024, 1, 10));
    assert.notEqual(low.months.value, high.months.value, '引継ぎで月数は変わる');
    assert.notEqual(low.rank.rank, high.rank.rank, '引継ぎでランクも変わる');
    // 🔴 それでも認可（tier / 有料判定）は動かない
    assert.equal(low.tier, high.tier);
    assert.equal(low.tier, TIER.PREMIUM);
    assert.equal(low.isPaid, high.isPaid);
    assert.equal(low.isPaid, true);
  });
});

/* ================================================================
   9. 他会員混入防止
   ================================================================ */

describe('他会員への混入防止', () => {
  test('🔴 台帳は会員ごとに分かれている', async () => {
    const store = createInMemoryMembershipStore();
    for (const e of monthly(EMAIL, { y: 2026, m: 1, d: 10 }, 12)) await store.appendEntry(EMAIL, e);
    await store.appendEntry(OTHER, buildAccrualEntry({ email: OTHER, periodRef: 'o1', occurredAtMs: ms(2026, 1, 10) }));

    const mine = (await store.readLedger(EMAIL)).entries;
    const theirs = (await store.readLedger(OTHER)).entries;
    assert.equal(resolveTenureMonths({ entries: mine, ledgerKnown: true, startedAtIso: iso(2026, 1, 10), nowMs: ms(2027, 1, 1) }).months, 12);
    assert.equal(resolveTenureMonths({ entries: theirs, ledgerKnown: true, startedAtIso: iso(2026, 1, 10), nowMs: ms(2027, 1, 1) }).months, 1);
    assert.equal(theirs.every((e) => e.entryId.includes(OTHER)), true);
  });

  test('🔴 起点も会員ごと（他人の起点で引き継がない）', async () => {
    const store = createInMemoryMembershipStore();
    await store.saveMembershipStart(EMAIL, iso(2024, 1, 10));
    assert.equal((await store.readProfile(OTHER)).profile, null, '🔴 他会員へ起点が漏れている');
    assert.equal((await store.readProfile(EMAIL)).profile.membershipStartedAtIso, iso(2024, 1, 10));
  });
});
