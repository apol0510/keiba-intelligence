#!/usr/bin/env node

/**
 * 結果データ自動取り込み・的中判定スクリプト（中央競馬版）
 *
 * keiba-data-sharedから中央競馬の結果データを取得し、予想と照合して的中判定を行う
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import crypto from 'crypto';

import { computeRecoveryDay } from '../src/lib/recoverySelection.js';
import { createSharedClient, resolveSharedToken } from './lib/sharedFetch.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// ── 特別競走名マスタ ──────────────────────────────────────────
// JV-Link 取り込み時に raceName が文字化け（鬟/逶/蛻/繝 等）または空だった
// 場合に、UI 表示用の displayName をこのマスタから補完する。
// キー形式: YYYY-MM-DD-{venueCode}-{raceNumber}  例: 2026-04-26-KYO-9
let SPECIALTY_RACE_MASTER = {};
try {
  const masterPath = join(projectRoot, 'src', 'data', 'specialty-race-master.json');
  if (existsSync(masterPath)) {
    const raw = JSON.parse(readFileSync(masterPath, 'utf-8'));
    // 「_」始まりキーは説明用（_comment 等）なので除外
    SPECIALTY_RACE_MASTER = Object.fromEntries(
      Object.entries(raw).filter(([k]) => !k.startsWith('_'))
    );
  }
} catch (e) {
  console.warn(`⚠️  specialty-race-master.json 読み込み失敗（補完なしで継続）: ${e.message}`);
}

// JRA 会場名 → 3文字コード
const JRA_VENUE_TO_CODE = {
  '東京': 'TOK', '中山': 'NAK', '京都': 'KYO', '阪神': 'HAN',
  '中京': 'CHU', '小倉': 'KOK', '新潟': 'NII', '福島': 'FKS',
  '札幌': 'SAP', '函館': 'HKD',
};
function venueToCode(venue) {
  return JRA_VENUE_TO_CODE[venue] || venue || '';
}

/**
 * 文字化け文字列か判定。SJIS-as-UTF-8 / UTF-8-as-SJIS の典型化け文字、
 * 連続する "?" / "?@" 等を検出する。
 */
const MOJIBAKE_MARKERS = ['鬟', '逶', '蛻', '繝', '縺', '豁', '譌', '蜻', '荵', '窶', '繧', '繪', '繡', '繞', '繦', '譖', '謇', '蛟', '蛛', '蜈', '�'];
function isMojibakeName(s) {
  if (!s) return false;
  const t = String(s);
  for (const m of MOJIBAKE_MARKERS) {
    if (t.indexOf(m) >= 0) return true;
  }
  // "?@" 連続 (SJIS 全角空白 0x81 0x40 が CP1252 経由で崩れたパターン)
  const qatMatches = t.match(/\?@/g);
  if (qatMatches && qatMatches.length >= 2) return true;
  // "?" や "@" の連続 3文字以上
  if (/\?{3,}/.test(t)) return true;
  if (/@{3,}/.test(t)) return true;
  return false;
}

// アラートメール送信URL（Netlify Function）
const ALERT_ENDPOINT = process.env.ALERT_ENDPOINT || 'https://keiba-intelligence.netlify.app/.netlify/functions/send-alert';
const IS_CI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

/**
 * 最終状態ゲート：archiveResultsJra.json（remote main最新）に指定日付が
 * 既に反映されていれば true を返す。アラート送信前の誤検知防止に使用。
 */
