/**
 * adjustPrediction.js
 *
 * 正規化された予想データに対して調整ルールを適用
 *
 * 🏇 南関競馬用調整ロジック:
 * 0. 印1を基準に本命・対抗・単穴を決定（独自予想）
 *    - 印1◎ → 本命
 *    - 印1○と印1▲ → rawScoreを比較して高い方を対抗、低い方を単穴
 * 1. displayScore計算（rawScore + 70、0点は0のまま）
 * 2. 本命15点以下の降格処理（本命→単穴、対抗→本命）
 * 3. 差4点以上の役割入れ替え（対抗→連下最上位、単穴→対抗、連下最上位→単穴）
 * 4. 連下3頭制限（連下最上位1頭維持 + 連下最大3頭、残りは補欠）
 * 5. 表示用印の割り当て
 *
 * 🏇 中央競馬（JRA）用調整ロジック:
 * - assignmentをそのまま保持（印1による上書きなし）
 * - displayScore計算と表示用印の割り当てのみ
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
 * 正規化された予想データに調整ルールを適用（南関競馬用）
 * 印1（◎○▲）を基準に本命・対抗・単穴を決定
 *
 * @param {Object} normalized - 正規化済み予想データ
 * @returns {Object} 調整済み予想データ
 */
export function adjustPredictionNankan(normalized) {
  // ディープコピー（元データを変更しない）
  const adjusted = JSON.parse(JSON.stringify(normalized));

  // 各レースに対して調整処理を実行
  for (const race of adjusted.races) {

    // 馬データがない場合はスキップ
    if (!race.horses || race.horses.length === 0) {
      race.hasHorseData = false;
      continue;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 0: 印1を基準に本命・対抗・単穴を決定（南関競馬）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const honmeiMark1 = race.horses.find(h => h.mark1 === '◎');
    const taikouMark1 = race.horses.find(h => h.mark1 === '○');
    const tananaMark1 = race.horses.find(h => h.mark1 === '▲');

    // 印1が設定されている場合のみ、元のassignmentを上書き
    // まず、本命・対抗・単穴の既存roleをクリア（印1で再割り当てするため）
    if (honmeiMark1 || taikouMark1 || tananaMark1) {
      for (const horse of race.horses) {
        if (horse.role === '本命' && horse !== honmeiMark1) {
          // 印1◎以外の本命を連下最上位に降格
          horse.role = '連下最上位';
        }
        if (horse.role === '対抗' && horse !== taikouMark1) {
          // 印1○以外の対抗を連下に降格
          horse.role = '連下';
        }
        if (horse.role === '単穴' && horse !== tananaMark1) {
          // 印1▲以外の単穴を連下に降格
          horse.role = '連下';
        }
      }
    }

    // 本命（◎）を設定
    if (honmeiMark1) {
      honmeiMark1.role = '本命';
    }

    // 対抗（○）と単穴（▲）はrawScoreで比較
    if (taikouMark1 && tananaMark1) {
      if (taikouMark1.rawScore >= tananaMark1.rawScore) {
        taikouMark1.role = '対抗'; // ○の方が高い→そのまま
        tananaMark1.role = '単穴';
      } else {
        taikouMark1.role = '単穴'; // ▲の方が高い→入れ替え
        tananaMark1.role = '対抗';
      }
    } else if (taikouMark1) {
      taikouMark1.role = '対抗'; // ○のみ存在
    } else if (tananaMark1) {
      tananaMark1.role = '単穴'; // ▲のみ存在
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
    // Step 2: 本命15点以下の場合、3頭ローテーション
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const honmeiAfterMark1 = race.horses.find(h => h.role === '本命');
    const taikouAfterMark1 = race.horses.find(h => h.role === '対抗');
    const tananaAfterMark1 = race.horses.find(h => h.role === '単穴');

    if (honmeiAfterMark1 && honmeiAfterMark1.rawScore <= 15) {
      if (taikouAfterMark1 && tananaAfterMark1) {
        // 3頭ローテーション: 本命→単穴、対抗→本命、単穴→対抗
        honmeiAfterMark1.role = '単穴';
        taikouAfterMark1.role = '本命';
        tananaAfterMark1.role = '対抗';
      } else if (taikouAfterMark1) {
        // 単穴がいない場合: 本命→単穴、対抗→本命
        honmeiAfterMark1.role = '単穴';
        taikouAfterMark1.role = '本命';
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 3: 差4点以上の役割入れ替え
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 2後の最新状態を取得
    const honmeiAfterSwap = race.horses.find(h => h.role === '本命');
    const taikouAfterSwap = race.horses.find(h => h.role === '対抗');
    const tananaAfterSwap = race.horses.find(h => h.role === '単穴');
    const renkaTopAfterSwap = race.horses.find(h => h.role === '連下最上位');

    // 対抗と単穴が存在し、差が4点以上の場合
    if (taikouAfterSwap && tananaAfterSwap &&
        (taikouAfterSwap.rawScore - tananaAfterSwap.rawScore >= 4)) {
      // 対抗→連下最上位、単穴→対抗、連下最上位→単穴
      taikouAfterSwap.role = '連下最上位';
      tananaAfterSwap.role = '対抗';
      if (renkaTopAfterSwap) {
        renkaTopAfterSwap.role = '単穴';
      }
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
    // Step 5: 表示用印の割り当て
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    for (const horse of race.horses) {
      horse.mark = getRoleMark(horse.role);
    }

    race.hasHorseData = true;
  }

  return adjusted;
}

/**
 * 正規化された予想データに調整ルールを適用（中央競馬JRA用）
 * assignmentをそのまま保持（印1による上書きなし）
 *
 * @param {Object} normalized - 正規化済み予想データ
 * @returns {Object} 調整済み予想データ
 */
export function adjustPredictionJRA(normalized) {
  // ディープコピー（元データを変更しない）
  const adjusted = JSON.parse(JSON.stringify(normalized));

  // 各レースに対して調整処理を実行
  for (const race of adjusted.races) {

    // 馬データがない場合はスキップ
    if (!race.horses || race.horses.length === 0) {
      race.hasHorseData = false;
      continue;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 0: 元データのassignmentをそのまま使用（JRA）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 何もしない（roleは既にnormalizeで設定済み）

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
    // Step 2: 表示用印の割り当て（roleそのまま使用）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    for (const horse of race.horses) {
      horse.mark = getRoleMark(horse.role);
    }

    race.hasHorseData = true;
  }

  return adjusted;
}

/**
 * 互換性のための旧関数名（南関用として動作）
 * @deprecated 新規コードでは adjustPredictionNankan() または adjustPredictionJRA() を使用してください
 *
 * @param {Object} normalized - 正規化済み予想データ
 * @returns {Object} 調整済み予想データ
 */
export function adjustPrediction(normalized) {
  // デフォルトは南関用ロジック
  return adjustPredictionNankan(normalized);
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
