/**
 * bankTransferApplication.handlers.test.mjs — 銀行振込申込フォームが既存顧客を書き換えない回帰
 *
 * 実行: npm run test:bank-transfer-application （astro-site 直下から）
 *   node src/lib/billing/bankTransferApplication.handlers.test.mjs
 *
 * 🔴 `node --test` 経由で動かさない。ハンドラが console.* を出すため、
 *    test runner の IPC と混ざって不安定になる（KI #154 / #166）。直接 `node` で実行する。
 *
 * registry 65c799ef（2026-10-19）。固定すること:
 *   1. 未認証の申込で、既存顧客（有料 active 等）の Customers レコードを一切更新しない
 *      （Status / Plan / PlanType / Name / 有効期限 / AccessEnabled を書かない・PATCH も DELETE もしない）
 *   2. 新規のアドレスは従来どおり Status=pending / AccessEnabled=false で作成する
 *   3. 応答・申請者向けメールは既存 / 新規で同じ（アカウントの存在を推測させない）
 *   4. 照会の式は 1 比較・エスケープ済み（式インジェクション対策は維持）
 *   5. 照会に失敗したら書き込まない（fail-closed）
 *   6. ログにメールアドレスを平文で出さない
 *
 * 🔴 ネットワークは使わない。fetch を差し替える（Airtable REST / SendGrid）。
 * 🔴 テストのアドレスは実行時に組み立てる（diff に実在風のアドレスを残さない）。
 */

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { escapeFormulaString } from '../airtable/formula.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const REL = 'netlify/functions/bank-transfer-application.js';
const addr = (local, domain = 'example.com') => [local, domain].join('@');
const PAYING = addr('paying.member');
const NEWCOMER = addr('newcomer');
const PROD_HOST = 'keiba-intelligence.jp';
const FIXED_TS = '2026-10-19T03:00:00.000Z';

/** `exports.handler` 形式（CommonJS）の関数を読み込む（package.json が type:module のため）。 */
function loadCjsFunction(rel) {
  const filename = path.join(ROOT, rel);
  const m = new Module(filename);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  m._compile(readFileSync(filename, 'utf8'), filename);
  return m.exports;
}

/** 受け付ける式は `{Field} = "literal"` の 1 比較だけ。 */
function parseSimpleFormula(formula) {
  const m = /^\{([A-Za-z_]+)\} = "((?:[^"\\]|\\.)*)"$/.exec(String(formula));
  if (!m) throw new Error(`unexpected formula shape: ${formula}`);
  return { field: m[1], value: m[2].replace(/\\(.)/g, '$1'), raw: m[2] };
}

