/**
 * checkRewardRedemptions.test.mjs — 発送待ち監視の不変条件
 *
 * ここで固定するのは 4 点。
 *   1. read-only（GET しか出さない）
 *   2. fail-closed（取得失敗・認証失敗・スキーマ不一致を 0 件にしない）
 *   3. approved が 1 件以上のときだけ通知する。requested では通知しない
 *   4. 通知へ個人情報（Email / RecipientName / PostalCode / Address / RedemptionId）を出さない
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  run, summarize, buildBody, verifySchema, MonitorError,
  SHIPPABLE_STATUS, FORBIDDEN_IN_ALERT, REQUIRED_STATUS_CHOICES,
} from './checkRewardRedemptions.mjs';

const ENV = { AIRTABLE_API_KEY: 'dummy-key', AIRTABLE_BASE_ID: 'dummy-base' };

const SCHEMA_OK = {
  tables: [{
    name: 'RewardRedemptions',
    fields: [
      { name: 'RedemptionId' }, { name: 'Email' }, { name: 'ItemId' },
      { name: 'ItemName' }, { name: 'Kind' }, { name: 'CostPoints' },
      { name: 'MilestoneMonths' },
      { name: 'Status', options: { choices: REQUIRED_STATUS_CHOICES.map((name) => ({ name })) } },
      { name: 'RequestedAt' }, { name: 'ShippedAt' },
      { name: 'RecipientName' }, { name: 'PostalCode' }, { name: 'Address' },
    ],
  }],
};

/** 🔴 実データを模した 1 行。個人情報の列もあえて埋めてある。 */
const row = (over = {}) => ({
  id: 'rec1',
  fields: {
    RedemptionId: 'member@example.test:rice-300g-600:r-abcdefgh',
    Email: 'member@example.test',
    ItemId: 'rice-300g-600',
    ItemName: '米 約300g（2合）',
    Kind: 'redeemable',
    CostPoints: 600,
    Status: 'approved',
    RequestedAt: '2026-09-10',
    RecipientName: '受取 太郎',
    PostalCode: '1000001',
    Address: '東京都千代田区千代田1-1',
    ...over,
  },
});

/** 呼び出しを記録する fetch。 */
function makeFetch({ schema = SCHEMA_OK, byStatus = {}, fail = null } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), method: init?.method || 'GET' });
    if (fail && fail(String(url))) return fail(String(url));
    if (String(url).includes('/meta/bases/')) {
      return { ok: true, json: async () => schema, text: async () => '' };
    }
    // URLSearchParams は空白を `+` にするため、decode しても `{Status}+=+"approved"` になる
    const m = /\{Status\}[+\s]*=[+\s]*"(\w+)"/.exec(decodeURIComponent(String(url)));
    const status = (m && m[1]) || 'unknown';
    return { ok: true, json: async () => ({ records: byStatus[status] || [] }), text: async () => '' };
  };
  impl.calls = calls;
  return impl;
}

/* ================================================================ */

describe('read-only', () => {
  test('🔴 GET 以外を出さない（書き込みに行かない）', async () => {
    const f = makeFetch({ byStatus: { approved: [row()] } });
    await run({ env: ENV, fetchImpl: f });
    for (const c of f.calls) {
      assert.equal(c.method, 'GET', `🔴 ${c.method} を出している: ${c.url}`);
    }
    assert.ok(f.calls.length > 0);
  });
});

describe('🔴 fail-closed（0 件として通さない）', () => {
  test('資格情報が無ければ監視失敗（0 件にしない）', async () => {
    await assert.rejects(
      () => run({ env: {}, fetchImpl: makeFetch() }),
      (e) => e instanceof MonitorError);
  });

  test('認証失敗（401）は監視失敗', async () => {
    const f = makeFetch({ fail: (u) => u.includes('/meta/bases/')
      ? { ok: false, status: 401, text: async () => '{"error":{"type":"AUTHENTICATION_REQUIRED"}}' } : null });
    await assert.rejects(() => run({ env: ENV, fetchImpl: f }), (e) => e instanceof MonitorError);
  });

  test('テーブルが無ければ監視失敗', async () => {
    const f = makeFetch({ schema: { tables: [{ name: 'Customers', fields: [] }] } });
    await assert.rejects(() => run({ env: ENV, fetchImpl: f }),
      (e) => e instanceof MonitorError && /存在しない/.test(e.message));
  });

  test('列が足りなければ監視失敗', async () => {
    const f = makeFetch({ schema: { tables: [{ name: 'RewardRedemptions', fields: [{ name: 'Status', options: { choices: [] } }] }] } });
    await assert.rejects(() => run({ env: ENV, fetchImpl: f }),
      (e) => e instanceof MonitorError && /列が不足/.test(e.message));
  });

  test('🔴 Status の選択肢が欠けていれば監視失敗（書き込みが 422 になる状態）', async () => {
    const broken = JSON.parse(JSON.stringify(SCHEMA_OK));
    broken.tables[0].fields.find((f) => f.name === 'Status').options.choices = [{ name: 'requested' }];
    await assert.rejects(() => run({ env: ENV, fetchImpl: makeFetch({ schema: broken }) }),
      (e) => e instanceof MonitorError && /選択肢が不足/.test(e.message));
  });

  test('レコード取得が失敗したら監視失敗', async () => {
    const f = makeFetch({ fail: (u) => u.includes('RewardRedemptions')
      ? { ok: false, status: 500, text: async () => '' } : null });
    await assert.rejects(() => run({ env: ENV, fetchImpl: f }), (e) => e instanceof MonitorError);
  });

  test('🔴 エラー本文をそのまま出さない（値が混ざりうる）', async () => {
    const f = makeFetch({ fail: (u) => u.includes('/meta/bases/')
      ? { ok: false, status: 422, text: async () => '{"error":{"type":"X","message":"secret@example.test は不正"}}' } : null });
    await assert.rejects(() => run({ env: ENV, fetchImpl: f }), (e) => {
      assert.equal(/secret@example\.test/.test(e.message), false, '🔴 応答本文が漏れている');
      return true;
    });
  });
});

