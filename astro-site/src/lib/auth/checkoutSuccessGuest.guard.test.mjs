/**
 * checkoutSuccessGuest.guard.test.mjs
 *   — 決済直後 `/mypage?checkout=success` で未ログインだったときの表示
 *
 * 🔴 ここで守るのは 4 つ。
 *   1. 未ログインの `?checkout=success` では **無料会員登録の導線を 1 つも出さない**
 *      （本文・ヘッダー「無料登録」・フッター「無料会員登録 →」のすべて）
 *   2. 通常の未ログイン `/mypage`（`?checkout=success` なし）は **従来のまま**
 *   3. ログイン済みの `checkout=success` の `refresh-session` 動作は **維持**
 *   4. `checkout=success` を **認証・決済成功の証拠に使わない**（fail-closed 維持）
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const mypage = read('src/pages/mypage.astro');
const layout = read('src/layouts/BaseLayout.astro');

/** 無料会員登録の導線とみなす文字列。**この画面に 1 つも出さない**。 */
const REGISTER_CTA = ['/register', '無料登録', '無料会員登録', '無料会員に登録'];

/** `?checkout=success` かつ未ログインのときに描画されるブロックだけを切り出す。 */
function afterCheckoutBlock() {
  const start = mypage.indexOf('{!ent.authenticated && afterCheckoutUnauthed ? (');
  assert.notEqual(start, -1, '🔴 決済直後・未ログインの分岐が無い');
  const end = mypage.indexOf(') : !ent.authenticated ? (', start);
  assert.notEqual(end, -1, '🔴 通常の未ログイン分岐が後ろに無い');
  return mypage.slice(start, end);
}

describe('決済直後・未ログインの /mypage', () => {
  test('🔴 無料会員登録の導線が本文に 0 件', () => {
    const block = afterCheckoutBlock();
    for (const cta of REGISTER_CTA) {
      const n = block.split(cta).length - 1;
      assert.equal(n, 0, `🔴 決済直後の画面に「${cta}」が ${n} 件ある`);
    }
  });

  test('🔴 出すのは案内文とログインだけ', () => {
    const block = afterCheckoutBlock();
    assert.match(block, /お支払い後の確認にはログインが必要です/);
    assert.match(block, /href="\/login"/);
    // 予想ページ等の別導線も出さない
    assert.equal(block.includes('/prediction/'), false, '🔴 ログイン以外の導線が残っている');
  });

  test('🔴 ヘッダー・フッターの無料登録も DOM ごと出さない', () => {
    // mypage が層へ渡している
    assert.match(mypage, /hideFreeRegisterCta=\{afterCheckoutUnauthed\}/);
    // 層は 2 か所とも条件付きレンダリングで包んでいる
    assert.match(layout, /\{!hideFreeRegisterCta && \(\s*<a href="\/register" data-auth-out/);
    assert.match(layout, /\{!hideFreeRegisterCta && \(\s*<a href="\/register" class="footer-cta" data-auth-out/);
  });

  test('🔴 AI チャットの関連リンクからも無料会員登録が消える', () => {
    // `AIChat.astro` の getRelatedLinks() は `is:inline` のスクリプトなので、
    // 出し分けを実行時に判定しても **文字列ごと HTML に載る**。
    // だからこの画面ではウィジェットごと描画しない。
    assert.match(layout, /\{!hideFreeRegisterCta && <AIChat \/>\}/);
    const chat = read('src/components/AIChat.astro');
    assert.match(chat, /href: '\/register'/, '前提が変わっている（AIChat に登録リンクが無い）');
  });

  test('🔴 `hidden` で隠すだけにしない（get-session の応答で復活するため）', () => {
    // `[data-auth-out]` の hidden はページ末尾の JS が一括で外す
    assert.match(layout, /\[data-auth-out\]/);
    // だから hideFreeRegisterCta は hidden ではなく描画そのものを止めていること
    const header = layout.slice(layout.indexOf('id="auth-nav-button"'));
    assert.equal(/hidden=\{hideFreeRegisterCta\}/.test(header), false,
      '🔴 hidden 属性で隠しているだけ。JS で復活する');
  });
});

describe('通常の未ログイン /mypage（従来どおり）', () => {
  test('🔴 従来の 3 つの導線が残っている', () => {
    const start = mypage.indexOf(') : !ent.authenticated ? (');
    const block = mypage.slice(start, mypage.indexOf(') : (', start + 10));
    assert.match(block, /ログインが必要です/);
    assert.match(block, /href="\/login"/);
    assert.match(block, /href="\/register">無料会員に登録/);
    assert.match(block, /href="\/prediction\/nankan"/);
  });

  test('🔴 通常の未ログインでは無料登録を消さない', () => {
    // 消す条件は「checkout=success かつ未ログイン」だけ
    assert.match(mypage, /const afterCheckoutUnauthed = checkoutSuccess && !ent\.authenticated;/);
  });
});

describe('fail-closed の維持', () => {
  test('🔴 checkout=success を認証・決済成功の証拠にしない', () => {
    // 読むのは searchParams から真偽を作るところだけ
    assert.match(mypage, /const checkoutSuccess = Astro\.url\.searchParams\.get\('checkout'\) === 'success';/);
    // tier / 認可を書き換えていない
    assert.equal(/checkoutSuccess[^\n]*\b(tier|isPaid|authenticated)\s*=/.test(mypage), false,
      '🔴 checkout=success が認可の判定に混ざっている');
    // `isPaid` は const 宣言の 1 回だけ。あとから代入し直していない
    const assigns = mypage.match(/\bisPaid\s*=[^=]/g) || [];
    assert.equal(assigns.length, 1, '🔴 isPaid が宣言以外で代入されている');
    // 認可の正本は従来どおり entitlement
    assert.match(mypage, /const ent = entitlementFromAstro\(Astro\);/);
    assert.match(mypage, /const isPaid = tierAtLeast\(ent\.tier, TIER\.LIGHT\);/);
  });

  test('🔴 有料情報は authenticated のときだけ読みに行く', () => {
    assert.match(mypage, /if \(membershipStore\.enabled && ent\.authenticated && ent\.email\)/);
  });
});

describe('ログイン済みの checkout=success（維持）', () => {
  test('🔴 refresh-session で出し直す動作を残す', () => {
    assert.match(mypage, /params\.get\('checkout'\) !== 'success'/);
    assert.match(mypage, /refresh-session/);
  });
});
