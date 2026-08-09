/**
 * checkShared.contract.test.mjs — checkShared*.mjs の検出契約テスト
 *   node --test scripts/checkShared.contract.test.mjs
 *
 * 月ディレクトリ索引の導入で GET を減らしても、
 * 「何が見つかったと報告されるか」は一切変えないことを固定する。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSharedJraResults } from './checkSharedJraResults.mjs';
import { checkSharedJraPredictions } from './checkSharedJraPredictions.mjs';
import { checkSharedNankanResults } from './checkSharedNankanResults.mjs';
import { checkSharedNankanPredictions } from './checkSharedNankanPredictions.mjs';
import { createSharedClient, SHARED_FETCH_CODES } from './lib/sharedFetch.mjs';

const SECRET = 'ghp_MOCK_TOKEN_checkShared_contract_test';
const ENV_OK = { KEIBA_DATA_SHARED_TOKEN: SECRET };
const DATE = '2026-08-08';
const QUIET = { error: () => {} };

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
  const fn = async (url, init) => { calls.push({ url, init }); return responder(url); };
  fn.calls = calls;
  return fn;
}
const noSleep = async () => {};
function entries(names) {
  return names.map((n) => ({ name: n, path: `d/${n}`, sha: 's', size: 1, type: 'file' }));
}
/** ディレクトリ一覧 GET か（末尾が .json でない Contents API 呼び出し） */
function isListing(url) {
  return !/\.json\?ref=/.test(url);
}

// ----- JRA results -----

