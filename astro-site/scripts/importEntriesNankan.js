#!/usr/bin/env node
/**
 * importEntriesNankan.js  (PR-F4b)
 *
 * keiba-data-shared の nankan/entries/YYYY/MM/YYYY-MM-DD-{VENUE}.json (南関 出馬表 full venue)
 * を本リポジトリの astro-site/src/data/entries/nankan/YYYY/MM/{file} に転記する。
 *
 * ※ JRA horseHistories / 南関 recentHorseHistories とは別系統
 *   (別 script / 別 workflow / 別 event)。
 *    既存 importRecentHorseHistoriesNankan.js / importHorseHistoriesJra.js は
 *    一切共有・改変しない。
 *
 * import 契約 (keiba-data-shared-admin docs §30 / 1会場=全レース集約契約 §29):
 *   - 取り込み対象は **full venue entries のみ** (totalRaces>1)。
 *   - **R01-only (uma_shosai かつ totalRaces===1) / partial は import しない**。
 *   - record は null が正 (auto/uma_shosai は recordSourced=false)。**0埋めは reject**。
 *     record は表示には接続しない (出馬表由来データ・F5 で条件付き表示)。
 *
 * 取得方式（sharedFetch helper 経由・認証必須）:
 *   - createSharedClient（sharedFetch.mjs）を使用
 *   - token 契約: KEIBA_DATA_SHARED_TOKEN 必須。GITHUB_TOKEN への fallback は禁止。
 *   - token 未設定: HTTP 到達前に TOKEN_MISSING fatal
 *   - GITHUB_TOKEN のみ: HTTP 到達前に TOKEN_MISSING fatal（fetch 呼出し 0）
 *   - 404 のみ未存在扱い（skip）。401/403/429/5xx/network/timeout/malformed → fatal
 *
 * 使い方:
 *   node scripts/importEntriesNankan.js --date 2026-06-10 --venues OOI --dry-run
 *   node scripts/importEntriesNankan.js --date 2026-06-10 --venues OOI,FUN
 *   node scripts/importEntriesNankan.js --date 2026-06-10 --dry-run         (全4場)
 *
 * 終了コード: guard reject/取得失敗 → 4 / 1件も保存/通過なし → 5 / 引数不正 → 2 / OK → 0。
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSharedClient, SharedFetchError, SHARED_FETCH_CODES } from './lib/sharedFetch.mjs';
import { exitDeferredOrFatal } from './lib/sharedCheckerSupport.mjs';

const LABEL = 'importEntriesNankan.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

const DEFAULT_BRANCH = 'main';

// 南関4場: 大井 OOI / 川崎 KAW / 船橋 FUN / 浦和 URA
const ALL_NANKAN_VENUES = ['OOI', 'KAW', 'FUN', 'URA'];
const NANKAN_VENUE_NAME_BY_CODE = { OOI: '大井', KAW: '川崎', FUN: '船橋', URA: '浦和' };

// 自動取得 entries の期待 sourceMeta (admin §30 / EXPECT_SOURCE と一致)。
const EXPECT_SOURCE = {
  sourceType: 'auto',
  sourcePageType: 'uma_shosai',
  recordSourced: false,
  recordCoverage: '0%',
  missingRecordReason: 'uma_shosai_no_record',
};

const RECORD_KEYS = ['total', 'left', 'right', 'venue', 'distance'];
const RECORD_FIELDS = ['wins', 'seconds', 'thirds', 'unplaced'];

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
  return `nankan/entries/${year}/${month}/${date}-${venue}.json`;
}

export function buildLocalPath(date, venue) {
  const [year, month] = date.split('-');
  return join(projectRoot, 'src', 'data', 'entries', 'nankan', year, month, `${date}-${venue}.json`);
}

function countHorses(json) {
  let horses = 0;
  for (const race of json.races || []) {
    horses += Array.isArray(race.horses) ? race.horses.length : 0;
  }
  return horses;
}

// record が「全区分0埋め」かを判定 (admin の 0埋め検出と同条件)。
export function hasZeroFilledRecord(json) {
  for (const race of json.races || []) {
    for (const h of race.horses || []) {
      const rec = h && h.record;
      if (!rec || typeof rec !== 'object') continue; // null は正常 (未取得)
      const allZero = RECORD_KEYS.every((rk) => {
        const seg = rec[rk];
        return seg && typeof seg === 'object'
          && RECORD_FIELDS.every((f) => seg[f] === 0);
      });
      if (allZero) return true;
    }
  }
  return false;
}

/**
 * 南関 entries import guard (admin docs §30.2 / §30.3)。
 * 不適合は throw (= その venue を reject)。R01-only は専用メッセージで skip 扱い。
 * 戻り値: { skip?: 'R01-only', ... }（skip の場合）/ true（import 可）。
 */
