/**
 * importRecentHorseHistoriesNankan.test.mjs — recentHorseHistories(nankan) importer 単体テスト
 * （node:test / 新規依存なし / 全 mock fetch・実 GitHub 通信なし）
 *   node --test scripts/importRecentHorseHistoriesNankan.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  importRecentHorseHistoriesNankan,
  validateRecentHorseHistoriesJson,
  buildSharedPath,
  buildLocalPath,
  countHorses,
} from './importRecentHorseHistoriesNankan.js';
import { createSharedClient, SHARED_FETCH_CODES } from './lib/sharedFetch.mjs';

const SECRET = 'ghp_THIS_IS_A_TEST_SECRET_TOKEN_should_never_leak';
const GITHUB_TOKEN_VALUE = 'ghs_self_repo_github_token_must_not_be_used';
const ENV_OK = { KEIBA_DATA_SHARED_TOKEN: SECRET };
const DATE = '2026-06-16';
const ARGV = ['--date', DATE, '--venues', 'OOI,KAW'];

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
  return importRecentHorseHistoriesNankan({
    argv: ARGV,
    env: ENV_OK,
    logger: silentLogger,
    writeFileFn: () => {},
    mkdirFn: () => {},
    ...overrides,
  });
}

/** 正常な recentHorseHistories JSON */
function makeRhhJson(venue, raceCount = 3, horsesPerRace = 8) {
  const venueNames = { OOI: '大井', KAW: '川崎', FUN: '船橋', URA: '浦和' };
  return {
    schemaVersion: 'nankan-recent-horse-histories-v1',
    category: 'nankan',
    date: DATE,
    venue,
    venueName: venueNames[venue] ?? venue,
    source: { base: 'auto', enrichment: 'none', generatedAt: '2026-06-16T00:00:00.000Z', generator: 'test' },
    races: Array.from({ length: raceCount }, (_, i) => ({
      raceNumber: i + 1,
      raceName: `第${i + 1}R`,
      horses: Array.from({ length: horsesPerRace }, (__, j) => ({
        horseNumber: j + 1,
        horseName: `テスト馬${j + 1}`,
        recentRaces: Array.from({ length: 5 }, (_, k) => ({
          raceDate: '2026-05-01',
          raceName: `過去R${k + 1}`,
          order: k + 1,
          passingOrder: '1-1',
          finishStatus: null,
          distance: 1600,
        })),
      })),
    })),
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

// 2. 全404 → savedCount=0 skippedCount=2 failedCount=0
test('2. 全会場 404 → savedCount=0 skippedCount=2 failedCount=0', async () => {
  const client = clientWith(() => mkRes(404, 'Not Found'));
  const r = await run({ client });
  assert.equal(r.savedCount, 0);
  assert.equal(r.skippedCount, 2);
  assert.equal(r.failedCount, 0);
});

// 3. OOI=200(valid) / KAW=404 → savedCount=1 skippedCount=1
test('3. OOI=200(valid) / KAW=404 → savedCount=1 skippedCount=1', async () => {
  const fetchImpl = mkFetch((url) => {
    const decoded = decodeURIComponent(url);
    if (decoded.includes('-OOI.json')) return mkRes(200, makeRhhJson('OOI'));
    return mkRes(404, 'Not Found');
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const r = await run({ client });
  assert.equal(r.savedCount, 1);
  assert.equal(r.skippedCount, 1);
  assert.equal(r.failedCount, 0);
});

// 4. 401 → AUTH_FAILED（failedCount に計上）
test('4. 401 → AUTH_FAILED（failedCount に計上）', async () => {
  const client = clientWith(() => mkRes(401, 'Bad credentials'));
  const r = await run({ client });
  assert.ok(r.failedCount > 0);
  assert.equal(r.savedCount, 0);
});

// 5. 403（非rate）→ FORBIDDEN（failedCount に計上）
test('5. 403（非rate）→ FORBIDDEN（failedCount に計上）', async () => {
  const client = clientWith(() => mkRes(403, 'Forbidden', { 'x-ratelimit-remaining': '50' }));
  const r = await run({ client });
  assert.ok(r.failedCount > 0);
});

// 6. rate-limit 403 → RATE_LIMITED（failedCount に計上）
test('6. rate-limit 403 → RATE_LIMITED（failedCount に計上）', async () => {
  const client = clientWith(() => mkRes(403, 'rate limit', { 'x-ratelimit-remaining': '0' }), { retries: 0 });
  const r = await run({ client });
  assert.ok(r.failedCount > 0);
});

// 7. 429 → RATE_LIMITED（failedCount に計上）
test('7. 429 → RATE_LIMITED（failedCount に計上）', async () => {
  const client = clientWith(() => mkRes(429, 'too many'), { retries: 0 });
  const r = await run({ client });
  assert.ok(r.failedCount > 0);
});

// 8. 500 → SERVER_ERROR（failedCount に計上）
test('8. 500 → SERVER_ERROR（failedCount に計上）', async () => {
  const client = clientWith(() => mkRes(500, 'err'), { retries: 0 });
  const r = await run({ client });
  assert.ok(r.failedCount > 0);
});

// 9. network error → INVALID_RESPONSE（failedCount に計上）
test('9. network error → INVALID_RESPONSE（failedCount に計上）', async () => {
  const fetchImpl = mkFetch(() => { throw new Error('ECONNREFUSED'); });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep, retries: 0 });
  const r = await run({ client });
  assert.ok(r.failedCount > 0);
});

// 10. timeout → TIMEOUT（failedCount に計上）
test('10. timeout → TIMEOUT（failedCount に計上）', async () => {
  const fetchImpl = mkFetch(() => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep, retries: 0 });
  const r = await run({ client });
  assert.ok(r.failedCount > 0);
});

// 11. malformed JSON → INVALID_JSON（failedCount に計上）
test('11. malformed JSON → INVALID_JSON（failedCount に計上）', async () => {
  const client = clientWith(() => mkRes(200, '{ not json'));
  const r = await run({ client });
  assert.ok(r.failedCount > 0);
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

// 14. 両token存在 → Authorization は KEIBA_DATA_SHARED_TOKEN 値を使用
test('14. KEIBA_DATA_SHARED_TOKEN+GITHUB_TOKEN 両存在時、Authorization は正式 token 値を使用', async () => {
  const envBoth = { KEIBA_DATA_SHARED_TOKEN: SECRET, GITHUB_TOKEN: GITHUB_TOKEN_VALUE };
  const fetchImpl = mkFetch((url, init) => {
    const auth = init?.headers?.Authorization ?? '';
    assert.ok(auth === `Bearer ${SECRET}`, `Authorization が正式 token を使っていない。got: ${auth}`);
    assert.ok(!auth.includes(GITHUB_TOKEN_VALUE), 'Authorization に GITHUB_TOKEN 値が使われている');
    return mkRes(404, 'Not Found');
  });
  const client = createSharedClient({ fetchImpl, env: { KEIBA_DATA_SHARED_TOKEN: SECRET }, sleepImpl: noSleep });
  await importRecentHorseHistoriesNankan({ argv: ARGV, env: envBoth, logger: silentLogger, client, writeFileFn: () => {}, mkdirFn: () => {} });
  assert.ok(fetchImpl.calls.length > 0, 'fetch が一度も呼ばれていない');
});

// 15. token / Authorization 非露出
test('15. token / Authorization / Bearer がログ・エラーへ漏れない', async () => {
  const logs = [];
  const logger = { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) };
  const client = clientWith(() => mkRes(401, 'Bad credentials'));
  await importRecentHorseHistoriesNankan({ argv: ARGV, env: ENV_OK, logger, client, writeFileFn: () => {}, mkdirFn: () => {} });
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
    importRecentHorseHistoriesNankan({ argv: [], env: ENV_OK, logger: silentLogger, client, writeFileFn: () => {}, mkdirFn: () => {} }),
    /Usage/,
  );
  assert.equal(fetchImpl.calls.length, 0);
});

// 17. 不正日付 → Usage エラー
test('17. 不正日付 → Usage エラー（fetch しない）', async () => {
  const fetchImpl = mkFetch(() => mkRes(200, {}));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  await assert.rejects(
    importRecentHorseHistoriesNankan({ argv: ['--date', 'not-a-date'], env: ENV_OK, logger: silentLogger, client, writeFileFn: () => {}, mkdirFn: () => {} }),
    /Usage/,
  );
  assert.equal(fetchImpl.calls.length, 0);
});

// 18. URL パスが nankan/recentHorseHistories/ を使用
test('18. URL パスが nankan/recentHorseHistories/... を使用する', async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(decodeURIComponent(url)); return mkRes(404, 'Not Found'); };
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  await run({ client });
  const rhhUrls = calls.filter((u) => u.includes('/contents/nankan/recentHorseHistories/'));
  assert.ok(rhhUrls.length > 0, 'nankan/recentHorseHistories/ への URL が呼ばれていない');
});

