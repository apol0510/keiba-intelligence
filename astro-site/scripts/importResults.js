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

// アラートメール送信URL（Netlify Function）
const ALERT_ENDPOINT = process.env.ALERT_ENDPOINT || 'https://keiba-intelligence.netlify.app/.netlify/functions/send-alert';
const IS_CI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

/**
 * アラートメール送信
 */
async function sendAlert(type, date, details = {}, metadata = {}) {
  // CI環境でのみアラート送信（ローカル実行時はスキップ）
  if (!IS_CI) {
    console.log(`⏭️  ローカル実行のためアラート送信をスキップ`);
    return;
  }

  try {
    console.log(`📧 アラートメール送信中: ${type} (${date || 'N/A'})`);

    const response = await fetch(ALERT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type,
        date,
        details,
        metadata
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`アラート送信失敗: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    console.log(`✅ アラートメール送信成功: ${result.type}`);
  } catch (error) {
    console.error(`⚠️  アラートメール送信エラー（処理は継続）: ${error.message}`);
    // アラート送信失敗しても処理は継続（メイン処理に影響を与えない）
  }
}

/**
 * keiba-data-sharedから結果データを取得
 */
async function fetchSharedResults(date, venue = 'nankan') {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const [year, month] = date.split('-');
  const owner = 'apol0510';
  const repo = 'keiba-data-shared';
  const path = `${venue}/results/${year}/${month}/${date}.json`;

  console.log(`📡 keiba-data-sharedから取得中: ${path}`);

  // ローカル実行時（GITHUB_TOKENなし）: raw.githubusercontent.comを使用（公開リポジトリ）
  if (!GITHUB_TOKEN) {
    console.log(`   ローカル実行モード: raw.githubusercontent.comからダウンロード`);
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/${path}`;
    const response = await fetch(rawUrl);

    if (!response.ok) {
      throw new Error(`結果データの取得に失敗: ${response.status} ${response.statusText}`);
    }

    const content = await response.text();
    const results = JSON.parse(content);
    console.log(`✅ 取得成功: ${path}`);
    return results;
  }

  // GitHub Actions実行時: GitHub API経由（レート制限回避）
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

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
function loadPrediction(date, venue) {
  const venueMap = {
    '大井': 'ooi',
    '船橋': 'funabashi',
    '川崎': 'kawasaki',
    '浦和': 'urawa'
  };
  const venueSlug = venueMap[venue] || 'ooi';

  // 優先順位1: 新しい形式（keiba-data-shared自動インポート）: predictions/2026/02/2026-02-04.json
  const [year, month] = date.split('-');
  const newFormatPath = join(projectRoot, 'src', 'data', 'predictions', year, month, `${date}.json`);

  // 優先順位2: 古い形式（手動作成）: predictions/2026-02-04-kawasaki.json
  const oldFormatFileName = `${date}-${venueSlug}.json`;
  const oldFormatPath = join(projectRoot, 'src', 'data', 'predictions', oldFormatFileName);

  // 新しい形式から試す
  if (existsSync(newFormatPath)) {
    const content = readFileSync(newFormatPath, 'utf-8');
    return JSON.parse(content);
  }

  // 古い形式を試す
  if (existsSync(oldFormatPath)) {
    const content = readFileSync(oldFormatPath, 'utf-8');
    return JSON.parse(content);
  }

  // どちらも見つからない場合
  throw new Error(`予想データが見つかりません: ${newFormatPath} または ${oldFormatPath} (会場: ${venue})`);
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

  // 本線相手馬を抽出
  const mainPart = aitePart.replace(/\(抑え.+\)/, '');
  const mainAite = mainPart.split('.').map(n => parseInt(n)).filter(n => !isNaN(n));

  // 抑え馬を抽出
  let osaeAite = [];
  const osaeMatch = aitePart.match(/\(抑え([0-9.]+)\)/);
  if (osaeMatch) {
    osaeAite = osaeMatch[1].split('.').map(n => parseInt(n)).filter(n => !isNaN(n));
  }

  // 全相手馬（本線+抑え）
  const allAite = [...mainAite, ...osaeAite];

  // 1着と2着を取得
  const first = result.results[0]?.number;
  const second = result.results[1]?.number;

  if (!first || !second) return false;

  // 馬単判定（2パターン）
  // パターン1: 軸が1着、相手が2着
  if (axis === first && allAite.includes(second)) {
    return true;
  }

  // パターン2: 相手が1着、軸が2着
  if (allAite.includes(first) && axis === second) {
    return true;
  }

  return false;
}

/**
 * 的中判定メイン処理
 */
function verifyResults(prediction, results) {
  const raceResults = [];

  // 予想データの形式を判定（新形式 or 旧形式）
  const predictionRaces = prediction.predictions || prediction.races || [];

  for (const race of results.races) {
    const raceNumber = race.raceNumber;

    // raceNumberを数値に正規化（"1R" → 1, 1 → 1）
    const normalizedRaceNumber = typeof raceNumber === 'string'
      ? parseInt(raceNumber.replace(/[^0-9]/g, ''))
      : raceNumber;

    // 予想データを検索（raceNumberの型の違いに対応）
    const predRace = predictionRaces.find(p => {
      const predRaceNum = p.raceInfo.raceNumber;
      const normalizedPredRaceNum = typeof predRaceNum === 'string'
        ? parseInt(predRaceNum.replace(/[^0-9]/g, ''))
        : predRaceNum;
      return normalizedPredRaceNum === normalizedRaceNumber;
    });

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
      raceName: predRace.raceInfo?.raceName || race.raceName || '',
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

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 払戻金計算（2段階調整方式）
  // 詳細: BET_POINT_LOGIC.md 参照
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  // 第1段階: 基本8点で仮計算
  let betPointsPerRace = 8;
  let betAmount = totalRaces * betPointsPerRace * 100; // 8点 × 100円 = 800円/レース

  const totalPayout = raceResults.reduce((sum, race) => {
    if (race.isHit && race.umatan.payout) {
      // 的中した場合、払戻金を加算
      // 的中するのは1点（100円）のみ、payoutは100円あたりの払戻金
      return sum + race.umatan.payout;
    }
    return sum;
  }, 0);

  let returnRate = betAmount > 0 ? ((totalPayout / betAmount) * 100) : 0;

  // 第2段階: 回収率300%超なら12点で再計算
  if (returnRate > 300) {
    betPointsPerRace = 12;
    betAmount = totalRaces * betPointsPerRace * 100; // 12点 × 100円 = 1200円/レース
    returnRate = betAmount > 0 ? ((totalPayout / betAmount) * 100) : 0;
    console.log(`\n📊 回収率調整: 8点 → 12点（回収率が300%超のため）`);
  }

  // 最終的な回収率（小数点1桁）
  const finalReturnRate = returnRate.toFixed(1);

  const newEntry = {
    date,
    venue,
    totalRaces,
    hitRaces,
    missRaces: totalRaces - hitRaces,
    hitRate: parseFloat(hitRate),
    betAmount,
    betPointsPerRace, // 追加: 実際の買い目点数を記録
    totalPayout,
    returnRate: parseFloat(finalReturnRate),
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
  console.log(`   買い目: ${betPointsPerRace}点/レース`);
  console.log(`   投資額: ${betAmount.toLocaleString()}円`);
  console.log(`   払戻額: ${totalPayout.toLocaleString()}円`);
  console.log(`   回収率: ${finalReturnRate}%`);

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
    const venue = results.venue || results.races[0]?.venue || '大井';

    // venue情報が取得できたか確認
    const venueSource = results.venue ? 'results.venue' : (results.races[0]?.venue ? 'races[0].venue' : 'デフォルト');
    const venueIsDefault = !results.venue && !results.races[0]?.venue;

    console.log(`\n✅ 結果データ取得完了`);
    console.log(`   会場: ${venue} (取得元: ${venueSource})`);
    console.log(`   レース数: ${results.races.length}`);

    // venue情報がデフォルト値の場合、警告
    if (venueIsDefault) {
      console.warn(`\n⚠️  警告：venue情報が取得できませんでした（デフォルト値「${venue}」を使用）`);
      console.warn(`   結果データ構造を確認してください`);
      console.warn(`   予想データ読み込みに失敗する可能性があります\n`);
    }

    // 2. 予想データ読み込み
    console.log(`\n📖 予想データ読み込み中...`);
    let prediction;
    try {
      prediction = loadPrediction(date, venue);
      console.log(`✅ 予想データ読み込み完了`);
    } catch (error) {
      // 予想データがない場合、keiba-data-sharedに本当に存在しないか二重確認
      console.log(`⏭️  予想データが見つかりません: ${date}`);

      // keiba-data-sharedに予想データが存在するか確認
      const [year, month] = date.split('-');
      const sharedPredictionPath = `nankan/predictions/${year}/${month}/${date}.json`;
      const checkUrl = `https://raw.githubusercontent.com/apol0510/keiba-data-shared/main/${sharedPredictionPath}`;

      try {
        console.log(`\n🔍 keiba-data-sharedの予想データ存在確認中...`);
        const checkResponse = await fetch(checkUrl);

        if (checkResponse.ok) {
          // 予想データが存在するのに読み込めなかった → 異常
          console.error(`\n🚨 異常検知：予想データが存在するのに読み込めませんでした！`);
          console.error(`   keiba-data-shared: ${sharedPredictionPath} (存在)`);
          console.error(`   keiba-intelligence: 読み込み失敗`);
          console.error(`   venue: ${venue}`);
          console.error(`   元のエラー: ${error.message}\n`);

          // アラート送信
          await sendAlert('import-results-failure', date, {
            error: error.message,
            venue: venue,
            venueIsUndefined: venue === undefined || venue === 'undefined',
            sharedPredictionExists: true,
            sharedPredictionPath: sharedPredictionPath,
            localSearchPath: error.message
          }, {
            timestamp: new Date().toISOString(),
            critical: true
          });

          // エラーとして終了（修正が必要）
          process.exit(1);
        } else {
          // 予想データが存在しない → 正常（SEO対策用の結果データのみ）
          console.log(`   keiba-data-sharedにはSEO対策用の結果データのみ保存されています`);
          console.log(`   keiba-intelligenceでは的中判定をスキップします\n`);
          console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
          console.log(`⏭️  処理完了: 予想データなし（スキップ）`);
          console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
          process.exit(0); // 正常終了
        }
      } catch (checkError) {
        // ネットワークエラー等でチェック失敗 → 警告して正常終了
        console.warn(`⚠️  keiba-data-sharedの予想データ存在確認に失敗（ネットワークエラー？）`);
        console.warn(`   処理を継続します（予想データなしとして扱います）\n`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`⏭️  処理完了: 予想データなし（スキップ）`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
        process.exit(0); // 正常終了
      }
    }

    // 3. 的中判定
    console.log(`\n🎯 的中判定実行中...\n`);
    const raceResults = verifyResults(prediction, results);

    // 4. アーカイブ保存
    const archiveEntry = saveArchive(date, venue, raceResults);

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`✅ 的中判定完了！`);
    console.log(`   的中: ${archiveEntry.hitRaces}R / ${archiveEntry.totalRaces}R`);
    console.log(`   的中率: ${archiveEntry.hitRate}%`);
    console.log(`   買い目: ${archiveEntry.betPointsPerRace}点/レース`);
    console.log(`   投資額: ${archiveEntry.betAmount.toLocaleString()}円`);
    console.log(`   払戻額: ${archiveEntry.totalPayout.toLocaleString()}円`);
    console.log(`   回収率: ${archiveEntry.returnRate}%`);
    const profit = archiveEntry.totalPayout - archiveEntry.betAmount;
    const profitSign = profit >= 0 ? '+' : '';
    console.log(`   損益: ${profitSign}${profit.toLocaleString()}円`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    // 5. 成功通知送信（CI環境のみ）
    if (process.env.CI === 'true') {
      console.log(`📧 成功通知を送信中...`);
      await sendAlert('results-imported-success', date, {
        hitRate: archiveEntry.hitRate,
        hitRaces: archiveEntry.hitRaces,
        totalRaces: archiveEntry.totalRaces,
        betAmount: archiveEntry.betAmount,
        totalPayout: archiveEntry.totalPayout,
        returnRate: archiveEntry.returnRate,
        profit: profit
      }, {
        venue,
        timestamp: new Date().toISOString()
      });
      console.log(`✅ 成功通知を送信しました`);
    }

    // 6. 異常値検知・アラート送信
    if (archiveEntry.hitRate === 0 && archiveEntry.totalRaces >= 10) {
      console.log(`⚠️  異常値検知：的中率0%`);
      await sendAlert('zero-hit-rate', date, {
        hitRate: archiveEntry.hitRate,
        hitRaces: archiveEntry.hitRaces,
        totalRaces: archiveEntry.totalRaces,
        betAmount: archiveEntry.betAmount,
        totalPayout: archiveEntry.totalPayout,
        returnRate: archiveEntry.returnRate
      }, {
        venue,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error(`\n❌ エラーが発生しました: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

main();
