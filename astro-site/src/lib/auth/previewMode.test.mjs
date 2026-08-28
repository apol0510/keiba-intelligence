/**
 * previewMode.test.mjs — Deploy Preview 限定「無料会員の見え方」の安全契約テスト
 *
 * 実行: node --test src/lib/auth/previewMode.test.mjs （astro-site 直下から）
 *
 * 🔴 この仕組みは認可の例外経路なので、次を**必ず**固定する:
 *   1. 買い目（light 以上）へは**絶対に上げない**
 *   2. 本番ホストでは常に無効
 *   3. `?view=light` / `?view=premium` は受け付けない
 *   4. 既に本物のセッションがあるときは権限を上げも下げもしない
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isPreviewHost, resolvePreviewTier, applyPreview, PREVIEW_MAX_TIER, PREVIEW_PARAM,
} from './previewMode.js';
import { TIER } from './tiers.js';
import { viewFlags } from './entitlement.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf-8');

const qs = (s) => new URLSearchParams(s);

const PREVIEW_HOST = 'deploy-preview-80--keiba-intelligence.netlify.app';

/** guest 相当の entitlement。 */
const guest = Object.freeze({
  tier: TIER.GUEST, tierLabel: 'ゲスト', email: null, venueAccess: 'all',
  authenticated: false, reason: 'no_session',
  showMarks: false, showBetting: false, showPremiumExtras: false, expiresAtMs: null,
});

/* ---------- 1. 上限は free（買い目は絶対に開かない） ---------- */

test('PREVIEW_MAX_TIER は free（買い目を開く tier に変更されていない）', () => {
  assert.equal(PREVIEW_MAX_TIER, TIER.FREE);
});

test('プレビューでは showBetting が絶対に true にならない', () => {
  for (const v of ['free', 'light', 'premium', 'pro', 'admin', 'FREE ']) {
    const e = applyPreview(guest, { host: PREVIEW_HOST, searchParams: qs(`${PREVIEW_PARAM}=${v}`) });
    assert.equal(e.showBetting, false, `view=${v} で買い目が開いた`);
    assert.equal(e.showPremiumExtras, false, `view=${v} で premium 限定が開いた`);
  }
});

test('?view=light / ?view=premium は受け付けない（印すら開かない）', () => {
  for (const v of ['light', 'premium', 'pro', 'pro-plus']) {
    assert.equal(resolvePreviewTier({ host: PREVIEW_HOST, searchParams: qs(`view=${v}`) }), null,
      `view=${v} が通ってしまう`);
    const e = applyPreview(guest, { host: PREVIEW_HOST, searchParams: qs(`view=${v}`) });
    assert.equal(e.showMarks, false);
    assert.equal(e.preview, undefined);
  }
});

test('?view=free で印だけが開く', () => {
  const e = applyPreview(guest, { host: PREVIEW_HOST, searchParams: qs('view=free') });
  assert.equal(e.tier, TIER.FREE);
  assert.equal(e.showMarks, true);
  assert.equal(e.showBetting, false);
  assert.equal(e.preview, true);
  assert.equal(e.authenticated, false, '本物のログイン扱いにしてはいけない');
});

/* ---------- 2. 本番ホストでは無効 ---------- */

test('本番ホストではプレビューが効かない', () => {
  for (const host of [
    'keiba-intelligence.jp',
    'www.keiba-intelligence.jp',
    'keiba-intelligence.netlify.app',
    'KEIBA-INTELLIGENCE.JP',
    'keiba-intelligence.jp:443',
  ]) {
    assert.equal(isPreviewHost(host), false, `${host} がプレビュー許可になっている`);
    const e = applyPreview(guest, { host, searchParams: qs('view=free') });
    assert.equal(e.showMarks, false, `${host} で印が開いた`);
    assert.equal(e.tier, TIER.GUEST);
  }
});

test('Deploy Preview / ブランチデプロイ / localhost のみ許可', () => {
  for (const host of [
    'deploy-preview-80--keiba-intelligence.netlify.app',
    'feat-x--keiba-intelligence.netlify.app',
    'localhost:4321',
    '127.0.0.1:4321',
  ]) {
    assert.equal(isPreviewHost(host), true, `${host} が許可されていない`);
  }
  for (const host of ['example.com', 'evil.netlify.app', '', null, undefined]) {
    assert.equal(isPreviewHost(host), false, `${host} が許可されている`);
  }
});

/* ---------- 3. 入力の扱い ---------- */

test('パラメータが無い・空・別名なら何もしない', () => {
  assert.equal(resolvePreviewTier({ host: PREVIEW_HOST, searchParams: qs('') }), null);
  assert.equal(resolvePreviewTier({ host: PREVIEW_HOST, searchParams: qs('view=') }), null);
  assert.equal(resolvePreviewTier({ host: PREVIEW_HOST, searchParams: qs('tier=free') }), null);
  assert.equal(resolvePreviewTier({ host: PREVIEW_HOST, searchParams: null }), null);
  assert.equal(resolvePreviewTier({}), null);
});

/* ---------- 4. 本物のセッションを壊さない ---------- */

test('既に free 以上なら何もしない（上げも下げもしない）', () => {
  const paid = Object.freeze({
    ...guest, tier: TIER.PREMIUM, tierLabel: 'プレミアム', authenticated: true,
    showMarks: true, showBetting: true, showPremiumExtras: true, email: 'a@b.c',
  });
  const e = applyPreview(paid, { host: PREVIEW_HOST, searchParams: qs('view=free') });
  assert.equal(e, paid, '本物のセッションが書き換えられた');
  assert.equal(e.showBetting, true);
});

test('viewFlags が preview を伝えるが email は含めない', () => {
  const e = applyPreview(guest, { host: PREVIEW_HOST, searchParams: qs('view=free') });
  const v = viewFlags(e);
  assert.equal(v.preview, true);
  assert.equal(v.showMarks, true);
  assert.equal(v.showBetting, false);
  assert.equal(Object.prototype.hasOwnProperty.call(v, 'email'), false);
});

/* ---------- 5. 実装の静的ガード ---------- */

test('previewMode がセッション署名や tier 昇格の抜け道を持たない', () => {
  const src = read('src/lib/auth/previewMode.js');
  assert.ok(!/signSession/.test(src), 'プレビューがセッションを発行しようとしている');
  assert.ok(!/TIER\.LIGHT|TIER\.PREMIUM/.test(src), 'プレビューが有料 tier を参照している');
  assert.ok(!/showBetting:\s*true/.test(src), 'プレビューが買い目を開こうとしている');
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

test('TierRibbon がプレビュー中であることを画面に出す', () => {
  const src = read('src/components/newspaper/TierRibbon.astro');
  assert.match(src, /view\?\.preview/, 'preview フラグを見ていない');
  assert.match(src, /プレビュー表示中/, 'プレビューであることを画面に出していない');
});
