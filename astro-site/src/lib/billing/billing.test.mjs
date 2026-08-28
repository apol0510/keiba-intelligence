/**
 * billing.test.mjs — 課金プラン定義と KMA 連携の不変条件テスト
 *
 * 実行: node --test src/lib/billing/billing.test.mjs （astro-site 直下から）
 *
 * 固定する不変条件（docs/RENEWAL_2026_08.md §6 / §8）:
 *   1. **価格をコードに書かない**（金額の正本は Stripe の Price）
 *   2. Price ID 未設定のプランは購入導線を出さない
 *   3. Stripe 秘密鍵が無ければ課金経路は動かない（fail-closed）
 *   4. KMA 連携は既定 disabled で、フラグが立つまで一切通信しない
 *   5. KMA の write は二重フラグの両方が true のときだけ要求する
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PLANS, planById, priceIdFor, isPurchasable, publicPlanView, publicPlans,
  planFromMetadata, hasStripeSecret, STRIPE_ENV,
} from './plans.js';
import { TIER } from '../auth/tiers.js';
import {
  resolveKmaConfig, buildEventId, sendKmaEvent, notifyKma, KMA_RESULT,
} from '../kma/client.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf-8');
const codeOf = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

/* ---------- 1. 価格をコードに書かない ---------- */

test('plans.js に金額が書かれていない（金額の正本は Stripe）', () => {
  const src = codeOf('src/lib/billing/plans.js');
  assert.ok(!/\bunit_amount\b/.test(src), 'plans.js が金額を扱っている');
  assert.ok(!/[¥￥]\s*\d/.test(src), 'plans.js に円建ての金額が書かれている');
  assert.ok(!/\b\d{3,6}\s*円/.test(src), 'plans.js に金額が書かれている');
  for (const plan of PLANS) {
    assert.equal(plan.price, undefined, `${plan.id} に price が定義されている`);
    assert.equal(plan.amount, undefined, `${plan.id} に amount が定義されている`);
  }
});

test('pricing ページが金額をハードコードしていない', () => {
  const src = codeOf('src/pages/pricing.astro');
  // 旧実装の固定価格（¥88,000 / ¥66,000 等）が残っていないこと
  assert.ok(!/88,?000/.test(src), 'pricing に固定価格 88,000 が残っている');
  assert.ok(!/66,?000/.test(src), 'pricing に固定価格 66,000 が残っている');
  assert.ok(!/\b[1-9],?\d{2,3}\s*円\/月/.test(src), 'pricing に月額の固定価格が書かれている');
  // 価格は Stripe から取得する
  assert.match(src, /stripe-prices/, 'Stripe から価格を取得していない');
});

/* ---------- 2. Price ID と購入可否 ---------- */

test('planById / priceIdFor: 未知のプラン・未設定の Price ID を通さない', () => {
  assert.equal(planById('premium').tier, TIER.PREMIUM);
  assert.equal(planById('light').tier, TIER.LIGHT);
  assert.equal(planById('unknown'), null);
  assert.equal(planById(''), null);

  const plan = planById('light');
  assert.equal(priceIdFor(plan, {}), null);
  assert.equal(priceIdFor(plan, { STRIPE_PRICE_LIGHT: '  ' }), null);
  assert.equal(priceIdFor(plan, { STRIPE_PRICE_LIGHT: ' price_abc ' }), 'price_abc');
  assert.equal(priceIdFor(null, { STRIPE_PRICE_LIGHT: 'price_abc' }), null);
});

test('isPurchasable / publicPlanView: Price ID が無ければ購入導線を出さない', () => {
  const plan = planById('premium');
  assert.equal(isPurchasable(plan, {}), false);
  assert.equal(publicPlanView(plan, {}).purchasable, false);
  assert.equal(publicPlanView(plan, { STRIPE_PRICE_PREMIUM: 'price_x' }).purchasable, true);
});

