/**
 * qaTestClock.mjs — 経路 B（Test Clock）用の Stripe 操作
 *
 * 正本: docs/QA_STRIPE_TESTMODE_RUNBOOK.md §4.B
 *
 * 🔴 なぜこのスクリプトが要るか
 *   `stripe-create-checkout.js` は Checkout Session に `customer_email` だけを渡し、
 *   `customer` を渡さない。Stripe はこの場合 **新しい Customer を作る**ため、
 *   事前に作った Test Clock Customer へ Subscription が紐付かない。
 *   そこで **Customer を指定した Session を API で作る**。
 *
 * 🔴 この経路は `stripe-create-checkout.js` を通らない。
 *    入口の検証は経路 A が正本（同 §4.A）。
 *
 * 🔴 Session の契約は `stripe-create-checkout.js:94-113` と同じにする。
 *    差分は `customer_email` → `customer` の 1 点だけ。
 *
 * 🔴 Test Mode の鍵しか受け付けない（`sk_test_` 以外は即中止）。
 * 🔴 鍵・Price id を出力しない。
 *
 * 使い方（すべて Test Mode）:
 *   STRIPE_SECRET_KEY=sk_test_... STRIPE_PRICE_PREMIUM=price_... \
 *   QA_ORIGIN=https://qa-stripe-testmode--keiba-intelligence.netlify.app \
 *   QA_EMAIL=qa+clock@example.invalid \
 *   node scripts/qaTestClock.mjs start
 *
 *   ... カードを入力して決済したあと ...
 *
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/qaTestClock.mjs advance <clock_id> [回数]
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/qaTestClock.mjs status <clock_id>
 */

const API = 'https://api.stripe.com/v1';

const SK = process.env.STRIPE_SECRET_KEY || '';
if (!SK.startsWith('sk_test_')) {
  console.error('🔴 STRIPE_SECRET_KEY が Test Mode（sk_test_）ではない。中止。');
  process.exit(1);
}

/** Stripe は form-encoded。ネストは `a[b][c]` で表す。 */
function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function stripe(path, body) {
  const res = await fetch(`${API}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${SK}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    ...(body ? { body: form(body).toString() } : {}),
  });
  const json = await res.json();
  if (!res.ok) {
    // 🔴 Stripe のメッセージは出すが、鍵は絶対に出さない
    console.error(`🔴 Stripe ${path} が失敗: ${res.status} ${json?.error?.code || ''} ${json?.error?.message || ''}`);
    process.exit(1);
  }
  return json;
}

const cmd = process.argv[2];

if (cmd === 'start') {
  const price = process.env.STRIPE_PRICE_PREMIUM || '';
  const origin = process.env.QA_ORIGIN || '';
  const email = process.env.QA_EMAIL || '';
  for (const [name, v] of [['STRIPE_PRICE_PREMIUM', price], ['QA_ORIGIN', origin], ['QA_EMAIL', email]]) {
    if (!v) { console.error(`🔴 ${name} が未設定。中止。`); process.exit(1); }
  }
  if (!/^https:\/\/[a-z0-9-]+--[a-z0-9-]+\.netlify\.app$/.test(origin)) {
    console.error('🔴 QA_ORIGIN が branch deploy の URL ではない。本番へ戻す設定を作らない。中止。');
    process.exit(1);
  }

  // 1) Test Clock（現在時刻から始める）
  const clock = await stripe('test_helpers/test_clocks', {
    frozen_time: Math.floor(Date.now() / 1000),
    name: 'KI QA membership tenure',
  });

  // 2) その Clock に紐づく Customer
  const customer = await stripe('customers', { email, test_clock: clock.id });

  // 3) 🔴 Customer を指定した Checkout Session
  //    契約は stripe-create-checkout.js:94-113 と同じ。差分は customer_email → customer だけ。
  const meta = { ki_plan: 'premium', ki_email: email, ki_price_id: price };
  const session = await stripe('checkout/sessions', {
    mode: 'subscription',
    line_items: [{ price, quantity: 1 }],
    customer: customer.id,
    client_reference_id: email,
    allow_promotion_codes: true,
    success_url: `${origin}/mypage?checkout=success`,
    cancel_url: `${origin}/pricing?checkout=cancelled`,
    metadata: meta,
    // 🔴 これが無いと emailFromInvoice() が会員を特定できず台帳が積まれない
    subscription_data: { metadata: meta },
  });

  console.log('test_clock : ' + clock.id);
  console.log('customer   : ' + customer.id);
  console.log('session    : ' + session.id + (session.livemode ? ' 🔴 livemode' : ' (test)'));
  console.log('');
  console.log('カードを入力して決済する:');
  console.log(session.url);
  process.exit(0);
}

if (cmd === 'advance') {
  const clockId = process.argv[3];
  const times = Number(process.argv[4] || 1);
  if (!clockId || !Number.isInteger(times) || times < 1) {
    console.error('🔴 使い方: advance <clock_id> [回数]');
    process.exit(1);
  }
  let clock = await stripe(`test_helpers/test_clocks/${clockId}`);
  for (let i = 1; i <= times; i++) {
    const next = new Date(clock.frozen_time * 1000);
    next.setUTCMonth(next.getUTCMonth() + 1);
    await stripe(`test_helpers/test_clocks/${clockId}/advance`, {
      frozen_time: Math.floor(next.getTime() / 1000),
    });
    // 進み終わるまで待つ（webhook もこの間に飛ぶ）
    for (;;) {
      await new Promise((r) => setTimeout(r, 3000));
      clock = await stripe(`test_helpers/test_clocks/${clockId}`);
      if (clock.status !== 'advancing') break;
    }
    console.log(`  ${i}/${times} → ${new Date(clock.frozen_time * 1000).toISOString().slice(0, 10)} (${clock.status})`);
    if (clock.status !== 'ready') {
      console.error('🔴 Test Clock が ready にならない。中止。');
      process.exit(1);
    }
  }
  process.exit(0);
}

if (cmd === 'status') {
  const clock = await stripe(`test_helpers/test_clocks/${process.argv[3]}`);
  console.log(`  frozen_time: ${new Date(clock.frozen_time * 1000).toISOString()}  status: ${clock.status}`);
  process.exit(0);
}

console.error('🔴 使い方: start | advance <clock_id> [回数] | status <clock_id>');
process.exit(1);