describe('通知の判定', () => {
  test('approved が 0 件なら通知本文を作らない', async () => {
    const f = makeFetch({ byStatus: { approved: [], requested: [row({ Status: 'requested' })] } });
    const r = await run({ env: ENV, fetchImpl: f });
    assert.equal(r.approved.count, 0);
    assert.equal(r.requestedCount, 1);
  });

  test('🔴 requested だけでは通知対象にしない', async () => {
    const f = makeFetch({ byStatus: { approved: [], requested: [row({ Status: 'requested' }), row({ Status: 'requested' })] } });
    const r = await run({ env: ENV, fetchImpl: f });
    assert.equal(r.approved.count, 0, '🔴 requested を発送対象に数えている');
  });

  test('approved が 1 件以上なら件数と内訳を返す', async () => {
    const f = makeFetch({ byStatus: { approved: [
      row(), row(), row({ ItemName: 'コーヒー豆 50g', ItemId: 'coffee-50g-600' }),
    ] } });
    const r = await run({ env: ENV, fetchImpl: f });
    assert.equal(r.approved.count, 3);
    assert.equal(r.approved.breakdown.length, 2);
    assert.match(r.approved.breakdown[0], /米 約300g（2合） × 2/);
  });

  test('発送対象は approved（定数で固定）', () => {
    assert.equal(SHIPPABLE_STATUS, 'approved');
  });

  test('記念品は内訳で区別できる', () => {
    const s = summarize([row({ Kind: 'milestone', ItemName: '米 約300g（2合）' })]);
    assert.match(s.breakdown[0], /記念品/);
  });

  test('最も古い申込日を出す', () => {
    const s = summarize([
      row({ RequestedAt: '2026-09-20' }), row({ RequestedAt: '2026-09-05' }),
    ]);
    assert.equal(s.oldestRequestedAt, '2026-09-05');
  });
});

describe('🔴 通知に個人情報を出さない', () => {
  const approved = summarize([row(), row({ ItemName: 'コーヒー豆 50g' })]);
  const body = buildBody({ approved, requestedCount: 1 });

  test('本文に Email / 氏名 / 郵便番号 / 住所 / RedemptionId が入らない', () => {
    for (const v of [
      'member@example.test', '受取 太郎', '1000001', '東京都千代田区千代田1-1',
      'member@example.test:rice-300g-600:r-abcdefgh',
    ]) {
      assert.equal(body.includes(v), false, `🔴 通知に「${v}」が入っている`);
    }
  });

  test('禁止列の一覧に RedemptionId が入っている（メールを含む形式のため）', () => {
    for (const f of ['Email', 'RecipientName', 'PostalCode', 'Address', 'RedemptionId']) {
      assert.ok(FORBIDDEN_IN_ALERT.includes(f), `${f} が禁止一覧に無い`);
    }
  });

  test('summarize が個人情報の列を読んでいない', () => {
    const s = summarize([row()]);
    const dump = JSON.stringify(s);
    for (const v of ['member@example.test', '受取 太郎', '1000001', '千代田']) {
      assert.equal(dump.includes(v), false, `🔴 要約に「${v}」が残っている`);
    }
  });

  test('発送に必要な情報は載っている（件数・品名・申込日・対応方法）', () => {
    assert.match(body, /2 件/);
    assert.match(body, /米 約300g（2合）/);
    assert.match(body, /コーヒー豆 50g/);
    assert.match(body, /RewardRedemptions/);
    assert.match(body, /shipped/);
  });

  test('🔴 requested を発送しないよう本文で注意している', () => {
    assert.match(body, /requested は発送対象ではありません/);
  });
});

describe('ソースの静的検査', () => {
  test('🔴 個人情報の列を読むコードが無い', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./checkRewardRedemptions.mjs', import.meta.url), 'utf8');
    // 🔴 禁止一覧（FORBIDDEN_IN_ALERT）の宣言そのものは「読んでいる」ではないので除く
    const start = src.indexOf('export const FORBIDDEN_IN_ALERT');
    const end = src.indexOf(']);', start);
    const withoutAllowlist = src.slice(0, start) + src.slice(end);
    const code = withoutAllowlist.split('\n').filter((l) => {
      const t = l.trimStart();
      return t && !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    }).join('\n');
    for (const f of ['RECIPIENT_NAME', 'POSTAL_CODE', 'ADDRESS', 'EMAIL', 'REDEMPTION_ID']) {
      const uses = code.split('\n').filter((l) => l.includes(`REDEMPTION_FIELDS.${f}`));
      assert.equal(uses.length, 0, `🔴 ${f} を読んでいる: ${uses.join(' / ')}`);
    }
  });

  test('🔴 書き込みメソッドを使っていない', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./checkRewardRedemptions.mjs', import.meta.url), 'utf8');
    for (const m of ["method: 'POST'", "method: 'PATCH'", "method: 'DELETE'", "method: 'PUT'"]) {
      assert.equal(src.includes(m), false, `🔴 ${m} を使っている`);
    }
  });
});
