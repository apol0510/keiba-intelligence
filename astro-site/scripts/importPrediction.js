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

// メインレース10点ロジック
import { isMainRace, generateMainRaceUmatanLines } from '../src/utils/mainRaceBetting.js';

// データ検証関数をインポート
import { validateNankanPrediction } from './utils/validatePrediction.js';

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
 * 会場別ファイル一覧を取得してvenues形式に変換（正規形式）
 *
 * @param {string} date - 日付（YYYY-MM-DD）
 * @param {string} venue - 競馬場カテゴリ（デフォルト: 'nankan'）
 * @param {string} subDir - サブディレクトリ（'computer' または ''）
 * @returns {Promise<Object|null>} venues配列を持つ統合JSON、またはnull
 */
async function fetchVenuePredictions(date, venue = 'nankan', subDir = '') {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const [year, month, day] = date.split('-');
  const dirPath = subDir
    ? `${venue}/predictions/${subDir}/${year}/${month}`
    : `${venue}/predictions/${year}/${month}`;
  const owner = 'apol0510';
  const repo = 'keiba-data-shared';

  console.log(`📡 [IMPORT] 会場別ファイル取得中: ${dirPath}`);

  // ディレクトリ内のファイル一覧を取得
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}`;
  const headers = GITHUB_TOKEN ? {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'keiba-intelligence-import'
  } : {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'keiba-intelligence-import'
  };

  const dirResponse = await fetch(apiUrl, { headers });

  if (!dirResponse.ok) {
    if (dirResponse.status === 404) {
      console.log(`⏭️  [IMPORT] ディレクトリが見つかりません: ${dirPath}`);
      return null;
    }
    throw new Error(`GitHub API Error: ${dirResponse.status}`);
  }

  const files = await dirResponse.json();

  // 指定日付の会場別ファイルを抽出（例: 2026-03-09-OOI.json）
  const dateFiles = files.filter(file =>
    file.name.startsWith(`${date}-`) && file.name.endsWith('.json')
  );

  if (dateFiles.length === 0) {
    console.log(`⏭️  [IMPORT] ${date}の会場別ファイルが見つかりません: ${dirPath}`);
    return null;
  }

  console.log(`✅ [IMPORT] ${dateFiles.length}会場のファイルを検出:`, dateFiles.map(f => f.name).join(', '));

  // 各ファイルを取得
  const venues = [];
  for (const file of dateFiles) {
    const fileUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/${dirPath}/${file.name}`;
    const response = await fetch(fileUrl);

    if (response.ok) {
      const content = await response.text();
      const venueData = JSON.parse(content);
      venues.push(venueData);
      console.log(`   ✅ [IMPORT] ${file.name} 取得完了`);
    } else {
      console.log(`   ⚠️  [IMPORT] ${file.name} 取得失敗: ${response.status}`);
    }
  }

  if (venues.length === 0) {
    return null;
  }

  // venues配列形式に統合
  console.log(`✅ [IMPORT] venues配列形式に統合完了: ${venues.length}会場`);
  return {
    date: date,
    venues: venues,
    totalVenues: venues.length
  };
}

/**
 * computer/ディレクトリから会場別ファイルを取得（後方互換のため残す）
 * @deprecated 内部でfetchVenuePredictionsを呼び出す
 */
async function fetchComputerPredictions(date, venue = 'nankan') {
  return await fetchVenuePredictions(date, venue, 'computer');
}

/**
 * keiba-data-sharedからracebook JSONを取得
 * race-data-importer が保存したデータ（印・近走・調教を含む）
 */
async function fetchRacebookData(date, category = 'nankan') {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const [year, month] = date.split('-');
  const dirPath = `${category}/racebook/${year}/${month}`;
  const owner = 'apol0510';
  const repo = 'keiba-data-shared';

  console.log(`📡 [RACEBOOK] racebookデータ取得中: ${dirPath}`);

  const headers = GITHUB_TOKEN ? {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'keiba-intelligence-import'
  } : {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'keiba-intelligence-import'
  };

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}`;
  const dirResponse = await fetch(apiUrl, { headers });

  if (!dirResponse.ok) {
    console.log(`⏭️  [RACEBOOK] ディレクトリなし: ${dirPath}`);
    return null;
  }

  const files = await dirResponse.json();
  const dateFiles = files.filter(f => f.name.startsWith(`${date}-`) && f.name.endsWith('.json'));

  if (dateFiles.length === 0) {
    console.log(`⏭️  [RACEBOOK] ${date}のracebookファイルなし`);
    return null;
  }

  const venues = [];
  for (const file of dateFiles) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/${dirPath}/${file.name}`;
    const fetchHeaders = GITHUB_TOKEN ? { 'Authorization': `token ${GITHUB_TOKEN}` } : {};
    const response = await fetch(rawUrl, { headers: fetchHeaders });
    if (!response.ok) continue;

    const rbData = JSON.parse(await response.text());
    console.log(`   ✅ [RACEBOOK] ${file.name} 取得完了 (${rbData.races?.length || 0}R)`);

    venues.push(convertRacebookToPredictions(rbData, date));
  }

  if (venues.length === 0) return null;
  return venues.length === 1 ? venues[0] : { venues };
}

