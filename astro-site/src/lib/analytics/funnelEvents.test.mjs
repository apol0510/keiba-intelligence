/**
 * 購入ファネル計測と GA4 URL 浄化の test（docs/measurements/FUNNEL_2026_10.md）
 *
 * 🔴 固定すること:
 *   - GA4 へ email・token を送らない（page_location / page_referrer / イベント引数）
 *   - 送るイベント名・キーは固定の許可リストだけ
 *   - 各ファネル段のイベントが実際のページに配線されている（計測の欠落を再発させない）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import {
  FUNNEL_EVENTS, sanitizeFunnelParams, trackFunnel, placementOf, isPricingHref, verifyResultOf,
} from './funnelEvents.js';
import { sanitizeAnalyticsUrl, ga4BootstrapScript } from './pageLocation.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const EMAIL = 'someone@example.com';
// 実在しない識別子（形だけのダミー。実行時に組み立てる）
const LINK_ID = ['probe', 'link', 'id', '42'].join('-');

// ---------------------------------------------------------------- URL 浄化

test('🔴 マジックリンクの token と email を page_location から落とす', () => {
  const href = `https://keiba-intelligence.jp/auth/verify?token=${LINK_ID}&email=${encodeURIComponent(EMAIL)}&intent=premium`;
  const out = sanitizeAnalyticsUrl(href);
  assert.equal(out, 'https://keiba-intelligence.jp/auth/verify');
  assert.ok(!out.includes(LINK_ID));
  assert.ok(!/example|%40|@/.test(out));
});

test('集客の分析に要るクエリ（utm・広告 ID・導線の固定値）は残す', () => {
  const out = sanitizeAnalyticsUrl('https://keiba-intelligence.jp/pricing?utm_source=x&utm_medium=social&gclid=abc&checkout=cancelled&foo=bar#top');
  assert.equal(out, 'https://keiba-intelligence.jp/pricing?utm_source=x&utm_medium=social&gclid=abc&checkout=cancelled');
});

test('🔴 許可キーでも email らしい値は落とす / 解釈できない URL は空', () => {
  assert.equal(sanitizeAnalyticsUrl(`https://keiba-intelligence.jp/?utm_source=${encodeURIComponent(EMAIL)}`), 'https://keiba-intelligence.jp/');
  assert.equal(sanitizeAnalyticsUrl(`https://keiba-intelligence.jp/?utm_source=${EMAIL}`), 'https://keiba-intelligence.jp/');
  assert.equal(sanitizeAnalyticsUrl(''), '');
  assert.equal(sanitizeAnalyticsUrl('not a url'), '');
  assert.equal(sanitizeAnalyticsUrl('javascript:alert(1)'), '');
  assert.equal(sanitizeAnalyticsUrl(undefined), '');
});

test('🔴 inline 埋め込み: 初期化スクリプトが page_view 前に浄化済み URL を set / config する', () => {
  const dataLayer = [];
  const sandbox = {
    window: {
      location: { href: `https://keiba-intelligence.jp/auth/verify?token=${LINK_ID}&email=${encodeURIComponent(EMAIL)}` },
    },
    document: { referrer: `https://keiba-intelligence.jp/auth/verify?token=${LINK_ID}&email=${encodeURIComponent(EMAIL)}` },
    URL,
    encodeURIComponent,
    Date,
  };
  sandbox.window.dataLayer = dataLayer;
  sandbox.dataLayer = dataLayer;
  vm.createContext(sandbox);
  vm.runInContext(ga4BootstrapScript('G-LRX40ZYJB6'), sandbox);

  const cmds = dataLayer.map((args) => Array.from(args));
  const set = cmds.find((c) => c[0] === 'set');
  const config = cmds.find((c) => c[0] === 'config');
  assert.ok(set && config, 'set と config の両方が積まれる');
  assert.equal(config[1], 'G-LRX40ZYJB6');
  assert.equal(set[1].page_location, 'https://keiba-intelligence.jp/auth/verify');
  assert.equal(set[1].page_referrer, 'https://keiba-intelligence.jp/auth/verify');
  assert.ok(cmds.findIndex((c) => c[0] === 'set') < cmds.findIndex((c) => c[0] === 'config'), 'set は config（page_view）より前');
  const dump = JSON.stringify(cmds);
  assert.ok(!dump.includes(LINK_ID) && !dump.includes('example.com'), 'dataLayer に token / email が無い');
  assert.equal(typeof sandbox.window.gtag, 'function', 'ページのスクリプトが window.gtag を使える');
});

test('初期化スクリプトは不正な測定 ID を受け付けない', () => {
  assert.throws(() => ga4BootstrapScript("G-X'); alert(1); ('"));
});

test('🔴 BaseLayout は浄化済みの初期化だけを使う（素の gtag config を残さない）', () => {
  const src = read('src/layouts/BaseLayout.astro');
  assert.match(src, /set:html=\{ga4BootstrapScript\('G-LRX40ZYJB6'\)\}/);
  assert.equal(/gtag\(\s*'config'/.test(src), false, '素の gtag config が残っている');
  assert.match(src, /FUNNEL_EVENTS\.PRICING_LINK_CLICK/);
});

// ---------------------------------------------------------------- イベント

test('🔴 イベント引数は許可キー・英数字の列挙値だけ（email・長い値・未知キーは落とす）', () => {
  assert.deepEqual(
    sanitizeFunnelParams({ plan: 'premium', result: 'sent', email: EMAIL, token: LINK_ID, placement: EMAIL, intent: 'x'.repeat(41), resumed: 'no' }),
    { plan: 'premium', result: 'sent', resumed: 'no' },
  );
  assert.deepEqual(sanitizeFunnelParams(null), {});
  assert.deepEqual(sanitizeFunnelParams({ plan: 1 }), {});
});

test('trackFunnel: 許可イベントだけ送る・gtag が無い / 例外でも導線を止めない', () => {
  const calls = [];
  const win = { gtag: (...a) => calls.push(a) };
  assert.equal(trackFunnel(FUNNEL_EVENTS.CHECKOUT_CLICK, { plan: 'premium', email: EMAIL }, win), true);
  assert.deepEqual(calls[0], ['event', 'ki_checkout_click', { plan: 'premium' }]);
  assert.equal(trackFunnel('purchase', {}, win), false);
  assert.equal(trackFunnel('ki_unknown', {}, win), false);
  assert.equal(calls.length, 1);
  assert.equal(trackFunnel(FUNNEL_EVENTS.CHECKOUT_CLICK, {}, {}), false);
  assert.equal(trackFunnel(FUNNEL_EVENTS.CHECKOUT_CLICK, {}, undefined), false);
  assert.equal(trackFunnel(FUNNEL_EVENTS.CHECKOUT_CLICK, {}, { gtag: () => { throw new Error('x'); } }), false);
});

test('イベント名は既存契約どおり ki_ 接頭辞・GA4 の 40 文字制限内', () => {
  for (const n of Object.values(FUNNEL_EVENTS)) {
    assert.match(n, /^ki_[a-z_]+$/);
    assert.ok(n.length <= 40, n);
  }
});

test('isPricingHref: 同一サイトの /pricing だけ', () => {
  const o = 'https://keiba-intelligence.jp';
  assert.equal(isPricingHref('/pricing', o), true);
  assert.equal(isPricingHref('/pricing/', o), true);
  assert.equal(isPricingHref('/pricing?from=free#plans', o), true);
  assert.equal(isPricingHref('https://keiba-intelligence.jp/pricing', o), true);
  assert.equal(isPricingHref('https://other.example/pricing', o), false);
  assert.equal(isPricingHref('/pricing-old', o), false);
  assert.equal(isPricingHref('/free-prediction/', o), false);
  assert.equal(isPricingHref('', o), false);
  assert.equal(isPricingHref(null, o), false);
});

test('placementOf: 明示 → nav → footer → body', () => {
  const el = (map) => ({ closest: (sel) => map[sel] || null });
  const explicit = { getAttribute: () => 'free_lock' };
  assert.equal(placementOf(el({ '[data-ki-placement]': explicit })), 'free_lock');
  assert.equal(placementOf(el({ '[data-ki-placement]': { getAttribute: () => EMAIL }, 'nav, .main-nav': {} })), 'nav');
  assert.equal(placementOf(el({ footer: {} })), 'footer');
  assert.equal(placementOf(el({})), 'body');
  assert.equal(placementOf({}), 'body');
});

test('verifyResultOf: 応答を列挙値にする（文言・token を使わない）', () => {
  assert.equal(verifyResultOf(200, true, undefined), 'ok');
  assert.equal(verifyResultOf(404, false, 'x'), 'not_found');
  assert.equal(verifyResultOf(403, false, 'Token already used'), 'used');
  assert.equal(verifyResultOf(403, false, 'Token expired'), 'expired');
  assert.equal(verifyResultOf(500, false, undefined), 'error');
});

// ---------------------------------------------------------------- 配線（計測の欠落を再発させない）

const WIRING = {
  'src/pages/pricing.astro': ['CHECKOUT_CLICK', 'PURCHASE_AUTH_OPEN', 'PURCHASE_EMAIL_RESULT', 'CHECKOUT_REDIRECT', 'CHECKOUT_ERROR', 'CHECKOUT_CANCELLED'],
  'src/pages/register.astro': ['SIGNUP_RESULT'],
  'src/pages/auth/verify.astro': ['LOGIN_VERIFY_RESULT', 'VERIFY_FALLBACK'],
  'src/pages/mypage.astro': ['CHECKOUT_RETURN', 'CHECKOUT_SYNCED'],
  'src/layouts/BaseLayout.astro': ['PRICING_LINK_CLICK'],
};

test('🔴 各ファネル段のイベントがページに配線されている（全イベントを網羅）', () => {
  const wired = new Set();
  for (const [file, keys] of Object.entries(WIRING)) {
    const src = read(file);
    for (const k of keys) {
      assert.match(src, new RegExp(`trackFunnel\\(FUNNEL_EVENTS\\.${k}\\b`), `${file} に ${k} が無い`);
      wired.add(k);
    }
  }
  assert.deepEqual([...wired].sort(), Object.keys(FUNNEL_EVENTS).sort(), '配線されていないイベントがある');
});

test('🔴 ページの trackFunnel 呼び出しに email・token・セッション値を渡していない', () => {
  for (const file of Object.keys(WIRING)) {
    const src = read(file);
    const calls = src.match(/trackFunnel\([^;]*?\);/gs) || [];
    assert.ok(calls.length > 0, file);
    for (const c of calls) {
      // イベント名（例: PURCHASE_EMAIL_RESULT）は除いて、引数だけを見る
      const args = c.replace(/^trackFunnel\(FUNNEL_EVENTS\.[A-Z_]+/, '');
      assert.equal(/email|token|ent\.|session|customer|sub_|data\.url/i.test(args), false, `${file}: ${c}`);
    }
  }
});
