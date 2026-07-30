#!/usr/bin/env node
/**
 * SSR Function bundle（.netlify/v1/functions/ssr）から
 * 「本番 SSR の実行時に読まれない過去日データ」だけを落とすビルド後処理。
 *
 * ■ なぜ必要か
 *   2026-07-30 の本番 deploy が
 *     `PUT /deploys/{id}/functions/{name}` → 400
 *     "Failed to create function: invalid parameter for function creation:
 *      Invalid AWS Lambda parameters used in this request."
 *   で失敗した。ビルド自体は成功しており（ローカル再現 exit 0）、
 *   原因は SSR Function bundle が AWS Lambda の unzipped サイズ上限に達したこと。
 *   実測 254.8MB（890ファイル）で、内訳は
 *     horseHistories 75.3 / predictions 69.9 / horseStats 53.3 /
 *     featureScores 44.5 / recentHorseHistories 4.6 / entries 3.1 / archiveResults* 4.2 MB。
 *   日次 import のたびに増えるため、放置すると恒久的に deploy が失敗し続ける。
 *
 * ■ bundle へ入る経路は2つある（2026-07-30 実測）
 *   1. astro.config.mjs の adapter `includeFiles`
 *      → horseHistories / horseStats / recentHorseHistories / entries（計 136.3MB）
 *   2. @astrojs/netlify の依存トレース（`join(process.cwd(), 'src', 'data', …)` の静的解析）
 *      → predictions / featureScores / archiveResults*（計 118.5MB）
 *   `includeFiles: []` にしたビルドで 118.5MB が残ることを実測して切り分けた。
 *   2 は includeFiles では制御できないため、**ビルド後に bundle を直接刈る**本スクリプトで一元管理する。
 *
 * ■ 実行時に本当に必要な範囲（SSR ページの読み取りを実測して確定）
 *   - prediction/nankan/index.astro … predictions を readdir → **最新日のみ**読み、
 *     その日付の recentHorseHistories / entries / horseStats / featureScores を注入
 *   - prediction/jra/index.astro    … predictions/jra を readdir → **最新日のみ**読み、
 *     その日付の horseHistories / featureScores を注入
 *   - prediction/[slug].astro       … `predictions/{slug}.json` を**任意の過去日**で配信（他データは読まない）
 *   - archive/*・venues/*           … archiveResults*.json のみ
 *   - free-prediction/** ・ results/** は prerender=true。**ビルド時に repo の src/data を読む**ので
 *     本スクリプト（bundle のみ操作）の影響を受けない。
 *
 *   よって predictions と archiveResults* は全期間保持し、
 *   日付キーのデータ5種のみ「直近 N 日」に絞る。実行時の必要範囲は最新1日なので N=14 は 14 倍の安全余裕。
 *
 * ■ 安全条件
 *   - repo の `src/data/**` は**一切削除しない**（操作対象は bundle 配下のみ・realpath で境界検査）
 *   - predictions / archiveResults* は削除しない（過去日ページが 404 になるため）
 *   - 各データ種の **最新日は必ず残す**（window は「そのデータ種の最新日」基準。import が滞っても最新は残る）
 *   - 日付を持たないファイルは残す
 *   - 対象 dir 不在・最新日消失・上限超過は **fail-closed（exit 1）**。黙って続けない
 *
 * Usage:
 *   node scripts/pruneFunctionBundleData.mjs [--dir=<path>] [--days=14]
 *                                            [--max-bytes=220000000] [--dry-run] [--json]
 */
