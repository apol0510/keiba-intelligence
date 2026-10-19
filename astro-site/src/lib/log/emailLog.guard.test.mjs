/**
 * emailLog.guard.test.mjs — 会員のメールアドレスをログへ平文で出さないことの静的ガード
 *
 * 🔴 2026-10-19 MK 指示「メールアドレスの平文ログ出力も修正してください。」
 *    Netlify Functions / サーバー側 lib の console.* 呼び出しに、メールアドレスを持つ変数が
 *    `maskEmail(...)` / `redactEmails(...)`（src/lib/log/maskEmail.cjs）を通らずに
 *    渡っていないことを確かめる。
 *
 *    検出するもの（console.log / info / warn / error / debug の引数）:
 *      - 名前が `email` / `emails` で終わる識別子・プロパティ（email, test_email, customer.Email, ent.email,
 *        `{ email }` の省略記法、テンプレートの `${email}` 等）
 *      - 送信先の `to` / `recipient`
 *      - 外部 API のエラー本文 `errorText`（SendGrid / Airtable はアドレスを本文に含めることがある）
 *    検出しないもの（誤検知を避ける）:
 *      - 文字列リテラル・テンプレートの固定部分（例: 'mail blocked'、`(${n} emails)`）
 *      - 大文字定数（FROM_EMAIL 等の送信元・自社アドレス）
 *      - オブジェクトのキー名（`email: maskEmail(x)` の `email:`）
 *      - 件数（`emails.length`）・真偽（`!!email`）
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

/** 対象: 本番で動く関数とサーバー側 lib（テストは除く） */
function targetFiles() {
  const out = [];
  const fnDir = join(root, 'netlify', 'functions');
  for (const f of readdirSync(fnDir)) {
    if (/\.(m?js|cjs|ts)$/.test(f)) out.push(join(fnDir, f));
  }
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(m?js|cjs|ts)$/.test(f) && !/\.test\.m?js$/.test(f)) out.push(p);
    }
  };
  walk(join(root, 'src', 'lib'));
  return out;
}

/** `(` の位置から対応する `)` までを返す（文字列・テンプレート・コメントを考慮した近似） */
function balancedArgs(src, openIdx) {
  let depth = 0;
  let i = openIdx;
  let quote = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return src.slice(openIdx + 1, i); }
  }
  return src.slice(openIdx + 1);
}

/** 文字列リテラルを空にし、テンプレートは `${...}` の中身だけ残す */
function stripLiterals(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") {
      i++;
      while (i < s.length && s[i] !== c) { if (s[i] === '\\') i++; i++; }
      out += '""';
      continue;
    }
    if (c === '`') {
      i++;
      while (i < s.length && s[i] !== '`') {
        if (s[i] === '\\') { i += 2; continue; }
        if (s[i] === '$' && s[i + 1] === '{') {
          let d = 1; let j = i + 2;
          while (j < s.length && d > 0) { if (s[j] === '{') d++; else if (s[j] === '}') d--; j++; }
          out += ' ' + s.slice(i + 2, j - 1) + ' ';
          i = j;
          continue;
        }
        i++;
      }
      out += '""';
      continue;
    }
    out += c;
  }
  return out;
}

