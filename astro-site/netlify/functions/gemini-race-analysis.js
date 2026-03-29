/**
 * Netlify Function: Gemini AIレース分析
 *
 * 用途:
 * - 予想ページ: レースのAI解説コメント生成
 * - 結果ページ: レース結果の振り返りコメント生成
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

const PREDICTION_PROMPT = `あなたはKEIBA Intelligenceの競馬AI予想解説者です。

以下のレース予想データを元に、簡潔な解説コメントを生成してください。

【絶対厳守ルール】
- 提供されたデータのみを使用する。データにない情報は絶対に創作しない
- 直近走データ（recentRaces）がある場合のみ、過去走の着順・会場・距離に触れてよい
- 直近走データがない馬については、PT値と役割だけで言及する
- 「コース適性」「血統」「パドックの気配」など、データにない情報は一切書かない
- 知らないことは書かない。嘘を書くくらいなら書かない

【解説の書き方】
- 3〜5文程度で簡潔にまとめる
- PT値（予測スコア）と直近走の着順を組み合わせて解説する
- 例：「本命14番コパノハワードはPT90と高スコア。前走大井1600mで2着と好走しており安定感がある」
- 直近走で1着があれば「勢いがある」、着順上昇傾向なら「上昇傾向」と表現してよい
- 直近走で着外続きなら「近走は苦戦しているが、AIスコアは高く評価」と表現してよい
- マークダウン記法は使わない。プレーンテキストのみ
- 的中を保証する表現は禁止
- 自然な日本語で、競馬ファンに向けた解説口調`;

const RESULT_PROMPT = `あなたはKEIBA Intelligenceの競馬AI結果解説者です。

以下のレース結果データを元に、簡潔な振り返りコメントを生成してください。

【絶対厳守ルール】
- 提供されたデータ（着順、馬名、馬番、的中/不的中、払戻額）のみを使用する
- データにない情報は絶対に創作・推測しない
- 「前走」「過去の実績」「戦績」「展開」「脚質」など、提供データに含まれない情報には一切触れない
- 「逃げ」「差し」「追い込み」などレース展開の描写はデータがないので書かない
- 知らないことは書かない。嘘を書くくらいなら書かない

【解説の書き方】
- 3〜4文程度で簡潔にまとめる
- 的中した場合: 「AI予想の上位馬が結果通りに入線した」等、事実ベースで簡潔に
- 外れた場合: 「予想上位馬が着外に沈んだ」等、事実ベースで簡潔に。原因の推測はしない
- 払戻額がある場合はその金額に触れてよい
- マークダウン記法は使わない。プレーンテキストのみ
- 言い訳はせず客観的に事実のみ述べる
- 自然な日本語で簡潔に`;

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { type, raceData } = JSON.parse(event.body);

    if (!type || !raceData) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'type and raceData are required' })
      };
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'GEMINI_API_KEY not configured' }) };
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const systemPrompt = type === 'prediction' ? PREDICTION_PROMPT : RESULT_PROMPT;
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: systemPrompt,
    });

    const userMessage = type === 'prediction'
      ? formatPredictionData(raceData)
      : formatResultData(raceData);

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: {
        maxOutputTokens: 400,
        temperature: 0.8,
      },
    });

    const comment = result.response.text();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, comment })
    };

  } catch (error) {
    console.error('Race Analysis Error:', error.message);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: false, comment: null, error: error.message })
    };
  }
};

function formatPredictionData(data) {
  const { venue, date, raceNumber, raceName, distance, horseCount, topHorses } = data;
  let text = `【レース情報】\n`;
  text += `${date} ${venue} ${raceNumber}R ${raceName || ''}\n`;
  if (distance) text += `距離: ${distance}m / `;
  if (horseCount) text += `出走頭数: ${horseCount}頭\n`;
  text += `\n【予想上位馬】\n`;
  topHorses.forEach((h, i) => {
    text += `${i + 1}. ${h.role} ${h.horseNumber}番 ${h.horseName} (PT: ${h.pt}) 騎手: ${h.jockey || '不明'}\n`;
    // 直近走データがあれば追加
    if (h.recentRaces && h.recentRaces.length > 0) {
      text += `   直近走: `;
      text += h.recentRaces.map(r => {
        const rankText = r.finishStatus ? r.finishStatus : `${r.rank}着`;
        return `${r.venue}${r.distance}m${rankText}(${r.headCount}頭中)`;
      }).join(' → ');
      text += '\n';
    }
  });
  return text;
}

function formatResultData(data) {
  const { venue, date, raceNumber, raceName, isHit, result, bettingLines, payout } = data;
  let text = `【レース情報】\n`;
  text += `${date} ${venue} ${raceNumber}R ${raceName || ''}\n`;
  text += `\n【レース結果】\n`;
  text += `1着: ${result.first.number}番 ${result.first.name}\n`;
  text += `2着: ${result.second.number}番 ${result.second.name}\n`;
  text += `3着: ${result.third.number}番 ${result.third.name}\n`;
  text += `\n【予想買い目】\n`;
  if (bettingLines) text += bettingLines.join(', ') + '\n';
  text += `\n【判定】${isHit ? '的中' : '不的中'}\n`;
  if (isHit && payout) text += `払戻: ¥${payout.toLocaleString()}\n`;
  return text;
}
