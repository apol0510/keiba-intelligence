#!/usr/bin/env node
/**
 * importHorseHistoriesJra.js
 *
 * keiba-data-shared の jra/horseHistories/YYYY/MM/YYYY-MM-DD-{VENUE}.json を
 * 本リポジトリの astro-site/src/data/horseHistories/jra/YYYY/MM/{file} に転記する。
 *
 * 取得方式:
 *   - createSharedClient (scripts/lib/sharedFetch.mjs) 経由の Contents API を使用
 *   - KEIBA_DATA_SHARED_TOKEN 必須（HTTP 前に TOKEN_MISSING で失敗）
 *   - GITHUB_TOKEN fallback / anonymous raw fallback なし
 *
 * 使い方:
 *   node scripts/importHorseHistoriesJra.js --date 2026-05-24
 *   node scripts/importHorseHistoriesJra.js --date 2026-05-24 --venues TOK,KYO,NII
 *   node scripts/importHorseHistoriesJra.js --date 2026-05-24 --dry-run
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSharedClient, SharedFetchError, SHARED_FETCH_CODES } from './lib/sharedFetch.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CROSS_REPO_TOKEN_KEY = 'KEIBA_DATA_SHARED_TOKEN';

export const ALL_JRA_VENUES = ['TOK', 'NAK', 'KYO', 'HAN', 'CHU', 'KOK', 'NII', 'FKS', 'SAP', 'HKD'];

/**
 * KEIBA_DATA_SHARED_TOKEN を env から取得。未設定の場合は TOKEN_MISSING を throw。
 * GITHUB_TOKEN / GITHUB_TOKEN_KEIBA_DATA_SHARED は参照しない。
 */
function requireCrossRepoToken(env) {
  const raw = env?.[CROSS_REPO_TOKEN_KEY];
  const token = typeof raw === 'string' ? raw.trim() : '';
  if (!token) {
    throw new SharedFetchError(
      SHARED_FETCH_CODES.TOKEN_MISSING,
      `${CROSS_REPO_TOKEN_KEY} is not set or empty. ` +
        'This token is required to read from keiba-data-shared (private). ' +
        'Set it as a GitHub Actions secret named KEIBA_DATA_SHARED_TOKEN.',
    );
  }
  return token;
}

function parseArgs(argv) {
  const args = { date: null, venues: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--date') args.date = argv[++i];
    else if (a.startsWith('--date=')) args.date = a.slice('--date='.length);
    else if (a === '--venues') args.venues = argv[++i];
    else if (a.startsWith('--venues=')) args.venues = a.slice('--venues='.length);
    else if (a === '--dry-run') args.dryRun = true;
  }
  return args;
}

export function resolveVenues(arg) {
  if (!arg) return ALL_JRA_VENUES;
  return arg.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
}

export function buildSharedPath(date, venue) {
  const [year, month] = date.split('-');
  return `jra/horseHistories/${year}/${month}/${date}-${venue}.json`;
}

export function buildLocalPath(date, venue) {
  const [year, month] = date.split('-');
  const projectRoot = join(__dirname, '..');
  return join(projectRoot, 'src', 'data', 'horseHistories', 'jra', year, month, `${date}-${venue}.json`);
}

export function validateHorseHistoriesJson(json, expectedVenue, expectedDate) {
  if (!json || typeof json !== 'object') throw new Error('not an object');
  if (json.source !== 'jra-official') throw new Error(`unexpected source: ${json.source}`);
  if (json.date !== expectedDate) throw new Error(`date mismatch: payload=${expectedDate}, file=${json.date}`);
  if (json.venueCode !== expectedVenue) throw new Error(`venueCode mismatch: expected=${expectedVenue}, file=${json.venueCode}`);
  if (!json.horses || typeof json.horses !== 'object') throw new Error('horses missing or not an object');
  return true;
}

/**
 * JRA horseHistories インポート本体。
 *
 * @param {{
 *   argv?: string[],
 *   env?: Record<string,string|undefined>,
 *   client?: ReturnType<typeof createSharedClient>,
 *   logger?: {log: Function, error: Function},
 *   writeFileFn?: Function,
 *   mkdirFn?: Function,
 * }} [options]
 * @returns {Promise<number>} exit code (0=ok, 2=bad args, 4=some failed, 5=all skipped)
 */
export async function importHorseHistoriesJra({
  argv = process.argv.slice(2),
  env = process.env,
  client,
  logger = console,
  writeFileFn = writeFileSync,
  mkdirFn = mkdirSync,
} = {}) {
  const args = parseArgs(argv);
  if (!args.date || !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    logger.error('❌ --date YYYY-MM-DD が必要');
    return 2;
  }

  // TOKEN_MISSING は HTTP 前に throw（fetch 呼出し 0）
  const token = requireCrossRepoToken(env);
  const venues = resolveVenues(args.venues);

  // createSharedClient に渡す env は KEIBA_DATA_SHARED_TOKEN のみに限定する
  // （GITHUB_TOKEN がレキシカルスコープにあっても client へは届かない）
  const c = client ?? createSharedClient({ env: { [CROSS_REPO_TOKEN_KEY]: token } });

  logger.log('📥 importHorseHistoriesJra');
  logger.log(`   date:    ${args.date}`);
  logger.log(`   venues:  ${venues.join(', ')}`);
  logger.log('   auth:    Contents API (KEIBA_DATA_SHARED_TOKEN)');
  logger.log(`   dry-run: ${args.dryRun ? 'YES' : 'NO'}`);
  logger.log('');

  let savedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const venue of venues) {
    const sharedPath = buildSharedPath(args.date, venue);
    const localPath = buildLocalPath(args.date, venue);
    try {
      // required: false → 404 は null（skip）、他は throw
      const json = await c.fetchJson(sharedPath, { required: false });
      if (json === null) {
        logger.log(`  ${venue}: skip (HTTP 404: ${sharedPath})`);
        skippedCount++;
        continue;
      }
      validateHorseHistoriesJson(json, venue, args.date);
      const horseCount = Object.keys(json.horses || {}).length;
      if (args.dryRun) {
        logger.log(`  ${venue}: OK (dry-run, horses=${horseCount}, would write ${localPath})`);
        savedCount++;
        continue;
      }
      mkdirFn(dirname(localPath), { recursive: true });
      writeFileFn(localPath, JSON.stringify(json, null, 2), 'utf-8');
      logger.log(`  ${venue}: saved (horses=${horseCount}) -> ${localPath}`);
      savedCount++;
    } catch (e) {
      logger.log(`  ${venue}: FAIL: ${e.message}`);
      failedCount++;
    }
  }

  logger.log('');
  logger.log(`━━━ サマリ: saved=${savedCount} skipped=${skippedCount} failed=${failedCount} ━━━`);

  if (failedCount > 0) {
    logger.error('❌ 一部 venue で取得失敗');
    return 4;
  }
  if (savedCount === 0) {
    logger.error('❌ 1件も保存されなかった (すべて 404?)');
    return 5;
  }
  return 0;
}

// direct-run guard：テストから import された場合は実行しない
const isDirectRun =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  importHorseHistoriesJra({ argv: process.argv.slice(2) })
    .then((code) => {
      if (code !== 0) process.exit(code);
    })
    .catch((e) => {
      console.error('FATAL:', e.message ?? e);
      process.exit(1);
    });
}
