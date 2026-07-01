#!/usr/bin/env node
/**
 * previewNankanBetPoints.mjs (keiba-intelligence) — 【READ-ONLY / Phase 3 dry-run】
 *
 * 既存 archive を **一切書き換えず**、案1（ユニーク実購入買い目数）で
 * 南関馬単の購入点数・投資額・回収率を再計算し、現行値との差分だけを出力する。
 *
 *   - 対象: 南関馬単のみ（archiveResults.json）
 *   - JRA（archiveResultsJra.json）は対象外・参照しない
 *   - 的中件数・払戻は既存 archive 値を維持（払戻から点数を逆算しない）
 *   - 書き込み関数を持たない（fs.writeFile 等は import しない）
 *
 * 実行: node scripts/previewNankanBetPoints.mjs   （astro-site 直下から）
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  countUmatanUniquePoints,
  BetPointsParseError,
} from '../src/utils/nankanBetPoints.js';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data');
const yen = (n) => `¥${Number(n).toLocaleString()}`;

const arch = JSON.parse(readFileSync(join(DATA, 'archiveResults.json'), 'utf-8'));
let curInv = 0, newInv = 0, pay = 0; const unrecalc = [];
for (const e of arch) {
  let uniq = 0, missing = 0, bad = 0;
  for (const r of e.races || []) {
    const lines = r.bettingLines;
    if (!Array.isArray(lines) || lines.length === 0) { missing++; continue; }
    try { uniq += countUmatanUniquePoints(lines); }
    catch (err) { if (err instanceof BetPointsParseError) bad++; else throw err; }
  }
  if (missing || bad) unrecalc.push(`${e.date}(欠${missing}/不正${bad})`);
  curInv += (e.totalInvestment || e.betAmount || 0);
  newInv += uniq * 100;
  pay += (e.totalPayout || 0);
}

console.log('【READ-ONLY dry-run】既存 archive は書き換えません（南関馬単のみ / JRA 非対象）');
console.log(`\n================= KI 馬単 =================`);
console.log(`対象期間: ${arch[arch.length - 1]?.date} 〜 ${arch[0]?.date}  日数: ${arch.length}`);
console.log(`現行 投資額=${yen(curInv)} → 回収率 ${curInv > 0 ? (pay / curInv * 100).toFixed(1) : 'n/a'}%`);
console.log(`案1  投資額=${yen(newInv)} → 回収率 ${newInv > 0 ? (pay / newInv * 100).toFixed(1) : 'n/a'}%   (分母不足 ${yen(newInv - curInv)})`);
console.log(`総払戻(不変)=${yen(pay)}`);
if (unrecalc.length) console.log(`再計算不能/欠損 ${unrecalc.length}件: ${unrecalc.slice(0, 40).join(', ')}${unrecalc.length > 40 ? ' …' : ''}`);
