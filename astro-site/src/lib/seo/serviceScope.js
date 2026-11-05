/**
 * serviceScope.js — 無料と有料の範囲を検索エンジン・AI 検索へ正しく伝えるための単一源（純関数）
 *
 * 正本: /pricing の「どこまで見えるか」の表（src/pages/pricing.astro の TIER_MATRIX）。
 *       docs/measurements/AI_SEARCH_2026_11.md
 *
 * 🔴 ここは表の事実を言い換えるだけ。価格・商品・会員権利を決める場所ではない。
 * 🔴 金額は書かない（金額の正本は Stripe と料金ページ）。的中率・回収率も書かない（2026-10-19 の固定）。
 * 🔴 「完全無料」と読める文を書かない。AI モードが KI を「完全無料」と説明した誤認の修正が目的。
 * 🔴 主役は無料予想・AI 分析。有料は「月額プレミアム」の自然な一言にとどめ、詳細は /pricing へ渡す（MK 2026-11-05）。
 */
import { SITE_ORIGIN } from './sitemap.js';

export const SERVICE_NAME = 'KEIBA Intelligence';
export const SERVICE_NAME_JA = '競馬インテリジェンス';

export const SERVICE_SCOPE_SUMMARY =
  '全レースの馬柱・過去走・AI短評・展開予想を登録なしで無料公開しています。無料会員は印も見られ、AI指数の数値・AI結論・馬単の買い目は月額プレミアムでご利用いただけます。';

/** 開催日ページの description の末尾に足す文。無料の価値だけを書き、プレミアムの説明はここに持ち込まない */
export const DAY_PAGE_SCOPE_NOTE = '無料会員登録で印（◎○▲△）も見られます。';

/** items は /pricing の TIER_MATRIX の label と同じ文字列（serviceScope.test.mjs が一致を確かめる） */
export const SERVICE_TIERS = Object.freeze([
  {
    name: '未登録（無料）',
    lead: '登録なしで見られるもの',
    items: ['全頭の馬柱・過去走', 'AI短評（1頭ごとの文章）', 'AIレース展望・展開予想', '特徴量6指標'],
  },
  {
    name: '無料会員（無料）',
    lead: 'メールアドレスの登録で追加されるもの',
    items: ['印（◎○▲△・複数付与）'],
  },
  {
    name: 'プレミアム（月額）',
    lead: 'プレミアムで追加されるもの',
    items: ['AI指数の数値（無料はモザイク）', 'AI結論（推奨理由の解説）', '南関東4場の馬単買い目', '中央競馬（JRA）の馬単買い目'],
  },
]);

/** /about に置く JSON-LD。画面に書いてある内容だけを入れる */
export function buildAboutJsonLd(origin = SITE_ORIGIN) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${origin}/#organization`,
        name: SERVICE_NAME,
        alternateName: SERVICE_NAME_JA,
        url: `${origin}/`,
        description: `南関東4場と中央競馬（JRA全10場）のAI競馬予想サービス。${SERVICE_SCOPE_SUMMARY}`,
      },
      {
        '@type': 'WebSite',
        '@id': `${origin}/#website`,
        name: SERVICE_NAME,
        alternateName: SERVICE_NAME_JA,
        url: `${origin}/`,
        inLanguage: 'ja',
        publisher: { '@id': `${origin}/#organization` },
      },
    ],
  };
}

/** <script type="application/ld+json"> へ安全に埋める文字列 */
export function renderJsonLd(data) {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
