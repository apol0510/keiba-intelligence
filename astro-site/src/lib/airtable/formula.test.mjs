/**
 * formula.test.mjs — Airtable 式インジェクション対策の共通部品と、その適用漏れのガード
 *
 * 実行: npm run test:airtable-formula （astro-site 直下から）
 *
 * registry 5a5dd591（2026-10-19）: `verify-magic-link` が URL の token を
 * `{Token} = "${token}"` へそのまま埋め込んでいた。ここでは
 *   1. エスケープ関数（`\` と `"`）
 *   2. email / token の形式検証
 *   3. netlify/functions と src/lib に「エスケープせずに式へ埋め込む箇所」が無いこと
 * を固定する。ハンドラを実際に動かす回帰は `airtableInjection.handlers.test.mjs`。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { escapeFormulaString, isValidEmail, EMAIL_MAX_LENGTH } from './formula.js';
import { isValidMagicLinkToken } from '../auth/magicLinkToken.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** 🔴 テストのアドレスは実行時に組み立てる（diff に実在風のアドレスを残さない）。 */
const addr = (local, domain = 'example.com') => [local, domain].join('@');

/**
 * エスケープ済みの値を `"..."` に入れたとき、Airtable の字句規則（`\` が次の 1 文字をエスケープ）で
 * 文字列リテラルがどこで閉じるかを調べる。閉じた位置が末尾の `"` でなければ注入が成立している。
 */
function literalClosesAtEnd(escaped) {
  const lit = `"${escaped}"`;
  let i = 1;
  while (i < lit.length) {
    const c = lit[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '"') return i === lit.length - 1;
    i += 1;
  }
  return false;
}

/** 文字列リテラルを Airtable と同じ規則で読み戻す。 */
function unescapeLiteral(escaped) {
  return escaped.replace(/\\(.)/g, '$1');
}

const INJECTION_PAYLOADS = [
  '"',
  '\\',
  '\\"',
  '", TRUE(), "',
  '" & TRUE() & "',
  '") OR TRUE() OR ("',
  '" OR {Status} = "active',
  'x", OR(1=1), "',
  '"), AND(TRUE()), ("',
  '\\", TRUE(), \\"',
  'a\\\\"b',
  '"\n, TRUE(), "',
];