function convertRacebookToPredictions(rbData, date) {
  return {
    raceDate: date,
    date: date,
    track: rbData.track,
    venue: rbData.track,
    totalRaces: rbData.races?.length || 0,
    source: 'racebook',
    races: (rbData.races || []).map(r => ({
      raceNumber: r.raceNumber,
      raceInfo: {
        raceNumber: `${r.raceNumber}R`,
        raceName: r.raceClass || '',
        distance: r.distance || '',
        raceType: r.conditions || '',
        startTime: r.startTime || ''
      },
      horses: (r.horses || []).map(h => {
        // marks配列 → 印1〜印N object に変換（逆順: 本紙=配列末尾 → 印1に）
        // adjustPredictionのcustomScore計算（印1×4+印2×3+印3×2+印4×1）で使用
        const marksObj = {};
        const marksArr = Array.isArray(h.marks) ? [...h.marks].reverse() : [];
        for (let mi = 0; mi < marksArr.length; mi++) {
          marksObj[`印${mi + 1}`] = marksArr[mi];
        }
        return {
          number: h.number,
          name: h.name,
          totalScore: h.totalScore || 0,
          assignment: '無', // 既存ロジックで再割り当てさせる
          jockey: h.jockey || '',
          trainer: h.trainer || '',
          seirei: h.sexAge || '',
          kinryo: h.weight != null ? String(h.weight) : '',
          computerIndex: h.computerIndex || null,
          marks: marksObj,
          _pastRaces: h.pastRaces || [],
          _training: h.training || null,
          _shortComment: h.shortComment || null,
          _predictedOdds: h.predictedOdds || null,
          _sire: h.sire || null
        };
      })
    }))
  };
}

/**
 * racebook JSONをhorseDataMapに変換（純粋関数）
 */
function buildHorseDataMapFromRacebook(rbData, targetMap = new Map()) {
  for (const race of (rbData.races || [])) {
    for (const horse of (race.horses || [])) {
      if (!horse.name) continue;
      const data = {
        jockey: horse.jockey || null,
        trainer: horse.trainer || null,
        weight: horse.weight || null,
        age: horse.sexAge || null,
        sire: horse.sire || null
      };
      if (horse.pastRaces && horse.pastRaces.length > 0) {
        // racebook pastRaces は古い順([0]=最古) で保存されている。
        // 消費側(featureScores / AI解説 / UI)は [0]=前走 を前提とするため、
        // ここで新しい順に並べ替える。
        data.recentRaces = horse.pastRaces.slice(-5).reverse().map(pr => ({
          date: null, venue: pr.venue || null,
          distance: pr.distance || null,
          distanceMeters: pr.distanceMeters || null,
          rank: pr.finish, finishStatus: null, headCount: null,
          raceName: pr.raceClass || null, popularity: null,
          passingOrder: null, last3f: pr.final3F || null,
          time: pr.time || null, paceType: pr.paceType || null,
          bodyWeight: pr.bodyWeight || null, winner: pr.winner || null
        }));
      }
      targetMap.set(horse.name, data);
    }
  }
  return targetMap;
}

/**
 * レース名の正規化（全角/半角・空白・装飾記号を吸収）
 */
