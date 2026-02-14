/**
 * validatePrediction.js
 *
 * 予想データの整合性を検証
 * 再発防止：role/assignment の誤変換を検出
 */

/**
 * JRA予想データの検証
 *
 * @param {Object} data - 変換後の予想データ
 * @throws {Error} 検証エラー
 */
export function validateJRAPrediction(data) {
  const errors = [];

  // venues配列がある場合
  if (data.venues && Array.isArray(data.venues)) {
    for (const venue of data.venues) {
      const predictions = venue.predictions || [];

      for (let i = 0; i < predictions.length; i++) {
        const race = predictions[i];
        const raceId = `${venue.venue}${race.raceInfo.raceNumber}R`;

        validateRace(race, raceId, errors);
      }
    }
  } else {
    // 単一会場の場合
    const predictions = data.predictions || [];

    for (let i = 0; i < predictions.length; i++) {
      const race = predictions[i];
      const raceId = `${data.eventInfo?.venue || '不明'}${race.raceInfo.raceNumber}R`;

      validateRace(race, raceId, errors);
    }
  }

  if (errors.length > 0) {
    throw new Error(`データ検証エラー（${errors.length}件）:\n${errors.join('\n')}`);
  }
}

/**
 * レースデータの検証
 *
 * @param {Object} race - レースデータ
 * @param {string} raceId - レース識別子
 * @param {Array} errors - エラー配列
 */
function validateRace(race, raceId, errors) {
  if (!race.horses || race.horses.length === 0) {
    return; // 馬データなしは許可
  }

  // 本命・対抗・単穴のカウント
  const honmeiList = race.horses.filter(h => h.role === '本命');
  const taikouList = race.horses.filter(h => h.role === '対抗');
  const tananaList = race.horses.filter(h => h.role === '単穴');
  const renkaTopList = race.horses.filter(h => h.role === '連下最上位');

  // 【検証1】本命は1頭のみ
  if (honmeiList.length === 0) {
    errors.push(`❌ ${raceId}: 本命が0頭（1頭必須）`);
  } else if (honmeiList.length > 1) {
    errors.push(`❌ ${raceId}: 本命が${honmeiList.length}頭（1頭のみ許可）`);
  }

  // 【検証2】対抗は1頭のみ
  if (taikouList.length === 0) {
    errors.push(`❌ ${raceId}: 対抗が0頭（1頭必須）`);
  } else if (taikouList.length > 1) {
    errors.push(`❌ ${raceId}: 対抗が${taikouList.length}頭（1頭のみ許可）`);
  }

  // 【検証3】単穴は1頭のみ
  if (tananaList.length > 1) {
    errors.push(`❌ ${raceId}: 単穴が${tananaList.length}頭（1頭のみ許可）- ${tananaList.map(h => `${h.horseNumber}番${h.horseName}`).join(', ')}`);
  }

  // 【検証4】連下最上位は1頭のみ
  if (renkaTopList.length > 1) {
    errors.push(`❌ ${raceId}: 連下最上位が${renkaTopList.length}頭（1頭のみ許可）- ${renkaTopList.map(h => `${h.horseNumber}番${h.horseName}`).join(', ')}`);
  }

  // 【検証5】PT値の整合性（本命 >= 対抗 >= 単穴の期待）
  if (honmeiList.length === 1 && taikouList.length === 1) {
    const honmei = honmeiList[0];
    const taikou = taikouList[0];

    // 本命と対抗が同じPTの場合は警告（エラーではない）
    if (honmei.pt < taikou.pt - 5) {
      errors.push(`⚠️  ${raceId}: 本命（${honmei.horseNumber}番 PT${honmei.pt}）が対抗（${taikou.horseNumber}番 PT${taikou.pt}）より5点以上低い`);
    }
  }

  // 【検証6】役割の値チェック（許可された値のみ）
  const allowedRoles = ['本命', '対抗', '単穴', '連下最上位', '連下', '補欠', '無', '抑え'];
  for (const horse of race.horses) {
    if (!allowedRoles.includes(horse.role)) {
      errors.push(`❌ ${raceId}: ${horse.horseNumber}番 - 不正な役割 "${horse.role}"`);
    }
  }
}

/**
 * 南関予想データの検証
 *
 * @param {Object} data - 変換後の予想データ
 * @throws {Error} 検証エラー
 */
export function validateNankanPrediction(data) {
  // 南関も同じ検証ロジック
  validateJRAPrediction(data);
}
