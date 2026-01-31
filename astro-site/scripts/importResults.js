#!/usr/bin/env node

/**
 * 結果データ自動取り込み・的中判定スクリプト
 *
 * keiba-data-sharedから結果データを取得し、予想と照合して的中判定を行う
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

/**
 * keiba-data-sharedから結果データを取得
 */
async function fetchSharedResults(date, venue = 'nankan') {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

  if (!GITHUB_TOKEN) {
    throw new Error('環境変数 GITHUB_TOKEN が設定されていません');
  }

  const [year, month] = date.split('-');
  const owner = 'apol0510';
  const repo = 'keiba-data-shared';
  const path = `${venue}/results/${year}/${month}/${date}.json`;

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

  console.log(`📡 keiba-data-sharedから取得中: ${path}`);

  const response = await fetch(apiUrl, {
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json'
    }
  });

  if (!response.ok) {
    throw new Error(`結果データの取得に失敗: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const content = Buffer.from(data.content, 'base64').toString('utf-8');

  console.log(`✅ 取得成功: ${path}`);

  return JSON.parse(content);
}

/**
 * 予想データを読み込む
 */
function loadPrediction(date) {
  const venue = '大井'; // TODO: 動的に判定
  const venueMap = {
    '大井': 'ooi',
    '船橋': 'funabashi',
    '川崎': 'kawasaki',
    '浦和': 'urawa'
  };
  const venueSlug = venueMap[venue] || 'ooi';
  const fileName = `${date}-${venueSlug}.json`;
  const filePath = join(projectRoot, 'src', 'data', 'predictions', fileName);

  if (!existsSync(filePath)) {
    throw new Error(`予想データが見つかりません: ${fileName}`);
  }

  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * 馬単の的中判定
 */
function checkUmatanHit(bettingLine, result) {
  // 買い目解析: "4-1.11.2.5.7.9(抑え10.8.6)"
  const match = bettingLine.match(/^(\d+)-(.+)$/);
  if (!match) return false;

  const axis = parseInt(match[1]);
  const aitePart = match[2];

  // 抑えを除去
  const mainPart = aitePart.replace(/\(抑え.+\)/, '');
  const aite = mainPart.split('.').map(n => parseInt(n));

  // 1着と2着を取得
  const first = result.results[0]?.number;
  const second = result.results[1]?.number;

  if (!first || !second) return false;

  // 馬単判定
  if (axis === first && aite.includes(second)) {
    return true;
  }

  return false;
}

/**
 * 的中判定メイン処理
 */
function verifyResults(prediction, results) {
  const raceResults = [];

  for (const race of results.races) {
    const raceNumber = race.raceNumber;
    const predRace = prediction.predictions.find(p => p.raceInfo.raceNumber === raceNumber);

    if (!predRace) {
      console.log(`⚠️  ${raceNumber}Rの予想データが見つかりません`);
      continue;
    }

    const bettingLines = predRace.bettingLines?.umatan || [];
    const hits = bettingLines.filter(line => checkUmatanHit(line, race));

    const first = race.results[0];
    const second = race.results[1];
    const third = race.results[2];

    // 馬単払戻金を取得
    const umatanPayout = race.payouts?.umatan?.[0] || null;
    const payoutAmount = umatanPayout?.payout || null;
    const payoutCombination = umatanPayout?.combination || null;

    raceResults.push({
      raceNumber,
      raceName: race.raceName,
      result: {
        first: { number: first.number, name: first.name },
        second: { number: second.number, name: second.name },
        third: { number: third.number, name: third.name }
      },
      bettingLines,
      isHit: hits.length > 0,
      hitLines: hits,
      umatan: {
        combination: payoutCombination,
        payout: payoutAmount
      }
    });

    if (hits.length > 0) {
      const payoutInfo = payoutAmount ? ` (払戻: ${payoutAmount.toLocaleString()}円)` : '';
      console.log(`✅ ${raceNumber}R: 的中！ ${hits.join(', ')}${payoutInfo}`);
    } else {
      console.log(`❌ ${raceNumber}R: 不的中 (${first.number}-${second.number}-${third.number})`);
    }
  }

  return raceResults;
}

/**
 * archiveResults.jsonに保存
 */
function saveArchive(date, venue, raceResults) {
  const archivePath = join(projectRoot, 'src', 'data', 'archiveResults.json');

  let archive = [];
  if (existsSync(archivePath)) {
    const content = readFileSync(archivePath, 'utf-8');
    archive = JSON.parse(content);
  }

  // 統計計算
  const totalRaces = raceResults.length;
  const hitRaces = raceResults.filter(r => r.isHit).length;
  const hitRate = totalRaces > 0 ? (hitRaces / totalRaces * 100).toFixed(1) : '0.0';

  // 払戻金計算（買い目10点前後：各レース1000円投資）
  const betAmount = totalRaces * 1000; // 買い目約10点×100円＝1000円/レース
  const totalPayout = raceResults.reduce((sum, race) => {
    if (race.isHit && race.umatan.payout) {
      // 的中した場合、払戻金を加算
      // 実際の買い目点数で按分（100円あたりの払戻×10点）
      return sum + (race.umatan.payout * 10);
    }
    return sum;
  }, 0);
  const returnRate = betAmount > 0 ? ((totalPayout / betAmount) * 100).toFixed(1) : '0.0';

  const newEntry = {
    date,
    venue,
    totalRaces,
    hitRaces,
    missRaces: totalRaces - hitRaces,
    hitRate: parseFloat(hitRate),
    betAmount,
    totalPayout,
    returnRate: parseFloat(returnRate),
    races: raceResults,
    verifiedAt: new Date().toISOString()
  };

  // 既存エントリを削除（同じ日付があれば上書き）
  archive = archive.filter(entry => entry.date !== date);

  // 新しいエントリを追加
  archive.unshift(newEntry);

  // 保存
  writeFileSync(archivePath, JSON.stringify(archive, null, 2), 'utf-8');
  console.log(`\n💾 アーカイブ保存完了: ${archivePath}`);
  console.log(`   日付: ${date}`);
  console.log(`   的中: ${hitRaces}/${totalRaces}R (${hitRate}%)`);
  console.log(`   投資額: ${betAmount.toLocaleString()}円`);
  console.log(`   払戻額: ${totalPayout.toLocaleString()}円`);
  console.log(`   回収率: ${returnRate}%`);

  return newEntry;
}

/**
 * メイン処理
 */
async function main() {
  try {
    // 引数から日付を取得
    const args = process.argv.slice(2);
    const dateIndex = args.indexOf('--date');

    let date;
    if (dateIndex !== -1 && args[dateIndex + 1]) {
      date = args[dateIndex + 1];
    } else {
      // デフォルト: JST今日
      const now = new Date();
      const jstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
      date = jstNow.toISOString().split('T')[0];
    }

    console.log(`📅 指定された日付: ${date}\n`);
    console.log(`━━━ ${date} 的中判定開始 ━━━\n`);

    // 1. 結果データ取得
    const results = await fetchSharedResults(date);
    console.log(`\n✅ 結果データ取得完了`);
    console.log(`   会場: ${results.venue}`);
    console.log(`   レース数: ${results.races.length}`);

    // 2. 予想データ読み込み
    console.log(`\n📖 予想データ読み込み中...`);
    const prediction = loadPrediction(date);
    console.log(`✅ 予想データ読み込み完了`);

    // 3. 的中判定
    console.log(`\n🎯 的中判定実行中...\n`);
    const raceResults = verifyResults(prediction, results);

    // 4. アーカイブ保存
    const archiveEntry = saveArchive(date, results.venue, raceResults);

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`✅ 的中判定完了！`);
    console.log(`   的中: ${archiveEntry.hitRaces}R / ${archiveEntry.totalRaces}R`);
    console.log(`   的中率: ${archiveEntry.hitRate}%`);
    console.log(`   投資額: ${archiveEntry.betAmount.toLocaleString()}円`);
    console.log(`   払戻額: ${archiveEntry.totalPayout.toLocaleString()}円`);
    console.log(`   回収率: ${archiveEntry.returnRate}%`);
    const profit = archiveEntry.totalPayout - archiveEntry.betAmount;
    const profitSign = profit >= 0 ? '+' : '';
    console.log(`   損益: ${profitSign}${profit.toLocaleString()}円`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  } catch (error) {
    console.error(`\n❌ エラーが発生しました: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

main();
