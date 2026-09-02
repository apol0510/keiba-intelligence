/**
 * siteOrigin.test.mjs — 決済後の戻り先 origin
 *
 * 🔴 これは `success_url` / `cancel_url` / `return_url` になる値である。
 *    任意の Origin を信じると、決済後の戻り先を第三者サイトへ向けられる。
 *    許可外は **すべて本番へ倒す**（fail-closed）ことを固定する。
 *
 * 🔴 認可・課金の条件は変えていない。変わるのは戻り先 URL だけ。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { DEFAULT_SITE_ORIGIN, normalizeSiteOrigin, resolveSiteOrigin } from './siteOrigin.js';

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(siteRoot, p), 'utf8');

const BRANCH = 'https://test-stripe-testmode-e2e-2026-09-01--keiba-intelligence.netlify.app';

describe('本番の挙動は不変', () => {
  test('本番 Origin はそのまま', () => {
    assert.equal(resolveSiteOrigin({ origin: 'https://keiba-intelligence.jp' }), 'https://keiba-intelligence.jp');
    assert.equal(resolveSiteOrigin({ origin: 'https://www.keiba-intelligence.jp' }), 'https://www.keiba-intelligence.jp');
  });

  test('Origin も Host も無ければ本番', () => {
    assert.equal(resolveSiteOrigin({}), DEFAULT_SITE_ORIGIN);
    assert.equal(resolveSiteOrigin(null), DEFAULT_SITE_ORIGIN);
    assert.equal(DEFAULT_SITE_ORIGIN, 'https://keiba-intelligence.jp');
  });

  test('Host からも復元できる（Origin が無いブラウザ以外の経路）', () => {
    assert.equal(resolveSiteOrigin({ host: 'keiba-intelligence.jp' }), 'https://keiba-intelligence.jp');
  });
});

describe('🔴 ブランチデプロイ / Deploy Preview で本番へ倒れない（今回の不具合）', () => {
  test('ブランチデプロイの Origin を受け付ける', () => {
    assert.equal(resolveSiteOrigin({ origin: BRANCH }), BRANCH);
  });

  test('Deploy Preview の Origin を受け付ける', () => {
    const dp = 'https://deploy-preview-91--keiba-intelligence.netlify.app';
    assert.equal(resolveSiteOrigin({ origin: dp }), dp);
  });

  test('Origin が無くても Host から復元する', () => {
    assert.equal(
      resolveSiteOrigin({ host: 'test-stripe-testmode-e2e-2026-09-01--keiba-intelligence.netlify.app' }),
      BRANCH,
    );
  });

  test('ローカル開発は http', () => {
    assert.equal(resolveSiteOrigin({ host: 'localhost:8888' }), 'http://localhost:8888');
    assert.equal(resolveSiteOrigin({ origin: 'http://localhost:4321' }), 'http://localhost:4321');
  });
});

describe('🔴 許可外は本番へ倒す（オープンリダイレクトを作らない）', () => {
  const BAD = [
    'https://evil.example.com',
    'https://keiba-intelligence.jp.evil.com',
    'https://netlify.app.evil.com',
    'https://evil.com/?x=1',
    'http://keiba-intelligence.jp',
    'https://user:pass@keiba-intelligence.jp',
    'https://keiba-intelligence.jp/path',
    'javascript:alert(1)',
    'data:text/html,x',
    'null',
    '',
    '   ',
  ];

  test('Origin が許可外なら本番', () => {
    for (const o of BAD) {
      assert.equal(resolveSiteOrigin({ origin: o }), DEFAULT_SITE_ORIGIN, `🔴 許可した: ${o}`);
    }
  });

  test('Host が許可外なら本番', () => {
    for (const h of ['evil.example.com', 'keiba-intelligence.jp.evil.com', 'netlify.app.evil.com']) {
      assert.equal(resolveSiteOrigin({ host: h }), DEFAULT_SITE_ORIGIN, `🔴 許可した: ${h}`);
    }
  });

  test('normalizeSiteOrigin は許可外に null を返す', () => {
    for (const o of BAD) assert.equal(normalizeSiteOrigin(o), null, `🔴 許可した: ${o}`);
    assert.equal(normalizeSiteOrigin(BRANCH), BRANCH);
  });
});

describe('Stripe 関数が共有ポリシーを使っている', () => {
  test('🔴 checkout / portal が独自の許可リスト判定に戻っていない', () => {
    for (const f of ['netlify/functions/stripe-create-checkout.js', 'netlify/functions/stripe-portal.js']) {
      const src = read(f);
      assert.match(src, /resolveSiteOrigin\(event\.headers\)/, `${f}: 共有ポリシーを使っていない`);
      assert.doesNotMatch(src, /if \(ALLOWED_ORIGINS\.includes\(origin\)\) return origin;/,
        `${f}: 旧判定（本番へ倒れる）が残っている`);
    }
  });

  test('🔴 認可・課金の条件は変えていない', () => {
    const src = read('netlify/functions/stripe-create-checkout.js');
    assert.match(src, /mode: 'subscription'/);
    assert.match(src, /line_items: \[\{ price: priceId, quantity: 1 \}\]/);
    assert.match(src, /customer_email: ent\.email/);
    assert.match(src, /metadata: \{ ki_plan: plan\.id, ki_email: ent\.email \}/);
    assert.match(src, /login_required/);
    const portal = read('netlify/functions/stripe-portal.js');
    assert.match(portal, /if \(!ent\.authenticated \|\| !ent\.email\)/);
  });
});
