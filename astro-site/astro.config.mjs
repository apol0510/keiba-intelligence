// @ts-check
import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';

// https://astro.build/config
export default defineConfig({
  site: 'https://keiba-intelligence.netlify.app',
  base: '/',
  output: 'server',
  // SSR Function bundle に horseHistories JSON を同梱する。
  // netlify.toml の [functions] included_files は Astro adapter 生成の SSR Function には
  // 効かないことが本番診断ログで判明したため、adapter 側でファイル取り込みを指定する。
  adapter: netlify({
    includeFiles: ['./src/data/horseHistories/**/*.json'],
  }),

  // インテグレーション（sitemap.xml.jsでカスタム生成）
  integrations: [],

  // ビルド設定
  build: {
    assets: 'assets'
  },

  // SEO設定
  trailingSlash: 'never'
});
