/**
 * bankTransfer.test.mjs — 銀行振込の入金確認 → 会員継続制度
 *
 * 正本: docs/MEMBERSHIP_REWARDS.md §7.6 / §7.7
 *
 * ここで固定するのは:
 *   1. 起点は **入金確認日**（申込日ではない・更新で動かさない）
 *   2. **支払い済み期間だけ**反映する（年払い＝12 か月・1,200pt）
 *   3. 期間が判定できなければ **付与しない**（推測しない）
 *   4. **再実行・メール再送でも二重付与しない**
 *   5. 認可（AccessEnabled / Status / PlanType）に触れない
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  BANK_PLAN_TERM_MONTHS, BANK_SKIP,
  periodMonthsForBankPlan, buildBankTermRef, planBankMembershipUpdate,
} from './bankTransfer.js';
import { MONTHLY_POINTS, PERIOD_MONTHS, ENTRY_TYPE, tenureMonthsFromLedger, summarizeRewards } from './rewards.js';
import { createInMemoryMembershipStore, STORE_RESULT } from './store.js';

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(siteRoot, p), 'utf8');

const CONFIRMED = '2026-09-01T10:00:00.000Z';
const rec = (over = {}) => ({ Email: 'member@example.com', plan_type: 'yearly', ...over });

/* ================================================================
   1. 期間の判定（fail-closed）
   ================================================================ */

describe('plan_type → 期間', () => {
  test('年払いは 12 か月、月額系は 1 か月', () => {
    assert.equal(periodMonthsForBankPlan('yearly'), 12);
    for (const p of ['light', 'monthly-nankan', 'monthly-jra']) {
      assert.equal(periodMonthsForBankPlan(p), 1);
    }
  });

  test('🔴 判定できないものは付与しない（月額へ丸めない）', () => {
    for (const bad of ['lifetime', 'pro', 'premium', '', '  ', 'YEARLY', undefined, null, 1, {}]) {
      assert.equal(periodMonthsForBankPlan(bad), null, `${JSON.stringify(bad)} を既定へ丸めている`);
    }
  });

  test('🔴 有効期限の計算（send-payment-confirmation-auto.js）と規則が一致している', () => {
    // 片方だけ変えると期限と継続月数が食い違う
    const src = read('netlify/functions/send-payment-confirmation-auto.js');
    const fn = src.slice(src.indexOf('function calculateExpirationDate('));
    assert.match(fn.slice(0, 700), /planType === 'yearly'[\s\S]*?setFullYear\(expDate\.getFullYear\(\) \+ 1\)/,
      'yearly が 1 年でなくなっている');
    assert.match(fn.slice(0, 700), /'monthly-nankan' \|\| planType === 'monthly-jra' \|\| planType === 'light'[\s\S]*?setMonth\(expDate\.getMonth\(\) \+ 1\)/,
      '月額系が 1 か月でなくなっている');
    assert.equal(BANK_PLAN_TERM_MONTHS.yearly, 12);
    assert.equal(BANK_PLAN_TERM_MONTHS.light, 1);
    assert.equal('lifetime' in BANK_PLAN_TERM_MONTHS, false, 'lifetime は期間が定まらないので持たない');
  });
});

/* ================================================================
   2. 起点（TBD-9）
   ================================================================ */

describe('起点は入金確認日', () => {
  test('初回は入金確認日を書く（申込日ではない）', () => {
    const r = planBankMembershipUpdate({
      fields: rec({ CreatedAt: '2026-08-01T00:00:00.000Z' }),
      recordId: 'rec1', expirationDate: '2027-09-01', confirmedAtIso: CONFIRMED,
    });
    assert.equal(r.startedAtIso, '2026-09-01');
    assert.notEqual(r.startedAtIso, '2026-08-01', '申込日を起点にしている');
  });

  test('🔴 2 期目以降は起点を動かさない（上書きしない）', () => {
    const r = planBankMembershipUpdate({
      fields: rec({ MembershipStartedAt: '2025-04-10' }),
      recordId: 'rec1', expirationDate: '2028-09-01', confirmedAtIso: CONFIRMED,
    });
    assert.equal(r.startedAtIso, null, '継続中の会員の起点を上書きしている');
    assert.ok(r.skipped.includes(BANK_SKIP.ALREADY_STARTED));
    assert.ok(r.entry, '更新でも付与自体は行う');
  });

  test('email が無ければ何もしない', () => {
    const r = planBankMembershipUpdate({
      fields: rec({ Email: '' }), recordId: 'rec1', expirationDate: '2027-09-01', confirmedAtIso: CONFIRMED,
    });
    assert.equal(r.startedAtIso, null);
    assert.equal(r.entry, null);
    assert.ok(r.skipped.includes(BANK_SKIP.NO_EMAIL));
  });
});

