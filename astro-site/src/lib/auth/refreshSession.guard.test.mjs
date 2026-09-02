/**
 * refreshSession.guard.test.mjs — 決済後の Cookie 出し直しが認証の穴にならないこと
 *
 * 🔴 ここで守るのは 5 つ。
 *   1. **ログインの入口にしない**（有効なセッションが無ければ 401）
 *   2. email は **セッション由来のみ**（リクエストの中身を見ない）
 *   3. tier は **Airtable からだけ**決める（`verify-magic-link` と同じ関数）
 *   4. **セッションの寿命を延ばさない**（残り時間を引き継ぐ）
 *   5. **何も書き込まない**（premium を与えるのは Stripe webhook だけ）
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe('refresh-session', () => {
  const src = read('netlify/functions/refresh-session.js');

  test('🔴 ログインの入口にしない', () => {
    assert.match(src, /resolveEntitlement\(/);
    assert.match(src, /if \(!ent\.authenticated \|\| !ent\.email\)/);
    assert.match(src, /statusCode: 401[\s\S]{0,80}login_required/);
    // POST 以外は受けない（Cookie を差し替えるため）
    assert.match(src, /event\.httpMethod !== 'POST'/);
  });

  test('🔴 email はセッション由来のみ（リクエストの中身を見ない）', () => {
    assert.equal(src.includes('event.body'), false, '🔴 リクエスト本文を読んでいる');
    assert.equal(src.includes('JSON.parse(event'), false);
    assert.equal(src.includes('queryStringParameters'), false);
    assert.match(src, /\{Email\} = "\$\{escaped\}"/);
    assert.match(src, /const escaped = String\(ent\.email\)/);
  });

  test('🔴 tier は Airtable からだけ決める', () => {
    // verify-magic-link と同じ関数を使う
    assert.match(src, /planTypeToTier\(customer\.PlanType/);
    assert.match(src, /applyExpiry\(/);
    const verify = read('netlify/functions/verify-magic-link.js');
    assert.match(verify, /planTypeToTier\(/);
    assert.match(verify, /applyExpiry\(/);
    // 固定で有料を入れていない
    assert.equal(/tier\s*=\s*['"](premium|light)['"]/.test(src), false);
  });

  test('🔴 セッションの寿命を延ばさない', () => {
    assert.match(src, /const remainingSeconds = Math\.floor\(\(ent\.expiresAtMs - nowMs\) \/ 1000\)/);
    assert.match(src, /ttlSeconds: remainingSeconds/);
    assert.match(src, /maxAgeSeconds: remainingSeconds/);
    // 既定 TTL で作り直していない
    assert.equal(src.includes('SESSION_TTL_SECONDS'), false,
      '🔴 既定 TTL で発行し直している（満了を先送りしている）');
  });

  test('🔴 何も書き込まない', () => {
    for (const bad of ['.update(', '.create(', '.destroy(']) {
      assert.equal(src.includes(bad), false, `🔴 Airtable へ書き込んでいる: ${bad}`);
    }
    // 読み出しは select のみ
    assert.match(src, /customersTable\s*\n?\s*\.select\(/);
    assert.equal(src.includes('stripe'), false, '🔴 Stripe を直接触っている');
  });

  test('🔴 判断できないときは今の Cookie を残す', () => {
    // env 不足・レコード無し・署名不可のいずれでも降格させない
    assert.match(src, /not_configured/);
    assert.match(src, /tier: ent\.tier, changed: false/);
  });

  test('🔴 マイページは決済直後だけ呼び、1 回で終わる', () => {
    const page = read('src/pages/mypage.astro');
    assert.match(page, /params\.get\('checkout'\) !== 'success'/);
    assert.match(page, /\/\.netlify\/functions\/refresh-session/);
    // 反映できたら ?checkout を落として読み込み直す（繰り返さない）
    assert.match(page, /window\.location\.replace\(window\.location\.pathname\)/);
  });
});
