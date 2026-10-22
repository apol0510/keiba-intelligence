/**
 * /sitemap.xml — build 時に静的生成する（正本: docs/measurements/TRAFFIC_GROWTH_2026_10.md §2.1）
 *
 * 🔴 以前の本ファイルは `readdirSync` を import しておらず予想ページを 1 件も出せず、
 *    しかも `@netlify/plugin-sitemap` が dist に書く sitemap.xml が優先されて一度も配信されていなかった。
 *    plugin は netlify.toml から外し、ここを唯一の生成元にする。URL の選定は src/lib/seo/sitemap.js。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildSitemapEntries, renderSitemapXml } from '../lib/seo/sitemap.js';

export const prerender = true;

function readJsonArray(path) {
  try {
    if (!existsSync(path)) return [];
    const v = JSON.parse(readFileSync(path, 'utf-8'));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function listDir(path) {
  try { return existsSync(path) ? readdirSync(path) : []; } catch { return []; }
}

export async function GET() {
  const dataDir = join(process.cwd(), 'src', 'data');
  const predDir = join(dataDir, 'predictions');

  const nankanPredictionSlugs = listDir(predDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}-[a-z]+\.json$/.test(f))
    .map((f) => f.replace(/\.json$/, ''));

  const jraPredictionDates = [];
  const jraDir = join(predDir, 'jra');
  for (const y of listDir(jraDir).filter((d) => /^\d{4}$/.test(d))) {
    for (const m of listDir(join(jraDir, y)).filter((d) => /^\d{2}$/.test(d))) {
      for (const f of listDir(join(jraDir, y, m))) {
        if (/^\d{4}-\d{2}-\d{2}\.json$/.test(f)) jraPredictionDates.push(f.replace(/\.json$/, ''));
      }
    }
  }

  const entries = buildSitemapEntries({
    archiveNankan: readJsonArray(join(dataDir, 'archiveResults.json')),
    archiveJra: readJsonArray(join(dataDir, 'archiveResultsJra.json')),
    nankanPredictionSlugs,
    jraPredictionDates,
  });

  return new Response(renderSitemapXml(entries), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
