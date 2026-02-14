// @ts-check
import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';

// https://astro.build/config
export default defineConfig({
  site: 'https://keiba-intelligence.keiba.link',
  base: '/',
  output: 'server',
  adapter: netlify(),

  // インテグレーション（sitemap.xml.jsでカスタム生成）
  integrations: [],

  // ビルド設定
  build: {
    assets: 'assets'
  },

  // SEO設定
  trailingSlash: 'never'
});
