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
 * @param {Object} options - オプション { skipMark1Override: boolean }
 * @returns {Object} 調整済み予想データ
 */
export function adjustPrediction(normalized, options = {}) {
  // ディープコピー（元データを変更しない）
  const adjusted = JSON.parse(JSON.stringify(normalized));

  // JRAデータの場合は印1による上書きをスキップ
  const skipMark1Override = options.skipMark1Override || false;

  // 各レースに対して調整処理を実行
  for (const race of adjusted.races) {

    // 馬データがない場合はスキップ
    if (!race.horses || race.horses.length === 0) {
      race.hasHorseData = false;
      race.isAbsoluteAxis = null;
      continue;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 0: 印1を基準に本命・対抗・単穴を決定（独自予想）
    // ⚠️ JRAデータの場合はスキップ（assignmentフィールドを保持）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    if (!skipMark1Override) {
      // Step 0-1: 印1が有効な馬を検出
      const honmeiMark1 = race.horses.find(h => h.mark1 === '◎');
      const taikouMark1 = race.horses.find(h => h.mark1 === '○');
      const tananaMark1 = race.horses.find(h => h.mark1 === '▲');

    // Step 0-2: 本命・対抗・単穴をリセット（印1が無効な馬を降格）
    for (const horse of race.horses) {
      // 現在本命・対抗・単穴になっている馬
      if (horse.role === '本命' || horse.role === '対抗' || horse.role === '単穴') {
        // 印1が有効（◎○▲）かチェック
        const isValidMark = horse.mark1 === '◎' || horse.mark1 === '○' || horse.mark1 === '▲';

        // 印1が無効な場合は降格
        if (isValidMark === false) {
          if (horse.rawScore >= 7) {
            horse.role = '連下最上位';
          } else if (horse.rawScore >= 3) {
            horse.role = '連下';
          } else {
            horse.role = '補欠';
          }
        }
      }
    }

    // Step 0-3: 印1がある馬を本命・対抗・単穴に設定（強制上書き）
    if (honmeiMark1) {
      honmeiMark1.role = '本命';
    }
    if (taikouMark1) {
      taikouMark1.role = '対抗';
    }
    if (tananaMark1) {
      tananaMark1.role = '単穴';
    }

    // Step 0-4: 念のため重複チェック（万が一印1が重複している場合）
    const honmeiList = race.horses.filter(h => h.role === '本命');
    const taikouList = race.horses.filter(h => h.role === '対抗');
    const tananaList = race.horses.filter(h => h.role === '単穴');

    if (honmeiList.length > 1) {
      for (const horse of honmeiList) {
        if (horse.mark1 !== '◎') {
          horse.role = horse.rawScore >= 7 ? '連下最上位' : (horse.rawScore >= 3 ? '連下' : '補欠');
        }
      }
    }

    if (taikouList.length > 1) {
      for (const horse of taikouList) {
        if (horse.mark1 !== '○') {
          horse.role = horse.rawScore >= 7 ? '連下最上位' : (horse.rawScore >= 3 ? '連下' : '補欠');
        }
      }
    }

    if (tananaList.length > 1) {
      for (const horse of tananaList) {
        if (horse.mark1 !== '▲') {
          horse.role = horse.rawScore >= 7 ? '連下最上位' : (horse.rawScore >= 3 ? '連下' : '補欠');
        }
      }
    }

    } // End of skipMark1Override check

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
    // Step 2: 本命15点以下の場合、本命と対抗をスワップ
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ⚠️ 印1で決定した役割を維持するため、無効化

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 3: 差4点以上の役割入れ替え
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ⚠️ 印1で決定した役割を維持するため、無効化

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
