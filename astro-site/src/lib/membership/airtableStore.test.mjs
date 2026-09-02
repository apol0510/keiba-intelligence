/**
 * airtableStore.test.mjs — Airtable アダプタの安全性
 *
 * 正本: docs/MEMBERSHIP_DATA_MIGRATION.md
 *
 * 🔴 本番にはまだ列もテーブルも無い。ここで固定するのは
 *    「**列が無い状態で書きに行かない**」「**冪等**」「**他会員へ混入しない**」
 *    「**既存列を触らない**」の 4 点である。
 *
 * 実 Airtable は叩かない（fetch をスタブに差し替える）。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  createAirtableMembershipStore, CUSTOMER_FIELDS, LEDGER_TABLE, LEDGER_FIELDS, SCHEMA_MISSING,
  toAirtableDate, AIRTABLE_DATE_TIME_ZONE,
  errorCodeFrom,
} from './airtableStore.js';
import { STORE_RESULT } from './store.js';
import { ENTRY_TYPE } from './rewards.js';
import { createContractPrice } from './priceLock.js';

const CONTRACT = createContractPrice({
  amountYen: 3980, currency: 'jpy', priceId: 'price_x', startedAtIso: '2026-09-01T00:00:00.000Z',
});

/** 呼び出しを記録する fetch スタブ。 */
function stubFetch(handler) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    const r = await handler(url, init, calls.length);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body ?? {},
      text: async () => (typeof r.text === 'string' ? r.text : JSON.stringify(r.body ?? {})),
    };
  };
  impl.calls = calls;
  impl.writes = () => calls.filter((c) => c.method !== 'GET');
  return impl;
}

const store = (fetchImpl) => createAirtableMembershipStore({
  apiKey: 'test-key', baseId: 'appTest', fetchImpl,
});

/* ================================================================
   1. スキーマがまだ無い（本番の現状）
   ================================================================ */

describe('列・テーブルが無い状態', () => {
  test('🔴 未知フィールド（422）を検出したら書きに行かない', async () => {
    const f = stubFetch(async (url) => {
      if (url.includes(LEDGER_TABLE)) {
        return { status: 422, text: '{"error":{"type":"UNKNOWN_FIELD_NAME"}}' };
      }
      return { status: 200, body: { records: [] } };
    });
    const s = store(f);

    const first = await s.appendEntry('a@example.com', {
      entryId: 'e1', type: ENTRY_TYPE.ACCRUAL, points: 100, occurredAtMs: 1,
    });
    assert.equal(first.status, STORE_RESULT.UNAVAILABLE);
    assert.equal(first.reason, SCHEMA_MISSING);
    assert.equal(first.writes, 0);

    // 2 度目以降は Airtable を叩きさえしない（422 を出し続けない）
    const before = f.calls.length;
    const second = await s.appendEntry('a@example.com', {
      entryId: 'e2', type: ENTRY_TYPE.ACCRUAL, points: 100, occurredAtMs: 2,
    });
    assert.equal(second.reason, SCHEMA_MISSING);
    assert.equal(f.calls.length, before, '検出後は追加のリクエストを送らない');
    assert.equal(f.writes().length, 0);
  });

  test('🔴 テーブルが無い（404）でも書かない', async () => {
    const f = stubFetch(async () => ({ status: 404, text: 'NOT_FOUND' }));
    const r = await store(f).readLedger('a@example.com');
    assert.equal(r.status, STORE_RESULT.UNAVAILABLE);
    assert.equal(r.entries, null, '空配列を返して「0 件」と誤認させない');
    assert.equal(f.writes().length, 0);
  });

  test('🔴 権限が無い（403）でも空配列にしない', async () => {
    const f = stubFetch(async () => ({ status: 403, text: 'NOT_AUTHORIZED' }));
    const r = await store(f).readLedger('a@example.com');
    assert.equal(r.status, STORE_RESULT.UNAVAILABLE);
    assert.equal(r.entries, null);
  });

  test('列が無い会員レコードを読んでも、値を推測で埋めない', async () => {
    const f = stubFetch(async () => ({
      status: 200,
      // 既存の列だけがある状態（＝移行前の本番）
      body: { records: [{ id: 'rec1', fields: { Email: 'a@example.com', PlanType: 'pro', Status: 'active' } }] },
    }));
    const r = await store(f).readProfile('a@example.com');
    assert.equal(r.status, STORE_RESULT.APPLIED);
    assert.equal(r.profile.membershipStartedAtIso, null);
    assert.equal(r.profile.cancelledAtIso, null);
    assert.equal(r.profile.contractPrice, null, '¥3,980 を推測で当てはめない');
  });
});

