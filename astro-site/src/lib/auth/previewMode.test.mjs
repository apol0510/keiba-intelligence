/**
 * previewMode.test.mjs — Deploy Preview のプレビュー表示の安全契約
 *
 * 実行: node --test src/lib/auth/previewMode.test.mjs （astro-site 直下から）
 *
 * 🔴 これは認可の例外経路なので、次を必ず固定する:
 *   1. **本番ホストでは何をしても無効**
 *   2. `?view=free` は合言葉なしで印まで（買い目は開かない）
 *   3. `?view=light` / `?view=premium` は **合言葉必須**。
 *      env `PREVIEW_PAID_KEY` 未設定なら **成立しない**（fail-closed）
 *   4. 合言葉が違えば成立しない（timing-safe 比較）
 *   5. 本物のセッションが同等以上なら何もしない
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isPreviewHost, resolvePreviewTier, applyPreview,
  PREVIEW_MAX_TIER, PREVIEW_MAX_TIER_WITH_KEY, PREVIEW_PARAM, PREVIEW_KEY_PARAM,
  PREVIEW_PAID_KEY_ENV,
} from './previewMode.js';
import { TIER } from './tiers.js';
import { viewFlags } from './entitlement.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf-8');

const qs = (s) => new URLSearchParams(s);
const HOST = 'deploy-preview-80--keiba-intelligence.netlify.app';
const KEY = 'correct-horse-battery-staple-0123456789';
const ENV = { [PREVIEW_PAID_KEY_ENV]: KEY };

const guest = Object.freeze({
  tier: TIER.GUEST, tierLabel: 'ゲスト', email: null, venueAccess: 'all',
  authenticated: false, reason: 'no_session',
  showMarks: false, showBetting: false, showPremiumExtras: false, expiresAtMs: null,
});

/* ---------- 1. 本番ホストでは無効 ---------- */

test('本番ホストでは合言葉があっても無効', () => {
  for (const host of [
    'keiba-intelligence.jp', 'www.keiba-intelligence.jp',
    'keiba-intelligence.netlify.app', 'KEIBA-INTELLIGENCE.JP', 'keiba-intelligence.jp:443',
  ]) {
    assert.equal(isPreviewHost(host), false, `${host} が許可されている`);
    for (const v of ['free', 'light', 'premium']) {
      const t = resolvePreviewTier({ host, searchParams: qs(`view=${v}&key=${KEY}`), env: ENV });
      assert.equal(t, null, `${host} で view=${v} が通った`);
    }
    const e = applyPreview(guest, { host, searchParams: qs(`view=premium&key=${KEY}`), env: ENV });
    assert.equal(e.showBetting, false, `${host} で買い目が開いた`);
    assert.equal(e.tier, TIER.GUEST);
  }
});

test('Deploy Preview / ブランチデプロイ / localhost のみ許可', () => {
  for (const host of [HOST, 'feat-x--keiba-intelligence.netlify.app', 'localhost:4321', '127.0.0.1']) {
    assert.equal(isPreviewHost(host), true, `${host} が許可されていない`);
  }
  for (const host of ['example.com', 'evil.netlify.app', '', null, undefined]) {
    assert.equal(isPreviewHost(host), false, `${host} が許可されている`);
  }
});

/* ---------- 2. free は合言葉なし・買い目は開かない ---------- */

test('?view=free は合言葉なしで印まで（買い目は開かない）', () => {
  const e = applyPreview(guest, { host: HOST, searchParams: qs('view=free'), env: {} });
  assert.equal(e.tier, TIER.FREE);
  assert.equal(e.showMarks, true);
  assert.equal(e.showBetting, false, 'free で買い目が開いた');
  assert.equal(e.preview, true);
  assert.equal(e.authenticated, false, '本物のログイン扱いにしてはいけない');
});

test('PREVIEW_MAX_TIER は free のまま（合言葉なしの上限）', () => {
  assert.equal(PREVIEW_MAX_TIER, TIER.FREE);
  assert.equal(PREVIEW_MAX_TIER_WITH_KEY, TIER.PREMIUM);
});

