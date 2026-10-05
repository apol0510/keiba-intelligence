/**
 * exacta/selection.js — AI 動的判定（KI_EXACTA）の選択を画面用の形にする
 *
 * 正本: KAO `docs/ki-dynamic-selection.md` §3.5（`ki_exacta_selection.v1`）・KAO D-160
 *
 * 🔴 顧客画面に出すのは **採用した組み合わせだけ**（ゼロなら「見送り」）。
 *    点数・推奨 N 点・購入金額・確率・オッズ・期待値は扱わない。入力にそれらの項目が混ざっていたら
 *    **その行を捨てる**（オッズは外部へ再配布しない・stage-a-contract）。
 * 🔴 表示の切替は市場ごと（`KI_EXACTA_DISPLAY_MARKETS=jra,nankan`）。未設定なら従来どおり（F3）を出す。
 *    切替後に選択が無いレースは F3 に戻さない（方式を混ぜない）。「発走前に確定」と出す。
 */

export const SELECTION_SCHEMA = 'ki_exacta_selection.v1';

/** 出力に混ざってはいけない項目（KARL `ki_exacta_export.FORBIDDEN_KEYS` と同じ） */
export const FORBIDDEN_KEYS = Object.freeze([
  'p_calibrated', 'current_odds', 'estimated_final_odds', 'estimated_executable_odds', 'ev',
  'robust_ev', 'stake', 'odds', 'snapshot_ids', 'p_lower_bound', 'odds_lower_bound',
]);

const JRA_VENUE_CODE = Object.freeze({
  札幌: '01', 函館: '02', 福島: '03', 新潟: '04', 東京: '05', 中山: '06', 中京: '07', 京都: '08', 阪神: '09', 小倉: '10',
});
const NANKAN_VENUE_CODE = Object.freeze({ 大井: 'OI', 川崎: 'KA', 船橋: 'FU', 浦和: 'UR' });

/** Stage A の race_id（KARL `ki_index.race_id_of` と同じ規約）。分からなければ null。 */
export function raceIdOf(market, date, venueName, raceNumber) {
  const n = Number(raceNumber);
  if (!date || !Number.isInteger(n) || n <= 0) return null;
  if (market === 'jra') {
    const code = JRA_VENUE_CODE[venueName];
    return code ? `${date}-${code}-${String(n).padStart(2, '0')}` : null;
  }
  if (market === 'nankan') {
    const code = NANKAN_VENUE_CODE[venueName];
    return code ? `${date}-${code}-${n}` : null;
  }
  return null;
}

/** `KI_EXACTA_DISPLAY_MARKETS` → 表示を切り替えた市場の集合（既定は空＝切替なし）。 */
export function displayMarkets(env = {}) {
  const raw = String(env.KI_EXACTA_DISPLAY_MARKETS || '');
  return new Set(raw.split(',').map((s) => s.trim()).filter((s) => s === 'jra' || s === 'nankan'));
}

const SELECTION_RE = /^(\d{2})>(\d{2})$/;

/** 1 行を検査する。問題があれば null（表示しない）。 */
export function validateRow(row) {
  if (!row || typeof row !== 'object' || row.schema !== SELECTION_SCHEMA) return null;
  if (FORBIDDEN_KEYS.some((k) => Object.prototype.hasOwnProperty.call(row, k))) return null;
  if (typeof row.race_id !== 'string' || !row.race_id) return null;
  if (row.outcome !== 'BUY' && row.outcome !== 'NO_SELECTION') return null;
  if (!Array.isArray(row.selections)) return null;
  if (row.outcome === 'BUY' && (!row.selections.length || !row.selections.every((s) => SELECTION_RE.test(s)))) return null;
  if (row.outcome === 'NO_SELECTION' && row.selections.length) return null;
  return row;
}

/** JSONL 文字列 → `Map<race_id, row>`。壊れた行・禁止項目を含む行は捨てる。 */
export function parseSelections(text) {
  const out = new Map();
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const ok = validateRow(row);
    if (ok && !out.has(ok.race_id)) out.set(ok.race_id, ok);   // 🔴 先勝ち（後から差し替えない）
  }
  return out;
}

/**
 * 買い目パネルの plan（`RaceEntryTable` が描く形）。
 * - 選択あり: 組み合わせだけ（軸・抑え・点数・金額は無い）
 * - 見送り: `skip: true`
 * - 選択がまだ無い（切替後）: `pending: true`
 */
export function planFromSelection(row, { isMain = false, betType = '馬単' } = {}) {
  if (!row) return { betType, isMain, combos: [], lines: [], hold: [], pending: true, source: 'ki-exacta' };
  if (row.outcome !== 'BUY') return { betType, isMain, combos: [], lines: [], hold: [], skip: true, source: 'ki-exacta' };
  const combos = row.selections.map((s) => {
    const m = SELECTION_RE.exec(s);
    return { first: Number(m[1]), second: Number(m[2]) };
  });
  return { betType, isMain, combos, lines: [], hold: [], source: 'ki-exacta', decisionId: row.decision_id || null };
}
