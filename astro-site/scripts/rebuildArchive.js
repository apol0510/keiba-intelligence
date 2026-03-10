#!/usr/bin/env node

/**
 * rebuildArchive.js
 *
 * src/data/predictions/ と src/data/results/ から
 * archiveResults.json を完全再生成する（idempotent）
 *
 * 使い方:
 *   node scripts/rebuildArchive.js
 *   node scripts/rebuildArchive.js --dry-run  # テスト実行
 *
 * 目的:
 *   Import Results が1回失敗しても次回実行で archive を自動復旧
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ESモジュールで __dirname を取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// プロジェクトルート
const projectRoot = join(__dirname, '..');

// コマンドライン引数
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');

/**
 * predictions ファイルを全て取得
 */
function getAllPredictionFiles() {
  const predictionsDir = join(projectRoot, 'src', 'data', 'predictions');
  if (!existsSync(predictionsDir)) {
    return [];
  }

  const files = readdirSync(predictionsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => ({
      path: join(predictionsDir, f),
      filename: f,
      date: f.match(/^(\d{4}-\d{2}-\d{2})/)?.[1]
    }))
    .filter(f => f.date);

  return files;
}

/**
 * results ファイルを全て取得
 */
function getAllResultFiles() {
  const resultsDir = join(projectRoot, 'src', 'data', 'results');
  if (!existsSync(resultsDir)) {
    return [];
  }

  const files = readdirSync(resultsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => ({
      path: join(resultsDir, f),
      filename: f,
      date: f.match(/^(\d{4}-\d{2}-\d{2})/)?.[1]
    }))
    .filter(f => f.date);

  return files;
}

/**
 * 日付ごとに prediction と results をマージ
 */
function groupByDate(predictionFiles, resultFiles) {
  const dateMap = new Map();

  // predictions
  predictionFiles.forEach(file => {
    if (!dateMap.has(file.date)) {
      dateMap.set(file.date, { predictions: [], results: [] });
    }
    dateMap.get(file.date).predictions.push(file);
  });

  // results
  resultFiles.forEach(file => {
    if (!dateMap.has(file.date)) {
      dateMap.set(file.date, { predictions: [], results: [] });
    }
    dateMap.get(file.date).results.push(file);
  });

  return dateMap;
}

/**
 * 的中判定（importResults.js の verifyResults() 相当）
 */
function verifyResults(prediction, results) {
  const raceResults = [];

  for (const predRace of prediction.races) {
    const resultRace = results.races.find(r => r.raceNumber === predRace.raceNumber);
    if (!resultRace || !resultRace.results || resultRace.results.length === 0) {
      continue;
    }

    const winner = resultRace.results.find(h => h.rank === 1);
    const second = resultRace.results.find(h => h.rank === 2);
    const third = resultRace.results.find(h => h.rank === 3);

    if (!winner || !second || !third) {
      continue;
    }

    // 本命的中判定
    const honmei = predRace.horses.find(h => h.mark === '◎' || h.role === '本命');
    const honmeiHit = honmei && honmei.number === winner.number;

    // 馬単的中判定
    const umatanHit = predRace.betLines?.umatan?.some(line => {
      const [first, seconds] = line.split('-');
      const secondNumbers = seconds.split('.');
      return first === String(winner.number) && secondNumbers.includes(String(second.number));
    }) || false;

    // 3連複的中判定
    const sanrenpukuHit = predRace.betLines?.sanrenpuku?.some(line => {
      const numbers = line.split('.').map(Number);
      return numbers.includes(winner.number) &&
             numbers.includes(second.number) &&
             numbers.includes(third.number);
    }) || false;

    raceResults.push({
      raceNumber: predRace.raceNumber,
      raceName: resultRace.raceName || `第${predRace.raceNumber}レース`,
      honmeiHit,
      umatanHit,
      sanrenpukuHit,
      winner: winner.number,
      second: second.number,
      third: third.number,
      payouts: resultRace.payouts || {}
    });
  }

  return raceResults;
}

/**
 * 統計計算（importResults.js の saveArchive() 相当）
 */
function calculateStats(date, venue, raceResults, venues = []) {
  let hitRaces = 0;
  let totalRaces = raceResults.length;
  let umatanHitRaces = 0;
  let sanrenpukuHitRaces = 0;

  let betAmount = 0;
  let totalPayout = 0;

  raceResults.forEach(race => {
    if (race.honmeiHit) hitRaces++;
    if (race.umatanHit) umatanHitRaces++;
    if (race.sanrenpukuHit) sanrenpukuHitRaces++;

    // 買い目: 馬単6点 + 3連複4点 = 10点/レース
    const raceBetAmount = 10 * 100; // 100円/点
    betAmount += raceBetAmount;

    // 払戻計算
    if (race.umatanHit && race.payouts?.umatan) {
      totalPayout += race.payouts.umatan.payout;
    }
    if (race.sanrenpukuHit && race.payouts?.sanrenpuku) {
      totalPayout += race.payouts.sanrenpuku.payout;
    }
  });

  const hitRate = totalRaces > 0 ? Math.round((hitRaces / totalRaces) * 100) : 0;
  const umatanHitRate = totalRaces > 0 ? Math.round((umatanHitRaces / totalRaces) * 100) : 0;
  const sanrenpukuHitRate = totalRaces > 0 ? Math.round((sanrenpukuHitRaces / totalRaces) * 100) : 0;
  const returnRate = betAmount > 0 ? Math.round((totalPayout / betAmount) * 100) : 0;
  const betPointsPerRace = 10;

  return {
    date,
    venue,
    venues: venues.length > 0 ? venues : [venue],
    hitRaces,
    totalRaces,
    hitRate,
    umatanHitRaces,
    umatanHitRate,
    sanrenpukuHitRaces,
    sanrenpukuHitRate,
    betPointsPerRace,
    betAmount,
    totalPayout,
    returnRate,
    raceResults
  };
}