// 19. dry-run → writeFileFn が呼ばれない
test('19. --dry-run → writeFileFn 呼び出しなし', async () => {
  const fetchImpl = mkFetch((url) => {
    if (decodeURIComponent(url).includes('-OOI.json')) return mkRes(200, makeRhhJson('OOI'));
    return mkRes(404, 'Not Found');
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  let writeCalled = 0;
  await importRecentHorseHistoriesNankan({
    argv: ['--date', DATE, '--venues', 'OOI', '--dry-run'],
    env: ENV_OK, logger: silentLogger, client,
    writeFileFn: () => { writeCalled++; },
    mkdirFn: () => {},
  });
  assert.equal(writeCalled, 0, 'dry-run 時に writeFileFn が呼ばれてはいけない');
});

// 20. validateRecentHorseHistoriesJson: 正常データ
test('20. validateRecentHorseHistoriesJson: 正常データは true を返す', () => {
  const json = makeRhhJson('OOI', 3);
  const result = validateRecentHorseHistoriesJson(json, 'OOI', DATE);
  assert.equal(result, true);
});

// 21. validateRecentHorseHistoriesJson: category 不一致
test('21. validateRecentHorseHistoriesJson: category 不一致は throw', () => {
  const json = { ...makeRhhJson('OOI', 2), category: 'jra' };
  assert.throws(() => validateRecentHorseHistoriesJson(json, 'OOI', DATE), /unexpected category/);
});

// 22. validateRecentHorseHistoriesJson: schemaVersion 不一致
test('22. validateRecentHorseHistoriesJson: schemaVersion 不一致は throw', () => {
  const json = { ...makeRhhJson('OOI', 2), schemaVersion: 'wrong-schema' };
  assert.throws(() => validateRecentHorseHistoriesJson(json, 'OOI', DATE), /unexpected schemaVersion/);
});

// 23. validateRecentHorseHistoriesJson: venue 不一致
test('23. validateRecentHorseHistoriesJson: venue 不一致は throw', () => {
  const json = makeRhhJson('OOI', 2);
  assert.throws(() => validateRecentHorseHistoriesJson(json, 'KAW', DATE), /venue mismatch/);
});

// 24. recentRaces最大5走: データ不変確認
test('24. recentRaces は最大5走・保存内容を変更しない', async () => {
  const rhhJson = makeRhhJson('OOI', 1, 2);
  // horses[0].recentRaces = 5走
  assert.equal(rhhJson.races[0].horses[0].recentRaces.length, 5);

  let savedJson = null;
  const fetchImpl = mkFetch(() => mkRes(200, rhhJson));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  await importRecentHorseHistoriesNankan({
    argv: ['--date', DATE, '--venues', 'OOI'],
    env: ENV_OK, logger: silentLogger, client,
    writeFileFn: (_, content) => { savedJson = JSON.parse(content); },
    mkdirFn: () => {},
  });
  assert.ok(savedJson, 'writeFileFn が呼ばれなかった');
  assert.equal(savedJson.races[0].horses[0].recentRaces.length, 5, 'recentRaces 5走が維持されていない');
  assert.deepEqual(savedJson, rhhJson, '保存 JSON が元 JSON から変化している');
});

// 25. buildSharedPath
test('25. buildSharedPath は正しいパスを生成する', () => {
  const p = buildSharedPath('2026-06-16', 'OOI');
  assert.equal(p, 'nankan/recentHorseHistories/2026/06/2026-06-16-OOI.json');
});

// 26. countHorses
test('26. countHorses は全レースの馬数合計を返す', () => {
  const json = makeRhhJson('KAW', 2, 10);
  assert.equal(countHorses(json), 20);
});
