/**
 * airtableInjection.handlers.test.mjs — 式インジェクション対策を **実ハンドラ** で確かめる回帰
 *
 * 実行: npm run test:airtable-formula （astro-site 直下から）
 *   node --experimental-test-module-mocks --test src/lib/airtable/airtableInjection.handlers.test.mjs
 *
 * registry 5a5dd591（2026-10-19）。固定すること:
 *   1. verify-magic-link: 形式外の token は Airtable へ問い合わせずに 400
 *   2. verify-magic-link: 正規の token は従来どおり（1 回限り・15 分の有効期限・Cookie 発行）
 *   3. send-magic-link / register-free / bank-transfer-application / start-purchase:
 *      形式外の email は Airtable へ問い合わせずに 400
 *   4. 問い合わせる式は常に「1 つの比較・正しくエスケープされた文字列」
 *
 * 🔴 ネットワークは使わない。`airtable` / `@sendgrid/mail` / `@netlify/blobs` / fetch を差し替える。
 * 🔴 テストのアドレスは実行時に組み立てる（diff に実在風のアドレスを残さない）。
 */

import { test, describe, mock, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { SESSION_COOKIE_NAME } from '../auth/session.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const addr = (local, domain = 'example.com') => [local, domain].join('@');
const MEMBER = addr('member');
const PROD_HOST = 'keiba-intelligence.jp';
const MIN = 60 * 1000;

/** send-magic-link と同じ形（uuid v4）を実行時に組み立てる。 */
const uuidLike = (c) => [c.repeat(8), c.repeat(4), '4' + c.repeat(3), '8' + c.repeat(3), c.repeat(12)].join('-');
const VALID_UUID_TOKEN = uuidLike('a');
const VALID_REGISTER_TOKEN = 'k' + 'q'.repeat(20);

const TOKEN_PAYLOADS = [
  '"',
  '\\',
  '\\"',
  '", TRUE(), "',
  `${VALID_UUID_TOKEN}", TRUE(), "`,
  `${VALID_UUID_TOKEN}" OR "1"="1`,
  '") OR TRUE() OR ("',
  'x" & TRUE() & "',
  '\\", TRUE(), \\"',
  'abc OR(TRUE())',
  'abc AND(1=1)',
  'a'.repeat(10000),
];

const EMAIL_PAYLOADS = [
  addr('a"b'),
  addr('a\\b'),
  `${MEMBER}", TRUE(), "`,
  `${MEMBER}" OR "1"="1`,
  addr('x") OR TRUE() OR ("x'),
  addr('x\\", TRUE(), \\"x'),
  addr('member', 'example.com" & TRUE() & "'),
  `${addr('a'.repeat(300))}`,
  'not-an-email',
];

// ── Airtable の差し替え ─────────────────────────────────────────────
/**
 * 受け付ける式は `{Field} = "literal"`（literal は `\` エスケープ）の 1 比較だけ。
 * それ以外（注入で比較が増えた・リテラルが途中で閉じた）は throw する＝テストが落ちる。
 */
function parseSimpleFormula(formula) {
  const m = /^\{([A-Za-z_]+)\} = "((?:[^"\\]|\\.)*)"$/.exec(String(formula));
  if (!m) throw new Error(`unexpected formula shape: ${formula}`);
  return { field: m[1], value: m[2].replace(/\\(.)/g, '$1') };
}

const db = {
  tables: {},
  selects: [],
  updates: [],
  creates: [],
  reset() {
    this.tables = { AuthTokens: [], Customers: [] };
    this.selects = [];
    this.updates = [];
    this.creates = [];
  },
};

function tableStub(name) {
  return {
    select(opts) {
      db.selects.push({ table: name, formula: opts?.filterByFormula });
      return {
        async firstPage() {
          const { field, value } = parseSimpleFormula(opts?.filterByFormula);
          return (db.tables[name] || []).filter((r) => r.fields[field] === value).slice(0, opts?.maxRecords || 100);
        },
      };
    },
    async update(rows) {
      db.updates.push({ table: name, rows });
      for (const { id, fields } of rows) {
        const r = (db.tables[name] || []).find((x) => x.id === id);
        if (r) Object.assign(r.fields, fields);
      }
      return rows;
    },
    async create(rows) {
      db.creates.push({ table: name, rows });
      return rows.map((r, i) => ({ id: `rec${name}${i}`, ...r }));
    },
  };
}

