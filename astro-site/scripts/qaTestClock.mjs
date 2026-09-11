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
 *   node scripts/qaTestClock.mjs settle  <clock_id>          現在位置の invoice を確定させる
 *   node scripts/qaTestClock.mjs advance <clock_id> [回数]    1 か月ずつ進めて毎回確定させる
 *   node scripts/qaTestClock.mjs status  <clock_id>
 *
 * 🔴 請求境界ちょうどで止めない。
 *    境界へ進めた直後の invoice は `draft` で、`automatically_finalizes_at`
 *    （作成 + 1 時間）に自動で finalize → 支払いへ進む。境界で ready と判定すると
 *    **まだ払われていない invoice を観測する**（2026-09-10 に実際に発生）。
 *    `settle()` が自動 finalize の予定時刻を過ぎるまで Clock を進めてから ready とする。
 * 🔴 **手動 finalize / 手動 pay で回避しない**（本番と違う経路になり検証にならない）。
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

/**
 * Test Clock を指定時刻まで進め、**進み終わる**まで待つ。
 * 🔴 `advancing` の間は次の操作を受け付けないので必ず待つ。
 */
async function advanceTo(clockId, unixSec) {
  await stripe(`test_helpers/test_clocks/${clockId}/advance`, { frozen_time: Math.floor(unixSec) });
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    const c = await stripe(`test_helpers/test_clocks/${clockId}`);
    if (c.status === 'advancing') continue;
    if (c.status !== 'ready') {
      console.error(`🔴 Test Clock が ready にならない（status=${c.status}）。中止。`);
      process.exit(1);
    }
    return c;
  }
}

/** この Clock にぶら下がっている Customer。 */
async function customersOf(clockId) {
  const r = await stripe(`customers?test_clock=${clockId}&limit=100`);
  return (r.data || []).map((c) => c.id);
}

/** まだ支払いが成立していない invoice（draft / open など）。 */
async function pendingInvoices(customerIds) {
  const out = [];
  for (const cid of customerIds) {
    const r = await stripe(`invoices?customer=${cid}&limit=100`);
    for (const inv of r.data || []) {
      if (!['paid', 'void', 'uncollectible'].includes(inv.status)) out.push(inv);
    }
  }
  return out;
}

/**
 * 🔴 請求境界ちょうどで止めない。
 *
 * Test Clock を請求日ちょうどへ進めると、その月の invoice は **`draft`** で作られ、
 * `automatically_finalizes_at`（＝作成時刻 + 1 時間）に自動で finalize → 支払いへ進む。
 * 境界ちょうどで `ready` と判定すると、**まだ払われていない invoice を観測**することになる
 * （2026-09-10 に実際に発生。3 か月時点を見たつもりが 2 件 / 200pt / Bronze だった）。
 *
 * そこで **自動 finalize の予定時刻を過ぎるまで Clock を進めて**から ready とする。
 * 🔴 **手動 finalize / 手動 pay で回避しない**（本番と違う経路になり、検証にならない）。
 */
async function settle(clockId, { rounds = 8 } = {}) {
  const customers = await customersOf(clockId);
  if (!customers.length) {
    console.error('🔴 この Test Clock に Customer がいない。中止。');
    process.exit(1);
  }
  for (let i = 1; i <= rounds; i++) {
    const pending = await pendingInvoices(customers);
    if (!pending.length) return true;

    const clock = await stripe(`test_helpers/test_clocks/${clockId}`);
    const finalizeAt = pending
      .map((inv) => inv.automatically_finalizes_at)
      .filter((t) => Number.isFinite(t));
    // 予定時刻が読めない場合だけ 1 時間先を見る（Stripe の既定と同じ）
    const target = (finalizeAt.length ? Math.max(...finalizeAt) : clock.frozen_time + 3600) + 60;
    const to = Math.max(target, clock.frozen_time + 60);
    console.log(`    未確定 ${pending.length} 件（${pending.map((x) => x.status).join(',')}）→ `
      + `${new Date(to * 1000).toISOString()} まで進める`);
    await advanceTo(clockId, to);
  }
  const still = await pendingInvoices(customers);
  console.error(`🔴 ${rounds} 回進めても支払いが成立しない invoice が ${still.length} 件ある。中止。`);
  process.exit(1);
}

/** 支払い済み invoice の件数（read-only の要約。金額・id は出さない）。 */
async function paidCount(clockId) {
  const customers = await customersOf(clockId);
  let paid = 0;
  for (const cid of customers) {
    const r = await stripe(`invoices?customer=${cid}&limit=100`);
    paid += (r.data || []).filter((i) => i.status === 'paid' && i.amount_paid > 0).length;
  }
  return paid;
}

if (cmd === 'settle') {
  const clockId = process.argv[3];
  if (!clockId) { console.error('🔴 使い方: settle <clock_id>'); process.exit(1); }
  console.log('  現在位置の未確定 invoice を確定させる（手動 finalize は使わない）');
  await settle(clockId);
  const clock = await stripe(`test_helpers/test_clocks/${clockId}`);
  console.log(`  ✅ ${new Date(clock.frozen_time * 1000).toISOString()} / 支払い済み invoice ${await paidCount(clockId)} 件`);
  process.exit(0);
}

if (cmd === 'advance') {
  const clockId = process.argv[3];
  const times = Number(process.argv[4] || 1);
  if (!clockId || !Number.isInteger(times) || times < 1) {
    console.error('🔴 使い方: advance <clock_id> [回数]');
    process.exit(1);
  }

  // 🔴 まず現在位置を確定させる（前回が境界で止まっている場合に取りこぼさない）
  console.log('  [0] 現在位置を確定');
  await settle(clockId);

  /*
   * 🔴 請求境界は **anchor** で数え、finalize 待ちのぶんを繰り越さない。
   *    毎月 frozen_time から +1 か月にすると、確定待ちで進めた 1 時間ぶんが
   *    毎月ずれて積み上がる（24 回で丸 1 日）。
   */
  let anchor = (await stripe(`test_helpers/test_clocks/${clockId}`)).frozen_time;

  for (let i = 1; i <= times; i++) {
    const next = new Date(anchor * 1000);
    next.setUTCMonth(next.getUTCMonth() + 1);
    anchor = Math.floor(next.getTime() / 1000);

    await advanceTo(clockId, anchor);
    console.log(`  [${i}/${times}] 請求日 ${new Date(anchor * 1000).toISOString().slice(0, 10)} へ到達`);
    // 🔴 境界ちょうどで ready にしない。自動 finalize → 支払いまで進める
    await settle(clockId);
    console.log(`        ✅ 確定（支払い済み invoice ${await paidCount(clockId)} 件）`);
  }

  const clock = await stripe(`test_helpers/test_clocks/${clockId}`);
  console.log(`  完了: ${new Date(clock.frozen_time * 1000).toISOString()} / status ${clock.status}`);
  process.exit(0);
}

if (cmd === 'status') {
  const clock = await stripe(`test_helpers/test_clocks/${process.argv[3]}`);
  console.log(`  frozen_time: ${new Date(clock.frozen_time * 1000).toISOString()}  status: ${clock.status}`);
  process.exit(0);
}

console.error('🔴 使い方: start | advance <clock_id> [回数] | status <clock_id>');
process.exit(1);
