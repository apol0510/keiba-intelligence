/**
 * uatLogin.test.mjs — 恒久 UAT ログインの安全契約テスト
 *
 * 正本: docs/UAT_PERMANENT_ENV.md
 *
 * ここで守るのは「UAT ログインが本番へ漏れないこと」と
 * 「有料 tier を発行できないこと」。どちらも緩めてはいけない。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  decideUatLogin,
  extractUatKey,
  uatKeyMatches,
  UAT_OUTCOME,
  UAT_LOGIN_KEY_ENV,
  UAT_LOGIN_TIER,
  UAT_MEMBER_EMAIL,
} from './uatLogin.js';

const KEY = 'uat-passphrase-0123456789';
const ENV = { [UAT_LOGIN_KEY_ENV]: KEY };

const PRODUCTION_HOSTS = [
  'keiba-intelligence.jp',
  'www.keiba-intelligence.jp',
  'keiba-intelligence.netlify.app',
  'KEIBA-INTELLIGENCE.JP',
  'keiba-intelligence.jp:443',
];

const UAT_HOST = 'uat--keiba-intelligence.netlify.app';

// ── 契約 1: 本番ホストでは常に無効 ──────────────────────────────

test('🔴 本番ホストでは GET も POST も 404（合言葉が正しくても）', () => {
  for (const host of PRODUCTION_HOSTS) {
    for (const method of ['GET', 'POST']) {
      const r = decideUatLogin({ host, method, env: ENV, providedKey: KEY });
      assert.equal(r.outcome, UAT_OUTCOME.NOT_FOUND, `${host} ${method}`);
      assert.equal(r.statusCode, 404, `${host} ${method}`);
    }
  }
});

test('🔴 本番ホストでは env 未設定でも 404（503 を返して存在を教えない）', () => {
  const r = decideUatLogin({ host: 'keiba-intelligence.jp', method: 'POST', env: {}, providedKey: KEY });
  assert.equal(r.statusCode, 404);
});

test('ホスト不明・空でも 404', () => {
  for (const host of ['', null, undefined, 'example.com']) {
    const r = decideUatLogin({ host, method: 'POST', env: ENV, providedKey: KEY });
    assert.equal(r.outcome, UAT_OUTCOME.NOT_FOUND);
  }
});

// ── 契約 2: 合言葉 env 未設定は fail-closed ─────────────────────

test('🔴 UAT_LOGIN_KEY 未設定なら 503（fail-closed）', () => {
  for (const env of [{}, { [UAT_LOGIN_KEY_ENV]: '' }, { [UAT_LOGIN_KEY_ENV]: '   ' }, {}]) {
    const r = decideUatLogin({ host: UAT_HOST, method: 'POST', env, providedKey: KEY });
    assert.equal(r.outcome, UAT_OUTCOME.NOT_CONFIGURED);
    assert.equal(r.statusCode, 503);
  }
});

// ── 契約 3: 合言葉を URL に載せない ─────────────────────────────

test('🔴 GET は合言葉を受け付けず、フォームを返すだけ', () => {
  const r = decideUatLogin({ host: UAT_HOST, method: 'GET', env: ENV, providedKey: KEY });
  assert.equal(r.outcome, UAT_OUTCOME.FORM);
  assert.equal(r.statusCode, 200);
  assert.notEqual(r.outcome, UAT_OUTCOME.OK, 'GET でセッションを発行してはいけない');
});

test('🔴 extractUatKey はクエリ文字列ではなく body から取る', () => {
  assert.equal(extractUatKey('key=abc', 'application/x-www-form-urlencoded'), 'abc');
  assert.equal(extractUatKey(JSON.stringify({ key: 'abc' }), 'application/json'), 'abc');
  assert.equal(extractUatKey('', 'application/json'), null);
  assert.equal(extractUatKey('not json', 'application/json'), null);
  assert.equal(extractUatKey('key=', 'application/x-www-form-urlencoded'), null);
  assert.equal(extractUatKey(null), null);
});

// ── 契約 4 / 5: timing-safe 照合・不一致は 404 ──────────────────

test('🔴 合言葉が不一致なら 404（違うとは教えない）', () => {
  for (const bad of ['wrong', '', null, KEY + 'x', KEY.slice(0, -1), KEY.toUpperCase()]) {
    const r = decideUatLogin({ host: UAT_HOST, method: 'POST', env: ENV, providedKey: bad });
    assert.equal(r.outcome, UAT_OUTCOME.NOT_FOUND, String(bad));
    assert.equal(r.statusCode, 404, String(bad));
  }
});

test('uatKeyMatches は長さ違いを即拒否し、一致のみ true', () => {
  assert.equal(uatKeyMatches(KEY, KEY), true);
  assert.equal(uatKeyMatches(KEY, KEY + 'x'), false);
  assert.equal(uatKeyMatches('', ''), false);
  assert.equal(uatKeyMatches(undefined, KEY), false);
});

// ── 正常系 ─────────────────────────────────────────────────────

test('UAT ホスト + POST + 合言葉一致で発行可（302）', () => {
  const r = decideUatLogin({ host: UAT_HOST, method: 'POST', env: ENV, providedKey: KEY });
  assert.equal(r.outcome, UAT_OUTCOME.OK);
  assert.equal(r.statusCode, 302);
});

test('Deploy Preview と localhost でも成立する', () => {
  for (const host of ['deploy-preview-42--keiba-intelligence.netlify.app', 'localhost:8888', '127.0.0.1']) {
    const r = decideUatLogin({ host, method: 'POST', env: ENV, providedKey: KEY });
    assert.equal(r.outcome, UAT_OUTCOME.OK, host);
  }
});

test('GET / POST 以外は 405', () => {
  for (const method of ['PUT', 'DELETE', 'PATCH']) {
    const r = decideUatLogin({ host: UAT_HOST, method, env: ENV, providedKey: KEY });
    assert.equal(r.statusCode, 405, method);
  }
});

// ── 契約 6: 有料 tier を発行できない ───────────────────────────

test('🔴 発行する tier は free 固定（premium を発行できない）', () => {
  assert.equal(UAT_LOGIN_TIER, 'free');
  assert.notEqual(UAT_LOGIN_TIER, 'premium');
  assert.notEqual(UAT_LOGIN_TIER, 'light');
});

test('🔴 発行先アドレスは固定で、リクエストから受け取らない', () => {
  assert.equal(typeof UAT_MEMBER_EMAIL, 'string');
  assert.ok(UAT_MEMBER_EMAIL.includes('@'));
  // 🔴 リクエストに email / tier を混ぜても、判定結果は一切変わらない
  const clean = decideUatLogin({ host: UAT_HOST, method: 'POST', env: ENV, providedKey: KEY });
  const injected = decideUatLogin({
    host: UAT_HOST, method: 'POST', env: ENV, providedKey: KEY,
    email: 'attacker@example.com', tier: 'premium', venueAccess: 'all',
  });
  assert.deepEqual(injected, clean, 'email / tier を渡しても判定が変わってはいけない');
  assert.equal(injected.outcome, UAT_OUTCOME.OK);
  // 判定結果は outcome と statusCode だけ。宛先も tier も運ばない
  assert.deepEqual(Object.keys(injected).sort(), ['outcome', 'statusCode']);
});