// ── fetch の差し替え ────────────────────────────────────────────────
const state = {
  customers: [],
  calls: [],
  searchMode: 'ok', // 'ok' | 'http_error' | 'bad_shape' | 'throw'
};
const realFetch = globalThis.fetch;
function installFetch() {
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    state.calls.push({ url: u, method, body: init.body });
    if (u.startsWith('https://api.airtable.com/')) {
      const q = new URL(u).searchParams.get('filterByFormula');
      if (method === 'GET' && q !== null) {
        if (state.searchMode === 'throw') throw new Error('network down');
        if (state.searchMode === 'http_error') return new Response('{}', { status: 500 });
        if (state.searchMode === 'bad_shape') return new Response('{"oops":true}', { status: 200 });
        const { field, value } = parseSimpleFormula(q);
        const records = state.customers.filter((r) => r.fields[field] === value);
        return new Response(JSON.stringify({ records }), { status: 200 });
      }
      if (method === 'POST') {
        const body = JSON.parse(init.body);
        return new Response(JSON.stringify({ id: 'recNEW', ...body }), { status: 200 });
      }
      // PATCH / PUT / DELETE は呼ばれてはいけない。呼ばれたら記録だけ残して成功を返す
      return new Response('{}', { status: 200 });
    }
    if (u.startsWith('https://api.sendgrid.com/')) {
      return new Response('{}', { status: 202 });
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
}

// ── console の捕捉（平文アドレスの漏れ検査・出力の抑止）──────────────
const logs = [];
const realConsole = {};
function captureConsole() {
  for (const k of ['log', 'warn', 'error', 'info']) {
    realConsole[k] = console[k];
    console[k] = (...args) => logs.push(args.map((a) => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(' ') + ' ' + args.map(String).join(' '));
  }
}
function restoreConsole() {
  for (const k of Object.keys(realConsole)) console[k] = realConsole[k];
}

const post = (body) => ({ httpMethod: 'POST', headers: { host: PROD_HOST, origin: 'https://keiba-intelligence.jp' }, body: JSON.stringify(body) });
const form = (email, extra = {}) => ({
  fullName: '攻撃 太郎',
  email,
  transferDate: '2026-10-19',
  transferTime: '12:00',
  transferAmount: 39800,
  transferName: 'ｺｳｹﾞｷ ﾀﾛｳ',
  remarks: '',
  productName: 'プロプラン 年払い',
  planType: 'yearly',
  timestamp: FIXED_TS,
  ...extra,
});

const airtableWrites = () => state.calls.filter((c) => c.url.startsWith('https://api.airtable.com/') && c.method !== 'GET');
const customerSearches = () => state.calls.filter((c) => c.url.startsWith('https://api.airtable.com/') && c.method === 'GET');
const mailSends = () => state.calls.filter((c) => c.url === 'https://api.sendgrid.com/v3/mail/send');
const marketingPuts = () => state.calls.filter((c) => c.url === 'https://api.sendgrid.com/v3/marketing/contacts');
/** [admin, user] の順で送られる */
const sentMails = () => mailSends().map((c) => JSON.parse(c.body));

function seedCustomer(email, fields) {
  const rec = { id: `recCUST${state.customers.length}`, fields: { Email: email, ...fields } };
  state.customers.push(rec);
  return rec;
}

let handler;

before(() => {
  process.env.AIRTABLE_API_KEY = 'key_test';
  process.env.AIRTABLE_BASE_ID = 'app_test';
  process.env.SENDGRID_API_KEY = 'sg_test';
  delete process.env.SENDGRID_FROM_EMAIL;
  delete process.env.ADMIN_EMAIL;
  captureConsole();
  handler = loadCjsFunction(REL).handler;
});

beforeEach(() => {
  state.customers = [];
  state.calls = [];
  state.searchMode = 'ok';
  logs.length = 0;
  installFetch();
});

after(() => {
  globalThis.fetch = realFetch;
  restoreConsole();
});

// ── 1. 既存顧客を書き換えない ───────────────────────────────────────
const EXISTING_CASES = [
  ['有料 active（premium）', { Name: '本人', Plan: 'premium', PlanType: 'premium', Status: 'active', AccessEnabled: true, ExpirationDate: '2027-10-01', PaymentMethod: 'Stripe' }],
  ['有料 payment_failed', { Name: '本人', PlanType: 'premium', Status: 'payment_failed', AccessEnabled: true }],
  ['銀行振込 pro active', { Name: '本人', Plan: 'pro', PlanType: 'pro', Status: 'active', AccessEnabled: true, ExpirationDate: '2027-01-01', PaymentMethod: 'Bank Transfer', PaymentEmailSent: true }],
  ['無料登録 active', { Name: '本人', PlanType: 'free-registered', Status: 'active', AccessEnabled: true }],
  ['申込中 pending', { Name: '本人', PlanType: 'pro', Status: 'pending', AccessEnabled: false }],
  ['契約終了 inactive', { Name: '本人', PlanType: 'premium', Status: 'inactive', AccessEnabled: false }],
];

describe('🔴 未認証の申込で既存顧客のレコードを変更しない（registry 65c799ef）', () => {
  for (const [label, fields] of EXISTING_CASES) {
    test(label, async () => {
      const rec = seedCustomer(PAYING, fields);
      const before = structuredClone(rec.fields);
      const res = await handler(post(form(PAYING)));

      assert.equal(res.statusCode, 200);
      assert.equal(JSON.parse(res.body).success, true);
      assert.deepEqual(airtableWrites(), [], '🔴 Airtable へ書き込んでいる（PATCH / POST / DELETE）');
      assert.deepEqual(rec.fields, before);
      assert.equal(customerSearches().length, 1, '照会は 1 回だけ');

      // 運営には「既存・未変更」と分かるように届く
      const [admin, user] = sentMails();
      assert.equal(mailSends().length, 2);
      assert.match(admin.content[0].value, /既存の顧客レコードがあります/);
      assert.match(admin.content[0].value, /自動では変更していません/);
      // 申請者向けには顧客レコードの状態を出さない
      assert.doesNotMatch(user.content[0].value, /既存|顧客レコード/);

      // マーケティング連絡先の氏名を未認証の入力で上書きしない
      const [mk] = marketingPuts();
      assert.ok(mk, 'マーケティング登録が呼ばれていない');
      const contact = JSON.parse(mk.body).contacts[0];
      assert.equal('first_name' in contact, false);
      assert.equal('last_name' in contact, false);
    });
  }

  test('ハンドラに Customers を更新する経路（PATCH）が残っていない', () => {
    const src = readFileSync(path.join(ROOT, REL), 'utf8');
    assert.doesNotMatch(src, /method:\s*'PATCH'/);
    assert.doesNotMatch(src, /'Status':\s*'pending'[\s\S]*'Status':\s*'pending'/, 'pending を書く箇所は新規作成の 1 か所だけ');
  });
});

// ── 2. 新規は従来どおり ─────────────────────────────────────────────
describe('新規のアドレスは従来どおり pending で作成する', () => {
  test('Customers へ 1 件 POST・Status=pending・AccessEnabled=false・pro', async () => {
    const res = await handler(post(form(NEWCOMER)));
    assert.equal(res.statusCode, 200);

    const writes = airtableWrites();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].method, 'POST');
    assert.equal(writes[0].url, 'https://api.airtable.com/v0/app_test/Customers');
    const { fields } = JSON.parse(writes[0].body);
    assert.equal(fields.Email, NEWCOMER);
    assert.equal(fields.Name, '攻撃 太郎');
    assert.equal(fields.Status, 'pending');
    assert.equal(fields.AccessEnabled, false);
    assert.equal(fields.PlanType, 'pro');
    assert.equal(fields.Plan, 'pro');
    assert.equal(fields.plan_type, 'yearly');
    assert.equal(fields.PaymentMethod, 'Bank Transfer');
    assert.equal(fields.PaymentEmailSent, false);
    assert.equal('VenueAccess' in fields, false);

    const [admin] = sentMails();
    assert.match(admin.content[0].value, /新規の申込として Airtable に Status=pending で登録します/);

    const contact = JSON.parse(marketingPuts()[0].body).contacts[0];
    assert.equal(contact.first_name, '攻撃');
    assert.equal(contact.last_name, '太郎');
  });

  test('メール送信が先に失敗したら Airtable へ書かない（従来どおり 500）', async () => {
    globalThis.fetch = async (url, init = {}) => {
      state.calls.push({ url: String(url), method: (init.method || 'GET').toUpperCase(), body: init.body });
      if (String(url).startsWith('https://api.airtable.com/')) return new Response(JSON.stringify({ records: [] }), { status: 200 });
      return new Response('bad', { status: 500 });
    };
    const res = await handler(post(form(NEWCOMER)));
    assert.equal(res.statusCode, 500);
    assert.deepEqual(airtableWrites(), []);
  });
});

