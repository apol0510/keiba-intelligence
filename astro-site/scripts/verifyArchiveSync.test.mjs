/**
 * verifyArchiveSync.test.mjs — verifyArchiveSync の getLatestResultDate 部分の単体テスト
 * （node:test / mock client / 実 GitHub 通信なし / ファイル読取なし）
 *   node --test scripts/verifyArchiveSync.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLatestResultDate } from './verifyArchiveSync.js';
import { createSharedClient, SHARED_FETCH_CODES } from './lib/sharedFetch.mjs';

const SECRET = 'ghp_MOCK_TOKEN_verifyArchiveSync_test';
const ENV_OK = { KEIBA_DATA_SHARED_TOKEN: SECRET };

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
  const fetchImpl = mkFetch(() => mkRes(200, {}));
  const client = createSharedClient({ fetchImpl, env: {}, sleepImpl: noSleep });
  await assert.rejects(
    getLatestResultDate({ env: {}, client }),
    (e) => e.code === SHARED_FETCH_CODES.TOKEN_MISSING,
  );
  assert.equal(fetchImpl.calls.length, 0);
});

test('2. 統合ファイルが存在する日付を返す（source=unified）', async () => {
  // 今日以外全部 404、今日の統合ファイルのみ 200
  const target = '2026-05-10';
  const fetchImpl = mkFetch((url) => {
    if (url.includes(`${target}/nankan/results`)) return mkRes(200, { races: Array(20).fill({ id: 'r' }), venue: '大井' });
    // URL は "nankan/results/YYYY/MM/DATE.json" 形式なのでこちらで判定
    if (url.includes(target.replace(/-/g, '/'))) return mkRes(200, { races: Array(20).fill({ id: 'r' }), venue: '大井' });
    if (url.includes(target.slice(5).replace('-', '/') + '/' + target)) return mkRes(200, { races: Array(20).fill({ id: 'r' }), venue: '大井' });
    return mkRes(404, 'Not Found');
  });
  // getLatestResultDate は JST 今日から遡るため、today を差し込むのが難しい
  // ここでは最初のリクエスト（今日）が hit するよう統合ファイルを常に 200 で返すクライアントを使う
  const client = createSharedClient({
    fetchImpl: mkFetch(() => mkRes(200, { races: Array(20).fill({ id: 'r' }), venue: '大井' })),
    env: ENV_OK,
    sleepImpl: noSleep,
  });
  const result = await getLatestResultDate({ client, resolveToken: noopResolve });
  assert.equal(result.source, 'unified');
  assert.ok(typeof result.date === 'string');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(result.date));
});

test('3. 統合 404 → 会場別 (totalRaces>=8) で source=venue-specific', async () => {
  // 統合は常に 404、per-venue の OOI は 200
  // URL は "…-OOI.json?ref=main" 形式なので includes を使う（正規表現 $ は末尾一致せず）
  const fetchImpl = mkFetch((url) => {
    if (url.includes('-OOI.json')) return mkRes(200, { races: Array(12).fill({ id: 'r' }) });
    return mkRes(404, 'Not Found'); // 統合 + その他の会場
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const result = await getLatestResultDate({ client, resolveToken: noopResolve });
  assert.equal(result.source, 'venue-specific');
  assert.ok(result.races >= 8);
});

test('4. 全 30 日 404 → "過去30日間に結果データが見つかりませんでした" throw', async () => {
  const client = mkClient(() => mkRes(404, 'Not Found'));
  await assert.rejects(
    getLatestResultDate({ client, resolveToken: noopResolve }),
    (e) => e.message.includes('過去30日間に結果データが見つかりませんでした'),
  );
});

test('5. 401 は AUTH_FAILED fatal（即座に throw）', async () => {
  const client = mkClient(() => mkRes(401, 'Bad credentials'));
  await assert.rejects(
    getLatestResultDate({ client, resolveToken: noopResolve }),
    (e) => e.code === SHARED_FETCH_CODES.AUTH_FAILED,
  );
});

test('6. 5xx は SERVER_ERROR fatal', async () => {
  const client = mkClient(() => mkRes(500, 'error'));
  await assert.rejects(
    getLatestResultDate({ client, resolveToken: noopResolve }),
    (e) => e.code === SHARED_FETCH_CODES.SERVER_ERROR,
  );
});

test('7. 429 は RATE_LIMITED fatal', async () => {
  const fetchImpl = mkFetch(() => mkRes(429, 'too many'));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep, retries: 2 });
  await assert.rejects(
    getLatestResultDate({ client, resolveToken: noopResolve }),
    (e) => e.code === SHARED_FETCH_CODES.RATE_LIMITED,
  );
});

test('8. per-venue totalRaces < 8 は hit とみなさない（8 未満はスキップ）', async () => {
  // 統合は常に 404、per-venue は 5 races のみ（< 8 threshold）
  const fetchImpl = mkFetch((url) => {
    if (url.match(/-OOI\.json$/)) return mkRes(200, { races: Array(5).fill({ id: 'r' }) });
    return mkRes(404, 'Not Found');
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  // 全 30 日 5 races（< 8）→ どの日も hit しない → throw
  await assert.rejects(
    getLatestResultDate({ client, resolveToken: noopResolve }),
    (e) => e.message.includes('過去30日間に結果データが見つかりませんでした'),
  );
});