test('publicPlanView: Price ID そのものを画面へ渡さない', () => {
  const v = publicPlanView(planById('premium'), { STRIPE_PRICE_PREMIUM: 'price_secret' });
  const json = JSON.stringify(v);
  assert.ok(!json.includes('price_secret'), 'Price ID が画面向けデータに漏れている');
  assert.equal(v.priceEnv, undefined);
});

test('publicPlans: 定義したプランをすべて返す', () => {
  const list = publicPlans({});
  assert.equal(list.length, PLANS.length);
  assert.deepEqual(list.map((p) => p.id).sort(), ['light', 'premium']);
});

test('planFromMetadata: webhook が metadata から tier を復元できる', () => {
  assert.equal(planFromMetadata({ ki_plan: 'premium' }).tier, TIER.PREMIUM);
  assert.equal(planFromMetadata({ ki_plan: 'light' }).tier, TIER.LIGHT);
  assert.equal(planFromMetadata({}), null);
  assert.equal(planFromMetadata(null), null);
  assert.equal(planFromMetadata({ ki_plan: 'admin' }), null);
});

/* ---------- 3. Stripe 秘密鍵の fail-closed ---------- */

test('hasStripeSecret: 未設定・空白は false', () => {
  assert.equal(hasStripeSecret({}), false);
  assert.equal(hasStripeSecret({ [STRIPE_ENV.SECRET_KEY]: '   ' }), false);
  assert.equal(hasStripeSecret({ [STRIPE_ENV.SECRET_KEY]: 'sk_test_x' }), true);
});

