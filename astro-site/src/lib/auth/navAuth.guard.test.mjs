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

  test('🔴 通常ログイン後は全会員 /mypage（spec.md §6-9）', () => {
    // 仕様所有者承認済み（2026-09-02）。docs/spec.md §6-9 / docs/decisions.md。
    const fn = read('netlify/functions/verify-magic-link.js');
    assert.match(fn, /let redirectTo = '\/mypage';/);
    // tier・会場で分けない
    assert.equal(/redirectTo = '\/free-prediction'/.test(fn), false,
      '🔴 tier で遷移先を分けている（spec.md §6-9 違反）');
    assert.equal(/TIER\.LIGHT \|\| tier === TIER\.PREMIUM\) redirectTo/.test(fn), false);
    // 例外は購入途中だけ。固定パスで上書きする
    assert.match(fn, /redirectTo = resumePathFor\(rawIntent, redirectTo\);/);
  });

  test('🔴 遷移先を決めるのはサーバー（クライアントはパスを組み立てない）', () => {
    const v = read('src/pages/auth/verify.astro');
    assert.match(v, /const to = data\.redirectTo \|\| '\/mypage'/);
    assert.match(v, /window\.location\.href = data\.redirectTo \|\| '\/mypage'/);
    // 受け取った値を組み立て直していない（open redirect 防止）
    assert.equal(/location\.href = ['"`]\/.*\$\{/.test(v), false,
      '🔴 受け取った値からパスを作っている');
  });

  test('🔴 文言が実際の遷移先と一致する', () => {
    const v = read('src/pages/auth/verify.astro');
    assert.match(v, /'\/mypage'\) === 0[\s\S]{0,60}マイページへ移動します/);
    assert.match(v, /showSuccess\('ログインしました', where\)/);
    assert.match(v, /showSuccess\('メールアドレスを確認しました', 'このままお支払い画面へ進みます…'\)/);
  });

  test('🔴 正本に契約が書かれている', () => {
    const spec = read('../docs/spec.md');
    assert.match(spec, /ログイン後の遷移先契約/);
    assert.match(spec, /tier を問わず全会員 `\/mypage`/);
    assert.match(spec, /購入途中/);
    const dec = read('../docs/decisions.md');
    assert.match(dec, /通常ログイン後の遷移先を全会員 `\/mypage` に統一する/);
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

/* ------------------------------------------------------------------
   モバイルメニューは「どこを触っても閉じる」

   🔴 以前はボタンをもう一度押すまで開きっぱなしだった。
      選ぶものが無くてページ下部へスクロールしたいときも開いたままで、
      裏の本文だけがスクロールしてしまった（2026-09-03 指摘・iPhone）。
   ------------------------------------------------------------------ */

test('🔴 モバイルメニューが閉じる契機を減らさない', () => {
  const layout = read('src/layouts/BaseLayout.astro');

  // 開閉が関数に集約されている（インラインの display トグルへ戻さない）
  assert.match(layout, /function closeMenu\s*\(/, 'closeMenu が無い');
  assert.match(layout, /function openMenu\s*\(/, 'openMenu が無い');

  // 1. メニューの外をタップ
  assert.match(layout, /!navLinks\.contains\(e\.target\)/, '外側タップで閉じていない');
  // 2. メニュー内のリンク・ボタンを選ぶ
  assert.match(layout, /closest\(['"]a, button['"]\)/, 'リンク選択で閉じていない');
  // 3. Esc
  assert.match(layout, /e\.key === ['"]Escape['"]/, 'Esc で閉じていない');
  // 4. スクロール
  assert.match(layout, /addEventListener\(['"]scroll['"]/, 'スクロールで閉じていない');
  // 5. デスクトップ幅へ戻る
  assert.match(layout, /min-width: 769px/, '幅が戻ったときに閉じていない');

  // 状態は aria-expanded で持つ（読み上げにも伝わる）
  assert.match(layout, /aria-expanded/, 'aria-expanded を更新していない');
  // 閉じたらインラインスタイルを残さない
  assert.match(layout, /navLinks\.removeAttribute\(['"]style['"]\)/, 'インラインスタイルが残る');
});
