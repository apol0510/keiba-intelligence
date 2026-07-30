/**
 * pruneFunctionBundleData.mjs の回帰テスト。
 *
 * 固定する契約:
 *   - 日付データは「そのデータ種の最新日」基準の直近 N 日だけ残す
 *   - 最新日は必ず残る（import が滞って全ファイルが古くても残る）
 *   - predictions / archiveResults*（keep-all・data 直下）は削除しない
 *   - repo の src/data や bundle 外のパスは絶対に削除しない
 *   - 日付を持たないファイルは残す
 *   - dry-run は 1 件も削除しない / 2 回目の実行は no-op（冪等）
 *   - 対象 dir 不在・上限超過は fail-closed（exit≠0）
 *
 * ネットワーク非依存・一時ディレクトリのみを操作する。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import {
  planPrune,
  applyPlan,
  extractDate,
  listFiles,
  main,
  resolveFunctionDir,
  DATASETS,
  MIN_KEEP_DATES,
  DEFAULT_RETENTION_DAYS,
  DEFAULT_FUNCTION_DIR,
} from './pruneFunctionBundleData.mjs';

function makeFile(root, rel, size = 1024) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, 'x'.repeat(size));
  return p;
}

/** 典型的な bundle を組み立てる（最新日 = 2026-07-31） */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ki-prune-'));
  const dir = join(root, '.netlify/v1/functions/ssr');
  mkdirSync(dir, { recursive: true });

  // 最新日（残る）
  for (let r = 1; r <= 12; r++) {
    makeFile(dir, `src/data/horseStats/nankan/2026/07/2026-07-31-KAW-R${String(r).padStart(2, '0')}.json`);
  }
  // 14日以内（残る）
  makeFile(dir, 'src/data/horseStats/nankan/2026/07/2026-07-20-OOI-R01.json');
  // 14日より古い（消える）
  makeFile(dir, 'src/data/horseStats/nankan/2026/06/2026-06-16-KAW-R01.json');
  makeFile(dir, 'src/data/horseStats/nankan/2026/06/2026-06-17-KAW-R01.json');

  // MIN_KEEP_DATES の影響を受けないよう、各データ種に最新 3 日分＋古い日を置く
  makeFile(dir, 'src/data/featureScores/nankan/2026/07/2026-07-30-KAW.json');
  makeFile(dir, 'src/data/featureScores/nankan/2026/07/2026-07-29-KAW.json');
  makeFile(dir, 'src/data/featureScores/nankan/2026/07/2026-07-28-KAW.json');
  makeFile(dir, 'src/data/featureScores/nankan/2026/05/2026-05-10-OOI.json'); // 消える
  makeFile(dir, 'src/data/horseHistories/jra/2026/07/2026-07-27-TOK.json');
  makeFile(dir, 'src/data/horseHistories/jra/2026/07/2026-07-26-TOK.json');
  makeFile(dir, 'src/data/horseHistories/jra/2026/07/2026-07-25-TOK.json');
  makeFile(dir, 'src/data/horseHistories/jra/2026/04/2026-04-12-FKS.json'); // 消える

  // keep-all
  makeFile(dir, 'src/data/predictions/2026-01-14-ooi.json');
  makeFile(dir, 'src/data/predictions/2026-07-31-kawasaki.json');
  makeFile(dir, 'src/data/predictions/jra/2026/01/2026-01-05.json');
  makeFile(dir, 'src/data/archiveResults.json');
  makeFile(dir, 'src/data/archiveResultsJra.json');

  // 日付を持たないファイル（残る）
  makeFile(dir, 'src/data/horseStats/nankan/index.json');

  // bundle 外（絶対に触られない）
  makeFile(root, 'astro-site/src/data/horseStats/nankan/2026/06/2026-06-16-KAW-R01.json');

  return { root, dir };
}

test('最新日のファイルは全て残る', () => {
  const { dir } = fixture();
  const plan = planPrune({ functionDir: dir, days: 14 });
  assert.equal(plan.ok, true, plan.errors.join(';'));
  applyPlan(plan);
  for (let r = 1; r <= 12; r++) {
    const p = join(dir, `src/data/horseStats/nankan/2026/07/2026-07-31-KAW-R${String(r).padStart(2, '0')}.json`);
    assert.ok(existsSync(p), `最新日が消えた: ${p}`);
  }
});

