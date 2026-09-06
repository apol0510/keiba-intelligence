/**
 * stripeCheckout.test.mjs — Checkout 開始 / カスタマーポータルの E2E（ネットワーク不使用）
 *
 * 実行: npm run test:stripe（astro-site 直下から）
 *
 * 🔴 本番 Stripe を叩かない。`stripe` モジュールを差し替えて
 *    **関数が Stripe へ渡す内容**と **認可・fail-closed** を検証する。
 *    Checkout 画面と実決済は外部 write のため対象外。
 *
 * 固定する不変条件（docs/RENEWAL_2026_08.md §6.2）:
 *   1. POST のみ・**ログイン必須**
 *   2. 🔴 email は **セッション由来のものだけ**を使う（クライアントの申告を信用しない）
 *   3. 秘密鍵 / Price ID 未設定は 503（推測で課金しない）
 *   4. metadata に ki_plan / ki_email を入れる（webhook が tier を復元できる）
 *   5. Stripe のエラー内容を呼び出し元へ返さない
 */

import { test, mock, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { TIER } from '../auth/tiers.js';
import { signSession, SESSION_COOKIE_NAME } from '../auth/session.js';

const SECRET_KEY = 'sk_test_only_do_not_use_in_production';
const SESSION_SECRET = 'session-secret-for-test-only';
const PRICE_ID = 'price_test_premium';
const ALICE = 'alice@example.com';
const NOW = Date.parse('2026-09-01T00:00:00Z');

/** Stripe へ渡された内容を記録する。 */
const calls = { checkout: [], customers: [], portal: [] };
const behavior = { checkoutUrl: 'https://checkout.stripe.test/s/1', customers: [], portalUrl: 'https://portal.stripe.test/p/1', throwOn: null };

before(() => {
  process.env.SESSION_SIGNING_SECRET = SESSION_SECRET;

  mock.module('stripe', {
    defaultExport: class StripeStub {
      constructor(key) { this.key = key; }
      checkout = {
        sessions: {
          create: async (params) => {
            calls.checkout.push(params);
            if (behavior.throwOn === 'checkout') throw new Error('stripe exploded: card_declined');
            return { id: 'cs_test', url: behavior.checkoutUrl };
          },
        },
      };
      customers = {
        list: async (params) => {
          calls.customers.push(params);
          if (behavior.throwOn === 'customers') throw new Error('stripe exploded');
          return { data: behavior.customers };
        },
      };
      billingPortal = {
        sessions: {
          create: async (params) => {
            calls.portal.push(params);
            if (behavior.throwOn === 'portal') throw new Error('stripe exploded');
            return { url: behavior.portalUrl };
          },
        },
      };
    },
  });
});

/**
 * `STRIPE_PORTAL_RETURN_URL` の fixture。
 *
 * 🔴 **本番 URL を書かない。** Netlify の Secret Scanning は
 *    「production env の値」と「リポジトリ内の文字列」の一致を検出する。
 *    値が秘密かどうかは問わない。本番 URL を書くと、その env を production に
 *    設定した瞬間にビルドが `exit code 2` で落ちる（2026-09-06 に発生）。
 *    🔴 `SECRETS_SCAN_OMIT_*` で回避しない。**非本番の fixture を使う**方を守る。
 */
const PORTAL_RETURN_URL_FIXTURE = 'https://portal-return.invalid/mypage';

beforeEach(() => {
  calls.checkout = []; calls.customers = []; calls.portal = [];
  behavior.checkoutUrl = 'https://checkout.stripe.test/s/1';
  behavior.customers = [];
  behavior.portalUrl = 'https://portal.stripe.test/p/1';
  behavior.throwOn = null;
  process.env['STRIPE_SECRET_KEY'] = SECRET_KEY;
  process.env['STRIPE_PRICE_PREMIUM'] = PRICE_ID;
  process.env['STRIPE_PORTAL_RETURN_URL'] = PORTAL_RETURN_URL_FIXTURE;
});

function cookieFor(email, tier = TIER.FREE, secret = SESSION_SECRET) {
  const s = signSession({ email, tier, secret, nowMs: Date.now() });
  assert.ok(s.ok, s.reason);
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(s.token)}`;
}

async function checkout({ cookie, body = { plan: 'premium' }, method = 'POST', origin } = {}) {
  const { handler } = await import('../../../netlify/functions/stripe-create-checkout.js');
  return handler({
    httpMethod: method,
    headers: { cookie: cookie ?? undefined, origin, host: 'keiba-intelligence.jp' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function portal({ cookie, method = 'POST' } = {}) {
  const { handler } = await import('../../../netlify/functions/stripe-portal.js');
  return handler({
    httpMethod: method,
    headers: { cookie: cookie ?? undefined, host: 'keiba-intelligence.jp' },
    body: '{}',
  });
}

/* ---------- Checkout: 認可 ---------- */

test('🔴 未ログインでは Checkout を開始できない（401・Stripe を叩かない）', async () => {
  const res = await checkout({ cookie: null });
  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(res.body).error, 'login_required');
  assert.equal(calls.checkout.length, 0);
});

test('🔴 改竄された Cookie では開始できない', async () => {
  const res = await checkout({ cookie: cookieFor(ALICE, TIER.PREMIUM, 'attacker-secret') });
  assert.equal(res.statusCode, 401);
  assert.equal(calls.checkout.length, 0);
});

test('🔴 署名鍵が無ければ開始できない（fail-closed）', async () => {
  const cookie = cookieFor(ALICE);
  delete process.env.SESSION_SIGNING_SECRET;
  const res = await checkout({ cookie });
  process.env.SESSION_SIGNING_SECRET = SESSION_SECRET;
  assert.equal(res.statusCode, 401);
  assert.equal(calls.checkout.length, 0);
});

test('POST 以外・壊れた本文は Stripe を叩かない', async () => {
  assert.equal((await checkout({ cookie: cookieFor(ALICE), method: 'GET' })).statusCode, 405);
  assert.equal((await checkout({ cookie: cookieFor(ALICE), method: 'OPTIONS' })).statusCode, 200);
  assert.equal((await checkout({ cookie: cookieFor(ALICE), body: '{壊れ' })).statusCode, 400);
  assert.equal(calls.checkout.length, 0);
});

/* ---------- Checkout: 正常系と渡す内容 ---------- */

test('E2E: ログイン済みなら Checkout URL が返り、metadata が webhook と噛み合う', async () => {
  const res = await checkout({ cookie: cookieFor(ALICE) });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).url, behavior.checkoutUrl);

  const p = calls.checkout[0];
  assert.equal(p.mode, 'subscription');
  assert.deepEqual(p.line_items, [{ price: PRICE_ID, quantity: 1 }]);
  assert.deepEqual(p.metadata, { ki_plan: 'premium', ki_email: ALICE, ki_price_id: PRICE_ID });
  assert.deepEqual(p.subscription_data.metadata, { ki_plan: 'premium', ki_email: ALICE, ki_price_id: PRICE_ID });
  // 🔴 metadata の Price ID は line_items と同じ（＝サーバー側で確定した値）
  assert.equal(p.metadata.ki_price_id, p.line_items[0].price);
  assert.equal(p.customer_email, ALICE);
  assert.match(p.success_url, /\/mypage\?checkout=success$/);
  assert.match(p.cancel_url, /\/pricing\?checkout=cancelled$/);
  // 🔴 金額をコードから送らない（請求額の正本は Stripe の Price）
  assert.equal(p.line_items[0].price_data, undefined);
  assert.equal(p.amount, undefined);
});

test('🔴 ki_price_id はサーバー側で確定した priceId（クライアント申告を使わない）', async () => {
  const res = await checkout({
    cookie: cookieFor(ALICE),
    // クライアントが別の Price を申告してくる
    body: {
      plan: 'premium',
      price: 'price_attacker', priceId: 'price_attacker',
      ki_price_id: 'price_attacker',
      metadata: { ki_price_id: 'price_attacker' },
    },
  });
  assert.equal(res.statusCode, 200);
  const p = calls.checkout[0];
  assert.equal(p.metadata.ki_price_id, PRICE_ID, '🔴 クライアント申告の Price を使っている');
  assert.equal(p.line_items[0].price, PRICE_ID);
  assert.equal(JSON.stringify(p).includes('price_attacker'), false, '🔴 申告値が混入している');
});

test('🔴 Price ID が env に無ければ Checkout を作らない（推測補完しない）', async () => {
  const saved = process.env['STRIPE_PRICE_PREMIUM'];
  delete process.env['STRIPE_PRICE_PREMIUM'];
  try {
    calls.checkout = [];
    const res = await checkout({ cookie: cookieFor(ALICE) });
    assert.equal(res.statusCode, 503, 'Price 未設定で課金導線が開いている');
    assert.equal(JSON.parse(res.body).error, 'plan_not_configured');
    assert.equal(calls.checkout.length, 0, 'Stripe を叩いている');
  } finally {
    if (saved !== undefined) process.env['STRIPE_PRICE_PREMIUM'] = saved;
  }
});

test('🔴 email はセッション由来だけ。本文の申告を無視する', async () => {
  const res = await checkout({
    cookie: cookieFor(ALICE),
    body: { plan: 'premium', email: 'victim@example.com', customer_email: 'victim@example.com' },
  });
  assert.equal(res.statusCode, 200);
  const p = calls.checkout[0];
  assert.equal(p.customer_email, ALICE, '他人の email で購入できてしまう');
  assert.equal(p.metadata.ki_email, ALICE);
  assert.equal(JSON.stringify(p).includes('victim@example.com'), false);
});

test('🔴 未知のプランは 400（保留中のライトも開始できない）', async () => {
  for (const plan of ['light', 'admin', '', undefined, 123]) {
    calls.checkout = [];
    const res = await checkout({ cookie: cookieFor(ALICE), body: { plan } });
    assert.equal(res.statusCode, 400, `plan=${plan}`);
    assert.equal(calls.checkout.length, 0);
  }
});

test('🔴 秘密鍵 / Price ID 未設定は 503（推測で課金しない）', async () => {
  delete process.env['STRIPE_SECRET_KEY'];
  let res = await checkout({ cookie: cookieFor(ALICE) });
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).error, 'billing_not_configured');

  process.env['STRIPE_SECRET_KEY'] = SECRET_KEY;
  delete process.env['STRIPE_PRICE_PREMIUM'];
  res = await checkout({ cookie: cookieFor(ALICE) });
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).error, 'plan_not_configured');
  assert.equal(calls.checkout.length, 0);
});

test('🔴 Stripe の例外内容を呼び出し元へ返さない', async () => {
  behavior.throwOn = 'checkout';
  const res = await checkout({ cookie: cookieFor(ALICE) });
  assert.equal(res.statusCode, 502);
  assert.equal(JSON.parse(res.body).error, 'checkout_unavailable');
  assert.ok(!/card_declined|exploded|Error:/i.test(res.body));
});

test('URL が返らなければ 502', async () => {
  behavior.checkoutUrl = undefined;
  const res = await checkout({ cookie: cookieFor(ALICE) });
  assert.equal(res.statusCode, 502);
});

test('許可外の Origin へ CORS を開かない', async () => {
  const res = await checkout({ cookie: cookieFor(ALICE), origin: 'https://evil.example' });
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://keiba-intelligence.jp');
});

/* ---------- Customer Portal（解約導線） ---------- */

test('🔴 未ログインではポータルを開けない', async () => {
  const res = await portal({ cookie: null });
  assert.equal(res.statusCode, 401);
  assert.equal(calls.customers.length, 0);
});

test('E2E: 有料会員はポータル URL を受け取れる（解約導線）', async () => {
  behavior.customers = [{ id: 'cus_alice' }];
  const res = await portal({ cookie: cookieFor(ALICE, TIER.PREMIUM) });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).url, behavior.portalUrl);

  // 🔴 顧客はセッションの email で引く（クライアント申告を使わない）
  assert.deepEqual(calls.customers[0], { email: ALICE, limit: 1 });
  assert.equal(calls.portal[0].customer, 'cus_alice');
  assert.equal(calls.portal[0].return_url, PORTAL_RETURN_URL_FIXTURE);
});

test('🔴 Stripe 顧客が無ければ 404（他人の顧客を開かせない）', async () => {
  behavior.customers = [];
  const res = await portal({ cookie: cookieFor(ALICE, TIER.PREMIUM) });
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error, 'no_subscription');
  assert.equal(calls.portal.length, 0);
});

test('🔴 秘密鍵未設定は 503 / Stripe 例外は 502（内容を返さない）', async () => {
  delete process.env['STRIPE_SECRET_KEY'];
  assert.equal((await portal({ cookie: cookieFor(ALICE, TIER.PREMIUM) })).statusCode, 503);

  process.env['STRIPE_SECRET_KEY'] = SECRET_KEY;
  behavior.customers = [{ id: 'cus_alice' }];
  behavior.throwOn = 'portal';
  const res = await portal({ cookie: cookieFor(ALICE, TIER.PREMIUM) });
  assert.equal(res.statusCode, 502);
  assert.ok(!/exploded|Error:/i.test(res.body));
});
