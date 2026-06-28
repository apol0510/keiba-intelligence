/**
 * checkSharedDailyFile.test.mjs — 認証付き 統合 daily ファイル確認 script の単体テスト
 * （node:test / 新規依存なし / 全 mock fetch・実 GitHub 通信なし）
 *   node --test scripts/checkSharedDailyFile.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSharedDailyFile } from './checkSharedDailyFile.mjs';
import { createSharedClient, SHARED_FETCH_CODES } from './lib/sharedFetch.mjs';

const SECRET = 'ghp_THIS_IS_A_TEST_SECRET_TOKEN_should_never_leak';
const ENV_OK = { KEIBA_DATA_SHARED_TOKEN: SECRET };
const ARGV = ['--date', '2026-05-08'];

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
  return checkSharedDailyFile({ argv: ARGV, env: ENV_OK, logger: silentLogger, ...overrides });
}

// 200 → 存在・会場数（race.venue ユニーク）・race数
test('1. 200 → FOUND=true / venue 数（ユニーク）/ race 数', async () => {
  const client = clientWith(() =>
    mkRes(200, {
      races: [
        { venue: '東京', raceNumber: 1 },
        { venue: '東京', raceNumber: 2 },
        { venue: '京都', raceNumber: 1 },
        { venue: '阪神', raceNumber: 1 },
      ],
    }),
  );
  const { found, expectedVenues, expectedRaces } = await run({ client });
  assert.equal(found, true);
  assert.equal(expectedVenues, 3); // 東京/京都/阪神
  assert.equal(expectedRaces, 4);
});

// 404 → 未投入（throw しない・found:false）
test('2. 404 → FOUND=false（未投入・throw しない / exit0 相当）', async () => {
  const client = clientWith(() => mkRes(404, 'Not Found'));
  const { found, expectedVenues, expectedRaces } = await run({ client });
  assert.equal(found, false);
  assert.equal(expectedVenues, 0);
  assert.equal(expectedRaces, 0);
});

// 401 → fatal
test('3. 401 は fatal（throw）', async () => {
  const client = clientWith(() => mkRes(401, 'Bad credentials'));
  await assert.rejects(run({ client }), (e) => e.code === SHARED_FETCH_CODES.AUTH_FAILED);
});

// 403（非rate）→ fatal
test('4. 403（非 rate）は fatal', async () => {
  const client = clientWith(() => mkRes(403, 'Forbidden', { 'x-ratelimit-remaining': '50' }));
  await assert.rejects(run({ client }), (e) => e.code === SHARED_FETCH_CODES.FORBIDDEN);
});

// rate limit（403 remaining:0）→ retry 後 fatal
test('5. rate limit(403 remaining:0) は retry 後 fatal', async () => {
  const fetchImpl = mkFetch(() => mkRes(403, 'rate limit', { 'x-ratelimit-remaining': '0' }));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep, retries: 2 });
  await assert.rejects(run({ client }), (e) => e.code === SHARED_FETCH_CODES.RATE_LIMITED);
  assert.equal(fetchImpl.calls.length, 3); // 初回 + retry 2
});

// 429 → retry 後 fatal
test('6. 429 は retry 後 fatal', async () => {
  const fetchImpl = mkFetch(() => mkRes(429, 'too many requests'));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep, retries: 2 });
  await assert.rejects(run({ client }), (e) => e.code === SHARED_FETCH_CODES.RATE_LIMITED);
});

// 500 → retry 後 fatal
test('7. 500 は retry 後 fatal', async () => {
  const client = clientWith(() => mkRes(500, 'err'));
  await assert.rejects(run({ client }), (e) => e.code === SHARED_FETCH_CODES.SERVER_ERROR);
});

// timeout → retry 後 fatal
test('8. timeout は retry 後 fatal', async () => {
  const fetchImpl = mkFetch(() => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep, retries: 2 });
  await assert.rejects(run({ client }), (e) => e.code === SHARED_FETCH_CODES.TIMEOUT);
});

// token 未設定 → 取得前に fatal（fetch を呼ばない）
test('9. token 未設定は取得前に TOKEN_MISSING（fetch 呼ばない）', async () => {
  const fetchImpl = mkFetch(() => mkRes(200, { races: [] }));
  const client = createSharedClient({ fetchImpl, env: {}, sleepImpl: noSleep });
  await assert.rejects(run({ env: {}, client }), (e) => e.code === SHARED_FETCH_CODES.TOKEN_MISSING);
  assert.equal(fetchImpl.calls.length, 0);
});

// token / Authorization / Bearer 非露出
test('10. token / Authorization / Bearer がログ・エラーへ漏れない', async () => {
  const logs = [];
  const logger = { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) };
  let thrown;
  const client = clientWith(() => mkRes(401, 'Bad credentials'));
  await run({ client, logger }).catch((e) => { thrown = e; });
  const hay = `${logs.join('\n')}\n${thrown?.message}\n${thrown?.stack}`;
  assert.ok(!hay.includes(SECRET));
  assert.ok(!/Bearer\s/i.test(hay));
  assert.ok(!/Authorization/i.test(hay));
});

// 既定は jra/results/YYYY/MM/YYYY-MM-DD.json を叩く（contract 経路）
test('11. 既定 path は jra/results の統合ファイル', async () => {
  const fetchImpl = mkFetch(() => mkRes(200, { races: [{ venue: '東京' }] }));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  await run({ client });
  const url = decodeURIComponent(fetchImpl.calls[0].url);
  assert.match(url, /\/contents\/jra\/results\/2026\/05\/2026-05-08\.json/);
});

// 予想存在確認（--kind predictions）でも FOUND を返す（verify-archive-sync 流用）
test('12. --kind predictions: 200 → FOUND=true（予想存在確認に流用）', async () => {
  const fetchImpl = mkFetch(() => mkRes(200, { ok: true }));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const { found } = await checkSharedDailyFile({
    argv: ['--date', '2026-05-08', '--category', 'nankan', '--kind', 'predictions'],
    env: ENV_OK, logger: silentLogger, client,
  });
  assert.equal(found, true);
  assert.match(decodeURIComponent(fetchImpl.calls[0].url), /\/contents\/nankan\/predictions\/2026\/05\/2026-05-08\.json/);
});

// 南関 results unified path / race数（per-venue ではなく unified daily を読む）
test('13. --category nankan --kind results: unified daily path & race数', async () => {
  const fetchImpl = mkFetch(() => mkRes(200, { races: [{ venue: '大井' }, { venue: '大井' }] }));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const { found, expectedRaces } = await checkSharedDailyFile({
    argv: ['--date', '2026-05-08', '--category', 'nankan', '--kind', 'results'],
    env: ENV_OK, logger: silentLogger, client,
  });
  assert.equal(found, true);
  assert.equal(expectedRaces, 2);
  assert.match(decodeURIComponent(fetchImpl.calls[0].url), /\/contents\/nankan\/results\/2026\/05\/2026-05-08\.json/);
});

// JRA results unified path
test('14. --category jra --kind results: unified daily path', async () => {
  const fetchImpl = mkFetch(() => mkRes(200, { races: [{ venue: '東京' }] }));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  await checkSharedDailyFile({ argv: ['--date', '2026-05-08', '--category', 'jra', '--kind', 'results'], env: ENV_OK, logger: silentLogger, client });
  assert.match(decodeURIComponent(fetchImpl.calls[0].url), /\/contents\/jra\/results\/2026\/05\/2026-05-08\.json/);
});

// JRA predictions unified path
test('15. --category jra --kind predictions: unified daily path', async () => {
  const fetchImpl = mkFetch(() => mkRes(200, { ok: true }));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  await checkSharedDailyFile({ argv: ['--date', '2026-05-08', '--category', 'jra', '--kind', 'predictions'], env: ENV_OK, logger: silentLogger, client });
  assert.match(decodeURIComponent(fetchImpl.calls[0].url), /\/contents\/jra\/predictions\/2026\/05\/2026-05-08\.json/);
});

// malformed JSON → fatal（INVALID_JSON、未投入扱いしない）
test('16. malformed JSON は fatal（INVALID_JSON）', async () => {
  const client = clientWith(() => mkRes(200, '{ not json'));
  await assert.rejects(run({ client }), (e) => e.code === SHARED_FETCH_CODES.INVALID_JSON);
});

// 不正 category → 取得前に reject（fetch しない）
test('17. 不正 category は拒否（fetch しない）', async () => {
  const fetchImpl = mkFetch(() => mkRes(200, { races: [] }));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  await assert.rejects(
    checkSharedDailyFile({ argv: ['--date', '2026-05-08', '--category', 'keirin', '--kind', 'results'], env: ENV_OK, logger: silentLogger, client }),
    /Invalid --category/,
  );
  assert.equal(fetchImpl.calls.length, 0);
});

// 不正 kind → 取得前に reject（fetch しない）
test('18. 不正 kind は拒否（fetch しない）', async () => {
  const fetchImpl = mkFetch(() => mkRes(200, { races: [] }));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  await assert.rejects(
    checkSharedDailyFile({ argv: ['--date', '2026-05-08', '--category', 'jra', '--kind', 'entries'], env: ENV_OK, logger: silentLogger, client }),
    /Invalid --kind/,
  );
  assert.equal(fetchImpl.calls.length, 0);
});
