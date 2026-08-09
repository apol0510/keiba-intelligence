// @ts-check
import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';

// https://astro.build/config
export default defineConfig({
  // 本番は独自ドメイン。`netlify.app` は netlify.toml の 301(force) で恒久転送されるため、
  // ここを `netlify.app` にすると canonical / og:url が「転送される URL」を指してしまう。
  // sitemap.xml.js の baseUrl も同じ独自ドメインで、両者を揃える。
  site: 'https://keiba-intelligence.jp',
  base: '/',
  output: 'server',
  // SSR Function bundle に horseHistories JSON を同梱する。
  // netlify.toml の [functions] included_files は Astro adapter 生成の SSR Function には
  // 効かないことが本番診断ログで判明したため、adapter 側でファイル取り込みを指定する。
  // recentHorseHistories/** は horseHistories/** の兄弟ディレクトリで上記 glob に含まれないため、
  // 南関 recentHorseHistories 用に別 glob を追加する（JRA horseHistories 同梱は不変）。
  //
  // ⚠️ ここで同梱するのは「全期間」。実行時に必要なのは最新日だけなので、
  //    ビルド後に scripts/pruneFunctionBundleData.mjs が bundle 側だけを直近N日へ刈る
  //    （repo の src/data は削除しない）。2026-07-30 の deploy 400（Lambda サイズ上限）対策。
  adapter: netlify({
    includeFiles: [
      './src/data/horseHistories/**/*.json',
      './src/data/recentHorseHistories/**/*.json',
      './src/data/entries/**/*.json',
      './src/data/horseStats/**/*.json',
    ],
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
