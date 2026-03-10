#!/usr/bin/env node

/**
 * rebuildArchive.js
 *
 * Archive自動復旧スクリプト（非破壊再計算 + 欠損復旧）
 *
 * 使い方:
 *   node scripts/rebuildArchive.js
 *   node scripts/rebuildArchive.js --dry-run  # テスト実行
 *
 * 動作方式:
 *   - predictions/*.json を読み込み（ローカル）
 *   - keiba-data-shared APIから結果データ取得（リモート）
 *   - 既存archiveResults.jsonを保持しつつ更新（非破壊）
 *   - 欠損データを自動検出・修復
 *
 * Source of Truth:
 *   - predictions: ローカルrepo (src/data/predictions/)
 *   - results: keiba-data-shared API (GitHub raw content)
 *   - archive: 既存データ保持 + API更新による自己修復
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
 * 数値サニタイズ（NaN/Infinity防止）
 */
function sanitizeNumber(value, fallback = 0) {
  if (typeof value !== 'number' || !isFinite(value)) {
    return fallback;
  }
  return value;
}

/**
 * 統計データサニタイズ（archiveResults.json保存前処理）
 */
function sanitizeStats(stats) {
  return {
    ...stats,
    hitRaces: sanitizeNumber(stats.hitRaces, 0),
    totalRaces: sanitizeNumber(stats.totalRaces, 0),
    hitRate: sanitizeNumber(stats.hitRate, 0),
    umatanHitRaces: sanitizeNumber(stats.umatanHitRaces, 0),
    umatanHitRate: sanitizeNumber(stats.umatanHitRate, 0),
    sanrenpukuHitRaces: sanitizeNumber(stats.sanrenpukuHitRaces, 0),
    sanrenpukuHitRate: sanitizeNumber(stats.sanrenpukuHitRate, 0),
    betPointsPerRace: sanitizeNumber(stats.betPointsPerRace, 0),
    betAmount: sanitizeNumber(stats.betAmount, 0),
    totalPayout: sanitizeNumber(stats.totalPayout, 0),
    returnRate: sanitizeNumber(stats.returnRate, 0)
  };
}

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
 * keiba-data-sharedから結果データを取得
 */
