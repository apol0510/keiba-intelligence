/**
 * adjustPrediction.js
 *
 * 正規化された予想データに対して調整ルールを適用
 *
 * 調整内容:
 * 1. displayScore計算（rawScore + 70、0点は0のまま）
 * 2. 本命15点以下の降格処理（本命→単穴、対抗→本命）
 * 3. 差4点以上の役割入れ替え（対抗→連下最上位、単穴→対抗、連下最上位→単穴）
 * 4. 連下3頭制限（連下最上位1頭維持 + 連下最大3頭、残りは補欠）
 * 5. 絶対軸判定（19/20点 or 差4点以上）
 * 6. 表示用印の割り当て
 *
 * ⚠️ 重要: marks（記者印）など入力材料は変更しない
 *          roleのみ調整対象
 */

/**
 * 役割名から表示用印記号に変換
 *
 * @param {string} role - 役割名
 * @returns {string} 印記号
 */
function getRoleMark(role) {
  const markMap = {
    '本命': '◎',
    '対抗': '○',
    '単穴': '▲',
    '連下最上位': '△',
    '連下': '△',
    '補欠': '×',
    '無': '-'
  };

  return markMap[role] || '-';
}

/**
 * 正規化された予想データに調整ルールを適用
 *
 * @param {Object} normalized - 正規化済み予想データ
 * @returns {Object} 調整済み予想データ
 */
export function adjustPrediction(normalized) {
  // ディープコピー（元データを変更しない）
  const adjusted = JSON.parse(JSON.stringify(normalized));

  // 各レースに対して調整処理を実行
  for (const race of adjusted.races) {

    // 馬データがない場合はスキップ
    if (!race.horses || race.horses.length === 0) {
      race.hasHorseData = false;
      race.isAbsoluteAxis = null;
      continue;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 1: displayScore計算
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    for (const horse of race.horses) {
      if (horse.rawScore > 0) {
        horse.displayScore = horse.rawScore + 70;
      } else {
        horse.displayScore = 0;
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 2: 本命15点以下の降格処理
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const honmei = race.horses.find(h => h.role === '本命');

    if (honmei && honmei.rawScore <= 15) {
      // 本命を単穴に降格
      honmei.role = '単穴';

      // 対抗を本命に昇格
      const taikou = race.horses.find(h => h.role === '対抗');
      if (taikou) {
        taikou.role = '本命';
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 3: 差4点以上の役割入れ替え
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 2で役割が変更されている可能性があるため再取得
    const currentHonmei = race.horses.find(h => h.role === '本命');
    const currentTaikou = race.horses.find(h => h.role === '対抗');

    if (currentHonmei && currentTaikou &&
        (currentHonmei.rawScore - currentTaikou.rawScore >= 4)) {

      // 役割入れ替え対象の馬を取得
      const tanana = race.horses.find(h => h.role === '単穴');
      const renkaTop = race.horses.find(h => h.role === '連下最上位');

      // 入れ替えルール：
      // 対抗 → 連下最上位
      // 単穴 → 対抗
      // 連下最上位 → 単穴
      // 本命はそのまま

      // 一時的に役割を保存（重複を避けるため）
      const tempRoles = new Map();

      // 対抗 → 連下最上位
      tempRoles.set(currentTaikou, '連下最上位');

      // 単穴 → 対抗（単穴が存在する場合）
      if (tanana) {
        tempRoles.set(tanana, '対抗');
      }

      // 連下最上位 → 単穴（連下最上位が存在する場合）
      if (renkaTop) {
        tempRoles.set(renkaTop, '単穴');
      }

      // 一括で役割を更新
      tempRoles.forEach((newRole, horse) => {
        horse.role = newRole;
      });
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 4: 連下3頭制限（連下最上位は保持）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // 連下最上位は1頭固定・変更なし（そのまま維持）
    const renkaTop = race.horses.find(h => h.role === '連下最上位');

    // 連下を抽出（連下最上位は除外）
    const renkaList = race.horses.filter(h => h.role === '連下');

    // rawScoreで降順ソート
    renkaList.sort((a, b) => b.rawScore - a.rawScore);

    // 上位3頭のみ連下、残りは補欠
    for (let i = 0; i < renkaList.length; i++) {
      if (i < 3) {
        renkaList[i].role = '連下';
      } else {
        renkaList[i].role = '補欠';
      }
    }

    // 結果: 連下最上位(1頭) + 連下(最大3頭) + 補欠(残り)

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 5: 絶対軸判定
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // 全調整処理後の本命を再取得
    const finalHonmei = race.horses.find(h => h.role === '本命');
    const finalTaikou = race.horses.find(h => h.role === '対抗');

    if (finalHonmei) {
      // 条件1: 本命が19点または20点
      if (finalHonmei.rawScore === 19 || finalHonmei.rawScore === 20) {
        race.isAbsoluteAxis = true;
      }
      // 条件2: 本命と対抗の差が4点以上
      else if (finalTaikou && (finalHonmei.rawScore - finalTaikou.rawScore >= 4)) {
        race.isAbsoluteAxis = true;
      }
      else {
        race.isAbsoluteAxis = false;
      }
    } else {
      race.isAbsoluteAxis = false;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 6: 表示用印の割り当て
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    for (const horse of race.horses) {
      horse.mark = getRoleMark(horse.role);
    }

    race.hasHorseData = true;
  }

  return adjusted;
}

/**
 * 調整ルールのテスト用ヘルパー関数
 *
 * @param {Object} race - レースデータ
 * @returns {Object} 調整結果のサマリー
 */
export function getAdjustmentSummary(race) {
  const honmei = race.horses.find(h => h.role === '本命');
  const taikou = race.horses.find(h => h.role === '対抗');
  const tanana = race.horses.filter(h => h.role === '単穴');
  const renkaTop = race.horses.find(h => h.role === '連下最上位');
  const renka = race.horses.filter(h => h.role === '連下');
  const hoseki = race.horses.filter(h => h.role === '補欠');
  const mu = race.horses.filter(h => h.role === '無');

  return {
    isAbsoluteAxis: race.isAbsoluteAxis,
    honmei: honmei ? `${honmei.number} ${honmei.name} (${honmei.rawScore}点)` : 'なし',
    taikou: taikou ? `${taikou.number} ${taikou.name} (${taikou.rawScore}点)` : 'なし',
    tananaCount: tanana.length,
    renkaTopCount: renkaTop ? 1 : 0,
    renkaCount: renka.length,
    hosekiCount: hoseki.length,
    muCount: mu.length,
    totalHorses: race.horses.length
  };
}
