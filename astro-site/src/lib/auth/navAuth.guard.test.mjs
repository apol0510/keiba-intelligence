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

  test('🔴 認証完了の表示は「何が起きたか」＋「次に何が起きるか」', () => {
    const v = read('src/pages/auth/verify.astro');

    // 購入導線
    assert.match(v, /showSuccess\('メールアドレスを確認しました', 'このままお支払い画面へ進みます…'\)/);
    // 通常ログイン
    assert.match(v, /showSuccess\('ログインしました', where\)/);

    // 🔴 技術用語・意味の薄い言い方に戻さない
    for (const bad of ['認証成功！', 'リダイレクトしています', "showSuccess('確認できました'"]) {
      assert.equal(v.includes(bad), false, `🔴 「${bad}」に戻っている`);
    }
  });

  test('🔴 遷移先と案内文が食い違わない', () => {
    // 無料会員は /free-prediction、有料は /mypage へ行く。
    // 文言を「マイページへ」に固定すると無料会員に嘘の案内になる。
    const v = read('src/pages/auth/verify.astro');
    assert.match(v, /const to = data\.redirectTo \|\| '\/free-prediction'/);
    assert.match(v, /'\/mypage'\) === 0[\s\S]{0,60}マイページへ移動します/);
    assert.match(v, /'\/free-prediction'\) === 0[\s\S]{0,40}今日の予想へ移動します/);

    // 行き先を決めているのはサーバー（ここでパスを作らない）
    const fn = read('netlify/functions/verify-magic-link.js');
    assert.match(fn, /let redirectTo = '\/free-prediction';/);
    assert.match(fn, /redirectTo = '\/mypage';/);
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
