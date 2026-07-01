// nankanBetPoints.js — 南関 購入点数（案1: ユニーク実購入買い目数）算出の単一源
//
// 目的:
//   購入者に表示している買い目そのものから「実購入組数」を数える。
//   払戻から逆算する getBetPoints とは無関係な、投資額・回収率分母の正本候補（案1）。
//
// Phase 1 の制約:
//   - 現行の的中判定 / 買い目生成 / archive 生成 / 画面表示には **接続しない**。
//   - getBetPoints は削除・変更しない（本モジュールは併設のみ）。
//
// 必須仕様:
//   - 馬単は「軸 ↔ 全相手」を双方向の順序付き組として展開する。
//   - 抑え・補欠（"(抑え…)" 括弧内）を相手に含める。
//   - 同一順序付き組は dedup する。
//   - 払戻額は入力に使わない。
//   - AK / KI で同一入力なら同一結果（このファイルの馬単部は AK とバイト一致）。
//   - 不正・欠損形式は黙って推測せず BetPointsParseError を throw する。
//
// 注記: 三連複は AK 専用（analytics-keiba）。KI（南関=馬単のみ）では未実装。
// 依存ゼロ（他モジュールを import しない）。Node 実行の scripts からも安全に読める。

// ── 共通エラー型 ──────────────────────────────────────────────
export class BetPointsParseError extends Error {
  constructor(message, value) {
    super(message);
    this.name = 'BetPointsParseError';
    this.value = value;
  }
}

// ── 馬単（AK/KI 共通・バイト一致必須）──────────────────────────
// 区切りは - (南関KI/旧) / ↔ (AK新) / → (旧片方向) / ⇔ (旧表示) を同一に扱う。
const UMATAN_LINE_RE = /^(\d+)\s*[-↔→⇔]\s*(.+)$/;

function toHorseNumbers(str, line) {
  const out = [];
  for (const tok of String(str).split('.')) {
    const t = tok.trim();
    if (t.length === 0) continue;
    const n = Number(t);
    if (!Number.isInteger(n) || n <= 0) {
      throw new BetPointsParseError(`invalid horse number "${tok}"`, line);
    }
    out.push(n);
  }
  return out;
}

/**
 * 1 本の馬単買い目行を解析する。
 * 例: "10↔2.3.4.7.11(抑え5.9.12)" / "10-2.3.4.7.11(抑え5.9.12)"
 * @param {string} line
 * @returns {{axis:number, partners:number[]}} 相手は本線+抑えを結合し軸除外・dedup 済み
 * @throws {BetPointsParseError} 形式不正時
 */
export function parseUmatanLine(line) {
  if (typeof line !== 'string') throw new BetPointsParseError('umatan line must be a string', line);
  const m = line.match(UMATAN_LINE_RE);
  if (!m) throw new BetPointsParseError('malformed umatan line', line);
  const axis = Number(m[1]);
  const rest = m[2];
  const osaeMatch = rest.match(/\(抑え([0-9.]+)\)/);
  const mainPart = rest.replace(/\(抑え[0-9.]+\)/, '');
  const main = toHorseNumbers(mainPart, line);
  const osae = osaeMatch ? toHorseNumbers(osaeMatch[1], line) : [];
  const partners = [...new Set([...main, ...osae])].filter((n) => n !== axis);
  return { axis, partners };
}

/**
 * 馬単のユニーク順序付き組数（軸↔全相手・双方向・全行 dedup）を返す。
 * 払戻は使わない。
 * @param {string[]} lines bettingLines.umatan
 * @returns {number}
 * @throws {BetPointsParseError} lines が配列でない / 行が形式不正
 */
export function countUmatanUniquePoints(lines) {
  if (!Array.isArray(lines)) throw new BetPointsParseError('lines must be an array', lines);
  const pairs = new Set();
  for (const line of lines) {
    const { axis, partners } = parseUmatanLine(line);
    for (const p of partners) {
      pairs.add(`${axis}-${p}`);
      pairs.add(`${p}-${axis}`);
    }
  }
  return pairs.size;
}
