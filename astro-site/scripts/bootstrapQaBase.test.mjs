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

import {
  TABLES, assertNotProduction, diffSchema, fieldSignature,
  validateCreateField, validateCreateSchema,
} from './bootstrapQaBase.mjs';
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

  // ── 🔴 fail-closed（2026-09-12）─────────────────────────────────
  // 比較相手が無ければ誤爆かどうか判定できない。判定できないまま進まない。

  test('🔴 ① production base（AIRTABLE_BASE_ID）が未設定なら即中止', () => {
    for (const prod of [undefined, null, '', '   ', 0, false]) {
      const msg = assertNotProduction('appQA123', prod);
      assert.ok(msg, `production=${JSON.stringify(prod)} が素通りしている`);
      assert.match(msg, /AIRTABLE_BASE_ID/);
    }
  });

  test('🔴 ② 対象 base（AIRTABLE_QA_BASE_ID）が未設定なら即中止', () => {
    for (const qa of [undefined, null, '', '   ', 0, false]) {
      const msg = assertNotProduction(qa, 'appPROD123');
      assert.ok(msg, `qa=${JSON.stringify(qa)} が素通りしている`);
      assert.match(msg, /AIRTABLE_QA_BASE_ID/);
    }
  });

  test('🔴 ③ QA ID が production ID と同じなら即中止', () => {
    assert.match(assertNotProduction('appSAME123', 'appSAME123'), /production base と同じ/);
    // 前後の空白で誤魔化せない
    assert.match(assertNotProduction(' appSAME123 ', 'appSAME123'), /production base と同じ/);
    assert.match(assertNotProduction('appSAME123', ' appSAME123 '), /production base と同じ/);
  });

  test('🔴 両方未設定でも当然中止（fail-open にしない）', () => {
    assert.ok(assertNotProduction(undefined, undefined));
    assert.ok(assertNotProduction('', ''));
  });

  test('🔴 安全弁を通らずに書き込む経路が無い（main で必ず呼ぶ）', () => {
    const src = readFileSync(join(here, 'bootstrapQaBase.mjs'), 'utf8');
    const iAssert = src.indexOf('assertNotProduction(QA, PROD)');
    const iFetch = src.indexOf('await fetch(');
    assert.ok(iAssert > 0, 'main() で assertNotProduction を呼んでいない');
    assert.ok(iAssert < iFetch, '🔴 fetch より後に安全弁を呼んでいる');
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

describe('🔴 作成時 payload の妥当性（2026-09-11 の 422 回帰防止）', () => {
  // 2026-09-11: Customers の作成が 422 INVALID_FIELD_TYPE_OPTIONS_FOR_CREATE で失敗した。
  // 原因は dateTime の options に timeFormat が無かったこと。
  // 🔴 読み取り時に返る形と、作成時に要求される形は違う。
  // 正本: https://airtable.com/developers/web/api/field-model

  test('🔴 TABLES 全列が作成時 payload として妥当', () => {
    const problems = validateCreateSchema(TABLES);
    assert.deepEqual(problems, [], `作成できない列がある:\n${problems.join('\n')}`);
  });

  test('🔴 dateTime 列はすべて timeFormat を持つ（これが無いと 422）', () => {
    let seen = 0;
    for (const t of TABLES) {
      for (const f of t.fields) {
        if (f.type !== 'dateTime') continue;
        seen += 1;
        assert.ok(f.options?.timeFormat?.name, `${t.name}.${f.name} に timeFormat が無い`);
        assert.ok(['12hour', '24hour'].includes(f.options.timeFormat.name));
        assert.ok(f.options?.timeZone, `${t.name}.${f.name} に timeZone が無い`);
        assert.equal(f.options.dateFormat.name, 'iso');
      }
    }
    assert.ok(seen >= 8, `dateTime 列が少なすぎる（${seen}）`);
  });

  test('🔴 timeFormat 欠落を検証器が捕まえる（過去の実障害そのもの）', () => {
    const bad = { name: 'ExpirationDate', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeZone: 'utc' } };
    const msg = validateCreateField(bad);
    assert.ok(msg && msg.includes('timeFormat'), `捕まえられていない: ${msg}`);
  });

  test('🔴 date 列に時刻系 options を付けたら落とす', () => {
    assert.ok(validateCreateField({
      name: 'D', type: 'date', options: { dateFormat: { name: 'iso' }, timeZone: 'utc' },
    }));
    assert.ok(validateCreateField({
      name: 'D', type: 'date', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' } },
    }));
    assert.equal(validateCreateField({ name: 'D', type: 'date', options: { dateFormat: { name: 'iso' } } }), null);
  });

  test('checkbox の icon / color を検証する', () => {
    assert.equal(validateCreateField({ name: 'C', type: 'checkbox', options: { icon: 'check', color: 'greenBright' } }), null);
    assert.ok(validateCreateField({ name: 'C', type: 'checkbox', options: { icon: 'check', color: 'green' } }));
    assert.ok(validateCreateField({ name: 'C', type: 'checkbox', options: { icon: 'tick', color: 'greenBright' } }));
    assert.ok(validateCreateField({ name: 'C', type: 'checkbox' }));
  });

  test('number の precision を検証する（0〜8 の整数）', () => {
    assert.equal(validateCreateField({ name: 'N', type: 'number', options: { precision: 0 } }), null);
    assert.ok(validateCreateField({ name: 'N', type: 'number' }));
    assert.ok(validateCreateField({ name: 'N', type: 'number', options: { precision: 9 } }));
    assert.ok(validateCreateField({ name: 'N', type: 'number', options: { precision: 1.5 } }));
  });

  test('🔴 text 系に options を付けたら落とす', () => {
    assert.equal(validateCreateField({ name: 'T', type: 'singleLineText' }), null);
    assert.ok(validateCreateField({ name: 'T', type: 'singleLineText', options: { precision: 0 } }));
  });

  test('選択肢は name 必須・作成時に id を付けない', () => {
    assert.equal(validateCreateField({ name: 'S', type: 'singleSelect', options: { choices: [{ name: 'a' }] } }), null);
    assert.ok(validateCreateField({ name: 'S', type: 'singleSelect', options: { choices: [] } }));
    assert.ok(validateCreateField({ name: 'S', type: 'singleSelect', options: { choices: [{ name: 'a', id: 'sel123' }] } }));
    assert.ok(validateCreateField({ name: 'S', type: 'singleSelect' }));
  });

  test('🔴 API で作成できない型を落とす（計算列・自動列）', () => {
    for (const type of ['formula', 'rollup', 'lookup', 'createdTime', 'autoNumber', 'button']) {
      assert.ok(validateCreateField({ name: 'X', type }), `${type} が素通りしている`);
    }
  });

  test('🔴 primary field に使えない型を落とす', () => {
    const problems = validateCreateSchema([
      { name: 'T', fields: [{ name: 'Flag', type: 'checkbox', options: { icon: 'check', color: 'greenBright' } }] },
    ]);
    assert.ok(problems.some((p) => p.includes('primary field')), problems.join('\n'));
  });

  test('列名の重複を落とす', () => {
    const problems = validateCreateSchema([
      { name: 'T', fields: [{ name: 'A', type: 'singleLineText' }, { name: 'A', type: 'singleLineText' }] },
    ]);
    assert.ok(problems.some((p) => p.includes('重複')), problems.join('\n'));
  });

  test('🔴 検証はネットワークへ出る前に行う（送信前に落とす）', () => {
    const src = readFileSync(join(here, 'bootstrapQaBase.mjs'), 'utf8');
    const iValidate = src.indexOf('validateCreateSchema(TABLES)');
    const iFetch = src.indexOf('await fetch(');
    assert.ok(iValidate > 0, 'main() で validateCreateSchema を呼んでいない');
    assert.ok(iValidate < iFetch, '🔴 fetch より後に検証している');
  });
});
