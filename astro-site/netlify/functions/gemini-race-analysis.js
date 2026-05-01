/**
 * Netlify Function: Gemini AIレース分析
 *
 * 用途:
 * - 予想ページ: レースのAI解説コメント生成
 * - 結果ページ: レース結果の振り返りコメント生成
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

const PREDICTION_PROMPT = `あなたは競馬AI予想の解説ライターです。

入力されたデータ（レース情報・各馬の近走成績・分析結果）を、読みやすい自然な解説文にまとめてください。

【絶対厳守ルール】
- 入力データに含まれる事実のみを使う。入力にない情報は絶対に追加しない
- 数値・馬名・会場名・距離・着順・タイムは一字一句変えない
- 的中を保証する表現は禁止（「確実」「間違いない」「鉄板」等）
- 「コース適性」「血統」「パドック」等、入力にないデータに基づく分析は書かない
- 各馬の解説は入力の[分析]セクションの内容に基づくこと

【文章スタイル】
- 各馬ごとに1〜2文で簡潔にまとめる
- レース概要→本命→対抗→その他の順で書く
- 近走の着順やタイムに触れながら、なぜその評価なのかが伝わる文章にする
- 語尾は「〜です」「〜でした」「〜と考えられます」で統一
- 読者に語りかけるような優しく親しみやすいトーンで（ただし断定・説明調で終える）

【語尾制約（厳守）】
- 「ね」を含む語尾は一切使用しない
- 「ですね」「ますね」「でしょうね」「ましたね」「だね」「よね」等は完全禁止
- 必ず断定または説明調で終える（例：「〜です」「〜でした」「〜と考えられます」）
- 文末の助詞「ね」「よ」「な」「わ」も禁止

【出力形式】
- マークダウン記法は使わない。プレーンテキストのみ
- 箇条書きや番号リストは使わない
- 「KEIBA Intelligenceがお届けする」等の前置き・自己紹介は不要。いきなり本文から始める`;

const RESULT_PROMPT = `あなたは競馬AI予想の結果振り返りライターです。

入力されたレース結果データを、優しく丁寧な振り返り文にまとめてください。

【絶対厳守ルール】
- 入力データに含まれる事実のみを使う。入力にない情報は絶対に追加しない
- 馬番・馬名・着順・払戻金額・的中判定は一字一句変えない
- 「的中」と書かれていれば的中、「不的中」と書かれていれば不的中。判定を覆さない
- レース展開・脚質・能力評価など入力にない分析は書かない
- 買い目の内容（馬番の組み合わせ「○-○.○.○」等）は絶対に書かない
- 買い目の軸馬構造（「軸馬は○番」等）には触れない

【文章の方向性（厳守）】
- 入力データの「AI予想の評価」に記載されている馬のみ言及してよい。記載がない馬には一切触れない
- 「AI予想の評価」に含まれない馬（＝上位3着に入らなかったAI本命・対抗・単穴・連下馬）には絶対に触れない。存在しないものとして扱う
- 特に、本命・対抗・単穴・連下が馬券圏外だった事実に触れるのは完全禁止。「本命に推した○番は残念ながら〜」「本命馬は馬券圏外でしたが〜」「本命は届きませんでしたが対抗が〜」のような表現は絶対に書かない
- ネガティブな言及（「馬券圏外」「予想が外れ」「残念ながら」「惜しくも」「届かず」等）は一切書かない
- 役割名（本命・対抗・単穴・連下）を文中に絶対に出さない。「本命に推した」「対抗に推した」「単穴の」「連下の」等の表現は完全禁止
- 「AI推奨」「AIが推奨した」等のAI推奨ラベルは文中で**最大1回のみ**使用可（複数回使うと推奨頭数が推測されてしまうため絶対に禁止）。2頭目以降は「○番○○も」「さらに○番○○が」等、AI推奨のラベルを付けずに馬名だけで自然に触れる
- 推奨頭数が読者に推測されるような書き方（「AI推奨のA、AI推奨のBも」等）は完全禁止
- 入力データに「騎手」「厩舎」「単勝○番人気」「着差」が含まれる場合は積極的に盛り込んでよい（例：「○○騎手が鮮やかに導き」「人気薄の○番が激走」「クビ差の接戦」）
- 着差データがある場合は展開表現（「僅差の接戦」「クビ差の叩き合い」「1馬身突き抜けた完勝」等）に活用してよい
- 単勝人気データがある場合は「1番人気がそのまま」「人気薄の激走」「上位人気の堅い決着」等の表現に活用してよい（ただし推測で書かず、入力にある人気データのみ使用）
- 「支持される」「支持された」「支持を集めた」等の"支持"系表現は**単勝1番人気の馬のみ**に使用可。2番人気以下の馬にこれらの表現を使うのは完全禁止（例:「2番人気に支持された○○」は不可 →「2番人気の○○」と書く）
- 1着→2着→3着を順に並べる書き方ばかりにせず、レース全体像（堅い決着/波乱/接戦/圧勝）から書き始めるなど構成に変化をつける
- 3着以内に入った馬のポジティブな活躍のみを中心に書く
- 的中時は素直に喜び、不的中時は着順事実を淡々と述べた上で次のレースへの前向きな締めで終える（外れた馬名・役割には触れない）

【文章スタイル】
- 語尾は「〜です」「〜でした」「〜ました」「〜と考えられます」で統一
- 読者に語りかけるような優しいトーンで（ただし断定・説明調で終える）
- 2〜3文程度で簡潔にまとめる
- 「見事」「お見事」を多用しない。レースごとに異なる表現を使い、単調にならないようにする
- 入力データにない馬の役割を捏造しない。役割が記載されていない馬について「AI予想の○○」等と書かない

【語尾制約（厳守）】
- 「ね」を含む語尾は一切使用しない
- 「ですね」「ますね」「でしょうね」「ましたね」「だね」「よね」等は完全禁止
- 必ず断定または説明調で終える（例：「〜です」「〜でした」「〜ました」「〜と考えられます」）
- 文末の助詞「ね」「よ」「な」「わ」も禁止

【出力形式】
- マークダウン記法は使わない。プレーンテキストのみ
- 箇条書きや番号リストは使わない
- 「KEIBA Intelligenceがお届けする」等の前置き・自己紹介は不要。いきなり本文から始める`;

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

    // 結果型の場合、keiba-data-sharedから詳細データ（騎手・厩舎・着差・単勝人気）を取得
    let enrichedRaceData = raceData;
    if (type === 'result') {
      try {
        const enrichment = await fetchRaceDetails(raceData);
        if (enrichment) {
          enrichedRaceData = { ...raceData, details: enrichment };
        }
      } catch (e) {
        console.warn('Enrichment fetch failed:', e.message);
      }
    }

    const userMessage = type === 'prediction'
      ? formatPredictionData(raceData)
      : formatResultData(enrichedRaceData);

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: {
        maxOutputTokens: 8192,
        temperature: 0.5,
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    });

    const comment = result.response.text();

    return {
      statusCode: 200,
      headers: { ...headers, 'Cache-Control': 'public, max-age=86400, s-maxage=86400' },
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

/**
 * keiba-data-sharedから指定レースの上位3頭詳細（騎手・厩舎・着差・単勝人気）を取得
 * 南関: nankan/results/YYYY/MM/YYYY-MM-DD-CODE.json
 * JRA : jra/results/YYYY/MM/YYYY-MM-DD-CODE.json
 */
