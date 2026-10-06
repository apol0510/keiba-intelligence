/**
 * stripeSubscription.test.mjs — マイページの契約状態 / 退会（即時終了）（ネットワーク不使用）
 *
 * 実行: npm run test:stripe（astro-site 直下から）
 *
 * 正本: docs/WITHDRAWAL_2026_10.md（2026-10-06 MK 確定）
 *
 * 固定する不変条件:
 *   1. POST のみ・**ログイン必須**・email は **セッション由来のものだけ**
 *   2. 🔴 本文の subscription ID 等は受け取らない（他人の契約を操作できない）
 *   3. 🔴 退会は **即時終了だけ**。期間末キャンセル（cancel_at / cancel_at_period_end）を作らない
 *   4. 🔴 確認（confirm: true）の無い要求では終了しない
 *   5. 🔴 二重押し・再送で 2 回目の終了要求を出さない（冪等）
 *   6. 🔴 退会したら、退会した端末も **他の端末も** 有料を即時に失う（残り期間があっても）
 *   7. 🔴 持ち主が一致しない・契約が複数 → 終了しない（fail-closed）
 *   8. 🔴 既存の解約予約を勝手に即時終了へ変えない（status は書き込まない）
 *   9. 🔴 予約停止・予約取り消しの導線（UI・API）が残っていない
 */

import { test, mock, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { TIER } from '../auth/tiers.js';
import { signSession, verifySession, SESSION_COOKIE_NAME } from '../auth/session.js';
import {
  resolveEntitlement, applyRevocation, viewFlags, paidPageRedirect,
} from '../auth/entitlement.js';
import {
  revocationKey, tierAfterRevocation, tierForNewSession, nextRevocation, parseRevocation,
} from '../auth/revocation.js';
import {
  summarizeSubscription, pickSubscription, isCancelScheduled, withdrawalTarget,
  withdrawCancelParams, withdrawIdempotencyKey, WITHDRAW_COMMENT, SUB_STATE,
} from './subscriptionState.js';

const SECRET_KEY = 'sk_test_only_do_not_use_in_production';
const SESSION_SECRET = 'session-secret-for-test-only';
const ALICE = 'alice@example.com';
const MALLORY = 'mallory@example.com';

/** 2026-10-27 00:44:34 JST（本番の解約予約と同じ形） */
const PERIOD_END = 1793029474;
const NOW_MS = Date.parse('2026-10-06T00:00:00Z');

const calls = { customers: [], subsList: [], cancel: [], update: [] };
const behavior = { customers: [], subsByCustomer: {}, throwOn: null, cancelResult: null };
const blobs = { store: new Map(), broken: false };

function sub(id, email, extra = {}) {
  return {
    id, status: 'active', cancel_at_period_end: false, cancel_at: null,
    metadata: { ki_email: email, ki_plan: 'premium' },
    items: { data: [{ current_period_end: PERIOD_END }] },
    ...extra,
  };
}
const continuing = (id = 'sub_alice', email = ALICE) => sub(id, email);
const flexibleScheduled = (id = 'sub_alice', email = ALICE) => sub(id, email, { cancel_at: PERIOD_END });
const legacyScheduled = (id = 'sub_alice', email = ALICE) => sub(id, email, { cancel_at_period_end: true, items: undefined, current_period_end: PERIOD_END });

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
          return { data: behavior.subsByCustomer[params.customer] || [] };
        },
        cancel: async (id, params, opts) => {
          calls.cancel.push({ id, params, opts });
          if (behavior.throwOn === 'cancel') throw new Error('stripe exploded: secret detail');
          if (behavior.cancelResult) return behavior.cancelResult;
          // 本物と同じ: 同じ契約を終了済みにする（次の list に反映される）
          for (const list of Object.values(behavior.subsByCustomer)) {
            const s = list.find((x) => x.id === id);
            if (s) {
              s.status = 'canceled';
              s.cancellation_details = { comment: params?.cancellation_details?.comment || null };
              return { ...s };
            }
          }
          throw new Error('no such subscription');
        },
        // 🔴 退会で update（期間末キャンセル）を呼んではいけない。呼ばれたら記録して検出する
        update: async (id, params) => {
          calls.update.push({ id, params });
          return {};
        },
      };
    },
  });
  mock.module('@netlify/blobs', {
    namedExports: {
      connectLambda() {},
      getStore() {
        if (blobs.broken) throw new Error('blobs unavailable');
        return {
          get: async (k) => blobs.store.get(k) ?? null,
          set: async (k, v) => { blobs.store.set(k, v); },
        };
      },
    },
  });
});