/* ================================================================
   3. 付与（支払い済み期間だけ）
   ================================================================ */

describe('付与', () => {
  test('年払いは 12 か月・1,200pt', () => {
    const r = planBankMembershipUpdate({
      fields: rec(), recordId: 'rec1', expirationDate: '2027-09-01', confirmedAtIso: CONFIRMED,
    });
    assert.equal(r.entry.points, MONTHLY_POINTS * 12);
    assert.equal(r.entry.points, 1200);
    assert.equal(r.entry.periodMonths, PERIOD_MONTHS.ANNUAL);
    assert.equal(r.entry.type, ENTRY_TYPE.ACCRUAL);
    assert.equal(r.entry.occurredAtMs, Date.parse(CONFIRMED), '付与日時は入金確認日');
  });

  test('月額系は 1 か月・100pt', () => {
    const r = planBankMembershipUpdate({
      fields: rec({ plan_type: 'light' }), recordId: 'rec1', expirationDate: '2026-10-01', confirmedAtIso: CONFIRMED,
    });
    assert.equal(r.entry.points, 100);
    assert.equal(r.entry.periodMonths, 1);
  });

  test('🔴 期間が判定できなければ付与しない（起点だけは書ける）', () => {
    for (const planType of ['lifetime', 'pro', undefined]) {
      const r = planBankMembershipUpdate({
        fields: rec({ plan_type: planType }), recordId: 'rec1', expirationDate: '2027-09-01', confirmedAtIso: CONFIRMED,
      });
      assert.equal(r.entry, null, `plan_type=${planType} で付与している`);
      assert.ok(r.skipped.includes(BANK_SKIP.UNKNOWN_TERM));
    }
  });

  test('🔴 有効期限が無ければ付与しない（期を特定できない）', () => {
    const r = planBankMembershipUpdate({
      fields: rec(), recordId: 'rec1', expirationDate: null, confirmedAtIso: CONFIRMED,
    });
    assert.equal(r.entry, null);
    assert.ok(r.skipped.includes(BANK_SKIP.NO_EXPIRATION));
  });
});

/* ================================================================
   4. 冪等（再実行・メール再送）
   ================================================================ */

describe('二重付与しない', () => {
  test('同じ入金確認をやり直しても冪等キーが同じ', () => {
    const a = planBankMembershipUpdate({ fields: rec(), recordId: 'rec1', expirationDate: '2027-09-01', confirmedAtIso: CONFIRMED });
    const b = planBankMembershipUpdate({ fields: rec(), recordId: 'rec1', expirationDate: '2027-09-01', confirmedAtIso: '2026-09-01T23:59:00.000Z' });
    assert.equal(a.entry.entryId, b.entry.entryId, '実行時刻が違うと別扱いになっている');
  });

  test('E2E: 再実行・メール再送で台帳が増えない', async () => {
    const store = createInMemoryMembershipStore();
    const plan = planBankMembershipUpdate({ fields: rec(), recordId: 'rec1', expirationDate: '2027-09-01', confirmedAtIso: CONFIRMED });

    assert.equal((await store.appendEntry('member@example.com', plan.entry)).status, STORE_RESULT.APPLIED);
    for (let i = 0; i < 3; i++) {
      assert.equal((await store.appendEntry('member@example.com', plan.entry)).status, STORE_RESULT.ALREADY);
    }
    const ledger = (await store.readLedger('member@example.com')).entries;
    assert.equal(ledger.length, 1);
    assert.equal(tenureMonthsFromLedger(ledger), 12);
    assert.equal(summarizeRewards({ entries: ledger, ledgerKnown: true, nowMs: Date.parse(CONFIRMED) }).balancePoints, 1200);
  });

  test('E2E: 翌年の更新は別の期として 1 回だけ積む', async () => {
    const store = createInMemoryMembershipStore();
    const first = planBankMembershipUpdate({ fields: rec(), recordId: 'rec1', expirationDate: '2027-09-01', confirmedAtIso: CONFIRMED });
    await store.appendEntry('member@example.com', first.entry);

    // 1 年後の入金確認（有効期限が更新される＝別の期）
    const renew = planBankMembershipUpdate({
      fields: rec({ MembershipStartedAt: '2026-09-01' }),
      recordId: 'rec1', expirationDate: '2028-09-01', confirmedAtIso: '2027-09-01T10:00:00.000Z',
    });
    assert.notEqual(renew.entry.entryId, first.entry.entryId);
    assert.equal((await store.appendEntry('member@example.com', renew.entry)).status, STORE_RESULT.APPLIED);
    assert.equal((await store.appendEntry('member@example.com', renew.entry)).status, STORE_RESULT.ALREADY);

    const ledger = (await store.readLedger('member@example.com')).entries;
    assert.equal(tenureMonthsFromLedger(ledger), 24, '2 期で 24 か月');
    assert.equal(summarizeRewards({ entries: ledger, ledgerKnown: true, nowMs: Date.parse('2027-09-02') }).balancePoints, 2400);
    assert.equal(renew.startedAtIso, null, '更新で起点が動いている');
  });

  test('会員ごとに独立している（他会員へ混入しない）', () => {
    const a = planBankMembershipUpdate({ fields: rec(), recordId: 'rec1', expirationDate: '2027-09-01', confirmedAtIso: CONFIRMED });
    const b = planBankMembershipUpdate({ fields: rec({ Email: 'other@example.com' }), recordId: 'rec2', expirationDate: '2027-09-01', confirmedAtIso: CONFIRMED });
    assert.notEqual(a.entry.entryId, b.entry.entryId);
  });

  test('期の識別子は レコード＋期限 で決まる', () => {
    assert.equal(buildBankTermRef({ recordId: 'rec1', expirationDate: '2027-09-01' }), 'bank:rec1:2027-09-01');
    assert.equal(buildBankTermRef({ recordId: '', expirationDate: '2027-09-01' }), null);
    assert.equal(buildBankTermRef({ recordId: 'rec1' }), null);
  });
});

