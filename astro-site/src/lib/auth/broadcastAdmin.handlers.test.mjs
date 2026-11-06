/**
 * broadcastAdmin.handlers.test.mjs — メルマガ配信 API の実ハンドラで管理者認証を確かめる
 *
 * 実行: npm run test:admin-auth （astro-site 直下から）
 *
 * registry e1f0c2ce: 従来は body のメールアドレスだけで管理者を判定しており、
 * 管理者のアドレスを知っていれば（`ADMIN_EMAILS` 未設定なら空文字でも）
 * 有料会員への一斉配信を誰でも起動できた。
 *
 * 🔴 ネットワークは使わない。`airtable` と `@sendgrid/mail` を差し替え、
 *    送信回数・書き込み回数を数える。拒否されたリクエストでは **どちらも 0** であること。
 * 🔴 鍵・メールアドレスは実行時に作る。
 */

import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  BROADCAST_STAGES,
  DRY_RUN_REQUIRED_MESSAGE,
  STAGE_MISMATCH_MESSAGE,
  STAGE_REQUIRED_MESSAGE,
  buildCreateBroadcastBody,
  buildDryRunBody,
  buildSendBody,
  parseBroadcastStage,
} from '../newsletter/broadcastStage.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * `exports.handler` 形式（CommonJS）の関数を読み込む。依存は stubs で差し替える。
 * （package.json が "type": "module" のため、素の import では CommonJS として読めない）
 */
function loadCjsFunction(rel, stubs) {
  const filename = path.join(ROOT, rel);
  const m = new Module(filename);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  m.require = (id) => (Object.prototype.hasOwnProperty.call(stubs, id) ? stubs[id] : Module.prototype.require.call(m, id));
  m._compile(readFileSync(filename, 'utf8'), filename);
  return m.exports;
}

const ADMIN_KEY = randomBytes(24).toString('hex');
const addr = (local) => [local, 'example.invalid'].join('@');
const ADMIN_ADDR = addr('owner');
const PROD_HOST = 'keiba-intelligence.jp';
const PREVIEW_HOST = 'deploy-preview-1--example.netlify.app';

/** 呼び出し記録。 */
const calls = { sends: [], creates: [], updates: [], selects: [] };
/** Airtable のメモリ上の行。 */
const db = { Broadcasts: [], Customers: [], BroadcastRecipients: [] };

function resetState() {
  calls.sends = [];
  calls.creates = [];
  calls.updates = [];
  calls.selects = [];
  db.Broadcasts = [{
    id: 'recBROADCAST',
    fields: { broadcast_id: 'b-1', subject: 'subject', body_html: '<p>x</p>', status: 'draft', created_at: new Date().toISOString() },
  }];
  db.Customers = [
    { id: 'recC1', fields: { Email: addr('member1'), Name: 'm1', Plan: 'premium' } },
    { id: 'recC2', fields: { Email: addr('member2'), Name: 'm2', Plan: 'premium' } },
  ];
  db.BroadcastRecipients = [];
}

const handlers = {};

before(async () => {
  process.env.AIRTABLE_API_KEY = 'key_test';
  process.env.AIRTABLE_BASE_ID = 'app_test';
  process.env.SENDGRID_API_KEY = 'sg_test';
  process.env.KI_ADMIN_API_KEY = ADMIN_KEY;
  process.env.ADMIN_EMAILS = ADMIN_ADDR;
  delete process.env.ADMIN_EMAIL;

  class AirtableStub {
    base() {
      return (tableName) => ({
        select(opts) {
          calls.selects.push({ tableName, opts });
          const rows = () => {
            if (tableName === 'BroadcastRecipients') return [];
            if (tableName === 'Broadcasts') {
              const m = String(opts?.filterByFormula || '').match(/\{broadcast_id\} = "(.*)"/);
              return m ? db.Broadcasts.filter((r) => r.fields.broadcast_id === m[1]) : db.Broadcasts;
            }
            return db[tableName] || [];
          };
          return { firstPage: async () => rows(), all: async () => rows() };
        },
        async create(records) {
          calls.creates.push({ tableName, records });
          return records.map((r, i) => ({ id: `recNEW${i}`, fields: r.fields }));
        },
        async update(records) {
          calls.updates.push({ tableName, records });
          return records;
        },
      });
    }
  }

  const sgStub = {
    setApiKey() {},
    async send(msg) {
      calls.sends.push(msg);
      return [{ headers: { 'x-message-id': `msg-${calls.sends.length}` } }];
    },
  };

  const stubs = { airtable: AirtableStub, '@sendgrid/mail': sgStub };
  for (const name of ['create-broadcast', 'send-broadcast', 'send-test', 'get-broadcast', 'get-broadcasts']) {
    handlers[name] = loadCjsFunction(`netlify/functions/${name}.js`, stubs).handler;
    assert.equal(typeof handlers[name], 'function', `${name} の handler を読めない`);
  }
});

