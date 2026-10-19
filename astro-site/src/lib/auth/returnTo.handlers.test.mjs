/**
 * returnTo.handlers.test.mjs — ログイン後に元のページへ戻る（実ハンドラ）
 *
 * 実行: node --experimental-test-module-mocks src/lib/auth/returnTo.handlers.test.mjs
 *   🔴 `--test` を付けない（実ハンドラがログを出すため。KI #154 / #166・progress.md 2026-10-07 の flake と同じ理由）
 *
 * 正本: docs/measurements/LOGIN_RETURN_TO_2026_10.md
 *
 * 固定すること:
 *   1. send-magic-link: 許可リストの `next` だけをマジックリンクへ載せる。不正値は載せない。購入意図があれば載せない
 *   2. verify-magic-link: 許可リストの `next` へ戻す。不正値・未指定は /mypage。購入意図が最優先
 *   3. 🔴 戻り先で tier は変わらない（Cookie の tier は従来どおり）。email を URL に載せない
 *
 * 🔴 ネットワークは使わない。`airtable` / `@sendgrid/mail` / `@netlify/blobs` を差し替える。
 * 🔴 テストのアドレスは実行時に組み立てる（diff に実在風のアドレスを残さない）。
 */
import { test, describe, mock, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { verifySession, SESSION_COOKIE_NAME } from './session.js';
import { TIER } from './tiers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MEMBER = ['member', 'example.invalid'].join('@');
const PROD_HOST = 'keiba-intelligence.jp';
const SESSION_SECRET = ['session', 'fixture', 'value'].join('-');
const LINK = ['probe', 'link', '9'].join('');

// ── Airtable / SendGrid の差し替え ─────────────────────────────────
const db = {
  customers: [],
  tokens: [],
  creates: [],
  reset(fields = {}) {
    this.customers = [{ id: 'recC', fields: { Email: MEMBER, Name: 'テスト', Status: 'active', PlanType: 'premium', ...fields } }];
    this.tokens = [{ id: 'recT', fields: { Token: LINK, Email: MEMBER, Used: false, ExpiresAt: new Date(Date.now() + 600000).toISOString() } }];
    this.creates = [];
  },
};

class AirtableStub {
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
          const list = table === 'AuthTokens' ? db.tokens : db.customers;
          const row = list.find((x) => x.id === r.id);
          if (row) Object.assign(row.fields, r.fields);
        }
        return rows;
      },
      async create(rows) {
        db.creates.push({ table, rows });
        return rows.map((r, i) => ({ id: `rec${table}${i}`, ...r }));
      },
    });
  }
}

const mail = { sent: [] };
const sgMailStub = {
  setApiKey() {},
  async send(msg) { mail.sent.push(msg); return [{ statusCode: 202 }]; },
};

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

before(async () => {
  process.env.AIRTABLE_API_KEY = 'key_test';
  process.env.AIRTABLE_BASE_ID = 'app_test';
  process.env.SESSION_SIGNING_SECRET = SESSION_SECRET;
  process.env.SENDGRID_API_KEY = 'sg_test';
  delete process.env.MAGIC_LINK_BASE_URL;

  mock.module('airtable', { defaultExport: AirtableStub });
  mock.module('@netlify/blobs', {
    namedExports: {
      connectLambda() {},
      getStore() { return { get: async () => null, set: async () => {} }; },
    },
  });

  ({ handler: verifyHandler } = await import('../../../netlify/functions/verify-magic-link.js'));
  sendMagicLink = loadCjsFunction('netlify/functions/send-magic-link.js', { airtable: AirtableStub, '@sendgrid/mail': sgMailStub }).handler;
});

beforeEach(() => {
  db.reset();
  mail.sent = [];
});

// ── helpers ────────────────────────────────────────────────────────
async function send(body) {
  const res = await sendMagicLink({ httpMethod: 'POST', headers: { host: PROD_HOST }, body: JSON.stringify(body) });
  const html = mail.sent[0]?.html || '';
  const href = (html.match(/href="([^"]+)"/) || [])[1] || null;
  return { res, link: href ? new URL(href) : null };
}

async function verify(extra = {}) {
  const res = await verifyHandler({
    httpMethod: 'GET',
    headers: { host: PROD_HOST, origin: 'https://keiba-intelligence.jp' },
    queryStringParameters: { token: LINK, ...extra },
  });
  const m = String(res.headers?.['Set-Cookie'] || '').match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  const cookie = m ? verifySession({ token: decodeURIComponent(m[1]), secret: SESSION_SECRET, nowMs: Date.now() }) : null;
  return { res, json: JSON.parse(res.body || '{}'), cookie };
}

const BAD_NEXT = [
  'https://evil.example/prediction/jra',
  '//evil.example',
  '/\\evil.example',
  '/%2F%2Fevil.example',
  '/prediction/../admin',
  '/admin',
  '/pricing',
  'javascript:alert(1)',
  '/prediction/' + 'a'.repeat(300),
  ['/prediction/jra'],
  { path: '/prediction/jra' },
];

