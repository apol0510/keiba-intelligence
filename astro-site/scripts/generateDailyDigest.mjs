#!/usr/bin/env node
/**
 * generateDailyDigest.mjs — 開催日ダイジェスト（メルマガ素材）を生成して保存する
 *
 * 正本: docs/RENEWAL_2026_08.md §8.3 K-3
 *
 * 使い方:
 *   node scripts/generateDailyDigest.mjs [nankan|jra|both] [--dry-run]
 *
 * 出力:
 *   src/data/digest/{category}/YYYY/MM/YYYY-MM-DD.json
 *
 * 🔴 この生成物に買い目（馬番組み合わせ）を含めない。
 *    保存前に検証し、含まれていたら **書き込まずに終了する**（fail-closed）。
 *
 * 🔴 ネットワーク・外部 API を使わない。取込済みの JSON だけを読む。
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

import {
  loadNankanRaceDay, loadJraRaceDay, racesOf, racesResolverFor, featuresResolverForRace,
} from '../src/lib/prediction/loadRaceDay.js';
import { buildDailyDigest, renderDigestText } from '../src/lib/digest/buildDailyDigest.js';

const CWD = process.cwd();

/** 買い目らしき馬番の並び（"3-5.7.8" 等）。 */
const BET_PATTERN = /\d+\s*-\s*\d+(\s*[.．]\s*\d+)+/;

function assertNoBettingLines(digest) {
  const json = JSON.stringify(digest);
  if (BET_PATTERN.test(json)) {
    throw new Error('ダイジェストに買い目らしき文字列が含まれています（保存を中止しました）');
  }
  for (const key of ['bettingLines', 'hitLines', 'umatan']) {
    if (json.includes(`"${key}"`)) {
      throw new Error(`ダイジェストに禁止キー ${key} が含まれています（保存を中止しました）`);
    }
  }
}

function buildFor(category) {
  const day = category === 'jra' ? loadJraRaceDay(CWD) : loadNankanRaceDay(CWD);
  if (day.error && !day.venues.length) {
    return { day, digest: null, skipped: day.error };
  }

  const digest = buildDailyDigest(day, {
    racesOf,
    resolveRaces: racesResolverFor(category),
    resolveFeaturesFor: (race, venue) => featuresResolverForRace(race, venue.featureScores),
  });

  return { day, digest, skipped: null };
}

function outPathFor(category, date) {
  const [y, m] = date.split('-');
  return join(CWD, 'src', 'data', 'digest', category, y, m, `${date}.json`);
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const target = args.find((a) => !a.startsWith('--')) || 'both';
  const categories = target === 'both' ? ['nankan', 'jra'] : [target];

  let wrote = 0;

  for (const category of categories) {
    const { day, digest, skipped } = buildFor(category);

    if (skipped || !digest || !digest.date) {
      console.log(`⏭️  ${category}: スキップ（${skipped || 'データなし'}）`);
      continue;
    }

    assertNoBettingLines(digest);

    console.log(`\n=== ${category} ${digest.date} (${digest.venues.join('・')}) ===`);
    console.log(`   メインレース: ${digest.mainRaces.length}件 / 注目馬: ${digest.spotlight.length}頭 / 穴馬: ${digest.longshots.length}頭`);

    if (dryRun) {
      console.log('--- メール本文プレビュー ---');
      console.log(renderDigestText(digest));
      continue;
    }

    const out = outPathFor(category, digest.date);
    if (!existsSync(dirname(out))) mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(digest, null, 2)}\n`, 'utf-8');
    console.log(`   ✅ 保存: ${out.replace(`${CWD}/`, '')}`);
    wrote += 1;
  }

  if (!dryRun) console.log(`\n完了: ${wrote}件を保存しました`);
}

main();
