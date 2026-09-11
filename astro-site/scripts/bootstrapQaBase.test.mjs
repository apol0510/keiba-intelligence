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

import { TABLES, assertNotProduction, diffSchema, fieldSignature } from './bootstrapQaBase.mjs';
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

  test('🔴 レコードを 1 件も書かない（作るのはテーブルと列だけ）', () => {
    const src = readFileSync(join(here, 'bootstrapQaBase.mjs'), 'utf8');

    // 書き換え系のメソッドは一切使わない
    for (const m of ["'PATCH'", "'PUT'", "'DELETE'"]) {
      assert.equal(src.includes(m), false, `🔴 ${m} を使っている`);
    }
    // POST は Metadata API のテーブル作成だけ
    const posts = [...src.matchAll(/method:\s*'POST'/g)];
    assert.equal(posts.length, 1, '🔴 POST が想定より多い');
    assert.match(src.slice(posts[0].index - 200, posts[0].index), /\$\{API\}\/\$\{QA\}\/tables/,
      '🔴 POST が Metadata API のテーブル作成以外に使われている');

    // レコードを触る記述が無い
    for (const w of ['filterByFormula', 'records:', 'fields:  ']) {
      assert.equal(src.includes(w), false, `🔴 レコード操作らしき記述: ${w}`);
    }
  });

  test('🔴 レコードへのアクセスは --check の件数確認だけ（read-only）', () => {
    const src = readFileSync(join(here, 'bootstrapQaBase.mjs'), 'utf8');
    const recordCalls = [...src.matchAll(/https:\/\/api\.airtable\.com\/v0\/(?!meta\/)[^`\n]*/g)];
    assert.equal(recordCalls.length, 1, '🔴 レコード API の呼び出しが想定より多い');
    // 件数確認のみ。maxRecords を付けて、body も method も無い（＝GET）
    assert.match(recordCalls[0][0], /maxRecords=\d+/, '🔴 全件取得しようとしている');
    const around = src.slice(recordCalls[0].index, recordCalls[0].index + 220);
    assert.equal(/method:/.test(around), false, '🔴 GET 以外でレコードへ行っている');
    assert.equal(/body:/.test(around), false, '🔴 レコードへ body を送っている');
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

/* ================================================================
   --check（read-only 照合）
   ================================================================ */

/** 期待どおりの base を組み立てる（primaryFieldId 付き）。 */
const asActual = (tables) => tables.map((t) => ({
  name: t.name,
  primaryFieldId: `fld_${t.name}_0`,
  fields: t.fields.map((f, i) => ({ ...f, id: `fld_${t.name}_${i}` })),
}));

describe('スキーマ照合（--check）', () => {
  test('完全一致なら ok', () => {
    const d = diffSchema(TABLES, asActual(TABLES));
    assert.equal(d.ok, true, d.problems.join(' / '));
  });

  test('🔴 テーブルが無ければ落ちる', () => {
    const d = diffSchema(TABLES, asActual(TABLES).filter((t) => t.name !== 'AuthTokens'));
    assert.equal(d.ok, false);
    assert.match(d.problems.join(' '), /AuthTokens/);
  });

  test('🔴 列が不足していれば落ちる', () => {
    const a = asActual(TABLES);
    const c = a.find((t) => t.name === 'Customers');
    c.fields = c.fields.filter((f) => f.name !== 'ContractPriceYen');
    const d = diffSchema(TABLES, a);
    assert.equal(d.ok, false);
    assert.match(d.problems.join(' '), /ContractPriceYen/);
  });

  test('🔴 型が違えば落ちる（日付列を dateTime にした等）', () => {
    const a = asActual(TABLES);
    const c = a.find((t) => t.name === 'Customers');
    c.fields.find((f) => f.name === 'MembershipStartedAt').type = 'dateTime';
    const d = diffSchema(TABLES, a);
    assert.equal(d.ok, false);
    assert.match(d.problems.join(' '), /MembershipStartedAt/);
  });

  test('🔴 選択肢が欠けていれば落ちる（書き込みが 422 になる）', () => {
    const a = asActual(TABLES);
    const t = a.find((x) => x.name === 'RewardRedemptions');
    const st = t.fields.find((f) => f.name === 'Status');
    st.options = { choices: [{ name: 'requested' }] };
    const d = diffSchema(TABLES, a);
    assert.equal(d.ok, false);
    assert.match(d.problems.join(' '), /Status/);
  });

  test('🔴 primary が違えば落ちる', () => {
    const a = asActual(TABLES);
    const t = a.find((x) => x.name === 'RewardLedger');
    t.primaryFieldId = t.fields[1].id;
    const d = diffSchema(TABLES, a);
    assert.equal(d.ok, false);
    assert.match(d.problems.join(' '), /primary/);
  });

  test('本番に無い列があっても落とさない（許容して報告するだけ）', () => {
    const a = asActual(TABLES);
    a.find((t) => t.name === 'Customers').fields.push({ name: 'Notes', type: 'multilineText', id: 'fld_extra' });
    const d = diffSchema(TABLES, a);
    assert.equal(d.ok, true);
    assert.deepEqual(d.report.find((r) => r.table === 'Customers').extra, ['Notes']);
  });

  test('fieldSignature が型・選択肢・日付形式・精度を含む', () => {
    assert.match(fieldSignature({ type: 'singleSelect', options: { choices: [{ name: 'a' }, { name: 'b' }] } }), /choices=a,b/);
    assert.match(fieldSignature({ type: 'date', options: { dateFormat: { name: 'iso' } } }), /dateFormat=iso/);
    assert.match(fieldSignature({ type: 'number', options: { precision: 0 } }), /precision=0/);
  });
});
