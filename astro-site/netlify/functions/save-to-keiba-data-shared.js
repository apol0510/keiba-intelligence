/**
 * Netlify Function: 結果JSONをkeiba-data-sharedリポジトリに保存
 *
 * 機能:
 * - 結果JSONを keiba-data-shared/nankan/results/YYYY/MM/ に保存
 * - GitHub API を使ってコミット・プッシュ
 * - 全プロジェクトで結果データ共有
 *
 * 環境変数:
 * - GITHUB_TOKEN_KEIBA_DATA_SHARED: GitHub Personal Access Token (repo権限)
 * - または GITHUB_TOKEN: 既存のトークンを使用
 * - GITHUB_REPO_OWNER: apol0510
 */

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
    const { resultsJSON } = body;

    // バリデーション
    if (!resultsJSON) {
      return new Response(
        JSON.stringify({
          error: 'Missing required field: resultsJSON'
        }),
        { status: 400, headers }
      );
    }

    // JSONパース
    const parsedData = JSON.parse(resultsJSON);
    const { date, venue, venueCode } = parsedData;

    if (!date || !venue) {
      return new Response(
        JSON.stringify({
          error: 'Invalid JSON: missing date or venue'
        }),
        { status: 400, headers }
      );
    }

    // 環境変数チェック（keiba-data-shared専用トークン、なければ既存のトークン）
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN_KEIBA_DATA_SHARED || process.env.GITHUB_TOKEN;
    const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER || 'apol0510';
    const GITHUB_REPO_NAME = 'keiba-data-shared';
    const GITHUB_BRANCH = 'main';

    if (!GITHUB_TOKEN) {
      return new Response(
        JSON.stringify({
          error: 'GITHUB_TOKEN_KEIBA_DATA_SHARED or GITHUB_TOKEN not configured',
          hint: 'Netlify環境変数を設定してください'
        }),
        { status: 500, headers }
      );
    }

    // ファイルパス生成（例: nankan/results/2026/01/2026-01-23.json）
    const year = date.substring(0, 4);
    const month = date.substring(5, 7);
    const fileName = `${date}.json`;
    const filePath = `nankan/results/${year}/${month}/${fileName}`;

    // GitHub API: ファイルの現在のSHAを取得（更新の場合に必要）
    const getFileUrl = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/contents/${filePath}?ref=${GITHUB_BRANCH}`;
    let fileSha = null;

    const getFileResponse = await fetch(getFileUrl, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Netlify-Function'
      }
    });

    if (getFileResponse.ok) {
      const fileData = await getFileResponse.json();
      fileSha = fileData.sha;
    }

    // レース情報取得
    const race = parsedData.races?.[0];
    const raceNumber = race?.raceNumber || 'N/A';
    const raceName = race?.raceName || '';
    const winner = race?.results?.[0];
    const winnerText = winner ? `${winner.number}番 ${winner.name}` : 'N/A';

    // コミットメッセージ生成
    const commitMessage = `✨ ${date} ${venue} 第${raceNumber}R結果${fileSha ? '更新' : '追加'}

【結果データ】
- 開催日: ${date}
- 競馬場: ${venue}（${venueCode}）
- レース: 第${raceNumber}R ${raceName}
- 1着: ${winnerText}
- ファイル: ${filePath}

【keiba-data-shared】
全プロジェクトで結果データ共有可能

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>`;

    // GitHub API: ファイルをコミット・プッシュ
    const createFileUrl = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/contents/${filePath}`;
    const createFileResponse = await fetch(createFileUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'Netlify-Function'
      },
      body: JSON.stringify({
        message: commitMessage,
        content: Buffer.from(resultsJSON).toString('base64'),
        branch: GITHUB_BRANCH,
        ...(fileSha && { sha: fileSha }) // 更新の場合のみSHAを含める
      })
    });

    if (!createFileResponse.ok) {
      const errorData = await createFileResponse.json();
      console.error('GitHub API Error:', errorData);
      return new Response(
        JSON.stringify({
          error: 'Failed to commit to GitHub',
          details: errorData,
          hint: 'GITHUB_TOKENのrepo権限を確認してください'
        }),
        { status: 500, headers }
      );
    }

    const result = await createFileResponse.json();

    // 成功レスポンス
    return new Response(
      JSON.stringify({
        success: true,
        message: `${fileName} を keiba-data-shared に保存しました。全プロジェクトで利用可能です！`,
        fileName,
        filePath,
        repoUrl: `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`,
        commitUrl: result.commit?.html_url,
        commitSha: result.commit?.sha,
        rawUrl: `https://raw.githubusercontent.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/${GITHUB_BRANCH}/${filePath}`
      }),
      { status: 200, headers }
    );

  } catch (error) {
    console.error('Save to keiba-data-shared Error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal Server Error',
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }),
      { status: 500, headers }
    );
  }
};
