/**
 * importHorseStatsNankan.test.mjs — horseStats(nankan) importer 単体テスト
 * （node:test / 新規依存なし / 全 mock fetch・実 GitHub 通信なし）
 *   node --test scripts/importHorseStatsNankan.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  importHorseStatsNankan,
  validateHorseStatsJson,
  buildSharedPath,
  buildLocalPath,
} from './importHorseStatsNankan.js';
import { createSharedClient, SHARED_FETCH_CODES } from './lib/sharedFetch.mjs';

const SECRET = 'ghp_THIS_IS_A_TEST_SECRET_TOKEN_should_never_leak';
const GITHUB_TOKEN_VALUE = 'ghs_self_repo_github_token_must_not_be_used';
const ENV_OK = { KEIBA_DATA_SHARED_TOKEN: SECRET };
const DATE = '2026-06-16';
const ARGV_KAW = ['--date', DATE, '--venues', 'KAW', '--expected-races=2'];
const ARGV_OOI = ['--date', DATE, '--venues', 'OOI', '--expected-races=1'];

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

function clientWith(responder, opts = {}) {
  const fetchImpl = mkFetch(responder);
  const c = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep, retries: opts.retries ?? 2 });
  c._fetchImpl = fetchImpl;
  return c;
}
function run(overrides = {}) {
  return importHorseStatsNankan({
    argv: ARGV_KAW,
    env: ENV_OK,
    logger: silentLogger,
    writeFileFn: () => {},
    mkdirFn: () => {},
    ...overrides,
  });
}

/** 正常な horseStats JSON */
function makeHorseStatsJson(venue, raceNo, horseCount = 8) {
  const venueNames = { KAW: '川崎', OOI: '大井', FUN: '船橋', URA: '浦和' };
  return {
    dataType: 'horseStats',
    date: DATE,
    venueCode: venue,
    venue: venueNames[venue] ?? venue,
    raceNo,
    raceNumber: raceNo,
    totalHorses: horseCount,
    horses: Array.from({ length: horseCount }, (_, i) => ({ horseNumber: i + 1, horseStatsNankan: {} })),
  };
}

// 1. TOKEN未設定 → TOKEN_MISSING fatal（HTTP前・fetch 0）
test('1. KEIBA_DATA_SHARED_TOKEN 未設定 → TOKEN_MISSING（HTTP前・fetch 呼出し 0）', async () => {
  const fetchImpl = mkFetch(() => mkRes(200, {}));
  const client = createSharedClient({ fetchImpl, env: {}, sleepImpl: noSleep });
  await assert.rejects(
    run({ env: {}, client }),
    (e) => e.code === SHARED_FETCH_CODES.TOKEN_MISSING,
  );
  assert.equal(fetchImpl.calls.length, 0);
});

// 2. 全R 404 → filesFound=0（skip のみ・エラーなし）
test('2. 全ファイル 404 → filesFound=0 errors=0 notFound=2', async () => {
  const client = clientWith(() => mkRes(404, 'Not Found'));
  const r = await run({ client });
  assert.equal(r.filesFound, 0);
  assert.equal(r.errors, 0);
  assert.equal(r.notFound, 2); // KAW R01 + R02
});

