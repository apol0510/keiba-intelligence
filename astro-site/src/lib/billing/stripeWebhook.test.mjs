/**
 * stripeWebhook.test.mjs — Stripe → 会員状態 → entitlement の E2E（ネットワーク不使用）
 *
 * 実行: npm run test:stripe （astro-site 直下から）
 *   node --experimental-test-module-mocks --test src/lib/billing/stripeWebhook.test.mjs
 *
 * ── 何を通しで確かめるか ────────────────────────────────────
 *   Checkout 完了 → webhook → Airtable 反映 → tier 復元 → セッション発行
 *   → entitlement 付与 → 有料表示 → 解約 → 失効 → entitlement 停止 → 支払い失敗
 *
 * ── なぜ本物の Stripe を叩かないか ──────────────────────────
 *   本番 Stripe への書き込み（Product / Price / Webhook 登録）と実決済は禁止。
 *   代わりに **本物の `stripe` パッケージの署名生成・検証**を使い、
 *   `airtable` と `@netlify/blobs` だけを差し替えて、関数の実コードを動かす。
 *   → 署名検証・冪等・書き込み内容・fail-closed はすべて実物の経路で検証できる。
 *
 * 🔴 Stripe の Checkout 画面と実際のカード決済だけは対象外（外部 write のため）。
 */

