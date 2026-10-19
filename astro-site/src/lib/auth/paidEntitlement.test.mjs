/**
 * paidEntitlement.test.mjs — ログインできることと有料が見られることを厳密に分ける（MK 2026-10-19）
 *
 * 実行: npm run test:login-eligibility （astro-site 直下から）
 *   node --experimental-test-module-mocks src/lib/auth/paidEntitlement.test.mjs
 *   🔴 `--test` を付けない（実ハンドラがログを出すため。loginEligibility.test.mjs と同じ理由）
 *
 * 正本: docs/measurements/LOGIN_RECOVERY_2026_10.md §「ログイン可否と有料権限の分離」
 *
 * 行列（全組み合わせを 3 経路で検査する）:
 *   Status   ∈ active / inactive / payment_failed / pending / cancelled / suspended
 *   PlanType ∈ premium / free / 空
 *   有効期限 ∈ 未来 / 過去 / 無し / 読めない値
 *   退会記録 ∈ 無し / 有り（反映済み・CancelledAt あり）/ 有り（未反映）
 *
 *   経路: ① ログイン（verify-magic-link の実ハンドラ → 署名付き Cookie の tier）
 *         ② 出し直し（refresh-session の実ハンドラ。free / premium の Cookie から）
 *         ③ ゲート（① の Cookie → resolveEntitlement → applyRevocation → showBetting / paidPageRedirect）
 *
 * 期待（有料になるのは次をすべて満たすときだけ）:
 *   PlanType=premium かつ Status ∈ {active, payment_failed} かつ 有効期限が 未来 or 無し かつ 退会記録が未反映でない
 *
 * 🔴 ネットワークは使わない。`airtable` と `@netlify/blobs` だけ差し替え、関数の実コードを動かす。
 * 🔴 実在しないアドレス（example.invalid）だけを使う。
 */

import { test, describe, mock, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { TIER } from './tiers.js';
import { signSession, verifySession, SESSION_COOKIE_NAME } from './session.js';
import { resolveEntitlement, applyRevocation, viewFlags, paidPageRedirect } from './entitlement.js';
import { revocationKey } from './revocation.js';
import { canRequestLoginLink, verifiedCustomerUpdate } from './loginEligibility.js';
import {
  PAID_STATUSES, customerSessionTier, expiryState, isPaidPlanType, isPaidStatus,
} from './paidEntitlement.js';

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(siteRoot, p), 'utf8');

const SESSION_SECRET = ['paid', 'entitlement', 'fixture'].join('-');
/** 🔴 実在しないドメイン（実行時に組み立てる）。 */
const MEMBER = ['matrix', 'example.invalid'].join('@');
const LINK = ['matrix', 'link', '9'].join('');
const DAY = 24 * 60 * 60 * 1000;

const STATUSES = ['active', 'inactive', 'payment_failed', 'pending', 'cancelled', 'suspended'];
const PLANS = ['premium', 'free', ''];
const EXPIRIES = {
  future: () => new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10),
  past: () => new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10),
  missing: () => undefined,
  garbage: () => 'not-a-date',
};
const WITHDRAWALS = ['missing', 'confirmed', 'unconfirmed'];

/** 期待値（仕様）。 */
function expectPaid({ status, plan, expiry, withdrawal }) {
  return plan === 'premium'
    && (status === 'active' || status === 'payment_failed')
    && (expiry === 'future' || expiry === 'missing')
    && withdrawal !== 'unconfirmed';
}

function* matrix() {
  for (const status of STATUSES) {
    for (const plan of PLANS) {
      for (const expiry of Object.keys(EXPIRIES)) {
        for (const withdrawal of WITHDRAWALS) {
          yield { status, plan, expiry, withdrawal };
        }
      }
    }
  }
}

const label = (c) => `Status=${c.status} PlanType=${c.plan || '(空)'} 期限=${c.expiry} 退会記録=${c.withdrawal}`;

// ------------------------------------------------------------ 差し替え（メモリ上）

const db = {
  customers: [],
  tokens: [],
  updates: [],
};
const blobs = { store: new Map() };

