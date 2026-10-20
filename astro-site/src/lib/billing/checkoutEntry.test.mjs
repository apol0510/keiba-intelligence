/**
 * checkoutEntry.test.mjs — Checkout metadata `ki_entry` は固定の列挙値だけ（PII なし）
 *
 * 正本: docs/measurements/CHECKOUT_ATTRIBUTION_2026_10.md
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkoutEntryOf, entryMetadata, readEntryFields,
  CHECKOUT_ENTRY_VALUES, ENTRY_FIELD_NAMES, NEW_WINDOW_MS,
} from './checkoutEntry.js';
import { customerSessionTier } from '../auth/paidEntitlement.js';
import { TIER, tierAtLeast } from '../auth/tiers.js';

const NOW = Date.parse('2026-10-20T03:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

test('列挙値は new | free | pending | lapsed | withdrawn の 5 つだけ', () => {
  assert.deepEqual([...CHECKOUT_ENTRY_VALUES].sort(), ['free', 'lapsed', 'new', 'pending', 'withdrawn']);
});

describe('checkoutEntryOf', () => {
  test('new: 無料登録から 24 時間以内 / free: それより前・CreatedAt 不明', () => {
    assert.equal(checkoutEntryOf({ PlanType: 'free-registered', Status: 'active', CreatedAt: iso(NOW - 3600e3) }, NOW), 'new');
    assert.equal(checkoutEntryOf({ PlanType: 'free-registered', Status: 'active', CreatedAt: iso(NOW - NEW_WINDOW_MS - 1) }, NOW), 'free');
    assert.equal(checkoutEntryOf({ PlanType: 'free-registered', Status: 'active' }, NOW), 'free');
    assert.equal(checkoutEntryOf({ PlanType: 'free-registered', Status: 'active', CreatedAt: 'bad' }, NOW), 'free');
    assert.equal(checkoutEntryOf({ PlanType: 'free-registered', Status: 'active', CreatedAt: iso(NOW + 3600e3) }, NOW), 'free', '未来の値は new にしない');
  });

  test('pending / lapsed / withdrawn', () => {
    assert.equal(checkoutEntryOf({ PlanType: 'premium', Status: 'pending' }, NOW), 'pending');
    assert.equal(checkoutEntryOf({ PlanType: 'free-registered', Status: 'pending' }, NOW), 'pending');
    assert.equal(checkoutEntryOf({ PlanType: 'premium', Status: 'active', ExpirationDate: '2026-10-01' }, NOW), 'lapsed');
    assert.equal(checkoutEntryOf({ PlanType: 'premium', Status: 'payment_failed', '有効期限': '2026-10-01' }, NOW), 'lapsed');
    assert.equal(checkoutEntryOf({ PlanType: 'free', Status: 'inactive' }, NOW), 'withdrawn');
    assert.equal(checkoutEntryOf({ PlanType: 'free-registered', Status: 'active', CancelledAt: '2026-10-07' }, NOW), 'withdrawn');
  });

  test('分類しない（null）: 有料の閲覧権がある・空・壊れた値・未知の Status', () => {
    for (const f of [
      { PlanType: 'premium', Status: 'active' },
      { PlanType: 'premium', Status: 'active', ExpirationDate: '2026-12-01' },
      { PlanType: 'free-registered', Status: 'suspended' },
      { PlanType: 'free-registered' },
      {}, null, undefined, 'x', 1,
    ]) {
      assert.equal(checkoutEntryOf(f, NOW), null, JSON.stringify(f));
    }
  });

  test('🔴 どの組でも返り値は列挙値か null・有料の閲覧権がある人は必ず null', () => {
    const plans = ['premium', 'light', 'free', 'free-registered', '', undefined, 'x'];
    const statuses = ['active', 'payment_failed', 'inactive', 'pending', 'cancelled', '', undefined];
    const expiries = [undefined, '2026-10-01', '2026-12-01', 'bad'];
    const cancels = [undefined, '2026-10-07', 'bad'];
    const created = [undefined, iso(NOW - 3600e3), iso(NOW - 30 * 864e5)];
    let n = 0;
    for (const PlanType of plans) for (const Status of statuses) for (const ExpirationDate of expiries)
      for (const CancelledAt of cancels) for (const CreatedAt of created) {
        const f = { PlanType, Status, ExpirationDate, CancelledAt, CreatedAt };
        const e = checkoutEntryOf(f, NOW);
        assert.ok(e === null || CHECKOUT_ENTRY_VALUES.includes(e), JSON.stringify(f));
        if (tierAtLeast(customerSessionTier(f, NOW), TIER.LIGHT)) assert.equal(e, null, JSON.stringify(f));
        n += 1;
      }
    assert.equal(n, 1764);
  });
});

test('entryMetadata: 列挙値だけ ki_entry にする。他は何も足さない', () => {
  for (const v of CHECKOUT_ENTRY_VALUES) assert.deepEqual(entryMetadata(v), { ki_entry: v });
  for (const bad of [null, undefined, '', 'NEW', 'active', ['new'], { v: 'new' }, ['user', 'example.invalid'].join('@')]) {
    assert.deepEqual(entryMetadata(bad), {}, JSON.stringify(bad));
  }
});

describe('readEntryFields（読み取りのみ）', () => {
  const env = { AIRTABLE_API_KEY: 'key_test', AIRTABLE_BASE_ID: 'app_test' };
  const me = ['member', 'example.invalid'].join('@');

  test('本人 1 件・分類に使う列だけ返す', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ records: [{ fields: { Email: me, Name: 'テスト', PlanType: 'free-registered', Status: 'active', CreatedAt: iso(NOW) } }] }) };
    };
    const f = await readEntryFields({ email: me, env, fetchImpl });
    assert.deepEqual(f, { PlanType: 'free-registered', Status: 'active', CreatedAt: iso(NOW) });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, 'GET');
    for (const k of Object.keys(f)) assert.ok(ENTRY_FIELD_NAMES.includes(k));
  });

  test('失敗・設定なし・不正な email・タイムアウトは null', async () => {
    assert.equal(await readEntryFields({ email: me, env: {}, fetchImpl: async () => ({ ok: true }) }), null);
    assert.equal(await readEntryFields({ email: 'a"),TRUE(),("@x.invalid', env, fetchImpl: async () => { throw new Error('called'); } }), null);
    assert.equal(await readEntryFields({ email: me, env, fetchImpl: async () => ({ ok: false }) }), null);
    assert.equal(await readEntryFields({ email: me, env, fetchImpl: async () => { throw new Error('net'); } }), null);
    const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('abort'))));
    assert.equal(await readEntryFields({ email: me, env, fetchImpl: hang, timeoutMs: 20 }), null);
  });
});