/* ---------- 3. 有料は合言葉必須（fail-closed） ---------- */

test('env 未設定なら有料プレビューは成立しない', () => {
  for (const v of ['light', 'premium']) {
    assert.equal(resolvePreviewTier({ host: HOST, searchParams: qs(`view=${v}&key=${KEY}`), env: {} }), null,
      `env 未設定で view=${v} が通った`);
    assert.equal(resolvePreviewTier({ host: HOST, searchParams: qs(`view=${v}&key=${KEY}`) }), null,
      `env 省略で view=${v} が通った`);
    assert.equal(resolvePreviewTier({ host: HOST, searchParams: qs(`view=${v}&key=${KEY}`), env: { [PREVIEW_PAID_KEY_ENV]: '  ' } }), null,
      `env 空白で view=${v} が通った`);
  }
});

test('合言葉が無い・違う・長さ違いなら成立しない', () => {
  for (const q of [
    'view=premium',
    'view=premium&key=',
    'view=premium&key=wrong',
    `view=premium&key=${KEY}x`,
    `view=premium&key=${KEY.slice(0, -1)}`,
  ]) {
    const t = resolvePreviewTier({ host: HOST, searchParams: qs(q), env: ENV });
    assert.equal(t, null, `「${q}」が通った`);
  }
});

test('合言葉が一致すれば light / premium が開く', () => {
  const light = applyPreview(guest, { host: HOST, searchParams: qs(`view=light&key=${KEY}`), env: ENV });
  assert.equal(light.tier, TIER.LIGHT);
  assert.equal(light.showMarks, true);
  assert.equal(light.showBetting, true);
  assert.equal(light.preview, true);

  const prem = applyPreview(guest, { host: HOST, searchParams: qs(`view=premium&key=${KEY}`), env: ENV });
  assert.equal(prem.tier, TIER.PREMIUM);
  assert.equal(prem.showBetting, true);
  assert.equal(prem.authenticated, false, '本物のログイン扱いにしてはいけない');
});

test('未知の tier 値は受け付けない', () => {
  for (const v of ['pro', 'admin', 'owner', 'FREE ', 'premium-combo']) {
    const t = resolvePreviewTier({ host: HOST, searchParams: qs(`view=${v}&key=${KEY}`), env: ENV });
    assert.ok(t === null || t === TIER.FREE, `view=${v} が ${t} を返した`);
  }
});

test('パラメータが無ければ何もしない', () => {
  assert.equal(resolvePreviewTier({ host: HOST, searchParams: qs(''), env: ENV }), null);
  assert.equal(resolvePreviewTier({ host: HOST, searchParams: null, env: ENV }), null);
  assert.equal(resolvePreviewTier({}), null);
});

/* ---------- 4. 本物のセッションを壊さない ---------- */

test('本物のセッションが同等以上なら何もしない', () => {
  const paid = Object.freeze({
    ...guest, tier: TIER.PREMIUM, tierLabel: 'プレミアム', authenticated: true,
    showMarks: true, showBetting: true, showPremiumExtras: true, email: 'a@b.c',
  });
  const e = applyPreview(paid, { host: HOST, searchParams: qs(`view=free`), env: ENV });
  assert.equal(e, paid, '本物のセッションが書き換えられた');
  const e2 = applyPreview(paid, { host: HOST, searchParams: qs(`view=premium&key=${KEY}`), env: ENV });
  assert.equal(e2, paid, '本物のセッションが書き換えられた');
});

test('本物が free のとき、合言葉つき premium プレビューは上げられる（下げない）', () => {
  const free = Object.freeze({ ...guest, tier: TIER.FREE, authenticated: true, showMarks: true });
  const e = applyPreview(free, { host: HOST, searchParams: qs(`view=premium&key=${KEY}`), env: ENV });
  assert.equal(e.tier, TIER.PREMIUM);
  const e2 = applyPreview(free, { host: HOST, searchParams: qs('view=free'), env: ENV });
  assert.equal(e2, free, 'free のまま何もしないはず');
});

