/**
 * verifyRecovery.test.mjs — ログインリンクが使えなかったときに行き止まりにしない（/auth/verify）
 *
 * 正本: docs/measurements/LOGIN_RECOVERY_2026_10.md
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { verifyFailureCopy, isSignedInSession } from './verifyRecovery.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, '..', '..', '..', p), 'utf8');

test('結果ごとに「何が起きたか」と次の一歩を出す', () => {
  for (const r of ['used', 'expired', 'not_found', 'error', 'unknown', undefined]) {
    const c = verifyFailureCopy(r);
    assert.ok(c.title && c.message, String(r));
    assert.match(c.message, /新しいリンク/, `${r}: 次の一歩が無い`);
    // 🔴 「トークン」等の内部用語・責める言い方を出さない
    assert.doesNotMatch(c.title + c.message, /トークン|認証失敗|token/i);
  }
  assert.match(verifyFailureCopy('used').message, /1 回だけ/);
  assert.match(verifyFailureCopy('expired').message, /15 分/);
});

test('使用済み・期限切れには「開いたブラウザでだけ有効」の補足を付ける', () => {
  assert.match(verifyFailureCopy('used').hint, /リンクを開いたブラウザでだけ有効/);
  assert.match(verifyFailureCopy('expired').hint, /メールアプリの中/);
  assert.equal(verifyFailureCopy('not_found').hint, undefined);
});

test('🔴 ログイン済みの判定は get-session の 200 + authenticated:true だけ', () => {
  assert.equal(isSignedInSession(200, { authenticated: true }), true);
  assert.equal(isSignedInSession(200, { authenticated: 'true' }), false);
  assert.equal(isSignedInSession(200, { success: true }), false);
  assert.equal(isSignedInSession(401, { authenticated: true }), false);
  assert.equal(isSignedInSession(200, null), false);
});

test('verify.astro: 失敗時にサーバーのセッションを確かめ、再取得の導線を出す', () => {
  const src = read('src/pages/auth/verify.astro');
  assert.match(src, /await handleFailure\(verifyResultOf\(response\.status, false, data\.error\), intent, next\)/);
  assert.match(src, /fetch\('\/\.netlify\/functions\/get-session', \{ credentials: 'include' \}\)/);
  assert.match(src, /isSignedInSession\(/);
  // ログイン済みなら戻り先は固定パス or 許可リストを通した next（open redirect を作らない・returnTo.js）
  assert.match(src, /resumePathFor\(intent, back \|\| '\/mypage'\)/);
  assert.match(src, /const back = next \? \(\(paid && paidEquivalentPath\(next\)\) \|\| next\) : null;/);
  assert.match(src, /const next = normalizeReturnTo\(urlParams\.get\(RETURN_PARAM\)\)/);
  // 再取得の導線
  assert.match(src, /<a href="\/login" class="btn-primary" id="reloginLink">新しいログインリンクを受け取る<\/a>/);
  // 🔴 sessionStorage の自己申告でログイン済みと判断しない
  const fn = src.slice(src.indexOf('async function handleFailure('), src.indexOf('function showSuccess('));
  assert.doesNotMatch(fn, /sessionStorage/);
  // 🔴 表示は textContent（innerHTML に値を流さない）
  const err = src.slice(src.indexOf('function showError('));
  assert.doesNotMatch(err, /innerHTML/);
});

test('🔴 認証の意味は変えていない（verify-magic-link の 1 回・期限判定は従来どおり）', () => {
  const fn = read('netlify/functions/verify-magic-link.js');
  assert.match(fn, /if \(tokenData\.Used\)/);
  assert.match(fn, /new Date\(\) > new Date\(tokenData\.ExpiresAt\)/);
  assert.match(fn, /fields: \{ Used: true \}/);
});