class AirtableStub {
  constructor() {}
  base() {
    return (name) => tableStub(name);
  }
}

const mail = { sent: [] };
const sgMailStub = {
  setApiKey() {},
  async send(msg) { mail.sent.push(msg); return [{ statusCode: 202 }]; },
};

// ── fetch の差し替え（REST で Airtable を叩く関数用）────────────────
const fetchLog = [];
const realFetch = globalThis.fetch;
function installFetch() {
  globalThis.fetch = async (url, init = {}) => {
    fetchLog.push({ url: String(url), method: init.method || 'GET', body: init.body });
    const u = String(url);
    if (u.startsWith('https://api.airtable.com/')) {
      const q = new URL(u).searchParams.get('filterByFormula');
      if (q !== null && /AND\(/.test(q)) {
        // register-free の式。比較の外へ出ていないことだけ確かめる
        const m = /^AND\(\{Email\} = "((?:[^"\\]|\\.)*)", OR\(\{Source\} = "keiba-intelligence", \{Source\} = BLANK\(\)\)\)$/.exec(q);
        if (!m) throw new Error(`unexpected formula shape: ${q}`);
      } else if (q !== null) {
        parseSimpleFormula(q);
      }
      return new Response(JSON.stringify({ records: [] }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };
}

/** `exports.handler` 形式（CommonJS）の関数を読み込む。依存は stubs で差し替える。 */
function loadCjsFunction(rel, stubs) {
  const filename = path.join(ROOT, rel);
  const m = new Module(filename);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  m.require = (id) => (Object.prototype.hasOwnProperty.call(stubs, id) ? stubs[id] : Module.prototype.require.call(m, id));
  m._compile(readFileSync(filename, 'utf8'), filename);
  return m.exports;
}

let verifyHandler;
let sendMagicLink;
let registerFree;
let bankTransfer;
let startPurchase;

before(async () => {
  process.env.AIRTABLE_API_KEY = 'key_test';
  process.env.AIRTABLE_BASE_ID = 'app_test';
  process.env.SESSION_SIGNING_SECRET = 'session-secret-for-test-only';
  process.env.SENDGRID_API_KEY = 'sg_test';

  mock.module('airtable', { defaultExport: AirtableStub });
  mock.module('@netlify/blobs', {
    namedExports: {
      connectLambda() {},
      getStore() { return { get: async () => null, set: async () => {} }; },
    },
  });

  ({ handler: verifyHandler } = await import('../../../netlify/functions/verify-magic-link.js'));
  ({ handler: startPurchase } = await import('../../../netlify/functions/start-purchase.js'));

  const stubs = { airtable: AirtableStub, '@sendgrid/mail': sgMailStub };
  sendMagicLink = loadCjsFunction('netlify/functions/send-magic-link.js', stubs).handler;
  registerFree = loadCjsFunction('netlify/functions/register-free.js', stubs).handler;
  bankTransfer = loadCjsFunction('netlify/functions/bank-transfer-application.js', stubs).handler;
});

beforeEach(() => {
  db.reset();
  mail.sent = [];
  fetchLog.length = 0;
  installFetch();
});

after(() => {
  globalThis.fetch = realFetch;
});

// ── verify-magic-link ───────────────────────────────────────────────
function seedToken(token, { used = false, expiresInMs = 15 * MIN, email = MEMBER } = {}) {
  db.tables.AuthTokens.push({
    id: `recTOKEN${db.tables.AuthTokens.length}`,
    fields: { Token: token, Email: email, Used: used, ExpiresAt: new Date(Date.now() + expiresInMs).toISOString() },
  });
}
function seedCustomer(email = MEMBER, fields = {}) {
  db.tables.Customers.push({
    id: `recCUST${db.tables.Customers.length}`,
    fields: { Email: email, PlanType: 'free-registered', Status: 'active', AccessEnabled: true, ...fields },
  });
}
async function callVerify(token) {
  const res = await verifyHandler({
    httpMethod: 'GET',
    headers: { host: PROD_HOST },
    queryStringParameters: token === undefined ? {} : { token },
  });
  return { ...res, json: JSON.parse(res.body || '{}') };
}

describe('🔴 verify-magic-link: 形式外の token は問い合わせずに 400', () => {
  for (const payload of TOKEN_PAYLOADS) {
    test(`payload ${JSON.stringify(payload.length > 60 ? `${payload.slice(0, 20)}…(${payload.length})` : payload)}`, async () => {
      seedToken(VALID_UUID_TOKEN);
      seedCustomer();
      const res = await callVerify(payload);
      assert.equal(res.statusCode, 400);
      assert.equal(res.json.error, 'Invalid token');
      assert.equal(db.selects.length, 0, '🔴 Airtable へ問い合わせている');
      assert.equal(db.updates.length, 0, '🔴 書き込んでいる');
      assert.equal(res.headers['Set-Cookie'], undefined, '🔴 Cookie を出している');
    });
  }

  test('token 無しは従来どおり 400', async () => {
    const res = await callVerify(undefined);
    assert.equal(res.statusCode, 400);
    assert.equal(res.json.error, 'Token is required');
    assert.equal(db.selects.length, 0);
  });
});

describe('verify-magic-link: 正規の token は従来どおり', () => {
  for (const [label, token] of [['send-magic-link 形式（uuid v4）', VALID_UUID_TOKEN], ['register-free 形式', VALID_REGISTER_TOKEN]]) {
    test(`${label} でログインできる（Cookie 発行・使用済みにする）`, async () => {
      seedToken(token);
      seedCustomer();
      const res = await callVerify(token);
      assert.equal(res.statusCode, 200);
      assert.equal(res.json.success, true);
      assert.equal(res.json.redirectTo, '/mypage');
      assert.match(res.headers['Set-Cookie'] || '', new RegExp(`^${SESSION_COOKIE_NAME}=`));
      assert.equal(db.tables.AuthTokens[0].fields.Used, true, '使用済みになっていない');
      assert.deepEqual(db.selects.map((s) => s.table), ['AuthTokens', 'Customers']);
    });
  }

  test('🔴 1 回限り: 同じ token の 2 回目は 403', async () => {
    seedToken(VALID_UUID_TOKEN);
    seedCustomer();
    assert.equal((await callVerify(VALID_UUID_TOKEN)).statusCode, 200);
    const second = await callVerify(VALID_UUID_TOKEN);
    assert.equal(second.statusCode, 403);
    assert.equal(second.json.error, 'Token already used');
  });

  test('🔴 15 分の有効期限: 期限切れは 403（使用済みにしない）', async () => {
    seedToken(VALID_UUID_TOKEN, { expiresInMs: -1000 });
    seedCustomer();
    const res = await callVerify(VALID_UUID_TOKEN);
    assert.equal(res.statusCode, 403);
    assert.equal(res.json.error, 'Token expired');
    assert.equal(db.updates.length, 0);
  });

  test('存在しない token は従来どおり 404', async () => {
    const res = await callVerify(uuidLike('b'));
    assert.equal(res.statusCode, 404);
  });

  test('🔴 保存済みの Email に `"` が入っていても、顧客検索の式は 1 比較のまま', async () => {
    const odd = addr('legacy"); TRUE(); ("x');
    seedToken(VALID_UUID_TOKEN, { email: odd });
    seedCustomer(MEMBER);
    seedCustomer(odd);
    const res = await callVerify(VALID_UUID_TOKEN);
    assert.equal(res.statusCode, 200);
    // 別の顧客（MEMBER）に一致していない
    assert.equal(res.json.session.user.email, odd);
    const custSelect = db.selects.find((s) => s.table === 'Customers');
    assert.equal(parseSimpleFormula(custSelect.formula).value, odd);
  });
});

// ── email を受け取る関数 ─────────────────────────────────────────────
const post = (body) => ({ httpMethod: 'POST', headers: { host: PROD_HOST }, body: JSON.stringify(body) });

describe('🔴 send-magic-link: 形式外の email は問い合わせずに 400', () => {
  for (const payload of EMAIL_PAYLOADS) {
    test(`payload ${JSON.stringify(payload.length > 60 ? `${payload.slice(0, 20)}…(${payload.length})` : payload)}`, async () => {
      seedCustomer();
      const res = await sendMagicLink(post({ email: payload }));
      assert.equal(res.statusCode, 400);
      assert.equal(db.selects.length, 0, '🔴 Airtable へ問い合わせている');
      assert.equal(db.creates.length, 0);
      assert.equal(mail.sent.length, 0);
    });
  }

  test('正しい email は従来どおり送る（uuid v4 の token・15 分）', async () => {
    seedCustomer();
    const before = Date.now();
    const res = await sendMagicLink(post({ email: MEMBER }));
    assert.equal(res.statusCode, 200);
    assert.equal(parseSimpleFormula(db.selects[0].formula).value, MEMBER);
    const created = db.creates[0].rows[0].fields;
    const { isValidMagicLinkToken } = await import('../auth/magicLinkToken.js');
    assert.equal(isValidMagicLinkToken(created.Token), true, '🔴 発行した token を verify 側が受け付けない');
    const ttl = new Date(created.ExpiresAt).getTime() - before;
    assert.ok(ttl > 14 * MIN && ttl <= 15 * MIN + 1000, '有効期限が 15 分でない');
    assert.equal(mail.sent.length, 1);
  });
});

describe('🔴 register-free: 形式外の email は問い合わせずに 400', () => {
  for (const payload of EMAIL_PAYLOADS) {
    test(`payload ${JSON.stringify(payload.length > 60 ? `${payload.slice(0, 20)}…(${payload.length})` : payload)}`, async () => {
      const res = await registerFree(post({ email: payload }));
      assert.equal(res.statusCode, 400);
      assert.equal(fetchLog.length, 0, '🔴 外部へ問い合わせている');
    });
  }

  test('正しい email は Airtable 検索へ進み、式は 1 比較のまま', async () => {
    await registerFree(post({ email: MEMBER }));
    const search = fetchLog.find((f) => f.url.includes('/Customers?filterByFormula='));
    assert.ok(search, 'Airtable 検索へ進んでいない');
  });

  test('🔴 発行した token を verify 側が受け付ける', async () => {
    const { isValidMagicLinkToken } = await import('../auth/magicLinkToken.js');
    await registerFree(post({ email: MEMBER }));
    const save = fetchLog.find((f) => f.url.endsWith('/AuthTokens') && f.method === 'POST');
    assert.ok(save, 'AuthTokens へ保存していない');
    const token = JSON.parse(save.body).records[0].fields.Token;
    assert.equal(isValidMagicLinkToken(token), true, '🔴 発行した token を verify 側が受け付けない');
  });
});

describe('🔴 bank-transfer-application: 形式外の email は送信・問い合わせ前に 400', () => {
  const base = { fullName: 'テスト', transferDate: '2026-10-19', transferAmount: 1, productName: 'x', planType: 'x', timestamp: new Date().toISOString() };
  for (const payload of EMAIL_PAYLOADS) {
    test(`payload ${JSON.stringify(payload.length > 60 ? `${payload.slice(0, 20)}…(${payload.length})` : payload)}`, async () => {
      const res = await bankTransfer(post({ ...base, email: payload }));
      assert.equal(res.statusCode, 400);
      assert.equal(fetchLog.length, 0, '🔴 メール送信・Airtable へ進んでいる');
    });
  }
});

describe('🔴 start-purchase: 形式外の email は問い合わせずに 400', () => {
  for (const payload of EMAIL_PAYLOADS) {
    test(`payload ${JSON.stringify(payload.length > 60 ? `${payload.slice(0, 20)}…(${payload.length})` : payload)}`, async () => {
      const res = await startPurchase(post({ email: payload, plan: 'premium-monthly' }));
      assert.equal(res.statusCode, 400);
      assert.equal(JSON.parse(res.body).error, 'invalid_email');
      assert.equal(fetchLog.length, 0);
    });
  }
});