// ── send-magic-link ───────────────────────────────────────────────
describe('send-magic-link（実ハンドラ）: マジックリンクに載せる戻り先', () => {
  test('許可リストの next を載せる（token と next だけ・email は載せない）', async () => {
    const { res, link } = await send({ email: MEMBER, next: '/prediction/nankan' });
    assert.equal(res.statusCode, 200);
    assert.equal(link.origin, 'https://keiba-intelligence.jp');
    assert.equal(link.pathname, '/auth/verify');
    assert.equal(link.searchParams.get('next'), '/prediction/nankan');
    assert.deepEqual([...link.searchParams.keys()].sort(), ['next', 'token']);
    assert.equal(link.href.includes(MEMBER) || link.href.includes(encodeURIComponent(MEMBER)), false, '🔴 email を URL に載せた');
  });

  test('next が無ければ従来どおり token だけ', async () => {
    const { res, link } = await send({ email: MEMBER });
    assert.equal(res.statusCode, 200);
    assert.deepEqual([...link.searchParams.keys()], ['token']);
  });

  for (const bad of BAD_NEXT) {
    test(`🔴 不正な next は載せない: ${JSON.stringify(bad).slice(0, 40)}`, async () => {
      const { res, link } = await send({ email: MEMBER, next: bad });
      assert.equal(res.statusCode, 200, 'ログイン自体は止めない');
      assert.equal(link.searchParams.has('next'), false);
      assert.deepEqual([...link.searchParams.keys()], ['token']);
    });
  }

  test('🔴 購入意図があれば購入が優先（next は載せない）', async () => {
    const { res, link } = await send({ email: MEMBER, intent: 'premium', next: '/prediction/jra' });
    assert.equal(res.statusCode, 200);
    assert.equal(link.searchParams.get('intent'), 'premium');
    assert.equal(link.searchParams.has('next'), false);
  });
});

// ── verify-magic-link ─────────────────────────────────────────────
describe('verify-magic-link（実ハンドラ）: 認証後の戻り先', () => {
  test('next が無ければ従来どおり /mypage', async () => {
    const { res, json } = await verify();
    assert.equal(res.statusCode, 200);
    assert.equal(json.redirectTo, '/mypage');
  });

  for (const p of ['/prediction/jra', '/prediction/2026-10-19-ooi-11r', '/free-prediction/jra/2026-10-19', '/results/2026/10/19', '/mypage']) {
    test(`許可リストの next へ戻す: ${p}`, async () => {
      const { res, json } = await verify({ next: p });
      assert.equal(res.statusCode, 200);
      assert.equal(json.redirectTo, p);
    });
  }

  for (const bad of BAD_NEXT.filter((b) => typeof b === 'string')) {
    test(`🔴 不正な next は /mypage へ倒す: ${JSON.stringify(bad).slice(0, 40)}`, async () => {
      const { res, json } = await verify({ next: bad });
      assert.equal(res.statusCode, 200);
      assert.equal(json.redirectTo, '/mypage');
    });
  }

  test('🔴 購入意図が最優先（next があっても /pricing?resume=）', async () => {
    const { json } = await verify({ next: '/prediction/jra', intent: 'premium' });
    assert.equal(json.redirectTo, '/pricing?resume=premium');
  });

  test('未知の購入意図は無視され、next へ戻す', async () => {
    const { json } = await verify({ next: '/prediction/jra', intent: 'https://evil.example' });
    assert.equal(json.redirectTo, '/prediction/jra');
  });

  test('買い目を見られる会員が無料ページから来たら、対応する有料ページへ戻す', async () => {
    let r = await verify({ next: '/free-prediction/nankan' });
    assert.equal(r.json.redirectTo, '/prediction/nankan');
    db.reset();
    r = await verify({ next: '/free-prediction/nankan/2026-10-19-ooi' });
    assert.equal(r.json.redirectTo, '/prediction/2026-10-19-ooi');
    db.reset();
    r = await verify({ next: '/free-prediction/jra' });
    assert.equal(r.json.redirectTo, '/prediction/jra');
    // 対応の無い無料ページはそのまま
    db.reset();
    r = await verify({ next: '/free-prediction/jra/2026-10-19' });
    assert.equal(r.json.redirectTo, '/free-prediction/jra/2026-10-19');
  });

  test('🔴 無料会員・契約終了は無料ページのまま（有料ページへ送らない）', async () => {
    db.reset({ PlanType: 'free-registered' });
    let r = await verify({ next: '/free-prediction/nankan' });
    assert.equal(r.json.redirectTo, '/free-prediction/nankan');
    db.reset({ PlanType: 'premium', Status: 'inactive' });
    r = await verify({ next: '/free-prediction/nankan' });
    assert.equal(r.json.redirectTo, '/free-prediction/nankan');
    assert.equal(r.cookie.session.tier, TIER.FREE);
  });

  test('🔴 戻り先で tier は変わらない（有料会員は premium・無料会員は free のまま）', async () => {
    let r = await verify({ next: '/prediction/jra' });
    assert.equal(r.cookie?.ok, true);
    assert.equal(r.cookie.session.tier, TIER.PREMIUM);

    db.reset({ PlanType: 'free-registered' });
    r = await verify({ next: '/prediction/jra' });
    assert.equal(r.json.redirectTo, '/prediction/jra');
    assert.equal(r.cookie.session.tier, TIER.FREE, '🔴 戻り先で権限が変わった');
  });

  test('使用済み token は従来どおり 403（戻り先があっても認証の意味は変えない）', async () => {
    db.tokens[0].fields.Used = true;
    const { res, json } = await verify({ next: '/prediction/jra' });
    assert.equal(res.statusCode, 403);
    assert.equal(json.redirectTo, undefined);
  });
});
