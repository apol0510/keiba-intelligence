#!/usr/bin/env node
/**
 * importFeatureScores.js
 *
 * keiba-data-shared の {category}/featureScores/YYYY/MM/YYYY-MM-DD-{VENUE}.json を
 * 本リポジトリの astro-site/src/data/featureScores/{category}/YYYY/MM/{file} に転記する。
 *
 * - 表示専用データ（Layer A normalizedPastRaces + Layer B 6項目 featureScores）。
 *   AI総合指数 / 印 / 買い目 / 予想本文 / 過去走 とは独立。本スクリプトはそれらに触れない。
 * - 取得は sharedFetch.mjs（認証付き GitHub Contents API）を使用。匿名 fallback なし。
 * - 書き込み先は src/data/featureScores/ 配下のみ（dest assert で強制）。
 * - featureScores 未保存の場（HTTP 404）は skip（エラーにしない）。
 * - engine が category と一致しない / parse 不能なファイルは書き込まない（受信側ガード）。
 *
 * 使い方:
 *   node scripts/importFeatureScores.js --category jra --date 2026-05-24 --venues TOK,KYO --dry-run
 *   node scripts/importFeatureScores.js --category nankan --date 2026-05-29 --venues URA
 *   node scripts/importFeatureScores.js --category jra --date 2026-05-24 --venues TOK --source local --shared-root /tmp/fs-fixture
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, sep, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSharedClient, resolveSharedToken } from './lib/sharedFetch.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..'); // astro-site

const VENUES_BY_CATEGORY = {
  jra: ['TOK', 'NAK', 'KYO', 'HAN', 'CHU', 'KOK', 'NII', 'FKS', 'SAP', 'HKD'],
  nankan: ['OOI', 'KAW', 'FUN', 'URA'],
};
const EXPECTED_ENGINE = { jra: 'jra-v1', nankan: 'nankan-v1' };

function parseArgs(argv) {
  const args = { category: null, date: null, venues: null, dryRun: false, source: 'remote', sharedRoot: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--category') args.category = argv[++i];
    else if (a.startsWith('--category=')) args.category = a.slice('--category='.length);
    else if (a === '--date') args.date = argv[++i];
    else if (a.startsWith('--date=')) args.date = a.slice('--date='.length);
    else if (a === '--venues' || a === '--venue') args.venues = argv[++i];
    else if (a.startsWith('--venues=')) args.venues = a.slice('--venues='.length);
    else if (a.startsWith('--venue=')) args.venues = a.slice('--venue='.length);
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--source') args.source = argv[++i];
    else if (a.startsWith('--source=')) args.source = a.slice('--source='.length);
    else if (a === '--shared-root') args.sharedRoot = argv[++i];
    else if (a.startsWith('--shared-root=')) args.sharedRoot = a.slice('--shared-root='.length);
  }
  return args;
}

function resolveVenues(category, arg) {
  if (!arg) return VENUES_BY_CATEGORY[category];
  return arg.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
}

function buildSharedPath(category, date, venue) {
  const [year, month] = date.split('-');
  return `${category}/featureScores/${year}/${month}/${date}-${venue}.json`;
}

function buildLocalPath(category, date, venue) {
  const [year, month] = date.split('-');
  return join(projectRoot, 'src', 'data', 'featureScores', category, year, month, `${date}-${venue}.json`);
}

/** --source local: shared-root 配下のローカルファイルから読む（検証用・read only） */
function fetchLocal(sharedRoot, sharedPath) {
  const full = join(resolve(sharedRoot), sharedPath);
  if (!existsSync(full)) return { ok: false, status: 404, meta: { url: full } };
  return { ok: true, status: 200, meta: { url: full }, body: readFileSync(full, 'utf-8') };
}

function parseJsonStrict(body, meta) {
  if (body == null || body === '') throw new Error(`empty response body (status=${meta.status})`);
  const first = body.trimStart()[0];
  if (first !== '{' && first !== '[') throw new Error(`invalid JSON prefix: "${String(body).slice(0, 80)}" (status=${meta.status})`);
  try { return JSON.parse(body); } catch (e) { throw new Error(`JSON.parse failed: ${e.message}`); }
}

class CliArgumentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CliArgumentError';
    this.exitCode = 2;
  }
}

/** 受信側ガード: engine / category / date / venueCode の整合を検証。不一致は throw（→書き込まない） */
function validateFeatureScoresJson(json, category, venue, date) {
  if (!json || typeof json !== 'object') throw new Error('not an object');
  const expectedEngine = EXPECTED_ENGINE[category];
  if (json.engine !== expectedEngine) throw new Error(`engine mismatch: expected=${expectedEngine}, file=${json.engine}`);
  if (json.category !== category) throw new Error(`category mismatch: expected=${category}, file=${json.category}`);
  if (json.date !== date) throw new Error(`date mismatch: expected=${date}, file=${json.date}`);
  if (json.venueCode !== venue) throw new Error(`venueCode mismatch: expected=${venue}, file=${json.venueCode}`);
  if (!json.races || typeof json.races !== 'object') throw new Error('races missing or not an object');
  return true;
}

