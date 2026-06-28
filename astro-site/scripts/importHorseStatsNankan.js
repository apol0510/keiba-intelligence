#!/usr/bin/env node
/**
 * importHorseStatsNankan.js
 *
 * keiba-data-shared の nankan/horseStats/YYYY/MM/YYYY-MM-DD-{VENUE}-R{NN}.json（uma_info 元表統計・raceNo別）
 * を本リポジトリの src/data/horseStats/nankan/YYYY/MM/{file} に転記する。
 *
 * ※ entries / recentHorseHistories とは別系統（別 script・別 data dir）。
 *   importEntriesNankan.js / importRecentHorseHistoriesNankan.js を雛形にした自己完結スクリプト。
 *   horseStats は **1会場=最大12ファイル（R01〜R12）** で entries（1会場1ファイル）と異なる。
 *
 * 取得方式（sharedFetch helper 経由・認証必須）:
 *   - createSharedClient（sharedFetch.mjs）を使用
 *   - token 契約: KEIBA_DATA_SHARED_TOKEN 必須。GITHUB_TOKEN への fallback は禁止。
 *   - token 未設定: HTTP 到達前に TOKEN_MISSING fatal
 *   - GITHUB_TOKEN のみ: HTTP 到達前に TOKEN_MISSING fatal（fetch 呼出し 0）
 *   - 404 のみ未存在扱い（skip）。401/403/429/5xx/network/timeout/malformed → fatal
 *
 * 表示専用データ: featureScores / AI指数 / 印 / 買い目 / EV / recentRaces には一切接続しない。
 *
 * 使い方:
 *   node scripts/importHorseStatsNankan.js --date=2026-06-16 --venue=KAW --dry-run
 *   node scripts/importHorseStatsNankan.js --date=2026-06-16 --venue=KAW
 *   node scripts/importHorseStatsNankan.js --date=2026-06-16 --venues=OOI,KAW
 *
 * 終了コード: 取得/検証エラーあり → 4 / 1件も取得なし → 5 / 引数不正 → 2 / OK → 0。
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSharedClient, SharedFetchError, SHARED_FETCH_CODES } from './lib/sharedFetch.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

const DEFAULT_BRANCH = 'main';
const DEFAULT_EXPECTED_RACES = 12;

const ALL_NANKAN_VENUES = ['OOI', 'KAW', 'FUN', 'URA'];
const NANKAN_VENUE_NAME_BY_CODE = { OOI: '大井', KAW: '川崎', FUN: '船橋', URA: '浦和' };

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
  const args = { date: null, venues: null, dryRun: false, sharedRef: DEFAULT_BRANCH, expectedRaces: DEFAULT_EXPECTED_RACES };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--date') args.date = argv[++i];
    else if (a.startsWith('--date=')) args.date = a.slice('--date='.length);
    else if (a === '--venue' || a === '--venues') args.venues = argv[++i];
    else if (a.startsWith('--venue=')) args.venues = a.slice('--venue='.length);
    else if (a.startsWith('--venues=')) args.venues = a.slice('--venues='.length);
    else if (a === '--shared-ref') args.sharedRef = argv[++i];
    else if (a.startsWith('--shared-ref=')) args.sharedRef = a.slice('--shared-ref='.length);
    else if (a.startsWith('--expected-races=')) args.expectedRaces = Number(a.slice('--expected-races='.length));
    else if (a === '--dry-run') args.dryRun = true;
  }
  return args;
}

function resolveVenues(arg) {
  if (!arg) return ALL_NANKAN_VENUES;
  return arg.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
}

const rnnOf = (n) => `R${String(n).padStart(2, '0')}`;

export function buildSharedPath(date, venue, n) {
  const [year, month] = date.split('-');
  return `nankan/horseStats/${year}/${month}/${date}-${venue}-${rnnOf(n)}.json`;
}
export function buildLocalPath(date, venue, n) {
  const [year, month] = date.split('-');
  return join(projectRoot, 'src', 'data', 'horseStats', 'nankan', year, month, `${date}-${venue}-${rnnOf(n)}.json`);
}

/** horseStats 1ファイルの import 契約検証。不適合は throw。戻り値: horses 数。 */
export function validateHorseStatsJson(json, venue, date, raceNo) {
  if (!json || typeof json !== 'object') throw new Error('not an object');
  if (json.dataType !== 'horseStats') throw new Error(`dataType mismatch: ${json.dataType}`);
  if (json.date !== date) throw new Error(`date mismatch: expected=${date}, file=${json.date}`);
  if (json.venueCode !== venue && json.venue !== venue) throw new Error(`venue mismatch: file venueCode=${json.venueCode}/venue=${json.venue}, expected=${venue}`);
  const expectedName = NANKAN_VENUE_NAME_BY_CODE[venue];
  if (expectedName && json.venue && json.venue !== expectedName && json.venueCode !== venue) throw new Error(`venue 名不整合: ${json.venue}`);
  if (json.raceNo !== raceNo) throw new Error(`raceNo mismatch: expected=${raceNo}, file=${json.raceNo}`);
  if (json.raceNumber !== json.raceNo) throw new Error(`raceNumber(${json.raceNumber}) != raceNo(${json.raceNo})`);
  const horses = json.horses;
  if (!Array.isArray(horses)) throw new Error('horses missing or not an array');
  if (json.totalHorses !== horses.length) throw new Error(`totalHorses(${json.totalHorses}) != horses.length(${horses.length})`);
  if (horses.length > 0 && !horses[0].horseStatsNankan) throw new Error('horses[0].horseStatsNankan missing');
  return horses.length;
}