function setup(c) {
  const fields = { Email: MEMBER, Status: c.status, AccessEnabled: c.status === 'active' };
  if (c.plan) fields.PlanType = c.plan;
  const exp = EXPIRIES[c.expiry]();
  if (exp !== undefined) fields.ExpirationDate = exp;
  if (c.withdrawal !== 'missing') fields.CancelledAt = new Date(Date.now() - DAY).toISOString();
  db.customers = [{ id: 'recC', fields }];
  db.tokens = [{ id: 'recT', fields: { Token: LINK, Email: MEMBER, Used: false, ExpiresAt: new Date(Date.now() + 600000).toISOString() } }];
  db.updates = [];
  blobs.store = new Map();
  if (c.withdrawal !== 'missing') {
    blobs.store.set(revocationKey(MEMBER), JSON.stringify({
      revokedAtMs: Date.now() - DAY, confirmed: c.withdrawal === 'confirmed', subscriptionId: 'sub_fixture',
    }));
  }
}

const blobStore = { get: async (k) => blobs.store.get(k) ?? null, set: async (k, v) => { blobs.store.set(k, v); } };

let verifyHandler;
let refreshHandler;

before(async () => {
  process.env.AIRTABLE_API_KEY = 'key_test';
  process.env.AIRTABLE_BASE_ID = 'app_test';
  process.env.SESSION_SIGNING_SECRET = SESSION_SECRET;

  mock.module('airtable', {
    defaultExport: class AirtableStub {
      base() {
        return (table) => ({
          select(opts) {
            return {
              async firstPage() {
                const f = String(opts?.filterByFormula || '');
                if (table === 'AuthTokens') {
                  const m = f.match(/\{Token\} = "(.*)"/);
                  return db.tokens.filter((r) => m && r.fields.Token === m[1]);
                }
                const m = f.match(/\{Email\} = "(.*)"/);
                const email = m ? m[1].replace(/\\"/g, '"') : null;
                return db.customers.filter((r) => r.fields.Email === email);
              },
            };
          },
          async update(rows) {
            for (const r of rows) {
              db.updates.push({ table, ...r });
              const list = table === 'AuthTokens' ? db.tokens : db.customers;
              const row = list.find((x) => x.id === r.id);
              Object.assign(row.fields, r.fields);
            }
          },
        });
      }
    },
  });

  mock.module('@netlify/blobs', {
    namedExports: {
      connectLambda() {},
      getStore() { return blobStore; },
    },
  });

  ({ handler: verifyHandler } = await import('../../../netlify/functions/verify-magic-link.js'));
  ({ handler: refreshHandler } = await import('../../../netlify/functions/refresh-session.js'));
});

beforeEach(() => { process.env.SESSION_SIGNING_SECRET = SESSION_SECRET; });

function cookieTier(setCookie) {
  const m = String(setCookie || '').match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  if (!m) return { token: null, tier: null };
  const token = decodeURIComponent(m[1]);
  const v = verifySession({ token, secret: SESSION_SECRET, nowMs: Date.now() });
  return { token, tier: v.ok ? v.session.tier : null };
}

async function login() {
  const res = await verifyHandler({
    httpMethod: 'GET',
    headers: { host: 'example.invalid', origin: 'https://keiba-intelligence.jp' },
    queryStringParameters: { token: LINK },
  });
  return { res, json: JSON.parse(res.body || '{}'), ...cookieTier(res.headers?.['Set-Cookie']) };
}

async function refresh(fromTier) {
  const nowMs = Date.now();
  const signed = signSession({ email: MEMBER, tier: fromTier, secret: SESSION_SECRET, nowMs, ttlSeconds: 3600 });
  assert.ok(signed.ok);
  const res = await refreshHandler({
    httpMethod: 'POST',
    headers: { cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(signed.token)}`, host: 'example.invalid' },
    body: '',
  });
  return { res, json: JSON.parse(res.body || '{}') };
}

async function gate(token) {
  const ent = resolveEntitlement({
    cookieHeader: token ? `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}` : null,
    env: { SESSION_SIGNING_SECRET: SESSION_SECRET },
    nowMs: Date.now() + 1000,
  });
  const checked = await applyRevocation(ent, { store: blobStore });
  const view = viewFlags(checked);
  return { view, redirect: paidPageRedirect(view, '/free-prediction/') };
}

const isPaid = (tier) => tier === TIER.PREMIUM || tier === TIER.LIGHT;

// ------------------------------------------------------------ 1. 純関数

describe('有料権限の判定（純関数）', () => {
  test('有料を出してよい Status は active / payment_failed だけ', () => {
    assert.deepEqual([...PAID_STATUSES].sort(), ['active', 'payment_failed']);
    for (const s of ['inactive', 'pending', 'cancelled', 'suspended', '', null, undefined, 'Active', ' active', ['active'], {}]) {
      assert.equal(isPaidStatus(s), false, String(s));
    }
  });

  test('有効期限: 無し / 未来 / 過去 / 読めない値', () => {
    const now = Date.parse('2026-10-19T00:00:00Z');
    assert.equal(expiryState(undefined, now), 'none');
    assert.equal(expiryState(null, now), 'none');
    assert.equal(expiryState('', now), 'none');
    assert.equal(expiryState('   ', now), 'none');
    assert.equal(expiryState('2026-12-01', now), 'valid');
    assert.equal(expiryState('2099-12-31', now), 'valid');
    assert.equal(expiryState('2026-10-01', now), 'expired');
    assert.equal(expiryState('not-a-date', now), 'invalid');
    assert.equal(expiryState({}, now), 'invalid');
  });

  test('isPaidPlanType は PlanType だけを見る（light / premium / pro）', () => {
    for (const p of ['premium', 'pro', 'pro-plus', 'light', 'PREMIUM']) assert.equal(isPaidPlanType(p), true, p);
    for (const p of ['free', 'free-registered', '', null, undefined, 'vip']) assert.equal(isPaidPlanType(p), false, String(p));
  });

  test('🔴 正しく記録された active 会員の tier は変わらない（Stripe 月額＝期限なし・振込＝未来の期限）', () => {
    const now = Date.now();
    assert.equal(customerSessionTier({ Status: 'active', PlanType: 'premium' }, now), TIER.PREMIUM);
    assert.equal(customerSessionTier({ Status: 'active', PlanType: 'premium', ExpirationDate: EXPIRIES.future() }, now), TIER.PREMIUM);
    assert.equal(customerSessionTier({ Status: 'active', PlanType: 'premium', 有効期限: EXPIRIES.future() }, now), TIER.PREMIUM);
    assert.equal(customerSessionTier({ Status: 'active', PlanType: 'light' }, now), TIER.LIGHT);
    assert.equal(customerSessionTier({ Status: 'active', PlanType: 'free-registered' }, now), TIER.FREE);
  });

  test('🔴 壊れた入力でも有料にならない（guest も返さない）', () => {
    for (const f of [null, undefined, {}, 'premium', { PlanType: 'premium' }, { Status: 'active' }]) {
      const t = customerSessionTier(f, Date.now());
      assert.equal(t, TIER.FREE, JSON.stringify(f));
    }
  });

  test('行列: customerSessionTier が仕様どおり（退会記録の適用前）', () => {
    const bad = [];
    for (const c of matrix()) {
      if (c.withdrawal !== 'missing') continue; // 退会記録は呼び出し側（tierForNewSession）で適用
      const fields = { Status: c.status };
      if (c.plan) fields.PlanType = c.plan;
      const e = EXPIRIES[c.expiry]();
      if (e !== undefined) fields.ExpirationDate = e;
      const got = customerSessionTier(fields, Date.now());
      if (isPaid(got) !== expectPaid(c)) bad.push(`${label(c)} → ${got}`);
    }
    assert.deepEqual(bad, []);
  });
});

describe('ログインリンクの可否と有料権限は独立', () => {
  test('ログインリンクを送れる Status でも、有料は Status=active / payment_failed だけ', () => {
    for (const s of STATUSES) {
      const canLogin = canRequestLoginLink(s);
      assert.equal(canLogin, ['active', 'pending', 'inactive', 'payment_failed'].includes(s), s);
      const paid = isPaid(customerSessionTier({ Status: s, PlanType: 'premium' }, Date.now()));
      assert.equal(paid, isPaidStatus(s), `${s}: ログイン可否（${canLogin}）が有料権限へ漏れている`);
    }
  });

  test('🔴 pending で PlanType が有料（銀行振込の入金確認前）は認証で active にしない', () => {
    assert.equal(verifiedCustomerUpdate({ Status: 'pending', PlanType: 'premium' }), null);
    assert.equal(verifiedCustomerUpdate({ Status: 'pending', PlanType: 'light' }), null);
    assert.equal(verifiedCustomerUpdate({ PlanType: 'premium' }), null);
    // 無料登録者の本人確認は従来どおり
    assert.deepEqual(verifiedCustomerUpdate({ Status: 'pending', PlanType: 'free-registered' }),
      { Status: 'active', AccessEnabled: true });
  });
});

// ------------------------------------------------------------ 2. 実ハンドラで行列

describe('① ログイン（verify-magic-link の実ハンドラ）', () => {
  for (const status of STATUSES) {
    test(`Status=${status}: 有料の Cookie は仕様どおりの組み合わせだけ・契約記録を書き換えない`, async () => {
      const bad = [];
      for (const c of matrix()) {
        if (c.status !== status) continue;
        setup(c);
        const { res, json, tier } = await login();
        if (res.statusCode !== 200) { bad.push(`${label(c)} → HTTP ${res.statusCode}`); continue; }
        if (!tier) { bad.push(`${label(c)} → Cookie なし`); continue; }
        if (isPaid(tier) !== expectPaid(c)) bad.push(`${label(c)} → Cookie tier=${tier}`);
        if (json.session?.tier !== tier) bad.push(`${label(c)} → 応答 tier と Cookie tier が不一致`);
        const after = db.customers[0].fields;
        // 🔴 認証で Status を active にしてよいのは、本人確認前（pending）の無料登録だけ・または既に active
        const promoted = status !== 'active' && after.Status === 'active';
        if (promoted && !(status === 'pending' && c.plan !== 'premium')) bad.push(`${label(c)} → Status を active に書き換えた`);
        if (status === 'pending' && c.plan === 'premium' && after.Status !== 'pending') {
          bad.push(`${label(c)} → 入金確認前の申込を active にした`);
        }
        if (c.plan === 'premium' && after.PlanType !== 'premium') bad.push(`${label(c)} → PlanType を書き換えた`);
      }
      assert.deepEqual(bad, []);
    });
  }
});

describe('② 出し直し（refresh-session の実ハンドラ）', () => {
  for (const fromTier of [TIER.FREE, TIER.PREMIUM]) {
    for (const status of STATUSES) {
      test(`Cookie=${fromTier} Status=${status}: 出し直した tier は仕様どおり`, async () => {
        const bad = [];
        for (const c of matrix()) {
          if (c.status !== status) continue;
          setup(c);
          const { res, json } = await refresh(fromTier);
          if (res.statusCode !== 200) { bad.push(`${label(c)} → HTTP ${res.statusCode}`); continue; }
          if (isPaid(json.tier) !== expectPaid(c)) bad.push(`${label(c)} → tier=${json.tier}`);
          const reissued = cookieTier(res.headers?.['Set-Cookie']).tier;
          if (reissued && reissued !== json.tier) bad.push(`${label(c)} → 応答と Cookie が不一致`);
          if (db.updates.length) bad.push(`${label(c)} → refresh-session が Airtable へ書いた`);
        }
        assert.deepEqual(bad, []);
      });
    }
  }
});

describe('③ ゲート（ログインで得た Cookie で有料ページ・買い目が開くか）', () => {
  for (const status of STATUSES) {
    test(`Status=${status}: 買い目・有料ページは仕様どおりの組み合わせだけ`, async () => {
      const bad = [];
      for (const c of matrix()) {
        if (c.status !== status) continue;
        setup(c);
        const { token } = await login();
        const { view, redirect } = await gate(token);
        const want = expectPaid(c);
        if (view.showBetting !== want) bad.push(`${label(c)} → showBetting=${view.showBetting}`);
        if ((redirect === null) !== want) bad.push(`${label(c)} → 有料ページ入場=${redirect === null}`);
        // ログインはできている（印は見える）
        if (!view.authenticated || !view.showMarks) bad.push(`${label(c)} → ログイン状態になっていない`);
      }
      assert.deepEqual(bad, []);
    });
  }
});

// ------------------------------------------------------------ 3. 静的ガード

describe('発行側が同じ判定を使っている（静的ガード）', () => {
  test('verify-magic-link と refresh-session は customerSessionTier → tierForNewSession', () => {
    for (const p of ['netlify/functions/verify-magic-link.js', 'netlify/functions/refresh-session.js']) {
      const src = read(p);
      assert.match(src, /tierForNewSession\(customerSessionTier\(customer, nowMs\), revocation\)/, p);
      // 🔴 PlanType だけで tier を決める旧経路が残っていない
      assert.equal(/planTypeToTier\(/.test(src), false, `${p} が PlanType だけで tier を決めている`);
    }
  });
});
