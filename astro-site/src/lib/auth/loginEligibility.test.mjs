/**
 * loginEligibility.test.mjs — 確認リンク切れ・退会後・決済失敗の人がログインで行き止まりにならない
 *
 * 実行: npm run test:login-eligibility （astro-site 直下から）
 *   node --experimental-test-module-mocks src/lib/auth/loginEligibility.test.mjs
 *   🔴 `--test` を付けない（実ハンドラがログを出すため。progress.md 2026-10-07 の flake と同じ理由）
 *
 * 正本: docs/measurements/LOGIN_RECOVERY_2026_10.md
 *
 * 固定すること:
 *   1. ログインリンクを送る Status は active / pending / inactive / payment_failed だけ（未知・停止は送らない）
 *   2. 認証で書くのは本人確認の完了（pending → active）だけ。契約終了・決済失敗の記録は消さない
 *   3. 🔴 権限は変えない: inactive（PlanType=free）で認証しても Cookie は free。退会記録があれば有料は出ない
 *
 * 🔴 ネットワークは使わない。`airtable` と `@netlify/blobs` だけ差し替え、verify-magic-link の実コードを動かす。
 */

import { test, describe, mock, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { LOGIN_LINK_STATUSES, canRequestLoginLink, verifiedCustomerUpdate } from './loginEligibility.js';
import { TIER } from './tiers.js';
import { verifySession, SESSION_COOKIE_NAME } from './session.js';
import { revocationKey } from './revocation.js';

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(siteRoot, p), 'utf8');

const SESSION_SECRET = ['session', 'fixture', 'value'].join('-');
/** 🔴 実在しないドメイン（実行時に組み立てる）。 */
const MEMBER = ['member', 'example.invalid'].join('@');
/** token の形は発行元（英数字）と同じにする（形式検証が入っても通る値）。 */
const LINK = ['probe', 'link', '7'].join('');

// ------------------------------------------------------------ 1. 方針（純関数）

describe('ログインリンクを送ってよい Status', () => {
  test('active / pending / inactive / payment_failed は送る', () => {
    for (const s of ['active', 'pending', 'inactive', 'payment_failed']) {
      assert.equal(canRequestLoginLink(s), true, s);
    }
    assert.deepEqual([...LOGIN_LINK_STATUSES].sort(), ['active', 'inactive', 'payment_failed', 'pending']);
  });

  test('🔴 停止（suspended）・旧運用（cancelled）・未知・空・型違いは送らない（fail-closed）', () => {
    for (const s of ['suspended', 'cancelled', 'Active', ' active', '', null, undefined, 1, {}, ['active']]) {
      assert.equal(canRequestLoginLink(s), false, String(s));
    }
  });
});

describe('認証成功時に Customers へ書くもの', () => {
  test('pending → active + AccessEnabled（本人確認の完了。従来どおり）', () => {
    assert.deepEqual(verifiedCustomerUpdate({ Status: 'pending', PlanType: 'free-registered' }),
      { Status: 'active', AccessEnabled: true });
  });

  test('active は従来どおり同じ値を書く（挙動不変）', () => {
    assert.deepEqual(verifiedCustomerUpdate({ Status: 'active', PlanType: 'premium' }),
      { Status: 'active', AccessEnabled: true });
  });

  test('🔴 inactive / payment_failed の記録は消さない', () => {
    assert.equal(verifiedCustomerUpdate({ Status: 'inactive', PlanType: 'free' }), null);
    assert.equal(verifiedCustomerUpdate({ Status: 'payment_failed', PlanType: 'premium' }), null);
  });

  test('PlanType が空なら free-registered（有料プランは上書きしない）', () => {
    assert.deepEqual(verifiedCustomerUpdate({ Status: 'inactive' }), { PlanType: 'free-registered' });
    assert.deepEqual(verifiedCustomerUpdate({}), { Status: 'active', AccessEnabled: true, PlanType: 'free-registered' });
    assert.equal('PlanType' in (verifiedCustomerUpdate({ Status: 'pending', PlanType: 'premium' }) || {}), false);
  });
});

describe('関数が方針を使っている（静的ガード）', () => {
  test('send-magic-link は canRequestLoginLink で判定し、active 以外を一律に止めない', () => {
    const src = read('netlify/functions/send-magic-link.js');
    assert.match(src, /if \(!canRequestLoginLink\(customer\.Status\)\)/);
    assert.doesNotMatch(src, /customer\.Status !== 'active'/);
    // 403 の応答形は従来どおり（login.astro の文言分岐が依存）
    assert.match(src, /statusCode: 403,[\s\S]{0,80}Account is not active/);
  });

  test('🔴 send-magic-link の有効期限・token の作り方は変えていない', () => {
    const src = read('netlify/functions/send-magic-link.js');
    assert.match(src, /const token = uuidv4\(\);/);
    assert.match(src, /new Date\(Date\.now\(\) \+ 15 \* 60 \* 1000\)/);
  });

  test('🔴 loginEligibility は tier・セッション・署名鍵に触れない', () => {
    const src = read('src/lib/auth/loginEligibility.js');
    const code = src.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    for (const w of ['SESSION_SIGNING_SECRET', 'signSession', 'TIER', 'planTypeToTier', 'canSeeBetting']) {
      assert.equal(code.includes(w), false, w);
    }
  });
});