const NANKAN_VENUES = { '大井': 'OOI', '船橋': 'FUN', '川崎': 'KAW', '浦和': 'URA' };
const JRA_VENUES = {
  '東京': 'TOK', '中山': 'NAK', '阪神': 'HAN', '京都': 'KYO',
  '中京': 'CHU', '新潟': 'NII', '福島': 'FKS', '小倉': 'KOK',
  '札幌': 'SAP', '函館': 'HAK'
};

async function fetchRaceDetails({ venue, date, raceNumber, result }) {
  if (!venue || !date || !raceNumber || !result) return null;
  const venueName = String(venue).replace(/競馬$/, '').trim();
  const isNankan = NANKAN_VENUES[venueName] !== undefined;
  const code = NANKAN_VENUES[venueName] || JRA_VENUES[venueName];
  if (!code) return null;

  const [year, month] = date.split('-');
  const category = isNankan ? 'nankan' : 'jra';
  const url = `https://raw.githubusercontent.com/apol0510/keiba-data-shared/main/${category}/results/${year}/${month}/${date}-${code}.json`;

  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();

  const races = Array.isArray(data.races) ? data.races : [];
  const race = races.find(r => Number(r.raceNumber) === Number(raceNumber));
  if (!race || !Array.isArray(race.results)) return null;

  const pickByNumber = (num) => race.results.find(r => Number(r.number) === Number(num));
  const topDetails = {};
  ['first', 'second', 'third'].forEach(key => {
    const hNum = result[key]?.number;
    if (hNum == null) return;
    const row = pickByNumber(hNum);
    if (!row) return;
    topDetails[key] = {
      jockey: row.jockey || null,
      trainer: row.trainer || null,
      margin: row.margin || null,
      popularity: row.popularity || null
    };
  });
  return topDetails;
}