import { test, mock, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';

import { TIER, planTypeToTier, applyExpiry } from '../auth/tiers.js';
import { signSession, SESSION_COOKIE_NAME } from '../auth/session.js';
import { resolveEntitlement, viewFlags } from '../auth/entitlement.js';

/* ------------------------------------------------------------------
   テスト用の env（🔴 本番の値は一切使わない）
   ------------------------------------------------------------------ */
const WEBHOOK_SECRET = 'whsec_test_only_do_not_use_in_production';
const SECRET_KEY = 'sk_test_only_do_not_use_in_production';
const SESSION_SECRET = 'session-secret-for-test-only';

const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const GHOST = 'ghost@example.com'; // Airtable にレコードが無い人

/* ------------------------------------------------------------------
   Airtable / Blobs の差し替え（メモリ上）
   ------------------------------------------------------------------ */
const db = {
  rows: [],
  updates: [],
  selects: [],
  failUpdate: false,
  /** 特定の書き込みだけ失敗させる述語（membership 側だけ落とす検証用）。 */
  failUpdateWhen: null,
  reset() {
    this.rows = [
      { id: 'recALICE', fields: { Email: ALICE, PlanType: 'free-registered', Status: 'active', AccessEnabled: true } },
      { id: 'recBOB', fields: { Email: BOB, PlanType: 'free-registered', Status: 'active', AccessEnabled: true } },
    ];
    this.updates = [];
    this.selects = [];
    this.failUpdate = false;
    this.failUpdateWhen = null;
  },
};

const blobs = { store: new Map(), broken: false };

/** 指定 email に対して行われた更新だけを取り出す。 */
function updatesFor(email) {
  const row = db.rows.find((r) => r.fields.Email === email);
  return row ? db.updates.filter((u) => u.id === row.id) : [];
}

before(() => {
  process.env.AIRTABLE_API_KEY = 'key_test';
  process.env.AIRTABLE_BASE_ID = 'app_test';
  process.env.SESSION_SIGNING_SECRET = SESSION_SECRET;
  // KMA は既定 disabled のまま（外部通信させない）
  delete process.env.KMA_ENROLL_ENABLED;
  delete process.env.KMA_ENROLL_WRITE_ENABLED;

  mock.module('airtable', {
    defaultExport: class AirtableStub {
      constructor() {}
      base() {
        return () => ({
          select(opts) {
            db.selects.push(opts);
            return {
              async firstPage() {
                const m = String(opts?.filterByFormula || '').match(/\{Email\} = "(.*)"/);
                const email = m ? m[1].replace(/\\"/g, '"') : null;
                const row = db.rows.find((r) => r.fields.Email === email);
                return row ? [row] : [];
              },
            };
          },
          async update(list) {
            if (db.failUpdate) throw new Error('airtable is down');
            if (db.failUpdateWhen && list.some((u) => db.failUpdateWhen(u.fields || {}))) {
              // Airtable が拒否したときと同じ形（例外）で落とす
              throw new Error('airtable rejected the update');
            }
            for (const u of list) {
              db.updates.push({ id: u.id, fields: { ...u.fields } });
              const row = db.rows.find((r) => r.id === u.id);
              if (row) Object.assign(row.fields, u.fields);
            }
            return list;
          },
        });
      }
    },
  });

  mock.module('@netlify/blobs', {
    namedExports: {
      getStore() {
        if (blobs.broken) throw new Error('blobs unavailable');
        return {
          async get(k) { return blobs.store.get(k) ?? null; },
          async set(k, v) { blobs.store.set(k, v); },
        };
      },
    },
  });
});

/**
 * 🔴 **このファイルは ambient な `process.env.MEMBERSHIP_WRITE_ENABLED` に依存しない。**
 *
 * `npm run build` は本番 env を注入した状態でも走る（Netlify）。
 * 既定の挙動（membership を書かない）を検証するテストが ambient のフラグに引きずられると、
 * **本番で WRITE を有効にした瞬間にビルドごと落ちる**（2026-09-01 に実際に発生）。
 *
 * そこで **各テストの開始時に明示的に「未設定」へ揃え**、
 * ファイルの最後に **元の値を復元する**（後続ファイル・本番 env を壊さない）。
 * フラグを立てて検証したいテストは `withWriteFlag('true', ...)` を使う。
 */
const AMBIENT_WRITE_FLAG = process.env.MEMBERSHIP_WRITE_ENABLED;

beforeEach(() => {
  db.reset();
  blobs.store.clear();
  blobs.broken = false;
  process.env[  'STRIPE_SECRET_KEY'] = SECRET_KEY;
  process.env['STRIPE_WEBHOOK_SECRET'] = WEBHOOK_SECRET;
  // 🔴 既定は「未設定」。ambient に true が入っていても結果を変えない
  delete process.env.MEMBERSHIP_WRITE_ENABLED;
});

after(() => {
  // 🔴 単純な delete にしない。ambient の値を必ず戻す
  if (AMBIENT_WRITE_FLAG === undefined) delete process.env.MEMBERSHIP_WRITE_ENABLED;
  else process.env.MEMBERSHIP_WRITE_ENABLED = AMBIENT_WRITE_FLAG;
});

/* ------------------------------------------------------------------
   Stripe イベントの組み立て（署名は本物の SDK で作る）
   ------------------------------------------------------------------ */
const stripe = new Stripe(SECRET_KEY);
let seq = 0;

function makeEvent(type, object, id) {
  return { id: id || `evt_test_${++seq}`, type, data: { object } };
}

/** 本物の署名ヘッダーを作る。 */
function signed(evt, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify(evt);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return { payload, header };
}

async function post(evt, { secret, signature, method = 'POST', raw } = {}) {
  const { handler } = await import('../../../netlify/functions/stripe-webhook.js');
  const { payload, header } = signed(evt, secret || WEBHOOK_SECRET);
  return handler({
    httpMethod: method,
    headers: { 'stripe-signature': signature === undefined ? header : signature },
    body: raw === undefined ? payload : raw,
    isBase64Encoded: false,
  });
}

const checkoutCompleted = (email, plan = 'premium', id) =>
  makeEvent('checkout.session.completed', {
    id: 'cs_test_1',
    metadata: { ki_plan: plan, ki_email: email },
    customer_email: email,
  }, id);

const subUpdated = (email, status, plan = 'premium', id) =>
  makeEvent('customer.subscription.updated', {
    id: 'sub_test_1',
    status,
    metadata: { ki_plan: plan, ki_email: email },
  }, id);

const subDeleted = (email, id) =>
  makeEvent('customer.subscription.deleted', {
    id: 'sub_test_1',
    metadata: { ki_plan: 'premium', ki_email: email },
  }, id);

const paymentFailed = (email, id) =>
  makeEvent('invoice.payment_failed', {
    id: 'in_test_1',
    subscription_details: { metadata: { ki_email: email } },
  }, id);

const PAID_AT_SEC = Math.floor(Date.parse('2026-08-15T00:00:00Z') / 1000);

const paymentSucceeded = (email, id, invoiceId = 'in_test_1', overrides = {}) =>
  makeEvent('invoice.payment_succeeded', {
    id: invoiceId,
    subscription_details: { metadata: { ki_email: email } },
    lines: { data: [{ price: { recurring: { interval: 'month', interval_count: 1 } } }] },
    status_transitions: { paid_at: PAID_AT_SEC },
    ...overrides,
  }, id);

/* ------------------------------------------------------------------
   entitlement 側（auth / session）へつなぐ
   ------------------------------------------------------------------ */
const NOW = Date.parse('2026-09-01T00:00:00Z');

/** Airtable の現在値から、その会員がログインしたときの見え方を出す。 */
function viewOf(email, { nowMs = NOW, secret = SESSION_SECRET, expiresAt = null } = {}) {
  const row = db.rows.find((r) => r.fields.Email === email);
  const planType = row?.fields?.PlanType ?? '';
  const tier = applyExpiry(planTypeToTier(planType), expiresAt, nowMs);
  const s = signSession({ email, tier, secret: SESSION_SECRET, nowMs });
  assert.ok(s.ok, `セッション発行に失敗: ${s.reason}`);
  const ent = resolveEntitlement({
    cookieHeader: `${SESSION_COOKIE_NAME}=${encodeURIComponent(s.token)}`,
    env: { SESSION_SIGNING_SECRET: secret },
    nowMs,
  });
  return { tier, ent, view: viewFlags(ent) };
}

/* ==================================================================
   1. Checkout → webhook → 反映 → entitlement 付与 → 有料表示
   ================================================================== */

test('E2E: Checkout 完了 → プラン付与 → 有料表示が開く', async () => {
  const before = viewOf(ALICE);
  assert.equal(before.tier, TIER.FREE, '購入前は無料会員');
  assert.equal(before.view.showMarks, true);
  assert.equal(before.view.showBetting, false, '購入前に買い目が見えている');

  const res = await post(checkoutCompleted(ALICE));
  assert.equal(res.statusCode, 200);

  const ups = updatesFor(ALICE);
  assert.equal(ups.length, 1, '更新が 1 回でない');
  assert.deepEqual(ups[0].fields, { PlanType: 'premium', Status: 'active', AccessEnabled: true });
  assert.equal(ups[0].fields.VenueAccess, undefined, '廃止した VenueAccess を書いている');

  const after = viewOf(ALICE);
  assert.equal(after.tier, TIER.PREMIUM);
  assert.equal(after.view.showBetting, true, '購入後に買い目が開かない');
  assert.equal(after.view.showMarks, true);
  assert.equal(after.view.authenticated, true);
});

/* ------------------------------------------------------------------
   会員継続制度の列は、フラグが無ければ一切書かない
   （docs/MEMBERSHIP_DATA_MIGRATION.md §6）

   🔴 **ここのテストは ambient な `process.env` に依存してはいけない。**
      `npm run build` は本番 env を注入した状態でも走る（Netlify）。
      「フラグが未設定であること」を前提に書くと、本番で
      `MEMBERSHIP_WRITE_ENABLED=true` を設定した瞬間に **ビルドごと落ちる**
      （2026-09-01 に実際に発生。WRITE 有効化が 2 回失敗した）。
      そのため **テスト内で値を決め、必ず元へ戻す**。
   ------------------------------------------------------------------ */

/**
 * `MEMBERSHIP_WRITE_ENABLED` を指定の値にしてから fn を実行し、**必ず元へ戻す**。
 *
 * 🔴 `finally` で単純に `delete` しない。
 *    ambient に値が入っていた場合（本番 env を注入したビルド）に、
 *    **後続のテストからその値が消えてしまう**ため、保存した値を復元する。
 *
 * @param {string|undefined} value 'true' などの値。undefined なら「未設定」を作る
 */
async function withWriteFlag(value, fn) {
  const saved = process.env.MEMBERSHIP_WRITE_ENABLED;
  if (value === undefined) delete process.env.MEMBERSHIP_WRITE_ENABLED;
  else process.env.MEMBERSHIP_WRITE_ENABLED = value;
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.MEMBERSHIP_WRITE_ENABLED;
    else process.env.MEMBERSHIP_WRITE_ENABLED = saved;
  }
}

test('🔴 MEMBERSHIP_WRITE_ENABLED が無ければ membership の列を書かない', async () => {
  await withWriteFlag(undefined, async () => {
  assert.equal(process.env.MEMBERSHIP_WRITE_ENABLED, undefined, 'テスト内で未設定にできていない');

  await post(checkoutCompleted(ALICE));
  await post(subUpdated(ALICE, 'canceled'));

  for (const u of updatesFor(ALICE)) {
    const keys = Object.keys(u.fields).sort();
    assert.deepEqual(
      keys.filter((k) => !['PlanType', 'Status', 'AccessEnabled'].includes(k)),
      [],
      `既存 3 列以外を書いている: ${keys.join(', ')}`,
    );
  }
  });
});

test('🔴 フラグを立てても列が無ければプラン付与は成功する（巻き添えで落ちない）', async () => {
  await withWriteFlag('true', async () => {
    assert.equal(process.env.MEMBERSHIP_WRITE_ENABLED, 'true', 'テスト内で true にできていない');
    const res = await post(checkoutCompleted(ALICE));
    // 🔴 membership 側の書き込みが失敗しても、プラン付与は 200 で完了すること
    assert.equal(res.statusCode, 200, 'membership の失敗がプラン付与を巻き添えにしている');

    const planUpdate = updatesFor(ALICE).find((u) => u.fields.PlanType);
    assert.ok(planUpdate, 'プラン付与が行われていない');
    assert.deepEqual(planUpdate.fields, { PlanType: 'premium', Status: 'active', AccessEnabled: true });

    const after = viewOf(ALICE);
    assert.equal(after.view.showBetting, true, '有料表示が開かない');
  });
});

test('🔴 ambient env が true でも undefined でも結果が変わらない', async () => {
  const saved = process.env.MEMBERSHIP_WRITE_ENABLED;
  try {
    // ambient を人工的に作って、どちらでもヘルパが同じ結果を出すことを見る
    for (const ambient of [undefined, 'true']) {
      // ambient を作る
      if (ambient === undefined) delete process.env.MEMBERSHIP_WRITE_ENABLED;
      else process.env.MEMBERSHIP_WRITE_ENABLED = ambient;

      // ヘルパは ambient に関係なく指定の値を作れる
      await withWriteFlag(undefined, async () => {
        assert.equal(process.env.MEMBERSHIP_WRITE_ENABLED, undefined, `ambient=${ambient} で未設定にできない`);
      });
      await withWriteFlag('true', async () => {
        assert.equal(process.env.MEMBERSHIP_WRITE_ENABLED, 'true', `ambient=${ambient} で true にできない`);
      });

      // 🔴 実行後に ambient が復元されている（本番 env を壊さない）
      assert.equal(process.env.MEMBERSHIP_WRITE_ENABLED, ambient,
        `ambient=${ambient} が復元されていない`);
    }
  } finally {
    if (saved === undefined) delete process.env.MEMBERSHIP_WRITE_ENABLED;
    else process.env.MEMBERSHIP_WRITE_ENABLED = saved;
  }
});

test('🔴 例外が出ても ambient env を復元する', async () => {
  const saved = process.env.MEMBERSHIP_WRITE_ENABLED;
  try {
    process.env.MEMBERSHIP_WRITE_ENABLED = 'true';
    await assert.rejects(
      () => withWriteFlag(undefined, async () => { throw new Error('boom'); }),
      /boom/,
    );
    assert.equal(process.env.MEMBERSHIP_WRITE_ENABLED, 'true', '例外時に復元されていない');
  } finally {
    if (saved === undefined) delete process.env.MEMBERSHIP_WRITE_ENABLED;
    else process.env.MEMBERSHIP_WRITE_ENABLED = saved;
  }
});

test('E2E: 解約 → 失効 → entitlement 停止', async () => {
  await post(checkoutCompleted(ALICE));
  assert.equal(viewOf(ALICE).view.showBetting, true);

  // Customer Portal からの解約は subscription.updated(canceled) で届く
  const res = await post(subUpdated(ALICE, 'canceled'));
  assert.equal(res.statusCode, 200);

  const last = updatesFor(ALICE).at(-1);
  assert.deepEqual(last.fields, { PlanType: TIER.FREE, Status: 'inactive', AccessEnabled: false });

  const after = viewOf(ALICE);
  assert.equal(after.tier, TIER.FREE);
  assert.equal(after.view.showBetting, false, '解約後も買い目が見えている');
  assert.equal(after.view.showMarks, true, '解約後は無料会員として印まで見える');
});

test('E2E: subscription.deleted でも free へ戻る', async () => {
  await post(checkoutCompleted(ALICE));
  const res = await post(subDeleted(ALICE));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(updatesFor(ALICE).at(-1).fields, { PlanType: TIER.FREE, Status: 'inactive', AccessEnabled: false });
  assert.equal(viewOf(ALICE).view.showBetting, false);
});

test('E2E: subscription.updated(active / trialing) で付与、その他の状態は無視', async () => {
  for (const st of ['active', 'trialing']) {
    db.reset();
    const res = await post(subUpdated(ALICE, st));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(updatesFor(ALICE).at(-1).fields, { PlanType: 'premium', Status: 'active', AccessEnabled: true }, st);
    assert.equal(viewOf(ALICE).view.showBetting, true, st);
  }
  for (const st of ['past_due', 'incomplete', 'paused']) {
    db.reset();
    const res = await post(subUpdated(ALICE, st));
    assert.equal(res.statusCode, 200);
    assert.equal(updatesFor(ALICE).length, 0, `${st} で書き込みが起きた`);
  }
});

test('E2E: payment_failed は Status だけ変え、アクセスを即時停止しない', async () => {
  await post(checkoutCompleted(ALICE));
  const res = await post(paymentFailed(ALICE));
  assert.equal(res.statusCode, 200);

  const last = updatesFor(ALICE).at(-1);
  assert.deepEqual(last.fields, { Status: 'payment_failed' });
  assert.equal(last.fields.PlanType, undefined, 'PlanType を書き換えている');
  assert.equal(last.fields.AccessEnabled, undefined, 'AccessEnabled を書き換えている');

  // 猶予期間なので買い目は開いたまま（停止は Stripe の dunning に従う）
  assert.equal(viewOf(ALICE).view.showBetting, true, '支払い失敗で即座に停止している');
});

/* ------------------------------------------------------------------
   TBD-10: 認可とリワードを混同しない
   （docs/MEMBERSHIP_REWARDS.md §7.7）
   ------------------------------------------------------------------ */

test('🔴 payment_failed は認可を変えず、リワードの付与も行わない（保留）', async () => {
  await post(checkoutCompleted(ALICE));
  const beforeCount = updatesFor(ALICE).length;

  const res = await post(paymentFailed(ALICE));
  assert.equal(res.statusCode, 200);

  // 認可: Status だけ。PlanType / AccessEnabled は触らない
  const last = updatesFor(ALICE).at(-1);
  assert.deepEqual(last.fields, { Status: 'payment_failed' });
  assert.equal(viewOf(ALICE).view.showBetting, true, 'アクセスを即時停止してはいけない');

  // リワード: 付与の書き込みは起きない（フラグ off なので当然だが、経路としても呼ばない）
  assert.equal(updatesFor(ALICE).length, beforeCount + 1, '付与のための追加書き込みが起きている');
});

test('🔴 payment_succeeded は認可を変えない（付与だけを行う）', async () => {
  await post(checkoutCompleted(ALICE));
  const beforeCount = updatesFor(ALICE).length;
  const beforeView = viewOf(ALICE);

  const res = await post(paymentSucceeded(ALICE));
  assert.equal(res.statusCode, 200);

  // 認可は一切変わらない（フラグ off なので Airtable への書き込みも増えない）
  assert.equal(updatesFor(ALICE).length, beforeCount, '支払い成功で認可を書き換えている');
  assert.equal(viewOf(ALICE).tier, beforeView.tier);
  assert.equal(viewOf(ALICE).view.showBetting, beforeView.view.showBetting);
});

/* ------------------------------------------------------------------
   請求期間・支払い時刻が読めないときは付与しない（fail-closed）
   ------------------------------------------------------------------ */

test('🔴 未知の請求間隔では付与しない（月額へ fallback しない）', async () => {
  const { periodMonthsFromInvoice } = await import('../../../netlify/functions/stripe-webhook.js');

  const rec = (recurring) => ({ lines: { data: [{ price: { recurring } }] } });

  // 判定できるもの（interval と interval_count が **両方** 揃っている場合だけ）
  assert.equal(periodMonthsFromInvoice(rec({ interval: 'month', interval_count: 1 })), 1);
  assert.equal(periodMonthsFromInvoice(rec({ interval: 'year', interval_count: 1 })), 12);
  assert.equal(periodMonthsFromInvoice(rec({ interval: 'month', interval_count: 3 })), 3,
    '四半期払いは 3 か月ぶん（月額へ潰さない）');
  assert.equal(periodMonthsFromInvoice(rec({ interval: 'year', interval_count: 2 })), 24);

  // 🔴 判定できないものは null（＝付与しない）
  for (const bad of [
    {},
    { lines: { data: [] } },
    { lines: { data: [{ price: {} }] } },
    rec({ interval: 'week', interval_count: 1 }),
    rec({ interval: 'day', interval_count: 1 }),
    rec({ interval: 'quarter', interval_count: 1 }),
    rec({ interval: 'month', interval_count: 0 }),
    rec({ interval: 'month', interval_count: -1 }),
    rec({ interval: 'month', interval_count: 1.5 }),
  ]) {
    assert.equal(periodMonthsFromInvoice(bad), null, `月額へ fallback している: ${JSON.stringify(bad)}`);
  }
});

test('🔴 interval_count が欠落していたら 1 で補わず付与しない', async () => {
  const { periodMonthsFromInvoice } = await import('../../../netlify/functions/stripe-webhook.js');
  const rec = (recurring) => ({ lines: { data: [{ price: { recurring } }] } });

  // 🔴 「月額なのだから 1 だろう」と補完してはいけない。
  //    実際が四半期・半年払いだった場合、付与量と継続月数が過少なまま確定してしまう。
  for (const missing of [
    rec({ interval: 'month' }),
    rec({ interval: 'year' }),
    rec({ interval: 'month', interval_count: null }),
    rec({ interval: 'month', interval_count: undefined }),
    rec({ interval: 'month', interval_count: '1' }),
    rec({ interval: 'year', interval_count: '' }),
  ]) {
    assert.equal(periodMonthsFromInvoice(missing), null,
      `interval_count 欠落を 1 で補っている: ${JSON.stringify(missing)}`);
  }
});

test('🔴 interval_count 欠落の webhook を受けても 200・付与なし・認可不変', async () => {
  await post(checkoutCompleted(ALICE));
  const before = updatesFor(ALICE).length;

  const res = await post(
    paymentSucceeded(ALICE, 'evt_no_count', 'in_no_count', {
      lines: { data: [{ price: { recurring: { interval: 'month' } } }] }, // interval_count なし
    }),
  );
  assert.equal(res.statusCode, 200, 'Stripe に再送させ続けない');
  assert.equal(updatesFor(ALICE).length, before, '認可を書き換えている');
  assert.equal(viewOf(ALICE).view.showBetting, true, '認可の挙動が変わっている');
});

test('🔴 支払い時刻は Stripe の paid_at を使い、無ければ付与しない', async () => {
  const { paidAtMsFromInvoice } = await import('../../../netlify/functions/stripe-webhook.js');

  assert.equal(paidAtMsFromInvoice({ status_transitions: { paid_at: PAID_AT_SEC } }), PAID_AT_SEC * 1000);

  // 🔴 受信時刻（Date.now）で代用しない
  for (const bad of [
    {},
    { status_transitions: {} },
    { status_transitions: { paid_at: null } },
    { status_transitions: { paid_at: 0 } },
    { status_transitions: { paid_at: 'x' } },
  ]) {
    assert.equal(paidAtMsFromInvoice(bad), null, `推測で時刻を作っている: ${JSON.stringify(bad)}`);
  }
});

test('🔴 未知の間隔 / paid_at 欠落でも 200 を返し、認可は変えない', async () => {
  await post(checkoutCompleted(ALICE));
  const before = updatesFor(ALICE).length;

  const unknownInterval = await post(
    paymentSucceeded(ALICE, 'evt_unknown_interval', 'in_x1', {
      lines: { data: [{ price: { recurring: { interval: 'week' } } }] },
    }),
  );
  assert.equal(unknownInterval.statusCode, 200, 'Stripe に再送させ続けない');

  const noPaidAt = await post(
    paymentSucceeded(ALICE, 'evt_no_paid_at', 'in_x2', { status_transitions: {} }),
  );
  assert.equal(noPaidAt.statusCode, 200);

  assert.equal(updatesFor(ALICE).length, before, '認可を書き換えている');
  assert.equal(viewOf(ALICE).view.showBetting, true);
});

/* ------------------------------------------------------------------
   Airtable の単一選択（singleSelect）の制約
   （2026-09-02 の Test Mode E2E で 500 handler_failed を招いた盲点）
   ------------------------------------------------------------------ */

/**
 * 🔴 `PlanType` / `Status` は Airtable の **単一選択**である。
 *    登録されていない選択肢を書くと Airtable が 422 で拒否し、
 *    `applyPlan` が例外を投げて webhook が 500 になる。
 *    モックは値を素通しするため、この制約はテストで**再現できていなかった**。
 *    ここでは「コードが書く値の集合」を Airtable の選択肢と突き合わせて固定する。
 *
 * 🔴 この一覧を増やすときは **Airtable 側にも選択肢を追加**すること。
 */
const AIRTABLE_CHOICES = Object.freeze({
  // 2026-09-02 時点の実スキーマ（read-only で確認済み）
  PlanType: ['free-registered', 'light', 'pro', 'premium', 'free'],
  Status: ['pending', 'active', 'cancelled', 'expired', 'suspended', 'unpaid',
    'refunded', 'withdrawn', 'test', 'inactive', 'payment_failed'],
});

test('🔴 webhook が書く PlanType / Status は Airtable の選択肢に存在する', async () => {
  // 実際にイベントを流して、書き込まれた値を集める
  await post(checkoutCompleted(ALICE));
  await post(subUpdated(ALICE, 'canceled'));
  await post(subDeleted(ALICE));
  await post(paymentFailed(ALICE));
  for (const st of ['active', 'trialing']) await post(subUpdated(ALICE, st));

  const written = { PlanType: new Set(), Status: new Set() };
  for (const u of updatesFor(ALICE)) {
    for (const k of ['PlanType', 'Status']) {
      if (u.fields[k] != null) written[k].add(u.fields[k]);
    }
  }

  for (const k of ['PlanType', 'Status']) {
    assert.ok(written[k].size > 0, `${k} の書き込みが観測できていない`);
    for (const v of written[k]) {
      assert.ok(
        AIRTABLE_CHOICES[k].includes(v),
        `🔴 Airtable の ${k} に選択肢「${v}」が無い → 実環境で 422 になり webhook が 500 になる`,
      );
    }
  }
});

/* ------------------------------------------------------------------
   membership の失敗を「成功扱い」にしない（再送で復旧できる契約）
   ------------------------------------------------------------------ */

test('🔴 membership の書き込みだけ失敗したら processed にせず 500（再送で復旧）', async () => {
  await withWriteFlag('true', async () => {
    // 🔴 プラン付与（PlanType）は成功させ、membership の列（CancelledAt）だけ落とす
    db.failUpdateWhen = (f) => 'CancelledAt' in f;
    try {
      const res = await post(checkoutCompleted(ALICE, 'premium', 'evt_ms_fail'));
      assert.equal(res.statusCode, 500, '🔴 membership の失敗を 200 で握りつぶしている');
      assert.equal(JSON.parse(res.body).error, 'membership_not_recorded');

      // プラン付与自体は完了している（認可を巻き戻さない）
      const planUpdate = updatesFor(ALICE).find((u) => u.fields.PlanType);
      assert.deepEqual(planUpdate.fields, { PlanType: 'premium', Status: 'active', AccessEnabled: true });
    } finally {
      db.failUpdateWhen = null;
    }

    // 🔴 processed にしていないので、再送が duplicate 扱いされない＝復旧できる
    const retry = await post(checkoutCompleted(ALICE, 'premium', 'evt_ms_fail'));
    assert.equal(retry.statusCode, 200, '🔴 再送で復旧できていない');
    assert.equal(JSON.parse(retry.body).duplicate, undefined, '🔴 duplicate 扱いされ永久に失われる');
  });
});

test('🔴 フラグ未設定（やることが無い）は失敗にしない', async () => {
  const res = await post(checkoutCompleted(ALICE, 'premium', 'evt_ms_skip'));
  assert.equal(res.statusCode, 200);
  // processed になっているので再送は duplicate
  const again = await post(checkoutCompleted(ALICE, 'premium', 'evt_ms_skip'));
  assert.equal(JSON.parse(again.body).duplicate, true);
});

test('🔴 同じ invoice の payment_succeeded を再送しても二重処理しない', async () => {
  await post(checkoutCompleted(ALICE));
  const first = await post(paymentSucceeded(ALICE, 'evt_paid_1'));
  assert.equal(first.statusCode, 200);

  // 同じ event.id → 冪等（重複として無視）
  const dup = await post(paymentSucceeded(ALICE, 'evt_paid_1'));
  assert.equal(JSON.parse(dup.body).duplicate, true);

  // 別の event.id でも同じ invoice なら、付与側の冪等キー（invoice id）で防がれる
  const again = await post(paymentSucceeded(ALICE, 'evt_paid_2', 'in_test_1'));
  assert.equal(again.statusCode, 200);
});

/* ==================================================================
   2. 冪等性・二重付与防止・他会員混入
   ================================================================== */

test('🔴 冪等: 同じ event.id を二度処理しない', async () => {
  const evt = checkoutCompleted(ALICE, 'premium', 'evt_dup_1');
  const a = await post(evt);
  const b = await post(evt);

  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  assert.equal(JSON.parse(b.body).duplicate, true, '2 回目が duplicate と応答していない');
  assert.equal(updatesFor(ALICE).length, 1, '二重に書き込まれた');
});

test('🔴 冪等: event.id が違えば別イベントとして処理する', async () => {
  await post(checkoutCompleted(ALICE, 'premium', 'evt_a'));
  await post(checkoutCompleted(ALICE, 'premium', 'evt_b'));
  assert.equal(updatesFor(ALICE).length, 2);
});

test('🔴 冪等: 処理に失敗したイベントは「処理済み」にしない（再送で復旧できる）', async () => {
  const evt = checkoutCompleted(ALICE, 'premium', 'evt_retry_1');

  db.failUpdate = true;
  const first = await post(evt);
  assert.equal(first.statusCode, 500, '失敗時に 500 を返していない');
  assert.equal(updatesFor(ALICE).length, 0);

  // Stripe の再送
  db.failUpdate = false;
  const retry = await post(evt);
  assert.equal(retry.statusCode, 200);
  assert.equal(JSON.parse(retry.body).duplicate, undefined, '失敗したイベントが処理済み扱いになっている');
  assert.equal(updatesFor(ALICE).length, 1, '再送で反映されない（更新が失われる）');
});

test('🔴 他会員に混入しない: 別 email の付与が互いに影響しない', async () => {
  await post(checkoutCompleted(ALICE, 'premium', 'evt_alice'));
  await post(checkoutCompleted(BOB, 'premium', 'evt_bob'));

  assert.equal(updatesFor(ALICE).length, 1);
  assert.equal(updatesFor(BOB).length, 1);
  assert.equal(updatesFor(ALICE)[0].id, 'recALICE');
  assert.equal(updatesFor(BOB)[0].id, 'recBOB');

  // ALICE だけ解約しても BOB は有料のまま
  await post(subUpdated(ALICE, 'canceled', 'premium', 'evt_alice_cancel'));
  assert.equal(viewOf(ALICE).view.showBetting, false);
  assert.equal(viewOf(BOB).view.showBetting, true, '他会員の権限が巻き添えで消えた');
});

test('顧客レコードが無ければ作らない（書き込み 0・200）', async () => {
  const res = await post(checkoutCompleted(GHOST));
  assert.equal(res.statusCode, 200);
  assert.equal(db.updates.length, 0, '存在しない会員に書き込んだ');
});

test('Blobs が使えなくても処理は続く（at-least-once）', async () => {
  blobs.broken = true;
  const evt = checkoutCompleted(ALICE, 'premium', 'evt_noblobs');
  const a = await post(evt);
  const b = await post(evt);
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  // 記録できないので二重処理は起きうる。ただし書き込む値は同じなので状態は壊れない
  const ups = updatesFor(ALICE);
  assert.ok(ups.length >= 1);
  for (const u of ups) {
    assert.deepEqual(u.fields, { PlanType: 'premium', Status: 'active', AccessEnabled: true });
  }
  assert.equal(viewOf(ALICE).view.showBetting, true);
});

/* ==================================================================
   3. fail-closed（署名・設定・入力）
   ================================================================== */

test('🔴 署名が不正なら 400 で、一切書き込まない', async () => {
  const res = await post(checkoutCompleted(ALICE), { signature: 't=1,v1=deadbeef' });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, 'invalid_signature');
  assert.equal(db.updates.length, 0);
});

