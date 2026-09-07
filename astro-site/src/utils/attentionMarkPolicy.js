/**
 * attentionMarkPolicy.js — 無料会員に **実際に描画する印**を決める
 *
 * 正本: docs/RENEWAL_2026_08.md §2 R-3（2026-09-07 改訂）
 *
 * 役割の分離:
 *   - `attentionMarks.js` … 指数から印を **生成**する（新聞の総合印）。ここは一切変えない。
 *   - 本モジュール       … 生成された印のうち **何を出すか**を決める（表示ポリシー）。
 *
 * なぜ必要か（2026-09-07）:
 *   R-3 は「守るのは相手が誰か」であり、△ を買い目の相手より広く取ることで担保していた。
 *   しかし少頭数では **算術的に担保できない**。
 *   8 頭立てはプールが 7 頭、相手が 6 頭なので、△ が相手より真に広くなるには
 *   プール全頭に △ が付くしかなく、それは指数次第で成立しない。
 *   実測では 8 頭立ての 18.4%（全体 2.0%）で
 *   **△ 集合が買い目 1 行の相手集合と完全一致**していた。
 *   その場合、無料会員の △ から有料の相手が丸ごと復元できる。
 *
 * 何をするか:
 *   完全一致が成立するレースだけ **△ を描画しない**（`noDown`）。◎○▲ はそのまま出す。
 *   ◎○▲ は R-3 が「**本命は分かってよい**」として公開を許容している情報であり、
 *   守る対象（相手が誰か）を担っているのは △ だけであるため。
 *
 * 🔴 買い目そのものは戻り値にも props にも載せない。
 *    このモジュールは真偽の判定結果（'full' | 'noDown'）しか外に出さない。
 *
 * 🔴 比較は **買い目 1 行ごと**に行う（R-3 の「軸 → 相手 5〜6 頭」が比較単位）。
 *    複数行を union すると軸ごとに違う相手が混ざって実際より広い集合になり、
 *    「どの買い目の相手が復元できるか」を測れない。
 */

/** 生成された印をそのまま出す。 */
export const MARK_POLICY_FULL = 'full';
/** △ を出さない（◎○▲ はそのまま出す）。 */
export const MARK_POLICY_NO_DOWN = 'noDown';

const DOWN = '△';

/**
 * 買い目の文字列から **1 行ぶんの相手集合**を取り出す。
 *
 * 例: '13-12.10.5.8.14.4(抑え3.1.7.6)' → Set{12,10,5,8,14,4}
 *     抑えは買い目の別段であり相手の本体ではないので含めない。
 *
 * @param {string[]} bettingLines
 * @returns {Array<Set<number>>} 空の行は落とす
 */
export function partnerSetsOf(bettingLines) {
  const lines = Array.isArray(bettingLines) ? bettingLines : [];
  const out = [];
  for (const line of lines) {
    if (typeof line !== 'string') continue;
    const rhs = line.split('-')[1];
    if (!rhs) continue;
    const partners = new Set();
    for (const p of rhs.replace(/\(.*/, '').split('.')) {
      const n = Number(p.trim());
      if (p.trim() && Number.isFinite(n)) partners.add(n);
    }
    if (partners.size) out.push(partners);
  }
  return out;
}

/**
 * 印の Map から △ が付いた馬番の集合を取り出す。
 *
 * @param {Map<number,string>} marks 馬番 → '◎◎○▲' のような印文字列
 * @returns {Set<number>}
 */
export function downSetOf(marks) {
  const out = new Set();
  if (!marks || typeof marks.entries !== 'function') return out;
  for (const [no, s] of marks.entries()) {
    if (typeof s === 'string' && s.includes(DOWN)) out.add(no);
  }
  return out;
}

const sameSet = (a, b) => a.size === b.size && [...b].every((x) => a.has(x));

/**
 * このレースの無料会員向け表示ポリシーを決める。
 *
 * @param {Map<number,string>} marks `assignFreeMarks` の出力
 * @param {string[]} bettingLines 買い目（生の文字列。**戻り値には含めない**）
 * @returns {'full'|'noDown'}
 */
export function markPolicyFor(marks, bettingLines) {
  const down = downSetOf(marks);
  if (!down.size) return MARK_POLICY_FULL;
  for (const partners of partnerSetsOf(bettingLines)) {
    if (sameSet(down, partners)) return MARK_POLICY_NO_DOWN;
  }
  return MARK_POLICY_FULL;
}

/**
 * ポリシーを 1 頭ぶんの印文字列へ適用する。
 *
 * @param {string} mark 例 '◎○▲△△'
 * @param {'full'|'noDown'} policy
 * @returns {string} 'noDown' なら △ を除いた文字列（例 '◎○▲'）
 */
export function applyMarkPolicy(mark, policy) {
  const s = typeof mark === 'string' ? mark : '';
  if (policy !== MARK_POLICY_NO_DOWN) return s;
  return s.split(DOWN).join('');
}