function normalizeRaceName(s) {
  if (!s) return '';
  return String(s)
    .replace(/\s+/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .trim();
}

/**
 * 内容ベース照合でracebookからpastRacesを取得
 *
 * 仕様:
 * - 指定月の同venueコード別racebookファイルを全件列挙
 * - 馬名一致率 * 0.7 + レース名一致率 * 0.3 の総合スコア算出
 * - 総合スコア70%以上 かつ 2位差10pt以上 のファイルを採用
 * - 条件未達なら warning を出して recentRaces無しで進行
 *
 * @param {string} date
 * @param {string} category - 'nankan' | 'jra' | 'local'
 * @param {Set<string>} predHorseNames - 予想側の馬名集合
 * @param {Set<string>} predRaceNames - 予想側のレース名集合（正規化済み）
 */
async function fetchRacebookPastRaces(date, category = 'nankan', predHorseNames = null, predRaceNames = null) {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const [year, month] = date.split('-');
  const dirPath = `${category}/racebook/${year}/${month}`;
  const owner = 'apol0510';
  const repo = 'keiba-data-shared';

  console.log(`📡 [RACEBOOK-PAST] 内容ベース照合: ${dirPath}`);

  const headers = GITHUB_TOKEN ? {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'keiba-intelligence-import'
  } : {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'keiba-intelligence-import'
  };

  try {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}`;
    const dirResponse = await fetch(apiUrl, { headers });
    if (!dirResponse.ok) {
      console.warn(`[RACEBOOK-PAST] ディレクトリ取得失敗: ${dirResponse.status}`);
      return null;
    }

    const files = await dirResponse.json();
    const jsonFiles = files.filter(f => f.name.endsWith('.json') && /^\d{4}-\d{2}-\d{2}-[A-Za-z0-9]+\.json$/.test(f.name));
    if (jsonFiles.length === 0) return null;

    // 同日付のracebookファイルが存在すればそれを採用（ファイル名 = 信頼可能な証拠）
    // 内容ベース照合の前にショートカットし、予想より先に他会場racebookだけ存在して
    // 低スコアで誤って失敗するのを防ぐ
    const sameDateFiles = jsonFiles.filter(f => f.name.startsWith(`${date}-`));
    if (sameDateFiles.length > 0) {
      console.log(`✅ [RACEBOOK-PAST] 同日付ファイル ${sameDateFiles.length}件を採用: ${sameDateFiles.map(f => f.name).join(', ')}`);
      const map = new Map();
      for (const file of sameDateFiles) {
        const rbData = await fetchRacebookFile(dirPath, file.name, owner, repo, GITHUB_TOKEN);
        if (rbData) buildHorseDataMapFromRacebook(rbData, map);
      }
      console.log(`✅ [RACEBOOK-PAST] 同日付モード: ${map.size}頭取得`);
      return map.size > 0 ? map : null;
    }

    // 馬名・レース名情報が無い場合は従来動作（日付ファイル名一致）にフォールバック
    const canScore = predHorseNames instanceof Set && predHorseNames.size > 0;
    if (!canScore) {
      console.warn(`[RACEBOOK-PAST] ⚠️ 予想馬名未提供 → 同日付ファイルなしで終了`);
      return null;
    }

    // venueコード別にグループ化
    const byVenue = new Map();
    for (const f of jsonFiles) {
      const m = f.name.match(/^\d{4}-\d{2}-\d{2}-([A-Za-z0-9]+)\.json$/);
      if (!m) continue;
      const code = m[1].toUpperCase();
      if (!byVenue.has(code)) byVenue.set(code, []);
      byVenue.get(code).push(f.name);
    }

    const horseDataMap = new Map();
    const totalHorseCount = predHorseNames.size;
    const totalRaceCount = predRaceNames ? predRaceNames.size : 0;
    const failedVenues = []; // {venueCode, bestScore, diff, candidates}
    let adoptedCount = 0;

    for (const [venueCode, fileList] of byVenue) {
      console.log(`🔎 [MATCH] venue=${venueCode} 候補ファイル数=${fileList.length}`);
      const scored = [];

      for (const filename of fileList) {
        const rbData = await fetchRacebookFile(dirPath, filename, owner, repo, GITHUB_TOKEN);
        if (!rbData) continue;

        const rbHorses = new Set();
        const rbRaces = new Set();
        for (const r of (rbData.races || [])) {
          if (r.raceClass) rbRaces.add(normalizeRaceName(r.raceClass));
          for (const h of (r.horses || [])) if (h.name) rbHorses.add(h.name);
        }

        let horseMatch = 0;
        for (const n of rbHorses) if (predHorseNames.has(n)) horseMatch++;
        let raceMatch = 0;
        if (predRaceNames) for (const n of rbRaces) if (predRaceNames.has(n)) raceMatch++;

        const horseRate = totalHorseCount > 0 ? horseMatch / totalHorseCount : 0;
        const raceRate = totalRaceCount > 0 ? raceMatch / totalRaceCount : 0;
        const score = horseRate * 0.7 + raceRate * 0.3;

        scored.push({ filename, rbData, horseMatch, raceMatch, score });
      }

      scored.sort((a, b) => b.score - a.score);

      const best = scored[0];
      const second = scored[1];
      const diff = best && second ? (best.score - second.score) : (best ? best.score : 0);
      const adopted = best && best.score >= 0.7 && diff >= 0.1;

      for (const s of scored) {
        const mark = (s === best && adopted) ? '✅ 採用' : '';
        console.log(`  [MATCH] file=${s.filename} horse=${s.horseMatch}/${totalHorseCount} race=${s.raceMatch}/${totalRaceCount} score=${(s.score * 100).toFixed(0)}% ${mark}`);
      }

      if (adopted) {
        buildHorseDataMapFromRacebook(best.rbData, horseDataMap);
        adoptedCount++;
      } else {
        failedVenues.push({
          venueCode,
          bestScore: best ? best.score : 0,
          diff,
          candidates: scored.map(s => ({ filename: s.filename, score: s.score, horseMatch: s.horseMatch, raceMatch: s.raceMatch }))
        });
        if (best) {
          console.error(`  ❌ [ERROR] ${venueCode} racebook一致候補なし: bestScore=${(best.score * 100).toFixed(0)}%, diff=${(diff * 100).toFixed(0)}pt`);
        } else {
          console.error(`  ❌ [ERROR] ${venueCode} racebook候補ファイルが一切取得できませんでした`);
        }
      }
    }

    // 1件も照合できなかった場合: 同日付racebookが未保存の可能性が高いため
    // importを中断せず、recentRaces無しで継続（特徴量は一部デフォルト値になるが import自体は成功させる）
    if (adoptedCount === 0) {
      console.warn(`\n⚠️  [RACEBOOK-PAST] 同日付ファイルなし＋内容一致率70%未満 → recentRaces無しで続行`);
      console.warn(`   予想: ${totalHorseCount}頭 / ${totalRaceCount}レース`);
      console.warn(`   比較したファイル:`);
      for (const fv of failedVenues) {
        console.warn(`   [venue=${fv.venueCode}] bestScore=${(fv.bestScore * 100).toFixed(0)}% diff=${(fv.diff * 100).toFixed(0)}pt`);
        for (const c of fv.candidates) {
          console.warn(`     - ${c.filename}: horse=${c.horseMatch}/${totalHorseCount} race=${c.raceMatch}/${totalRaceCount} score=${(c.score * 100).toFixed(0)}%`);
        }
      }
      return null;
    }

    console.log(`✅ [RACEBOOK-PAST] ${horseDataMap.size}頭のpastRacesを取得 (${adoptedCount}会場採用)`);
    return horseDataMap.size > 0 ? horseDataMap : null;
  } catch (err) {
    // fetch系のネットワークエラーは継続可能としてnullを返す
    console.warn('[RACEBOOK-PAST] 取得エラー:', err.message);
    return null;
  }
}

async function fetchRacebookFile(dirPath, filename, owner, repo, GITHUB_TOKEN) {
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/${dirPath}/${filename}`;
  const headers = GITHUB_TOKEN ? { 'Authorization': `token ${GITHUB_TOKEN}` } : {};
  const res = await fetch(rawUrl, { headers });
  if (!res.ok) return null;
  try { return JSON.parse(await res.text()); } catch { return null; }
}

/**
 * keiba-data-sharedから予想JSONを取得（従来の統合ファイル）
 *
 * GitHub Contents APIを使用（private対応）
 *
 * @param {string} date - 日付（YYYY-MM-DD）
 * @param {string} venue - 競馬場カテゴリ（デフォルト: 'nankan'）
 * @returns {Promise<Object>} 予想JSON
 */
async function fetchSharedPrediction(date, venue = 'nankan') {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

  // 日付をパースしてパスを構築
  const [year, month, day] = date.split('-');
  const path = `${venue}/predictions/${year}/${month}/${date}.json`;

  const owner = 'apol0510';
  const repo = 'keiba-data-shared';

  console.log(`📡 keiba-data-sharedから取得中: ${path}`);

  // ローカル実行時（GITHUB_TOKENなし）: raw.githubusercontent.comを使用（公開リポジトリ）
  if (!GITHUB_TOKEN) {
    console.log(`   ローカル実行モード: raw.githubusercontent.comからダウンロード`);
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/${path}`;
    const response = await fetch(rawUrl);

    if (!response.ok) {
      if (response.status === 404) {
        // 予想データがない場合は正常終了（エラーではない）
        console.log(`⏭️  予想データが見つかりません: ${path}`);
        console.log(`   まだ予想が作成されていない可能性があります`);
        return null; // nullを返す
      }
      throw new Error(`予想データの取得に失敗: ${response.status} ${response.statusText}`);
    }

    const content = await response.text();
    const prediction = JSON.parse(content);
    console.log(`✅ 取得成功: ${path}`);
    return prediction;
  }

  // GitHub Actions実行時: GitHub API経由（レート制限回避）
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

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
 * @returns {Promise<Object[]>} 調整済みNormalizedPrediction配列（複数会場対応）
 */
async function importPrediction(date, venue = 'nankan') {
  console.log(`\n━━━ ${date} 予想データ取り込み開始 ━━━`);

  // 優先順位1: 正規形式の会場別ファイル（nankan/predictions/YYYY/MM/YYYY-MM-DD-{VENUE}.json）
  let sharedJSON = await fetchVenuePredictions(date, venue, '');

  // 優先順位2: computer/ディレクトリから会場別ファイル（コンピ指数）
  if (!sharedJSON) {
    console.log(`📡 [IMPORT] computer/配下をチェック`);
    sharedJSON = await fetchComputerPredictions(date, venue);
  }

  // 優先順位3（非推奨）: 従来の統合ファイル（YYYY-MM-DD.json）
  if (!sharedJSON) {
    console.log(`⚠️  [IMPORT] 【非推奨】従来の単一ファイルを取得します`);
    sharedJSON = await fetchSharedPrediction(date, venue);
    if (sharedJSON) {
      console.log(`⚠️  [IMPORT] 警告: 単一ファイル形式は将来廃止されます。会場別ファイルに移行してください。`);
    }
  }

  // 優先順位4: racebook（race-data-importer保存データ）
  if (!sharedJSON) {
    console.log(`📡 [IMPORT] racebook配下をチェック`);
    sharedJSON = await fetchRacebookData(date, venue);
  }

  // 予想データがない場合はスキップ
  if (!sharedJSON) {
    console.log(`⏭️  [IMPORT] 予想データがないため、スキップします`);
    return null;
  }

  // 予想データから馬名・レース名を抽出（racebook内容ベース照合用）
  const predHorseNames = new Set();
  const predRaceNames = new Set();
  const venuesForNames = (sharedJSON.venues && Array.isArray(sharedJSON.venues)) ? sharedJSON.venues : [sharedJSON];
  for (const vd of venuesForNames) {
    for (const race of (vd.races || [])) {
      const rn = race.raceName || race.raceInfo?.raceName;
      if (rn) predRaceNames.add(normalizeRaceName(rn));
      for (const h of (race.horses || [])) {
        if (h.name) predHorseNames.add(h.name);
      }
    }
  }
  console.log(`🔍 [IMPORT] 予想データ: ${predHorseNames.size}頭 / ${predRaceNames.size}レース`);

  // 出馬表データ（recentRaces）を取得
  let horseDataMap = await fetchEntriesData(date, venue);
  // entries未保存時はracebookのpastRacesで補完（内容ベース照合）
  if (!horseDataMap || horseDataMap.size === 0) {
    horseDataMap = await fetchRacebookPastRaces(date, venue, predHorseNames, predRaceNames);
  }

  // recentRaces紐付け結果をログ（0件なら警告）
  if (horseDataMap && horseDataMap.size > 0) {
    let withRecent = 0;
    for (const v of horseDataMap.values()) {
      if (Array.isArray(v) ? v.length > 0 : (v?.recentRaces?.length > 0)) withRecent++;
    }
    console.log(`🧩 [IMPORT] recentRaces紐付け: ${withRecent}/${horseDataMap.size}頭 (馬名マップ総数)`);
    if (withRecent === 0) console.warn(`⚠️  [IMPORT] recentRaces 0件 → 特徴量50固定の可能性`);
  } else {
    console.warn(`⚠️  [IMPORT] horseDataMap取得失敗 → recentRaces無しで継続`);
  }

  // 【複数会場対応】venues配列があるか確認
  if (sharedJSON.venues && Array.isArray(sharedJSON.venues) && sharedJSON.venues.length > 0) {
    // 複数会場形式（venues配列）
    console.log(`📍 [IMPORT] 複数会場形式を検出: ${sharedJSON.venues.length}会場`);

    const results = [];

    for (const venueData of sharedJSON.venues) {
      const venueName = venueData.venue || venueData.name || '不明';
      console.log(`\n⚙️  ${venueName} の正規化 + 調整ルール適用中...`);

      const normalizedAndAdjusted = normalizeAndAdjust(venueData);

      console.log(`✅ ${venueName} 正規化完了`);
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

      results.push(normalizedAndAdjusted);
    }

    return { results, horseDataMap };
  } else {
    // 単一会場形式（従来の形式・非推奨）
    console.log(`⚠️  [IMPORT] 【非推奨】単一会場形式`);

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

    return { results: [normalizedAndAdjusted], horseDataMap }; // オブジェクトで返す
  }
}

/**
 * keiba-data-sharedから出馬表（entries）JSONを取得
 * 各馬のrecentRaces（直近5走成績）を含む
 *
 * @param {string} date - 日付（YYYY-MM-DD）
 * @param {string} venue - 競馬場カテゴリ（デフォルト: 'nankan'）
 * @returns {Promise<Map|null>} 馬名→recentRacesのMap
 */
async function fetchEntriesData(date, venue = 'nankan') {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const [year, month] = date.split('-');
  const owner = 'apol0510';
  const repo = 'keiba-data-shared';

  // entriesディレクトリのファイル一覧を取得
  const dirPath = `${venue}/entries/${year}/${month}`;
  const headers = GITHUB_TOKEN ? {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'keiba-intelligence-import'
  } : {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'keiba-intelligence-import'
  };

  console.log(`📡 [ENTRIES] 出馬表データ取得中: ${dirPath}`);

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}`;
  const dirResponse = await fetch(apiUrl, { headers });

  if (!dirResponse.ok) {
    console.log(`⏭️  [ENTRIES] 出馬表ディレクトリが見つかりません: ${dirPath}`);
    return null;
  }

  const files = await dirResponse.json();
  const dateFiles = files.filter(f => f.name.startsWith(`${date}-`) && f.name.endsWith('.json'));

  if (dateFiles.length === 0) {
    console.log(`⏭️  [ENTRIES] ${date}の出馬表が見つかりません`);
    return null;
  }

  // 馬名→recentRacesのMap（全会場分統合）
  const horseDataMap = new Map();

  for (const file of dateFiles) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/${dirPath}/${file.name}`;
    const response = await fetch(rawUrl, GITHUB_TOKEN ? { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } } : {});

    if (!response.ok) continue;

    const entryData = JSON.parse(await response.text());
    console.log(`   ✅ [ENTRIES] ${file.name} 取得完了`);

    if (entryData.races) {
      for (const race of entryData.races) {
        for (const horse of (race.horses || [])) {
          if (horse.name && horse.recentRaces && horse.recentRaces.length > 0) {
            // 直近3走に絞って必要なフィールドだけ保持
            const recent = horse.recentRaces.slice(0, 3).map(r => ({
              date: r.date,
              venue: r.venue,
              distance: r.distance,
              rank: r.finish,
              finishStatus: r.finishStatus || null,
              headCount: r.headCount,
              raceName: r.raceName,
              popularity: r.popularity,
              passingOrder: r.passingOrder || null,
              last3f: r.last3f || null
            }));
            horseDataMap.set(horse.name, recent);
          }
        }
      }
    }
  }

  console.log(`✅ [ENTRIES] ${horseDataMap.size}頭の過去走データを取得`);
  return horseDataMap;
}

/**
 * keiba-data-shared標準フォーマットを既存の予想ページフォーマットに変換
 *
 * @param {Object} data - 正規化・調整済みデータ
 * @param {string} date - 日付
 * @param {Map|null} horseDataMap - 馬名→recentRacesのMap
 * @returns {Object} 既存フォーマット
 */
function convertToLegacyFormat(data, date, horseDataMap = null) {
  // メインレース判定は会場別レース数で行う（防御）。
  // 通常 convertToLegacyFormat は per-venue で呼ばれるため
  // data.races は単一会場のレースだけだが、念のため race.venue を見て
  // 会場別にレース数を数える。venue が race にない場合は data.venue で補う。
  const dataVenue = data.venue || '';
  const racesByVenue = new Map();
  for (const r of (Array.isArray(data.races) ? data.races : [])) {
    const v = r.venue || r.raceInfo?.venue || dataVenue;
    racesByVenue.set(v, (racesByVenue.get(v) || 0) + 1);
  }
  const predictions = data.races.map((race) => {
    // 役割別に馬を抽出
    const honmei = race.horses.find(h => h.role === '本命');
    const taikou = race.horses.find(h => h.role === '対抗');
    const main = race.horses.filter(h => h.role === '本命' || h.role === '対抗' || h.role === '単穴' || h.role === '連下最上位');
    const renka = race.horses.filter(h => h.role === '連下');
    const osae = race.horses.filter(h => h.role === '補欠' || h.role === '抑え');

    // 買い目生成（馬単）
    let umatanLines = [];

    // メインレースは最大10点ロジック（本命軸・上位5頭・双方向）
    const venueKey = race.venue || race.raceInfo?.venue || dataVenue;
    const venueRaces = racesByVenue.get(venueKey) || (Array.isArray(data.races) ? data.races.length : 0);
    if (isMainRace(race.raceNumber, venueRaces)) {
      umatanLines = generateMainRaceUmatanLines(race.horses);
    } else if (honmei || taikou) {
      // 通常レース: 本命軸 + 対抗軸の従来ロジック
      if (honmei) {
        const aite = main.filter(h => h.number !== honmei.number).map(h => h.number).join('.');
        const renkaNumbers = renka.map(h => h.number).join('.');
        const osaeNumbers = osae.map(h => h.number).join('.');

        let line = `${honmei.number}-${aite}`;
        if (renkaNumbers) line += `.${renkaNumbers}`;
        if (osaeNumbers) line += `(抑え${osaeNumbers})`;
        umatanLines.push(line);
      }

      if (taikou) {
        const aite = main.filter(h => h.number !== taikou.number).map(h => h.number).join('.');
        const renkaNumbers = renka.map(h => h.number).join('.');
        const osaeNumbers = osae.map(h => h.number).join('.');

        let line = `${taikou.number}-${aite}`;
        if (renkaNumbers) line += `.${renkaNumbers}`;
        if (osaeNumbers) line += `(抑え${osaeNumbers})`;
        umatanLines.push(line);
      }
    }

    return {
      raceInfo: {
        date: date,
        venue: data.venue,
        raceNumber: race.raceNumber,
        raceName: race.raceInfo?.raceName || race.raceName || `第${race.raceNumber}レース`,
        startTime: race.raceInfo?.startTime || '', // 発走時刻
        distance: race.raceInfo?.distance || '', // 距離
        horseCount: race.horses?.length || 0 // 頭数
      },
      horses: race.horses
        .map(h => {
          const horseObj = {
            horseNumber: h.number,
            horseName: h.name,
            pt: (() => { const v = Number(h.displayScore) || Number(h.rawScore) || 70; return isNaN(v) ? 70 : v; })(), // ptフィールド（数値保証）
            role: h.role, // 印1システムではroleをそのまま保持
            jockey: h.jockey || h.kisyu || '', // 騎手
            trainer: h.trainer || h.kyusya || '', // 厩舎
            age: h.age || h.seirei || '', // 馬齢
            weight: h.weight || h.kinryo || '' // 斤量
          };
          // racebook由来の基本情報で補完
          if (horseDataMap && horseDataMap.has(h.name)) {
            const rbInfo = horseDataMap.get(h.name);
            if (rbInfo && typeof rbInfo === 'object' && !Array.isArray(rbInfo)) {
              if (!horseObj.jockey && rbInfo.jockey) horseObj.jockey = rbInfo.jockey;
              if (!horseObj.trainer && rbInfo.trainer) horseObj.trainer = rbInfo.trainer;
              if (!horseObj.weight && rbInfo.weight) horseObj.weight = String(rbInfo.weight);
              if (!horseObj.age && rbInfo.age) horseObj.age = rbInfo.age;
              if (rbInfo.sire) horseObj.sire = rbInfo.sire;
            }
          }
          // 過去走データ: racebook由来(_pastRaces) > horseDataMap > entries
          // racebook pastRaces は古い順([0]=最古) → 新しい順に反転
          if (h._pastRaces && h._pastRaces.length > 0) {
            horseObj.recentRaces = h._pastRaces.slice(-5).reverse().map(pr => ({
              date: null, venue: pr.venue || null,
              distance: pr.distance || null,
              distanceMeters: pr.distanceMeters || null,
              rank: pr.finish, finishStatus: null, headCount: null,
              raceName: pr.raceClass || null, popularity: null,
              passingOrder: null, last3f: pr.final3F || null,
              time: pr.time || null, paceType: pr.paceType || null,
              bodyWeight: pr.bodyWeight || null, winner: pr.winner || null
            }));
            horseObj.recentFormSource = 'racebook';
          } else if (horseDataMap && horseDataMap.has(h.name)) {
            const mapData = horseDataMap.get(h.name);
            if (Array.isArray(mapData)) {
              horseObj.recentRaces = mapData;
              horseObj.recentFormSource = 'entries';
            } else if (mapData && mapData.recentRaces) {
              horseObj.recentRaces = mapData.recentRaces;
              horseObj.recentFormSource = 'racebook';
            }
          }
          if (h._training) horseObj.training = h._training;
          if (h._shortComment) horseObj.shortComment = h._shortComment;
          if (h._predictedOdds) horseObj.predictedOdds = h._predictedOdds;
          if (h._sire) horseObj.sire = h._sire;
          return horseObj;
        })
        .sort((a, b) => {
          // 役割の優先順位（印1システム）
          const roleOrder = { '本命': 1, '対抗': 2, '単穴': 3, '連下最上位': 4, '連下': 5, '補欠': 6, '抑え': 7, '無': 8 };
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
function savePrediction(date, normalizedAndAdjusted, horseDataMap = null) {
  console.log(`\n💾 [SAVE] 保存処理開始...`);

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

  console.log(`📁 [SAVE] 保存先: ${filePath}`);

  // ディレクトリ作成（存在しない場合）
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
    console.log(`📁 ディレクトリ作成: ${dirPath}`);
  }

  // 既存フォーマットに変換
  const convertedData = convertToLegacyFormat(normalizedAndAdjusted, date, horseDataMap);

  // 【再発防止】データ検証を実行
  console.log(`🔍 データ検証中...`);
  try {
    validateNankanPrediction(convertedData);
    console.log(`   ✅ データ検証成功（本命・対抗・単穴の整合性確認済み）`);
  } catch (err) {
    console.error(`\n❌ データ検証失敗:\n${err.message}`);
    console.error(`\n⚠️  保存を中止します（データ品質保護）`);
    throw err; // エラーを投げて処理を中断
  }

  // JSON文字列化（整形）
  const newContent = JSON.stringify(convertedData, null, 2);

  // 既存ファイルとの比較（ハッシュ比較）
  if (existsSync(filePath)) {
    const existingContent = readFileSync(filePath, 'utf-8');

    // ハッシュ計算
    const existingHash = crypto.createHash('sha256').update(existingContent).digest('hex');
    const newHash = crypto.createHash('sha256').update(newContent).digest('hex');

    if (existingHash === newHash) {
      console.log(`⏭️  [SAVE] スキップ: 既存データと同一です`);
      return false; // no-op
    } else {
      console.log(`🔄 [SAVE] 更新: 既存データと差分があります`);
    }
  } else {
    console.log(`🆕 [SAVE] 新規作成`);
  }

  // ファイル書き込み
  writeFileSync(filePath, newContent, 'utf-8');
  console.log(`✅ [SAVE] 保存完了: ${filePath}`);
  console.log(`   会場: ${venue} (${venueSlug})`);

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

    // 会場コード付き日付を自動除去（例: 2026-02-20-OOI → 2026-02-20）
    const dateMatch = date.match(/^(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      const cleanDate = dateMatch[1];
      if (cleanDate !== date) {
        console.log(`📅 会場コードを除去: ${date} → ${cleanDate}`);
        date = cleanDate;
      }
    }

    // 日付フォーマット検証
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error('日付はYYYY-MM-DD形式で指定してください');
    }

    // 取り込み実行
    const importResult = await importPrediction(date);

    // 予想データがない場合は正常終了
    if (!importResult || !importResult.results || importResult.results.length === 0) {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('⏭️  予想データがないため、処理を終了します');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      return; // 正常終了
    }

    const { results, horseDataMap } = importResult;

    // 【複数会場対応】各会場のデータを保存
    console.log(`\n📦 [BUILD] 保存対象: ${results.length}会場`);
    const savedFiles = [];
    let totalSaved = 0;

    for (const normalizedAndAdjusted of results) {
      const saved = savePrediction(date, normalizedAndAdjusted, horseDataMap);
      if (saved) {
        totalSaved++;
        const venue = normalizedAndAdjusted.venue || '大井';
        const venueMap = { '大井': 'ooi', '船橋': 'funabashi', '川崎': 'kawasaki', '浦和': 'urawa' };
        const venueSlug = venueMap[venue] || 'ooi';
        savedFiles.push(`${date}-${venueSlug}.json`);
      }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    if (totalSaved > 0) {
      console.log(`✅ [BUILD] 生成ファイル一覧:`);
      savedFiles.forEach(f => console.log(`   - ${f}`));
      console.log(`✅ 取り込み完了！（${totalSaved}/${results.length}会場）`);
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
