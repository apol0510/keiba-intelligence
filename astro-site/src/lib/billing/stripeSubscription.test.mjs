/**
 * stripeSubscription.test.mjs — マイページの契約状態 / 解約予約の取り消し（ネットワーク不使用）
 *
 * 実行: npm run test:stripe（astro-site 直下から）
 *
 * 正本: docs/RETENTION_2026_10.md
 *
 * 固定する不変条件:
 *   1. POST のみ・**ログイン必須**・email は **セッション由来のものだけ**
 *   2. 🔴 本文の subscription ID 等は受け取らない（他人の契約を操作できない）
 *   3. 🔴 取り消しは **解約予約中のときだけ** 書き込む。冪等（二重押しで 2 回更新しない）
 *   4. 🔴 解約・値引き・プラン変更はしない（update に渡すのは予約解除だけ）
 *   5. flexible 請求モード（cancel_at）と旧来（cancel_at_period_end）の両方を扱う
 *   6. 返すのは状態と日付だけ。Stripe のエラー内容・顧客 ID を返さない
 */

import { test, mock, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { TIER } from '../auth/tiers.js';
import { signSession, SESSION_COOKIE_NAME } from '../auth/session.js';
import {
  summarizeSubscription, resumeParams, pickSubscription, isCancelScheduled, SUB_STATE,
} from './subscriptionState.js';

const SECRET_KEY = 'sk_test_only_do_not_use_in_production';
const SESSION_SECRET = 'session-secret-for-test-only';
const ALICE = 'alice@example.com';

/** 2026-10-27 00:44:34 JST（本番の解約予約と同じ形） */
const PERIOD_END = 1793029474;
const NOW_MS = Date.parse('2026-10-06T00:00:00Z');

const calls = { customers: [], subsList: [], update: [] };
const behavior = { customers: [], subs: [], throwOn: null, updateResult: null };

function flexibleScheduled(id = 'sub_alice') {
  return {
    id, status: 'active', cancel_at_period_end: false, cancel_at: PERIOD_END,
    items: { data: [{ current_period_end: PERIOD_END }] },
  };
}
function legacyScheduled(id = 'sub_alice') {
  return { id, status: 'active', cancel_at_period_end: true, cancel_at: null, current_period_end: PERIOD_END };
}
function continuing(id = 'sub_alice') {
  return { id, status: 'active', cancel_at_period_end: false, cancel_at: null, items: { data: [{ current_period_end: PERIOD_END }] } };
}

before(() => {
  process.env.SESSION_SIGNING_SECRET = SESSION_SECRET;
  mock.module('stripe', {
    defaultExport: class StripeStub {
      constructor(key) { this.key = key; }
      customers = {
        list: async (params) => {
          calls.customers.push(params);
          if (behavior.throwOn === 'customers') throw new Error('stripe exploded: secret detail');
          return { data: behavior.customers };
        },
      };
      subscriptions = {
        list: async (params) => {
          calls.subsList.push(params);
          return { data: behavior.subs };
        },
        update: async (id, params, opts) => {
          calls.update.push({ id, params, opts });
          if (behavior.throwOn === 'update') throw new Error('stripe exploded: secret detail');
          if (behavior.updateResult) return behavior.updateResult;
          const base = behavior.subs.find((s) => s.id === id);
          return { ...base, cancel_at_period_end: false, cancel_at: null };
        },
      };
    },
  });
});

beforeEach(() => {
  calls.customers = []; calls.subsList = []; calls.update = [];
  behavior.customers = [{ id: 'cus_alice' }];
  behavior.subs = [];
  behavior.throwOn = null;
  behavior.updateResult = null;
  process.env.STRIPE_SECRET_KEY = SECRET_KEY;
});

function cookieFor(email, tier = TIER.PREMIUM, secret = SESSION_SECRET) {
  const s = signSession({ email, tier, secret, nowMs: Date.now() });
  assert.ok(s.ok, s.reason);
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(s.token)}`;
}

async function call({ cookie, body = { action: 'status' }, method = 'POST', origin } = {}) {
  const { handler } = await import('../../../netlify/functions/stripe-subscription.js');
  return handler({
    httpMethod: method,
    headers: { cookie: cookie ?? undefined, origin, host: 'keiba-intelligence.jp' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/* ---------- 純粋関数 ---------- */

test('flexible（cancel_at）も旧来（cancel_at_period_end）も「解約予約中」', () => {
  assert.equal(isCancelScheduled(flexibleScheduled()), true);
  assert.equal(isCancelScheduled(legacyScheduled()), true);
  assert.equal(isCancelScheduled(continuing()), false);
  assert.equal(isCancelScheduled({ ...flexibleScheduled(), status: 'canceled' }), false);
});

test('要約: 解約予約中は終了日時と残り日数、継続中は次回更新日', () => {
  const s = summarizeSubscription(flexibleScheduled(), NOW_MS);
  assert.equal(s.state, SUB_STATE.CANCEL_SCHEDULED);
  assert.equal(s.endsAt, new Date(PERIOD_END * 1000).toISOString());
  assert.equal(s.daysLeft, 21);
  assert.equal(s.renewsAt, null);

  const legacy = summarizeSubscription(legacyScheduled(), NOW_MS);
  assert.equal(legacy.endsAt, new Date(PERIOD_END * 1000).toISOString());

  const a = summarizeSubscription(continuing(), NOW_MS);
  assert.equal(a.state, SUB_STATE.ACTIVE);
  assert.equal(a.renewsAt, new Date(PERIOD_END * 1000).toISOString());

  assert.equal(summarizeSubscription(null).state, SUB_STATE.NONE);
  assert.equal(summarizeSubscription({ status: 'canceled' }).state, SUB_STATE.NONE);
});

test('🔴 resumeParams は予約解除だけを返す（値引き・解約・プラン変更を含まない）', () => {
  assert.deepEqual(resumeParams(flexibleScheduled()), { cancel_at: '' });
  assert.deepEqual(resumeParams(legacyScheduled()), { cancel_at_period_end: false });
  assert.equal(resumeParams(continuing()), null);
  assert.equal(resumeParams(null), null);
  for (const p of [resumeParams(flexibleScheduled()), resumeParams(legacyScheduled())]) {
    for (const k of Object.keys(p)) assert.ok(['cancel_at', 'cancel_at_period_end'].includes(k), k);
  }
});

test('pickSubscription: 有効なものだけ・継続中を優先して決定的に選ぶ', () => {
  assert.equal(pickSubscription([{ id: 'x', status: 'canceled' }]), null);
  assert.equal(pickSubscription([flexibleScheduled('s1'), continuing('s2')]).id, 's2');
  assert.equal(pickSubscription([{ id: 'x', status: 'canceled' }, flexibleScheduled('s1')]).id, 's1');
});

/* ---------- 関数: 認可・入力 ---------- */

test('🔴 未ログインは 401（Stripe を叩かない）', async () => {
  const res = await call({ cookie: null });
  assert.equal(res.statusCode, 401);
  assert.equal(calls.customers.length, 0);
});

test('🔴 改竄 Cookie は 401', async () => {
  const res = await call({ cookie: cookieFor(ALICE, TIER.PREMIUM, 'attacker-secret'), body: { action: 'resume' } });
  assert.equal(res.statusCode, 401);
  assert.equal(calls.update.length, 0);
});

test('POST 以外 405・不明な action / 壊れた本文は 400', async () => {
  assert.equal((await call({ cookie: cookieFor(ALICE), method: 'GET' })).statusCode, 405);
  assert.equal((await call({ cookie: cookieFor(ALICE), body: { action: 'cancel' } })).statusCode, 400);
  assert.equal((await call({ cookie: cookieFor(ALICE), body: '{oops' })).statusCode, 400);
  assert.equal(calls.customers.length, 0);
});

test('🔴 秘密鍵未設定は 503', async () => {
  delete process.env.STRIPE_SECRET_KEY;
  assert.equal((await call({ cookie: cookieFor(ALICE) })).statusCode, 503);
});

/* ---------- 関数: status ---------- */

test('status: 顧客はセッションの email で引き、状態と日付だけを返す', async () => {
  behavior.subs = [flexibleScheduled()];
  const res = await call({ cookie: cookieFor(ALICE) });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.customers[0], { email: ALICE, limit: 1 });
  assert.equal(calls.subsList[0].customer, 'cus_alice');
  const body = JSON.parse(res.body);
  assert.equal(body.state, 'cancel_scheduled');
  assert.deepEqual(Object.keys(body).sort(), ['daysLeft', 'endsAt', 'renewsAt', 'state']);
  assert.ok(!res.body.includes('cus_alice') && !res.body.includes('sub_alice') && !res.body.includes(ALICE));
  assert.equal(calls.update.length, 0, 'status は書き込まない');
});

test('status: Stripe 顧客が無ければ none（銀行振込・未加入）', async () => {
  behavior.customers = [];
  const res = await call({ cookie: cookieFor(ALICE) });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).state, 'none');
});

/* ---------- 関数: resume ---------- */

test('E2E: 解約予約中（flexible）は取り消せる・冪等キー付き・予約解除だけを送る', async () => {
  behavior.subs = [flexibleScheduled()];
  const res = await call({ cookie: cookieFor(ALICE), body: { action: 'resume', subscription: 'sub_mallory' } });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.state, 'active');
  assert.equal(body.resumed, true);

  assert.equal(calls.update.length, 1);
  // 🔴 本文の subscription は無視し、セッション顧客の契約だけを更新する
  assert.equal(calls.update[0].id, 'sub_alice');
  assert.deepEqual(calls.update[0].params, { cancel_at: '' });
  assert.equal(calls.update[0].opts.idempotencyKey, `ki-resume-sub_alice-${PERIOD_END}`);
});

test('旧来の cancel_at_period_end も取り消せる', async () => {
  behavior.subs = [legacyScheduled()];
  const res = await call({ cookie: cookieFor(ALICE), body: { action: 'resume' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.update[0].params, { cancel_at_period_end: false });
});

test('🔴 予約が無ければ書き込まない（二重押し・継続中・契約なし）', async () => {
  behavior.subs = [continuing()];
  let res = await call({ cookie: cookieFor(ALICE), body: { action: 'resume' } });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).resumed, false);

  behavior.subs = [];
  res = await call({ cookie: cookieFor(ALICE), body: { action: 'resume' } });
  assert.equal(JSON.parse(res.body).state, 'none');

  behavior.customers = [];
  res = await call({ cookie: cookieFor(ALICE), body: { action: 'resume' } });
  assert.equal(JSON.parse(res.body).state, 'none');
  assert.equal(calls.update.length, 0);
});

test('🔴 更新後も予約が残っていたら成功扱いにしない（502）', async () => {
  behavior.subs = [flexibleScheduled()];
  behavior.updateResult = flexibleScheduled();
  const res = await call({ cookie: cookieFor(ALICE), body: { action: 'resume' } });
  assert.equal(res.statusCode, 502);
  assert.equal(JSON.parse(res.body).error, 'resume_failed');
});

test('🔴 Stripe 例外は 502（内容を返さない）', async () => {
  behavior.subs = [flexibleScheduled()];
  behavior.throwOn = 'update';
  const res = await call({ cookie: cookieFor(ALICE), body: { action: 'resume' } });
  assert.equal(res.statusCode, 502);
  assert.ok(!/exploded|secret|Error:/i.test(res.body));
});

test('許可外の Origin へ CORS を開かない', async () => {
  const res = await call({ cookie: cookieFor(ALICE), origin: 'https://evil.example' });
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://keiba-intelligence.jp');
});

/* ---------- マイページの導線（静的検査） ---------- */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MYPAGE = readFileSync(fileURLToPath(new URL('../../pages/mypage.astro', import.meta.url)), 'utf8');

/** 解約予約の案内ブロック（マークアップ部分）だけを切り出す。 */
function cancelBlock() {
  const i = MYPAGE.indexOf('id="mp-sub-cancel"');
  return MYPAGE.slice(i, MYPAGE.indexOf('</div>', i));
}

test('🔴 お支払い管理ページへの導線は維持する（解約もここから行える）', () => {
  assert.match(MYPAGE, /id="mp-portal"/);
  assert.match(MYPAGE, /お支払い方法の変更・プラン変更・解約は、お支払い管理ページから行えます。/);
});

test('🔴 マイページで解約を想起させる追加文言を出さない（2026-10-06 MK 決定）', () => {
  assert.equal(MYPAGE.includes('解約はいつでも可能'), false);
  assert.equal(MYPAGE.includes('mp-billing-sub'), false);
});

test('🔴 解約予約の案内に値引き・期限煽り・成績訴求を入れない', () => {
  const block = cancelBlock();
  assert.ok(block.length > 100, '案内ブロックが見つからない');
  for (const w of ['割引', '値引', 'クーポン', 'OFF', '今だけ', '限定', '損', '回収率', '的中率']) {
    assert.equal(block.includes(w), false, `解約予約の案内に「${w}」を入れてはいけない`);
  }
  // 取り消しは任意。何もしなくても期間末まで使えることを必ず併記する
  assert.match(block, /取り消さない場合も、終了日までは追加料金なしでそのままご利用いただけます/);
});

test('🔴 GA4 計測に個人情報を載せない', () => {
  const tracks = MYPAGE.match(/track\('[^)]*\)/g) || [];
  assert.ok(tracks.length >= 4, 'track 呼び出しが足りない');
  for (const t of tracks) assert.ok(!/email|ent\.|customer|sub_/.test(t), t);
});
