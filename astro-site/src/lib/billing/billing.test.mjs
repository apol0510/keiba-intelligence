/**
 * billing.test.mjs — 課金プラン定義と KMA 連携の不変条件テスト
 *
 * 実行: node --test src/lib/billing/billing.test.mjs （astro-site 直下から）
 *
 * 固定する不変条件（docs/RENEWAL_2026_08.md §6 / §8）:
 *   1. **請求額の正本は Stripe の Price**。コードの金額は **表示用**に限る
 *      （2026-08-30 改定。正規 ¥5,000 の取り消し線 ＋ 割引 ¥3,980 を出すため）
 *   2. Price ID 未設定のプランは購入導線を出さない
 *   2-b. 🔴 **月額はプレミアム 1 本のみ**。ライトは保留（導線を出さない）
 *   2-c. 🔴 **会場で分けるプラン（venueAccess）を持たない**
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
  MONTHLY_LIST_PRICE_YEN, MONTHLY_PRICE_YEN, BANK_YEARLY_PRICE_YEN,
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

test('コードの金額は表示用のみ。請求額は Stripe から取る', () => {
  const src = codeOf('src/lib/billing/plans.js');
  // 🔴 請求に使う値をコードで組み立てない
  assert.ok(!/\bunit_amount\b/.test(src), 'plans.js が Stripe の請求額を組み立てている');
  assert.ok(!/price_data/.test(src), 'plans.js が Price をコードで作っている');

  // 表示用の金額は仕様所有者の確定値と一致すること
  assert.equal(MONTHLY_LIST_PRICE_YEN, 5000);
  assert.equal(MONTHLY_PRICE_YEN, 3980);
  assert.equal(BANK_YEARLY_PRICE_YEN, 39800);
  assert.ok(MONTHLY_PRICE_YEN < MONTHLY_LIST_PRICE_YEN, '割引価格が正規価格以上になっている');

  // Checkout は Price ID だけを使う（金額を送らない）
  const checkout = codeOf('netlify/functions/stripe-create-checkout.js');
  assert.ok(!/unit_amount/.test(checkout), 'Checkout が金額をコードから送っている');
  assert.ok(/price/.test(checkout), 'Checkout が Price ID を使っていない');
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
  assert.equal(planById('unknown'), null);
  assert.equal(planById(''), null);

  const plan = planById('premium');
  assert.equal(priceIdFor(plan, {}), null);
  assert.equal(priceIdFor(plan, { STRIPE_PRICE_PREMIUM: '  ' }), null);
  assert.equal(priceIdFor(plan, { STRIPE_PRICE_PREMIUM: ' price_abc ' }), 'price_abc');
  assert.equal(priceIdFor(null, { STRIPE_PRICE_PREMIUM: 'price_abc' }), null);
});

test('🔴 月額はプレミアム 1 本のみ（ライトは保留＝導線を出さない）', () => {
  assert.equal(PLANS.length, 1, 'プランが 1 本ではない');
  assert.equal(PLANS[0].id, 'premium');
  assert.equal(planById('light'), null, 'ライトの購入導線が復活している');
});

test('🔴 プランが会場で分ける属性を持たない', () => {
  for (const plan of PLANS) {
    assert.equal(plan.venueAccess, undefined, `${plan.id} に venueAccess がある`);
  }
  const src = codeOf('src/lib/billing/plans.js');
  assert.ok(!/venueAccess/.test(src), 'plans.js に venueAccess が残っている');
});

test('🔴 廃止した訴求（詳細レポート・穴馬・優先配信）を書かない', () => {
  const banned = ['穴馬', '詳細レポート', '優先メルマガ', '優先配信'];
  for (const plan of PLANS) {
    for (const f of plan.features) {
      for (const b of banned) {
        assert.ok(!f.includes(b), `${plan.id} が実装の無い訴求を書いている: ${f}`);
      }
    }
  }
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
  assert.deepEqual(list.map((p) => p.id), ['premium']);
  // 表示用の金額は画面へ渡す（請求額は Stripe が上書きする）
  assert.equal(list[0].listPriceYen, MONTHLY_LIST_PRICE_YEN);
  assert.equal(list[0].priceYen, MONTHLY_PRICE_YEN);
});

test('planFromMetadata: webhook が metadata から tier を復元できる', () => {
  assert.equal(planFromMetadata({ ki_plan: 'premium' }).tier, TIER.PREMIUM);
  // ライトは保留したので metadata から復元できない（＝新規付与されない）
  assert.equal(planFromMetadata({ ki_plan: 'light' }), null);
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