// 3. R01 200 / R02 404 → filesFound=1
test('3. R01=200 / R02=404 → filesFound=1 notFound=1', async () => {
  const fetchImpl = mkFetch((url) => {
    const decoded = decodeURIComponent(url);
    if (decoded.includes('-KAW-R01.json')) return mkRes(200, makeHorseStatsJson('KAW', 1));
    return mkRes(404, 'Not Found');
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const r = await run({ client });
  assert.equal(r.filesFound, 1);
  assert.equal(r.notFound, 1);
  assert.equal(r.errors, 0);
});

// 4. 401 → AUTH_FAILED fatal（errors++）
test('4. 401 → AUTH_FAILED（errors に計上）', async () => {
  const client = clientWith(() => mkRes(401, 'Bad credentials'));
  const r = await run({ client });
  assert.ok(r.errors > 0);
  assert.equal(r.filesFound, 0);
});

// 5. 403（非rate）→ FORBIDDEN（errors に計上）
test('5. 403（非rate）→ FORBIDDEN（errors に計上）', async () => {
  const client = clientWith(() => mkRes(403, 'Forbidden', { 'x-ratelimit-remaining': '50' }));
  const r = await run({ client });
  assert.ok(r.errors > 0);
});

// 6. rate-limit 403 → RATE_LIMITED（errors に計上）
test('6. rate-limit 403 → RATE_LIMITED（errors に計上）', async () => {
  const client = clientWith(() => mkRes(403, 'rate limit', { 'x-ratelimit-remaining': '0' }), { retries: 0 });
  const r = await run({ client });
  assert.ok(r.errors > 0);
});

// 7. 429 → RATE_LIMITED（retry後・errors に計上）
test('7. 429 → RATE_LIMITED（errors に計上）', async () => {
  const client = clientWith(() => mkRes(429, 'too many'), { retries: 0 });
  const r = await run({ client });
  assert.ok(r.errors > 0);
});

// 8. 500 → SERVER_ERROR（retry後・errors に計上）
test('8. 500 → SERVER_ERROR（errors に計上）', async () => {
  const client = clientWith(() => mkRes(500, 'err'), { retries: 0 });
  const r = await run({ client });
  assert.ok(r.errors > 0);
});

// 9. network error → INVALID_RESPONSE（errors に計上）
test('9. network error → INVALID_RESPONSE（errors に計上）', async () => {
  const fetchImpl = mkFetch(() => { throw new Error('ECONNREFUSED'); });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep, retries: 0 });
  const r = await run({ client });
  assert.ok(r.errors > 0);
});

// 10. timeout → TIMEOUT（errors に計上）
test('10. timeout → TIMEOUT（errors に計上）', async () => {
  const fetchImpl = mkFetch(() => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep, retries: 0 });
  const r = await run({ client });
  assert.ok(r.errors > 0);
});

// 11. malformed JSON → INVALID_JSON（errors に計上）
test('11. malformed JSON → INVALID_JSON（errors に計上）', async () => {
  const client = clientWith(() => mkRes(200, '{ not json'));
  const r = await run({ client });
  assert.ok(r.errors > 0);
});

