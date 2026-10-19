/**
 * paymentConfirmationAuto.handlers.test.mjs — 入金確認メール自動送信の応答に PII を入れない回帰
 *
 * 実行: npm run test:payment-confirmation-auto （astro-site 直下から）
 *   node src/lib/mail/paymentConfirmationAuto.handlers.test.mjs
 *
 * 🔴 `node --test` 経由で動かさない。ハンドラが console.* を出すため、
 *    test runner の IPC と混ざって不安定になる（KI #154 / #166）。直接 `node` で実行する。
 *
 * registry 6e72645d（2026-10-19）。固定すること:
 *   1. どの応答（200 / 400 / 405 / 500 / 503）の本文にも、会員のメールアドレス・氏名を入れない
 *   2. 必須項目欠落の 400 は「どれが空か」（hasEmail / hasName）と record id だけ返す
 *   3. 500 の message に外部 API のエラー本文が混ざっても、アドレスは平文で返さない
 *   4. 送信・更新の挙動は変えない（宛先は本人・PATCH 1 回）
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const REL = 'netlify/functions/send-payment-confirmation-auto.js';
const addr = (local, domain = 'example.com') => [local, domain].join('@');
const MEMBER = addr('bank.member');
const MEMBER_LOCAL = 'bank.member';
const MEMBER_NAME = '入金 花子';
const PROD_HOST = 'keiba-intelligence.jp';
const RECORD_ID = 'recPAYCONF0001';

/** `exports.handler` 形式（CommonJS）の関数を読み込む（package.json が type:module のため）。 */
function loadCjsFunction(rel) {
  const filename = path.join(ROOT, rel);
  const m = new Module(filename);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  m._compile(readFileSync(filename, 'utf8'), filename);
  return m.exports;
}

