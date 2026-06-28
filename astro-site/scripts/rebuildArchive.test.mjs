/**
 * rebuildArchive.test.mjs — rebuildArchive の fetchResultsFromAPI 部分の単体テスト
 * （node:test / mock client / 実 GitHub 通信なし / ファイル書込なし）
 *   node --test scripts/rebuildArchive.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchResultsFromAPI } from './rebuildArchive.js';
import { createSharedClient, SHARED_FETCH_CODES } from './lib/sharedFetch.mjs';

const SECRET = 'ghp_MOCK_TOKEN_rebuildArchive_test';
const ENV_OK = { KEIBA_DATA_SHARED_TOKEN: SECRET };
const DATE = '2026-05-13';
const YEAR = '2026', MONTH = '05';

function mkRes(status, body, headers = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    status,
    headers: { get: (n) => lower[n.toLowerCase()] ?? null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}
function mkFetch(responder) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init }); return responder(url, calls.length - 1); };
  fn.calls = calls;
  return fn;
}
const noSleep = async () => {};

function mkClient(responder) {
  return createSharedClient({ fetchImpl: mkFetch(responder), env: ENV_OK, sleepImpl: noSleep });
}

function noopResolve() {}

test('1. token 未設定は TOKEN_MISSING fatal（fetch 未実行）', async () => {
  const fetchImpl = mkFetch(() => mkRes(200, { races: [] }));
  const client = createSharedClient({ fetchImpl, env: {}, sleepImpl: noSleep });
  await assert.rejects(
    fetchResultsFromAPI(DATE, { env: {}, client }),
    (e) => e.code === SHARED_FETCH_CODES.TOKEN_MISSING,
  );
  assert.equal(fetchImpl.calls.length, 0);
});

test('2. 統合ファイル 200 → data を返す', async () => {
  const data = { date: DATE, races: Array(20).fill({ id: 'r' }), venue: '大井' };
  const fetchImpl = mkFetch(() => mkRes(200, data));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const result = await fetchResultsFromAPI(DATE, { client, resolveToken: noopResolve });
  assert.equal(result.races.length, 20);
  assert.equal(result.venue, '大井');
  assert.equal(fetchImpl.calls.length, 1);
  assert.ok(fetchImpl.calls[0].url.includes(`nankan/results/${YEAR}/${MONTH}/${DATE}.json`));
});

test('3. 統合ファイル 404 → null を返す（required:false）', async () => {
  const client = mkClient(() => mkRes(404, 'Not Found'));
  const result = await fetchResultsFromAPI(DATE, { client, resolveToken: noopResolve });
  assert.equal(result, null);
});

test('4. 401 は AUTH_FAILED fatal', async () => {
  const client = mkClient(() => mkRes(401, 'Bad credentials'));
  await assert.rejects(
    fetchResultsFromAPI(DATE, { client, resolveToken: noopResolve }),
    (e) => e.code === SHARED_FETCH_CODES.AUTH_FAILED,
  );
});

test('5. 403 は FORBIDDEN fatal', async () => {
  const client = mkClient(() => mkRes(403, 'Forbidden', { 'x-ratelimit-remaining': '50' }));
  await assert.rejects(
    fetchResultsFromAPI(DATE, { client, resolveToken: noopResolve }),
    (e) => e.code === SHARED_FETCH_CODES.FORBIDDEN,
  );
});

test('6. 429 は RATE_LIMITED fatal', async () => {
  const fetchImpl = mkFetch(() => mkRes(429, 'too many'));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep, retries: 2 });
  await assert.rejects(
    fetchResultsFromAPI(DATE, { client, resolveToken: noopResolve }),
    (e) => e.code === SHARED_FETCH_CODES.RATE_LIMITED,
  );
});

test('7. 5xx は SERVER_ERROR fatal', async () => {
  const client = mkClient(() => mkRes(500, 'err'));
  await assert.rejects(
    fetchResultsFromAPI(DATE, { client, resolveToken: noopResolve }),
    (e) => e.code === SHARED_FETCH_CODES.SERVER_ERROR,
  );
});

test('8. malformed JSON は INVALID_JSON fatal', async () => {
  const client = mkClient(() => mkRes(200, 'not json'));
  await assert.rejects(
    fetchResultsFromAPI(DATE, { client, resolveToken: noopResolve }),
    (e) => e.code === SHARED_FETCH_CODES.INVALID_JSON,
  );
});

test('9. リクエスト URL が nankan パスを含む', async () => {
  const fetchImpl = mkFetch(() => mkRes(404, 'Not Found'));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  await fetchResultsFromAPI(DATE, { client, resolveToken: noopResolve });
  assert.ok(fetchImpl.calls[0].url.includes('nankan/results'));
});

test('10. 日付からパスが year/month/DATE.json 形式で生成される', async () => {
  const fetchImpl = mkFetch(() => mkRes(404, 'Not Found'));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  await fetchResultsFromAPI(DATE, { client, resolveToken: noopResolve });
  const url = fetchImpl.calls[0].url;
  assert.ok(url.includes(`${YEAR}/${MONTH}/${DATE}.json`));
});
