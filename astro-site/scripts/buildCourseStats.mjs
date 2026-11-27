#!/usr/bin/env node
/**
 * buildCourseStats.mjs — 南関 4 場のコース別傾向（/course/*）のデータを作る
 *
 * 使い方:
 *   npm run build:course-stats -- --source <keiba-data-shared の checkout>
 *   （<source>/nankan/results/YYYY/MM/*.json を読み、src/data/course/nankanCourseStats.json を書く）
 *
 * 🔴 入力は確定結果だけ。書き込むのは出力 JSON 1 つだけ。
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRaces, buildCourseStats } from '../src/lib/course/courseStats.js';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'src', 'data', 'course', 'nankanCourseStats.json');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function listJson(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listJson(p));
    else if (name.endsWith('.json')) out.push(p);
  }
  return out;
}

const source = arg('--source');
if (!source) {
  console.error('usage: buildCourseStats.mjs --source <keiba-data-shared checkout>');
  process.exit(2);
}

const files = listJson(join(source, 'nankan', 'results')).sort().map((p) => JSON.parse(readFileSync(p, 'utf-8')));
const races = collectRaces(files);
const stats = buildCourseStats(races, { generatedAt: new Date().toISOString() });
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(stats, null, 1)}\n`);
console.log(`courses=${stats.courses.length} races=${stats.baseline.races} period=${stats.baseline.from}..${stats.baseline.to}`);
