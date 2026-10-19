/**
 * loginGuidance.test.mjs — ログイン画面・予想ページの帯で、既存会員と未登録者を迷わせない
 *
 * 正本: docs/measurements/LOGIN_GUIDANCE_2026_10.md
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loginFailureCopy } from './loginGuidance.js';
import { loginLinkResultOf } from '../analytics/funnelEvents.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, '..', '..', '..', p), 'utf8');

test('未登録（404）は無料会員登録へ案内し、有料プランへは誘導しない', () => {
  const c = loginFailureCopy(404);
  assert.equal(c.register, true);
  assert.match(c.message, /無料会員登録/);
  assert.doesNotMatch(c.message, /料金プラン/);
});

test('停止中（403）・その他は登録へ誘導しない', () => {
  assert.equal(loginFailureCopy(403).register, false);
  assert.equal(loginFailureCopy(500).register, false);
  assert.equal(loginFailureCopy(0).register, false);
});

test('loginLinkResultOf: 状態を列挙値にする', () => {
  assert.equal(loginLinkResultOf(200), 'sent');
  assert.equal(loginLinkResultOf(404), 'not_found');
  assert.equal(loginLinkResultOf(403), 'blocked');
  assert.equal(loginLinkResultOf(500), 'error');
  assert.equal(loginLinkResultOf(429), 'error');
});

test('login.astro: 未登録の案内と下部の案内は /register、送信後にブラウザの補足', () => {
  const src = read('src/pages/login.astro');
  assert.match(src, /<a href="\/register">無料会員登録へ進む<\/a>/);
  assert.match(src, /アカウントをお持ちでない方は、<a href="\/register">無料会員登録<\/a>から始められます。/);
  assert.doesNotMatch(src, /料金プランからご登録ください/);
  assert.match(src, /browserHint\.hidden = false;/);
  // 🔴 表示は固定文言（textContent）。innerHTML に値を流さない
  assert.doesNotMatch(src, /innerHTML/);
});

test('TierRibbon: ゲストだけに「登録済みの方はログイン」（ログイン済み・プレビューでは出さない）', () => {
  const src = read('src/components/newspaper/TierRibbon.astro');
  assert.match(src, /const showLogin = !view\?\.authenticated && !view\?\.preview;/);
  assert.match(src, /\{showLogin && <a class="tr-login" href="\/login">登録済みの方はログイン<\/a>\}/);
  // 主要 CTA は 1 つのまま（増やさない）
  assert.equal((src.match(/class="tr-cta"/g) || []).length, 1);
});