/**
 * recentRaceの1件を検証し、完全なデータのみ返す。不完全なら null
 * 必須: venue（会場名のみ）, distance（数値）, rank（着順数値）or finishStatus
 */
function validateRecentRace(race) {
  if (!race) return null;

  // rank も finishStatus もなければ不完全 → 削除
  const hasRank = race.rank && typeof race.rank === 'number' && race.rank > 0;
  const hasFinishStatus = race.finishStatus && typeof race.finishStatus === 'string';
  if (!hasRank && !hasFinishStatus) return null;

  // venue: 会場名のみ抽出（"盛岡 11.17" → "盛岡"、null → 不完全）
  if (!race.venue) return null;
  const venueName = race.venue.replace(/\s+[\d.\/]+$/, '').trim();
  if (!venueName) return null;

  // distance: 数値のみ抽出（"ダ1400" → 1400、null → 不完全）
  let distanceNum = null;
  if (race.distance) {
    const distStr = race.distance.toString().replace(/^[ダ芝障]+/, '').trim();
    const parsed = parseInt(distStr, 10);
    if (!isNaN(parsed) && parsed > 0) {
      distanceNum = parsed;
    }
  }
  // distanceがなければ不完全 → 削除
  if (!distanceNum) return null;

  const rankText = hasFinishStatus ? race.finishStatus : `${race.rank}着`;

  return { venue: venueName, distance: distanceNum, rankText };
}

/**
 * 近走データから分析ファクトを生成する（LLMに渡す前の事前計算）
 */
function analyzeRecentRaces(recentRaces, currentDistance, currentVenue) {
  if (!recentRaces || recentRaces.length === 0) return null;

  const analysis = {};
  const validRaces = [];

  for (const r of recentRaces.slice(0, 5)) {
    const validated = validateRecentRace(r);
    if (!validated) continue;
    validRaces.push({ ...validated, raw: r });
  }
  if (validRaces.length === 0) return null;

  // 直近走の成績サマリ（最大3走）
  const runLines = [];
  for (let i = 0; i < Math.min(3, validRaces.length); i++) {
    const v = validRaces[i];
    const label = i === 0 ? '前走' : i === 1 ? '2走前' : '3走前';
    let line = `${label}${v.venue}${v.distance}m${v.rankText}`;
    // 上がり3Fを追加
    const f3 = parseFloat(v.raw.last3f || '0');
    if (f3 > 0) {
      line += `(上がり${f3}秒)`;
    }
    runLines.push(line);
  }
  analysis.runLines = runLines;

  // 着順傾向（直近の好走率）
  const top3count = validRaces.filter(r => {
    const rank = r.raw.rank;
    return rank && rank <= 3;
  }).length;
  if (validRaces.length >= 2) {
    analysis.top3rate = `直近${validRaces.length}走中${top3count}回3着以内`;
  }

  // 上がり3F分析
  const f3values = validRaces.map(r => parseFloat(r.raw.last3f || '0')).filter(v => v > 0);
  if (f3values.length >= 2) {
    const avg = f3values.reduce((a, b) => a + b, 0) / f3values.length;
    const best = Math.min(...f3values);
    analysis.last3f = `上がり3F平均${avg.toFixed(1)}秒、最速${best.toFixed(1)}秒`;
  } else if (f3values.length === 1) {
    analysis.last3f = `前走の上がり3Fは${f3values[0].toFixed(1)}秒`;
  }

  // 距離適性
  const targetDist = parseInt(String(currentDistance || '').match(/(\d{3,4})/)?.[1] || '0');
  if (targetDist > 0) {
    const sameDistRaces = validRaces.filter(r => {
      const rDist = r.distance;
      return rDist && Math.abs(rDist - targetDist) <= 200;
    });
    if (sameDistRaces.length > 0) {
      const goodCount = sameDistRaces.filter(r => r.raw.rank && r.raw.rank <= 3).length;
      analysis.distFit = `同距離帯${sameDistRaces.length}走中${goodCount}回3着以内`;
    }
  }

  // コース適性
  if (currentVenue) {
    const venueShort = currentVenue.replace(/競馬/g, '');
    const sameVenue = validRaces.filter(r => r.venue.includes(venueShort));
    if (sameVenue.length > 0) {
      const goodCount = sameVenue.filter(r => r.raw.rank && r.raw.rank <= 3).length;
      analysis.trackFit = `${venueShort}では${sameVenue.length}走中${goodCount}回3着以内`;
    }
  }

  // ペース傾向
  const paceTypes = validRaces.map(r => r.raw.paceType).filter(Boolean);
  if (paceTypes.length >= 2) {
    const paceCount = {};
    paceTypes.forEach(p => { paceCount[p] = (paceCount[p] || 0) + 1; });
    const dominant = Object.entries(paceCount).sort((a, b) => b[1] - a[1])[0];
    const paceLabels = { 'H': 'ハイペース', 'M': 'ミドルペース', 'S': 'スローペース', 'Ｈ': 'ハイペース', 'Ｍ': 'ミドルペース', 'Ｓ': 'スローペース' };
    if (dominant && paceLabels[dominant[0]]) {
      analysis.pace = `近走は${paceLabels[dominant[0]]}のレースが多い`;
    }
  }

  return analysis;
}

