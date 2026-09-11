/**
 * uatLogin.guard.test.mjs — UAT ログイン関数が本番の穴にならないこと
 *
 * 正本: docs/UAT_PERMANENT_ENV.md
 *
 * 🔴 ここで守るのは 5 つ。
 *   1. **合言葉を URL から読まない**（`queryStringParameters` を見ない）
 *   2. **本番ホストで無効**（`isPreviewHost` を通してから何もしない）
 *   3. **宛先 email と tier をリクエストから受け取らない**（固定値のみ）
 *   4. **有料 tier を発行しない**（`UAT_LOGIN_TIER` は free 固定）
 *   5. **production の認証・メール経路に手を入れない**
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe('uat-login', () => {
  const src = read('netlify/functions/uat-login.js');
  const lib = read('src/lib/auth/uatLogin.js');

  test('🔴 合言葉を URL から読まない', () => {
    assert.equal(src.includes('queryStringParameters'), false, '🔴 クエリから読んでいる');
    assert.equal(lib.includes('queryStringParameters'), false);
    assert.equal(lib.includes('searchParams'), false, '🔴 判定側がクエリを見ている');
    // body を読むのは POST のときだけ
    assert.match(src, /method\.toUpperCase\(\) === 'POST'/);
  });

  test('🔴 本番ホストでは何も発行しない', () => {
    assert.match(lib, /if \(!isPreviewHost\(host\)\) return done\(UAT_OUTCOME\.NOT_FOUND, 404\)/);
    // 本番判定はホスト名。CONTEXT 等のビルド時変数に頼らない
    assert.equal(lib.includes('process.env.CONTEXT'), false);
    assert.match(src, /UAT_OUTCOME\.NOT_FOUND:[\s\S]{0,120}404/);
  });

  test('🔴 宛先 email と tier をリクエストから受け取らない', () => {
    // 署名するのは固定の定数だけ
    assert.match(src, /email: UAT_MEMBER_EMAIL/);
    assert.match(src, /tier: UAT_LOGIN_TIER/);
    // body から取り出すのは合言葉のみ
    assert.match(src, /extractUatKey\(raw, contentType\)/);
    // 実コード中の `email:` は「固定の定数を渡す 1 箇所」だけ
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const emailAssignments = code.match(/email:\s*[A-Za-z_$][\w$.]*/g) || [];
    assert.deepEqual(emailAssignments, ['email: UAT_MEMBER_EMAIL']);
    const tierAssignments = code.match(/tier:\s*[A-Za-z_$][\w$.]*/g) || [];
    assert.deepEqual(tierAssignments, ['tier: UAT_LOGIN_TIER']);
  });

  test('🔴 有料 tier を発行しない', () => {
    assert.match(lib, /export const UAT_LOGIN_TIER = TIER\.FREE/);
    const code = lib.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.equal(code.includes('TIER.PREMIUM'), false, '🔴 premium を扱っている');
    assert.equal(code.includes('TIER.LIGHT'), false);
  });

  test('🔴 合言葉未設定なら fail-closed', () => {
    assert.match(lib, /if \(!isNonEmptyString\(expected\)\) return done\(UAT_OUTCOME\.NOT_CONFIGURED, 503\)/);
    assert.match(src, /if \(!signed\.ok\) return json\(503/);
  });

  test('🔴 合言葉を返さない・ログに出さない', () => {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal(/console\.(log|error|warn)\([^)]*providedKey/.test(code), false);
    assert.equal(/console\.(log|error|warn)\([^)]*UAT_LOGIN_KEY\]/.test(code), false);
    // 503 で返すのは「どの env が無いか」の名前だけ
    assert.match(src, /missing: UAT_LOGIN_KEY_ENV/);
  });

  test('🔴 production の認証・メール経路に手を入れていない', () => {
    // この関数は production 側の関数を呼ばない／再実装しない
    // （コメントでの言及は許す。実コードだけを見る）
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').toLowerCase();
    for (const forbidden of ['send-magic-link', 'verify-magic-link', 'sendgrid', '@sendgrid']) {
      assert.equal(code.includes(forbidden), false, `🔴 ${forbidden} に触れている`);
    }
    // セッション発行は共通モジュールをそのまま使う（独自実装をしない）
    assert.match(src, /import \{ signSession, serializeSessionCookie \}/);
    assert.equal(src.includes('createHmac'), false, '🔴 署名を自前で実装している');
  });
});