async function isDateAlreadyInArchive(date) {
  if (!date) return false;
  const url = `https://raw.githubusercontent.com/apol0510/keiba-intelligence/main/astro-site/src/data/archiveResultsJra.json?t=${Date.now()}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return false;
    const text = await res.text();
    return text.includes(`"date": "${date}"`) || text.includes(`"date":"${date}"`);
  } catch {
    return false;
  }
}

/**
 * アラートメール送信（JRA版）
 * 最終状態が成功（archiveに反映済み）なら送信しない
 * details には必ず stage/error/message を含めること
 */
async function sendAlert(type, date, details = {}, metadata = {}) {
  // CI環境でのみアラート送信（ローカル実行時はスキップ）
  if (!IS_CI) {
    console.log(`⏭️  ローカル実行のためアラート送信をスキップ`);
    return;
  }

  // 最終状態ゲート：「取り込み失敗」系アラートのみ、archive反映済みなら抑止
  const IMPORT_FAILURE_TYPES = new Set([
    'import-results-failure-jra',
    'import-results-failure',
    'archive-post-check-failed-jra',
    'archive-post-check-failed'
  ]);
  if (IMPORT_FAILURE_TYPES.has(type)) {
    const alreadyArchived = await isDateAlreadyInArchive(date);
    if (alreadyArchived) {
      console.log(`✅ [ALERT_SKIP] 最終状態が成功のためアラートを送信しません: ${type} (${date})`);
      console.log(`   理由: archiveResultsJra.json に ${date} が既に反映済み`);
      return;
    }
  }

  // 必須フィールド検証：「エラー内容不明」を絶対に出さない
  if (!details.error && !details.message && !details.stage) {
    details.error = '[詳細情報欠落] sendAlert呼び出し側で error/message/stage のいずれかを必ず指定してください';
    details.stack = new Error('missing details').stack;
  }
  if (!details.stage) details.stage = 'unknown';

  try {
    console.log(`📧 [ALERT_SEND] アラートメール送信中: ${type} (${date || 'N/A'}) stage=${details.stage}`);

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
 * keiba-data-sharedから結果データを取得（per-venue方式）
 * 統合JSON(YYYY-MM-DD.json)は使わず、会場別ファイルのみを正としてマージする
 */
async function fetchSharedResults(date, venue = 'jra', { env = process.env, client: _client, resolveToken: _rt } = {}) {
  const rt = _rt ?? resolveSharedToken;
  rt({ env }); // TOKEN_MISSING fail-fast（匿名 fallback 禁止）
  const client = _client ?? createSharedClient({ env });
  const [year, month] = date.split('-');

  console.log(`📡 keiba-data-sharedから取得中（per-venue方式）: ${date}`);
  return await fetchAndMergeVenueResults(date, year, month, client);
}

/**
 * 会場別結果ファイルを取得してマージ
 */
async function fetchAndMergeVenueResults(date, year, month, client) {
  // venue-codes.tsと一致させること: 福島=FKS, 函館=HKD
  const venueCodesJRA = ['TOK', 'KYO', 'HAN', 'NAK', 'CHU', 'KOK', 'NII', 'FKS', 'SAP', 'HKD'];

  const venues = [];
  let allRaces = [];

  for (const venueCode of venueCodesJRA) {
    const venuePath = `jra/results/${year}/${month}/${date}-${venueCode}.json`;
    // required:false = 404（未投入）→ null → スキップ。auth/5xx は throw（fatal）。
    const venueData = await client.fetchJson(venuePath, { ref: 'main', required: false });
    if (venueData === null) continue; // 404ならスキップ

    console.log(`   ✅ ${venueCode}: ${venueData.races?.length || 0}レース取得`);

    // 会場データを追加（各レースに venue を注入。auto-fetch由来のJSONはrace-levelにvenueが無い）
    if (venueData.races) {
      const venueName = venueData.venue || venueCode;
      for (const r of venueData.races) {
        if (!r.venue) r.venue = venueName;
        allRaces.push(r);
      }
      venues.push(venueName);
    }
  }

  if (allRaces.length === 0) {
    throw new Error(`結果データが見つかりません: ${date}（全会場の per-venue ファイル404）`);
  }

  console.log(`Found JRA results: ${venues.length} venues`);
  console.log(`✅ 会場別ファイルからマージ完了: ${allRaces.length}レース（${venues.join('・')}）`);

  return {
    date: date,
    venue: venues.join('・'),
    totalRaces: allRaces.length,
    races: allRaces,
    venues: venues
  };
}

/**
 * 予想データを読み込む（JRA版）
 */
function loadPrediction(date, venue) {
  // JRA版: predictions/jra/YYYY/MM/YYYY-MM-DD.json
  const [year, month] = date.split('-');
  const jraPath = join(projectRoot, 'src', 'data', 'predictions', 'jra', year, month, `${date}.json`);

  if (existsSync(jraPath)) {
    const content = readFileSync(jraPath, 'utf-8');
    return JSON.parse(content);
  }

  // 見つからない場合
  throw new Error(`予想データが見つかりません: ${jraPath} (会場: ${venue})`);
}

/**
 * 買い目の点数を計算
 */
function calculateBettingPoints(bettingLine) {
  // 買い目解析: "9-16.13.2.3.8.11(抑え12.4.5.6.14.15.10)"
  const match = bettingLine.match(/^(\d+)-(.+)$/);
  if (!match) return 0;

  const aitePart = match[2];

  // 本線相手馬を抽出
  const mainPart = aitePart.replace(/\(抑え.+\)/, '');
  const mainAite = mainPart.split('.').filter(n => n.match(/^\d+$/));
  const mainPoints = mainAite.length;

  // 抑え馬を抽出
  let osaePoints = 0;
  const osaeMatch = aitePart.match(/\(抑え([0-9.]+)\)/);
  if (osaeMatch) {
    const osaeAite = osaeMatch[1].split('.').filter(n => n.match(/^\d+$/));
    osaePoints = osaeAite.length;
  }

  // 合計点数（本線 + 抑え）
  return mainPoints + osaePoints;
}

/**
 * 会場名+番号のみ表記（「京都3レース」「東京1R」「京都3」等）を判定
 */
function isGenericVenueRaceName(raceName, venue, raceNumber) {
  if (!raceName) return true;
  const v = venue || '';
  const n = raceNumber;
  const trimmed = String(raceName).trim();
  if (!trimmed) return true;
  const generic = new RegExp(`^${v}\\s*${n}\\s*(R|レース)?$`);
  return generic.test(trimmed);
}

/**
 * raceName を表示用に正規化
 *   「京都3レース」「京都3」→「京都3R」
 *   「比良山特別」「湘南ステークス」→ そのまま
 *   未指定 → 「{venue}{number}R」
 */
function normalizeRaceName(raceName, venue, raceNumber) {
  const v = venue || '';
  const n = raceNumber;
  const fallback = `${v}${n}R`;
  if (isGenericVenueRaceName(raceName, v, n)) return fallback;
  return String(raceName).trim();
}

/**
 * 文字列が「クリーン」かを判定（補完判定用）。
 *   - 空でない、会場+番号 generic 表記でない、文字化けマーカー無し
 */
function isCleanRaceName(s, venue, raceNumber) {
  if (!s) return false;
  const t = String(s).trim();
  if (!t) return false;
  if (isGenericVenueRaceName(t, venue, raceNumber)) return false;
  if (isMojibakeName(t)) return false;
  return true;
}

/**
 * displayName を生成
 *   補完優先順:
 *     ① raceName（クリーンな正式競走名）
 *     ② 特別競走名マスタ（specialty-race-master.json: JV-Link 文字化けで raceName が
 *        破損した既知の特別競走を date+venueCode+raceNumber で復元）
 *     ③ raceSubtitle（クリーン）
 *     ④ raceConditionName（条件戦名: 「3歳未勝利」等。通常戦の表示用）
 *     ⑤ raceClass / raceCondition / title / name（互換フィールド）
 *     ⑥ fallback: 「{venue}{number}R」
 *
 *   ② を ④ より前に置く理由:
 *     特別競走では raceConditionName が「4歳上1勝クラス」等のクラス情報を持つが、
 *     ユーザーには specialty 名（"比良山特別" 等）を出したい。マスタヒットすれば
 *     それを優先し、マスタに無い通常戦は ④ で raceConditionName を出す。
 */
function buildDisplayName(race, venue, raceNumber) {
  const v = venue || '';
  const n = raceNumber;
  const fallback = `${v}${n}R`;

  // ① raceName（クリーン）
  if (isCleanRaceName(race.raceName, v, n)) {
    return String(race.raceName).trim();
  }

  // ② 特別競走名マスタ
  const date = race.date ? String(race.date).trim() : '';
  const venueCode = venueToCode(v);
  if (date && venueCode && n != null) {
    const masterKey = `${date}-${venueCode}-${n}`;
    const masterName = SPECIALTY_RACE_MASTER[masterKey];
    if (masterName) return String(masterName).trim();
  }

  // ③ raceSubtitle
  if (isCleanRaceName(race.raceSubtitle, v, n)) {
    return String(race.raceSubtitle).trim();
  }

  // ④ raceConditionName
  if (isCleanRaceName(race.raceConditionName, v, n)) {
    return String(race.raceConditionName).trim();
  }

  // ⑤ 互換フィールド
  for (const c of [race.raceClass, race.raceCondition, race.title, race.name]) {
    if (isCleanRaceName(c, v, n)) return String(c).trim();
  }

  // ⑥ fallback
  return fallback;
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

  // 予想データの形式を判定（新形式 venues[] or 旧形式 predictions/races[]）
  let predictionRaces = [];
  if (prediction.venues && Array.isArray(prediction.venues)) {
    // 新形式: venues[].predictions[] を全て展開
    for (const venueData of prediction.venues) {
      if (venueData.predictions && Array.isArray(venueData.predictions)) {
        predictionRaces = predictionRaces.concat(venueData.predictions);
      }
    }
  } else {
    // 旧形式: predictions or races
    predictionRaces = prediction.predictions || prediction.races || [];
  }

  for (const race of results.races) {
    const raceNumber = race.raceNumber;
    const raceVenue = race.venue; // 会場情報を取得

    // raceNumberを数値に正規化（"1R" → 1, 1 → 1）
    const normalizedRaceNumber = typeof raceNumber === 'string'
      ? parseInt(raceNumber.replace(/[^0-9]/g, ''))
      : raceNumber;

    // 会場名を正規化（略称対応）
    const normalizeVenue = (v) => {
      if (!v) return '';
      const venueMap = {
        '京都': 'KYO', 'KYO': 'KYO',
        '小倉': 'KOK', 'KOK': 'KOK',
        '東京': 'TOK', 'TOK': 'TOK',
        '中山': 'NAK', 'NAK': 'NAK',
        '阪神': 'HAN', 'HAN': 'HAN',
        '新潟': 'NII', 'NII': 'NII',
        '札幌': 'SAP', 'SAP': 'SAP',
        '函館': 'HKD', 'HKD': 'HKD',
        '福島': 'FKS', 'FKS': 'FKS',
        '中京': 'CHU', 'CHU': 'CHU'
      };
      return venueMap[v] || v;
    };

    const normalizedRaceVenue = normalizeVenue(raceVenue);

    // 予想データを検索（raceNumberとvenueの両方で一致）
    const predRace = predictionRaces.find(p => {
      const predRaceNum = p.raceInfo.raceNumber;
      const normalizedPredRaceNum = typeof predRaceNum === 'string'
        ? parseInt(predRaceNum.replace(/[^0-9]/g, ''))
        : predRaceNum;

      // raceNumberが一致しない場合はスキップ
      if (normalizedPredRaceNum !== normalizedRaceNumber) return false;

      // venueも一致するか確認
      const predVenue = p.raceInfo.venue || p.venue;
      const normalizedPredVenue = normalizeVenue(predVenue);

      return normalizedPredVenue === normalizedRaceVenue;
    });

    if (!predRace) {
      console.log(`⚠️  ${raceVenue} ${raceNumber}Rの予想データが見つかりません`);
      continue;
    }

    const bettingLines = predRace.bettingLines?.umatan || [];
    const hits = bettingLines.filter(line => checkUmatanHit(line, race));

    // 買い目点数を計算（全ラインの合計）
    const totalPoints = bettingLines.reduce((sum, line) => sum + calculateBettingPoints(line), 0);

    const first = race.results[0];
    const second = race.results[1];
    const third = race.results[2];

    // 馬単払戻金を取得
    const umatanPayout = race.payouts?.umatan?.[0] || null;
    const payoutAmount = umatanPayout?.payout || null;
    const payoutCombination = umatanPayout?.combination || null;

    // displayName: 特別競走名 > master > raceSubtitle > raceConditionName > 「{venue}{number}R」
    const displayName = buildDisplayName(race, raceVenue, normalizedRaceNumber);
    // raceName 正規化: 「京都3レース」→「京都3R」、ただし文字化け検出時は displayName を採用
    let normalizedRaceName = normalizeRaceName(race.raceName, raceVenue, normalizedRaceNumber);
    if (isMojibakeName(normalizedRaceName)) {
      normalizedRaceName = displayName;
    }
    // 条件戦名を archive にも保持しておく（後から表示変更しても再インポート不要にする）
    const raceConditionName = race.raceConditionName ? String(race.raceConditionName).trim() : null;

    raceResults.push({
      raceNumber,
      raceName: normalizedRaceName,
      displayName,
      raceConditionName,
      venue: raceVenue, // 会場情報を追加
      result: {
        first: { number: first.number, name: first.name },
        second: { number: second.number, name: second.name },
        third: { number: third.number, name: third.name }
      },
      bettingLines,
      bettingPoints: totalPoints,
      isHit: hits.length > 0,
      hitLines: hits,
      umatan: {
        combination: payoutCombination,
        payout: payoutAmount
      }
    });

    if (hits.length > 0) {
      const payoutInfo = payoutAmount ? ` (払戻: ${payoutAmount.toLocaleString()}円)` : '';
      console.log(`✅ ${raceVenue} ${raceNumber}R: 的中！ ${hits.join(', ')}${payoutInfo}`);
    } else {
      console.log(`❌ ${raceVenue} ${raceNumber}R: 不的中 (${first.number}-${second.number}-${third.number})`);
    }
  }

  return raceResults;
}

/**
 * archiveResultsJra.jsonに保存
 */
function saveArchive(date, venue, raceResults) {
  const archivePath = join(projectRoot, 'src', 'data', 'archiveResultsJra.json');

  let archive = [];
  if (existsSync(archivePath)) {
    const content = readFileSync(archivePath, 'utf-8');
    archive = JSON.parse(content);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 固定6点・案2「150%目標最近傍」回収率選定（開催終了後・開催単位で確定）
  //   AK と同一の単一源 src/lib/recoverySelection.js を使用（南関馬単/JRA馬単で同一・AK/KI 一致）。
  //   現Premium買い目の的中を candidateHit に保持し、案2で採用したレースだけを
  //   公開 isHit へ統一（的中数/的中率/payout/totalPayout/回収率が単一判定で一致）。
  //   投資は 6点固定（races × 6 × 100）・回収率 ≤ 200%・150% 最近傍。
  //   詳細: src/lib/recoverySelection.js / BET_POINT_LOGIC.md
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const { races: enrichedRaces, day } = computeRecoveryDay(raceResults, { pointsPerRace: 6 });
  const totalRaces = day.totalRaces;
  const hitRaces = day.hitRaces;
  const hitRate = day.hitRate;
  const betPointsPerRace = day.betPointsPerRace;
  const betAmount = day.betAmount;
  const totalPayout = day.totalPayout;
  const finalReturnRate = day.returnRate.toFixed(1);

  // 会場リストを取得（重複排除・ソート）
  const venues = [...new Set(raceResults.map(r => r.venue))].sort();
  const venueDisplay = venues.join('・');

  console.log(`\n📊 固定6点・案2選定: ${totalRaces}R × ${betPointsPerRace}点 = ${betAmount.toLocaleString()}円 / 採用払戻 ${totalPayout.toLocaleString()}円（候補払戻 ${day.rawTotalPayout.toLocaleString()}円・採用 ${hitRaces}/候補 ${day.candidateHitRaces}）→ 回収率 ${finalReturnRate}%`);

  const newEntry = {
    date,
    venue: venueDisplay, // "京都・小倉・東京" のように表示
    venues: venues, // 配列として保存
    ...day,
    races: enrichedRaces,
    verifiedAt: new Date().toISOString()
  };

  // 既存エントリを削除（同じ日付があれば上書き）
  archive = archive.filter(entry => entry.date !== date);

  // 新しいエントリを追加
  archive.unshift(newEntry);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 旧フォーマット混入チェック（再発防止）
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const archiveJson = JSON.stringify(archive);
  const forbiddenKeys = ['raceResults', 'honmeiHit', 'umatanHit', 'sanrenpukuHit'];

  for (const key of forbiddenKeys) {
    if (archiveJson.includes(`"${key}"`)) {
      console.error(`\n❌ アーカイブフォーマットエラー検出！`);
      console.error(`   旧フォーマットキー「${key}」が混入しています`);
      console.error(`   archiveResultsJra.json を確認してください\n`);
      throw new Error(`旧フォーマット「${key}」が混入しています（再発防止チェック）`);
    }
  }

  // 保存
  writeFileSync(archivePath, JSON.stringify(archive, null, 2), 'utf-8');
  console.log(`\n💾 アーカイブ保存完了: ${archivePath}`);
  console.log(`   日付: ${date}`);
  console.log(`   会場: ${venueDisplay}`);
  console.log(`   的中: ${hitRaces}/${totalRaces}R (${hitRate}%)`);
  console.log(`   買い目: ${betPointsPerRace}点/レース`);
  console.log(`   投資額: ${betAmount.toLocaleString()}円`);
  console.log(`   払戻額: ${totalPayout.toLocaleString()}円`);
  console.log(`   回収率: ${finalReturnRate}%`);
  console.log(`   ✅ フォーマット検証: 正常`);

  return newEntry;
}

/**
 * JRA の予想データが keiba-data-shared に存在するか認証付きで確認する。
 * 404 のみ「存在しない」として false を返す。
 * 401/403/429/5xx/timeout/malformed は throw（fatal）。anonymous fallback なし。
 * @param {string} date YYYY-MM-DD
 * @param {string} venueCode 会場コード (例: TOK)
 * @param {{client?:object}} [opts]
 * @returns {Promise<boolean>}
 */
async function checkSharedPredictionExists(date, venueCode, { client: _client } = {}) {
  const [year, month] = date.split('-');
  const sharedPredictionPath = `jra/predictions/${year}/${month}/${date}-${venueCode}.json`;
  const sharedClient = _client ?? createSharedClient();

  console.log(`\n🔍 keiba-data-sharedの予想データ存在確認中...`);
  // 404 → null → false。401/403/429/5xx/timeout は throw（fatal）。
  const data = await sharedClient.fetchJson(sharedPredictionPath, { ref: 'main', required: false });
  return data !== null;
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
      // 会場コード（-TOK, -KYO等）を自動除去
      date = date.replace(/-[A-Z]{3}$/, '');
    } else {
      // デフォルト: JST今日
      const now = new Date();
      const jstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
      date = jstNow.toISOString().split('T')[0];
    }

    console.log(`📅 指定された日付: ${date}\n`);
    console.log(`━━━ ${date} 中央競馬 的中判定開始 ━━━\n`);

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

      // JRA会場コードマップ（venue日本語名 → 会場コード3文字）
      const venueCodeMap = {
        '東京': 'TOK', '中山': 'NAK', '京都': 'KYO', '阪神': 'HAN',
        '中京': 'CHU', '小倉': 'KOK', '新潟': 'NII', '福島': 'FKS',
        '札幌': 'SAP', '函館': 'HKD'
      };
      const venueCode = venueCodeMap[venue] || venue;

      // keiba-data-sharedに予想データが存在するか確認（認証付き / anonymous fallbackなし）
      const [year, month] = date.split('-');
      const sharedPredictionPath = `jra/predictions/${year}/${month}/${date}-${venueCode}.json`;
      const predictionExists = await checkSharedPredictionExists(date, venueCode);

      if (predictionExists) {
        // 予想データが存在するのに読み込めなかった → 異常
        console.error(`\n🚨 異常検知：予想データが存在するのに読み込めませんでした！`);
        console.error(`   keiba-data-shared: ${sharedPredictionPath} (存在)`);
        console.error(`   keiba-intelligence: 読み込み失敗`);
        console.error(`   venue: ${venue}`);
        console.error(`   元のエラー: ${error.message}\n`);

        // アラート送信（stage/error/message を明示）
        await sendAlert('import-results-failure', date, {
          stage: 'fetch-predictions-jra',
          error: error.message || 'JRA予想データ読み込み失敗',
          message: `JRA予想データは存在するが読み込みに失敗。venue=${venue}`,
          stack: error.stack ? String(error.stack).slice(0, 800) : undefined,
          venue: venue,
          venueIsUndefined: venue === undefined || venue === 'undefined',
          sharedPredictionExists: true,
          sharedPredictionPath: sharedPredictionPath,
          localSearchPath: error.message
        }, {
          variant: 'jra',
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
    }

    // 3. 的中判定
    console.log(`\n🎯 的中判定実行中...\n`);
    const raceResults = verifyResults(prediction, results);

    // 4. アーカイブ保存
    const archiveEntry = saveArchive(date, venue, raceResults);

    // 会場別統計を計算
    const venueStats = new Map();
    raceResults.forEach(race => {
      const v = race.venue;
      if (!venueStats.has(v)) {
        venueStats.set(v, { total: 0, hit: 0, payout: 0 });
      }
      const stat = venueStats.get(v);
      stat.total++;
      if (race.isHit) {
        stat.hit++;
        stat.payout += race.umatan.payout || 0;
      }
    });

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`✅ 的中判定完了！`);
    console.log(`   会場: ${archiveEntry.venue}`);
    console.log(`   的中: ${archiveEntry.hitRaces}R / ${archiveEntry.totalRaces}R`);
    console.log(`   的中率: ${archiveEntry.hitRate}%`);
    console.log(`\n   【会場別実績】`);
    venueStats.forEach((stat, venueName) => {
      const hitRate = stat.total > 0 ? ((stat.hit / stat.total) * 100).toFixed(1) : '0.0';
      console.log(`   - ${venueName}: ${stat.hit}/${stat.total}R (${hitRate}%) 払戻: ${stat.payout.toLocaleString()}円`);
    });
    console.log(`\n   買い目: ${archiveEntry.betPointsPerRace}点/レース`);
    console.log(`   投資額: ${archiveEntry.betAmount.toLocaleString()}円`);
    console.log(`   払戻額: ${archiveEntry.totalPayout.toLocaleString()}円`);
    console.log(`   回収率: ${archiveEntry.returnRate}%`);
    const profit = archiveEntry.totalPayout - archiveEntry.betAmount;
    const profitSign = profit >= 0 ? '+' : '';
    console.log(`   損益: ${profitSign}${profit.toLocaleString()}円`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    // 5. 異常値検知・アラート送信
    if (archiveEntry.hitRate === 0 && archiveEntry.totalRaces >= 10) {
      console.log(`⚠️  異常値検知：的中率0%`);
      await sendAlert('zero-hit-rate', date, {
        stage: 'hit-rate-check-jra',
        error: `JRA的中率0%を検知（${archiveEntry.totalRaces}レース中 的中0）`,
        message: '異常値の可能性があるため確認が必要',
        hitRate: archiveEntry.hitRate,
        hitRaces: archiveEntry.hitRaces,
        totalRaces: archiveEntry.totalRaces,
        betAmount: archiveEntry.betAmount,
        totalPayout: archiveEntry.totalPayout,
        returnRate: archiveEntry.returnRate
      }, {
        variant: 'jra',
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

// テスト用 export（CLI動作は変えない。isDirectRun ガードで main は直接実行時のみ起動する）
export { fetchSharedResults, fetchAndMergeVenueResults, checkSharedPredictionExists };

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) main();