/** `maskEmail(...)` / `redactEmails(...)` の呼び出しを丸ごと取り除く */
function stripMaskedCalls(s) {
  const re = /\b(maskEmail|redactEmails)\s*\(/g;
  let m;
  while ((m = re.exec(s))) {
    const open = m.index + m[0].length - 1;
    const inner = balancedArgs(s, open);
    s = s.slice(0, m.index) + ' __masked__ ' + s.slice(open + inner.length + 2);
    re.lastIndex = 0;
  }
  return s;
}

// 名前が email / emails で**終わる**識別子（paymentEmailSent のような真偽・件数は対象外）
const RAW_EMAIL_IDENT = /(?<![\w$])(?:[A-Za-z_$][\w$]*\.)*[\w$]*(?:[Ee]mail|EMAIL)s?(?![\w$])/g;
const RAW_TO = /(?<![\w$.])(?:to|recipient|errorText)(?![\w$])/;

/** console 引数 1 件を判定。違反なら理由、問題なければ null */
export function findRawEmail(args) {
  let s = stripMaskedCalls(args);
  s = stripLiterals(s);
  s = stripMaskedCalls(s); // テンプレート内の ${maskEmail(x)} を展開後に再度
  // オブジェクトのキー名（`email:` / `'email':`）・真偽 `!!x` は対象外
  s = s.replace(/(^|[{,\s])([\w$]+|"")\s*:(?!:)/g, '$1');
  s = s.replace(/!!\s*[\w$.]+/g, '');
  for (const m of s.matchAll(RAW_EMAIL_IDENT)) {
    const id = m[0];
    const last = id.split('.').pop();
    if (/^[A-Z0-9_]+$/.test(last)) continue; // 大文字定数（送信元等）
    const after = s.slice(m.index + id.length);
    if (/^\s*\.\s*length\b/.test(after)) continue; // 件数
    return `raw email identifier: ${id}`;
  }
  const t = s.match(RAW_TO);
  if (t) return `raw ${t[0]}`;
  return null;
}

function scan(src) {
  const hits = [];
  const re = /\bconsole\s*\.\s*(log|info|warn|error|debug)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length - 1;
    const args = balancedArgs(src, open);
    const why = findRawEmail(args);
    if (why) {
      const line = src.slice(0, m.index).split('\n').length;
      hits.push({ line, why });
    }
  }
  return hits;
}

describe('検出器そのもの（誤検知・見逃しの確認）', () => {
  const bad = [
    "'📧 Sending magic link to:', email",
    "'✅ Test email sent to:', test_email",
    "'info', { name, email, category }",
    "`sent to ${email}`",
    "'x', customer.Email",
    "'❌ Send error:', email, error.message",
    "'📧 Sending email to:', to",
    "'SendGrid error:', response.status, errorText",
    "'x', userEmail",
    "'x', recipientEmails",
  ];
  const good = [
    "'⚠️ mail blocked on preview host'",
    "'📧 Sending magic link to:', maskEmail(email)",
    "'info', { email: maskEmail(email), category }",
    "`sent to ${maskEmail(email)}`",
    "`📨 Sending batch ${n} (${batch.length} emails)...`",
    "'📊 Unique emails:', uniqueEmails.length",
    "'📧 From:', FROM_EMAIL",
    "'⚠️ Missing required fields:', { hasEmail: !!email, hasName: !!fullName }",
    "'SendGrid error:', response.status, redactEmails(errorText)",
    "'⚠️ stripe-webhook: checkout without plan/email metadata (skipped)'",
    "'x', JSON.stringify({ fields: { ...p.fields, Email: maskEmail(email) } })",
    "'x', (p.to || []).map((t) => ({ ...t, email: maskEmail(t.email) }))",
    "'📋 Record info:', { planType, paymentEmailSent }",
  ];
  for (const b of bad) {
    test(`検出する: ${b}`, () => assert.notEqual(findRawEmail(b), null));
  }
  for (const g of good) {
    test(`検出しない: ${g}`, () => assert.equal(findRawEmail(g), null));
  }
});

describe('🔴 本番コードの console.* にメールアドレスを平文で渡さない', () => {
  const files = targetFiles();

  test('対象ファイルが存在する（スキャンが空振りしていない）', () => {
    const names = files.map((f) => relative(root, f));
    for (const must of [
      'netlify/functions/send-magic-link.js',
      'netlify/functions/register-free.js',
      'netlify/functions/bank-transfer-application.js',
      'netlify/functions/send-payment-confirmation-auto.js',
    ]) {
      assert.ok(names.includes(must), `対象に ${must} が無い`);
    }
  });

  for (const f of files) {
    const rel = relative(root, f);
    test(rel, () => {
      const hits = scan(readFileSync(f, 'utf8'));
      assert.deepEqual(hits, [],
        `🔴 ${rel} がメールアドレスを平文でログに出している可能性: ` +
        hits.map((h) => `L${h.line} ${h.why}`).join(' / ') +
        ' — maskEmail / redactEmails（src/lib/log/maskEmail.cjs）を通すこと');
    });
  }

  test('アドレスを扱う関数はマスク用ヘルパーを読み込んでいる', () => {
    for (const rel of [
      'netlify/functions/send-magic-link.js',
      'netlify/functions/register-free.js',
      'netlify/functions/bank-transfer-application.js',
      'netlify/functions/send-payment-confirmation-auto.js',
      'netlify/functions/send-broadcast.js',
      'netlify/functions/send-test.js',
      'netlify/functions/contact-form.js',
    ]) {
      const src = readFileSync(join(root, rel), 'utf8');
      assert.match(src, /src\/lib\/log\/maskEmail\.cjs/, `${rel} が maskEmail.cjs を読み込んでいない`);
    }
  });

  test('マジックリンクのトークンを全文ログに出さない', () => {
    const src = readFileSync(join(root, 'netlify/functions/send-magic-link.js'), 'utf8');
    assert.equal(/console\.\w+\([^)]*Token created:'\s*,\s*token\s*\)/.test(src), false);
  });
});
