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
 * 🔴 鍵・Price id を **stdout / stderr / ログへ出さない**。
 *    Stripe のエラー本文には**伏字化された鍵が混ざることがある**ので、
 *    出力前に `redact()` で必ず伏せる。
 *
 * 🔴 **鍵をコマンドラインに書かない**（shell history に残る）。
 *    `read -s` で環境変数へ入れ、終わったら `unset` する。
 *    手順は `docs/QA_STRIPE_TESTMODE_RUNBOOK.md` §4.B。
 *
 * 使い方（すべて Test Mode。鍵は環境変数から読む）:
 *   node scripts/qaTestClock.mjs start
 *   node scripts/qaTestClock.mjs advance <clock_id> [回数]
 *   node scripts/qaTestClock.mjs status <clock_id>
 */

const API = 'https://api.stripe.com/v1';

const SK = process.env.STRIPE_SECRET_KEY || '';
if (!SK) {
  console.error('🔴 STRIPE_SECRET_KEY が未設定。');
  console.error('   🔴 コマンドラインに書かないこと（history に残る）。');
  console.error('   read -rs -p "Stripe Test secret key: " STRIPE_SECRET_KEY && export STRIPE_SECRET_KEY && echo');
  process.exit(1);
}
if (!SK.startsWith('sk_test_')) {
  // 🔴 値そのものは出さない。種別だけ伝える
  console.error('🔴 STRIPE_SECRET_KEY が Test Mode（sk_test_）ではない。中止。');
  process.exit(1);
}

/**
 * 出力から秘密になりうる文字列を伏せる。
 * 🔴 Stripe のエラー本文は "Invalid API Key provided: sk_test_51****" のように
 *    **鍵の一部を含めて返す**。そのまま出すと端末とログに残る。
 */
function redact(text) {
  return String(text == null ? '' : text)
    .split(SK).join('[REDACTED]')
    .replace(/\b(sk|rk|pk|whsec)_[A-Za-z0-9_*]+/g, '[REDACTED]');
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
    // 🔴 原因は出すが、鍵は伏せる（Stripe は本文に鍵の一部を混ぜてくる）
    console.error(redact(`🔴 Stripe ${path} が失敗: ${res.status} ${json?.error?.code || ''} ${json?.error?.message || ''}`));
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
  if (!/^price_[A-Za-z0-9]+$/.test(price)) {
    console.error('🔴 STRIPE_PRICE_PREMIUM の形式が Price id ではない。中止。');
    process.exit(1);
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

  // 🔴 出す前に必ず伏字化を通す（id・URL に鍵は入らないが、経路を一本化する）
  console.log(redact('test_clock : ' + clock.id));
  console.log(redact('customer   : ' + customer.id));
  console.log(redact('session    : ' + session.id + (session.livemode ? ' 🔴 livemode' : ' (test)')));
  console.log('');
  console.log('カードを入力して決済する:');
  console.log(redact(session.url));
  console.log('');
  console.log('🔴 一連の作業が終わったら: unset STRIPE_SECRET_KEY STRIPE_PRICE_PREMIUM');
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
