/**
 * membershipStart.guard.test.mjs — 継続月数の起点を Stripe 経路でも記録する
 *
 * 正本: `docs/MEMBERSHIP_REWARDS.md` §7.6（TBD-9・2026-09-01 確定）
 *   Stripe … **初回の支払い成功** / 銀行振込 … 入金確認日
 *
 * 🔴 2026-09-10 の QA E2E で、**Stripe 経路では `MembershipStartedAt` が
 *    一度も書かれていなかった**ことが判明した（webhook が `saveContractPrice` と
 *    `appendEntry` しか呼んでいなかった）。表示は台帳から継続月数を出すため
 *    壊れていなかったが、台帳が読めないときのフォールバックが空のままだった。
 *
 * ここで守るのは 4 つ。
 *   1. webhook が **支払い成功の経路で** `saveMembershipStart` を呼ぶ
 *   2. 起点は `status_transitions.paid_at` 由来（受信時刻で代用しない）
 *   3. 結果を握りつぶさない（失敗したら再送させる）
 *   4. 銀行振込側の「初回だけ書く」規約を壊していない
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const webhook = read('netlify/functions/stripe-webhook.js');
const store = read('src/lib/membership/store.js');
const airtable = read('src/lib/membership/airtableStore.js');

/** `recordPaidPeriod`（支払い成功で台帳を積む関数）の本体を切り出す。 */
function recordPaidPeriodBody() {
  const start = webhook.indexOf('async function recordPaidPeriod');
  assert.notEqual(start, -1, '🔴 recordPaidPeriod が無い');
  const next = webhook.indexOf('\nfunction ', start + 10);
  const next2 = webhook.indexOf('\nasync function ', start + 10);
  const end = Math.min(...[next, next2].filter((n) => n !== -1));
  return webhook.slice(start, end);
}

describe('Stripe の支払い成功で起点を記録する', () => {
  test('🔴 支払い成功の経路で saveMembershipStart を呼ぶ', () => {
    const body = recordPaidPeriodBody();
    assert.match(body, /store\.saveMembershipStart\(/,
      '🔴 Stripe 経路で MembershipStartedAt が書かれない（2026-09-10 の欠落）');
  });

  test('🔴 起点は paid_at 由来（受信時刻で代用しない）', () => {
    const body = recordPaidPeriodBody();
    // occurredAtMs は paidAtMsFromInvoice(invoice) = status_transitions.paid_at
    assert.match(body, /const occurredAtMs = paidAtMsFromInvoice\(invoice\);/);
    assert.match(body, /const startedAtIso = new Date\(occurredAtMs\)\.toISOString\(\);/);
    assert.match(body, /saveMembershipStart\(email, startedAtIso\)/);
    // Date.now() / 受信時刻を起点にしていない
    assert.equal(/saveMembershipStart\([^)]*Date\.now\(\)/.test(body), false,
      '🔴 受信時刻を起点にしている');
  });

  test('🔴 台帳の付与より後に呼ぶ（付与を巻き添えにしない）', () => {
    const body = recordPaidPeriodBody();
    assert.ok(body.indexOf('appendEntry') < body.indexOf('saveMembershipStart'),
      '🔴 起点の書き込みが台帳の付与より先に来ている');
  });

  test('🔴 結果を握りつぶさない（失敗なら再送させる）', () => {
    const body = recordPaidPeriodBody();
    assert.match(body, /membershipResultFromStore\(\s*await store\.saveMembershipStart/);
    assert.match(body, /return worstMembershipResult\(accrual, started\);/);
    // 「1 つでも FAILED なら FAILED」になっていること
    assert.match(webhook, /function worstMembershipResult[\s\S]{0,240}includes\(MEMBERSHIP_RESULT\.FAILED\)[\s\S]{0,60}return MEMBERSHIP_RESULT\.FAILED/);
  });

  test('🔴 支払いが成立していない請求では起点を書かない', () => {
    const body = recordPaidPeriodBody();
    const at = (needle) => body.indexOf(needle);
    // amount_paid / interval / paid_at の各前提チェックは呼び出しより前にある
    for (const pre of ['amount_paid_missing', 'zero_amount_invoice', 'unknown_interval', 'paid_at missing']) {
      assert.ok(at(pre) !== -1 && at(pre) < at('saveMembershipStart'),
        `🔴 「${pre}」の判定が起点の書き込みより後にある`);
    }
  });
});

describe('store 側の規約', () => {
  test('🔴 既に起点があれば PATCH を投げない（更新で動かさない）', () => {
    const fn = airtable.slice(airtable.indexOf('async saveMembershipStart'));
    assert.match(fn, /CUSTOMER_FIELDS\.STARTED_AT\]\)\s*\{\s*\n\s*return Object\.freeze\(\{ status: STORE_RESULT\.ALREADY/);
  });

  test('🔴 起点が無い・文字列でないなら書かない（推測で埋めない）', () => {
    const fn = airtable.slice(airtable.indexOf('async saveMembershipStart'));
    assert.match(fn, /typeof startedAtIso !== 'string'/);
    assert.match(fn, /invalid_started_at/);
  });

  test('🔴 read-only / disabled でも必ず用意されている（未定義で落とさない）', () => {
    // 読み取りだけの段階では書き込みを拒否する
    assert.match(store, /async saveMembershipStart\(\) \{ return refuse\(\); \}/);
    // disabled では UNAVAILABLE を返す
    assert.match(store, /async saveMembershipStart\(\) \{\s*\n\s*return Object\.freeze\(\{ status: STORE_RESULT\.UNAVAILABLE/);
  });
});

describe('銀行振込側を壊していない', () => {
  test('🔴 入金確認は従来どおり初回だけ起点を書く', () => {
    const bank = read('src/lib/membership/bankTransfer.js');
    assert.match(bank, /const alreadyStarted = !!fields\.MembershipStartedAt;/);
    assert.match(bank, /!alreadyStarted/);
  });
});
