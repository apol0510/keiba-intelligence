/**
 * maskEmail.test.mjs — ログ用メールアドレス マスクの単体テスト
 *
 * 🔴 守ること
 *   1. maskEmail は `先頭1文字 + *** + @ドメイン` を返し、ローカル部を残さない
 *   2. redactEmails は文字列 / Error / オブジェクト / URL エンコード中のアドレスをすべて伏せる
 *   3. アドレスを含まない文字列は変えない（ログの有用性を落とさない）
 *
 * テスト用アドレスは予約ドメイン（example.com / example.org）のみを使う。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { maskEmail, redactEmails } = require('./maskEmail.cjs');

describe('maskEmail', () => {
  test('先頭 1 文字 + *** + @ドメイン', () => {
    assert.equal(maskEmail('taro.yamada@example.com'), 't***@example.com');
    assert.equal(maskEmail('a@example.org'), 'a***@example.org');
  });

  test('ドメインは小文字化し、前後の空白は無視する', () => {
    assert.equal(maskEmail('  Hanako@Example.COM '), 'H***@example.com');
  });

  test('ローカル部（2 文字目以降）を残さない', () => {
    const out = maskEmail('secretlocalpart@example.com');
    assert.equal(out.includes('ecretlocalpart'), false);
  });

  test('空・null・undefined は (none)', () => {
    assert.equal(maskEmail(''), '(none)');
    assert.equal(maskEmail(null), '(none)');
    assert.equal(maskEmail(undefined), '(none)');
  });

  test('@ が無い / 先頭 / 末尾の値は全体を伏せる', () => {
    assert.equal(maskEmail('not-an-address'), '***');
    assert.equal(maskEmail('@example.com'), '***');
    assert.equal(maskEmail('someone@'), '***');
  });
});

describe('redactEmails', () => {
  test('文字列中のアドレスをすべて伏せる', () => {
    const s = 'to=alice@example.com cc=bob.smith+ki@example.org done';
    assert.equal(redactEmails(s), 'to=a***@example.com cc=b***@example.org done');
  });

  test('SendGrid 風のエラー本文', () => {
    const body = JSON.stringify({ errors: [{ message: 'Does not contain a valid address: carol@example.com', field: 'personalizations.0.to.0.email' }] });
    const out = redactEmails(body);
    assert.equal(out.includes('carol@'), false);
    assert.match(out, /c\*\*\*@example\.com/);
    assert.match(out, /personalizations\.0\.to\.0\.email/, 'アドレス以外は残す');
  });

  test('Airtable filterByFormula 入りの URL（%40 エンコード）', () => {
    const url = 'https://api.airtable.com/v0/appX/Customers?filterByFormula=' +
      encodeURIComponent('{Email} = "dave@example.com"');
    const out = redactEmails(url);
    assert.equal(/dave/i.test(out), false);
    assert.match(out, /d\*\*\*%40example\.com/);
  });

  test('Error は stack（message 含む）を伏せた文字列で返す', () => {
    const err = new Error('Airtable create failed for erin@example.com');
    const out = redactEmails(err);
    assert.equal(typeof out, 'string');
    assert.equal(out.includes('erin@'), false);
    assert.match(out, /Error: Airtable create failed for e\*\*\*@example\.com/);
  });

  test('オブジェクトは JSON 化して伏せる', () => {
    const out = redactEmails({ email: 'frank@example.com', status: 422, id: 'rec123' });
    assert.equal(out.includes('frank@'), false);
    assert.match(out, /"status":422/);
    assert.match(out, /"id":"rec123"/);
  });

  test('アドレスを含まない値は変えない', () => {
    assert.equal(redactEmails('Airtable search failed: 500'), 'Airtable search failed: 500');
    assert.equal(redactEmails(404), '404');
    assert.equal(redactEmails(undefined), 'undefined');
    assert.equal(redactEmails(null), 'null');
  });

  test('循環参照オブジェクトでも例外を投げない', () => {
    const o = { a: 1 };
    o.self = o;
    assert.doesNotThrow(() => redactEmails(o));
  });
});