// ── 3. アカウントの存在を推測させない ───────────────────────────────
describe('🔴 応答・申請者向けメールは既存 / 新規で同じ', () => {
  test('同じ statusCode・headers・body、同じ申請者向けメール', async () => {
    seedCustomer(PAYING, { Name: '本人', PlanType: 'premium', Status: 'active', AccessEnabled: true });

    const resExisting = await handler(post(form(PAYING)));
    const userExisting = sentMails()[1];

    state.calls = [];
    // 新規側も同じアドレスで比べる（宛先の違いで差が出ないように）。顧客を消して新規扱いにする
    state.customers = [];
    const resNew = await handler(post(form(PAYING)));
    const userNew = sentMails()[1];

    assert.equal(resExisting.statusCode, resNew.statusCode);
    assert.deepEqual(resExisting.headers, resNew.headers);
    assert.equal(resExisting.body, resNew.body);
    assert.deepEqual(userExisting, userNew, '🔴 申請者向けメールが既存 / 新規で違う');
  });
});

// ── 4. 式のエスケープ ───────────────────────────────────────────────
describe('🔴 照会の式は 1 比較・エスケープ済み', () => {
  for (const email of [NEWCOMER, addr("o'brien+tag"), addr('a.b-c_d', 'sub.example.co.jp')]) {
    test(email.replace(/@.*/, '@…'), async () => {
      await handler(post(form(email)));
      const [search] = customerSearches();
      assert.ok(search);
      const q = new URL(search.url).searchParams.get('filterByFormula');
      const parsed = parseSimpleFormula(q);
      assert.equal(parsed.field, 'Email');
      assert.equal(parsed.raw, escapeFormulaString(email));
      assert.equal(parsed.value, email);
    });
  }

  test('形式外の email は照会・送信より前に 400', async () => {
    const res = await handler(post(form(`${PAYING}", TRUE(), "`)));
    assert.equal(res.statusCode, 400);
    assert.equal(state.calls.length, 0);
  });
});

// ── 5. 照会失敗は fail-closed ───────────────────────────────────────
describe('🔴 照会に失敗したら書き込まない（fail-closed）', () => {
  for (const mode of ['http_error', 'bad_shape', 'throw']) {
    test(mode, async () => {
      seedCustomer(PAYING, { Name: '本人', PlanType: 'premium', Status: 'active', AccessEnabled: true });
      state.searchMode = mode;
      const res = await handler(post(form(PAYING)));
      assert.equal(res.statusCode, 200, '申込自体（メール）は受け付ける');
      assert.equal(JSON.parse(res.body).success, true);
      assert.deepEqual(airtableWrites(), []);
      const [admin] = sentMails();
      assert.match(admin.content[0].value, /照会に失敗したため、顧客レコードは登録・変更していません/);
      const contact = JSON.parse(marketingPuts()[0].body).contacts[0];
      assert.equal('first_name' in contact, false);
    });
  }
});

// ── 6. ログ ─────────────────────────────────────────────────────────
describe('🔴 ログにメールアドレスを平文で出さない', () => {
  test('既存 / 新規 / 照会失敗のどれでも', async () => {
    seedCustomer(PAYING, { Name: '本人', PlanType: 'premium', Status: 'active' });
    await handler(post(form(PAYING)));
    await handler(post(form(NEWCOMER)));
    state.searchMode = 'http_error';
    await handler(post(form(PAYING)));
    const all = logs.join('\n');
    assert.ok(logs.length > 0, 'ログが捕捉できていない');
    assert.equal(all.includes(PAYING), false);
    assert.equal(all.includes(NEWCOMER), false);
    assert.equal(all.includes('攻撃 太郎'), false, '氏名をログに出している');
  });
});