test('1. JRA results: 開催会場だけ GET し、レース数を正しく合算する', async () => {
  const fetchImpl = mkFetch((url) => {
    if (isListing(url)) return mkRes(200, entries([`${DATE}-CHU.json`, `${DATE}-NII.json`, `${DATE}-SAP.json`]));
    if (/-CHU\.json/.test(url)) return mkRes(200, { races: Array(12).fill({}) });
    if (/-NII\.json/.test(url)) return mkRes(200, { races: Array(12).fill({}) });
    if (/-SAP\.json/.test(url)) return mkRes(200, { races: Array(12).fill({}) });
    throw new Error(`予期しない GET: ${url}`);
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const r = await checkSharedJraResults({ argv: ['--date', DATE], env: ENV_OK, client, resolveToken: () => {}, logger: QUIET });
  assert.deepEqual(r.foundCodes, ['CHU', 'NII', 'SAP']);
  assert.equal(r.totalRaces, 36);
  // 一覧1 + 3会場 = 4（従来は 10 会場ぶん撃っていた）
  assert.equal(fetchImpl.calls.length, 4);
});

test('2. JRA results: 非開催日は一覧1回のみで 0R', async () => {
  const fetchImpl = mkFetch((url) => {
    if (isListing(url)) return mkRes(200, entries([]));
    throw new Error(`予期しない GET: ${url}`);
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const r = await checkSharedJraResults({ argv: ['--date', DATE], env: ENV_OK, client, resolveToken: () => {}, logger: QUIET });
  assert.deepEqual(r.foundCodes, []);
  assert.equal(r.totalRaces, 0);
  assert.equal(fetchImpl.calls.length, 1);
});

test('3. JRA results: 一時エラーは throw して partial を返さない', async () => {
  const fetchImpl = mkFetch(() => mkRes(429, 'slow down'));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  await assert.rejects(
    checkSharedJraResults({ argv: ['--date', DATE], env: ENV_OK, client, resolveToken: () => {}, logger: QUIET }),
    (e) => e.code === SHARED_FETCH_CODES.RATE_LIMITED,
  );
});

// ----- JRA predictions -----

test('4. JRA predictions: racebook / computer を種別ごとに正しく分ける', async () => {
  const fetchImpl = mkFetch((url) => {
    if (isListing(url) && /racebook/.test(url)) return mkRes(200, entries([`${DATE}-CHU.json`, `${DATE}-NII.json`]));
    if (isListing(url) && /computer/.test(url)) return mkRes(200, entries([`${DATE}-CHU.json`]));
    throw new Error(`予期しない GET: ${url}`);
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const r = await checkSharedJraPredictions({ argv: ['--date', DATE], env: ENV_OK, client, logger: QUIET });
  assert.deepEqual(r.racebookCodes, ['CHU', 'NII']);
  assert.deepEqual(r.computerCodes, ['CHU']);
  // 一覧2回のみ（従来は 10会場 × 2種別 = 20 GET）
  assert.equal(fetchImpl.calls.length, 2);
});

test('5. JRA predictions: 一覧が信用できない月は GET で確かめる（未検証で found にしない）', async () => {
  const many = Array.from({ length: 1000 }, (_, i) => `f${i}.json`);
  const fetchImpl = mkFetch((url) => {
    if (isListing(url)) return mkRes(200, entries(many));
    if (/racebook.*-CHU\.json/.test(url)) return mkRes(200, { races: [] });
    return mkRes(404, 'Not Found');
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const r = await checkSharedJraPredictions({ argv: ['--date', DATE], env: ENV_OK, client, logger: QUIET });
  assert.deepEqual(r.racebookCodes, ['CHU'], '一覧に filler が並んでいても実在するものだけ found');
  assert.deepEqual(r.computerCodes, []);
});

// ----- 南関 -----

test('6. 南関 results: 開催会場だけ GET する', async () => {
  const fetchImpl = mkFetch((url) => {
    if (isListing(url)) return mkRes(200, entries([`${DATE}-FUN.json`]));
    if (/-FUN\.json/.test(url)) return mkRes(200, { races: Array(12).fill({}) });
    throw new Error(`予期しない GET: ${url}`);
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const r = await checkSharedNankanResults({
    argv: ['--date', DATE, '--venues', 'OOI,FUN,KAW,URA'],
    env: ENV_OK, client, resolveToken: () => {}, logger: QUIET,
  });
  assert.deepEqual(r.foundCodes, ['FUN']);
  assert.equal(r.totalRaces, 12);
  assert.equal(fetchImpl.calls.length, 2);
});

test('7. 南関 predictions: 統合ファイルがあれば per-venue を見ない', async () => {
  const fetchImpl = mkFetch((url) => {
    if (isListing(url)) return mkRes(200, entries([`${DATE}.json`]));
    throw new Error(`予期しない GET: ${url}`);
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const r = await checkSharedNankanPredictions({
    argv: ['--date', DATE, '--venues', 'OOI,FUN,KAW,URA'],
    env: ENV_OK, client, logger: QUIET,
  });
  assert.equal(r.found, true);
  assert.deepEqual(r.foundCodes, []);
  assert.equal(fetchImpl.calls.length, 1);
});

test('8. 南関 predictions: 統合が無ければ per-venue へ落ちる', async () => {
  const fetchImpl = mkFetch((url) => {
    if (isListing(url)) return mkRes(200, entries([`${DATE}-OOI.json`, `${DATE}-KAW.json`]));
    throw new Error(`予期しない GET: ${url}`);
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const r = await checkSharedNankanPredictions({
    argv: ['--date', DATE, '--venues', 'OOI,FUN,KAW,URA'],
    env: ENV_OK, client, logger: QUIET,
  });
  assert.equal(r.found, true);
  assert.deepEqual(r.foundCodes, ['OOI', 'KAW']);
  assert.equal(fetchImpl.calls.length, 1);
});

test('9. 南関 predictions: 何も無ければ found=false（正常な空）', async () => {
  const fetchImpl = mkFetch((url) => {
    if (isListing(url)) return mkRes(200, entries([]));
    throw new Error(`予期しない GET: ${url}`);
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const r = await checkSharedNankanPredictions({
    argv: ['--date', DATE, '--venues', 'OOI,FUN,KAW,URA'],
    env: ENV_OK, client, logger: QUIET,
  });
  assert.equal(r.found, false);
  assert.deepEqual(r.foundCodes, []);
});

test('10. JRA: HAK は既定会場に含まれない（HKD が正準）', async () => {
  const fetchImpl = mkFetch((url) => (isListing(url) ? mkRes(200, entries([])) : mkRes(404, 'Not Found')));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const r = await checkSharedJraResults({ argv: ['--date', DATE], env: ENV_OK, client, resolveToken: () => {}, logger: QUIET });
  assert.deepEqual(r.foundCodes, []);
  assert.ok(!fetchImpl.calls.some((c) => /-HAK\.json/.test(c.url)));
});