beforeEach(() => {
  resetState();
  process.env.KI_ADMIN_API_KEY = ADMIN_KEY;
  process.env.ADMIN_EMAILS = ADMIN_ADDR;
});

function event(method, { key, host = PROD_HOST, origin, body, query } = {}) {
  const headers = { host };
  if (key !== undefined) headers['x-ki-admin-key'] = key;
  if (origin) headers.origin = origin;
  return {
    httpMethod: method,
    headers,
    body: body === undefined ? null : JSON.stringify(body),
    queryStringParameters: query || null,
  };
}

const SEND_BODY = { broadcast_id: 'b-1', dry_run: false, confirm: true, stage: 50 };
const sideEffects = () => calls.sends.length + calls.creates.length + calls.updates.length;

describe('🔴 未認証・偽装は 403 で、送信も書き込みも 0', () => {
  test('send-broadcast: 鍵なし + 管理者アドレスを body に入れても 403', async () => {
    const res = await handlers['send-broadcast'](event('POST', { body: { ...SEND_BODY, user_email: ADMIN_ADDR } }));
    assert.equal(res.statusCode, 403);
    assert.equal(sideEffects(), 0);
    assert.equal(calls.selects.length, 0, 'Airtable を読んでいる');
  });

  test('send-broadcast: 🔴 従来の穴（空文字の user_email）でも 403', async () => {
    process.env.ADMIN_EMAILS = '';
    const res = await handlers['send-broadcast'](event('POST', { body: { ...SEND_BODY, user_email: '' } }));
    assert.equal(res.statusCode, 403);
    assert.equal(sideEffects(), 0);
  });

  test('send-broadcast: 違う鍵は 403', async () => {
    const res = await handlers['send-broadcast'](event('POST', { key: randomBytes(24).toString('hex'), body: SEND_BODY }));
    assert.equal(res.statusCode, 403);
    assert.equal(sideEffects(), 0);
  });

  test('send-broadcast: env 未設定なら正しい形の鍵でも 403（fail-closed）', async () => {
    delete process.env.KI_ADMIN_API_KEY;
    const res = await handlers['send-broadcast'](event('POST', { key: ADMIN_KEY, body: SEND_BODY }));
    assert.equal(res.statusCode, 403);
    assert.equal(sideEffects(), 0);
  });

  test('send-broadcast: 鍵を body に入れても認めない', async () => {
    const res = await handlers['send-broadcast'](event('POST', { body: { ...SEND_BODY, admin_key: ADMIN_KEY, 'x-ki-admin-key': ADMIN_KEY } }));
    assert.equal(res.statusCode, 403);
    assert.equal(sideEffects(), 0);
  });

  test('send-broadcast: Deploy Preview でも未認証は 403（プレビューの 503 より先に止める）', async () => {
    const res = await handlers['send-broadcast'](event('POST', { host: PREVIEW_HOST, body: SEND_BODY }));
    assert.equal(res.statusCode, 403);
    assert.equal(sideEffects(), 0);
  });

  test('send-broadcast: 許可外 Origin からは鍵が正しくても 403', async () => {
    const res = await handlers['send-broadcast'](event('POST', { key: ADMIN_KEY, origin: 'https://evil.example', body: SEND_BODY }));
    assert.equal(res.statusCode, 403);
    assert.equal(sideEffects(), 0);
    assert.equal(res.headers['Access-Control-Allow-Origin'], undefined);
  });

  test('send-test: 管理者アドレスを test_email に入れても鍵なしは 403', async () => {
    const res = await handlers['send-test'](event('POST', { body: { broadcast_id: 'b-1', test_email: ADMIN_ADDR } }));
    assert.equal(res.statusCode, 403);
    assert.equal(sideEffects(), 0);
  });

  test('create-broadcast: created_by に管理者アドレスを入れても鍵なしは 403', async () => {
    const res = await handlers['create-broadcast'](event('POST', { body: { subject: 's', body_html: 'b', stage: 50, created_by: ADMIN_ADDR } }));
    assert.equal(res.statusCode, 403);
    assert.equal(sideEffects(), 0);
  });

  test('get-broadcast: 鍵なしは 403 で Airtable を読まない', async () => {
    const res = await handlers['get-broadcast'](event('GET', { query: { broadcast_id: 'b-1' } }));
    assert.equal(res.statusCode, 403);
    assert.equal(calls.selects.length, 0);
    assert.ok(!res.body.includes('<p>x</p>'));
  });

  test('get-broadcasts: 鍵なしは 403 で Airtable を読まない', async () => {
    const res = await handlers['get-broadcasts'](event('GET'));
    assert.equal(res.statusCode, 403);
    assert.equal(calls.selects.length, 0);
  });
});

