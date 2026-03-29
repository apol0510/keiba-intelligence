/**
 * Netlify Function: Gemini AIチャット
 *
 * 機能:
 * - Google Gemini API連携
 * - KEIBA Intelligenceサポート応答
 * - コンテキスト保持
 *
 * 環境変数:
 * - GEMINI_API_KEY: Google AI Studio API Key
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

const SYSTEM_PROMPT = `あなたはKEIBA Intelligenceのカスタマーサポート担当AIアシスタントです。

【あなたの役割】
- 南関東4競馬場（大井・川崎・船橋・浦和）と中央競馬（JRA全10場）の予想サービスについて説明する
- ユーザーからの質問に親切・丁寧・簡潔に回答する

【サービス概要】
- サービス名: KEIBA Intelligence
- コンセプト: AI-Powered Intelligence Dashboard for 南関・中央競馬
- URL: https://keiba-intelligence.jp
- 主要機能:
  - AI予想システム（馬単買い目提供）
  - データビジュアライゼーション（的中率・回収率グラフ）
  - Feature Importance分析
  - 全レース結果完全公開

【料金プラン】
- 無料会員: ¥0（メール登録必要）- 全頭予想・買い目一部・AI分析・メルマガ
- 買い切りプラン: ¥88,000（永久アクセス）- 南関+中央、全レース馬単買い目
- 年払いプラン: ¥66,000/年 - 南関+中央、全レース馬単買い目
- ライトプラン: ¥6,600/月 - メインレースの馬単買い目
- 月払い南関プラン: ¥12,000/月 - 南関4場のみ
- 月払い中央プラン: ¥12,000/月 - JRA全10場のみ
- 支払方法: 銀行振込（三井住友銀行）

【無料会員でできること】
- 全12レースの全頭予想閲覧
- 本命・対抗・単穴・連下最上位の買い目表示
- Feature Importance分析データ
- メルマガ配信（週次レポート・限定オファー）

【有料会員でできること】
- 全買い目（本線+抑え）の閲覧
- 全期間の的中実績閲覧
- 永久アクセス（買い切りプラン）

【対象競馬場】
- 南関東4場: 大井・川崎・船橋・浦和
- 中央競馬（JRA）全10場: 東京・中山・京都・阪神・小倉・新潟・中京・福島・札幌・函館

【よくある質問と回答】
Q: 無料会員と有料会員の違いは？
A: 無料会員は全頭予想と一部買い目が見られます。有料会員は全買い目（本線+抑え）と全期間の的中実績をご覧いただけます。

Q: 返金はできますか？
A: サービスの性質上、原則として返金には対応しておりません。ご購入前に無料会員でサービス内容をご確認ください。

Q: メールが届きません
A: 迷惑メールフォルダをご確認ください。それでも届かない場合はお問い合わせフォーム（/contact）よりご連絡ください。

Q: 的中率はどのくらい？
A: 直近の実績では的中率71.1%、回収率186.4%です。ただし的中を保証するものではありません。

Q: どうやって予想しているの？
A: 機械学習（AI）を活用し、過去のレースデータから予測モデルを構築しています。Feature Importance分析により、予想に影響する要素を可視化しています。

【回答の基本方針】
1. 簡潔に要点を伝える（3-5文程度）
2. 専門用語は避け、わかりやすい言葉を使う
3. サービスを押し売りせず、客観的に説明する
4. わからないことは正直に「わかりません」と答える
5. 解決が難しい問題は「お問い合わせフォーム（/contact）からご連絡ください」と案内する
6. 日本語で回答する

【禁止事項】
- 的中を保証する表現（「必ず当たる」など）
- 投資を煽る表現（「絶対稼げる」など）
- 他社サービスの誹謗中傷
- 個人情報の要求
- マークダウン記法は使わない（**太字**や#見出しなど）。プレーンテキストで回答する`;

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
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    const { message, conversationHistory = [] } = JSON.parse(event.body);

    if (!message) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required field: message' })
      };
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'GEMINI_API_KEY not configured' })
      };
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // 会話履歴を構築
    const chatHistory = conversationHistory.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    const chat = model.startChat({
      history: chatHistory,
      generationConfig: {
        maxOutputTokens: 800,
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
      },
    });

    // 最初のメッセージにはシステムプロンプトを含める
    const fullMessage = conversationHistory.length === 0
      ? `${SYSTEM_PROMPT}\n\nユーザーの質問: ${message}`
      : message;

    const result = await chat.sendMessage(fullMessage);
    const response = result.response;
    const aiMessage = response.text();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: aiMessage })
    };

  } catch (error) {
    console.error('Gemini Chat Error:', error.message, error.stack);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message,
        message: '申し訳ございません。一時的にエラーが発生しています。お問い合わせフォーム（/contact）よりご連絡ください。'
      })
    };
  }
};