/* ================================================================
   5. 既存経路への非干渉
   ================================================================ */

describe('入金確認・認可・メール送信へ波及しない', () => {
  const fnSrc = () => read('netlify/functions/send-payment-confirmation-auto.js');

  /** コメント行を除いた実装行だけを返す（コメントで「触れない」と書くのは許す）。 */
  const codeLines = (src) => src.split('\n').filter((l) => {
    const t = l.trimStart();
    return t && !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
  });

  /** `recordBankMembership` の本体だけを切り出す（波括弧の対応で終端を決める）。 */
  function membershipBody() {
    const src = fnSrc();
    const start = src.indexOf('async function recordBankMembership(');
    assert.ok(start > 0, 'recordBankMembership が見つからない');
    // 🔴 引数の分割代入 `({ ... })` の波括弧ではなく、**本体の開き波括弧**から数える
    const bodyStart = src.indexOf(') {', start);
    assert.ok(bodyStart > start, '関数本体の開始が見つからない');
    let depth = 0;
    for (let j = bodyStart + 2; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
    }
    throw new Error('関数の終端が見つからない');
  }

  test('🔴 membership の処理はフラグ付きで、失敗を握りつぶす', () => {
    const body = membershipBody();
    assert.match(body, /if \(!isWriteEnabled\(process\.env\)\) return;/, 'フラグを確認していない');
    assert.match(body, /catch \(e\) \{[\s\S]*?console\.warn/, '例外を握りつぶしていない');
    assert.equal(codeLines(body).some((l) => l.includes('throw')), false, '例外を投げ返している');
  });

  test('🔴 membership は既存の更新（Step 4）と別リクエストで、既存列に触れない', () => {
    const src = fnSrc();
    // 既存の updatePayload には membership の列を混ぜない
    const step4 = src.slice(src.indexOf('const updatePayload = {'), src.indexOf('const updateResponse'));
    for (const col of ['MembershipStartedAt', 'CancelledAt', 'ContractPrice']) {
      assert.equal(step4.includes(col), false, `Step 4 に ${col} を混ぜている（列が無いと入金確認ごと失敗する）`);
    }
    // membership 側は AccessEnabled / Status / PlanType を書かない
    for (const line of codeLines(membershipBody())) {
      for (const col of ['AccessEnabled', 'PaymentEmailSent', 'PlanType']) {
        assert.equal(line.includes(col), false,
          `membership 側が ${col} を触っている（認可を変えてはいけない） → ${line.trim()}`);
      }
    }
  });

  test('🔴 membership は Step 4（メール送信・AccessEnabled）のあとに呼ぶ', () => {
    const src = fnSrc();
    const email = src.indexOf("console.log('✅ Payment confirmation email sent:'");
    const step4 = src.indexOf('const updateResponse = await fetch(recordUrl');
    const call = src.indexOf('await recordBankMembership(');
    assert.ok(email > 0 && step4 > 0 && call > 0);
    assert.ok(call > email, 'メール送信より前に membership を実行している');
    assert.ok(call > step4, 'AccessEnabled の更新より前に membership を実行している');
  });

  test('🔴 bankTransfer.js は認可の概念を持たない', () => {
    const src = read('src/lib/membership/bankTransfer.js');
    for (const w of ['AccessEnabled', 'PlanType', 'canSeeBetting', 'canSeeMarks', 'entitlement']) {
      const inCode = src.split('\n').filter((l) => {
        const t = l.trimStart();
        return l.includes(w) && !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
      });
      assert.deepEqual(inCode, [], `bankTransfer.js が ${w} を参照している`);
    }
  });
});
