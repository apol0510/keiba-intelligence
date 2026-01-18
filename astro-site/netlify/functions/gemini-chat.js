/**
 * Netlify Function: Gemini AIチャット
 *
 * 機能:
 * - Google Gemini API連携
 * - FAQ自動応答
 * - 予想データ参照
 * - コンテキスト保持
 *
 * 環境変数:
 * - GEMINI_API_KEY: Google AI Studio API Key
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

export default async (req, context) => {
  // CORSヘッダー設定
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // OPTIONSリクエスト対応（CORS preflight）
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  // POSTリクエストのみ許可
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method Not Allowed' }),
      { status: 405, headers }
    );
  }

  try {
    // リクエストボディをパース
    const body = await req.json();
    const { message, conversationHistory = [] } = body;

    // バリデーション
    if (!message) {
      return new Response(
        JSON.stringify({
          error: 'Missing required field: message'
        }),
        { status: 400, headers }
      );
    }

    // 環境変数チェック
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY not configured' }),
        { status: 500, headers }
      );
    }

    // Gemini API初期化
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    // 最新の予想データを取得
    let latestPrediction = null;
    try {
      const predictionsDir = join(process.cwd(), 'src', 'data', 'predictions');
      if (existsSync(predictionsDir)) {
        const files = readdirSync(predictionsDir)
          .filter(file => file.endsWith('.json'))
          .sort()
          .reverse();

        if (files.length > 0) {
          const fileContent = readFileSync(join(predictionsDir, files[0]), 'utf-8');
          latestPrediction = JSON.parse(fileContent);
        }
      }
    } catch (err) {
      console.error('Error loading prediction data:', err);
    }

    // 最新の結果データを取得
    let latestResult = null;
    try {
      const resultsDir = join(process.cwd(), 'src', 'data', 'results');
      if (existsSync(resultsDir)) {
        const files = readdirSync(resultsDir)
          .filter(file => file.endsWith('.json'))
          .sort()
          .reverse();

        if (files.length > 0) {
          const fileContent = readFileSync(join(resultsDir, files[0]), 'utf-8');
          latestResult = JSON.parse(fileContent);
        }
      }
    } catch (err) {
      console.error('Error loading result data:', err);
    }

    // システムプロンプト構築
    const systemContext = `あなたはKEIBA Intelligenceのカスタマーサポート担当AIアシスタントです。

【あなたの役割】
- 南関東4競馬場（大井・川崎・船橋・浦和）の地方競馬予想サービスについて説明する
- ユーザーからの質問に親切・丁寧・簡潔に回答する
- 必要に応じて最新の予想データや結果データを参照して回答する

【サービス概要】
- サービス名: KEIBA Intelligence
- コンセプト: AI-Powered Intelligence Dashboard for 南関競馬
- 主要機能:
  - AI予想システム（馬単買い目）
  - データビジュアライゼーション（的中率・回収率グラフ）
  - 買い目シミュレーター（馬単2点×100円）
  - 全レース結果完全公開

【料金プラン】
- フリープラン: ¥0/月 - 予想閲覧のみ（買い目なし）
- プロプラン: ¥4,980/月 or ¥49,800/年 - 全レース馬単買い目
- プロプラスプラン: ¥10,000/月 - 馬単+三連複（プロ会員のみ購入可能）

【的中実績】
${latestResult ? `
最新結果（${latestResult.date} ${latestResult.venue}）:
- 的中率: ${latestResult.summary.hitRate}%
- 回収率: ${latestResult.summary.roi}%
- 的中数: ${latestResult.summary.hitCount}/${latestResult.summary.totalRaces}R
` : '結果データはまだありません。'}

【最新予想】
${latestPrediction ? `
${latestPrediction.eventInfo.date} ${latestPrediction.eventInfo.venue} ${latestPrediction.eventInfo.totalRaces}R開催
` : '予想データはまだありません。'}

【回答の基本方針】
1. 簡潔に要点を伝える（3-5文程度）
2. 専門用語は避け、わかりやすい言葉を使う
3. 必要に応じて具体例を出す
4. サービスを押し売りせず、客観的に説明する
5. わからないことは正直に「わかりません」と答える

【禁止事項】
- 的中を保証する表現（「必ず当たる」など）
- 投資を煽る表現（「絶対稼げる」など）
- 他社サービスの誹謗中傷
- 個人情報の要求`;

    // 会話履歴を含めたプロンプト構築
    const chatHistory = conversationHistory.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    // チャット開始
    const chat = model.startChat({
      history: chatHistory,
      generationConfig: {
        maxOutputTokens: 1000,
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
      },
    });

    // システムコンテキストを最初のメッセージに含める
    const fullMessage = conversationHistory.length === 0
      ? `${systemContext}\n\nユーザーの質問: ${message}`
      : message;

    // メッセージ送信
    const result = await chat.sendMessage(fullMessage);
    const response = result.response;
    const aiMessage = response.text();

    // 成功レスポンス
    return new Response(
      JSON.stringify({
        success: true,
        message: aiMessage,
        metadata: {
          model: 'gemini-1.5-flash',
          hasLatestPrediction: !!latestPrediction,
          hasLatestResult: !!latestResult
        }
      }),
      { status: 200, headers }
    );

  } catch (error) {
    console.error('Gemini Chat Error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal Server Error',
        message: error.message
      }),
      { status: 500, headers }
    );
  }
};