test('🔴 署名ヘッダーが無ければ 400', async () => {
  const res = await post(checkoutCompleted(ALICE), { signature: null });
  assert.equal(res.statusCode, 400);
  assert.equal(db.updates.length, 0);
});

test('🔴 別の秘密で署名されたイベントを受け付けない', async () => {
  const res = await post(checkoutCompleted(ALICE), { secret: 'whsec_attacker' });
  assert.equal(res.statusCode, 400);
  assert.equal(db.updates.length, 0);
});

test('🔴 本文が改竄されていれば 400（署名は本文に対して検証される）', async () => {
  const evt = checkoutCompleted(ALICE);
  const tampered = JSON.stringify({ ...evt, data: { object: { metadata: { ki_plan: 'premium', ki_email: BOB } } } });
  const res = await post(evt, { raw: tampered });
  assert.equal(res.statusCode, 400);
  assert.equal(db.updates.length, 0);
});

test('🔴 WEBHOOK_SECRET 未設定なら 503（無検証で書き込まない）', async () => {
  delete process.env['STRIPE_WEBHOOK_SECRET'];
  const res = await post(checkoutCompleted(ALICE));
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).error, 'not_configured');
  assert.equal(db.updates.length, 0);
});

test('🔴 SECRET_KEY 未設定なら 503', async () => {
  delete process.env['STRIPE_SECRET_KEY'];
  const res = await post(checkoutCompleted(ALICE));
  assert.equal(res.statusCode, 503);
  assert.equal(db.updates.length, 0);
});