describe('escapeFormulaString', () => {
  test('通常の値は変えない', () => {
    assert.equal(escapeFormulaString('abc-123'), 'abc-123');
    assert.equal(escapeFormulaString(addr('user')), addr('user'));
  });

  test('`"` と `\\` をエスケープする（`\\` が先）', () => {
    assert.equal(escapeFormulaString('"'), '\\"');
    assert.equal(escapeFormulaString('\\'), '\\\\');
    assert.equal(escapeFormulaString('\\"'), '\\\\\\"');
  });

  test('null / undefined は空文字（式を壊さない）', () => {
    assert.equal(escapeFormulaString(null), '');
    assert.equal(escapeFormulaString(undefined), '');
  });

  test('数値などは文字列化する', () => {
    assert.equal(escapeFormulaString(42), '42');
  });

  for (const payload of INJECTION_PAYLOADS) {
    test(`🔴 注入 payload でも文字列リテラルの外へ出ない: ${JSON.stringify(payload)}`, () => {
      const escaped = escapeFormulaString(payload);
      assert.equal(literalClosesAtEnd(escaped), true, '🔴 リテラルが途中で閉じる');
      assert.equal(unescapeLiteral(escaped), payload, '値が変わっている');
    });
  }

  test('🔴 旧実装（`"` だけのエスケープ）は `\\"` で破れる＝本修正が必要な理由', () => {
    const quoteOnly = (v) => String(v).replace(/"/g, '\\"');
    assert.equal(literalClosesAtEnd(quoteOnly('\\", TRUE(), \\"')), false);
    assert.equal(literalClosesAtEnd(escapeFormulaString('\\", TRUE(), \\"')), true);
  });

  test('長い入力でも壊れない', () => {
    const long = '"\\'.repeat(5000);
    assert.equal(literalClosesAtEnd(escapeFormulaString(long)), true);
  });
});

describe('isValidEmail', () => {
  test('正しい形式は通す', () => {
    for (const ok of [addr('user'), addr('first.last+tag'), addr('a_b-c', 'sub.example.co.jp'), addr('USER', 'Example.COM')]) {
      assert.equal(isValidEmail(ok), true, ok);
    }
  });

  test('🔴 引用符・バックスラッシュ・式の断片を含むものは落とす', () => {
    for (const bad of [
      addr('a"b'),
      addr('a\\b'),
      addr('x", TRUE(), "x'),
      addr('x") OR TRUE() OR ("x'),
      `${addr('user')}", TRUE(), "`,
      `${addr('user')}" OR "1"="1`,
      addr('user', 'example.com" & TRUE() & "'),
      addr('a b'),
      ` ${addr('user')}`,
      `${addr('user')}\n`,
    ]) {
      assert.equal(isValidEmail(bad), false, JSON.stringify(bad));
    }
  });

  test('形式が違うものは落とす', () => {
    for (const bad of ['', 'user', addr('', 'example.com'), addr('user', ''), addr('user', 'localhost'), addr('user', '.example.com'), addr('user', 'example..com'), [addr('a'), 'b.com'].join('@')]) {
      assert.equal(isValidEmail(bad), false, JSON.stringify(bad));
    }
  });

  test('文字列以外は落とす', () => {
    for (const bad of [null, undefined, 1, {}, [addr('user')], true]) {
      assert.equal(isValidEmail(bad), false);
    }
  });

  test('🔴 長すぎる入力は落とす', () => {
    const local = 'a'.repeat(64);
    const domain = `${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.${'e'.repeat(60)}.com`;
    const over = addr(local, domain);
    assert.ok(over.length > EMAIL_MAX_LENGTH);
    assert.equal(isValidEmail(over), false);
    assert.equal(isValidEmail(addr('a'.repeat(10000))), false);
  });
});

describe('isValidMagicLinkToken', () => {
  /** send-magic-link が使う uuid v4 と同じ形（実行時に組み立てる）。 */
  const uuidShaped = () => ['a'.repeat(8), 'b'.repeat(4), '4' + 'c'.repeat(3), '8' + 'd'.repeat(3), 'e'.repeat(12)].join('-');
  /** register-free と同じ生成式。 */
  const registerFreeToken = () =>
    Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

  test('send-magic-link の形式（uuid v4）を通す', async () => {
    const { v4 } = await import('uuid');
    for (let i = 0; i < 50; i += 1) assert.equal(isValidMagicLinkToken(v4()), true);
    assert.equal(isValidMagicLinkToken(uuidShaped()), true);
  });

  test('register-free の形式（小文字英数字・最大 26 文字）を通す', () => {
    for (let i = 0; i < 200; i += 1) {
      const t = registerFreeToken();
      assert.equal(isValidMagicLinkToken(t), true, t);
    }
  });

  test('🔴 注入 payload・その他の形式は落とす', () => {
    for (const bad of [
      ...INJECTION_PAYLOADS,
      `${uuidShaped()}"`,
      `${uuidShaped()}", TRUE(), "`,
      `abc" OR "1"="1`,
      'abc OR TRUE()',
      'abc AND(TRUE())',
      'ABCDEF',
      uuidShaped().toUpperCase(),
      ' abc',
      'abc\n',
      'a'.repeat(27),
      'a'.repeat(10000),
      '',
    ]) {
      assert.equal(isValidMagicLinkToken(bad), false, JSON.stringify(bad));
    }
  });

  test('文字列以外は落とす', () => {
    for (const bad of [null, undefined, 1, {}, ['abc']]) assert.equal(isValidMagicLinkToken(bad), false);
  });

  test('🔴 発行側の生成式が変わっていない（変えたら検証側も変える）', () => {
    const send = readFileSync(path.join(ROOT, 'netlify/functions/send-magic-link.js'), 'utf8');
    assert.match(send, /const token = uuidv4\(\);/);
    const reg = readFileSync(path.join(ROOT, 'netlify/functions/register-free.js'), 'utf8');
    // #161（registry 7a7522ac）で register-free も UUID v4 に統一。isValidMagicLinkToken は UUID v4 を受け付ける
    assert.match(reg, /const token = crypto\.randomUUID\(\);/);
    assert.equal(isValidMagicLinkToken(randomUUID()), true);
  });
});

describe('🔴 エスケープせずに式へ値を埋め込む箇所が無い（netlify/functions・src/lib）', () => {
  function listSources(dir) {
    const out = [];
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) out.push(...listSources(p));
      else if (/\.(js|mjs|cjs)$/.test(ent.name) && !/\.test\.(js|mjs)$/.test(ent.name)) out.push(p);
    }
    return out;
  }

  const files = [
    ...listSources(path.join(ROOT, 'netlify/functions')),
    ...listSources(path.join(ROOT, 'src/lib')),
  ];

  test('対象ファイルが見つかる', () => {
    assert.ok(files.some((f) => f.endsWith('verify-magic-link.js')));
  });

  test('式の文字列リテラル内の `${...}` は escapeFormulaString / escapeFormula を通している', () => {
    const offenders = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      // `{Field} = "${expr}"` / `LOWER({Field}) = "${expr}"` の形をすべて拾う
      const re = /[})]\s*(?:=|!=)\s*"\$\{([^}]*)\}"/g;
      let m;
      while ((m = re.exec(src))) {
        const expr = m[1].trim();
        if (!/^(escapeFormulaString|escapeFormula)\(/.test(expr) && expr !== 'escaped') {
          offenders.push(`${path.relative(ROOT, f)}: ${expr}`);
        }
      }
    }
    assert.deepEqual(offenders, [], `🔴 未エスケープの埋め込み:\n${offenders.join('\n')}`);
  });

  test('verify-magic-link は問い合わせ前に token を検証する', () => {
    const src = readFileSync(path.join(ROOT, 'netlify/functions/verify-magic-link.js'), 'utf8');
    const check = src.indexOf('isValidMagicLinkToken(token)');
    const query = src.indexOf('authTokensTable\n      .select');
    assert.ok(check > 0 && query > 0 && check < query, '🔴 検証が問い合わせより後にある');
  });
});
