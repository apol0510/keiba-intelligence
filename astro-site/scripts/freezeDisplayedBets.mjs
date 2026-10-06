#!/usr/bin/env node
/**
 * freezeDisplayedBets.mjs — 予想の公開時に「会員に表示した馬単の組み合わせ」を凍結する（最初に見た版が勝つ）
 *
 * 入力: src/data/predictions/*.json（南関）・src/data/predictions/jra/YYYY/MM/*.json（JRA）
 * 出力: src/data/displayedBets/{nankan,jra}/<予想ファイル名>（`ki_displayed_bets.v1` の配列・会場ごと）
 *
 * 🔴 既存の凍結ファイルは上書きしない。予想ファイルが後から変わった場合は drift として標準出力へ記録するだけ。
 * 🔴 `--backfill` は過去分を後から凍結する（`backfilled: true`）。結果取込済みのレースは **archive に残った買い目**（結果取込時点の版）を使う。
 *    2026 年前半は予想ファイルが後から書き換わった例があるため、現在の予想ファイルより archive の方が表示時に近い。
 * 🔴 `--date YYYY-MM-DD` を付けるとその日の予想だけ扱う（import workflow から呼ぶ）。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freeze } from '../src/lib/stats/displayedBets.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PRED = join(ROOT, 'src', 'data', 'predictions');
const OUT = join(ROOT, 'src', 'data', 'displayedBets');
const args = process.argv.slice(2);
const backfill = args.includes('--backfill');
const onlyDate = args.includes('--date') ? args[args.indexOf('--date') + 1] : null;
const nowIso = new Date().toISOString();

/** backfill 用: archive に残った買い目（`market|date|venue|raceNumber` → bettingLines）。 */
const archived = new Map();
if (backfill) {
  for (const [market, file] of [['nankan', 'archiveResults.json'], ['jra', 'archiveResultsJra.json']]) {
    for (const day of JSON.parse(readFileSync(join(ROOT, 'src', 'data', file), 'utf8'))) {
      for (const r of day.races || []) {
        if (Array.isArray(r.bettingLines) && r.bettingLines.length) archived.set(`${market}|${day.date}|${r.venue || day.venue}|${r.raceNumber}`, r.bettingLines);
      }
    }
  }
}
function withArchivedLines(market, v) {
  if (!backfill) return v.predictions;
  return v.predictions.map((p) => {
    const lines = archived.get(`${market}|${v.date}|${v.venue}|${p?.raceInfo?.raceNumber}`);
    return lines ? { ...p, bettingLines: lines } : p;
  });
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function venuesOf(market, json) {
  if (market === 'nankan') return [{ date: json?.eventInfo?.date, venue: json?.eventInfo?.venue, predictions: json?.predictions }];
  return (json?.venues || []).map((v) => ({ date: v?.eventInfo?.date || json?.date, venue: v?.eventInfo?.venue || v?.venue, predictions: v?.predictions }));
}

const sources = [
  ...readdirSync(PRED).filter((n) => n.endsWith('.json')).map((n) => ({ market: 'nankan', path: join(PRED, n) })),
  ...walk(join(PRED, 'jra')).filter((p) => p.endsWith('.json')).map((p) => ({ market: 'jra', path: p })),
];
let written = 0; let kept = 0; let driftRaces = 0;
for (const { market, path } of sources) {
  if (onlyDate && !basename(path).startsWith(onlyDate)) continue;
  const json = JSON.parse(readFileSync(path, 'utf8'));
  const outPath = join(OUT, market, basename(path));
  const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : [];
  const byVenue = new Map(existing.map((r) => [`${r.date}|${r.venue}`, r]));
  let changed = false;
  for (const v of venuesOf(market, json)) {
    if (!v.date || !v.venue || !Array.isArray(v.predictions)) continue;
    const key = `${v.date}|${v.venue}`;
    const res = freeze({ market, date: v.date, venue: v.venue, predictions: withArchivedLines(market, v), nowIso, existing: byVenue.get(key) || null, backfilled: backfill });
    if (res.changed) { byVenue.set(key, res.record); changed = true; written += 1; } else { kept += 1; }
    if (res.drift.length) { driftRaces += res.drift.length; console.log(`DRIFT ${market} ${key} races=${res.drift.join(',')}（凍結済みの組み合わせを維持）`); }
  }
  if (changed) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify([...byVenue.values()].sort((a, b) => (a.venue < b.venue ? -1 : 1)), null, 1) + '\n');
  }
}
console.log(JSON.stringify({ written, kept, driftRaces }));
