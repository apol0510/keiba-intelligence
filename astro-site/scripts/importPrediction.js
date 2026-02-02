#!/usr/bin/env node

/**
 * importPrediction.js
 *
 * keiba-data-sharedから予想JSONを取得して、
 * normalizeAndAdjustして、keiba-intelligenceに保存する
 *
 * 使い方:
 *   node scripts/importPrediction.js --date 2026-01-30
 *   node scripts/importPrediction.js  # 今日の日付を使用
 *
 * 環境変数:
 *   GITHUB_TOKEN: GitHub Personal Access Token（read-only）
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

// ESモジュールで __dirname を取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// プロジェクトルート
const projectRoot = join(__dirname, '..');

// src/utils から正規化関数をインポート
import { normalizeAndAdjust } from '../src/utils/normalizePrediction.js';

/**
 * JST（日本時間）の今日の日付を取得
 *
 * @returns {string} YYYY-MM-DD形式の日付
 */
function getTodayJST() {
  const now = new Date();
  const jstOffset = 9 * 60; // JST = UTC+9
  const jstTime = new Date(now.getTime() + jstOffset * 60 * 1000);

  const year = jstTime.getUTCFullYear();
  const month = String(jstTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(jstTime.getUTCDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * keiba-data-sharedから予想JSONを取得
 *
 * GitHub Contents APIを使用（private対応）
 *
 * @param {string} date - 日付（YYYY-MM-DD）
 * @param {string} venue - 競馬場カテゴリ（デフォルト: 'nankan'）
 * @returns {Promise<Object>} 予想JSON
 */
async function fetchSharedPrediction(date, venue = 'nankan') {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

  if (!GITHUB_TOKEN) {
    throw new Error('環境変数 GITHUB_TOKEN が設定されていません');
  }

  // 日付をパースしてパスを構築
  const [year, month, day] = date.split('-');
  const path = `${venue}/predictions/${year}/${month}/${date}.json`;

  const owner = 'apol0510';
  const repo = 'keiba-data-shared';
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

  console.log(`📡 keiba-data-sharedから取得中: ${path}`);

  const response = await fetch(apiUrl, {
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'keiba-intelligence-import'
    }
  });

  if (!response.ok) {
    if (response.status === 404) {
      // 予想データがない場合は正常終了（エラーではない）
      console.log(`⏭️  予想データが見つかりません: ${path}`);
      console.log(`   まだ予想が作成されていない可能性があります`);
      return null; // nullを返す
    }
    const errorData = await response.json();
    throw new Error(`GitHub API Error: ${response.status} ${JSON.stringify(errorData)}`);
  }

  const data = await response.json();

  // Base64デコード
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  const predictionJSON = JSON.parse(content);

  console.log(`✅ 取得成功: ${path}`);

  return predictionJSON;
}

/**
 * 予想データを取り込み（正規化 + 調整ルール適用）
 *
 * @param {string} date - 日付（YYYY-MM-DD）
 * @param {string} venue - 競馬場カテゴリ（デフォルト: 'nankan'）
 * @returns {Promise<Object>} 調整済みNormalizedPrediction
 */
async function importPrediction(date, venue = 'nankan') {
  console.log(`\n━━━ ${date} 予想データ取り込み開始 ━━━`);

  // keiba-data-sharedから取得
  const sharedJSON = await fetchSharedPrediction(date, venue);

  // 予想データがない場合はスキップ
  if (!sharedJSON) {
    console.log(`⏭️  予想データがないため、スキップします`);
    return null;
  }

  // 正規化 + 調整ルール適用
  console.log(`⚙️  正規化 + 調整ルール適用中...`);
  const normalizedAndAdjusted = normalizeAndAdjust(sharedJSON);

  console.log(`✅ 正規化完了`);
  console.log(`   - 開催日: ${normalizedAndAdjusted.date}`);
  console.log(`   - 競馬場: ${normalizedAndAdjusted.venue}`);
  console.log(`   - レース数: ${normalizedAndAdjusted.totalRaces}`);

  // 各レースの調整結果を表示
  for (const race of normalizedAndAdjusted.races) {
    console.log(`   - ${race.raceNumber}R: ${race.raceName}`);
    console.log(`     hasHorseData=${race.hasHorseData}, isAbsoluteAxis=${race.isAbsoluteAxis}`);
    if (race.hasHorseData) {
      const honmei = race.horses.find(h => h.role === '本命');
      const taikou = race.horses.find(h => h.role === '対抗');
      if (honmei) {
        console.log(`     本命: ${honmei.number} ${honmei.name} (${honmei.rawScore}点 → ${honmei.displayScore})`);
      }
      if (taikou) {
        console.log(`     対抗: ${taikou.number} ${taikou.name} (${taikou.rawScore}点 → ${taikou.displayScore})`);
      }
    }
  }

  return normalizedAndAdjusted;
}

/**
 * keiba-data-shared標準フォーマットを既存の予想ページフォーマットに変換
 *
 * @param {Object} data - 正規化・調整済みデータ
 * @param {string} date - 日付
 * @returns {Object} 既存フォーマット
 */
function convertToLegacyFormat(data, date) {
  const predictions = data.races.map((race) => {
    // 役割別に馬を抽出
    const honmei = race.horses.find(h => h.role === '本命');
    const taikou = race.horses.find(h => h.role === '対抗');
    const main = race.horses.filter(h => h.role === '本命' || h.role === '対抗' || h.role === '単穴' || h.role === '連下最上位');
    const renka = race.horses.filter(h => h.role === '連下');
    const osae = race.horses.filter(h => h.role === '補欠' || h.role === '抑え');

    // 買い目生成（馬単）
    const umatanLines = [];

    if (honmei) {
      // 本命軸：相手から本命を除外
      const aite = main.filter(h => h.number !== honmei.number).map(h => h.number).join('.');
      const renkaNumbers = renka.map(h => h.number).join('.');
      const osaeNumbers = osae.map(h => h.number).join('.');

      let line = `${honmei.number}-${aite}`;
      if (renkaNumbers) line += `.${renkaNumbers}`;
      if (osaeNumbers) line += `(抑え${osaeNumbers})`;
      umatanLines.push(line);
    }

    if (taikou) {
      // 対抗軸：相手から対抗を除外
      const aite = main.filter(h => h.number !== taikou.number).map(h => h.number).join('.');
      const renkaNumbers = renka.map(h => h.number).join('.');
      const osaeNumbers = osae.map(h => h.number).join('.');

      let line = `${taikou.number}-${aite}`;
      if (renkaNumbers) line += `.${renkaNumbers}`;
      if (osaeNumbers) line += `(抑え${osaeNumbers})`;
      umatanLines.push(line);
    }

    return {
      raceInfo: {
        date: date,
        venue: data.venue,
        raceNumber: race.raceNumber
      },
      horses: race.horses
        .map(h => ({
          horseNumber: h.number,
          horseName: h.name,
          pt: h.displayScore || h.rawScore || 70, // ptフィールド
          role: h.role === '連下最上位' ? '単穴' : h.role // 連下最上位を単穴に変換
        }))
        .sort((a, b) => {
          // 役割の優先順位
          const roleOrder = { '本命': 1, '対抗': 2, '単穴': 3, '連下': 4, '補欠': 5, '抑え': 6, '無': 7 };
          const orderA = roleOrder[a.role] || 99;
          const orderB = roleOrder[b.role] || 99;

          if (orderA !== orderB) {
            return orderA - orderB; // 役割順
          }
          return b.pt - a.pt; // 同じ役割内ではpt降順
        }),
      bettingLines: {
        umatan: umatanLines
      },
      generatedAt: new Date().toISOString()
    };
  });

  return {
    eventInfo: {
      date: date,
      venue: data.venue,
      totalRaces: data.totalRaces
    },
    predictions: predictions
  };
}

/**
 * 予想データをkeiba-intelligence側に保存
 *
 * @param {string} date - 日付（YYYY-MM-DD）
 * @param {Object} normalizedAndAdjusted - 調整済みNormalizedPrediction
 * @returns {boolean} 保存したかどうか（true: 保存, false: no-op）
 */
function savePrediction(date, normalizedAndAdjusted) {
  console.log(`\n💾 保存処理開始...`);

  // 保存先パス構築（フラット構造：YYYY-MM-DD-venue.json）
  const venue = normalizedAndAdjusted.venue || '大井'; // デフォルト
  const venueMap = {
    '大井': 'ooi',
    '船橋': 'funabashi',
    '川崎': 'kawasaki',
    '浦和': 'urawa'
  };
  const venueSlug = venueMap[venue] || 'ooi'; // venueCodeではなくvenueMapを使用
  const fileName = `${date}-${venueSlug}.json`;

  const dirPath = join(projectRoot, 'src', 'data', 'predictions');
  const filePath = join(dirPath, fileName);

  // ディレクトリ作成（存在しない場合）
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
    console.log(`📁 ディレクトリ作成: ${dirPath}`);
  }

  // 既存フォーマットに変換
  const convertedData = convertToLegacyFormat(normalizedAndAdjusted, date);

  // JSON文字列化（整形）
  const newContent = JSON.stringify(convertedData, null, 2);

  // 既存ファイルとの比較（ハッシュ比較）
  if (existsSync(filePath)) {
    const existingContent = readFileSync(filePath, 'utf-8');

    // ハッシュ計算
    const existingHash = crypto.createHash('sha256').update(existingContent).digest('hex');
    const newHash = crypto.createHash('sha256').update(newContent).digest('hex');

    if (existingHash === newHash) {
      console.log(`⏭️  スキップ: 既存データと同一です`);
      console.log(`   ファイル: ${filePath}`);
      return false; // no-op
    } else {
      console.log(`🔄 更新: 既存データと差分があります`);
    }
  } else {
    console.log(`🆕 新規作成`);
  }

  // ファイル書き込み
  writeFileSync(filePath, newContent, 'utf-8');
  console.log(`✅ 保存完了: ${filePath}`);

  return true; // 保存した
}

/**
 * メイン処理
 */
async function main() {
  try {
    // コマンドライン引数をパース
    const args = process.argv.slice(2);
    let date = null;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--date' && i + 1 < args.length) {
        date = args[i + 1];
        i++;
      }
    }

    // 日付が指定されていない場合は今日の日付を使用
    if (!date) {
      date = getTodayJST();
      console.log(`📅 日付未指定のため、今日の日付を使用: ${date}`);
    } else {
      console.log(`📅 指定された日付: ${date}`);
    }

    // 日付フォーマット検証
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error('日付はYYYY-MM-DD形式で指定してください');
    }

    // 取り込み実行
    const normalizedAndAdjusted = await importPrediction(date);

    // 予想データがない場合は正常終了
    if (!normalizedAndAdjusted) {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('⏭️  予想データがないため、処理を終了します');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      return; // 正常終了
    }

    // 保存
    const saved = savePrediction(date, normalizedAndAdjusted);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    if (saved) {
      console.log('✅ 取り込み完了！');
    } else {
      console.log('⏭️  変更なし（既存データと同一）');
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error) {
    console.error('\n❌ エラーが発生しました:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// 実行
main();
