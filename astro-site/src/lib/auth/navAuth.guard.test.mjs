/**
 * navAuth.guard.test.mjs — ログイン状態の表示が Cookie と食い違わないこと
 *
 * 🔴 ここで守るのは 3 つ。
 *   1. 表示の判定に `sessionStorage` を使わない（タブ単位の自己申告で正本とずれる）
 *   2. ログイン中は「マイページ／ログアウト」、未ログインは「無料登録／ログイン」
 *   3. 表示が変わるだけで、**認可はサーバー側の entitlement のまま**
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe('ナビのログイン表示', () => {
  const layout = read('src/layouts/BaseLayout.astro');

  test('🔴 表示判定に sessionStorage を使わない', () => {
    // コメント（経緯の説明）以外に sessionStorage の読み書きが無いこと
    assert.equal(/sessionStorage\s*\.\s*(getItem|setItem)/.test(layout), false,
      '🔴 ナビが sessionStorage を読んでいる（Cookie とずれる）');
    assert.match(layout, /get-session/, 'Cookie を検証する API を見ていない');
    assert.match(layout, /credentials: 'include'/);
  });

  test('🔴 ログイン中と未ログインで出す導線が入れ替わる', () => {
    // 未ログイン向け
    assert.match(layout, /href="\/register" data-auth-out/);
    assert.match(layout, /href="\/login" data-auth-out/);
    // ログイン中向け
    assert.match(layout, /href="\/mypage" data-auth-in/);
    assert.match(layout, /action="\/\.netlify\/functions\/logout"[\s\S]{0,80}data-auth-in/);
    // サーバー描画でも初期状態を合わせる
    assert.match(layout, /data-auth=\{navAuthed \? 'in' : 'out'\}/);
    assert.match(layout, /entitlementFromAstro\(Astro\)/);
  });

  test('🔴 ログイン中に「無料会員登録」を出し続けない', () => {
    assert.match(layout, /class="footer-cta" data-auth-out/);
    for (const p of ['src/pages/login.astro', 'src/pages/register.astro']) {
      assert.match(read(p), /data-auth-in hidden/, `${p} にログイン中の案内が無い`);
    }
  });

  test('🔴 マスクはクライアント処理をやめ、サーバー応答に従う', () => {
    const c = read('src/components/AIRaceComment.astro');
    assert.equal(/sessionStorage\s*\.\s*getItem/.test(c), false,
      '🔴 マスク解除が sessionStorage 依存のまま');
    // 廃止プラン名で判定していない
    assert.equal(/plan === 'pro'/.test(c), false);
    // クライアントで本文を切らない（切る＝隠す本文が手元にある）
    assert.equal(c.includes('const hidden = fullText.slice'), false,
      '🔴 クライアントが本文を分割している');
    assert.match(c, /credentials: 'include'/);
  });
});