export async function importFeatureScores({ argv = process.argv, env = process.env, client: _client, resolveToken = resolveSharedToken, logger = console } = {}) {
  const args = parseArgs(argv);
  if (!args.category || !['jra', 'nankan'].includes(args.category)) {
    throw new CliArgumentError('--category jra|nankan が必要（local は対象外）');
  }
  if (!args.date || !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    throw new CliArgumentError('--date YYYY-MM-DD が必要');
  }
  const venues = resolveVenues(args.category, args.venues);
  const sharedRoot = args.sharedRoot || join(projectRoot, '..', '..', 'keiba-data-shared');
  const FS_ROOT = join(projectRoot, 'src', 'data', 'featureScores') + sep;

  // token fail-fast for remote (before any HTTP)
  if (args.source !== 'local') {
    resolveToken({ env });
  }
  const c = (args.source !== 'local') ? (_client ?? createSharedClient({ env })) : null;

  logger.log(`📥 importFeatureScores`);
  logger.log(`   category: ${args.category} (expect engine=${EXPECTED_ENGINE[args.category]})`);
  logger.log(`   date:     ${args.date}`);
  logger.log(`   venues:   ${venues.join(', ')}`);
  logger.log(`   source:   ${args.source}${args.source === 'local' ? ` (root=${resolve(sharedRoot)})` : ' (auth=KEIBA_DATA_SHARED_TOKEN)'}`);
  logger.log(`   dry-run:  ${args.dryRun ? 'YES' : 'NO'}`);
  logger.log('');

  let savedCount = 0, skippedCount = 0, failedCount = 0;

  for (const venue of venues) {
    const sharedPath = buildSharedPath(args.category, args.date, venue);
    const localPath = buildLocalPath(args.category, args.date, venue);
    process.stdout.write(`  ${venue}: `);
    try {
      let json;
      if (args.source === 'local') {
        const r = fetchLocal(sharedRoot, sharedPath);
        if (r.status === 404) { console.log(`skip (404: ${sharedPath} 未保存)`); skippedCount++; continue; }
        if (!r.ok) throw new Error(`local fetch failed (status=${r.status})`);
        json = parseJsonStrict(r.body, r.meta);
      } else {
        const data = await c.fetchJson(sharedPath, { ref: 'main', required: false });
        if (data === null) { console.log(`skip (404: ${sharedPath} 未保存)`); skippedCount++; continue; }
        json = data;
      }
      validateFeatureScoresJson(json, args.category, venue, args.date);
      const raceCount = Object.keys(json.races || {}).length;

      const destAbs = resolve(localPath);
      if (!destAbs.startsWith(FS_ROOT)) {
        console.log(`SAFETY ABORT: 書き込み先が src/data/featureScores/ 配下でない: ${destAbs}`);
        process.exit(3);
      }

      if (args.dryRun) {
        console.log(`OK (dry-run, races=${raceCount}, bytes=${JSON.stringify(json).length}, would write ${localPath.replace(projectRoot, '.')})`);
        savedCount++;
        continue;
      }
      mkdirSync(dirname(localPath), { recursive: true });
      writeFileSync(localPath, JSON.stringify(json, null, 2), 'utf-8');
      console.log(`saved (races=${raceCount}, bytes=${JSON.stringify(json, null, 2).length}) -> ${localPath.replace(projectRoot, '.')}`);
      savedCount++;
    } catch (e) {
      if (e.code) throw e; // SharedFetchError (AUTH_FAILED, FORBIDDEN, INVALID_JSON, etc.) → fatal
      console.log(`FAIL: ${e.message}`);
      failedCount++;
    }
  }

  console.log('');
  console.log(`━━━ サマリ: saved=${savedCount} skipped=${skippedCount} failed=${failedCount} ━━━`);

  if (failedCount > 0) {
    console.error('❌ 一部 venue で取得/検証失敗（engine 不一致・parse 不能等は書き込まずスキップ）');
    process.exit(4);
  }
  if (savedCount === 0) {
    console.log('ℹ️  保存対象なし（全 venue 未保存=404 skip）。featureScores 未生成のため正常。');
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  importFeatureScores().catch((e) => { console.error('FATAL:', e?.message ?? String(e)); process.exit(e?.exitCode === 2 ? 2 : 1); });
}