// ------------------------------------------------------------ 2. verify-magic-link の実ハンドラ

const db = {
  customers: [],
  tokens: [],
  updates: [],
  reset(fields) {
    this.customers = [{ id: 'recC', fields: { Email: MEMBER, ...fields } }];
    this.tokens = [{ id: 'recT', fields: { Token: LINK, Email: MEMBER, Used: false, ExpiresAt: new Date(Date.now() + 600000).toISOString() } }];
    this.updates = [];
  },
};
const blobs = { store: new Map() };
let handler;

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
                return db.customers.filter((r) => m && r.fields.Email === m[1]);
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
      getStore() {
        return { get: async (k) => blobs.store.get(k) ?? null, set: async (k, v) => { blobs.store.set(k, v); } };
      },
    },
  });

  ({ handler } = await import('../../../netlify/functions/verify-magic-link.js'));
});

beforeEach(() => { blobs.store = new Map(); });

async function verify() {
  const res = await handler({
    httpMethod: 'GET',
    headers: { host: 'example.invalid', origin: 'https://keiba-intelligence.jp' },
    queryStringParameters: { token: LINK },
  });
  const m = String(res.headers?.['Set-Cookie'] || '').match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  const cookie = m ? verifySession({ token: decodeURIComponent(m[1]), secret: SESSION_SECRET, nowMs: Date.now() }) : null;
  return { res, json: JSON.parse(res.body || '{}'), cookie };
}

const customerUpdates = () => db.updates.filter((u) => u.table === 'Customers');

describe('verify-magic-link（実ハンドラ）', () => {
  test('pending（確認リンクを開いた無料登録者）→ active・free のセッション', async () => {
    db.reset({ Status: 'pending', PlanType: 'free-registered', AccessEnabled: false });
    const { res, json, cookie } = await verify();
    assert.equal(res.statusCode, 200);
    assert.equal(json.redirectTo, '/mypage');
    assert.deepEqual(customerUpdates().map((u) => u.fields), [{ Status: 'active', AccessEnabled: true }]);
    assert.equal(cookie?.ok, true);
    assert.equal(cookie.session.tier, TIER.FREE);
  });

  test('🔴 inactive（契約終了）→ ログインできるが free のまま・Status を書き換えない', async () => {
    db.reset({ Status: 'inactive', PlanType: 'free', AccessEnabled: false });
    const { res, cookie } = await verify();
    assert.equal(res.statusCode, 200);
    assert.deepEqual(customerUpdates(), [], '🔴 契約終了の記録を active に戻した');
    assert.equal(db.customers[0].fields.Status, 'inactive');
    assert.equal(db.customers[0].fields.AccessEnabled, false);
    assert.equal(cookie.session.tier, TIER.FREE, '🔴 契約終了者に有料のセッションを出した');
  });

  test('🔴 inactive でも退会記録が未反映なら有料は出さない（Airtable が premium のまま）', async () => {
    db.reset({ Status: 'inactive', PlanType: 'premium' });
    blobs.store.set(revocationKey(MEMBER), JSON.stringify({ revokedAtMs: Date.now() - 1000, confirmed: false, reason: 'withdrawn' }));
    const { res, cookie } = await verify();
    assert.equal(res.statusCode, 200);
    assert.notEqual(cookie.session.tier, TIER.PREMIUM);
  });

  test('payment_failed（決済失敗）→ 権限は PlanType のまま（即時停止しない）・Status を書き換えない', async () => {
    db.reset({ Status: 'payment_failed', PlanType: 'premium', AccessEnabled: true });
    const { res, cookie } = await verify();
    assert.equal(res.statusCode, 200);
    assert.deepEqual(customerUpdates(), []);
    assert.equal(db.customers[0].fields.Status, 'payment_failed');
    assert.equal(cookie.session.tier, TIER.PREMIUM);
  });

  test('使用済み・期限切れの token は従来どおり 403（認証の意味は変えない）', async () => {
    db.reset({ Status: 'active', PlanType: 'free-registered' });
    db.tokens[0].fields.Used = true;
    let r = await verify();
    assert.equal(r.res.statusCode, 403);
    assert.equal(r.json.error, 'Token already used');

    db.reset({ Status: 'active', PlanType: 'free-registered' });
    db.tokens[0].fields.ExpiresAt = new Date(Date.now() - 1000).toISOString();
    r = await verify();
    assert.equal(r.res.statusCode, 403);
    assert.equal(r.json.error, 'Token expired');
    assert.deepEqual(customerUpdates(), []);
  });
});