import { existsSync, lstatSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

export const DEFAULT_FUNCTION_DIR = '.netlify/v1/functions/ssr';
export const DEFAULT_RETENTION_DAYS = 14;
/** unzipped 250MB の Lambda 上限に対する早期警告線（依存トレース分の余裕を含む） */
export const DEFAULT_MAX_BYTES = 220_000_000;
/** window の外でも必ず残す「新しい方から数えた日付数」 */
export const MIN_KEEP_DATES = 3;

/** @type {{name:string, rel:string, policy:'window'|'keep-all'}[]} */
export const DATASETS = [
  { name: 'horseStats', rel: 'src/data/horseStats', policy: 'window' },
  { name: 'horseHistories', rel: 'src/data/horseHistories', policy: 'window' },
  { name: 'featureScores', rel: 'src/data/featureScores', policy: 'window' },
  { name: 'entries', rel: 'src/data/entries', policy: 'window' },
  { name: 'recentHorseHistories', rel: 'src/data/recentHorseHistories', policy: 'window' },
  // predictions は /prediction/[slug] が任意の過去日を配信するため全期間保持する
  { name: 'predictions', rel: 'src/data/predictions', policy: 'keep-all' },
];

const DATE_RE = /(\d{4}-\d{2}-\d{2})/;
const DAY_MS = 86_400_000;

/** adapter 出力先の候補（バージョン差で変わりうるため既定以外も探す） */
const FUNCTION_DIR_CANDIDATES = ['.netlify/v1/functions', '.netlify/functions-internal'];

/**
 * SSR Function の出力ディレクトリを決める。
 * 既定パスが無い場合は候補配下から「src/data を含むディレクトリ」を探す。
 * 見つからなければ null（呼び出し側で fail-closed）。
 */
export function resolveFunctionDir(cwd, explicit) {
  if (explicit) {
    const p = resolve(cwd, explicit);
    return existsSync(p) ? p : null;
  }
  const preferred = resolve(cwd, DEFAULT_FUNCTION_DIR);
  if (existsSync(join(preferred, 'src', 'data'))) return preferred;
  for (const base of FUNCTION_DIR_CANDIDATES) {
    const baseDir = resolve(cwd, base);
    if (!existsSync(baseDir)) continue;
    let entries;
    try {
      entries = readdirSync(baseDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const cand = join(baseDir, e.name);
      if (existsSync(join(cand, 'src', 'data'))) return cand;
    }
  }
  return null;
}

/** ファイル名から YYYY-MM-DD を取り出す。無ければ null */
export function extractDate(filePath) {
  const base = filePath.slice(filePath.lastIndexOf('/') + 1);
  const m = base.match(DATE_RE);
  if (!m) return null;
  const t = Date.parse(`${m[1]}T00:00:00Z`);
  return Number.isNaN(t) ? null : m[1];
}

function toEpoch(date) {
  return Date.parse(`${date}T00:00:00Z`);
}

/** dir 配下の通常ファイルを再帰列挙（symlink は辿らない） */
export function listFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(cur, e.name);
      if (e.isSymbolicLink()) continue; // 辿らない・触らない
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) out.push(p);
    }
  }
  return out;
}

function sizeOf(p) {
  try {
    return statSync(p).size;
  } catch {
    return 0;
  }
}

/**
 * 削除計画を作る（副作用なし）。
 * @returns {{ok:boolean, errors:string[], datasets:object[], remove:string[],
 *            bytesBefore:number, bytesAfter:number, filesBefore:number, filesAfter:number}}
 */
export function planPrune({ functionDir, days = DEFAULT_RETENTION_DAYS, datasets = DATASETS }) {
  const errors = [];
  const result = { ok: false, errors, datasets: [], remove: [], bytesBefore: 0, bytesAfter: 0, filesBefore: 0, filesAfter: 0 };

  if (!existsSync(functionDir)) {
    errors.push(`function dir not found: ${functionDir}`);
    return result;
  }
  if (!Number.isInteger(days) || days < 0) {
    errors.push(`invalid --days: ${days}`);
    return result;
  }

  const allFiles = listFiles(functionDir);
  result.filesBefore = allFiles.length;
  result.bytesBefore = allFiles.reduce((s, f) => s + sizeOf(f), 0);

  const remove = [];

  for (const ds of datasets) {
    const dsDir = join(functionDir, ds.rel);
    const files = listFiles(dsDir);
    const entry = {
      name: ds.name,
      policy: ds.policy,
      filesBefore: files.length,
      bytesBefore: files.reduce((s, f) => s + sizeOf(f), 0),
      newestDate: null,
      cutoffDate: null,
      filesRemoved: 0,
      bytesRemoved: 0,
      undatedKept: 0,
    };

    if (files.length === 0 || ds.policy === 'keep-all') {
      entry.filesKept = files.length;
      entry.bytesKept = entry.bytesBefore;
      result.datasets.push(entry);
      continue;
    }

    const dated = files.map((f) => ({ f, d: extractDate(f) })).filter((x) => x.d !== null);
    entry.undatedKept = files.length - dated.length;

    if (dated.length === 0) {
      // 日付が読めないデータ種は触らない（fail-safe）
      entry.filesKept = files.length;
      entry.bytesKept = entry.bytesBefore;
      result.datasets.push(entry);
      continue;
    }

    const uniqueDates = [...new Set(dated.map((x) => x.d))].sort().reverse();
    const newest = uniqueDates[0];
    const cutoffEpoch = toEpoch(newest) - days * DAY_MS;
    // window の外でも「新しい方から MIN_KEEP_DATES 日分」は必ず残す
    const alwaysKeep = new Set(uniqueDates.slice(0, MIN_KEEP_DATES));
    entry.newestDate = newest;
    entry.cutoffDate = new Date(cutoffEpoch).toISOString().slice(0, 10);

    for (const { f, d } of dated) {
      if (alwaysKeep.has(d)) continue;
      if (toEpoch(d) >= cutoffEpoch) continue;
      remove.push(f);
      entry.filesRemoved += 1;
      entry.bytesRemoved += sizeOf(f);
    }

    // fail-closed: 最新日のファイルは 1 件も消さない
    const newestFiles = dated.filter((x) => x.d === newest).map((x) => x.f);
    const removeSet = new Set(remove);
    const lost = newestFiles.filter((f) => removeSet.has(f));
    if (lost.length > 0) {
      errors.push(`${ds.name}: would remove newest-date files (${newest}) — aborting`);
    }

    entry.filesKept = entry.filesBefore - entry.filesRemoved;
    entry.bytesKept = entry.bytesBefore - entry.bytesRemoved;
    result.datasets.push(entry);
  }

  // 境界検査: 対象 dir の外を絶対に消さない
  const rootReal = realpathSync(functionDir);
  for (const f of remove) {
    let real;
    try {
      real = realpathSync(f);
    } catch {
      errors.push(`cannot resolve path: ${f}`);
      continue;
    }
    if (!(real === rootReal || real.startsWith(rootReal + sep))) {
      errors.push(`refusing to delete outside function dir: ${f}`);
    }
    try {
      if (lstatSync(f).isSymbolicLink()) errors.push(`refusing to delete symlink: ${f}`);
    } catch {
      errors.push(`cannot stat: ${f}`);
    }
  }

  result.remove = remove;
  const removedBytes = remove.reduce((s, f) => s + sizeOf(f), 0);
  result.filesAfter = result.filesBefore - remove.length;
  result.bytesAfter = result.bytesBefore - removedBytes;
  result.ok = errors.length === 0;
  return result;
}