/**
 * Archive を完全再生成
 */
async function rebuildArchive() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📦 Archive Rebuild Starting...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (isDryRun) {
    console.log('🧪 Dry-run mode: No files will be written\n');
  }

  // 1. 全ファイル取得
  console.log('📂 Step 1/4: Scanning files...');
  const predictionFiles = getAllPredictionFiles();
  const resultFiles = getAllResultFiles();

  console.log(`   Found ${predictionFiles.length} prediction files`);
  console.log(`   Found ${resultFiles.length} result files\n`);

  // 2. 日付ごとにグループ化
  console.log('🔄 Step 2/4: Grouping by date...');
  const dateMap = groupByDate(predictionFiles, resultFiles);
  console.log(`   Grouped into ${dateMap.size} dates\n`);

  // 3. 各日付の統計計算
  console.log('📊 Step 3/4: Calculating statistics...');
  const archive = [];
  let processedDates = 0;
  let skippedDates = 0;

  for (const [date, files] of dateMap.entries()) {
    // prediction と results が両方揃っている日付のみ処理
    if (files.predictions.length === 0 || files.results.length === 0) {
      skippedDates++;
      continue;
    }

    try {
      // 複数会場対応（同日に複数ファイルがある場合）
      const venues = [];
      let mergedPrediction = { races: [] };
      let mergedResults = { races: [] };

      // predictions をマージ
      for (const predFile of files.predictions) {
        const predData = JSON.parse(readFileSync(predFile.path, 'utf-8'));
        mergedPrediction.races.push(...predData.races);
        if (predData.venue) venues.push(predData.venue);
      }

      // results をマージ
      for (const resultFile of files.results) {
        const resultData = JSON.parse(readFileSync(resultFile.path, 'utf-8'));
        mergedResults.races.push(...resultData.races);
      }

      // 的中判定
      const raceResults = verifyResults(mergedPrediction, mergedResults);

      if (raceResults.length === 0) {
        skippedDates++;
        continue;
      }

      // 統計計算
      const venue = venues[0] || '不明';
      const stats = calculateStats(date, venue, raceResults, venues);

      archive.push(stats);
      processedDates++;

      console.log(`   ✅ ${date}: ${stats.hitRaces}/${stats.totalRaces}R (${stats.hitRate}%, 回収率${stats.returnRate}%)`);
    } catch (err) {
      console.error(`   ❌ ${date}: Error - ${err.message}`);
      skippedDates++;
    }
  }

  console.log(`\n   Processed: ${processedDates} dates`);
  console.log(`   Skipped: ${skippedDates} dates\n`);

  // 4. 保存（日付降順ソート）
  console.log('💾 Step 4/4: Saving archive...');
  archive.sort((a, b) => b.date.localeCompare(a.date));

  const archivePath = join(projectRoot, 'src', 'data', 'archiveResults.json');

  if (isDryRun) {
    console.log(`   Would write to: ${archivePath}`);
    console.log(`   Total entries: ${archive.length}`);
  } else {
    writeFileSync(archivePath, JSON.stringify(archive, null, 2), 'utf-8');
    console.log(`   ✅ Saved to: ${archivePath}`);
    console.log(`   Total entries: ${archive.length}`);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Archive Rebuild Completed');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // サマリー表示
  if (archive.length > 0) {
    const totalHitRaces = archive.reduce((sum, entry) => sum + entry.hitRaces, 0);
    const totalRaces = archive.reduce((sum, entry) => sum + entry.totalRaces, 0);
    const totalBetAmount = archive.reduce((sum, entry) => sum + entry.betAmount, 0);
    const totalPayout = archive.reduce((sum, entry) => sum + entry.totalPayout, 0);

    const overallHitRate = totalRaces > 0 ? Math.round((totalHitRaces / totalRaces) * 100) : 0;
    const overallReturnRate = totalBetAmount > 0 ? Math.round((totalPayout / totalBetAmount) * 100) : 0;

    console.log('📈 Overall Statistics:');
    console.log(`   Total Races: ${totalRaces}`);
    console.log(`   Hit Rate: ${overallHitRate}% (${totalHitRaces}/${totalRaces})`);
    console.log(`   Return Rate: ${overallReturnRate}%`);
    console.log(`   Bet Amount: ${totalBetAmount.toLocaleString()}円`);
    console.log(`   Total Payout: ${totalPayout.toLocaleString()}円`);
    const profit = totalPayout - totalBetAmount;
    const profitSign = profit >= 0 ? '+' : '';
    console.log(`   Profit: ${profitSign}${profit.toLocaleString()}円\n`);
  }
}

// 実行
rebuildArchive().catch(err => {
  console.error('\n❌ Error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
