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

import {
  createAirtableMembershipStore, CUSTOMER_FIELDS, LEDGER_TABLE, LEDGER_FIELDS, SCHEMA_MISSING,
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
    assert.equal(r.reason, 'read_failed');
  });

  test('資格情報が無ければアダプタを作らない（disabled へ倒す）', () => {
    assert.equal(createAirtableMembershipStore({ baseId: 'appX', fetchImpl: () => {} }), null);
    assert.equal(createAirtableMembershipStore({ apiKey: 'k', fetchImpl: () => {} }), null);
  });
});