test('POST 以外は 405', async () => {
  const res = await post(checkoutCompleted(ALICE), { method: 'GET' });
  assert.equal(res.statusCode, 405);
  assert.equal(db.updates.length, 0);
});

test('🔴 未知のプラン / email 欠落では付与しない', async () => {
  const noPlan = makeEvent('checkout.session.completed', { metadata: { ki_email: ALICE } }, 'evt_noplan');
  assert.equal((await post(noPlan)).statusCode, 200);

  const badPlan = checkoutCompleted(ALICE, 'admin', 'evt_badplan');
  assert.equal((await post(badPlan)).statusCode, 200);

  const noEmail = makeEvent('checkout.session.completed', { metadata: { ki_plan: 'premium' } }, 'evt_noemail');
  assert.equal((await post(noEmail)).statusCode, 200);

  // ライトは保留中なので metadata から復元できない＝新規付与されない
  const light = checkoutCompleted(ALICE, 'light', 'evt_light');
  assert.equal((await post(light)).statusCode, 200);

  assert.equal(db.updates.length, 0, '付与してはいけない条件で書き込んだ');
});

test('未知のイベント種別は無視して 200', async () => {
  const res = await post(makeEvent('customer.created', { id: 'cus_x' }, 'evt_unknown'));
  assert.equal(res.statusCode, 200);
  assert.equal(db.updates.length, 0);
});