async function fetchResultsFromAPI(date) {
  try {
    const [year, month] = date.split('-');
    const url = `https://raw.githubusercontent.com/apol0510/keiba-data-shared/main/nankan/results/${year}/${month}/${date}.json`;

    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (err) {
    console.error(`   ⚠️  Failed to fetch results for ${date}: ${err.message}`);
    return null;
  }
}

/**
 * 日付ごとに prediction をグループ化
 */
function groupByDate(predictionFiles) {
  const dateMap = new Map();

  // predictions
  predictionFiles.forEach(file => {
    if (!dateMap.has(file.date)) {
      dateMap.set(file.date, { predictions: [] });
    }
    dateMap.get(file.date).predictions.push(file);
  });

  return dateMap;
}

/**
 * 的中判定（importResults.js の verifyResults() 相当）
 */
function verifyResults(prediction, results) {
  const raceResults = [];

  for (const predRace of prediction.races) {
    // 新形式（raceInfo.raceNumber）と旧形式（raceNumber）の両方に対応
    const raceNumber = predRace.raceInfo?.raceNumber || predRace.raceNumber;
    const resultRace = results.races.find(r => r.raceNumber === raceNumber);
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
    const honmeiHit = honmei && (honmei.number === winner.number || honmei.horseNumber === winner.number);

    // 馬単的中判定（新形式: bettingLines, 旧形式: betLines）
    const bettingLines = predRace.bettingLines || predRace.betLines;
    const umatanHit = bettingLines?.umatan?.some(line => {
      const [first, seconds] = line.split('-');
      const secondNumbers = seconds.split('.');
      return first === String(winner.number) && secondNumbers.includes(String(second.number));
    }) || false;

    // 3連複的中判定
    const sanrenpukuHit = bettingLines?.sanrenpuku?.some(line => {
      const numbers = line.split('.').map(Number);
      return numbers.includes(winner.number) &&
             numbers.includes(second.number) &&
             numbers.includes(third.number);
    }) || false;

    raceResults.push({
      raceNumber: raceNumber,
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

    // 払戻計算（配列形式と単一オブジェクト形式の両方に対応）
    if (race.umatanHit && race.payouts?.umatan) {
      const umatanPayout = Array.isArray(race.payouts.umatan)
        ? race.payouts.umatan[0]?.payout
        : race.payouts.umatan.payout;
      if (typeof umatanPayout === 'number' && isFinite(umatanPayout)) {
        totalPayout += umatanPayout;
      }
    }
    if (race.sanrenpukuHit && race.payouts?.sanrenpuku) {
      const sanrenpukuPayout = Array.isArray(race.payouts.sanrenpuku)
        ? race.payouts.sanrenpuku[0]?.payout
        : race.payouts.sanrenpuku.payout;
      if (typeof sanrenpukuPayout === 'number' && isFinite(sanrenpukuPayout)) {
        totalPayout += sanrenpukuPayout;
      }
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

  // archivePathは既に定義済みなので削除
  console.log('📦 Archive Rebuild Starting...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (isDryRun) {
    console.log('🧪 Dry-run mode: No files will be written\n');
  }

  // 1. 全ファイル取得
  console.log('📂 Step 1/4: Scanning prediction files...');
  const predictionFiles = getAllPredictionFiles();

  console.log(`   Found ${predictionFiles.length} prediction files\n`);

  // 2. 日付ごとにグループ化
  console.log('🔄 Step 2/4: Grouping by date...');
  const dateMap = groupByDate(predictionFiles);
  console.log(`   Grouped into ${dateMap.size} dates\n`);

  // 3. 既存アーカイブを読み込み
  console.log('📂 Step 3/5: Loading existing archive...');
  const archivePath = join(projectRoot, 'src', 'data', 'archiveResults.json');
  let existingArchive = [];
  if (existsSync(archivePath)) {
    try {
      existingArchive = JSON.parse(readFileSync(archivePath, 'utf-8'));
      console.log(`   Found ${existingArchive.length} existing entries\n`);
    } catch (err) {
      console.log(`   ⚠️  Failed to read existing archive: ${err.message}\n`);
    }
  } else {
    console.log(`   No existing archive found\n`);
  }

  // 日付ごとにマップ化（高速検索用）
  const archiveMap = new Map(existingArchive.map(entry => [entry.date, entry]));

  // 4. 各日付の統計計算
  console.log('📊 Step 4/5: Fetching results and calculating statistics...');
  let processedDates = 0;
  let skippedDates = 0;
  let updatedDates = 0;
  let addedDates = 0;

  for (const [date, files] of dateMap.entries()) {
    // prediction が存在しない日付はスキップ
    if (files.predictions.length === 0) {
      skippedDates++;
      continue;
    }

    try {
      // 複数会場対応（同日に複数ファイルがある場合）
      const venues = [];
      let mergedPrediction = { races: [] };

      // predictions をマージ
      for (const predFile of files.predictions) {
        const predData = JSON.parse(readFileSync(predFile.path, 'utf-8'));
        // 新形式（predictions配列）と旧形式（races配列）の両方に対応
        const predictionRaces = predData.predictions || predData.races || [];
        mergedPrediction.races.push(...predictionRaces);
        // venue情報を取得（新形式はeventInfo.venue、旧形式はvenueプロパティ）
        const venue = predData.eventInfo?.venue || predData.venue;
        if (venue) venues.push(venue);
      }

      // results を keiba-data-shared から取得
      console.log(`   🔍 ${date}: Fetching results from API...`);
      const apiResults = await fetchResultsFromAPI(date);

      if (!apiResults || !apiResults.races || apiResults.races.length === 0) {
        console.log(`   ⏭️  ${date}: No results available yet`);
        skippedDates++;
        continue;
      }

      // 的中判定
      const raceResults = verifyResults(mergedPrediction, apiResults);

      if (raceResults.length === 0) {
        console.log(`   ⏭️  ${date}: No matching races found`);
        skippedDates++;
        continue;
      }

      // 統計計算
      const venue = venues[0] || '不明';
      const rawStats = calculateStats(date, venue, raceResults, venues);

      // サニタイズ（NaN/Infinity防止）
      const stats = sanitizeStats(rawStats);

      // NaN検出時の警告ログ
      if (rawStats.returnRate !== stats.returnRate && !isFinite(rawStats.returnRate)) {
        console.log(`   ⚠️  ${date}: returnRate was non-finite (${rawStats.returnRate}), normalized to ${stats.returnRate}%`);
      }

      // 既存アーカイブに追加/更新
      if (archiveMap.has(date)) {
        archiveMap.set(date, stats);
        updatedDates++;
        console.log(`   🔄 ${date}: ${stats.hitRaces}/${stats.totalRaces}R (${stats.hitRate}%, 回収率${stats.returnRate}%) [Updated]`);
      } else {
        archiveMap.set(date, stats);
        addedDates++;
        console.log(`   ✅ ${date}: ${stats.hitRaces}/${stats.totalRaces}R (${stats.hitRate}%, 回収率${stats.returnRate}%) [Added]`);
      }

      processedDates++;
    } catch (err) {
      console.error(`   ❌ ${date}: Error - ${err.message}`);
      skippedDates++;
    }
  }

  console.log(`\n   Processed: ${processedDates} dates`);
  console.log(`   Added: ${addedDates} new entries`);
  console.log(`   Updated: ${updatedDates} existing entries`);
  console.log(`   Skipped: ${skippedDates} dates`);
  console.log(`   Preserved: ${archiveMap.size - processedDates} existing entries (not in predictions)\n`);

  // 5. 保存（日付降順ソート + 最終サニタイズ）
  console.log('💾 Step 5/5: Saving archive...');
  const archive = Array.from(archiveMap.values()).map(sanitizeStats);
  archive.sort((a, b) => b.date.localeCompare(a.date));

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

  // サマリー表示（サニタイズ済み）
  if (archive.length > 0) {
    const totalHitRaces = sanitizeNumber(archive.reduce((sum, entry) => sum + entry.hitRaces, 0), 0);
    const totalRaces = sanitizeNumber(archive.reduce((sum, entry) => sum + entry.totalRaces, 0), 0);
    const totalBetAmount = sanitizeNumber(archive.reduce((sum, entry) => sum + entry.betAmount, 0), 0);
    const totalPayout = sanitizeNumber(archive.reduce((sum, entry) => sum + entry.totalPayout, 0), 0);

    const overallHitRate = totalRaces > 0 ? sanitizeNumber(Math.round((totalHitRaces / totalRaces) * 100), 0) : 0;
    const overallReturnRate = totalBetAmount > 0 ? sanitizeNumber(Math.round((totalPayout / totalBetAmount) * 100), 0) : 0;

    console.log('📈 Overall Statistics:');
    console.log(`   Total Races: ${totalRaces}`);
    console.log(`   Hit Rate: ${overallHitRate}% (${totalHitRaces}/${totalRaces})`);
    console.log(`   Return Rate: ${overallReturnRate}%`);
    console.log(`   Bet Amount: ${totalBetAmount.toLocaleString()}円`);
    console.log(`   Total Payout: ${totalPayout.toLocaleString()}円`);
    const profit = sanitizeNumber(totalPayout - totalBetAmount, 0);
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
