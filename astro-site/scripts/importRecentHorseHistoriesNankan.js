#!/usr/bin/env node
/**
 * importRecentHorseHistoriesNankan.js
 *
 * keiba-data-shared の nankan/recentHorseHistories/YYYY/MM/YYYY-MM-DD-{VENUE}.json を
 * 本リポジトリの astro-site/src/data/recentHorseHistories/nankan/YYYY/MM/{file} に転記する。
 *
 * ※ JRA horseHistories とは別系統（別 script / 別 workflow / 別 event）。
 *    既存 importHorseHistoriesJra.js は一切共有・改変しない。
 *
 * 取得方式（sharedFetch helper 経由・認証必須）:
 *   - createSharedClient（sharedFetch.mjs）を使用
 *   - token 契約: KEIBA_DATA_SHARED_TOKEN 必須。GITHUB_TOKEN への fallback は禁止。
 *   - token 未設定: HTTP 到達前に TOKEN_MISSING fatal
 *   - GITHUB_TOKEN のみ: HTTP 到達前に TOKEN_MISSING fatal（fetch 呼出し 0）
 *   - 404 のみ未存在扱い（skip）。401/403/429/5xx/network/timeout/malformed → fatal
 *
 * 使い方:
 *   node scripts/importRecentHorseHistoriesNankan.js --date 2026-05-22
 *   node scripts/importRecentHorseHistoriesNankan.js --date 2026-05-22 --venues OOI,URA
 *   node scripts/importRecentHorseHistoriesNankan.js --date 2026-05-22 --dry-run
 *
 * 終了コード: 取得失敗 → 4 / 1件も保存なし → 5 / 引数不正 → 2 / OK → 0
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSharedClient, SharedFetchError, SHARED_FETCH_CODES } from './lib/sharedFetch.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

const DEFAULT_BRANCH = 'main';

// 南関4場: 大井 OOI / 川崎 KAW / 船橋 FUN / 浦和 URA
const ALL_NANKAN_VENUES = ['OOI', 'KAW', 'FUN', 'URA'];

/** keiba-data-shared 専用 cross-repo token のキー名 */
const CROSS_REPO_TOKEN_KEY = 'KEIBA_DATA_SHARED_TOKEN';

/**
 * KEIBA_DATA_SHARED_TOKEN を env から明示的に取得する。
 * 未設定 or 空の場合は HTTP 到達前に TOKEN_MISSING で fatal。
 * GITHUB_TOKEN への fallback は禁止（cross-repo アクセスは KEIBA_DATA_SHARED_TOKEN 専用）。
 */
function requireCrossRepoToken(env) {
  const raw = env?.[CROSS_REPO_TOKEN_KEY];
  const token = typeof raw === 'string' ? raw.trim() : '';
  if (!token) {
    throw new SharedFetchError(
      SHARED_FETCH_CODES.TOKEN_MISSING,
      `${CROSS_REPO_TOKEN_KEY} が設定されていません。keiba-data-shared へのアクセスには ${CROSS_REPO_TOKEN_KEY} が必須です。GITHUB_TOKEN への fallback は禁止されています。`,
    );
  }
  return token;
}

function parseArgs(argv) {
  const args = { date: null, venues: null, dryRun: false, sharedRef: DEFAULT_BRANCH };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--date') args.date = argv[++i];
    else if (a.startsWith('--date=')) args.date = a.slice('--date='.length);
    else if (a === '--venues') args.venues = argv[++i];
    else if (a.startsWith('--venues=')) args.venues = a.slice('--venues='.length);
    else if (a === '--shared-ref') args.sharedRef = argv[++i];
    else if (a.startsWith('--shared-ref=')) args.sharedRef = a.slice('--shared-ref='.length);
    else if (a === '--dry-run') args.dryRun = true;
  }
  return args;
}

function resolveVenues(arg) {
  if (!arg) return ALL_NANKAN_VENUES;
  return arg.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
}

export function buildSharedPath(date, venue) {
  const [year, month] = date.split('-');
  return `nankan/recentHorseHistories/${year}/${month}/${date}-${venue}.json`;
}

export function buildLocalPath(date, venue) {
  const [year, month] = date.split('-');
  return join(projectRoot, 'src', 'data', 'recentHorseHistories', 'nankan', year, month, `${date}-${venue}.json`);
}

