// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import netlify from '@astrojs/netlify';

// https://astro.build/config
export default defineConfig({
  site: 'https://keiba-intelligence.keiba.link',
  base: '/',
  output: 'server',
  adapter: netlify(),

  // インテグレーション
  integrations: [
    sitemap({
      changefreq: 'daily',
      priority: 0.7,
      lastmod: new Date(),
    })
  ],

  // ビルド設定
  build: {
    assets: 'assets'
  },

  // SEO設定
  trailingSlash: 'never'
});