test('window 外の過去日だけが消える', () => {
  const { dir } = fixture();
  applyPlan(planPrune({ functionDir: dir, days: 14 }));
  assert.ok(existsSync(join(dir, 'src/data/horseStats/nankan/2026/07/2026-07-20-OOI-R01.json')), '14日以内が消えた');
  assert.ok(!existsSync(join(dir, 'src/data/horseStats/nankan/2026/06/2026-06-16-KAW-R01.json')), '古い日付が残った');
  assert.ok(!existsSync(join(dir, 'src/data/featureScores/nankan/2026/05/2026-05-10-OOI.json')));
  assert.ok(!existsSync(join(dir, 'src/data/horseHistories/jra/2026/04/2026-04-12-FKS.json')));
});

test('predictions と archiveResults は年代を問わず残る', () => {
  const { dir } = fixture();
  applyPlan(planPrune({ functionDir: dir, days: 1 }));
  assert.ok(existsSync(join(dir, 'src/data/predictions/2026-01-14-ooi.json')), '過去日の予想が消えた（/prediction/[slug] が 404 になる）');
  assert.ok(existsSync(join(dir, 'src/data/predictions/jra/2026/01/2026-01-05.json')));
  assert.ok(existsSync(join(dir, 'src/data/archiveResults.json')));
  assert.ok(existsSync(join(dir, 'src/data/archiveResultsJra.json')));
});

test('window は「そのデータ種の最新日」基準（import が滞っても最新は残る）', () => {
  const { dir } = fixture();
  // entries は 6月で止まっている想定（最新 3 日 + それより古い 1 日）
  makeFile(dir, 'src/data/entries/nankan/2026/06/2026-06-22-URA.json');
  makeFile(dir, 'src/data/entries/nankan/2026/06/2026-06-21-URA.json');
  makeFile(dir, 'src/data/entries/nankan/2026/06/2026-06-20-URA.json');
  makeFile(dir, 'src/data/entries/nankan/2026/03/2026-03-01-OOI.json');
  applyPlan(planPrune({ functionDir: dir, days: 14 }));
  assert.ok(existsSync(join(dir, 'src/data/entries/nankan/2026/06/2026-06-22-URA.json')), '滞留データ種の最新が消えた');
  assert.ok(!existsSync(join(dir, 'src/data/entries/nankan/2026/03/2026-03-01-OOI.json')));
});

test(`days=0 でも最新 ${MIN_KEEP_DATES} 日分は残る`, () => {
  const { dir } = fixture();
  makeFile(dir, 'src/data/horseStats/nankan/2026/07/2026-07-30-KAW-R01.json');
  makeFile(dir, 'src/data/horseStats/nankan/2026/07/2026-07-29-KAW-R01.json');
  applyPlan(planPrune({ functionDir: dir, days: 0 }));
  assert.ok(existsSync(join(dir, 'src/data/horseStats/nankan/2026/07/2026-07-31-KAW-R01.json')));
  assert.ok(existsSync(join(dir, 'src/data/horseStats/nankan/2026/07/2026-07-30-KAW-R01.json')));
  assert.ok(existsSync(join(dir, 'src/data/horseStats/nankan/2026/07/2026-07-29-KAW-R01.json')));
  assert.ok(!existsSync(join(dir, 'src/data/horseStats/nankan/2026/07/2026-07-20-OOI-R01.json')));
});

test('日付を持たないファイルは残る', () => {
  const { dir } = fixture();
  applyPlan(planPrune({ functionDir: dir, days: 1 }));
  assert.ok(existsSync(join(dir, 'src/data/horseStats/nankan/index.json')));
});

test('bundle 外（repo の src/data）は削除対象に入らない', () => {
  const { root, dir } = fixture();
  const plan = planPrune({ functionDir: dir, days: 1 });
  assert.equal(plan.ok, true);
  for (const p of plan.remove) assert.ok(p.startsWith(dir), `bundle 外が対象に入った: ${p}`);
  applyPlan(plan);
  assert.ok(existsSync(join(root, 'astro-site/src/data/horseStats/nankan/2026/06/2026-06-16-KAW-R01.json')), 'repo データが消された');
});

test('symlink は列挙も削除もしない', () => {
  const { root, dir } = fixture();
  const outside = makeFile(root, 'outside/2026-01-01-KAW-R01.json');
  symlinkSync(outside, join(dir, 'src/data/horseStats/nankan/2026/06/link-2026-01-01-KAW-R01.json'));
  const plan = planPrune({ functionDir: dir, days: 1 });
  assert.equal(plan.ok, true, plan.errors.join(';'));
  assert.ok(!plan.remove.some((p) => p.includes('link-2026-01-01')), 'symlink が削除対象に入った');
  applyPlan(plan);
  assert.ok(existsSync(outside), 'symlink 先の実体が消えた');
});