/* ================================================================
   2. 冪等・二重付与防止
   ================================================================ */

describe('冪等性', () => {
  test('同じ entryId が既にあれば書かない', async () => {
    const f = stubFetch(async (url, init) => {
      if (init.method === 'POST') return { status: 200, body: { records: [] } };
      return { status: 200, body: { records: [{ id: 'rec1', fields: { [LEDGER_FIELDS.ENTRY_ID]: 'dup' } }] } };
    });
    const r = await store(f).appendEntry('a@example.com', {
      entryId: 'dup', type: ENTRY_TYPE.ACCRUAL, points: 100, occurredAtMs: 1,
    });
    assert.equal(r.status, STORE_RESULT.ALREADY);
    assert.equal(r.writes, 0);
    assert.equal(f.writes().length, 0, '重複時は POST を送らない');
  });

  test('無ければ 1 行だけ作る', async () => {
    const f = stubFetch(async (url, init) => {
      if (init.method === 'POST') return { status: 200, body: { records: [{ id: 'new' }] } };
      return { status: 200, body: { records: [] } };
    });
    const r = await store(f).appendEntry('a@example.com', {
      entryId: 'e1', type: ENTRY_TYPE.ACCRUAL, points: 100, occurredAtMs: 1, ref: 'in_1',
    });
    assert.equal(r.status, STORE_RESULT.APPLIED);
    assert.equal(r.writes, 1);

    const posts = f.writes();
    assert.equal(posts.length, 1);
    const fields = posts[0].body.records[0].fields;
    assert.equal(fields[LEDGER_FIELDS.ENTRY_ID], 'e1');
    assert.equal(fields[LEDGER_FIELDS.POINTS], 100);
    assert.equal(fields[LEDGER_FIELDS.EMAIL], 'a@example.com');
  });

  test('🔴 契約価格は既に入っていれば上書きしない（加入時の価格を守る）', async () => {
    const f = stubFetch(async () => ({
      status: 200,
      body: { records: [{ id: 'rec1', fields: { Email: 'a@example.com', [CUSTOMER_FIELDS.PRICE_YEN]: 3980 } }] },
    }));
    const r = await store(f).saveContractPrice('a@example.com', CONTRACT);
    assert.equal(r.status, STORE_RESULT.ALREADY);
    assert.equal(f.writes().length, 0);
  });
});

/* ================================================================
   3. 既存列を触らない / 他会員へ混入しない
   ================================================================ */

