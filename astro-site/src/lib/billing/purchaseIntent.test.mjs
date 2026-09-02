/**
 * purchaseIntent.test.mjs — 購入意図を認証をまたいで持ち越す
 *
 * 🔴 ここで守るのは 3 つ。
 *   1. **URL を持ち越さない**（open redirect を作らない）
 *   2. 受け付けるのは `plans.js` にあるプラン id だけ
 *   3. 認証・認可の契約は変えない（Checkout は認証済みのみ・email はセッション由来）
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  INTENT_PARAM, RESUME_PARAM,
  isPurchasableIntent, normalizeIntent, intentQuery, resumePathFor,
} from './purchaseIntent.js';
import { PLANS } from './plans.js';

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(siteRoot, p), 'utf8');
const FALLBACK = '/free-prediction';

describe('受け付けるのは実在するプラン id だけ', () => {
  test('plans.js にある id は通る', () => {
    assert.ok(PLANS.length > 0);
    for (const p of PLANS) {
      assert.equal(isPurchasableIntent(p.id), true, `${p.id} を弾いている`);
      assert.equal(normalizeIntent(p.id), p.id);
    }
  });

  test('🔴 保留中・未知・空・型違いは意図なし', () => {
    for (const v of ['light', 'admin', 'free', '', '   ', null, undefined, 123, {}, ['premium']]) {
      assert.equal(normalizeIntent(v), null, `🔴 受け付けている: ${JSON.stringify(v)}`);
    }
  });
});

describe('🔴 URL を持ち越さない（open redirect を作らない）', () => {
  const EVIL = [
    'https://evil.example.com',
    '//evil.example.com',
    '/pricing?resume=premium&x=1',
    'javascript:alert(1)',
    'https://keiba-intelligence.jp/mypage',
    '../../etc/passwd',
    'premium/../../evil',
  ];

  test('戻り先は常に自前の固定パスか従来の戻り先', () => {
    for (const v of EVIL) {
      assert.equal(resumePathFor(v, FALLBACK), FALLBACK, `🔴 外部/任意パスへ倒れた: ${v}`);
    }
  });

  test('正当な意図でも組み立てるのは固定パスだけ', () => {
    assert.equal(resumePathFor('premium', FALLBACK), '/pricing?resume=premium');
    // 受け取った文字列をそのままパスに使っていない
    assert.equal(resumePathFor('premium', FALLBACK).startsWith('/pricing?'), true);
  });

  test('意図が無ければ従来の戻り先のまま（既存導線を壊さない）', () => {
    assert.equal(resumePathFor(null, FALLBACK), FALLBACK);
    assert.equal(resumePathFor(undefined, '/mypage'), '/mypage');
    assert.equal(intentQuery(null), '');
    assert.equal(intentQuery('light'), '', '保留中のプランでリンクを汚さない');
  });

  test('マジックリンクへ付くのは検証済みの id だけ', () => {
    assert.equal(intentQuery('premium'), `&${INTENT_PARAM}=premium`);
    for (const v of EVIL) assert.equal(intentQuery(v), '', `🔴 リンクに混入: ${v}`);
  });

  test('パラメータ名が実装と一致している', () => {
    assert.equal(INTENT_PARAM, 'intent');
    assert.equal(RESUME_PARAM, 'resume');
  });
});

describe('認証・認可の契約を変えていない', () => {
  test('🔴 Checkout は依然として認証済みのみ・email はセッション由来', () => {
    const src = read('netlify/functions/stripe-create-checkout.js');
    assert.match(src, /if \(!ent\.authenticated \|\| !ent\.email\)/, 'ログイン必須が外れている');
    assert.match(src, /customer_email: ent\.email/, 'email がセッション由来でない');
    assert.equal(src.includes('start-purchase'), false, 'Checkout が購入入口に依存している');
  });

  test('🔴 start-purchase はセッションを発行しない', () => {
    const src = read('netlify/functions/start-purchase.js');
    for (const w of ['signSession', 'Set-Cookie', 'ki_session', 'SESSION_SIGNING_SECRET']) {
      assert.equal(src.includes(w), false, `🔴 start-purchase が ${w} を扱っている`);
    }
    // プランはサーバー側で検証する
    assert.match(src, /normalizeIntent\(body\.plan\)/);
    assert.match(src, /invalid_plan/);
  });

  test('🔴 start-purchase は会員かどうかで応答を変えない（存在判定に使わせない）', () => {
    const src = read('netlify/functions/start-purchase.js');
    // 成功時の本文は 1 種類だけ
    const bodies = [...src.matchAll(/JSON\.stringify\(ok\s*\?\s*\{([^}]*)\}/g)].map((m) => m[1].trim());
    assert.deepEqual(bodies, ['sent: true']);
  });

  test('🔴 verify は受け取った値をパスに使わず resumePathFor に通す', () => {
    const src = read('netlify/functions/verify-magic-link.js');
    assert.match(src, /resumePathFor\(event\.queryStringParameters\?\.intent, redirectTo\)/);
    // 受け取った値で直接リダイレクトしていない
    assert.equal(/redirectTo = event\.queryStringParameters/.test(src), false);
  });

  test('🔴 既存の登録・ログイン導線は intent 無しでも動く', () => {
    const reg = read('netlify/functions/register-free.js');
    const login = read('netlify/functions/send-magic-link.js');
    // intent は任意（分割代入で受けるだけ）
    assert.match(reg, /const \{ email, intent \} = JSON\.parse\(event\.body\);/);
    assert.match(login, /const \{ email, intent \} = JSON\.parse\(event\.body\);/);
    // 付与されるのは intentQuery の結果だけ（空文字なら従来のリンク）
    assert.match(reg, /\+ intentQuery\(intent\)/);
    assert.match(login, /\+ intentQuery\(intent\)/);
    // 登録時の Airtable 値は不変
    assert.match(reg, /PlanType: 'free-registered',/);
    assert.match(reg, /Status: 'pending',/);
    assert.match(reg, /AccessEnabled: false,/);
  });

  test('🔴 start-purchase は CJS 関数をプロセス内で取り込まない', () => {
    // `send-magic-link.js` / `register-free.js` は `exports.handler` 形式だが
    // package.json が type:module のため esbuild は ESM として扱う。
    // 取り込むと handler が undefined になり 502 になる（2026-09-02）。
    // コメントは対象外（禁止事項の説明自体は書いてよい）
    const src = read('netlify/functions/start-purchase.js')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const bad of [
      "import('./send-magic-link", "import('./register-free",
      "require('./send-magic-link", "require('./register-free",
      'import(target)',
    ]) {
      assert.ok(!src.includes(bad), `🔴 プロセス内委譲が復活している: ${bad}`);
    }
    // HTTP で同一デプロイへ委譲する
    assert.ok(src.includes('/.netlify/functions/'));
  });

  test('🔴 委譲先は自分と同じデプロイに固定する', () => {
    // Host ヘッダーだけを信じると、ブランチデプロイの申し込みで
    // 本番のマジックリンクが送られてしまう。
    const src = read('netlify/functions/start-purchase.js');
    const prime = src.indexOf('DEPLOY_PRIME_URL');
    const req = src.indexOf('resolveSiteOrigin(event.headers)');
    assert.ok(prime > 0, 'DEPLOY_PRIME_URL を見ていない');
    assert.ok(req > prime, '🔴 リクエスト由来の origin を DEPLOY_PRIME_URL より先に使っている');
  });

  test('🔴 購入 CTA は単色にしない（2 色グラデーション）', () => {
    const src = read('src/pages/pricing.astro');
    // 申し込みボタン・確認メール送信ボタンはどちらも行動グラデーション
    assert.ok(/class="pr-btn pr-btn-action pr-plan-cta"/.test(src), '申し込み CTA が pr-btn-action でない');
    assert.ok(/class="pr-btn pr-btn-action pr-purchase-submit"/.test(src), '送信ボタンが pr-btn-action でない');
    const rule = src.slice(src.indexOf('.pr-btn-action {'), src.indexOf('.pr-btn-action:hover'));
    assert.ok(rule.includes('var(--grad-action)'), '🔴 --grad-action を使っていない');
    assert.ok(!/background:\s*(#|var\(--primary-start\)|var\(--secondary-start\))/.test(rule),
      '🔴 単色背景になっている');
  });

  test('🔴 購入導線の関数は startCheckout と同じスコープにある', () => {
    // DOMContentLoaded の内側に置くと startCheckout から参照できず、
    // クリック時に ReferenceError で「現在お申し込みを受け付けられません」になる
    const src = read('src/pages/pricing.astro');
    const ready = src.indexOf("document.addEventListener('DOMContentLoaded'");
    assert.ok(ready > 0);
    for (const fn of ['function openPurchaseAuth(', 'async function submitPurchaseAuth(', 'function resumeCheckout(']) {
      const at = src.indexOf(fn);
      assert.ok(at > 0, `${fn} が無い`);
      assert.ok(at < ready, `🔴 ${fn} が DOMContentLoaded の内側にある（startCheckout から見えない）`);
    }
    // startCheckout も同じ外側スコープ
    assert.ok(src.indexOf('async function startCheckout(') < ready);
  });

  test('🔴 /pricing は「無料会員登録」を購入の目的として見せない', () => {
    const src = read('src/pages/pricing.astro');
    // 🔴 箱そのものを見る（CTA の aria-controls を拾わないよう開始タグで切る）
    const box = src.slice(src.indexOf('<div class="pr-purchase-auth"'), src.indexOf('pr-plan-msg'));
    assert.match(box, /お申し込みを続けます/);
    assert.match(box, /このままお支払い画面へ進みます/);
    for (const w of ['無料会員登録', '無料登録', 'まず登録']) {
      assert.equal(box.includes(w), false, `🔴 購入導線に「${w}」が出ている`);
    }
    // 401 で /login へ飛ばさない（その場で購入を続ける）
    assert.equal(src.includes("window.location.href = '/login?redirect=/pricing'"), false,
      '🔴 401 で別導線（ログインページ）へ飛ばしている');
    assert.match(src, /openPurchaseAuth\(planId\)/);
  });
});