/**
 * DI-injectable importer（テスト用途・直接実行時はwrapper経由）。
 * @returns {Promise<{filesFound, totalHorses, errors, notFound, wouldWrite, written}>}
 */
export async function importHorseStatsNankan({
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
    throw new Error('Usage: --date=YYYY-MM-DD [--venue=OOI] [--dry-run]');
  }
  if (!(args.expectedRaces >= 1 && args.expectedRaces <= 12)) {
    throw new Error('--expected-races は 1〜12');
  }
  const venues = resolveVenues(args.venues);

  // KEIBA_DATA_SHARED_TOKEN のみを渡す（env 内の他 token を client へ漏洩させない）
  const c = client ?? createSharedClient({ env: { [CROSS_REPO_TOKEN_KEY]: token } });

  logger.log('📥 importHorseStatsNankan');
  logger.log(`   date:    ${args.date}`);
  logger.log(`   venues:  ${venues.join(', ')}`);
  logger.log(`   races:   R01..R${String(args.expectedRaces).padStart(2, '0')}`);
  logger.log(`   ref:     ${args.sharedRef}`);
  logger.log(`   dry-run: ${args.dryRun ? 'YES' : 'NO'}`);
  logger.log('');

  let filesFound = 0, totalHorses = 0, errors = 0, notFound = 0, wouldWrite = 0, written = 0;

  for (const venue of venues) {
    for (let n = 1; n <= args.expectedRaces; n++) {
      const sharedPath = buildSharedPath(args.date, venue, n);
      const localPath = buildLocalPath(args.date, venue, n);
      const label = `${venue} ${rnnOf(n)}`;
      try {
        // required:false → 404 のみ null（skip）、他は fatal throw
        const json = await c.fetchJson(sharedPath, { ref: args.sharedRef, required: false });
        if (json === null) {
          logger.log(`  ${label}: skip (404 ${sharedPath})`);
          notFound++;
          continue;
        }
        const horses = validateHorseStatsJson(json, venue, args.date, n);
        filesFound++;
        totalHorses += horses;
        if (args.dryRun) {
          logger.log(`  ${label}: OK (dry-run, horses=${horses}, would write ${localPath.replace(projectRoot, '.')})`);
          wouldWrite++;
        } else {
          mkdirFn(dirname(localPath), { recursive: true });
          writeFileFn(localPath, JSON.stringify(json, null, 2), 'utf-8');
          logger.log(`  ${label}: saved (horses=${horses}) -> ${localPath.replace(projectRoot, '.')}`);
          written++;
        }
      } catch (e) {
        logger.log(`  ${label}: ERROR ${e.message}`);
        errors++;
      }
    }
  }

  logger.log('');
  logger.log(`━━━ filesFound=${filesFound} totalHorses=${totalHorses} errors=${errors} notFound=${notFound} wouldWrite=${wouldWrite} written=${written} ━━━`);

  return { filesFound, totalHorses, errors, notFound, wouldWrite, written };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  importHorseStatsNankan({ argv: process.argv.slice(2) })
    .then(({ filesFound, errors }) => {
      if (errors > 0) { console.error('❌ 取得/検証エラーあり'); process.exit(4); }
      if (filesFound === 0) { console.error('❌ 1件も取得なし'); process.exit(5); }
    })
    .catch((e) => {
      if (e instanceof Error && /Usage:|1〜12/.test(e.message)) { console.error(`❌ ${e.message}`); process.exit(2); }
      console.error('FATAL:', e.message ?? String(e));
      process.exit(1);
    });
}
