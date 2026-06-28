/**
 * importResults.test.mjs — Nankan 結果インポーターの sharedFetch 取得部分の単体テスト
 * （node:test / mock client / 実 GitHub 通信なし / ファイル書込なし）
 *   node --test scripts/importResults.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchSharedResults, fetchAndMergeVenueResults } from './importResults.js';
import { createSharedClient, SHARED_FETCH_CODES } from './lib/sharedFetch.mjs';

const SECRET = 'ghp_MOCK_TOKEN_importResults_test';
const ENV_OK = { KEIBA_DATA_SHARED_TOKEN: SECRET };
const DATE = '2026-05-10';
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
const silentLogger = { log() {}, warn() {}, error() {} };

function mkClient(responder) {
  return createSharedClient({ fetchImpl: mkFetch(responder), env: ENV_OK, sleepImpl: noSleep });
}

function noopResolve() {}

// ----- fetchSharedResults -----

test('1. token 未設定は TOKEN_MISSING fatal（fetch 未実行）', async () => {
  const fetchImpl = mkFetch(() => mkRes(200, { races: [] }));
  const client = createSharedClient({ fetchImpl, env: {}, sleepImpl: noSleep });
  await assert.rejects(
    fetchSharedResults(DATE, 'nankan', { env: {}, client }),
    (e) => e.code === SHARED_FETCH_CODES.TOKEN_MISSING,
  );
  assert.equal(fetchImpl.calls.length, 0);
});

test('2. 統合ファイル 200 → unified をそのまま返す（per-venue 未呼び出し）', async () => {
  const unified = { date: DATE, races: [{ id: 'R1' }, { id: 'R2' }], venue: '大井' };
  const fetchImpl = mkFetch(() => mkRes(200, unified));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const result = await fetchSharedResults(DATE, 'nankan', { client, resolveToken: noopResolve });
  assert.equal(result.races.length, 2);
  assert.equal(result.venue, '大井');
  // 統合 1 回のみ（per-venue は呼ばない）
  assert.equal(fetchImpl.calls.length, 1);
  assert.ok(fetchImpl.calls[0].url.includes(`nankan/results/${YEAR}/${MONTH}/${DATE}.json`));
});

test('3. 統合 404 → per-venue (OOI/FUN/KAW/URA) にフォールバック', async () => {
  const fetchImpl = mkFetch((url) => {
    if (url.includes(`/${DATE}.json`)) return mkRes(404, 'Not Found');
    if (url.includes('-OOI.json')) return mkRes(200, { races: [{ id: 'R1' }], venue: '大井' });
    if (url.includes('-FUN.json')) return mkRes(200, { races: [{ id: 'R2' }], venue: '船橋' });
    return mkRes(404, 'Not Found');
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const result = await fetchSharedResults(DATE, 'nankan', { client, resolveToken: noopResolve });
  assert.equal(result.races.length, 2);
  assert.ok(result.venues.includes('大井'));
  assert.ok(result.venues.includes('船橋'));
});

test('4. per-venue 部分 404 はスキップして残りをマージ（KAW/URA = 404）', async () => {
  const fetchImpl = mkFetch((url) => {
    if (url.includes(`/${DATE}.json`)) return mkRes(404, 'Not Found'); // unified 404
    if (url.includes('-OOI.json')) return mkRes(200, { races: [{ id: 'R1' }], venue: '大井' });
    return mkRes(404, 'Not Found'); // FUN/KAW/URA 404
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const result = await fetchSharedResults(DATE, 'nankan', { client, resolveToken: noopResolve });
  assert.equal(result.races.length, 1);
  assert.deepEqual(result.venues, ['大井']);
});

test('5. 401 は AUTH_FAILED fatal（統合 fetch で失敗）', async () => {
  const client = mkClient(() => mkRes(401, 'Bad credentials'));
  await assert.rejects(
    fetchSharedResults(DATE, 'nankan', { client, resolveToken: noopResolve }),
    (e) => e.code === SHARED_FETCH_CODES.AUTH_FAILED,
  );
});

test('6. 403（非 rate）は FORBIDDEN fatal', async () => {
  const client = mkClient(() => mkRes(403, 'Forbidden', { 'x-ratelimit-remaining': '50' }));
  await assert.rejects(
    fetchSharedResults(DATE, 'nankan', { client, resolveToken: noopResolve }),
    (e) => e.code === SHARED_FETCH_CODES.FORBIDDEN,
  );
});

test('7. 429 は retry 後 RATE_LIMITED fatal', async () => {
  const fetchImpl = mkFetch(() => mkRes(429, 'too many'));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep, retries: 2 });
  await assert.rejects(
    fetchSharedResults(DATE, 'nankan', { client, resolveToken: noopResolve }),
    (e) => e.code === SHARED_FETCH_CODES.RATE_LIMITED,
  );
});

test('8. 5xx は retry 後 SERVER_ERROR fatal', async () => {
  const client = mkClient(() => mkRes(500, 'err'));
  await assert.rejects(
    fetchSharedResults(DATE, 'nankan', { client, resolveToken: noopResolve }),
    (e) => e.code === SHARED_FETCH_CODES.SERVER_ERROR,
  );
});

test('9. malformed JSON は INVALID_JSON fatal', async () => {
  const client = mkClient(() => mkRes(200, 'not json'));
  await assert.rejects(
    fetchSharedResults(DATE, 'nankan', { client, resolveToken: noopResolve }),
    (e) => e.code === SHARED_FETCH_CODES.INVALID_JSON,
  );
});

test('10. per-venue 途中で 401 → partial result を返さず throw', async () => {
  const fetchImpl = mkFetch((url) => {
    if (url.includes(`/${DATE}.json`)) return mkRes(404, 'Not Found');
    if (url.includes('-OOI.json')) return mkRes(200, { races: [{ id: 'R1' }], venue: '大井' });
    return mkRes(401, 'Unauthorized');
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  await assert.rejects(
    fetchSharedResults(DATE, 'nankan', { client, resolveToken: noopResolve }),
    (e) => e.code === SHARED_FETCH_CODES.AUTH_FAILED,
  );
});

// ----- fetchAndMergeVenueResults -----

test('11. 複数会場の race が合算される', async () => {
  const fetchImpl = mkFetch((url) => {
    if (url.includes('-OOI.json')) return mkRes(200, { races: Array(12).fill({ id: 'x' }), venue: '大井' });
    if (url.includes('-FUN.json')) return mkRes(200, { races: Array(11).fill({ id: 'y' }), venue: '船橋' });
    return mkRes(404, 'Not Found');
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const result = await fetchAndMergeVenueResults(DATE, YEAR, MONTH, client);
  assert.equal(result.races.length, 23);
  assert.deepEqual(result.venues, ['大井', '船橋']);
  assert.equal(result.totalRaces, 23);
});

test('12. 全会場 404 → "結果データが見つかりません" throw', async () => {
  const client = mkClient(() => mkRes(404, 'Not Found'));
  await assert.rejects(
    fetchAndMergeVenueResults(DATE, YEAR, MONTH, client),
    (e) => e.message.includes('結果データが見つかりません'),
  );
});

test('13. venue name は venueData.venue 優先、なければ venue code を使用', async () => {
  const fetchImpl = mkFetch((url) => {
    if (url.includes('-OOI.json')) return mkRes(200, { races: [{ id: 'R1' }] }); // venue フィールドなし
    return mkRes(404, 'Not Found');
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const result = await fetchAndMergeVenueResults(DATE, YEAR, MONTH, client);
  assert.deepEqual(result.venues, ['OOI']); // venue フィールドがないため code をフォールバック
});