/** 計画を適用する（dryRun 時は削除しない） */
export function applyPlan(plan, { dryRun = false } = {}) {
  if (!plan.ok) throw new Error(`refusing to apply a failed plan: ${plan.errors.join('; ')}`);
  if (dryRun) return { deleted: 0 };
  let deleted = 0;
  for (const f of plan.remove) {
    rmSync(f, { force: true });
    deleted += 1;
  }
  return { deleted };
}

function parseArgs(argv) {
  const opts = {
    dir: null, // 未指定なら resolveFunctionDir が探す
    days: DEFAULT_RETENTION_DAYS,
    maxBytes: DEFAULT_MAX_BYTES,
    dryRun: false,
    json: false,
  };
  for (const a of argv) {
    if (a.startsWith('--dir=')) opts.dir = a.slice(6);
    else if (a.startsWith('--days=')) opts.days = Number(a.slice(7));
    else if (a.startsWith('--max-bytes=')) opts.maxBytes = Number(a.slice(12));
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--json') opts.json = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return opts;
}

const mb = (b) => (b / 1e6).toFixed(1);

export function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const opts = parseArgs(argv);
  const functionDir = resolveFunctionDir(cwd, opts.dir);
  if (!functionDir) {
    console.error(
      `❌ [prune] fail-closed: SSR Function の出力ディレクトリが見つかりません（既定: ${DEFAULT_FUNCTION_DIR}）。\n` +
        '   astro build の後に実行してください。adapter の出力先が変わった場合は --dir= で指定します。\n' +
        '   ここで止めないと、過去日データを積んだままの bundle が deploy されサイズ上限で 400 になります。'
    );
    return 1;
  }

  const plan = planPrune({ functionDir, days: opts.days });
  if (!plan.ok) {
    console.error('❌ [prune] fail-closed:');
    for (const e of plan.errors) console.error(`   - ${e}`);
    console.error('   SSR Function bundle を変更していません。');
    return 1;
  }

  applyPlan(plan, { dryRun: opts.dryRun });

  const after = listFiles(functionDir);
  const bytesAfter = after.reduce((s, f) => s + sizeOf(f), 0);

  if (opts.json) {
    console.log(JSON.stringify({ ...plan, remove: plan.remove.length, bytesAfterMeasured: bytesAfter, dryRun: opts.dryRun }, null, 2));
  } else {
    console.log(`🧹 [prune] SSR Function bundle: ${functionDir}${opts.dryRun ? '  (dry-run)' : ''}`);
    console.log(`   保持方針: 日付データは直近 ${opts.days} 日（各データ種の最新日基準・最新 ${MIN_KEEP_DATES} 日は無条件保持）/ predictions・archiveResults は全期間`);
    for (const d of plan.datasets) {
      const range = d.newestDate ? `newest=${d.newestDate} cutoff=${d.cutoffDate}` : d.policy;
      console.log(
        `   - ${d.name.padEnd(21)} ${String(d.filesBefore).padStart(4)}件 ${mb(d.bytesBefore).padStart(6)}MB` +
          ` → ${String(d.filesKept).padStart(4)}件 ${mb(d.bytesKept).padStart(6)}MB  (${range})`
      );
    }
    console.log(`   合計: ${plan.filesBefore}件 ${mb(plan.bytesBefore)}MB → ${after.length}件 ${mb(bytesAfter)}MB`);
  }

  if (!opts.dryRun && bytesAfter > opts.maxBytes) {
    console.error(
      `❌ [prune] bundle が上限警告線を超えています: ${mb(bytesAfter)}MB > ${mb(opts.maxBytes)}MB\n` +
        '   AWS Lambda の unzipped 250MB 上限に到達すると deploy が 400 で失敗します。\n' +
        '   --days を短くするか、実行時に不要なデータの同梱をやめてください。'
    );
    return 1;
  }
  return 0;
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('pruneFunctionBundleData.mjs');
if (invokedDirectly) {
  process.exit(main());
}