test('🔴 内部エラーの詳細を応答に出さない', async () => {
  db.failUpdate = true;
  const res = await post(checkoutCompleted(ALICE, 'premium', 'evt_err'));
  assert.equal(res.statusCode, 500);
  const body = res.body;
  assert.equal(JSON.parse(body).error, 'handler_failed');
  assert.ok(!/airtable is down|stack|Error:/i.test(body), '内部エラーが漏れている');
});

/* ==================================================================
   4. auth / session 側の fail-closed
   ================================================================== */

test('🔴 署名鍵が無ければ、付与済みでも guest（fail-closed）', async () => {
  await post(checkoutCompleted(ALICE));
  const { ent } = viewOf(ALICE, { secret: '' });
  assert.equal(ent.tier, TIER.GUEST);
  assert.equal(ent.showBetting, false);
  assert.equal(ent.reason, 'secret_missing');
});

test('🔴 別の鍵で署名された Cookie は通らない', async () => {
  await post(checkoutCompleted(ALICE));
  const s = signSession({ email: ALICE, tier: TIER.PREMIUM, secret: 'attacker-secret', nowMs: NOW });
  const ent = resolveEntitlement({
    cookieHeader: `${SESSION_COOKIE_NAME}=${encodeURIComponent(s.token)}`,
    env: { SESSION_SIGNING_SECRET: SESSION_SECRET },
    nowMs: NOW,
  });
  assert.equal(ent.tier, TIER.GUEST);
  assert.equal(ent.showBetting, false);
});

test('🔴 有効期限を過ぎた有料会員は free へ落ちる', async () => {
  await post(checkoutCompleted(ALICE));
  const expired = viewOf(ALICE, { expiresAt: '2026-08-01', nowMs: NOW });
  assert.equal(expired.tier, TIER.FREE);
  assert.equal(expired.view.showBetting, false);
});

test('セッションの期限切れは guest（付与状態に関係なく）', async () => {
  await post(checkoutCompleted(ALICE));
  const s = signSession({ email: ALICE, tier: TIER.PREMIUM, secret: SESSION_SECRET, nowMs: NOW, ttlSeconds: 60 });
  const ent = resolveEntitlement({
    cookieHeader: `${SESSION_COOKIE_NAME}=${encodeURIComponent(s.token)}`,
    env: { SESSION_SIGNING_SECRET: SESSION_SECRET },
    nowMs: NOW + 61 * 1000,
  });
  assert.equal(ent.tier, TIER.GUEST);
  assert.equal(ent.showBetting, false);
});

test('viewFlags は email を含めない（UI へ PII を渡さない）', async () => {
  await post(checkoutCompleted(ALICE));
  const { view } = viewOf(ALICE);
  assert.equal(Object.prototype.hasOwnProperty.call(view, 'email'), false);
});
