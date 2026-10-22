/**
 * registerFormAnchor.guard.test.mjs — 無料予想の帯から登録フォームへ直接つなぐ（TRAFFIC_GROWTH_2026_10.md §2.2）
 *
 * 実行: node --test src/lib/auth/registerFormAnchor.guard.test.mjs（astro-site 直下）。`test:auth` に組込み。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(siteRoot, p), 'utf8');

test('TierRibbon: 無料会員の導線は /register#registerForm（文言は不変）', () => {
  const src = read('src/components/newspaper/TierRibbon.astro');
  assert.match(src, /const REGISTER_FORM_HREF = '\/register#registerForm';/);
  assert.match(src, /\{ href: REGISTER_FORM_HREF, label: '無料会員に登録して印を見る', tone: 'free' \}/);
  // 有料プランへの導線は従来どおり
  assert.match(src, /\{ href: '\/pricing', label: 'プランを見て買い目を受け取る', tone: 'paid' \}/);
});

test('register.astro: 到達先の id="registerForm" が存在する（register.astro は変更しない）', () => {
  assert.match(read('src/pages/register.astro'), /<form id="registerForm" class="register-form">/);
});

test('global.scss: 固定ヘッダーの分だけページ内リンクの到達位置を下げる', () => {
  const scss = read('src/styles/global.scss');
  const html = scss.slice(scss.indexOf('\nhtml {'), scss.indexOf('}', scss.indexOf('\nhtml {')));
  assert.match(html, /scroll-padding-top: 6rem;/);
  assert.match(read('src/layouts/BaseLayout.astro'), /position: sticky;/, '固定ヘッダーが無くなったら scroll-padding-top を見直す');
});