beforeEach(() => {
  calls.customers = []; calls.subsList = []; calls.cancel = []; calls.update = [];
  behavior.customers = [{ id: 'cus_alice' }];
  behavior.subsByCustomer = { cus_alice: [] };
  behavior.throwOn = null;
  behavior.cancelResult = null;
  blobs.store = new Map();
  blobs.broken = false;
  process.env.STRIPE_SECRET_KEY = SECRET_KEY;
});

function signed(email, tier = TIER.PREMIUM, { secret = SESSION_SECRET, nowMs = Date.now() } = {}) {
  const s = signSession({ email, tier, secret, nowMs });
  assert.ok(s.ok, s.reason);
  return s.token;
}
function cookieFor(email, tier = TIER.PREMIUM, opts) {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(signed(email, tier, opts))}`;
}

async function call({ cookie, body = { action: 'status' }, method = 'POST', origin } = {}) {
  const { handler } = await import('../../../netlify/functions/stripe-subscription.js');
  return handler({
    httpMethod: method,
    headers: { cookie: cookie ?? undefined, origin, host: 'keiba-intelligence.jp' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
const withdraw = (cookie, extra = {}) => call({ cookie, body: { action: 'withdraw', confirm: true, ...extra } });

/** Set-Cookie の tier を読む。 */
function tierInSetCookie(res) {
  const sc = res.headers['Set-Cookie'];
  if (!sc) return null;
  const token = decodeURIComponent(sc.split(';')[0].split('=').slice(1).join('='));
  const v = verifySession({ token, secret: SESSION_SECRET, nowMs: Date.now() });
  return v.ok ? v.session.tier : null;
}

/** 別端末（退会操作をしていない）の Cookie を、実際の認可経路で評価する。 */
async function paidPageAccess(cookie) {
  const ent = await applyRevocation(resolveEntitlement({ cookieHeader: cookie, env: process.env, nowMs: Date.now() }));
  return { ent, redirect: paidPageRedirect(viewFlags(ent), '/free-prediction/nankan') };
}

/* ---------- 純関数: 状態 ---------- */

test('解約予約: flexible（cancel_at）も旧来（cancel_at_period_end）も「解約予約中」として表示できる', () => {
  assert.equal(isCancelScheduled(flexibleScheduled()), true);
  assert.equal(isCancelScheduled(legacyScheduled()), true);
  assert.equal(isCancelScheduled(continuing()), false);
  assert.equal(isCancelScheduled({ ...flexibleScheduled(), status: 'canceled' }), false);
  const s = summarizeSubscription(flexibleScheduled(), NOW_MS);
  assert.equal(s.state, SUB_STATE.CANCEL_SCHEDULED);
  assert.equal(s.endsAt, new Date(PERIOD_END * 1000).toISOString());
  assert.equal(summarizeSubscription(continuing(), NOW_MS).state, SUB_STATE.ACTIVE);
  assert.equal(summarizeSubscription(null).state, SUB_STATE.NONE);
});

test('pickSubscription: 有効なものだけ・継続中を優先して決定的に選ぶ', () => {
  assert.equal(pickSubscription([{ id: 'x', status: 'canceled' }]), null);
  assert.equal(pickSubscription([flexibleScheduled('s1'), continuing('s2')]).id, 's2');
});

/* ---------- 純関数: 退会の対象 ---------- */

test('🔴 withdrawalTarget: 本人（ki_email 一致）の有効な 1 件だけ', () => {
  assert.equal(withdrawalTarget([continuing()], ALICE).sub.id, 'sub_alice');
  assert.equal(withdrawalTarget([continuing()], ' Alice@Example.com ').ok, true, '大文字小文字・空白は同一人物');
  assert.deepEqual(withdrawalTarget([continuing('sub_m', MALLORY)], ALICE), { ok: false, error: 'ownership_mismatch' });
  assert.deepEqual(withdrawalTarget([sub('sub_x', undefined)], ALICE), { ok: false, error: 'ownership_mismatch' });
  assert.deepEqual(withdrawalTarget([continuing('a'), continuing('b')], ALICE), { ok: false, error: 'multiple_subscriptions' });
  assert.deepEqual(withdrawalTarget([], ALICE), { ok: false, error: 'no_active_subscription' });
  // 既存の解約予約中も、本人が確定したときだけ対象（勝手に変換はしない）
  assert.equal(withdrawalTarget([flexibleScheduled()], ALICE).ok, true);
});

test('🔴 withdrawCancelParams: 即時終了・日割り返金なし・期間末キャンセルを含まない', () => {
  const p = withdrawCancelParams();
  assert.deepEqual(p, { prorate: false, invoice_now: false, cancellation_details: { comment: WITHDRAW_COMMENT } });
  assert.equal('cancel_at_period_end' in p, false);
  assert.equal('cancel_at' in p, false);
  assert.equal(withdrawIdempotencyKey({ id: 'sub_alice' }), 'ki-withdraw-sub_alice');
});

/* ---------- 純関数: 退会記録 ---------- */

test('🔴 退会記録: 退会時刻以前に発行された有料セッションは free（free / guest は変えない）', () => {
  const r = { revokedAtMs: NOW_MS, confirmed: false };
  assert.equal(tierAfterRevocation({ tier: TIER.PREMIUM, issuedAtMs: NOW_MS - 1 }, r), TIER.FREE);
  assert.equal(tierAfterRevocation({ tier: TIER.PREMIUM, issuedAtMs: NOW_MS }, r), TIER.FREE);
  assert.equal(tierAfterRevocation({ tier: TIER.PREMIUM, issuedAtMs: NOW_MS + 1 }, r), TIER.PREMIUM, '再契約後に発行されたものは有効');
  assert.equal(tierAfterRevocation({ tier: TIER.LIGHT, issuedAtMs: NOW_MS - 1 }, r), TIER.FREE);
  assert.equal(tierAfterRevocation({ tier: TIER.FREE, issuedAtMs: 0 }, r), TIER.FREE);
  assert.equal(tierAfterRevocation({ tier: TIER.PREMIUM, issuedAtMs: undefined }, r), TIER.FREE, '発行時刻不明は降格（fail-closed）');
  assert.equal(tierAfterRevocation({ tier: TIER.PREMIUM, issuedAtMs: 0 }, null), TIER.PREMIUM);
});

test('🔴 退会記録: webhook 反映前は新しいセッションに有料を出さない／反映後は Airtable が正', () => {
  assert.equal(tierForNewSession(TIER.PREMIUM, { revokedAtMs: 1, confirmed: false }), TIER.FREE);
  assert.equal(tierForNewSession(TIER.PREMIUM, { revokedAtMs: 1, confirmed: true }), TIER.PREMIUM);
  assert.equal(tierForNewSession(TIER.PREMIUM, null), TIER.PREMIUM);
  assert.equal(tierForNewSession(TIER.FREE, { revokedAtMs: 1, confirmed: false }), TIER.FREE);
});

test('退会記録の遷移: withdraw → ended(同じ契約) は時刻を保って confirmed / started は confirmed にするだけ', () => {
  const w = nextRevocation(null, { kind: 'withdraw', nowMs: 100, subscriptionId: 'sub_a' });
  assert.deepEqual(w, { revokedAtMs: 100, confirmed: false, subscriptionId: 'sub_a' });
  assert.deepEqual(nextRevocation(JSON.stringify(w), { kind: 'ended', nowMs: 500, subscriptionId: 'sub_a' }),
    { revokedAtMs: 100, confirmed: true, subscriptionId: 'sub_a' });
  // 別経路の終了（既存予約の期間末など）は、いまの時刻で全端末を止める
  assert.deepEqual(nextRevocation(null, { kind: 'ended', nowMs: 500, subscriptionId: 'sub_b' }),
    { revokedAtMs: 500, confirmed: true, subscriptionId: 'sub_b' });
  assert.equal(nextRevocation(null, { kind: 'started', nowMs: 1 }), null, '記録が無ければ書かない');
  assert.deepEqual(nextRevocation(JSON.stringify(w), { kind: 'started', nowMs: 900 }), { ...w, confirmed: true });
  assert.equal(parseRevocation('{broken'), null);
});

test('🔴 退会記録のキーに email を平文で含めない', () => {
  const k = revocationKey(ALICE);
  assert.ok(k && !k.includes('alice') && !k.includes('@'));
  assert.equal(revocationKey(' ALICE@example.com '), k);
});

/* ---------- 関数: 認可・入力 ---------- */

test('🔴 未ログインは 401（Stripe を叩かない）', async () => {
  assert.equal((await call({ cookie: null })).statusCode, 401);
  assert.equal((await withdraw(null)).statusCode, 401);
  assert.equal(calls.customers.length, 0);
  assert.equal(calls.cancel.length, 0);
});

test('🔴 改竄 Cookie は 401', async () => {
  const res = await withdraw(cookieFor(ALICE, TIER.PREMIUM, { secret: 'attacker-secret' }));
  assert.equal(res.statusCode, 401);
  assert.equal(calls.cancel.length, 0);
});

test('POST 以外 405・不明な action（resume 含む）/ 壊れた本文は 400', async () => {
  assert.equal((await call({ cookie: cookieFor(ALICE), method: 'GET' })).statusCode, 405);
  for (const action of ['cancel', 'resume', 'schedule_cancel']) {
    assert.equal((await call({ cookie: cookieFor(ALICE), body: { action } })).statusCode, 400, action);
  }
  assert.equal((await call({ cookie: cookieFor(ALICE), body: '{oops' })).statusCode, 400);
  assert.equal(calls.customers.length, 0);
});

test('🔴 確認（confirm: true）の無い退会要求は 400 で、何も終了しない', async () => {
  behavior.subsByCustomer.cus_alice = [continuing()];
  for (const body of [{ action: 'withdraw' }, { action: 'withdraw', confirm: 'true' }, { action: 'withdraw', confirm: 1 }]) {
    const res = await call({ cookie: cookieFor(ALICE), body });
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error, 'confirmation_required');
  }
  assert.equal(calls.cancel.length, 0);
});

test('🔴 秘密鍵未設定は 503', async () => {
  delete process.env.STRIPE_SECRET_KEY;
  assert.equal((await call({ cookie: cookieFor(ALICE) })).statusCode, 503);
  assert.equal((await withdraw(cookieFor(ALICE))).statusCode, 503);
});

/* ---------- 関数: status ---------- */

test('status: 顧客はセッションの email で引き、状態と日付だけを返す・書き込まない', async () => {
  behavior.subsByCustomer.cus_alice = [flexibleScheduled()];
  const res = await call({ cookie: cookieFor(ALICE) });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.customers[0], { email: ALICE, limit: 10 });
  assert.equal(calls.subsList[0].customer, 'cus_alice');
  const body = JSON.parse(res.body);
  assert.equal(body.state, 'cancel_scheduled');
  assert.deepEqual(Object.keys(body).sort(), ['daysLeft', 'endsAt', 'renewsAt', 'state']);
  assert.ok(!res.body.includes('cus_alice') && !res.body.includes('sub_alice') && !res.body.includes(ALICE));
  assert.equal(calls.cancel.length + calls.update.length, 0, 'status は書き込まない');
});

test('🔴 既存の解約予約は status を何度呼んでも変わらない（勝手に即時終了へ変えない）', async () => {
  const s = flexibleScheduled();
  behavior.subsByCustomer.cus_alice = [s];
  for (let i = 0; i < 3; i += 1) await call({ cookie: cookieFor(ALICE) });
  assert.equal(calls.cancel.length + calls.update.length, 0);
  assert.equal(s.status, 'active');
  assert.equal(s.cancel_at, PERIOD_END);
});

test('status: Stripe 顧客が無ければ none（銀行振込・未加入）', async () => {
  behavior.customers = [];
  const res = await call({ cookie: cookieFor(ALICE) });
  assert.equal(JSON.parse(res.body).state, 'none');
});

/* ---------- 関数: withdraw ---------- */

test('E2E: 退会 → 即時終了（期間末キャンセルを作らない）→ この端末は free の Cookie へ', async () => {
  behavior.subsByCustomer.cus_alice = [continuing()];
  const res = await withdraw(cookieFor(ALICE), { subscription: 'sub_mallory' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { state: 'none', withdrawn: true });

  assert.equal(calls.cancel.length, 1);
  assert.equal(calls.cancel[0].id, 'sub_alice', '本文の subscription を使ってはいけない');
  assert.deepEqual(calls.cancel[0].params, withdrawCancelParams());
  assert.equal(calls.cancel[0].opts.idempotencyKey, 'ki-withdraw-sub_alice');
  assert.equal(calls.update.length, 0, '🔴 cancel_at / cancel_at_period_end の更新（予約）を作ってはいけない');

  assert.equal(tierInSetCookie(res), TIER.FREE, 'この端末の Cookie が free になっていない');
  assert.match(res.headers['Set-Cookie'], /HttpOnly/);
  assert.ok(!res.body.includes('cus_alice') && !res.body.includes(ALICE));
});

test('🔴 未来の期限が残っていても、退会後は別端末の有料セッションも有料ページへ入れない', async () => {
  // 退会前に別の端末でログインしていた（premium・期限は 7 日先）
  const otherDevice = cookieFor(ALICE, TIER.PREMIUM, { nowMs: Date.now() - 60_000 });
  assert.equal((await paidPageAccess(otherDevice)).redirect, null, '前提: 退会前は入れる');

  behavior.subsByCustomer.cus_alice = [continuing()];
  assert.equal((await withdraw(cookieFor(ALICE, TIER.PREMIUM, { nowMs: Date.now() - 30_000 }))).statusCode, 200);

  const after = await paidPageAccess(otherDevice);
  assert.equal(after.ent.tier, TIER.FREE);
  assert.equal(after.ent.showBetting, false);
  assert.equal(after.ent.showMarks, true, '無料会員の権利（印）は残る');
  assert.equal(after.redirect, '/free-prediction/nankan', '🔴 URL 直打ちで有料ページへ入れてしまう');
});

test('🔴 退会記録は他の会員の有料セッションに影響しない', async () => {
  const bob = cookieFor('bob@example.com', TIER.PREMIUM, { nowMs: Date.now() - 60_000 });
  behavior.subsByCustomer.cus_alice = [continuing()];
  await withdraw(cookieFor(ALICE));
  assert.equal((await paidPageAccess(bob)).redirect, null);
});

test('🔴 他会員の契約を操作できない（ki_email が一致しない契約は終了しない）', async () => {
  behavior.subsByCustomer.cus_alice = [continuing('sub_mallory', MALLORY)];
  const res = await withdraw(cookieFor(ALICE));
  assert.equal(res.statusCode, 409);
  assert.equal(JSON.parse(res.body).error, 'ownership_mismatch');
  assert.equal(calls.cancel.length, 0);
  assert.equal(blobs.store.size, 0, '退会記録も書かない');
  assert.equal(res.headers['Set-Cookie'], undefined, 'Cookie も変えない');
});

test('🔴 他人の Stripe 顧客は検索に使わない（email はセッション由来だけ）', async () => {
  behavior.subsByCustomer.cus_alice = [continuing()];
  await withdraw(cookieFor(ALICE), { email: MALLORY, customer: 'cus_mallory' });
  assert.ok(calls.customers.every((c) => c.email === ALICE));
  assert.ok(calls.subsList.every((c) => c.customer === 'cus_alice'));
});

test('🔴 有効な契約が複数なら終了しない（取り違え・二重契約は人が確認する）', async () => {
  behavior.subsByCustomer.cus_alice = [continuing('s1'), continuing('s2')];
  const res = await withdraw(cookieFor(ALICE));
  assert.equal(res.statusCode, 409);
  assert.equal(JSON.parse(res.body).error, 'multiple_subscriptions');
  assert.equal(calls.cancel.length, 0);
});

test('🔴 同じ email の顧客が複数でも取りこぼさない（二重契約を見落とさない）', async () => {
  behavior.customers = [{ id: 'cus_alice' }, { id: 'cus_alice2' }];
  behavior.subsByCustomer = { cus_alice: [continuing('s1')], cus_alice2: [continuing('s2')] };
  const res = await withdraw(cookieFor(ALICE));
  assert.equal(res.statusCode, 409);
  assert.equal(calls.cancel.length, 0);
});

test('🔴 二重クリック: 2 回目は Stripe に書かず成功を返す（二重処理しない）', async () => {
  behavior.subsByCustomer.cus_alice = [continuing()];
  const cookie = cookieFor(ALICE);
  const a = await withdraw(cookie);
  const b = await withdraw(cookie);
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  assert.equal(JSON.parse(b.body).already, true);
  assert.equal(calls.cancel.length, 1, '🔴 2 回目の終了要求を出した');
  assert.equal(tierInSetCookie(b), TIER.FREE);
});

test('🔴 同時の二重送信でも Stripe には同じ冪等キーで届く（Stripe 側で 1 回に畳まれる）', async () => {
  behavior.subsByCustomer.cus_alice = [continuing()];
  const cookie = cookieFor(ALICE);
  await Promise.all([withdraw(cookie), withdraw(cookie)]);
  const keys = calls.cancel.map((c) => c.opts.idempotencyKey);
  assert.ok(keys.length >= 1);
  assert.ok(keys.every((k) => k === 'ki-withdraw-sub_alice'));
});

test('🔴 契約が無い（銀行振込・未加入・別の理由で終了済み）なら 409 で何もしない', async () => {
  behavior.subsByCustomer.cus_alice = [{ ...continuing(), status: 'canceled', cancellation_details: { comment: 'other' } }];
  const res = await withdraw(cookieFor(ALICE));
  assert.equal(res.statusCode, 409);
  assert.equal(JSON.parse(res.body).error, 'no_active_subscription');
  assert.equal(calls.cancel.length, 0);
  assert.equal(res.headers['Set-Cookie'], undefined);
});

test('🔴 Stripe の終了に失敗したら 502 で、権限・記録・Cookie を何も変えない', async () => {
  behavior.subsByCustomer.cus_alice = [continuing()];
  behavior.throwOn = 'cancel';
  const res = await withdraw(cookieFor(ALICE));
  assert.equal(res.statusCode, 502);
  assert.ok(!/exploded|secret detail/.test(res.body));
  assert.equal(blobs.store.size, 0);
  assert.equal(res.headers['Set-Cookie'], undefined);
});

test('🔴 Stripe が終了状態を返さなければ 502（終わったことにしない）', async () => {
  behavior.subsByCustomer.cus_alice = [continuing()];
  behavior.cancelResult = { ...continuing(), status: 'active' };
  const res = await withdraw(cookieFor(ALICE));
  assert.equal(res.statusCode, 502);
  assert.equal(res.headers['Set-Cookie'], undefined);
});

test('退会記録（Blobs）が書けなくても、Stripe は終了済みなので成功を返し、この端末は free にする', async () => {
  behavior.subsByCustomer.cus_alice = [continuing()];
  blobs.broken = true;
  const res = await withdraw(cookieFor(ALICE));
  assert.equal(res.statusCode, 200);
  assert.equal(tierInSetCookie(res), TIER.FREE);
});

test('🔴 既存の解約予約中でも、本人が確定したときだけ即時終了する', async () => {
  behavior.subsByCustomer.cus_alice = [flexibleScheduled()];
  const res = await withdraw(cookieFor(ALICE));
  assert.equal(res.statusCode, 200);
  assert.equal(calls.cancel.length, 1);
  assert.equal(calls.update.length, 0);
});

test('🔴 Stripe 例外は 502（内容を返さない）', async () => {
  behavior.throwOn = 'customers';
  const res = await withdraw(cookieFor(ALICE));
  assert.equal(res.statusCode, 502);
  assert.ok(!/exploded|secret detail/.test(res.body));
});

test('許可外の Origin へ CORS を開かない', async () => {
  const res = await call({ cookie: cookieFor(ALICE), origin: 'https://evil.example' });
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://keiba-intelligence.jp');
});

/* ---------- 静的検査: 予約停止・取り消しの導線が残っていない ---------- */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const MYPAGE = read('src/pages/mypage.astro');
const PRICING = read('src/pages/pricing.astro');
const FN = read('netlify/functions/stripe-subscription.js');

function confirmBlock() {
  const i = MYPAGE.indexOf('id="mp-withdraw-confirm"');
  return MYPAGE.slice(i, MYPAGE.indexOf('</section>', i));
}

test('🔴 マイページに「退会する」→ 確認画面 → 「退会を確定する」の 2 段階がある', () => {
  assert.match(MYPAGE, /id="mp-withdraw-open"[^>]*>退会する</);
  const block = confirmBlock();
  assert.ok(block.length > 200, '確認画面が見つからない');
  assert.match(block.slice(0, block.indexOf('>')), /hidden/, '確認画面は最初から開いていてはいけない');
  assert.match(block, /id="mp-withdraw-submit"[^>]*>退会を確定する</);
  assert.match(block, /退会しない（戻る）/);
  // 確定の送信は 1 か所だけ（「退会する」で直接送らない）
  assert.equal(MYPAGE.split("action: 'withdraw'").length - 1, 1);
  assert.match(MYPAGE, /confirm: true/);
});

test('🔴 確認画面に「残り期間があっても即時利用できなくなる」ことを明示する（MK 指定文言）', () => {
  const block = confirmBlock();
  assert.ok(block.includes('退会すると、現在の利用期限を待たずにすぐ利用できなくなります。'));
  assert.ok(block.includes('残り期間の利用を希望する場合は、退会手続きを行わずそのままご利用ください。'));
  assert.ok(block.includes('契約上の利用期間・請求期間が残っていても、退会を確定した時点で'));
  // 確定ボタンより前に書かれていること
  assert.ok(block.indexOf('すぐ利用できなくなります') < block.indexOf('id="mp-withdraw-submit"'));
});

test('🔴 退会の確認画面に引き止めの値引き・期限煽り・成績訴求を入れない', () => {
  const block = confirmBlock();
  for (const w of ['割引', '値引', 'クーポン', 'OFF', '今だけ', '限定', '損', '回収率', '的中率']) {
    assert.equal(block.includes(w), false, `退会の確認画面に「${w}」を入れてはいけない`);
  }
});

test('🔴 二重クリック対策（送信中フラグとボタン無効化）がある', () => {
  assert.match(MYPAGE, /if \(withdrawing\) return;/);
  assert.match(MYPAGE, /wSubmit\.disabled = true;/);
});

test('🔴 予約停止・予約取り消しの CTA / API が残っていない', () => {
  for (const w of ['解約予約を取り消', 'mp-resume', '期間末で解約', '次回更新から停止', '予約停止']) {
    assert.equal(MYPAGE.includes(w), false, `mypage に「${w}」が残っている`);
    assert.equal(PRICING.includes(w), false, `pricing に「${w}」が残っている`);
  }
  assert.equal(/'resume'/.test(FN), false, 'stripe-subscription に resume が残っている');
  assert.equal(/cancel_at_period_end\s*:\s*true|cancel_at\s*:/.test(FN), false, '期間末キャンセルを作るコードがある');
});

test('🔴 functions のどこにも期間末キャンセルを「作る」コードが無い', () => {
  const dir = join(ROOT, 'netlify/functions');
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (!statSync(p).isFile() || !f.endsWith('.js')) continue;
    const src = readFileSync(p, 'utf8');
    assert.equal(/cancel_at_period_end\s*:\s*true/.test(src), false, `${f} が cancel_at_period_end: true を送っている`);
    assert.equal(/subscriptions\.update\([^)]*cancel_at/.test(src), false, `${f} が cancel_at を設定している`);
  }
});

test('🔴 お支払い管理ページの案内から「解約」を外す（ポータルでは解約できない）', () => {
  assert.match(MYPAGE, /id="mp-portal"/);
  assert.match(MYPAGE, /お支払い方法の変更・請求履歴の確認は、お支払い管理ページから行えます。/);
  const billing = MYPAGE.slice(MYPAGE.indexOf('<!-- お支払い -->'), MYPAGE.indexOf('id="mp-account"'));
  assert.equal(billing.includes('解約'), false);
  assert.equal(PRICING.includes('お支払い方法の変更・解約はこちら'), false);
});

test('🔴 マイページで解約を想起させる追加文言を出さない（2026-10-06 MK 決定・維持）', () => {
  assert.equal(MYPAGE.includes('解約はいつでも可能'), false);
  assert.equal(MYPAGE.includes('mp-billing-sub'), false);
});

test('🔴 有料ページ・マイページ・料金ページは退会記録を見る経路で認可する', () => {
  for (const p of ['src/pages/prediction/nankan/index.astro', 'src/pages/prediction/jra/index.astro',
    'src/pages/prediction/[slug].astro', 'src/pages/mypage.astro', 'src/pages/pricing.astro']) {
    const src = read(p);
    assert.match(src, /await checkedEntitlementFromAstro\(/, `${p} が退会記録を見ていない`);
    assert.equal(/=\s*entitlementFromAstro\(/.test(src), false, `${p} が退会記録を見ない経路を使っている`);
  }
  for (const p of ['netlify/functions/get-session.js', 'netlify/functions/gemini-race-analysis.js']) {
    assert.match(read(p), /applyRevocation\(/, `${p} が退会記録を見ていない`);
  }
  for (const p of ['netlify/functions/refresh-session.js', 'netlify/functions/verify-magic-link.js']) {
    assert.match(read(p), /tierForNewSession\(/, `${p} が退会直後に有料を発行してしまう`);
  }
});

test('🔴 GA4 計測に個人情報を載せない', () => {
  const tracks = MYPAGE.match(/track\('[^)]*\)/g) || [];
  assert.ok(tracks.some((t) => t.includes('ki_withdraw_confirm')));
  assert.equal(tracks.some((t) => t.includes('ki_resume')), false);
  for (const t of tracks) assert.ok(!/email|ent\.|customer|sub_/.test(t), t);
});