export function validateEntriesJson(json, expectedVenueCode, expectedDate) {
  if (!json || typeof json !== 'object') throw new Error('not an object');

  // --- R01-only / totalRaces=1 は import しない (防御的 skip) ---
  const sm = json.sourceMeta || {};
  const races = Array.isArray(json.races) ? json.races : null;
  const totalRaces = json.totalRaces;
  if (
    totalRaces === 1 ||
    (races && races.length === 1) ||
    (sm.sourcePageType === 'uma_shosai' && totalRaces === 1)
  ) {
    return { skip: 'R01-only', reason: `totalRaces=${totalRaces} (R01-only/partial は import 対象外)` };
  }

  // --- 必須契約 ---
  if (json.category !== 'nankan') throw new Error(`unexpected category: ${json.category}`);
  if (json.date !== expectedDate) throw new Error(`date mismatch: expected=${expectedDate}, file=${json.date}`);
  if (json.venueCode !== expectedVenueCode) {
    throw new Error(`venueCode mismatch: expected=${expectedVenueCode}, file=${json.venueCode}`);
  }
  const expectedName = NANKAN_VENUE_NAME_BY_CODE[expectedVenueCode];
  if (expectedName && json.venue !== expectedName) {
    throw new Error(`venue 名不整合: expected=${expectedName}(${expectedVenueCode}), file=${json.venue}`);
  }

  if (!races) throw new Error('races missing or not an array');
  if (totalRaces !== races.length) throw new Error(`totalRaces(${totalRaces}) != races.length(${races.length})`);
  if (!(totalRaces > 1)) throw new Error(`totalRaces=${totalRaces} (full venue=複数レースのみ import)`);
  if (!(races.length > 1)) throw new Error(`races.length=${races.length} (複数レースのみ import)`);

  // sourceMeta.races が存在する場合は races と件数一致
  if (Array.isArray(sm.races) && sm.races.length !== races.length) {
    throw new Error(`sourceMeta.races.length(${sm.races.length}) != races.length(${races.length})`);
  }

  // raceNumber 昇順 & 重複なし & horses 空なし
  let prev = -Infinity;
  for (let i = 0; i < races.length; i++) {
    const r = races[i];
    if (!r || typeof r !== 'object') throw new Error(`race[${i}] がオブジェクトでない`);
    if (typeof r.raceNumber !== 'number') throw new Error(`race[${i}] raceNumber が数値でない`);
    if (!(r.raceNumber > prev)) throw new Error(`raceNumber が昇順/一意でない: ${races.map((x) => x.raceNumber).join(',')}`);
    prev = r.raceNumber;
    if (!Array.isArray(r.horses) || r.horses.length === 0) throw new Error(`race[${i}](R${r.raceNumber}) horses が空`);
  }

  // record 0埋めは reject (null は正常)
  if (hasZeroFilledRecord(json)) throw new Error('record 0埋めを検出 (0埋めは import しない)');

  return true;
}

/**
 * DI-injectable importer（テスト用途・直接実行時はwrapper経由）。
 * @returns {Promise<{savedCount, skippedCount, rejectedCount, failedCount}>}
 */
export async function importEntriesNankan({
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
    throw new Error('Usage: --date YYYY-MM-DD [--venues OOI,FUN,KAW,URA] [--dry-run]');
  }
  const venues = resolveVenues(args.venues);

  // KEIBA_DATA_SHARED_TOKEN のみを渡す（env 内の他 token を client へ漏洩させない）
  const c = client ?? createSharedClient({ env: { [CROSS_REPO_TOKEN_KEY]: token } });

  logger.log('📥 importEntriesNankan (PR-F4b)');
  logger.log(`   date:    ${args.date}`);
  logger.log(`   venues:  ${venues.join(', ')}`);
  logger.log(`   ref:     ${args.sharedRef}`);
  logger.log(`   dry-run: ${args.dryRun ? 'YES' : 'NO'}`);
  logger.log('');

  let savedCount = 0;
  let skippedCount = 0;
  let rejectedCount = 0;
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

      const verdict = validateEntriesJson(json, venue, args.date);
      if (verdict && verdict.skip) {
        logger.log(`skip (${verdict.skip}: ${verdict.reason})`);
        skippedCount++;
        continue;
      }

      const raceCount = json.races.length;
      const horseCount = countHorses(json);
      const recordNull = json.races.every((race) => (race.horses || []).every((h) => h.record == null));

      if (args.dryRun) {
        logger.log(
          `OK (dry-run, totalRaces=${json.totalRaces}, races=${raceCount}, horses=${horseCount}, ` +
          `recordNull=${recordNull}, would write ${localPath.replace(projectRoot, '.')})`
        );
        savedCount++;
        continue;
      }

      mkdirFn(dirname(localPath), { recursive: true });
      writeFileFn(localPath, JSON.stringify(json, null, 2), 'utf-8');
      logger.log(`saved (races=${raceCount}, horses=${horseCount}) -> ${localPath.replace(projectRoot, '.')}`);
      savedCount++;
    } catch (e) {
      // guard 不適合は「reject」、取得/JSON 失敗は「fail」として区別
      const isReject = /mismatch|!=|昇順|空|0埋め|unexpected|not an object|missing/.test(e.message);
      if (isReject) {
        logger.log(`REJECT: ${e.message}`);
        rejectedCount++;
      } else {
        logger.log(`FAIL: ${e.message}`);
        failedCount++;
      }
    }
  }

  logger.log('');
  logger.log(`━━━ サマリ: passed=${savedCount} skipped=${skippedCount} rejected=${rejectedCount} failed=${failedCount} ━━━`);

  return { savedCount, skippedCount, rejectedCount, failedCount };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  importEntriesNankan({ argv: process.argv.slice(2) })
    .then(({ rejectedCount, failedCount, savedCount }) => {
      if (rejectedCount > 0) {
        console.error('❌ import 契約 (§30) に不適合な venue があります (reject)');
        process.exit(4);
      }
      if (failedCount > 0) {
        console.error('❌ 一部 venue で取得失敗');
        process.exit(4);
      }
      if (savedCount === 0) {
        console.error('❌ 1件も import 対象なし (すべて 404/skip?)');
        process.exit(5);
      }
    })
    .catch((e) => {
      exitDeferredOrFatal(e, { label: LABEL });
    });
}
