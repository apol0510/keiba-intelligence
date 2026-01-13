/**
 * Netlify Function: 予想JSONを保存してGit自動デプロイ
 *
 * 機能:
 * - 全レース統合JSONを src/data/predictions/ に保存
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
    const { predictionJSON, raceDate, venue } = body;

    // バリデーション
    if (!predictionJSON || !raceDate || !venue) {
      return new Response(
        JSON.stringify({
          error: 'Missing required fields',
          required: ['predictionJSON', 'raceDate', 'venue']
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

    // ファイル名生成（例: 2026-01-14-ooi.json）
    const venueMap = {
      '大井': 'ooi',
      '川崎': 'kawasaki',
      '船橋': 'funabashi',
      '浦和': 'urawa'
    };
    const venueSlug = venueMap[venue] || venue.toLowerCase();
    const fileName = `${raceDate}-${venueSlug}.json`;
    const filePath = `astro-site/src/data/predictions/${fileName}`;

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
    const commitMessage = `✨ ${raceDate} ${venue} 全12R予想データ${fileSha ? '更新' : '追加'}

【自動生成】
- 開催日: ${raceDate}
- 競馬場: ${venue}
- レース数: ${JSON.parse(predictionJSON).predictions?.length || 'N/A'}
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
        content: Buffer.from(predictionJSON).toString('base64'),
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
        message: `${fileName} を保存しました。Netlifyが自動デプロイを開始します。`,
        fileName,
        filePath,
        commitUrl: result.commit?.html_url,
        commitSha: result.commit?.sha
      }),
      { status: 200, headers }
    );

  } catch (error) {
    console.error('Save and Deploy Error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal Server Error',
        message: error.message
      }),
      { status: 500, headers }
    );
  }
};
