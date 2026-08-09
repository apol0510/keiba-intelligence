/**
 * checkSharedJraPredictions.mjs — JRA racebook / computer 予想の per-venue 存在確認（認証付き / sharedFetch 再利用）
 *
 * keiba-data-shared private 化後も動くよう、匿名 raw/curl を廃し sharedFetch helper の
 * 認証付き Contents API で確認する。契約（token必須・401/403/429/5xx fatal・404のみ未投入）は
 * helper と一元化し、workflow shell 側へ二重実装しない。
 *
 * token 契約:
 *   KEIBA_DATA_SHARED_TOKEN が必須。GITHUB_TOKEN への fallback は禁止。
 *   KEIBA_DATA_SHARED_TOKEN 未設定 or 空の場合、HTTP 到達前に TOKEN_MISSING で fatal。
 *
 * 確認パス（per-venue 各2種）:
 *   jra/racebook/YYYY/MM/YYYY-MM-DD-{CODE}.json
 *   jra/predictions/computer/YYYY/MM/YYYY-MM-DD-{CODE}.json
 *
 * 使い方:
 *   node scripts/checkSharedJraPredictions.mjs --date 2026-05-08
 *   node scripts/checkSharedJraPredictions.mjs --date 2026-05-08 --venues TOK,KYO,HAN
 *
 * 直接実行時の stdout（機械可読・2 行のみ。token / response body は出力しない）:
 *   RACEBOOK_CODES=TOK HAN
 *   COMPUTER_CODES=TOK
 *   （見つからない種別は空文字列。例: COMPUTER_CODES= ）
 * 診断ログは stderr のみ（stdout の KEY=VALUE 解析を汚染しない）。
 *
 * exit code:
 *   0 … 全会場・全種別を確定できた（200=存在 / 認証済み404=未投入）。空でも「正常な空」
 *   2 … 一時エラー（rate limit / timeout / 5xx）で確定不能。呼び出し側はスキップしてよい
 *   1 … token 未設定 / 401 / 権限不足 / その他 fatal（＝確定不能。運用者の対応が要る）
 */
import { pathToFileURL } from 'node:url';
import { createSharedClient, SharedFetchError, SHARED_FETCH_CODES } from './lib/sharedFetch.mjs';
import { createMonthIndex, exitWithSharedFetchError } from './lib/sharedCheckerSupport.mjs';

const DEFAULT_VENUES = ['FKS', 'HAN', 'NAK', 'TOK', 'KYO', 'CHU', 'KOK', 'NII', 'SAP', 'HKD'];

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
 * @returns {Promise<{racebookCodes: string[], computerCodes: string[]}>}
 *   1 件でも認証/通信 fatal があれば throw（partial result は返さない）。
 */
export async function checkSharedJraPredictions({
  argv = process.argv.slice(2),
  env = process.env,
  client,
  logger = console,
} = {}) {
  // KEIBA_DATA_SHARED_TOKEN 必須。GITHUB_TOKEN fallback 禁止。HTTP 到達前に検証。
  const token = requireCrossRepoToken(env);

  const args = parseArgs(argv);
  if (!args.date) throw new Error('Usage: --date YYYY-MM-DD [--venues TOK,KYO,...]');
  const venues = (args.venues || DEFAULT_VENUES.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // KEIBA_DATA_SHARED_TOKEN のみを渡す（env 内の他 token を client へ漏洩させない）
  const c = client ?? createSharedClient({ env: { [CROSS_REPO_TOKEN_KEY]: token } });
  const [y, m] = args.date.split('-');

  const racebookCodes = [];
  const computerCodes = [];

  // 本 checker は「ファイルが有るか無いか」しか見ない（中身を読まない）。
  // 月ディレクトリ一覧 1 GET で存在が分かるので、会場ごとの GET は撃たない。
  // 従来は 1 日あたり 10会場 × 2種別 = 20 GET を、非開催日でも撃っていた。
  const rbDir = `jra/racebook/${y}/${m}`;
  const cpDir = `jra/predictions/computer/${y}/${m}`;
  const monthIndex = createMonthIndex(c, 'main');

  // 一覧が信用できない月（'unknown'）のみ、従来どおり個別 GET で確かめる。
  // 未検証で found と報告しない（誤アラートを作らない）。
  async function existsViaIndexOrFetch(dir, fileName, label) {
    const state = await monthIndex.status(dir, fileName);
    if (state === 'present') return true;
    if (state === 'absent') return false;
    logger.error(`🔄 ${label}: month listing untrusted → verifying by GET`);
    return (await c.fetchJson(`${dir}/${fileName}`, { ref: 'main', required: false })) !== null;
  }

  for (const code of venues) {
    const fileName = `${args.date}-${code}.json`;

    // racebook チェック
    if (await existsViaIndexOrFetch(rbDir, fileName, `racebook ${code}`)) {
      racebookCodes.push(code);
      logger.error(`✅ racebook ${code}: found`);
    } else {
      logger.error(`⏭️  racebook ${code}: not posted yet`);
    }

    // computer 予想チェック
    if (await existsViaIndexOrFetch(cpDir, fileName, `computer ${code}`)) {
      computerCodes.push(code);
      logger.error(`✅ computer ${code}: found`);
    } else {
      logger.error(`⏭️  computer ${code}: not posted yet`);
    }
  }

  return { racebookCodes, computerCodes };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  checkSharedJraPredictions()
    .then(({ racebookCodes, computerCodes }) => {
      // stdout は機械可読 2 行のみ（workflow が capture）。token / body は含めない。
      // 診断ログは logger.error → stderr 経由のみ（stdout KEY=VALUE 解析を汚染しない）。
      process.stdout.write(`RACEBOOK_CODES=${racebookCodes.join(' ')}\n`);
      process.stdout.write(`COMPUTER_CODES=${computerCodes.join(' ')}\n`);
    })
    .catch((e) => exitWithSharedFetchError(e)); // 一時エラーは exit 2、それ以外は exit 1
}
