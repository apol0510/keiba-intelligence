/**
 * Netlify Function: 結果JSONを保存してGit自動デプロイ
 *
 * 機能:
 * - レース結果データを src/data/results/ に保存
 * - GitHub API を使ってコミット・プッシュ
 * - Netlify自動デプロイをトリガー
 *
 * 環境変数:
 * - GITHUB_TOKEN: GitHub Personal Access Token (repo権限)
 * - GITHUB_REPO_OWNER: apol0510
 * - GITHUB_REPO_NAME: keiba-intelligence
 * - GITHUB_BRANCH: main
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
    const { resultsJSON, fileName } = body;

    // バリデーション
    if (!resultsJSON || !fileName) {
      return new Response(
        JSON.stringify({
          error: 'Missing required fields',
          required: ['resultsJSON', 'fileName']
        }),
        { status: 400, headers }
      );
    }

    // 環境変数チェック
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER || 'apol0510';
    const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME || 'keiba-intelligence';
    const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

    if (!GITHUB_TOKEN) {
      return new Response(
        JSON.stringify({ error: 'GITHUB_TOKEN not configured' }),
        { status: 500, headers }
      );
    }

    // ファイルパス
    const filePath = `astro-site/src/data/results/${fileName}`;

    // 結果データをパースして統計情報を取得
    const resultsData = JSON.parse(resultsJSON);
    const { date, venue, summary } = resultsData;

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

    // コミットメッセージ生成
    const commitMessage = `🏆 ${date} ${venue} レース結果${fileSha ? '更新' : '追加'}

【結果サマリー】
- 開催日: ${date}
- 競馬場: ${venue}
- 的中: ${summary.hitCount}/${summary.totalRaces}R
- 的中率: ${summary.hitRate}%
- 回収率: ${summary.roi}%
- 投資額: ${summary.totalInvest.toLocaleString()}円
- 払戻額: ${summary.totalReturn.toLocaleString()}円
- ファイル: ${fileName}

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
          details: errorData
        }),
        { status: 500, headers }
      );
    }

    const result = await createFileResponse.json();

    // 成功レスポンス
    return new Response(
      JSON.stringify({
        success: true,
        message: `${fileName} を保存しました。Netlifyが自動デプロイを開始します（1-2分）。`,
        fileName,
        filePath,
        summary: {
          hitRate: `${summary.hitRate}%`,
          roi: `${summary.roi}%`,
          hitCount: `${summary.hitCount}/${summary.totalRaces}`
        },
        commitUrl: result.commit?.html_url,
        commitSha: result.commit?.sha
      }),
      { status: 200, headers }
    );

  } catch (error) {
    console.error('Save Results Error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal Server Error',
        message: error.message
      }),
      { status: 500, headers }
    );
  }
};
