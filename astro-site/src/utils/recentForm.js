/**
 * recentForm.js — 近走成績の表示用ヘルパー（全予想ページ共通）
 */

export const RECENT_LABELS = ['前走', '2走前', '3走前', '4走前', '5走前'];

// JRA会場1字→正式名(2文字)の展開（紙面の "京" → "京都" 等で読みやすく）。
// 名=中京(JRA): 紙面の "5名12.7 チャンピオン" や "1名3.29 ⑥牝未勝" 等、回数prefix
// 付き＋JRA条件レースで観測されることをデータで確認(2026-05-23)。
// 名古屋(地方)の過去走は newspaper では plain "名" にならない(全角フル表記等)。
const JRA_VENUE_MAP = {
  '東': '東京', '中': '中山', '京': '京都', '阪': '阪神',
  '小': '小倉', '新': '新潟', '福': '福島', '札': '札幌', '函': '函館',
  '名': '中京'
};
function expandVenue(v) {
  return JRA_VENUE_MAP[v] || v;
}

/**
 * 近走の venue 文字列（例 "3京5.17" / "盛岡9.2" / "5名12.7"）から
 * 表示用の { dateStr: 'YY/MM/DD', venue: '京' } を返す。
 *
 * 年は新聞紙面に印字されないため、レース当日の月日と比較して推定する
 * （近走は過去なので、当日より後の月日なら前年とみなす）。
 * 1年以上前の近走は年がズレる可能性があるが、近走は通常直近のため実用上は概ね正確。
 */
export function recentRaceMeta(venueStr, raceDateStr) {
  const s = String(venueStr || '');
  const md = s.match(/(\d{1,2})\.(\d{1,2})\s*$/);
  let dateStr = '';
  if (md && raceDateStr) {
    const [ry, rm, rd] = String(raceDateStr).split('-').map(Number);
    const mo = Number(md[1]);
    const da = Number(md[2]);
    if (Number.isFinite(ry) && mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
      let yr = ry;
      if (mo > rm || (mo === rm && da > rd)) yr = ry - 1;
      dateStr = `${String(yr).slice(2)}/${String(mo).padStart(2, '0')}/${String(da).padStart(2, '0')}`;
    }
  }
  const rawVenue = s.replace(/\d{1,2}\.\d{1,2}\s*$/, '').replace(/^\d+/, '').trim();
  const venue = expandVenue(rawVenue);
  return { dateStr, venue };
}
