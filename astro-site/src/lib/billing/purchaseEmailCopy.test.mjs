/**
 * purchaseEmailCopy.test.mjs — 購入導線のメール文面
 *
 * 🔴 ここで守るのは 3 つ。
 *   1. 有料の申し込みで「無料会員登録」と言わない
 *   2. 「まだ課金されていない」ことを必ず書く
 *   3. 金額を焼き付けない（請求額の正本は Stripe の Price）
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { emailCopyFor, PURCHASE_COPY, FREE_SIGNUP_COPY, LOGIN_COPY } from './purchaseEmailCopy.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe('購入導線のメール文面', () => {
  test('🔴 購入導線では「無料会員登録」と言わない', () => {
    const c = emailCopyFor('premium');
    assert.equal(c, PURCHASE_COPY);
    const all = [c.subject, c.heading, c.lead, c.cta, c.note].join(' ');
    for (const w of ['無料会員登録', '無料登録', '登録を完了']) {
      assert.equal(all.includes(w), false, `🔴 購入導線の文面に「${w}」がある`);
    }
    // 次に何が起きるかを言っている
    assert.match(all, /お支払い/);
    assert.equal(c.showBenefits, false, '購入手続き中に特典紹介を挟まない');
  });

  test('🔴 まだ課金されていないことを書く', () => {
    assert.match(PURCHASE_COPY.note, /課金されません/);
  });

  test('🔴 金額を焼き付けない', () => {
    for (const c of [PURCHASE_COPY, FREE_SIGNUP_COPY, LOGIN_COPY]) {
      const all = [c.subject, c.heading, c.lead, c.cta, c.note || ''].join(' ');
      assert.equal(/[¥￥]\s*[0-9,]+|[0-9,]+\s*円/.test(all), false, '🔴 文面に金額がある');
    }
  });

  test('購入意図が無ければ従来どおり', () => {
    assert.equal(emailCopyFor(null, 'register'), FREE_SIGNUP_COPY);
    assert.equal(emailCopyFor('', 'register'), FREE_SIGNUP_COPY);
    assert.equal(emailCopyFor(undefined, 'login'), LOGIN_COPY);
    assert.equal(emailCopyFor('   ', 'login'), LOGIN_COPY);
  });

  test('🔴 送信側が文面を分岐している', () => {
    for (const f of ['netlify/functions/register-free.js', 'netlify/functions/send-magic-link.js']) {
      const src = read(f);
      assert.match(src, /emailCopyFor\(intent, '(register|login)'\)/, `${f} が分岐していない`);
      assert.match(src, /subject: copy\.subject|const subject = copy\.subject/);
      assert.match(src, /\$\{copy\.heading\}/);
      assert.match(src, /\$\{copy\.cta\}/);
    }
    // 🔴 廃止済みの訴求（買い切り）を復活させない
    const reg = read('netlify/functions/register-free.js');
    assert.equal(/88,?000|買い切り|永久アクセス/.test(reg), false,
      '🔴 廃止済みのプラン訴求がメールに残っている');
  });

  test('🔴 認証ページも購入導線では次の一歩を出す', () => {
    const v = read('src/pages/auth/verify.astro');
    assert.match(v, /お支払い画面へ進みます/);
  });
});
