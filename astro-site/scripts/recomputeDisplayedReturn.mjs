#!/usr/bin/env node
/**
 * recomputeDisplayedReturn.mjs — 凍結した表示組み合わせを 1 単位（100 円）ずつ買った成績を再計算する
 *
 * 入力: src/data/displayedBets/**（凍結）× src/data/archiveResults*.json（確定した馬単の組と 100 円払戻）
 * 出力:
 *   - src/data/stats/displayedReturn.json（内部・全期間・日別・AI全選定と AI上位表示）
 *   - src/data/stats/displayedSummary.json（顧客向け表示の正本・PUBLIC_FROM 以降の AI全選定・市場別）
 * 🔴 出力は入力だけで決まる（実行時刻を書かない）。build の前に毎回走らせる。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { displayedReturn, resultsFromArchive, PUBLIC_FROM, UNIT_YEN } from '../src/lib/stats/displayedBets.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
}
const frozen = walk(join(ROOT, 'src', 'data', 'displayedBets')).filter((p) => p.endsWith('.json')).sort()
  .flatMap((p) => JSON.parse(readFileSync(p, 'utf8')));
const read = (f) => JSON.parse(readFileSync(join(ROOT, 'src', 'data', f), 'utf8'));
const { results, conflicts } = resultsFromArchive([['nankan', read('archiveResults.json')], ['jra', read('archiveResultsJra.json')]]);

const full = displayedReturn(frozen, results);
const pub = displayedReturn(frozen, results, { from: PUBLIC_FROM });
const out = { schema: 'ki_displayed_return.v2', unitYen: UNIT_YEN,
  note: '凍結した表示組み合わせを各 100 円で買った場合（AI全選定 / AI上位表示）。顧客向けは displayedSummary.json', dataConflicts: conflicts, ...full };
const pick = (t) => ({ from: t.from, to: t.to, races: t.races, hits: t.hits, hitRate: t.hitRate, avgCombos: t.avgCombos,
  stake: t.stake, payout: t.payout, returnRate: t.returnRate });
const summary = { schema: 'ki_displayed_summary.v1', basis: 'ai_all_selection', unitYen: UNIT_YEN, publicFrom: PUBLIC_FROM,
  nankan: pick(pub.totals.nankan), jra: pick(pub.totals.jra) };
mkdirSync(join(ROOT, 'src', 'data', 'stats'), { recursive: true });
writeFileSync(join(ROOT, 'src', 'data', 'stats', 'displayedReturn.json'), JSON.stringify(out, null, 1) + '\n');
writeFileSync(join(ROOT, 'src', 'data', 'stats', 'displayedSummary.json'), JSON.stringify(summary, null, 1) + '\n');
console.log(JSON.stringify({ days: out.days.length, dataConflicts: conflicts.length, public: { nankan: summary.nankan, jra: summary.jra },
  topInternal: { nankan: pub.totals.nankan.top, jra: pub.totals.jra.top } }));
