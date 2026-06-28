/**
 * checkSharedNankanPredictions.mjs — 南関 predictions の存在確認（認証付き / sharedFetch 再利用）
 *
 * keiba-data-shared private 化後も動くよう、匿名 raw/curl を廃し sharedFetch helper の
 * 認証付き Contents API で確認する。契約（token必須・401/403/429/5xx fatal・404のみ未投入）は
 * helper と一元化し、workflow shell 側へ二重実装しない。
 *
 * token 契約:
 *   KEIBA_DATA_SHARED_TOKEN が必須。GITHUB_TOKEN への fallback は禁止。
 *   KEIBA_DATA_SHARED_TOKEN 未設定 or 空の場合、HTTP 到達前に TOKEN_MISSING で fatal。
 *
 * 確認順序:
 *   1. 統合ファイル: nankan/predictions/YYYY/MM/YYYY-MM-DD.json
 *   2. 統合ファイルが 404 なら per-venue: nankan/predictions/YYYY/MM/YYYY-MM-DD-{CODE}.json
 *
 * 使い方:
 *   node scripts/checkSharedNankanPredictions.mjs --date 2026-05-08
 *   node scripts/checkSharedNankanPredictions.mjs --date 2026-05-08 --venues OOI,FUN,KAW,URA
 *
 * 直接実行時の stdout（機械可読・2 行のみ。token / response body は出力しない）:
 *   FOUND=true|false
 *   FOUND_CODES=OOI FUN   （統合ファイルが見つかった場合は空文字列。per-venue のみ存在時に会場コードを列挙）
 * 診断ログは stderr のみ（stdout の KEY=VALUE 解析を汚染しない）。
 *
 * exit code:
 *   0 … 確定できた（200=存在 / 認証済み404=未投入）。FOUND=false でも「正常な空」
 *   1 … token 未設定 / 401 / 403 / 429 / 5xx / timeout / その他 fatal（＝確定不能）
 */
import { pathToFileURL } from 'node:url';
import { createSharedClient, SharedFetchError, SHARED_FETCH_CODES } from './lib/sharedFetch.mjs';

const DEFAULT_VENUES = ['OOI', 'FUN', 'KAW', 'URA'];

/** keiba-data-shared 専用 cross-repo token のキー名 */
const CROSS_REPO_TOKEN_KEY = 'KEIBA_DATA_SHARED_TOKEN';

/**
 * KEIBA_DATA_SHARED_TOKEN を env から明示的に取得する。
 * 未設定 or 空の場合は HTTP 到達前に TOKEN_MISSING で fatal。
 * GITHUB_TOKEN への fallback は禁止（cross-repo アクセスは KEIBA_DATA_SHARED_TOKEN 専用）。
 * @param {Record<string, string | undefined> | undefined} env
 * @returns {string} token 値
 */
function requireCrossRepoToken(env) {
  const raw = env?.[CROSS_REPO_TOKEN_KEY];
  const token = typeof raw === 'string' ? raw.trim() : '';
  if (!token) {
    throw new SharedFetchError(
      SHARED_FETCH_CODES.TOKEN_MISSING,
      `${CROSS_REPO_TOKEN_KEY} が設定されていません。keiba-data-shared へのアクセスには ${CROSS_REPO_TOKEN_KEY} が必須です。GITHUB_TOKEN への fallback は禁止されています。`,
    );
  }
  return token;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--date') args.date = argv[++i];
    else if (a === '--venues') args.venues = argv[++i];
  }
  return args;
}

/**
 * @returns {Promise<{found: boolean, foundCodes: string[]}>}
 *   found=true … 統合ファイル or 会場別ファイルが 1 件以上存在する
 *   foundCodes … per-venue で見つかった会場コード（統合ファイル存在時は空配列）
 *   auth/通信 fatal は throw（partial result を返さない）
 */
export async function checkSharedNankanPredictions({
  argv = process.argv.slice(2),
  env = process.env,
  client,
  logger = console,
} = {}) {
  // KEIBA_DATA_SHARED_TOKEN 必須。GITHUB_TOKEN fallback 禁止。HTTP 到達前に検証。
  const token = requireCrossRepoToken(env);

  const args = parseArgs(argv);
  if (!args.date) throw new Error('Usage: --date YYYY-MM-DD [--venues OOI,FUN,KAW,URA]');
  const venues = (args.venues || DEFAULT_VENUES.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // KEIBA_DATA_SHARED_TOKEN のみを渡す（env 内の他 token を client へ漏洩させない）
  const c = client ?? createSharedClient({ env: { [CROSS_REPO_TOKEN_KEY]: token } });
  const [y, m] = args.date.split('-');

  // 1. 統合ファイル優先（required:false → 404 のみ null、他は fatal）
  const unifiedPath = `nankan/predictions/${y}/${m}/${args.date}.json`;
  const unifiedData = await c.fetchJson(unifiedPath, { ref: 'main', required: false });
  if (unifiedData !== null) {
    logger.error(`✅ nankan/predictions unified: found (${args.date})`);
    return { found: true, foundCodes: [] };
  }
  logger.error(`⏭️  nankan/predictions unified: not posted yet (authenticated 404)`);

  // 2. per-venue フォールバック
  const foundCodes = [];
  for (const code of venues) {
    const venuePath = `nankan/predictions/${y}/${m}/${args.date}-${code}.json`;
    const venueData = await c.fetchJson(venuePath, { ref: 'main', required: false });
    if (venueData === null) {
      logger.error(`⏭️  nankan/predictions ${code}: not posted yet (authenticated 404)`);
    } else {
      foundCodes.push(code);
      logger.error(`✅ nankan/predictions ${code}: found`);
    }
  }

  return { found: foundCodes.length > 0, foundCodes };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  checkSharedNankanPredictions()
    .then(({ found, foundCodes }) => {
      // stdout は機械可読 2 行のみ（workflow が capture）。token / body は含めない。
      // 診断ログは logger.error → stderr 経由のみ（stdout KEY=VALUE 解析を汚染しない）。
      process.stdout.write(`FOUND=${found}\n`);
      process.stdout.write(`FOUND_CODES=${foundCodes.join(' ')}\n`);
    })
    .catch((e) => {
      process.stderr.write(`${e?.message ?? String(e)}\n`); // message のみ（token を含まない）
      process.exit(1);
    });
}