describe('認証済みのリクエストは従来どおり動く', () => {
  test('send-broadcast: 本番送信が対象会員へ送られる', async () => {
    const res = await handlers['send-broadcast'](event('POST', { key: ADMIN_KEY, origin: `https://${PROD_HOST}`, body: SEND_BODY }));
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(JSON.parse(res.body).sent_count, 2);
    assert.equal(calls.sends.length, 2);
    assert.equal(res.headers['Access-Control-Allow-Origin'], `https://${PROD_HOST}`);
  });

  test('send-broadcast: dry-run は送信 0', async () => {
    const res = await handlers['send-broadcast'](event('POST', { key: ADMIN_KEY, body: { broadcast_id: 'b-1', dry_run: true, stage: 50 } }));
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(calls.sends.length, 0);
    assert.equal(JSON.parse(res.body).recipient_count_planned, 2);
  });

  test('send-test: 許可された宛先にだけ 1 通送る', async () => {
    const ok = await handlers['send-test'](event('POST', { key: ADMIN_KEY, body: { broadcast_id: 'b-1', test_email: ADMIN_ADDR } }));
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(calls.sends.length, 1);
    assert.equal(calls.sends[0].to, ADMIN_ADDR);

    const ng = await handlers['send-test'](event('POST', { key: ADMIN_KEY, body: { broadcast_id: 'b-1', test_email: addr('stranger') } }));
    assert.equal(ng.statusCode, 403);
    assert.equal(calls.sends.length, 1, '許可外の宛先へ送った');
  });

  test('create-broadcast: 下書きを作る', async () => {
    const res = await handlers['create-broadcast'](event('POST', { key: ADMIN_KEY, body: { subject: 's', body_html: 'b', stage: 50, created_by: 'admin' } }));
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(calls.creates.length, 1);
    assert.equal(calls.creates[0].records[0].fields.status, 'draft');
    assert.equal(calls.sends.length, 0);
  });

  test('get-broadcast / get-broadcasts: 読める', async () => {
    const one = await handlers['get-broadcast'](event('GET', { key: ADMIN_KEY, query: { broadcast_id: 'b-1' } }));
    assert.equal(one.statusCode, 200, one.body);
    assert.equal(JSON.parse(one.body).broadcast.broadcast_id, 'b-1');
    const list = await handlers['get-broadcasts'](event('GET', { key: ADMIN_KEY }));
    assert.equal(list.statusCode, 200, list.body);
  });
});

describe('CORS', () => {
  for (const [name, method] of [['create-broadcast', 'POST'], ['send-broadcast', 'POST'], ['send-test', 'POST'], ['get-broadcast', 'GET'], ['get-broadcasts', 'GET']]) {
    test(`${name}: preflight は許可外 origin に Allow-Origin を返さず、本番 origin には返す`, async () => {
      const evil = await handlers[name]({ httpMethod: 'OPTIONS', headers: { host: PROD_HOST, origin: 'https://evil.example' } });
      assert.equal(evil.statusCode, 204);
      assert.equal(evil.headers['Access-Control-Allow-Origin'], undefined);

      const own = await handlers[name]({ httpMethod: 'OPTIONS', headers: { host: PROD_HOST, origin: `https://${PROD_HOST}` } });
      assert.equal(own.headers['Access-Control-Allow-Origin'], `https://${PROD_HOST}`);
      assert.match(own.headers['Access-Control-Allow-Methods'], new RegExp(method));
      assert.match(own.headers['Access-Control-Allow-Headers'], /X-KI-Admin-Key/);
      assert.equal(sideEffects(), 0);
    });
  }
});

