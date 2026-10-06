/**
 * demoPages.js — Deploy Preview 専用のデモ Premium 画面を「作るかどうか」と「何を出すか」（2026-10-06 MK）
 *
 * 目的: 合言葉なしで、実際の 2 段階買い目 UI（AI上位表示 / AI全選定）をブラウザで確認できるようにする。
 * 🔴 本番には存在させない: ページは **build 時に** Netlify の `CONTEXT === 'deploy-preview'` のときだけ生成する
 *    （production / branch-deploy / ローカル build では 0 ページ＝404）。ローカル確認は `KI_PREVIEW_DEMO=1`。
 * 🔴 認証は迂回しない: Cookie・セッション・entitlement には触れず、静的な紙面を作るだけ。
 * 🔴 出すのは**結果確定済みの過去の開催日**だけ（これから走るレースの有料買い目は出さない）。
 */
export const DEMO_DAYS = Object.freeze({
  jra: { date: '2026-10-04', label: '中央競馬（2026-10-04 京都・東京）' },
  nankan: { slug: '2026-10-04-ooi', label: '南関競馬（2026-10-04 大井）' },
});

export function demoEnabled(env = process.env) {
  return env.CONTEXT === 'deploy-preview' || env.KI_PREVIEW_DEMO === '1';
}

export function demoPaths(env = process.env) {
  return demoEnabled(env) ? Object.keys(DEMO_DAYS).map((market) => ({ params: { market } })) : [];
}

/** デモの描画ビュー（Premium と同じ表示フラグ・未ログイン）。 */
export const DEMO_VIEW = Object.freeze({
  tier: 'premium', tierLabel: 'プレミアム（プレビュー）', showMarks: true, showBetting: true, authenticated: false, preview: true,
});
