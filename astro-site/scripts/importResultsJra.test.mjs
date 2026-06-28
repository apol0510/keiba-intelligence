/**
 * importResultsJra.test.mjs — JRA 結果インポーターの sharedFetch 取得部分の単体テスト
 * （node:test / mock client / 実 GitHub 通信なし / ファイル書込なし）
 *   node --test scripts/importResultsJra.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchSharedResults, fetchAndMergeVenueResults, checkSharedPredictionExists } from './importResultsJra.js';
import { createSharedClient, SHARED_FETCH_CODES } from './lib/sharedFetch.mjs';

const SECRET = 'ghp_MOCK_TOKEN_importResultsJra_test';
const ENV_OK = { KEIBA_DATA_SHARED_TOKEN: SECRET };
const DATE = '2026-05-11';
const YEAR = '2026', MONTH = '05';

const JRA_VENUES = ['TOK', 'KYO', 'HAN', 'NAK', 'CHU', 'KOK', 'NII', 'FKS', 'SAP', 'HKD'];

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

// ----- fetchSharedResults -----

test('1. token 未設定は TOKEN_MISSING fatal（fetch 未実行）', async () => {
  const fetchImpl = mkFetch(() => mkRes(200, { races: [] }));
  const client = createSharedClient({ fetchImpl, env: {}, sleepImpl: noSleep });
  await assert.rejects(
    fetchSharedResults(DATE, 'jra', { env: {}, client }),
    (e) => e.code === SHARED_FETCH_CODES.TOKEN_MISSING,
  );
  assert.equal(fetchImpl.calls.length, 0);
});

test('2. JRA は per-venue 直接（統合ファイルなし）。TOK/KYO あり → マージ', async () => {
  const fetchImpl = mkFetch((url) => {
    if (url.includes('-TOK.json')) return mkRes(200, { races: Array(12).fill({ id: 'r1' }), venue: '東京' });
    if (url.includes('-KYO.json')) return mkRes(200, { races: Array(10).fill({ id: 'r2' }), venue: '京都' });
    return mkRes(404, 'Not Found');
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const result = await fetchSharedResults(DATE, 'jra', { client, resolveToken: noopResolve });
  assert.equal(result.races.length, 22);
  assert.ok(result.venues.includes('東京'));
  assert.ok(result.venues.includes('京都'));
});

test('3. 全会場 404 → "全会場の per-venue ファイル404" throw', async () => {
  const client = mkClient(() => mkRes(404, 'Not Found'));
  await assert.rejects(
    fetchSharedResults(DATE, 'jra', { client, resolveToken: noopResolve }),
    (e) => e.message.includes('全会場の per-venue ファイル404'),
  );
});

test('4. 401 は AUTH_FAILED fatal', async () => {
  const client = mkClient(() => mkRes(401, 'Bad credentials'));
  await assert.rejects(
    fetchSharedResults(DATE, 'jra', { client, resolveToken: noopResolve }),
    (e) => e.code === SHARED_FETCH_CODES.AUTH_FAILED,
  );
});

test('5. 403（非 rate）は FORBIDDEN fatal', async () => {
  const client = mkClient(() => mkRes(403, 'Forbidden', { 'x-ratelimit-remaining': '50' }));
  await assert.rejects(
    fetchSharedResults(DATE, 'jra', { client, resolveToken: noopResolve }),
    (e) => e.code === SHARED_FETCH_CODES.FORBIDDEN,
  );
});

test('6. 429 は RATE_LIMITED fatal', async () => {
  const fetchImpl = mkFetch(() => mkRes(429, 'too many'));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep, retries: 2 });
  await assert.rejects(
    fetchSharedResults(DATE, 'jra', { client, resolveToken: noopResolve }),
    (e) => e.code === SHARED_FETCH_CODES.RATE_LIMITED,
  );
});

test('7. 5xx は SERVER_ERROR fatal', async () => {
  const client = mkClient(() => mkRes(500, 'err'));
  await assert.rejects(
    fetchSharedResults(DATE, 'jra', { client, resolveToken: noopResolve }),
    (e) => e.code === SHARED_FETCH_CODES.SERVER_ERROR,
  );
});

// ----- fetchAndMergeVenueResults -----

test('8. race に venue フィールドがない場合は venue code を注入する', async () => {
  const fetchImpl = mkFetch((url) => {
    // HAN ファイル: races[].venue フィールドなし
    if (url.includes('-HAN.json')) return mkRes(200, { races: [{ id: 'R1' }], venue: '阪神' });
    return mkRes(404, 'Not Found');
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const result = await fetchAndMergeVenueResults(DATE, YEAR, MONTH, client);
  // race に venue が注入される
  assert.equal(result.races[0].venue, '阪神');
});

test('9. race に既存 venue フィールドがある場合は上書きしない', async () => {
  const fetchImpl = mkFetch((url) => {
    if (url.includes('-TOK.json')) {
      return mkRes(200, { races: [{ id: 'R1', venue: '東京（既存）' }], venue: '東京' });
    }
    return mkRes(404, 'Not Found');
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const result = await fetchAndMergeVenueResults(DATE, YEAR, MONTH, client);
  // 既存 venue は保持される
  assert.equal(result.races[0].venue, '東京（既存）');
});

test('10. HAK は使用されない（HKD のみ。10 会場 = 正規リスト）', async () => {
  const fetchImpl = mkFetch((url) => {
    return mkRes(404, 'Not Found');
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  // 全会場 404 → throw。HAK を試みていないことを fetch URL から確認
  await assert.rejects(
    fetchAndMergeVenueResults(DATE, YEAR, MONTH, client),
    (e) => e.message.includes('全会場の per-venue ファイル404'),
  );
  const accessedUrls = fetchImpl.calls.map((c) => c.url);
  assert.ok(!accessedUrls.some((u) => u.includes('-HAK.json')), 'HAK が使用されてはいけない');
  assert.ok(accessedUrls.some((u) => u.includes('-HKD.json')), 'HKD は使用されるべき');
});

test('11. 全10会場にリクエストが飛ぶ（TOK,KYO,HAN,NAK,CHU,KOK,NII,FKS,SAP,HKD）', async () => {
  const fetchImpl = mkFetch(() => mkRes(404, 'Not Found'));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  await assert.rejects(
    fetchAndMergeVenueResults(DATE, YEAR, MONTH, client),
    () => true,
  );
  const accessedCodes = fetchImpl.calls.map((c) => {
    const m = c.url.match(/-([A-Z]+)\.json/);
    return m ? m[1] : null;
  }).filter(Boolean);
  for (const code of JRA_VENUES) {
    assert.ok(accessedCodes.includes(code), `${code} へのリクエストが期待される`);
  }
  assert.equal(accessedCodes.length, 10);
});

test('12. 一部会場 auth fail → partial を返さず throw', async () => {
  const fetchImpl = mkFetch((url) => {
    if (url.includes('-TOK.json')) return mkRes(200, { races: [{ id: 'R1' }], venue: '東京' });
    if (url.includes('-KYO.json')) return mkRes(401, 'Unauthorized');
    return mkRes(404, 'Not Found');
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  await assert.rejects(
    fetchAndMergeVenueResults(DATE, YEAR, MONTH, client),
    (e) => e.code === SHARED_FETCH_CODES.AUTH_FAILED,
  );
});

// ----- checkSharedPredictionExists -----

test('13. 200 → true（存在あり）', async () => {
  const client = mkClient(() => mkRes(200, { predictions: [] }));
  const result = await checkSharedPredictionExists(DATE, 'TOK', { client });
  assert.equal(result, true);
});

test('14. 404 → false（存在なし = 正常）', async () => {
  const client = mkClient(() => mkRes(404, 'Not Found'));
  const result = await checkSharedPredictionExists(DATE, 'KYO', { client });
  assert.equal(result, false);
});

test('15. 401 → AUTH_FAILED throw（fatal）', async () => {
  const client = mkClient(() => mkRes(401, 'Unauthorized'));
  await assert.rejects(
    checkSharedPredictionExists(DATE, 'TOK', { client }),
    (e) => e.code === SHARED_FETCH_CODES.AUTH_FAILED,
  );
});

test('16. 403 → FORBIDDEN throw（fatal）', async () => {
  const client = mkClient(() => mkRes(403, 'Forbidden'));
  await assert.rejects(
    checkSharedPredictionExists(DATE, 'HAN', { client }),
    (e) => e.code === SHARED_FETCH_CODES.FORBIDDEN,
  );
});

test('17. 429 → RATE_LIMITED throw（fatal）', async () => {
  const client = mkClient(() => mkRes(429, 'Too Many Requests'));
  await assert.rejects(
    checkSharedPredictionExists(DATE, 'NAK', { client }),
    (e) => e.code === SHARED_FETCH_CODES.RATE_LIMITED,
  );
});

test('18. 500 → SERVER_ERROR throw（fatal）', async () => {
  const client = mkClient(() => mkRes(500, 'Internal Server Error'));
  await assert.rejects(
    checkSharedPredictionExists(DATE, 'TOK', { client }),
    (e) => e.code === SHARED_FETCH_CODES.SERVER_ERROR,
  );
});

test('19. api.github.com 経由（raw.githubusercontent.com は呼ばない / Authorization付き）', async () => {
  const fetchImpl = mkFetch(() => mkRes(200, { predictions: [] }));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  await checkSharedPredictionExists(DATE, 'TOK', { client });
  assert.equal(fetchImpl.calls.length, 1);
  assert.ok(fetchImpl.calls[0].url.includes('api.github.com'), '認証済み Contents API を使用する');
  assert.ok(!fetchImpl.calls[0].url.includes('raw.githubusercontent.com'), 'anonymous raw URL を呼ばない');
  assert.ok(fetchImpl.calls[0].init.headers.Authorization.startsWith('Bearer '), 'Authorization header 付き');
});

test('20. ネットワークエラー → INVALID_RESPONSE throw（fatal）', async () => {
  const fetchImpl = mkFetch(() => { throw new Error('Network failed'); });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  await assert.rejects(
    checkSharedPredictionExists(DATE, 'TOK', { client }),
    (e) => e.code === SHARED_FETCH_CODES.INVALID_RESPONSE,
  );
});

test('21. malformed JSON → INVALID_JSON throw（fatal）', async () => {
  const client = mkClient(() => mkRes(200, 'malformed{{{json'));
  await assert.rejects(
    checkSharedPredictionExists(DATE, 'KYO', { client }),
    (e) => e.code === SHARED_FETCH_CODES.INVALID_JSON,
  );
});
