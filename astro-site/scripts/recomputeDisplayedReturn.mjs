#!/usr/bin/env node
/**
 * recomputeDisplayedReturn.mjs — 凍結した表示組み合わせを 1 単位（100 円）ずつ買った成績を再計算する（内部用・顧客に表示しない）
 *
 * 入力: src/data/displayedBets/**（凍結）× src/data/archiveResults*.json（確定した馬単の組と 100 円払戻）
 * 出力: src/data/stats/displayedReturn.json（市場別・日別の stake / payout / 回収率・的中率）
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { displayedReturn } from '../src/lib/stats/displayedBets.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
}
const frozen = walk(join(ROOT, 'src', 'data', 'displayedBets')).filter((p) => p.endsWith('.json'))
  .flatMap((p) => JSON.parse(readFileSync(p, 'utf8')));

const results = new Map();
const conflicts = [];
for (const [market, file] of [['nankan', 'archiveResults.json'], ['jra', 'archiveResultsJra.json']]) {
  const arr = JSON.parse(readFileSync(join(ROOT, 'src', 'data', file), 'utf8'));
  for (const day of arr) {
    for (const r of day.races || []) {
      const combo = String(r?.umatan?.combination || '');
      const [a, b] = combo.split('-');
      if (!a || !b || !Number.isFinite(Number(r?.umatan?.payout))) continue;
      const venue = r.venue || day.venue;
      // 🔴 着順（result）と馬単の払戻の組が食い違うレースは推測せず除外する（2026-02 南関で 6 件）
      if (Number(r?.result?.first?.number) !== Number(a) || Number(r?.result?.second?.number) !== Number(b)) {
        conflicts.push(`${market} ${day.date} ${venue} ${r.raceNumber}R`);
        continue;
      }
      results.set(`${market}|${day.date}|${venue}|${r.raceNumber}`, {
        first: String(a).padStart(2, '0'), second: String(b).padStart(2, '0'), payoutPer100: Number(r.umatan.payout),
      });
    }
  }
}
const out = { schema: 'ki_displayed_return.v1', generatedAt: new Date().toISOString(), unitYen: 100,
  note: '凍結した表示組み合わせを各 100 円で買った場合（内部集計・顧客には表示しない）', dataConflicts: conflicts, ...displayedReturn(frozen, results) };
mkdirSync(join(ROOT, 'src', 'data', 'stats'), { recursive: true });
writeFileSync(join(ROOT, 'src', 'data', 'stats', 'displayedReturn.json'), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ days: out.days.length, dataConflicts: conflicts.length, totals: out.totals }));