// 12. 全リクエストに Authorization ヘッダが付く（anonymous fetch なし）
test('12. 全リクエストに Authorization ヘッダが付く（anonymous fetch なし）', async () => {
  const fetchImpl = mkFetch((url, init) => {
    assert.ok(
      init?.headers?.Authorization?.startsWith('Bearer '),
      `Authorization ヘッダが付いていない: ${url}`,
    );
    return mkRes(404, 'Not Found');
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  await run({ client });
  assert.ok(fetchImpl.calls.length > 0, 'fetch が一度も呼ばれていない');
});

// 13. GITHUB_TOKENのみ → TOKEN_MISSING（HTTP前・fetch 0）
test('13. GITHUB_TOKEN のみ設定 → TOKEN_MISSING（HTTP前 fail-fast・fetch 呼出し 0）', async () => {
  const envGithubOnly = { GITHUB_TOKEN: GITHUB_TOKEN_VALUE };
  const fetchImpl = mkFetch(() => mkRes(200, {}));
  const client = createSharedClient({ fetchImpl, env: envGithubOnly, sleepImpl: noSleep });
  await assert.rejects(
    run({ env: envGithubOnly, client }),
    (e) => e.code === SHARED_FETCH_CODES.TOKEN_MISSING,
  );
  assert.equal(fetchImpl.calls.length, 0, 'GITHUB_TOKEN のみでは fetch が呼ばれてはいけない');
});

// 14. 両token存在 → Authorization は KEIBA_DATA_SHARED_TOKEN 値を使用（GITHUB_TOKEN 値は使わない）
test('14. KEIBA_DATA_SHARED_TOKEN+GITHUB_TOKEN 両存在時、Authorization は正式 token 値を使用', async () => {
  const envBoth = { KEIBA_DATA_SHARED_TOKEN: SECRET, GITHUB_TOKEN: GITHUB_TOKEN_VALUE };
  const fetchImpl = mkFetch((url, init) => {
    const auth = init?.headers?.Authorization ?? '';
    assert.ok(auth === `Bearer ${SECRET}`, `Authorization が正式 token を使っていない。got: ${auth}`);
    assert.ok(!auth.includes(GITHUB_TOKEN_VALUE), 'Authorization に GITHUB_TOKEN 値が使われている');
    return mkRes(404, 'Not Found');
  });
  const client = createSharedClient({ fetchImpl, env: { KEIBA_DATA_SHARED_TOKEN: SECRET }, sleepImpl: noSleep });
  await importHorseStatsNankan({ argv: ARGV_KAW, env: envBoth, logger: silentLogger, client, writeFileFn: () => {}, mkdirFn: () => {} });
  assert.ok(fetchImpl.calls.length > 0, 'fetch が一度も呼ばれていない');
});

// 15. token / Authorization 非露出
test('15. token / Authorization / Bearer がログ・エラーへ漏れない', async () => {
  const logs = [];
  const logger = { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) };
  const client = clientWith(() => mkRes(401, 'Bad credentials'));
  const r = await importHorseStatsNankan({ argv: ARGV_KAW, env: ENV_OK, logger, client, writeFileFn: () => {}, mkdirFn: () => {} });
  const hay = logs.join('\n');
  assert.ok(!hay.includes(SECRET));
  assert.ok(!/Bearer\s/i.test(hay));
  assert.ok(!/Authorization/i.test(hay));
});

// 16. --date なし → Usage エラー（fetch しない）
test('16. --date なし → Usage エラー（fetch しない）', async () => {
  const fetchImpl = mkFetch(() => mkRes(200, {}));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  await assert.rejects(
    importHorseStatsNankan({ argv: [], env: ENV_OK, logger: silentLogger, client, writeFileFn: () => {}, mkdirFn: () => {} }),
    /Usage/,
  );
  assert.equal(fetchImpl.calls.length, 0);
});

// 17. URL パスが nankan/horseStats/ を使用
test('17. URL パスが nankan/horseStats/... を使用する', async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(decodeURIComponent(url)); return mkRes(404, 'Not Found'); };
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  await run({ client });
  const horseStatsUrls = calls.filter((u) => u.includes('/contents/nankan/horseStats/'));
  assert.ok(horseStatsUrls.length > 0, 'nankan/horseStats/ への URL が呼ばれていない');
});

// 18. dry-run → writeFileFn が呼ばれない
test('18. --dry-run → writeFileFn 呼び出しなし', async () => {
  const fetchImpl = mkFetch((url) => {
    if (decodeURIComponent(url).includes('-KAW-R01.json')) return mkRes(200, makeHorseStatsJson('KAW', 1));
    return mkRes(404, 'Not Found');
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  let writeCalled = 0;
  await importHorseStatsNankan({
    argv: ['--date', DATE, '--venues', 'KAW', '--expected-races=1', '--dry-run'],
    env: ENV_OK, logger: silentLogger, client,
    writeFileFn: () => { writeCalled++; },
    mkdirFn: () => {},
  });
  assert.equal(writeCalled, 0, 'dry-run 時に writeFileFn が呼ばれてはいけない');
});

// 19. validateHorseStatsJson: 正常データ
test('19. validateHorseStatsJson: 正常データは horses 数を返す', () => {
  const json = makeHorseStatsJson('KAW', 3, 10);
  const result = validateHorseStatsJson(json, 'KAW', DATE, 3);
  assert.equal(result, 10);
});

// 20. validateHorseStatsJson: dataType 不一致
test('20. validateHorseStatsJson: dataType 不一致は throw', () => {
  const json = { ...makeHorseStatsJson('KAW', 1), dataType: 'wrong' };
  assert.throws(() => validateHorseStatsJson(json, 'KAW', DATE, 1), /dataType mismatch/);
});

// 21. validateHorseStatsJson: raceNo 不一致
test('21. validateHorseStatsJson: raceNo 不一致は throw', () => {
  const json = makeHorseStatsJson('KAW', 2);
  assert.throws(() => validateHorseStatsJson(json, 'KAW', DATE, 1), /raceNo mismatch/);
});

// 22. buildSharedPath
test('22. buildSharedPath は正しいパスを生成する', () => {
  const p = buildSharedPath('2026-06-16', 'KAW', 3);
  assert.equal(p, 'nankan/horseStats/2026/06/2026-06-16-KAW-R03.json');
});
