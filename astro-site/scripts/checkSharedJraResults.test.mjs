/**
 * checkSharedJraResults.test.mjs — JRA per-venue results 確認 script の単体テスト
 * （node:test / 新規依存なし / 全 mock fetch・実 GitHub 通信なし）
 *   node --test scripts/checkSharedJraResults.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSharedJraResults } from './checkSharedJraResults.mjs';
import { createSharedClient, SHARED_FETCH_CODES } from './lib/sharedFetch.mjs';

const SECRET = 'ghp_THIS_IS_A_TEST_SECRET_TOKEN_should_never_leak';
const ENV_OK = { KEIBA_DATA_SHARED_TOKEN: SECRET };
const DATE = '2026-05-08';
const ARGV = ['--date', DATE, '--venues', 'TOK,KYO'];

function mkRes(status, body, headers = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    status,
    headers: { get: (n) => (n.toLowerCase() in lower ? lower[n.toLowerCase()] : null) },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}
function mkFetch(responder) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init }); return responder(url, init, calls.length - 1); };
  fn.calls = calls;
  return fn;
}
const noSleep = async () => {};
const silentLogger = { log() {}, warn() {}, error() {} };

function clientWith(responder, { retries = 2 } = {}) {
  return createSharedClient({ fetchImpl: mkFetch(responder), env: ENV_OK, sleepImpl: noSleep, retries });
}
function run(overrides = {}) {
  return checkSharedJraResults({ argv: ARGV, env: ENV_OK, logger: silentLogger, ...overrides });
}

// 全会場 404 → FOUND_CODES=[] TOTAL_RACES=0（正常な空）
test('1. 全会場 404 → foundCodes=[] totalRaces=0（exit 0 相当）', async () => {
  const client = clientWith(() => mkRes(404, 'Not Found'));
  const { foundCodes, totalRaces } = await run({ client });
  assert.deepEqual(foundCodes, []);
  assert.equal(totalRaces, 0);
});

// 一部会場のみ存在 → 存在会場のコードと合計 race 数
test('2. 一部会場のみ存在 → foundCodes・totalRaces が正しい', async () => {
  const fetchImpl = mkFetch((url) => {
    if (url.includes('-TOK.json')) return mkRes(200, { races: [1, 2, 3].map(() => ({})) });
    if (url.includes('-KYO.json')) return mkRes(404, 'Not Found');
    return mkRes(404, 'Not Found');
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const { foundCodes, totalRaces } = await run({ client });
  assert.deepEqual(foundCodes, ['TOK']);
  assert.equal(totalRaces, 3);
});

// 複数会場存在 → 合算
test('3. 複数会場存在 → race 数を合算', async () => {
  const fetchImpl = mkFetch((url) => {
    if (url.includes('-TOK.json')) return mkRes(200, { races: Array(12).fill({}) });
    if (url.includes('-KYO.json')) return mkRes(200, { races: Array(11).fill({}) });
    return mkRes(404, 'Not Found');
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const { foundCodes, totalRaces } = await run({ client });
  assert.deepEqual(foundCodes, ['TOK', 'KYO']);
  assert.equal(totalRaces, 23);
});

// token 未設定 → TOKEN_MISSING fatal（fetch 呼ばない）
test('4. token 未設定は TOKEN_MISSING（fetch 未実行）', async () => {
  const fetchImpl = mkFetch(() => mkRes(200, { races: [] }));
  const client = createSharedClient({ fetchImpl, env: {}, sleepImpl: noSleep });
  await assert.rejects(
    checkSharedJraResults({ argv: ARGV, env: {}, logger: silentLogger, client }),
    (e) => e.code === SHARED_FETCH_CODES.TOKEN_MISSING,
  );
  assert.equal(fetchImpl.calls.length, 0);
});

// 401 → AUTH_FAILED fatal
test('5. 401 は AUTH_FAILED fatal', async () => {
  const client = clientWith(() => mkRes(401, 'Bad credentials'));
  await assert.rejects(run({ client }), (e) => e.code === SHARED_FETCH_CODES.AUTH_FAILED);
});

// 403（非 rate）→ FORBIDDEN fatal
test('6. 403（非 rate）は FORBIDDEN fatal', async () => {
  const client = clientWith(() => mkRes(403, 'Forbidden', { 'x-ratelimit-remaining': '50' }));
  await assert.rejects(run({ client }), (e) => e.code === SHARED_FETCH_CODES.FORBIDDEN);
});

// 429 → RATE_LIMITED fatal（retry 後）
test('7. 429 は retry 後 RATE_LIMITED fatal', async () => {
  const fetchImpl = mkFetch(() => mkRes(429, 'too many'));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep, retries: 2 });
  await assert.rejects(run({ client }), (e) => e.code === SHARED_FETCH_CODES.RATE_LIMITED);
});

// 5xx → SERVER_ERROR fatal（retry 後）
test('8. 5xx は retry 後 SERVER_ERROR fatal', async () => {
  const client = clientWith(() => mkRes(500, 'err'));
  await assert.rejects(run({ client }), (e) => e.code === SHARED_FETCH_CODES.SERVER_ERROR);
});

// timeout → TIMEOUT fatal（retry 後）
test('9. timeout は retry 後 TIMEOUT fatal', async () => {
  const fetchImpl = mkFetch(() => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep, retries: 2 });
  await assert.rejects(run({ client }), (e) => e.code === SHARED_FETCH_CODES.TIMEOUT);
});

// 途中の会場で auth 失敗 → partial result を返さない（throw）
test('10. 2 会場目で 401 → partial result を返さず throw（fetch 順保証）', async () => {
  const fetchImpl = mkFetch((url) => {
    if (url.includes('-TOK.json')) return mkRes(200, { races: Array(12).fill({}) });
    return mkRes(401, 'Bad credentials'); // KYO で 401
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  await assert.rejects(run({ client }), (e) => e.code === SHARED_FETCH_CODES.AUTH_FAILED);
});