test('viewFlags が preview を伝えるが email を含めない', () => {
  const e = applyPreview(guest, { host: HOST, searchParams: qs(`view=premium&key=${KEY}`), env: ENV });
  const v = viewFlags(e);
  assert.equal(v.preview, true);
  assert.equal(v.showBetting, true);
  assert.equal(Object.prototype.hasOwnProperty.call(v, 'email'), false);
});

/* ---------- 5. 実装の静的ガード ---------- */

test('previewMode がセッションを発行しない', () => {
  const src = read('src/lib/auth/previewMode.js');
  assert.ok(!/signSession/.test(src), 'プレビューがセッションを発行しようとしている');
  assert.match(src, /timingSafeEqual/, '合言葉の照合が timing-safe でない');
  assert.match(src, /PREVIEW_PAID_KEY/, '合言葉の env を使っていない');
});

test('合言葉がコードに直書きされていない', () => {
  const src = read('src/lib/auth/previewMode.js');
  // 期待値は env からのみ取得する
  assert.ok(!/PREVIEW_PAID_KEY_ENV\]\s*\|\|\s*['"][^'"]+['"]/.test(src), '既定値の合言葉が書かれている');
});

test('プレビューの適用点は entitlementFromAstro のみ（Functions 側では使わない）', () => {
  const offenders = [];
  for (const f of [
    'netlify/functions/get-session.js',
    'netlify/functions/stripe-create-checkout.js',
    'netlify/functions/stripe-portal.js',
    'netlify/functions/stripe-webhook.js',
  ]) {
    if (/applyPreview|previewMode/.test(read(f))) offenders.push(f);
  }
  assert.deepEqual(offenders, [], `Functions がプレビュー経路を使っている: ${offenders.join(', ')}`);
});

test('preview-status は秘密値を返さない', () => {
  const src = read('netlify/functions/preview-status.js');
  // 値そのものを body に入れていない
  assert.ok(!/paid\s*[,}]/.test(src.replace(/paidPreview\w+/g, '')), '合言葉の値を返している疑い');
  assert.ok(!/JSON\.stringify\([\s\S]*?:\s*paid[,\s}]/.test(src), '合言葉の値を返している');
  assert.ok(!/:\s*secret[,\s}]/.test(src), '署名鍵の値を返している');
  assert.match(src, /paidPreviewKeyConfigured/, '設定の有無を返していない');
  // 本番では 404
  assert.match(src, /isPreviewHost\(host\)/, '本番ホストの判定が無い');
  assert.match(src, /statusCode: 404/, '本番で 404 を返していない');
});

test('TierRibbon がプレビュー中であることを画面に出す', () => {
  const src = read('src/components/newspaper/TierRibbon.astro');
  assert.match(src, /view\?\.preview/, 'preview フラグを見ていない');
  assert.match(src, /プレビュー表示中/, 'プレビューであることを画面に出していない');
});

test('🔴 有料の帯に「印」を並べない（R-8: 有料は印を出さない）', () => {
  const src = read('src/components/newspaper/TierRibbon.astro');
  assert.match(src, /const paid = !!view\?\.showBetting;/, '有料判定が無い');
  // 有料側の項目リストに印が含まれていないこと
  const paidBlock = src.slice(src.indexOf('paid\n  ? ['), src.indexOf(': ['));
  assert.ok(!/印（/.test(paidBlock), '有料の帯に印が並んでいる');
  assert.match(paidBlock, /並べ替え/, '有料だけの機能（並べ替え・抽出）を出していない');
});

test('🔴 有料プレビューで「開きません」と言わない', () => {
  const src = read('src/components/newspaper/TierRibbon.astro');
  const noteStart = src.indexOf('tier-preview-note');
  const note = src.slice(noteStart, noteStart + 900);
  assert.match(note, /paid \? \(/, 'プレビューの文言が tier で分かれていない');
  assert.match(note, /まで開いています/, '有料プレビューで開いていることを伝えていない');
});
