import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildRevenueMonth, monthRangeJst, previousMonthJst, readPrevious, summarize, sustainedMonths, RevenueError, TARGET_JPY,
} from './revenueMonthly.mjs';

test('JST の月境界', () => {
  const r = monthRangeJst('2026-09');
  assert.equal(new Date(r.gte * 1000).toISOString(), '2026-08-31T15:00:00.000Z');
  assert.equal(new Date(r.lt * 1000).toISOString(), '2026-09-30T15:00:00.000Z');
  assert.equal(new Date(monthRangeJst('2026-12').lt * 1000).toISOString(), '2026-12-31T15:00:00.000Z');
  assert.throws(() => monthRangeJst('2026-13'), RevenueError);
});

test('前月は JST で決める', () => {
  assert.equal(previousMonthJst(Date.parse('2026-09-30T16:00:00Z')), '2026-09'); // JST 10/1 01:00
  assert.equal(previousMonthJst(Date.parse('2026-01-15T00:00:00Z')), '2025-12');
});

test('成功した charge だけを数え、返金を引く', () => {
  const s = summarize(
    [{ status: 'succeeded', paid: true, currency: 'jpy', amount_captured: 3980 },
     { status: 'succeeded', paid: true, currency: 'jpy', amount_captured: 5000 },
     { status: 'failed', paid: false, currency: 'jpy', amount_captured: 0, amount: 3980 }],
    [{ status: 'succeeded', currency: 'jpy', amount: 3980 }, { status: 'failed', currency: 'jpy', amount: 100 }]);
  assert.deepEqual(s, { gross: 8980, refunded: 3980, net: 5000, payments: 2 });
});

test('JPY 以外は fail-closed', () => {
  assert.throws(() => summarize([{ status: 'succeeded', paid: true, currency: 'usd', amount_captured: 1 }], []), RevenueError);
});

test('連続達成月数', () => {
  const prev = new Map([['2026-08', TARGET_JPY], ['2026-07', TARGET_JPY + 1], ['2026-05', TARGET_JPY]]);
  assert.equal(sustainedMonths('2026-09', TARGET_JPY, prev), 3);
  assert.equal(sustainedMonths('2026-09', TARGET_JPY - 1, prev), 0);
  assert.equal(sustainedMonths('2026-01', TARGET_JPY, new Map([['2025-12', TARGET_JPY]])), 2);
});

test('既存の measurement を読む（壊れた file は数えない）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ki-rev-'));
  writeFileSync(join(dir, 'revenue-2026-08-01.json'), JSON.stringify({ schema: 'kao.revenue-month/v1', month: '2026-08', net_jpy: 1200000 }));
  writeFileSync(join(dir, 'revenue-2026-07-01.json'), '{broken');
  writeFileSync(join(dir, 'other.json'), JSON.stringify({ schema: 'kao.revenue-month/v1', month: '2026-06', net_jpy: 1 }));
  assert.deepEqual([...readPrevious(dir)], [['2026-08', 1200000]]);
});

function fakeStripe(pages) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, auth: init.headers.Authorization });
      const path = new URL(url).pathname.split('/').pop();
      const after = new URL(url).searchParams.get('starting_after');
      const body = pages[path][after ?? 'first'];
      return { ok: true, status: 200, json: async () => body };
    },
  };
}

test('全 page を読み、集計値だけを出す', async () => {
  const s = fakeStripe({
    charges: {
      first: { data: [{ id: 'ch_1', status: 'succeeded', paid: true, currency: 'jpy', amount_captured: 600000, customer: 'cus_x', billing_details: { email: 'a@example.com' } }], has_more: true },
      ch_1: { data: [{ id: 'ch_2', status: 'succeeded', paid: true, currency: 'jpy', amount_captured: 500000 }], has_more: false },
    },
    refunds: { first: { data: [], has_more: false } },
  });
  const doc = await buildRevenueMonth({ month: '2026-09', key: 'sk_test_dummy', fetchImpl: s.fetchImpl,
    previous: new Map([['2026-08', 1000000]]), nowMs: Date.parse('2026-10-01T00:00:00Z') });
  assert.equal(doc.net_jpy, 1100000);
  assert.equal(doc.achieved, true);
  assert.equal(doc.sustained_months, 2);
  assert.equal(doc.by_channel.stripe.payments, 2);
  assert.equal(s.calls.length, 3);
  assert.ok(s.calls[0].url.includes('created%5Bgte%5D='));
  const text = JSON.stringify(doc);
  for (const leak of ['ch_1', 'cus_x', 'example.com', 'sk_test_dummy']) assert.ok(!text.includes(leak), leak);
});

test('取得失敗は 0 円として書かない', async () => {
  await assert.rejects(buildRevenueMonth({ month: '2026-09', key: 'k', fetchImpl: async () => ({ ok: false, status: 401 }) }), RevenueError);
  await assert.rejects(buildRevenueMonth({ month: '2026-09', key: undefined }), /STRIPE_SECRET_KEY/);
});
