/**
 * bootstrapQaBase.test.mjs — QA base bootstrap の不変条件
 *
 * 🔴 いちばん大事なのは「production base へ絶対に向かないこと」。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { TABLES, assertNotProduction } from './bootstrapQaBase.mjs';
import {
  LEDGER_TABLE, LEDGER_FIELDS, REDEMPTION_TABLE, REDEMPTION_FIELDS, CUSTOMER_FIELDS,
} from '../src/lib/membership/airtableStore.js';

const here = dirname(fileURLToPath(import.meta.url));
const byName = (n) => TABLES.find((t) => t.name === n);
const fieldNames = (n) => byName(n).fields.map((f) => f.name);

describe('🔴 production への誤爆を防ぐ', () => {
  test('対象が production base と同じなら中止する', () => {
    assert.match(assertNotProduction('appSAME', 'appSAME'), /production/);
  });

  test('未設定・不正な形は中止する', () => {
    assert.ok(assertNotProduction('', 'appPROD'));
    assert.ok(assertNotProduction('not-a-base', 'appPROD'));
    assert.ok(assertNotProduction(undefined, 'appPROD'));
  });

  test('別 base なら通す', () => {
    assert.equal(assertNotProduction('appQA123', 'appPROD'), null);
  });

  test('🔴 レコードを読み書きするコードが無い（作るのはテーブルと列だけ）', () => {
    const src = readFileSync(join(here, 'bootstrapQaBase.mjs'), 'utf8');
    assert.equal(/api\.airtable\.com\/v0\/(?!meta\/)/.test(src), false, '🔴 レコード API を叩いている');
    for (const w of ['filterByFormula', 'records:']) {
      assert.equal(src.includes(w), false, `🔴 レコード操作らしき記述: ${w}`);
    }
  });

  test('既定は dry-run（--apply が無ければ作らない）', () => {
    const src = readFileSync(join(here, 'bootstrapQaBase.mjs'), 'utf8');
    assert.match(src, /const APPLY = process\.argv\.includes\('--apply'\)/);
  });
});

describe('本番と同じスキーマを持つ', () => {
  test('4 テーブルある', () => {
    assert.deepEqual(TABLES.map((t) => t.name).sort(),
      ['AuthTokens', 'Customers', 'RewardLedger', 'RewardRedemptions']);
  });

  test('🔴 ログインに要る AuthTokens が含まれている', () => {
    assert.deepEqual(fieldNames('AuthTokens'),
      ['Token', 'Email', 'ExpiresAt', 'Used', 'CreatedAt', 'Ip_Address', 'User_Agent']);
  });

  test('Customers に membership の 6 列がある', () => {
    const have = fieldNames('Customers');
    for (const f of Object.values(CUSTOMER_FIELDS)) assert.ok(have.includes(f), `Customers に ${f} が無い`);
  });

  test('RewardLedger が正本の列を満たす', () => {
    const have = fieldNames(LEDGER_TABLE);
    for (const f of Object.values(LEDGER_FIELDS)) assert.ok(have.includes(f), `${f} が無い`);
  });

  test('RewardRedemptions が正本の列を満たす', () => {
    const have = fieldNames(REDEMPTION_TABLE);
    for (const f of Object.values(REDEMPTION_FIELDS)) assert.ok(have.includes(f), `${f} が無い`);
  });

  test('🔴 選択肢が本番と同じ（欠けると書き込みが 422 になる）', () => {
    const st = byName(REDEMPTION_TABLE).fields.find((f) => f.name === 'Status');
    assert.deepEqual(st.options.choices.map((c) => c.name),
      ['requested', 'approved', 'shipped', 'cancelled']);
    const type = byName(LEDGER_TABLE).fields.find((f) => f.name === 'Type');
    assert.deepEqual(type.options.choices.map((c) => c.name),
      ['accrual', 'redemption', 'adjustment', 'expiry']);
  });

  test('🔴 日付列は ISO の date（時刻つきを送ると 422 になる列）', () => {
    for (const [t, f] of [['Customers', 'MembershipStartedAt'], ['Customers', 'ContractStartedAt'],
      [LEDGER_TABLE, 'OccurredAt'], [REDEMPTION_TABLE, 'RequestedAt'], [REDEMPTION_TABLE, 'ShippedAt']]) {
      const fld = byName(t).fields.find((x) => x.name === f);
      assert.equal(fld.type, 'date', `${t}.${f} が date でない`);
      assert.equal(fld.options.dateFormat.name, 'iso');
    }
  });

  test('primary field が本番と同じ（各テーブルの先頭）', () => {
    assert.equal(byName('Customers').fields[0].name, 'Email');
    assert.equal(byName('AuthTokens').fields[0].name, 'Token');
    assert.equal(byName(LEDGER_TABLE).fields[0].name, 'EntryId');
    assert.equal(byName(REDEMPTION_TABLE).fields[0].name, 'RedemptionId');
  });
});