describe('安全性', () => {
  test('🔴 既存列（PlanType / Status / AccessEnabled）へ書かない', async () => {
    const f = stubFetch(async (url, init) => {
      if (init.method === 'PATCH') return { status: 200, body: { records: [] } };
      return { status: 200, body: { records: [{ id: 'rec1', fields: { Email: 'a@example.com' } }] } };
    });
    await store(f).saveContractPrice('a@example.com', CONTRACT);

    const patch = f.writes().find((c) => c.method === 'PATCH');
    assert.ok(patch, 'PATCH が送られていない');
    const written = Object.keys(patch.body.fields);
    for (const forbidden of ['PlanType', 'Status', 'AccessEnabled', 'VenueAccess', 'Email']) {
      assert.equal(written.includes(forbidden), false, `${forbidden} を書いてはいけない（権限を壊す）`);
    }
    assert.deepEqual(written.sort(), [
      CUSTOMER_FIELDS.CURRENCY, CUSTOMER_FIELDS.PRICE_ID,
      CUSTOMER_FIELDS.PRICE_STARTED_AT, CUSTOMER_FIELDS.PRICE_YEN,
    ].sort());
  });

  test('🔴 会員の絞り込みに必ず email を使う（全件更新しない）', async () => {
    const f = stubFetch(async () => ({ status: 200, body: { records: [] } }));
    await store(f).readProfile('Someone@Example.com');
    const get = f.calls[0];
    assert.match(decodeURIComponent(get.url), /filterByFormula/);
    assert.match(decodeURIComponent(get.url), /someone@example\.com/, '大文字小文字を揃えて突合する');
  });

  test('会員レコードが無ければ作らない', async () => {
    const f = stubFetch(async () => ({ status: 200, body: { records: [] } }));
    const r = await store(f).saveContractPrice('nobody@example.com', CONTRACT);
    assert.equal(r.status, STORE_RESULT.UNAVAILABLE);
    assert.equal(r.reason, 'customer_not_found');
    assert.equal(f.writes().length, 0);
  });

  test('🔴 Airtable のエラー本文を呼び出し側へ返さない', async () => {
    const f = stubFetch(async () => ({ status: 500, text: 'INTERNAL: secret-ish detail' }));
    const r = await store(f).appendEntry('a@example.com', {
      entryId: 'e1', type: ENTRY_TYPE.ACCRUAL, points: 100, occurredAtMs: 1,
    });
    assert.equal(JSON.stringify(r).includes('secret-ish'), false);
  });

  test('例外が出ても投げ返さない（画面を巻き添えにしない）', async () => {
    const f = () => { throw new Error('network down'); };
    const r = await store(f).readProfile('a@example.com');
    assert.equal(r.status, STORE_RESULT.UNAVAILABLE);
    // 例外も原因が分かるよう符号を付ける
    assert.equal(r.reason, 'read_failed:exception');
  });

  test('資格情報が無ければアダプタを作らない（disabled へ倒す）', () => {
    assert.equal(createAirtableMembershipStore({ baseId: 'appX', fetchImpl: () => {} }), null);
    assert.equal(createAirtableMembershipStore({ apiKey: 'k', fetchImpl: () => {} }), null);
  });
});

/* ------------------------------------------------------------------
   失敗理由に原因の符号を載せる（秘密値・値は含めない）
   ------------------------------------------------------------------ */

test('🔴 write_failed に HTTP status と error type が付く', () => {
  assert.equal(errorCodeFrom(403, JSON.stringify({ error: { type: 'INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND' } })),
    '403:INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND');
  assert.equal(errorCodeFrom(422, JSON.stringify({ error: { type: 'INVALID_VALUE_FOR_COLUMN' } })),
    '422:INVALID_VALUE_FOR_COLUMN');
  // 文字列型の error（古い形）も拾う
  assert.equal(errorCodeFrom(401, JSON.stringify({ error: 'AUTHENTICATION_REQUIRED' })), '401:AUTHENTICATION_REQUIRED');
  // JSON でない / type が無いときは status だけ
  assert.equal(errorCodeFrom(429, 'Too Many Requests'), '429');
  assert.equal(errorCodeFrom(500, JSON.stringify({ error: {} })), '500');
});

test('🔴 error.message を載せない（値が混ざるため）', () => {
  const body = JSON.stringify({
    error: { type: 'INVALID_VALUE_FOR_COLUMN', message: 'Field "Email" value "himitsu@example.com" is invalid' },
  });
  const code = errorCodeFrom(422, body);
  assert.equal(code, '422:INVALID_VALUE_FOR_COLUMN');
  for (const leak of ['himitsu@example.com', 'message', 'Field']) {
    assert.equal(code.includes(leak), false, `🔴 ${leak} が符号に漏れている`);
  }
});

