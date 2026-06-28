/**
 * syncArchiveResults.test.mjs — syncArchiveResults の checkSharedResults 部分の単体テスト
 * （node:test / mock client / 実 GitHub 通信なし / ファイル書込なし）
 *   node --test scripts/syncArchiveResults.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSharedResults } from './syncArchiveResults.js';
import { createSharedClient, SHARED_FETCH_CODES } from './lib/sharedFetch.mjs';

const SECRET = 'ghp_MOCK_TOKEN_syncArchiveResults_test';
const ENV_OK = { KEIBA_DATA_SHARED_TOKEN: SECRET };
const DATE = '2026-05-12';
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

// ----- checkSharedResults (nankan) -----

test('1. token 未設定は TOKEN_MISSING fatal', async () => {
  const fetchImpl = mkFetch(() => mkRes(200, { races: [] }));
  const client = createSharedClient({ fetchImpl, env: {}, sleepImpl: noSleep });
  await assert.rejects(
    checkSharedResults(DATE, 'nankan', { env: {}, client }),
    (e) => e.code === SHARED_FETCH_CODES.TOKEN_MISSING,
  );
  assert.equal(fetchImpl.calls.length, 0);
});

test('2. 統合ファイル 200 → totalRaces/venues を返す（per-venue 未呼び出し）', async () => {
  const unified = { races: Array(20).fill({ id: 'r' }), venue: '南関東' };
  const fetchImpl = mkFetch(() => mkRes(200, unified));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const result = await checkSharedResults(DATE, 'nankan', { client, resolveToken: noopResolve });
  assert.equal(result.totalRaces, 20);
  assert.deepEqual(result.venues, ['南関東']);
  // 統合 1 リクエストのみ（per-venue は呼ばない）
  assert.equal(fetchImpl.calls.length, 1);
  assert.ok(fetchImpl.calls[0].url.includes(`nankan/results/${YEAR}/${MONTH}/${DATE}.json`));
});

test('3. 統合 races が空 → per-venue (OOI/FUN/KAW/URA) にフォールバック', async () => {
  const fetchImpl = mkFetch((url) => {
    if (!url.includes('-')) return mkRes(200, { races: [], venue: 'unified' }); // 統合: race なし
    if (url.includes('-OOI.json')) return mkRes(200, { races: Array(12).fill({ id: 'r' }) });
    if (url.includes('-FUN.json')) return mkRes(200, { races: Array(11).fill({ id: 'r' }) });
    return mkRes(404, 'Not Found');
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const result = await checkSharedResults(DATE, 'nankan', { client, resolveToken: noopResolve });
  assert.equal(result.totalRaces, 23);
  assert.deepEqual(result.venues, ['OOI', 'FUN']);
});

test('4. 全ファイル 404 → totalRaces=0, venues=[]', async () => {
  const client = mkClient(() => mkRes(404, 'Not Found'));
  const result = await checkSharedResults(DATE, 'nankan', { client, resolveToken: noopResolve });
  assert.equal(result.totalRaces, 0);
  assert.deepEqual(result.venues, []);
});

test('5. 401 は AUTH_FAILED fatal（統合 fetch）', async () => {
  const client = mkClient(() => mkRes(401, 'Bad credentials'));
  await assert.rejects(
    checkSharedResults(DATE, 'nankan', { client, resolveToken: noopResolve }),
    (e) => e.code === SHARED_FETCH_CODES.AUTH_FAILED,
  );
});

test('6. 5xx は SERVER_ERROR fatal', async () => {
  const client = mkClient(() => mkRes(500, 'err'));
  await assert.rejects(
    checkSharedResults(DATE, 'nankan', { client, resolveToken: noopResolve }),
    (e) => e.code === SHARED_FETCH_CODES.SERVER_ERROR,
  );
});

// ----- checkSharedResults (jra) -----

test('7. JRA トラック → JRA per-venue リスト（10会場）を使用', async () => {
  const fetchImpl = mkFetch((url) => {
    if (url.includes('-TOK.json')) return mkRes(200, { races: Array(12).fill({ id: 'r' }) });
    return mkRes(404, 'Not Found');
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const result = await checkSharedResults(DATE, 'jra', { client, resolveToken: noopResolve });
  assert.equal(result.totalRaces, 12);
  assert.deepEqual(result.venues, ['TOK']);
});

test('8. JRA: HAK が使用されない（HKD のみ）', async () => {
  const fetchImpl = mkFetch(() => mkRes(404, 'Not Found'));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  await checkSharedResults(DATE, 'jra', { client, resolveToken: noopResolve });
  const accessedUrls = fetchImpl.calls.map((c) => c.url);
  assert.ok(!accessedUrls.some((u) => u.includes('-HAK.json')), 'HAK が使用されてはいけない');
  assert.ok(accessedUrls.some((u) => u.includes('-HKD.json')), 'HKD は使用されるべき');
});

test('9. nankan: per-venue 途中で 401 → throw（partial 集計せず）', async () => {
  const fetchImpl = mkFetch((url) => {
    if (!url.includes('-')) return mkRes(404, 'Not Found'); // 統合 404
    if (url.includes('-OOI.json')) return mkRes(200, { races: [{ id: 'r' }] });
    return mkRes(401, 'Unauthorized');
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  await assert.rejects(
    checkSharedResults(DATE, 'nankan', { client, resolveToken: noopResolve }),
    (e) => e.code === SHARED_FETCH_CODES.AUTH_FAILED,
  );
});

test('10. 統合ファイル 404 → per-venue 全 404 → totalRaces=0, venues=[]', async () => {
  const client = mkClient(() => mkRes(404, 'Not Found'));
  const result = await checkSharedResults(DATE, 'nankan', { client, resolveToken: noopResolve });
  assert.equal(result.totalRaces, 0);
  assert.deepEqual(result.venues, []);
});
