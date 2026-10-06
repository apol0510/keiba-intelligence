import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSubs, summarizeConfig, defaultNoCancelUpdate } from './stripeWithdrawalAudit.mjs';

test('解約予約の件数と終了日だけを出す（ID・email を出さない）', () => {
  const r = summarizeSubs([
    { id: 'sub_a', status: 'active', cancel_at: 1793029474, metadata: { ki_email: 'x@example.invalid' } },
    { id: 'sub_b', status: 'active', cancel_at_period_end: true, current_period_end: 1793029000 },
    { id: 'sub_c', status: 'active' },
    { id: 'sub_d', status: 'canceled', cancel_at: 1 },
  ]);
  assert.equal(r.active, 3);
  assert.equal(r.scheduled, 2);
  assert.equal(JSON.stringify(r).includes('sub_'), false);
  assert.equal(JSON.stringify(r).includes('@'), false);
});

test('🔴 既定構成への更新は解約の無効化だけ（カード変更等を触らない）', () => {
  assert.deepEqual(defaultNoCancelUpdate(), { features: { subscription_cancel: { enabled: false } } });
});

test('構成の要約に ID を出さない', () => {
  const s = summarizeConfig({ id: 'bpc_1', is_default: true, active: true, features: { subscription_cancel: { enabled: true } } });
  assert.equal(s.cancel, true);
  assert.equal(JSON.stringify(s).includes('bpc_'), false);
});