describe('🔴 管理画面のステージ（未選択では送らない・API の拒否は不変）', () => {
  const broadcast = (fields) => ({ broadcast_id: 'b-1', status: 'draft', stage: 50, ...fields });

  test('選択肢は NEWSLETTER_MIGRATION.md の 8 段階だけ', () => {
    assert.deepEqual(BROADCAST_STAGES.map((s) => s.value), [50, 100, 300, 500, 1000, 3000, 7000, 15000]);
  });

  test('未選択・一覧にない値は null（既定値へ丸めない）', () => {
    for (const raw of ['', ' ', '0', '1', '49', '50.5', '-50', '1e3', '999999', 'all', null, undefined, {}, true]) {
      assert.equal(parseBroadcastStage(raw), null, String(raw));
    }
    assert.equal(parseBroadcastStage('50'), 50);
    assert.equal(parseBroadcastStage(15000), 15000);
  });

  test('未選択なら body を作らない（作成・Dry-Run・本番送信）', () => {
    const base = { subject: 's', bodyHtml: 'b', createdBy: 'admin' };
    assert.throws(() => buildCreateBroadcastBody({ ...base, stageInput: '' }), { message: STAGE_REQUIRED_MESSAGE });
    assert.throws(() => buildDryRunBody(broadcast(), ''), { message: STAGE_REQUIRED_MESSAGE });
    assert.throws(() => buildSendBody(broadcast({ status: 'dry-run' }), ''), { message: STAGE_REQUIRED_MESSAGE });
  });

  test('本番送信は同じステージの Dry-Run の後だけ', () => {
    assert.throws(() => buildSendBody(broadcast({ status: 'draft' }), '50'), { message: DRY_RUN_REQUIRED_MESSAGE });
    assert.throws(() => buildSendBody(broadcast({ status: 'dry-run', stage: 50 }), '15000'), { message: STAGE_MISMATCH_MESSAGE });
    assert.deepEqual(buildSendBody(broadcast({ status: 'dry-run', stage: 50 }), '50'), { broadcast_id: 'b-1', dry_run: false, confirm: true, stage: 50 });
  });

  test('作成フォームの body は実ハンドラで下書きになり、stage は数値で保存される', async () => {
    const body = buildCreateBroadcastBody({ subject: 's', bodyHtml: 'b', stageInput: '100', createdBy: 'admin' });
    const res = await handlers['create-broadcast'](event('POST', { key: ADMIN_KEY, body }));
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(calls.creates[0].records[0].fields.stage, 100);
    assert.equal(calls.sends.length, 0);
  });

  test('Dry-Run の body は実ハンドラで送信 0・上限は選んだステージ・数値で保存される', async () => {
    const body = buildDryRunBody(broadcast(), '300');
    const res = await handlers['send-broadcast'](event('POST', { key: ADMIN_KEY, body }));
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(calls.sends.length, 0);
    assert.equal(calls.selects.find((c) => c.tableName === 'Customers').opts.maxRecords, 300);
    assert.strictEqual(calls.updates[0].records[0].fields.stage, 300);
    assert.equal(JSON.parse(res.body).recipient_count_planned, 2);
  });

  test('本番送信の body は実ハンドラで受理される', async () => {
    const body = buildSendBody(broadcast({ status: 'dry-run', stage: 50 }), '50');
    const res = await handlers['send-broadcast'](event('POST', { key: ADMIN_KEY, body }));
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(calls.selects.find((c) => c.tableName === 'Customers').opts.maxRecords, 50);
    assert.equal(calls.sends.length, 2);
  });

  test('get-broadcast は確認に使う stage と送信予定件数を返す', async () => {
    db.Broadcasts[0].fields = { ...db.Broadcasts[0].fields, status: 'dry-run', stage: 50, recipient_count_planned: 2 };
    const res = await handlers['get-broadcast'](event('GET', { key: ADMIN_KEY, query: { broadcast_id: 'b-1' } }));
    const got = JSON.parse(res.body).broadcast;
    assert.equal(got.stage, 50);
    assert.equal(got.recipient_count_planned, 2);
  });

  test('API は stage なしを従来どおり 400 で拒否し、副作用 0', async () => {
    const create = await handlers['create-broadcast'](event('POST', { key: ADMIN_KEY, body: { subject: 's', body_html: 'b', created_by: 'admin' } }));
    assert.equal(create.statusCode, 400, create.body);
    for (const body of [{ broadcast_id: 'b-1', dry_run: true }, { broadcast_id: 'b-1', dry_run: false, confirm: true }]) {
      const res = await handlers['send-broadcast'](event('POST', { key: ADMIN_KEY, body }));
      assert.equal(res.statusCode, 400, res.body);
    }
    assert.equal(sideEffects(), 0);
  });

  test('画面はステージに既定値を置かず、body を上の関数でだけ作る', () => {
    const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
    const newPage = read('src/pages/admin/newsletter/new.astro');
    const detailPage = read('src/pages/admin/newsletter/[id].astro');

    assert.match(newPage, /<select id="stage" name="stage" required/);
    for (const page of [newPage, detailPage]) {
      assert.match(page, /<option value="">選択してください<\/option>/);
      assert.doesNotMatch(page, /<option[^>]*\bselected\b/);
      assert.doesNotMatch(page, /\b(dry_run|created_by):/, 'body を画面で直接組み立てている');
    }
    assert.match(newPage, /buildCreateBroadcastBody\(/);
    assert.match(detailPage, /buildDryRunBody\(broadcast, selectedStage\(\)\)/);
    assert.match(detailPage, /buildSendBody\(broadcast, selectedStage\(\)\)/);
    assert.match(detailPage, /data\.recipient_count_planned/);
  });
});
