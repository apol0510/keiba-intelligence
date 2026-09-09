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
  deriveConfirmedAtFromExpiration,
  BANK_CONTRACT_PRICE_YEN, bankContractPriceFor, BANK_PRICE_REVISION_DATE,
  recordCreatedAfterRevision,
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
    // 付与日時は入金確認**日**（日付単位に正規化する。再実行でも同じ値になるため）
    assert.equal(r.entry.occurredAtMs, Date.parse('2026-09-01T00:00:00.000Z'));
    assert.equal(r.confirmedAtIso, '2026-09-01');
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
   4.5 Step 5 だけ失敗したときの回復（再実行）
   ================================================================ */

describe('membership だけ失敗しても再実行で回復できる', () => {
  const RECORD = 'recBank1';
  const EXPIRATION = '2027-09-01';   // 入金確認時に書かれた有効期限（年払い）
  const EMAIL = 'member@example.com';

  /** 入金確認メール送信後の Airtable レコード（Step 1〜4 は成功している）。 */
  const afterStep4 = (over = {}) => rec({
    PaymentEmailSent: true,
    AccessEnabled: true,
    ExpirationDate: EXPIRATION,
    Status: 'active',
    ...over,
  });

  test('入金確認日は有効期限から復元でき、現在時刻に置き換わらない', () => {
    assert.equal(deriveConfirmedAtFromExpiration(EXPIRATION, 12), '2026-09-01');
    assert.equal(deriveConfirmedAtFromExpiration('2026-10-01', 1), '2026-09-01');
    // 復元できないときは null（現在時刻へ倒さない）
    assert.equal(deriveConfirmedAtFromExpiration(null, 12), null);
    assert.equal(deriveConfirmedAtFromExpiration(EXPIRATION, null), null);
    assert.equal(deriveConfirmedAtFromExpiration('not-a-date', 12), null);
  });

  test('E2E: 初回=membership だけ失敗 → 再実行=membership だけ成功 → 再々実行=増えない', async () => {
    const store = createInMemoryMembershipStore();

    // --- 1 回目: メール送信と既存更新は成功、membership の書き込みだけ失敗した ---
    const first = planBankMembershipUpdate({
      fields: rec(), recordId: RECORD, expirationDate: EXPIRATION,
      confirmedAtIso: '2026-09-01T10:00:00.000Z',
    });
    assert.equal(first.startedAtIso, '2026-09-01');
    assert.equal(first.entry.points, 1200);
    // 台帳へは書けなかった（＝store へ渡していない）
    assert.equal(store.writeCount(), 0);
    assert.equal((await store.readLedger(EMAIL)).entries.length, 0);

    // --- 2 回目（再実行）: PaymentEmailSent=true なのでメールは送らない。
    //     membership は confirmedAtIso を渡さず、有効期限から復元する ---
    const recovery = planBankMembershipUpdate({
      fields: afterStep4(),           // MembershipStartedAt はまだ空
      recordId: RECORD, expirationDate: EXPIRATION,
      // 🔴 現在時刻を渡さない
    });
    assert.equal(recovery.startedAtIso, '2026-09-01', '起点が実際の入金確認日に戻っていない');
    assert.equal(recovery.entry.entryId, first.entry.entryId, '1 回目と同じ冪等キーにならない');
    assert.equal(recovery.entry.points, 1200);
    assert.equal(recovery.entry.occurredAtMs, Date.parse('2026-09-01T00:00:00.000Z'),
      '付与日時が再実行の時刻になっている');

    assert.equal((await store.appendEntry(EMAIL, recovery.entry)).status, STORE_RESULT.APPLIED);

    let ledger = (await store.readLedger(EMAIL)).entries;
    assert.equal(ledger.length, 1);
    assert.equal(tenureMonthsFromLedger(ledger), 12);
    assert.equal(summarizeRewards({ entries: ledger, ledgerKnown: true, nowMs: Date.parse('2026-09-05') }).balancePoints, 1200);

    // --- 3 回目（再々実行）: 台帳もポイントも起点も増えない ---
    const again = planBankMembershipUpdate({
      fields: afterStep4({ MembershipStartedAt: recovery.startedAtIso }),
      recordId: RECORD, expirationDate: EXPIRATION,
    });
    assert.equal(again.startedAtIso, null, '起点を二度書こうとしている');
    assert.ok(again.skipped.includes(BANK_SKIP.ALREADY_STARTED));
    assert.equal(again.entry.entryId, first.entry.entryId);
    assert.equal((await store.appendEntry(EMAIL, again.entry)).status, STORE_RESULT.ALREADY);

    ledger = (await store.readLedger(EMAIL)).entries;
    assert.equal(ledger.length, 1, '台帳が増えている');
    assert.equal(tenureMonthsFromLedger(ledger), 12, '継続月数が増えている');
    assert.equal(summarizeRewards({ entries: ledger, ledgerKnown: true, nowMs: Date.parse('2026-09-05') }).balancePoints, 1200,
      'ポイントが増えている');
    assert.equal(store.writeCount(), 1, '書き込みが 2 回以上起きている');
  });

  test('🔴 再実行でメールを送らず、既存更新もやり直さない', () => {
    const src = read('netlify/functions/send-payment-confirmation-auto.js');
    // 早期 return を撤去し、フラグで分岐している
    assert.match(src, /const alreadyConfirmed = paymentEmailSent === true;/);
    assert.doesNotMatch(
      src.slice(src.indexOf('Step 2:'), src.indexOf('Step 3:')),
      /return \{\s*statusCode: 200/,
      '🔴 Step 2 で早期 return している（membership が永久に回復できない）',
    );
    // メール送信と既存更新は再実行では走らない
    const mail = src.indexOf("await fetch('https://api.sendgrid.com/v3/mail/send'");
    const update = src.indexOf('await fetch(recordUrl, {\n        method: \'PATCH\'');
    assert.ok(src.slice(0, mail).lastIndexOf('if (!alreadyConfirmed) {') > src.indexOf('Step 3:'),
      'メール送信が再実行でも走る');
    assert.ok(src.includes('if (!alreadyConfirmed) {'), '既存更新の分岐が無い');
    // membership は再実行でも走り、現在時刻を渡さない
    assert.match(src, /confirmedAtIso: alreadyConfirmed \? null : new Date\(\)\.toISOString\(\)/);
  });

  test('🔴 再実行では保存済みの有効期限を使う（この実行では書き換えない）', () => {
    const src = read('netlify/functions/send-payment-confirmation-auto.js');
    assert.match(src, /expirationDate: alreadyConfirmed\s*\?\s*\(fields\.ExpirationDate \|\| fields\['有効期限'\] \|\| null\)/);
  });

  test('🔴 期間が判定できなければ回復もしない（現在時刻へ倒さない）', () => {
    const r = planBankMembershipUpdate({
      fields: afterStep4({ plan_type: 'lifetime' }), recordId: RECORD, expirationDate: '2099-12-31',
    });
    assert.equal(r.entry, null);
    assert.equal(r.startedAtIso, null, '期間不明なのに起点を書いている');
    assert.ok(r.skipped.includes(BANK_SKIP.NO_CONFIRMED_AT));
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

/* ================================================================
   契約価格（M-1）— 2026-09-08 / 2026-09-09 改訂
   ================================================================ */

describe('銀行振込の契約価格（M-1: 加入時点の価格を保持）', () => {
  const plan = ({ fields = {}, ...rest } = {}) => planBankMembershipUpdate({
    recordId: 'rec1',
    expirationDate: '2027-09-08',
    confirmedAtIso: '2026-09-08T00:00:00.000Z',
    ...rest,
    fields: { Email: 'a@example.test', plan_type: 'yearly', ...fields },
  });

  test('現行価格で成立した新規 yearly 契約 → 39,800 を保存する', () => {
    const p = plan({ fields: { CreatedAt: '2026-09-08T00:00:00.000Z' } });
    assert.equal(p.startedAtIso, '2026-09-08', '新規契約として起点が立つ');
    assert.equal(p.contract.amountYen, 39800);
    assert.equal(p.contract.currency, 'jpy');
    assert.equal(p.contract.priceId, 'bank:yearly');
    assert.equal(p.contract.startedAtIso, '2026-09-08');
  });

  test('🔴 料金改定前から存在する legacy yearly は現在価格を捏造しない', () => {
    // 価格改定日（2026-08-30）より前に始まった契約。当時の年払いは ¥66,000
    const p = plan({ confirmedAtIso: '2026-07-26T00:00:00.000Z', expirationDate: '2027-07-26' });
    assert.equal(p.contract, null, '🔴 改定前の契約へ 39,800 を当てはめている');
    assert.ok(p.skipped.includes(BANK_SKIP.LEGACY_CONTRACT));
  });

  /* ---- 🔴 MembershipStartedAt が空 ≠ 今回が初回契約 ---- */

  test('🔴 改定前からの旧レコードで起点未設定 → 次回更新でも 39,800 を書かない', () => {
    // 実在ケース: 2026-07 加入の旧年払い（¥66,000）が MembershipStartedAt 未設定のまま。
    // 次回更新が改定後に来ると startedAtIso >= 改定日 / yearly を満たしてしまう。
    const p = plan({
      fields: { CreatedAt: '2026-07-25T00:00:00.000Z' },
      confirmedAtIso: '2026-09-15T00:00:00.000Z',
      expirationDate: '2027-09-15',
    });
    assert.equal(p.startedAtIso, '2026-09-15', '起点は今回の入金確認日で立つ');
    assert.equal(p.contract, null, '🔴 旧年払い会員へ現在価格を書いている');
    assert.ok(p.skipped.includes(BANK_SKIP.LEGACY_RECORD));
  });

  test('🔴 CreatedAt が無く新しさを証明できない → 書かない', () => {
    const p = plan({ confirmedAtIso: '2026-09-15T00:00:00.000Z', expirationDate: '2027-09-15' });
    assert.equal(p.contract, null);
    assert.ok(p.skipped.includes(BANK_SKIP.UNKNOWN_RECORD_AGE));
  });

  test('改定後に作られたレコードの新規契約なら保存する', () => {
    const p = plan({
      fields: { CreatedAt: '2026-09-15T00:00:00.000Z' },
      confirmedAtIso: '2026-09-15T00:00:00.000Z',
      expirationDate: '2027-09-15',
    });
    assert.equal(p.contract.amountYen, 39800);
  });

  test('🔴 今回 pending とした旧年払い 3 名を将来の更新で誤って埋めない', () => {
    // read-only 監査（2026-09-09）で「起点不明 / 改定前」と分類した実在パターン
    const cases = [
      { label: 'f7df547a 相当: 改定前の契約・CreatedAt 空', fields: {}, expirationDate: '2027-07-26' },
      { label: '22d14882 相当: 改定前の契約・CreatedAt 空', fields: {}, expirationDate: '2027-07-25' },
      { label: 'd24693fa 相当: 期限が未来すぎて起点不明', fields: {}, expirationDate: '2028-06-15' },
    ];
    for (const c of cases) {
      // どの会員も「次回更新が改定後に来る」状況を模す
      const p = plan({ fields: c.fields, confirmedAtIso: '2026-10-01T00:00:00.000Z', expirationDate: c.expirationDate });
      assert.equal(p.contract, null, `🔴 ${c.label}: 現在価格が書かれた`);
    }
  });

  test('recordCreatedAfterRevision は fail-closed', () => {
    assert.equal(recordCreatedAfterRevision('2026-08-30T00:00:00.000Z'), true);
    assert.equal(recordCreatedAfterRevision('2026-08-29T23:59:59.000Z'), false);
    assert.equal(recordCreatedAfterRevision(''), false, '空は false');
    assert.equal(recordCreatedAfterRevision(null), false);
    assert.equal(recordCreatedAfterRevision('not-a-date'), false, '不正な形は false');
  });

  test('🔴 既存契約（MembershipStartedAt あり）の更新では契約価格を書かない', () => {
    // 更新のたびに現在価格を書くと、加入時価格の保持（M-1）が壊れる
    const p = plan({ fields: { MembershipStartedAt: '2026-05-08' } });
    assert.equal(p.contract, null, '🔴 既存契約へ現在価格を当てはめている');
    assert.ok(p.skipped.includes(BANK_SKIP.NO_NEW_CONTRACT));
  });

  test('🔴 改定日ちょうど（2026-08-30）は現行価格として扱う', () => {
    const p = plan({ fields: { CreatedAt: '2026-08-30T00:00:00.000Z' }, confirmedAtIso: '2026-08-30T00:00:00.000Z', expirationDate: '2027-08-30' });
    assert.equal(p.contract.amountYen, 39800);
  });

  test('🔴 改定日の前日（2026-08-29）は legacy 扱いにする', () => {
    const p = plan({ confirmedAtIso: '2026-08-29T00:00:00.000Z', expirationDate: '2027-08-29' });
    assert.equal(p.contract, null);
    assert.ok(p.skipped.includes(BANK_SKIP.LEGACY_CONTRACT));
  });

  test('🔴 確定額が無いプランは契約価格を作らない（推測で入れない）', () => {
    for (const planType of ['light', 'monthly-nankan', 'monthly-jra', 'lifetime', 'unknown', '']) {
      const p = plan({ fields: { plan_type: planType, CreatedAt: '2026-09-08T00:00:00.000Z' } });
      assert.equal(p.contract, null, `${planType}: 推測した価格を入れている`);
    }
  });

  test('🔴 確定額を持つのは年払いだけ', () => {
    assert.deepEqual(Object.keys(BANK_CONTRACT_PRICE_YEN), ['yearly']);
    assert.equal(BANK_CONTRACT_PRICE_YEN.yearly, 39800);
  });

  test('🔴 historical contract price を確定できないときは null（pending のまま）', () => {
    // 入金確認日を復元できない＝起点が立たない → 価格も断定できない
    const p = plan({ confirmedAtIso: null, expirationDate: '' });
    assert.equal(p.startedAtIso, null);
    assert.equal(p.contract, null);
    assert.ok(p.skipped.includes(BANK_SKIP.NO_NEW_CONTRACT));
  });

  test('価格改定日は git の事実（3cdd0c4e / 2026-08-30）に一致している', () => {
    assert.equal(BANK_PRICE_REVISION_DATE, '2026-08-30');
  });

  test('bankContractPriceFor は不正な入力で null', () => {
    assert.equal(bankContractPriceFor('yearly', ''), null);
    assert.equal(bankContractPriceFor(null, '2026-09-08'), null);
    assert.equal(bankContractPriceFor('yearly', 'not-a-date'), null);
  });

  test('🔴 既存 ContractPriceYen があれば絶対に上書きしない（M-1）', async () => {
    const store = createInMemoryMembershipStore({
      profiles: { 'a@example.test': { contractPrice: { amountYen: 66000, currency: 'jpy', priceId: 'legacy', startedAtIso: '2026-05-08' } } },
    });
    const r = await store.saveContractPrice('a@example.test', plan({ fields: { CreatedAt: '2026-09-08T00:00:00.000Z' } }).contract);
    assert.equal(r.status, STORE_RESULT.ALREADY);
    assert.equal(store.snapshot().profiles['a@example.test'].contractPrice.amountYen, 66000,
      '🔴 旧価格（¥66,000）が現在価格で上書きされた');
  });

  test('未保存かつ新規契約なら保存される', async () => {
    const store = createInMemoryMembershipStore({ profiles: { 'a@example.test': {} } });
    const r = await store.saveContractPrice('a@example.test', plan({ fields: { CreatedAt: '2026-09-08T00:00:00.000Z' } }).contract);
    assert.equal(r.status, STORE_RESULT.APPLIED);
    assert.equal(store.snapshot().profiles['a@example.test'].contractPrice.amountYen, 39800);
  });

  test('🔴 契約価格の保存で PlanType / Status / AccessEnabled / ポイントを触らない', async () => {
    const store = createInMemoryMembershipStore({
      profiles: { 'a@example.test': { PlanType: 'pro', Status: 'active', AccessEnabled: true } },
      ledgers: { 'a@example.test': [] },
    });
    await store.saveContractPrice('a@example.test', plan({ fields: { CreatedAt: '2026-09-08T00:00:00.000Z' } }).contract);
    const p = store.snapshot().profiles['a@example.test'];
    assert.equal(p.PlanType, 'pro');
    assert.equal(p.Status, 'active');
    assert.equal(p.AccessEnabled, true);
    assert.deepEqual(store.snapshot().ledgers['a@example.test'], [], 'ポイントが動いている');
  });

  test('🔴 入金確認の関数が契約価格を保存している（配線の固定）', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..',
      'netlify/functions/send-payment-confirmation-auto.js'), 'utf8');
    assert.match(src, /store\.saveContractPrice\(/, '契約価格を保存していない');
    assert.match(src, /plan\.contract/, 'plan.contract を使っていない');
  });
});