test('Stripe Functions: 秘密鍵・署名の未設定で止まる配線がある', () => {
  const checkout = read('netlify/functions/stripe-create-checkout.js');
  assert.match(checkout, /hasStripeSecret\(process\.env\)/);
  assert.match(checkout, /billing_not_configured/);
  assert.match(checkout, /login_required/, 'ログイン必須になっていない');
  assert.match(checkout, /resolveEntitlement\(/, 'セッションから email を取っていない');

  const webhook = read('netlify/functions/stripe-webhook.js');
  assert.match(webhook, /constructEvent\(/, '署名検証をしていない');
  assert.match(webhook, /STRIPE_WEBHOOK_SECRET|WEBHOOK_SECRET/);
  assert.match(webhook, /alreadyProcessed\(/, '冪等性の配線が無い');

  const portal = read('netlify/functions/stripe-portal.js');
  assert.match(portal, /resolveEntitlement\(/);
  assert.match(portal, /login_required/);
});

test('checkout: クライアント申告の email を使っていない', () => {
  const src = codeOf('netlify/functions/stripe-create-checkout.js');
  assert.ok(!/body\.email/.test(src), 'リクエスト body の email を使っている');
  assert.match(src, /customer_email:\s*ent\.email/, 'セッション由来の email を使っていない');
});

/* ---------- 4. KMA 連携の fail-closed ---------- */

test('resolveKmaConfig: 既定は disabled', () => {
  const cfg = resolveKmaConfig({});
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.writeEnabled, false);
  assert.equal(cfg.baseUrl, null);
  assert.equal(cfg.adminToken, null);
});

test('resolveKmaConfig: 明示的な "true" のときだけ有効', () => {
  assert.equal(resolveKmaConfig({ KMA_ENROLL_ENABLED: 'TRUE' }).enabled, true);
  assert.equal(resolveKmaConfig({ KMA_ENROLL_ENABLED: '1' }).enabled, false);
  assert.equal(resolveKmaConfig({ KMA_ENROLL_ENABLED: 'yes' }).enabled, false);
  assert.equal(resolveKmaConfig({ KMA_BASE_URL: 'https://x.example/' }).baseUrl, 'https://x.example');
});

test('sendKmaEvent: disabled のとき一切通信しない', async () => {
  let called = 0;
  const r = await sendKmaEvent({
    kind: 'signup', identity: 'a@b.c', eventId: 'e1',
    env: {}, fetchImpl: () => { called += 1; },
  });
  assert.equal(r.result, KMA_RESULT.DISABLED);
  assert.equal(called, 0, 'disabled なのに fetch した');
});

test('sendKmaEvent: 設定不足でも通信しない', async () => {
  let called = 0;
  const r = await sendKmaEvent({
    kind: 'signup', identity: 'a@b.c', eventId: 'e1',
    env: { KMA_ENROLL_ENABLED: 'true' },
    fetchImpl: () => { called += 1; },
  });
  assert.equal(r.result, KMA_RESULT.NOT_CONFIGURED);
  assert.equal(called, 0);
});

test('sendKmaEvent: eventId が無ければ送らない（冪等キー必須）', async () => {
  let called = 0;
  const r = await sendKmaEvent({
    kind: 'signup', identity: 'a@b.c', eventId: '',
    env: { KMA_ENROLL_ENABLED: 'true', KMA_BASE_URL: 'https://x', KMA_ADMIN_TOKEN: 't' },
    fetchImpl: () => { called += 1; },
  });
  assert.equal(r.result, KMA_RESULT.INVALID_INPUT);
  assert.equal(called, 0);
});

test('sendKmaEvent: write フラグが無ければ dry-run で送る', async () => {
  let body = null;
  await sendKmaEvent({
    kind: 'signup', identity: 'a@b.c', eventId: 'e1',
    env: { KMA_ENROLL_ENABLED: 'true', KMA_BASE_URL: 'https://x', KMA_ADMIN_TOKEN: 't' },
    fetchImpl: async (_url, init) => { body = JSON.parse(init.body); return { ok: true, status: 200 }; },
  });
  assert.equal(body.mode, 'dry-run');
  assert.equal(body.brand, 'keiba-intelligence');
  assert.equal(body.eventId, 'e1');
});

test('sendKmaEvent: 二重フラグが揃ったときだけ write を要求する', async () => {
  let body = null;
  await sendKmaEvent({
    kind: 'signup', identity: 'a@b.c', eventId: 'e1',
    env: {
      KMA_ENROLL_ENABLED: 'true', KMA_ENROLL_WRITE_ENABLED: 'true',
      KMA_BASE_URL: 'https://x', KMA_ADMIN_TOKEN: 't',
    },
    fetchImpl: async (_url, init) => { body = JSON.parse(init.body); return { ok: true, status: 200 }; },
  });
  assert.equal(body.mode, 'write');
});

test('notifyKma: 通信が失敗しても throw しない（上流処理を壊さない）', async () => {
  const r = await notifyKma({
    kind: 'signup', identity: 'a@b.c', eventId: 'e1',
    env: { KMA_ENROLL_ENABLED: 'true', KMA_BASE_URL: 'https://x', KMA_ADMIN_TOKEN: 't' },
    fetchImpl: async () => { throw new Error('network down'); },
  });
  assert.equal(r.result, KMA_RESULT.FAILED);
});

test('buildEventId: 同じ出来事からは同じ id（KMA 側で冪等になる）', () => {
  const a = buildEventId({ kind: 'signup', identityKey: 'tok', occurredAt: '2026-08-28T10:00:00Z' });
  const b = buildEventId({ kind: 'signup', identityKey: 'tok', occurredAt: '2026-08-28T23:59:59Z' });
  assert.equal(a, b);
  assert.ok(!a.includes('@'), 'eventId にメールアドレスを含めている');
});

test('KMA クライアントが token をログへ出さない', () => {
  const src = codeOf('src/lib/kma/client.js');
  assert.ok(!/console\.log\([^)]*adminToken/.test(src), 'token をログへ出している');
  assert.ok(!/console\.[a-z]+\([^)]*identity/.test(src), 'メールアドレスをログへ出している');
});
