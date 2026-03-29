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

【ルール】
- 3〜5文程度で簡潔にまとめる
- なぜ本命馬が有力なのか、対抗馬との力関係を解説
- レース展開の予想（逃げ・先行・差し等）があれば触れる
- マークダウン記法は使わない。プレーンテキストのみ
- 的中を保証する表現は禁止
- 自然な日本語で、競馬ファンに向けた解説口調`;

const RESULT_PROMPT = `あなたはKEIBA Intelligenceの競馬AI結果解説者です。

以下のレース結果データを元に、簡潔な振り返りコメントを生成してください。

【ルール】
- 3〜5文程度で簡潔にまとめる
- 的中した場合: 予想が当たった要因を分析
- 外れた場合: なぜ予想と異なる結果になったかを考察
- マークダウン記法は使わない。プレーンテキストのみ
- 言い訳はせず客観的に分析する
- 自然な日本語で、競馬ファンに向けた解説口調`;

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
    text += `${i + 1}. ${h.role}${h.role ? ' ' : ''}${h.horseNumber}番 ${h.horseName} (PT: ${h.pt}) 騎手: ${h.jockey || '不明'}\n`;
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
