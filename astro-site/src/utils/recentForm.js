/**
 * recentForm.js — 近走成績の表示用ヘルパー（全予想ページ共通）
 */

export const RECENT_LABELS = ['前走', '2走前', '3走前', '4走前', '5走前'];

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
  const venue = s.replace(/\d{1,2}\.\d{1,2}\s*$/, '').replace(/^\d+/, '').trim();
  return { dateStr, venue };
}