test('🔴 符号は英数と _ - . だけ・長さも抑える', () => {
  const weird = errorCodeFrom(400, JSON.stringify({ error: { type: 'A B<script>"\'#' + 'x'.repeat(200) } }));
  assert.match(weird, /^400:[A-Za-z0-9_.-]{1,60}$/);
});

test('🔴 書き込み失敗の reason に符号が入る', async () => {
  const store = createAirtableMembershipStore({
    apiKey: 'k', baseId: 'b',
    fetchImpl: async (url, opts) => {
      if (!opts || (opts.method || 'GET') === 'GET') {
        // 同じ EntryId はまだ無い（＝POST まで進む）
        return { ok: true, status: 200, json: async () => ({ records: [] }) };
      }
      return { ok: false, status: 403, text: async () => JSON.stringify({ error: { type: 'INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND' } }) };
    },
  });
  const r = await store.appendEntry('a@example.com', {
    entryId: 'e1', type: 'accrual', points: 100, occurredAtMs: Date.now(), periodMonths: 1, sourceRef: 'in_x',
  });
  assert.equal(r.status, 'unavailable');
  assert.equal(r.reason, 'write_failed:403:INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND');
});

/* ------------------------------------------------------------------
   日付だけの列（Date (ISO)）へ書く値
   ------------------------------------------------------------------ */

test('🔴 日付だけの列には YYYY-MM-DD を送る（日時は 422 になる）', () => {
  assert.equal(AIRTABLE_DATE_TIME_ZONE, 'Asia/Tokyo');
  // JST 22:42（= UTC 13:42）→ 同じ日
  assert.equal(toAirtableDate(Date.parse('2026-09-02T13:42:36.000Z')), '2026-09-02');
  // 🔴 JST 早朝（UTC は前日）→ JST の日付になる
  assert.equal(toAirtableDate(Date.parse('2026-09-30T22:00:00.000Z')), '2026-10-01',
    '🔴 UTC で切っている（月境界で今月の積み上げがずれる）');
  // ISO 文字列でもミリ秒でも同じ
  assert.equal(toAirtableDate('2026-09-02T13:42:36.000Z'), toAirtableDate(Date.parse('2026-09-02T13:42:36.000Z')));
  // 判断できなければ書かない
  for (const bad of [null, undefined, '', 'not a date', NaN, {}]) {
    assert.equal(toAirtableDate(bad), null, `🔴 ${JSON.stringify(bad)} を日付として通している`);
  }
});

test('🔴 台帳・契約価格の書き込みが日付形式になっている', async () => {
  let posted = null;
  const store = createAirtableMembershipStore({
    apiKey: 'k', baseId: 'b',
    fetchImpl: async (url, opts) => {
      if (!opts || (opts.method || 'GET') === 'GET') {
        return { ok: true, status: 200, json: async () => ({ records: [] }) };
      }
      posted = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ records: [{ id: 'rec1' }] }) };
    },
  });
  await store.appendEntry('a@example.com', {
    entryId: 'e1', type: 'accrual', points: 100,
    occurredAtMs: Date.parse('2026-09-02T13:42:36.000Z'), periodMonths: 1, sourceRef: 'in_x',
  });
  assert.equal(posted.records[0].fields.OccurredAt, '2026-09-02');
  assert.equal(/T\d\d:/.test(posted.records[0].fields.OccurredAt), false, '🔴 時刻が入っている');
});

test('🔴 typecast を使わない', () => {
  // コメントは対象外（使わない理由の説明は書いてよい）
  const src = readFileSync(new URL('./airtableStore.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*\*.*$/gm, '');
  assert.equal(/typecast/.test(src), false, '🔴 typecast で押し込んでいる');
});