test('dry-run は 1 件も削除しない / 2 回目は no-op（冪等）', () => {
  const { dir } = fixture();
  const before = listFiles(dir).length;
  const plan1 = planPrune({ functionDir: dir, days: 14 });
  applyPlan(plan1, { dryRun: true });
  assert.equal(listFiles(dir).length, before, 'dry-run で削除された');

  applyPlan(plan1);
  const after1 = listFiles(dir).length;
  assert.ok(after1 < before);
  const plan2 = planPrune({ functionDir: dir, days: 14 });
  assert.equal(plan2.remove.length, 0, '2 回目に削除対象が残っている');
  applyPlan(plan2);
  assert.equal(listFiles(dir).length, after1);
});

test('対象 dir が無ければ fail-closed', () => {
  const plan = planPrune({ functionDir: join(tmpdir(), 'ki-prune-does-not-exist-xyz'), days: 14 });
  assert.equal(plan.ok, false);
  assert.match(plan.errors.join(';'), /function dir not found/);
  assert.throws(() => applyPlan(plan), /refusing to apply/);
  const code = main([`--dir=${join(tmpdir(), 'ki-prune-does-not-exist-xyz')}`]);
  assert.equal(code, 1, 'dir 不在で exit 0 を返した');
});

test('上限警告線を超えたら exit 1（deploy 400 の前に止める）', () => {
  const { dir } = fixture();
  const code = main([`--dir=${dir}`, '--days=14', '--max-bytes=100']);
  assert.equal(code, 1);
});

test('正常系は exit 0 を返し、bundle が縮む', () => {
  const { dir } = fixture();
  const before = listFiles(dir).length;
  const code = main([`--dir=${dir}`, '--days=14']);
  assert.equal(code, 0);
  assert.ok(listFiles(dir).length < before);
});

test('本番の保持方針が意図から外れていない（回帰防止）', () => {
  const names = DATASETS.map((d) => `${d.name}:${d.policy}`).sort();
  assert.deepEqual(names, [
    'entries:window',
    'featureScores:window',
    'horseHistories:window',
    'horseStats:window',
    'predictions:keep-all',
    'recentHorseHistories:window',
  ]);
  assert.equal(DEFAULT_RETENTION_DAYS, 14);
  assert.ok(MIN_KEEP_DATES >= 3);
});

test('出力先の探索: 既定パス → 候補ディレクトリ → 見つからなければ null', () => {
  const { root, dir } = fixture();
  // 既定パス（.netlify/v1/functions/ssr）が存在する
  assert.equal(resolveFunctionDir(root, undefined), dir);
  assert.equal(DEFAULT_FUNCTION_DIR, '.netlify/v1/functions/ssr');

  // adapter が別名で出した場合でも src/data を持つディレクトリを見つける
  const alt = mkdtempSync(join(tmpdir(), 'ki-prune-alt-'));
  makeFile(alt, '.netlify/v1/functions/entry/src/data/predictions/2026-07-31-kawasaki.json');
  assert.equal(resolveFunctionDir(alt, undefined), join(alt, '.netlify/v1/functions/entry'));

  // 何も無ければ null（呼び出し側で fail-closed）
  const empty = mkdtempSync(join(tmpdir(), 'ki-prune-empty-'));
  assert.equal(resolveFunctionDir(empty, undefined), null);
  assert.equal(main([], empty), 1, 'ビルド出力が無いのに exit 0 を返した');

  // 明示指定は存在チェックのみ
  assert.equal(resolveFunctionDir(root, '.netlify/v1/functions/ssr'), dir);
  assert.equal(resolveFunctionDir(root, 'no/such/dir'), null);
});

test('extractDate はファイル名の日付だけを見る', () => {
  assert.equal(extractDate('/a/2026/07/2026-07-31-KAW-R01.json'), '2026-07-31');
  assert.equal(extractDate('/2026-07-31/index.json'), null);
  assert.equal(extractDate('/a/archiveResults.json'), null);
});

test.after(() => {
  // 一時ディレクトリの後片付け（失敗しても致命ではない）
  try {
    for (const d of []) rmSync(d, { recursive: true, force: true });
  } catch {}
});