/**
 * 予想データを分析付きファクト文に変換する
 * LLMは「このデータを自然な解説文にまとめる」
 */
function formatPredictionData(data) {
  const { venue, date, raceNumber, raceName, distance, horseCount, topHorses } = data;

  const sections = [];
  sections.push(`[レース情報]`);
  sections.push(`${date} ${venue} ${raceNumber}R${raceName ? ' ' + raceName : ''}${distance ? ' ' + distance + 'm' : ''}${horseCount ? ' ' + horseCount + '頭立て' : ''}`);

  topHorses.forEach(h => {
    sections.push('');
    // 基本情報行: 騎手・調教師・年齢・斤量があれば追加
    const basicInfo = [];
    if (h.jockey) basicInfo.push(`騎手:${h.jockey}`);
    if (h.trainer) basicInfo.push(`調教師:${h.trainer}`);
    if (h.age) basicInfo.push(h.age);
    if (h.weight) basicInfo.push(`${h.weight}kg`);
    const infoStr = basicInfo.length > 0 ? ` (${basicInfo.join(' ')})` : '';
    sections.push(`[${h.role}] ${h.horseNumber}番${h.horseName} PT${h.pt}${infoStr}`);

    const analysis = analyzeRecentRaces(h.recentRaces, distance, venue);
    if (analysis) {
      sections.push('[近走]');
      if (analysis.runLines) {
        analysis.runLines.forEach(line => sections.push(line));
      }

      const insights = [];
      if (analysis.top3rate) insights.push(analysis.top3rate);
      if (analysis.last3f) insights.push(analysis.last3f);
      if (analysis.distFit) insights.push(analysis.distFit);
      if (analysis.trackFit) insights.push(analysis.trackFit);
      if (analysis.pace) insights.push(analysis.pace);

      if (insights.length > 0) {
        sections.push('[分析]');
        insights.forEach(i => sections.push(i));
      }
    }
  });

  return `以下のレースデータを元に、自然な解説文を作成してください。データに含まれる事実のみを使い、情報の追加は禁止です。\n\n${sections.join('\n')}`;
}

/**
 * 結果データを事前確定された事実文に変換する
 * LLMは「この文章を自然な日本語に整形するだけ」
 */
