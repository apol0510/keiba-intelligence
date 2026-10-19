/**
 * adminAuth.test.mjs — 管理 API の認証・CORS 判定（純関数）
 *
 * 実行: npm run test:admin-auth （astro-site 直下から）
 *
 * 🔴 鍵・メールアドレスは実行時に作る（固定の秘密値らしい文字列をソースに置かない）。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  ADMIN_API_KEY_ENV,
  ADMIN_KEY_HEADER,
  ADMIN_KEY_MIN_LENGTH,
  ADMIN_DENY,
  adminKeyMatches,
  configuredAdminKey,
  decideAdminAccess,
  adminCorsHeaders,
  allowedRequestOrigin,
  guardAdminRequest,
  isAllowedTestRecipient,
  adminRecipientAllowlist,
} from './adminAuth.js';

const newKey = () => randomBytes(24).toString('hex');
const addr = (local) => [local, 'example.invalid'].join('@');

describe('🔴 decideAdminAccess', () => {
  test('env 未設定なら、どんなヘッダーでも 403（fail-closed）', () => {
    const key = newKey();
    for (const env of [{}, { [ADMIN_API_KEY_ENV]: '' }, { [ADMIN_API_KEY_ENV]: '   ' }]) {
      const d = decideAdminAccess({ headers: { [ADMIN_KEY_HEADER]: key }, env });
      assert.equal(d.ok, false);
      assert.equal(d.statusCode, 403);
      assert.equal(d.reason, ADMIN_DENY.NOT_CONFIGURED);
    }
  });

  test('短すぎる鍵は設定ミスとして成立させない', () => {
    const short = 'k'.repeat(ADMIN_KEY_MIN_LENGTH - 1);
    assert.equal(configuredAdminKey({ [ADMIN_API_KEY_ENV]: short }), null);
    const d = decideAdminAccess({ headers: { [ADMIN_KEY_HEADER]: short }, env: { [ADMIN_API_KEY_ENV]: short } });
    assert.equal(d.ok, false);
    assert.equal(d.reason, ADMIN_DENY.NOT_CONFIGURED);
  });

  test('鍵なし・違う鍵は 403', () => {
    const env = { [ADMIN_API_KEY_ENV]: newKey() };
    assert.equal(decideAdminAccess({ headers: {}, env }).reason, ADMIN_DENY.MISSING_KEY);
    assert.equal(decideAdminAccess({ headers: { [ADMIN_KEY_HEADER]: newKey() }, env }).reason, ADMIN_DENY.INVALID_KEY);
    assert.equal(decideAdminAccess({ headers: { [ADMIN_KEY_HEADER]: env[ADMIN_API_KEY_ENV].slice(0, -1) }, env }).reason, ADMIN_DENY.INVALID_KEY);
  });

  test('正しい鍵（ヘッダー名の大文字小文字は問わない）なら通る', () => {
    const key = newKey();
    const env = { [ADMIN_API_KEY_ENV]: key };
    assert.equal(decideAdminAccess({ headers: { [ADMIN_KEY_HEADER]: key }, env }).ok, true);
    assert.equal(decideAdminAccess({ headers: { 'X-KI-Admin-Key': key }, env }).ok, true);
  });

  test('🔴 許可外の Origin からは、鍵が正しくても 403', () => {
    const key = newKey();
    const env = { [ADMIN_API_KEY_ENV]: key };
    const d = decideAdminAccess({
      headers: { [ADMIN_KEY_HEADER]: key, origin: 'https://evil.example', host: 'keiba-intelligence.jp' },
      env,
    });
    assert.equal(d.ok, false);
    assert.equal(d.reason, ADMIN_DENY.ORIGIN_FORBIDDEN);
  });

  test('adminKeyMatches は空・非文字列を拒否する', () => {
    const key = newKey();
    assert.equal(adminKeyMatches('', key), false);
    assert.equal(adminKeyMatches(key, ''), false);
    assert.equal(adminKeyMatches(undefined, key), false);
    assert.equal(adminKeyMatches(key, key), true);
  });
});

describe('🔴 CORS', () => {
  test('`*` を返さない。許可外 origin には Allow-Origin を付けない', () => {
    const h = adminCorsHeaders({ origin: 'https://evil.example', host: 'keiba-intelligence.jp' }, 'POST, OPTIONS');
    assert.equal(h['Access-Control-Allow-Origin'], undefined);
    assert.equal(h.Vary, 'Origin');
    assert.match(h['Access-Control-Allow-Headers'], /X-KI-Admin-Key/);
  });

  test('本番 / www は許可する', () => {
    for (const o of ['https://keiba-intelligence.jp', 'https://www.keiba-intelligence.jp']) {
      assert.equal(adminCorsHeaders({ origin: o }, 'GET, OPTIONS')['Access-Control-Allow-Origin'], o);
    }
  });

  test('同一ホストの Deploy Preview は許可、別の netlify.app は拒否', () => {
    const host = 'deploy-preview-1--example.netlify.app';
    assert.equal(allowedRequestOrigin({ origin: `https://${host}`, host }), `https://${host}`);
    assert.equal(allowedRequestOrigin({ origin: 'https://other--example.netlify.app', host }), null);
    assert.equal(allowedRequestOrigin({ origin: `http://${host}`, host }), null, 'http は拒否');
    assert.equal(allowedRequestOrigin({ origin: 'null', host }), null);
  });

  test('guardAdminRequest: OPTIONS は 204、許可外メソッドは 405、鍵なしは 403', () => {
    const env = { [ADMIN_API_KEY_ENV]: newKey() };
    assert.equal(guardAdminRequest({ httpMethod: 'OPTIONS', headers: {} }, { method: 'POST', env }).response.statusCode, 204);
    assert.equal(guardAdminRequest({ httpMethod: 'GET', headers: {} }, { method: 'POST', env }).response.statusCode, 405);
    const r = guardAdminRequest({ httpMethod: 'POST', headers: {} }, { method: 'POST', env }).response;
    assert.equal(r.statusCode, 403);
    assert.ok(!r.body.includes(env[ADMIN_API_KEY_ENV]));
    assert.equal(guardAdminRequest({ httpMethod: 'POST', headers: { [ADMIN_KEY_HEADER]: env[ADMIN_API_KEY_ENV] } }, { method: 'POST', env }).response, null);
  });
});

describe('テスト送信の宛先制限', () => {
  test('🔴 ADMIN_EMAILS 未設定でも空文字を許可しない（従来の [\'\'] 事故）', () => {
    assert.deepEqual(adminRecipientAllowlist({}), []);
    assert.equal(isAllowedTestRecipient('', {}), false);
    assert.equal(isAllowedTestRecipient('', { ADMIN_EMAILS: '' }), false);
  });

  test('ADMIN_EMAILS と ADMIN_EMAIL を大文字小文字を区別せずに使う', () => {
    const a = addr('owner');
    const b = addr('ops');
    const env = { ADMIN_EMAILS: `${a}, ,`, ADMIN_EMAIL: b.toUpperCase() };
    assert.equal(isAllowedTestRecipient(a.toUpperCase(), env), true);
    assert.equal(isAllowedTestRecipient(b, env), true);
    assert.equal(isAllowedTestRecipient(addr('stranger'), env), false);
  });
});

describe('🔴 静的ガード: 管理 API が body のメールで認証していない・CORS * を返さない', () => {
  const FUNCS = ['create-broadcast', 'send-broadcast', 'send-test', 'get-broadcast', 'get-broadcasts'];
  for (const name of FUNCS) {
    test(name, () => {
      const src = readFileSync(new URL(`../../../netlify/functions/${name}.js`, import.meta.url), 'utf8');
      assert.match(src, /guardAdminRequest\(event/, 'guardAdminRequest を通していない');
      assert.ok(!/'Access-Control-Allow-Origin':\s*'\*'/.test(src), 'CORS * が残っている');
      assert.ok(!/ADMIN_EMAILS\.includes\(/.test(src), 'body のメールで管理者判定している');
      const guardAt = src.indexOf('guardAdminRequest(event');
      const parseAt = src.indexOf('JSON.parse(event.body)');
      if (parseAt >= 0) assert.ok(guardAt < parseAt, 'body を読む前に認証していない');
    });
  }

  test('管理画面は鍵をヘッダーで送り、管理者アドレスを body に入れない', () => {
    for (const page of ['index.astro', 'new.astro', '[id].astro']) {
      const src = readFileSync(new URL(`../../pages/admin/newsletter/${page}`, import.meta.url), 'utf8');
      assert.match(src, /adminFetch\(/, `${page}: adminFetch を使っていない`);
      assert.ok(!/await fetch\('\/\.netlify\/functions\//.test(src), `${page}: 素の fetch で管理 API を呼んでいる`);
      assert.ok(!/user_email/.test(src), `${page}: user_email を送っている`);
    }
  });
});

describe('register-free の token（registry 7a7522ac）', () => {
  test('🔴 Math.random で token を作らず、crypto.randomUUID を使う', () => {
    const src = readFileSync(new URL('../../../netlify/functions/register-free.js', import.meta.url), 'utf8');
    assert.ok(!/Math\.random\(\)/.test(src), 'Math.random が残っている');
    assert.match(src, /const token = crypto\.randomUUID\(\);/);
  });

  test('crypto.randomUUID の形式は verify が受け付ける UUID v4（PR #157 の検証器と同じ正規表現）', async () => {
    const { randomUUID } = await import('node:crypto');
    const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    for (let i = 0; i < 50; i++) assert.match(randomUUID(), UUID_V4_RE);
  });
});