// ── fetch の差し替え ────────────────────────────────────────────────
const state = {
  record: null,
  recordMode: 'ok', // 'ok' | 'http_error'
  sendgridMode: 'ok', // 'ok' | 'http_error'
  calls: [],
};
const realFetch = globalThis.fetch;
function installFetch() {
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    state.calls.push({ url: u, method, body: init.body });
    if (u.startsWith('https://api.airtable.com/')) {
      if (method === 'GET') {
        if (state.recordMode === 'http_error') {
          // 外部 API のエラー本文にアドレス・氏名が混ざる最悪ケース
          return new Response(`{"error":"bad record ${MEMBER} ${MEMBER_NAME}"}`, { status: 422 });
        }
        return new Response(JSON.stringify(state.record), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }
    if (u === 'https://api.sendgrid.com/v3/mail/send') {
      if (state.sendgridMode === 'http_error') return new Response(`rejected ${MEMBER}`, { status: 400 });
      return new Response('{}', { status: 202 });
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
}

// ── console の捕捉（出力の抑止）──────────────────────────────────────
const realConsole = {};
function captureConsole() {
  for (const k of ['log', 'warn', 'error', 'info']) {
    realConsole[k] = console[k];
    console[k] = () => {};
  }
}
function restoreConsole() {
  for (const k of Object.keys(realConsole)) console[k] = realConsole[k];
}

const post = (body, host = PROD_HOST) => ({ httpMethod: 'POST', headers: { host }, body: JSON.stringify(body) });

function seedRecord(fields) {
  state.record = {
    id: RECORD_ID,
    createdTime: '2026-10-19T00:00:00.000Z',
    fields: { Plan: 'プロプラン', plan_type: 'pro', PaymentMethod: 'Bank Transfer', ...fields },
  };
}

/** 本文にアドレス（ローカル部を含む）・氏名が一切無いこと */
function assertNoPii(res) {
  const body = String(res.body ?? '');
  assert.equal(body.includes(MEMBER), false, `🔴 応答にメールアドレスが入っている: ${res.statusCode}`);
  assert.equal(body.includes(MEMBER_LOCAL), false, `🔴 応答にアドレスのローカル部が入っている: ${res.statusCode}`);
  assert.equal(body.includes(MEMBER_NAME), false, `🔴 応答に氏名が入っている: ${res.statusCode}`);
  // JSON エスケープされた形（\uXXXX）でも入っていないこと
  assert.equal(body.includes(JSON.stringify(MEMBER_NAME).slice(1, -1)), false);
}

let handler;

before(() => {
  process.env.AIRTABLE_API_KEY = 'key_test';
  process.env.AIRTABLE_BASE_ID = 'app_test';
  process.env.SENDGRID_API_KEY = 'sg_test';
  delete process.env.SENDGRID_FROM_EMAIL;
  delete process.env.ADMIN_EMAIL;
  delete process.env.MEMBERSHIP_WRITE_ENABLED;
  captureConsole();
  handler = loadCjsFunction(REL).handler;
});

beforeEach(() => {
  state.record = null;
  state.recordMode = 'ok';
  state.sendgridMode = 'ok';
  state.calls = [];
  installFetch();
});

after(() => {
  globalThis.fetch = realFetch;
  restoreConsole();
});

describe('🔴 応答本文に会員のメールアドレス・氏名を入れない（registry 6e72645d）', () => {
  test('400 氏名が空: hasEmail / hasName と record id だけ返す', async () => {
    seedRecord({ Email: MEMBER, Name: '' });
    const res = await handler(post({ airtableRecordId: RECORD_ID }));
    assert.equal(res.statusCode, 400);
    assertNoPii(res);
    const body = JSON.parse(res.body);
    assert.deepEqual(body.details, { hasEmail: true, hasName: false });
    assert.equal(body.airtableRecordId, RECORD_ID);
    assert.equal(state.calls.some((c) => c.url.includes('sendgrid')), false, '送信していない');
  });

  test('400 メールが空: 氏名を返さない', async () => {
    seedRecord({ Name: MEMBER_NAME });
    const res = await handler(post({ airtableRecordId: RECORD_ID }));
    assert.equal(res.statusCode, 400);
    assertNoPii(res);
    assert.deepEqual(JSON.parse(res.body).details, { hasEmail: false, hasName: true });
  });

  test('200 初回送信: 本文にアドレスが無い・送信と更新の挙動は従来どおり', async () => {
    seedRecord({ Email: MEMBER, Name: MEMBER_NAME });
    const res = await handler(post({ airtableRecordId: RECORD_ID }));
    assert.equal(res.statusCode, 200);
    assertNoPii(res);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.equal(body.skipped, false);
    assert.equal(body.airtableRecordId, RECORD_ID);
    assert.equal(body.planType, 'pro');
    assert.equal('email' in body, false);

    const sends = state.calls.filter((c) => c.url === 'https://api.sendgrid.com/v3/mail/send');
    assert.equal(sends.length, 1);
    assert.equal(JSON.parse(sends[0].body).personalizations[0].to[0].email, MEMBER, '宛先は本人のまま');
    const patches = state.calls.filter((c) => c.url.startsWith('https://api.airtable.com/') && c.method === 'PATCH');
    assert.equal(patches.length, 1);
  });

  test('200 送信済み（再実行）: 本文にアドレスが無い', async () => {
    seedRecord({ Email: MEMBER, Name: MEMBER_NAME, PaymentEmailSent: true });
    const res = await handler(post({ airtableRecordId: RECORD_ID }));
    assert.equal(res.statusCode, 200);
    assertNoPii(res);
    assert.equal(JSON.parse(res.body).skipped, true);
    assert.equal(state.calls.some((c) => c.url.includes('sendgrid')), false);
  });

  test('500 Airtable 取得失敗（エラー本文にアドレス・氏名）: 平文アドレスを返さない', async () => {
    state.recordMode = 'http_error';
    const res = await handler(post({ airtableRecordId: RECORD_ID }));
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.includes(MEMBER), false, '🔴 500 にメールアドレスが平文で入っている');
    assert.equal(res.body.includes(MEMBER_LOCAL), false);
    assert.equal(JSON.parse(res.body).error, 'Internal Server Error');
  });

  test('500 SendGrid 失敗: 本文に PII が無い', async () => {
    seedRecord({ Email: MEMBER, Name: MEMBER_NAME });
    state.sendgridMode = 'http_error';
    const res = await handler(post({ airtableRecordId: RECORD_ID }));
    assert.equal(res.statusCode, 500);
    assertNoPii(res);
  });

  test('400 record id 欠落 / 405 / 503（プレビュー）: 本文に PII が無い', async () => {
    seedRecord({ Email: MEMBER, Name: MEMBER_NAME });
    for (const [ev, status] of [
      [post({}), 400],
      [{ httpMethod: 'GET', headers: { host: PROD_HOST } }, 405],
      [post({ airtableRecordId: RECORD_ID }, 'deploy-preview-1--keiba-intelligence.netlify.app'), 503],
    ]) {
      const res = await handler(ev);
      assert.equal(res.statusCode, status);
      assertNoPii(res);
    }
  });

  test('ハンドラの応答に email / fullName を直接入れる記述が残っていない', () => {
    const src = readFileSync(path.join(ROOT, REL), 'utf8');
    assert.doesNotMatch(src, /details:\s*\{\s*email\s*,\s*fullName\s*\}/);
    assert.doesNotMatch(src, /^\s*email:\s*email,\s*$/m);
  });
});