function formatResultData(data) {
  const { venue, date, raceNumber, raceName, isHit, result, payout, umatanCombination, roles, details } = data;

  const facts = [];

  // ① 結果事実（詳細データがあれば騎手・厩舎・着差・単勝人気を併記）
  const detailLine = (key, res) => {
    const d = details?.[key];
    const base = `${res.number}番${res.name ? ' ' + res.name : ''}`;
    if (!d) return base;
    const extras = [];
    if (d.jockey) extras.push(`騎手:${d.jockey}`);
    if (d.trainer) extras.push(`厩舎:${d.trainer}`);
    if (d.popularity) extras.push(`単勝${d.popularity}番人気`);
    if (d.margin && d.margin !== '-') extras.push(`着差:${d.margin}`);
    return extras.length > 0 ? `${base}（${extras.join(' / ')}）` : base;
  };

  facts.push(`${date} ${venue} ${raceNumber}R${raceName ? ' ' + raceName : ''}`);
  facts.push(`1着: ${detailLine('first', result.first)}`);
  facts.push(`2着: ${detailLine('second', result.second)}`);
  facts.push(`3着: ${detailLine('third', result.third)}`);
  if (umatanCombination) {
    facts.push(`馬単決着: ${umatanCombination}`);
  }

  // ② AI予想の役割（買い目の内容は絶対に含めない）
  // 3着以内に入った馬のみ渡す（着外のAI本命等に言及させないため）
  if (roles && roles.length > 0) {
    const top3Numbers = [result.first?.number, result.second?.number, result.third?.number]
      .filter(n => n !== undefined && n !== null)
      .map(n => String(n));
    const top3Roles = roles.filter(r => top3Numbers.includes(String(r.horseNumber)));
    if (top3Roles.length > 0) {
      facts.push(`AI推奨馬で3着以内に入った馬（この馬たちのみ言及可。何頭推奨したかは明かさず、役割名も伏せること）:`);
      top3Roles.forEach(r => {
        facts.push(`  ${r.horseNumber}番${r.horseName || ''}`);
      });
    }
  }

  // ③ 的中状況
  facts.push(`判定: ${isHit ? '的中' : '不的中'}`);

  // ④ 金額結果
  if (isHit && payout) {
    facts.push(`払戻: ¥${payout.toLocaleString()}`);
  }

  // 冒頭文テンプレ（A〜Hの8パターンからランダム選択）。レース名・距離は含める、頭数は含めない
  const distStr = data.distance ? `（${String(data.distance).replace(/[^\d]/g, '')}m）` : '';
  const raceLabel = `${venue} ${raceNumber}R${raceName ? ' ' + raceName : ''}${distStr}`;
  const openings = [
    `${raceLabel}の結果をAIが振り返ります。今回のレースデータは学習材料として即時反映され、次回の予想精度向上につながります。`,
    `${raceLabel}が決着しました。AIがこのレースを振り返り、結果を予想モデルに取り込むことで、次回以降さらに進化した予想をお届けします。`,
    `${raceLabel}の結果が出ました。AIがレースを振り返り、勝ち馬の走りや展開から得られた知見を即座に学習、次回予想の精度をさらに磨き上げていきます。`,
    `${raceLabel}のレースが終わりました。AIが結果を読み解き、着順・配当・展開を学習データへ反映。次のレースではさらに鋭い予想をお届けします。`,
    `${raceLabel}、結果をお届けします。AIはこのレースから新たな知見を獲得し、予想アルゴリズムを常時アップデート中です。`,
    `${raceLabel}を振り返ります。AIはレースごとに学び続け、結果を次回予想へフィードバックすることで精度を高め続けています。`,
    `${raceLabel}の結果が揃いました。AIは勝ち馬の走りを分析して次回予想に即座に反映し、一戦ごとに賢くなっていきます。`,
    `${raceLabel}が終了しました。AIがレース結果を振り返りながら学習を進め、次のレース予想へとその成果を還元していきます。`
  ];
  const opening = openings[Math.floor(Math.random() * openings.length)];

  return `以下のレース結果データを元に、優しく丁寧な振り返り文を作成してください。データに含まれる事実のみを使い、情報の追加は禁止です。買い目（馬番の組み合わせ）は絶対に書かないでください。

【冒頭の1文目は以下の文をそのまま使ってください（一字一句変更禁止）】
${opening}

【2文目以降】
上記の冒頭に続けて、3着以内に入った馬の活躍を中心に自然な振り返りを必ず4〜5文で書いてください（冒頭と合わせて合計5〜6文、必ず5文以上）。各文は句点「。」で区切り、極端に短い文（20文字未満）や長すぎる文（80文字超）は避け、30〜60文字程度で整えてください。文数が4文以下になるのは禁止です。

【結果データ】
${facts.join('\n')}`;
}
