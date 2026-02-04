/**
 * normalizePrediction.js
 *
 * keiba-data-sharedのJSON（詳細/シンプル）を読み、NormalizedPredictionに変換
 *
 * フォーマット:
 * - 詳細: 全馬データ + assignments（本命/対抗/単穴/連下最上位/連下/補欠/無）
 * - シンプル: 買い目のみ、馬データなし
 *
 * 変換フロー:
 * 1. detectFormat(input) - フォーマット検出
 * 2. normalizeDetailed(input) or normalizeSimple(input) - 正規化
 * 3. normalizeAndAdjust(input) - 正規化 + 調整ルール適用
 */

import { adjustPrediction } from './adjustPrediction.js';

/**
 * 競馬場名から競馬場コードに変換
 *
 * @param {string} venueName - 競馬場名
 * @returns {string} 競馬場コード
 */
function getVenueCode(venueName) {
  const venueMap = {
    '大井': 'OI',
    '川崎': 'KA',
    '船橋': 'FU',
    '浦和': 'UR',
    '東京': 'TK',
    '中山': 'NA',
    '阪神': 'HN',
    '京都': 'KY',
    '中京': 'CK',
    '新潟': 'NG',
    '小倉': 'KO',
    '札幌': 'SP',
    '函館': 'HK',
    '福島': 'FK'
  };

  return venueMap[venueName] || venueName.toUpperCase().substring(0, 2);
}

/**
 * フォーマット検出
 *
 * @param {Object} input - 入力JSON
 * @returns {string} 'detailed' | 'simple'
 */
export function detectFormat(input) {
  // 詳細フォーマット: raceDate がある または races[0].raceInfo がある
  if (input.raceDate || (input.races && input.races.length > 0 && input.races[0].raceInfo)) {
    return 'detailed';
  }

  // シンプルフォーマット: date がある かつ horses が無い/空
  if (input.date && (!input.races || input.races.length === 0 ||
      !input.races[0].horses || input.races[0].horses.length === 0)) {
    return 'simple';
  }

  // デフォルト: シンプル
  return 'simple';
}

/**
 * 詳細フォーマット → NormalizedPrediction
 *
 * @param {Object} input - 詳細フォーマットJSON
 * @returns {Object} NormalizedPrediction
 */
export function normalizeDetailed(input) {
  const date = input.raceDate || input.date;
  const venue = input.track || input.venue;
  const venueCode = getVenueCode(venue);
  const totalRaces = input.totalRaces || (input.races ? input.races.length : 0);

  const normalizedRaces = (input.races || []).map(race => {
    // レース番号抽出（"10R" → 10）
    let raceNumber = race.raceInfo?.raceNumber || race.raceNumber;
    if (typeof raceNumber === 'string') {
      const match = raceNumber.match(/(\d+)/);
      raceNumber = match ? parseInt(match[1], 10) : 0;
    }

    const raceName = race.raceInfo?.raceName || race.raceName || '';

    // レース詳細情報を保持
    const raceInfo = {
      raceName: raceName,
      startTime: race.raceInfo?.startTime || '',
      distance: race.raceInfo?.distance || '',
      surface: race.raceInfo?.surface || '',
      raceType: race.raceInfo?.raceType || '',
      raceSubtitle: race.raceInfo?.raceSubtitle || ''
    };

    // 馬データ変換
    const horses = (race.horses || []).map(horse => {
      const rawScore = horse.totalScore || horse.rawScore || 0;
      const role = horse.assignment || horse.role || '無';

      return {
        number: horse.number,
        name: horse.name,
        rawScore: rawScore,
        displayScore: 0, // adjustPrediction()で計算
        role: role,
        mark: '', // adjustPrediction()で生成
        jockey: horse.kisyu || horse.jockey || '', // 騎手
        trainer: horse.kyusya || horse.trainer || '' // 厩舎
        // ⚠️ marks（記者印）は含めない（秘匿）
      };
    });

    // 買い目データ（存在する場合）
    const bettingLines = race.bettingLines || null;

    return {
      raceNumber,
      raceName,
      raceInfo, // レース詳細情報を追加
      horses,
      bettingLines,
      hasHorseData: horses.length > 0,
      isAbsoluteAxis: null // adjustPrediction()で計算
    };
  });

  return {
    date,
    venue,
    venueCode,
    totalRaces,
    races: normalizedRaces
  };
}

/**
 * シンプルフォーマット → NormalizedPrediction
 *
 * @param {Object} input - シンプルフォーマットJSON
 * @returns {Object} NormalizedPrediction
 */
export function normalizeSimple(input) {
  const date = input.date;
  const venue = input.venue;
  const venueCode = input.venueCode || getVenueCode(venue);
  const totalRaces = input.totalRaces || (input.races ? input.races.length : 0);

  const normalizedRaces = (input.races || []).map(race => {
    return {
      raceNumber: race.raceNumber,
      raceName: race.raceName || '',
      horses: [], // 馬データなし
      bettingLines: race.bettingLines || null,
      hasHorseData: false,
      isAbsoluteAxis: null // 判定不可
    };
  });

  return {
    date,
    venue,
    venueCode,
    totalRaces,
    races: normalizedRaces
  };
}

/**
 * 入力JSONをNormalizedPredictionに変換
 *
 * @param {Object} input - 詳細 or シンプルフォーマットJSON
 * @returns {Object} NormalizedPrediction
 */
export function normalizePrediction(input) {
  const format = detectFormat(input);

  if (format === 'detailed') {
    return normalizeDetailed(input);
  } else {
    return normalizeSimple(input);
  }
}

/**
 * 正規化 + 調整ルール適用
 *
 * hasHorseData=true の場合のみ adjustPrediction() を適用
 *
 * @param {Object} input - 詳細 or シンプルフォーマットJSON
 * @returns {Object} Adjusted NormalizedPrediction
 */
export function normalizeAndAdjust(input) {
  const normalized = normalizePrediction(input);

  // hasHorseData=true のレースのみ調整ルール適用
  const hasAnyHorseData = normalized.races.some(race => race.hasHorseData);

  if (hasAnyHorseData) {
    return adjustPrediction(normalized);
  } else {
    return normalized;
  }
}
