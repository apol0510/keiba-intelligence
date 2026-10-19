/**
 * signupGuidance.test.mjs — 無料登録の「確認メールを送った後」に迷わせない
 *
 * 正本: docs/measurements/SIGNUP_COMPLETION_2026_10.md
 *
 * 固定すること:
 *   1. 送信先は伏せた形で表示（ドメインは全部・入力値を innerHTML に流さない）
 *   2. 探し方・迷惑メール・有効期限（既存の 15 分）・メールアプリ内ブラウザの注意（/login と同じ文言）
 *   3. 再送は本人が押したときだけ・既存の send-magic-link・送った直後は押せない
 *   4. GA4: ki_login_verify_result に source=signup|login（固定値）。email は送らない
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  maskEmailForDisplay,
  signupSourceQuery,
  verifySourceOf,
  resendResultCopy,
  RESEND_COOLDOWN_SEC,
  LINK_VALID_MINUTES,
  SIGNUP_SOURCE_PARAM,
} from './signupGuidance.js';
import { sanitizeFunnelParams, FUNNEL_EVENTS } from '../analytics/funnelEvents.js';
import { buildMagicLinkUrl } from './magicLinkBase.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, '..', '..', '..', p), 'utf8');
const addr = (local, domain = 'example.invalid') => [local, domain].join('@');

test('maskEmailForDisplay: ローカル部の先頭だけ残し、ドメインは全部出す', () => {
  assert.equal(maskEmailForDisplay(addr('abcdefgh')), `abc***@example.invalid`);
  assert.equal(maskEmailForDisplay(addr('abcdef')), `abc***@example.invalid`);
  assert.equal(maskEmailForDisplay(addr('abcde')), `a***@example.invalid`);
  assert.equal(maskEmailForDisplay(addr('a')), `a***@example.invalid`);
  assert.equal(maskEmailForDisplay(`  ${addr('abcdefgh')}  `), `abc***@example.invalid`);
  // 伏せた結果に元のローカル部が丸ごと残らない
  assert.equal(maskEmailForDisplay(addr('secretname')).includes('secretname'), false);
});

test('maskEmailForDisplay: 解釈できない値は空文字', () => {
  for (const bad of [undefined, null, 1, '', 'no-at', '@example.invalid', 'abc@', {}]) {
    assert.equal(maskEmailForDisplay(bad), '', String(bad));
  }
});

test('signupSourceQuery: signup のときだけ固定の &src=signup', () => {
  assert.equal(signupSourceQuery('signup'), '&src=signup');
  for (const v of [undefined, null, '', 'login', 'SIGNUP', 'signup&x=1', ['signup'], { v: 'signup' }]) {
    assert.equal(signupSourceQuery(v), '', JSON.stringify(v));
  }
  const url = new URL(buildMagicLinkUrl('tok_1', {}) + signupSourceQuery('signup'));
  assert.deepEqual([...url.searchParams.keys()], ['token', SIGNUP_SOURCE_PARAM]);
  assert.equal(url.searchParams.get('src'), 'signup');
});

test('verifySourceOf: signup 以外はすべて login', () => {
  assert.equal(verifySourceOf('signup'), 'signup');
  for (const v of [null, undefined, '', 'login', 'Signup', 'x@y', 'signup ']) assert.equal(verifySourceOf(v), 'login');
});

test('GA4: source は許可キーで、列挙値だけが通る（email は落ちる）', () => {
  assert.deepEqual(sanitizeFunnelParams({ result: 'ok', source: 'signup' }), { result: 'ok', source: 'signup' });
  assert.deepEqual(sanitizeFunnelParams({ source: addr('abc') }), {});
  assert.equal(FUNNEL_EVENTS.SIGNUP_RESEND_RESULT, 'ki_signup_resend_result');
});

test('resendResultCopy: 固定文言・成功判定', () => {
  assert.equal(resendResultCopy(200).ok, true);
  assert.match(resendResultCopy(200).message, /ログインリンク/);
  for (const s of [0, 403, 404, 429, 500, 503]) assert.equal(resendResultCopy(s).ok, false, String(s));
  assert.match(resendResultCopy(404).message, /お問い合わせ/);
});

test('有効期限の表示は既存値（15 分）のまま・再送の待ち時間がある', () => {
  assert.equal(LINK_VALID_MINUTES, 15);
  assert.ok(RESEND_COOLDOWN_SEC >= 30);
  // 有効期限の実体は変えていない
  assert.match(read('netlify/functions/send-magic-link.js'), /Date\.now\(\) \+ 15 \* 60 \* 1000/);
  assert.match(read('netlify/functions/register-free.js'), /リンクの有効期限は15分です。/);
});

test('register.astro: 送信後の案内（送信先・探し方・期限・ブラウザ注意・再送）', () => {
  const src = read('src/pages/register.astro');
  assert.match(src, /<div id="sentPanel" class="sent-panel" hidden>/);
  assert.match(src, /sentTo\.textContent = maskEmailForDisplay\(email\);/);
  assert.match(src, /迷惑メール/);
  assert.match(src, /リンクの有効期限は 15 分です。/);
  assert.match(src, /件名「【KEIBA Intelligence】無料会員登録ありがとうございます！」/);
  // 成功時だけ案内を出す
  assert.match(src, /form\.reset\(\);\n\s*showSentPanel\(email\);/);
  // 🔴 入力値を innerHTML に流さない（既存の「登録済み」案内は固定文字列のみ）
  for (const m of src.match(/innerHTML\s*=[^;]*;/gs) || []) {
    assert.equal(/email|sent|data\./i.test(m.replace(/'[^']*'/g, '')), false, m);
  }
});

test('register.astro: メールアプリ内ブラウザの注意は /login（#163）と同じ文言', () => {
  const norm = (s) => s.replace(/\s+/g, '');
  const login = read('src/pages/login.astro').match(/<p id="browserHint"[^>]*>([\s\S]*?)<\/p>/)[1];
  const reg = read('src/pages/register.astro').match(/<p id="signupBrowserHint"[^>]*>([\s\S]*?)<\/p>/)[1];
  // /login は末尾に有効期限を含む。登録画面は期限を手順に書くので、それ以外が一致すること
  assert.equal(norm(login).replace('リンクの有効期限は15分です。', ''), norm(reg));
});

test('register.astro: 再送は本人が押したときだけ・既存の send-magic-link・連打できない', () => {
  const src = read('src/pages/register.astro');
  assert.match(src, /resendBtn\?\.addEventListener\('click'/);
  assert.match(src, /fetch\('\/\.netlify\/functions\/send-magic-link'/);
  assert.match(src, /body: JSON\.stringify\(\{ email: sentEmail, source: SIGNUP_SOURCE \}\)/);
  // 自動で再送しない（setTimeout / setInterval から fetch しない）
  assert.equal(/set(Timeout|Interval)\([^)]*fetch/s.test(src), false);
  // 送った直後と押した直後に待ち時間を入れる
  assert.equal((src.match(/startResendCooldown\(\);/g) || []).length, 2);
  // 新しい送信先（関数）を作っていない
  assert.equal(/functions\/(resend|signup-resend)/.test(src), false);
  assert.match(src, /trackFunnel\(FUNNEL_EVENTS\.SIGNUP_RESEND_RESULT, \{ result: copy\.ok \? 'sent' : 'error' \}\);/);
});

test('verify.astro: ki_login_verify_result に source を固定値で付ける', () => {
  const src = read('src/pages/auth/verify.astro');
  assert.match(src, /source: verifySourceOf\(urlParams\.get\(SIGNUP_SOURCE_PARAM\)\),/);
});

test('register-free / send-magic-link: src=signup は固定値だけをリンクへ足す', () => {
  const reg = read('netlify/functions/register-free.js');
  assert.match(reg, /\+ intentQuery\(intent\) \+ signupSourceQuery\('signup'\);/);
  const login = read('netlify/functions/send-magic-link.js');
  assert.match(login, /\+ signupSourceQuery\(source\);/);
});