// 南関 recentHorseHistories 用の検証（JRA horseHistories とは構造が異なる）
//   top-level: schemaVersion / category / date / venue / venueName / source / races
//   races[]: raceNumber / raceName / horses[]
//   horses[]: horseNumber / horseName / recentRaces[]
// 注意: source は string ではなく object（base/enrichment/generatedAt/generator）。
//       venue フィールドに3文字コードが入る（venueCode は使わない）。
export function validateRecentHorseHistoriesJson(json, expectedVenue, expectedDate) {
  if (!json || typeof json !== 'object') throw new Error('not an object');
  if (json.category !== 'nankan') throw new Error(`unexpected category: ${json.category}`);
  if (typeof json.schemaVersion !== 'string' || !json.schemaVersion.startsWith('nankan-recent-horse-histories')) {
    throw new Error(`unexpected schemaVersion: ${json.schemaVersion}`);
  }
  if (json.date !== expectedDate) throw new Error(`date mismatch: payload=${expectedDate}, file=${json.date}`);
  if (json.venue !== expectedVenue) throw new Error(`venue mismatch: expected=${expectedVenue}, file=${json.venue}`);
  if (!Array.isArray(json.races)) throw new Error('races missing or not an array');
  return true;
}

export function countHorses(json) {
  let horses = 0;
  for (const race of json.races || []) {
    horses += Array.isArray(race.horses) ? race.horses.length : 0;
  }
  return horses;
}

/**
 * DI-injectable importer（テスト用途・直接実行時は direct-run guard 経由）。
 * @returns {Promise<{savedCount, skippedCount, failedCount}>}
 */
export async function importRecentHorseHistoriesNankan({
  argv = process.argv.slice(2),
  env = process.env,
  client,
  logger = console,
  writeFileFn = writeFileSync,
  mkdirFn = mkdirSync,
} = {}) {
  // KEIBA_DATA_SHARED_TOKEN 必須。GITHUB_TOKEN fallback 禁止。HTTP 到達前に検証。
  const token = requireCrossRepoToken(env);

  const args = parseArgs(argv);
  if (!args.date || !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    throw new Error('Usage: --date YYYY-MM-DD [--venues OOI,KAW,FUN,URA] [--dry-run]');
  }
  const venues = resolveVenues(args.venues);

  // KEIBA_DATA_SHARED_TOKEN のみを渡す（env 内の他 token を client へ漏洩させない）
  const c = client ?? createSharedClient({ env: { [CROSS_REPO_TOKEN_KEY]: token } });

  logger.log('📥 importRecentHorseHistoriesNankan');
  logger.log(`   date:    ${args.date}`);
  logger.log(`   venues:  ${venues.join(', ')}`);
  logger.log(`   ref:     ${args.sharedRef}`);
  logger.log(`   dry-run: ${args.dryRun ? 'YES' : 'NO'}`);
  logger.log('');

  let savedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const venue of venues) {
    const sharedPath = buildSharedPath(args.date, venue);
    const localPath = buildLocalPath(args.date, venue);
    process.stdout.write(`  ${venue}: `);
    try {
      // required:false → 404 のみ null（skip）、他は fatal throw
      const json = await c.fetchJson(sharedPath, { ref: args.sharedRef, required: false });
      if (json === null) {
        logger.log(`skip (HTTP 404 from keiba-data-shared: ${sharedPath})`);
        skippedCount++;
        continue;
      }

      validateRecentHorseHistoriesJson(json, venue, args.date);
      const raceCount = (json.races || []).length;
      const horseCount = countHorses(json);

      if (args.dryRun) {
        logger.log(
          `OK (dry-run, races=${raceCount}, horses=${horseCount}, would write ${localPath.replace(projectRoot, '.')})`
        );
        savedCount++;
        continue;
      }

      mkdirFn(dirname(localPath), { recursive: true });
      writeFileFn(localPath, JSON.stringify(json, null, 2), 'utf-8');
      logger.log(`saved (races=${raceCount}, horses=${horseCount}) -> ${localPath.replace(projectRoot, '.')}`);
      savedCount++;
    } catch (e) {
      logger.log(`FAIL: ${e.message}`);
      failedCount++;
    }
  }

  logger.log('');
  logger.log(`━━━ サマリ: saved=${savedCount} skipped=${skippedCount} failed=${failedCount} ━━━`);

  return { savedCount, skippedCount, failedCount };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  importRecentHorseHistoriesNankan({ argv: process.argv.slice(2) })
    .then(({ failedCount, savedCount }) => {
      if (failedCount > 0) {
        console.error('❌ 一部 venue で取得失敗');
        process.exit(4);
      }
      if (savedCount === 0) {
        console.error('❌ 1件も保存されなかった (すべて 404?)');
        process.exit(5);
      }
    })
    .catch((e) => {
      if (e instanceof Error && /Usage:/.test(e.message)) { console.error(`❌ ${e.message}`); process.exit(2); }
      console.error('FATAL:', e.message ?? String(e));
      process.exit(1);
    });
}
