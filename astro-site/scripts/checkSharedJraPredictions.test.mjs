/**
 * checkSharedJraPredictions.test.mjs — JRA racebook / computer 予想確認 script の単体テスト
 * （node:test / 新規依存なし / 全 mock fetch・実 GitHub 通信なし）
 *   node --test scripts/checkSharedJraPredictions.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSharedJraPredictions } from './checkSharedJraPredictions.mjs';
import { createSharedClient, SHARED_FETCH_CODES } from './lib/sharedFetch.mjs';

const SECRET = 'ghp_THIS_IS_A_TEST_SECRET_TOKEN_should_never_leak';
const GITHUB_TOKEN_VALUE = 'ghs_self_repo_github_token_must_not_be_used';
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
  return checkSharedJraPredictions({ argv: ARGV, env: ENV_OK, logger: silentLogger, ...overrides });
}

// 1. 全会場 全種別 404 → 正常な空
test('1. 全会場・全種別 404 → racebookCodes=[] computerCodes=[]（exit 0 相当）', async () => {
  const client = clientWith(() => mkRes(404, 'Not Found'));
  const { racebookCodes, computerCodes } = await run({ client });
  assert.deepEqual(racebookCodes, []);
  assert.deepEqual(computerCodes, []);
});

// 2. racebook のみ存在
test('2. racebook のみ存在 → racebookCodes に含まれ computerCodes は空', async () => {
  const fetchImpl = mkFetch((url) => {
    const decoded = decodeURIComponent(url);
    if (decoded.includes('/racebook/') && decoded.includes('-TOK.json')) return mkRes(200, {});
    if (decoded.includes('/racebook/') && decoded.includes('-KYO.json')) return mkRes(404, 'Not Found');
    return mkRes(404, 'Not Found');
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const { racebookCodes, computerCodes } = await run({ client });
  assert.deepEqual(racebookCodes, ['TOK']);
  assert.deepEqual(computerCodes, []);
});

// 3. computer のみ存在
test('3. computer のみ存在 → computerCodes に含まれ racebookCodes は空', async () => {
  const fetchImpl = mkFetch((url) => {
    const decoded = decodeURIComponent(url);
    if (decoded.includes('/predictions/computer/') && decoded.includes('-TOK.json')) return mkRes(200, {});
    return mkRes(404, 'Not Found');
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const { racebookCodes, computerCodes } = await run({ client });
  assert.deepEqual(racebookCodes, []);
  assert.deepEqual(computerCodes, ['TOK']);
});

// 4. racebook + computer 両方存在
test('4. racebook + computer 両方存在 → 両方のコードリストに含まれる', async () => {
  const fetchImpl = mkFetch((url) => {
    const decoded = decodeURIComponent(url);
    if (decoded.includes('-TOK.json') || decoded.includes('-KYO.json')) return mkRes(200, {});
    return mkRes(404, 'Not Found');
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const { racebookCodes, computerCodes } = await run({ client });
  assert.deepEqual(racebookCodes, ['TOK', 'KYO']);
  assert.deepEqual(computerCodes, ['TOK', 'KYO']);
});

// 5. token 未設定 → TOKEN_MISSING fatal（HTTP 前・fetch 呼ばない）
test('5. KEIBA_DATA_SHARED_TOKEN 未設定 → TOKEN_MISSING（HTTP 前・fetch 呼出し 0）', async () => {
  const fetchImpl = mkFetch(() => mkRes(200, {}));
  const client = createSharedClient({ fetchImpl, env: {}, sleepImpl: noSleep });
  await assert.rejects(
    checkSharedJraPredictions({ argv: ARGV, env: {}, logger: silentLogger, client }),
    (e) => e.code === SHARED_FETCH_CODES.TOKEN_MISSING,
  );
  assert.equal(fetchImpl.calls.length, 0);
});

// 6. 401 → AUTH_FAILED fatal
test('6. 401 は AUTH_FAILED fatal', async () => {
  const client = clientWith(() => mkRes(401, 'Bad credentials'));
  await assert.rejects(run({ client }), (e) => e.code === SHARED_FETCH_CODES.AUTH_FAILED);
});

// 7. 403（非 rate）→ FORBIDDEN fatal
test('7. 403（非 rate）は FORBIDDEN fatal', async () => {
  const client = clientWith(() => mkRes(403, 'Forbidden', { 'x-ratelimit-remaining': '50' }));
  await assert.rejects(run({ client }), (e) => e.code === SHARED_FETCH_CODES.FORBIDDEN);
});

// 8. 429 → RATE_LIMITED fatal（retry 後）
test('8. 429 は retry 後 RATE_LIMITED fatal', async () => {
  const fetchImpl = mkFetch(() => mkRes(429, 'too many'));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep, retries: 2 });
  await assert.rejects(run({ client }), (e) => e.code === SHARED_FETCH_CODES.RATE_LIMITED);
});

// 9. 5xx → SERVER_ERROR fatal（retry 後）
test('9. 5xx は retry 後 SERVER_ERROR fatal', async () => {
  const client = clientWith(() => mkRes(500, 'err'));
  await assert.rejects(run({ client }), (e) => e.code === SHARED_FETCH_CODES.SERVER_ERROR);
});

// 10. timeout → TIMEOUT fatal（retry 後）
test('10. timeout は retry 後 TIMEOUT fatal', async () => {
  const fetchImpl = mkFetch(() => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep, retries: 2 });
  await assert.rejects(run({ client }), (e) => e.code === SHARED_FETCH_CODES.TIMEOUT);
});

// 11. network error → fatal
test('11. network error は fatal（INVALID_RESPONSE）', async () => {
  const fetchImpl = mkFetch(() => { throw new Error('ECONNREFUSED'); });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep, retries: 0 });
  await assert.rejects(run({ client }), (e) => e.code === SHARED_FETCH_CODES.INVALID_RESPONSE);
});

// 12. malformed JSON → INVALID_JSON fatal（未投入扱いしない）
test('12. malformed JSON は fatal（INVALID_JSON、未投入扱いしない）', async () => {
  const client = clientWith(() => mkRes(200, '{ not json'));
  await assert.rejects(run({ client }), (e) => e.code === SHARED_FETCH_CODES.INVALID_JSON);
});

// 13. 途中 fatal → partial result を返さない
test('13. 途中で 401 → partial result を返さず throw', async () => {
  const fetchImpl = mkFetch((url) => {
    const decoded = decodeURIComponent(url);
    if (decoded.includes('-TOK.json')) return mkRes(200, {});
    return mkRes(401, 'Bad credentials'); // KYO で 401
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  await assert.rejects(run({ client }), (e) => e.code === SHARED_FETCH_CODES.AUTH_FAILED);
});

// 14. token / Authorization 非露出
test('14. token / Authorization / Bearer がログ・エラーへ漏れない', async () => {
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

// 15. --date なし → Usage エラー（fetch しない）
test('15. --date なし → Usage エラー（fetch しない）', async () => {
  const fetchImpl = mkFetch(() => mkRes(200, {}));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  await assert.rejects(
    checkSharedJraPredictions({ argv: [], env: ENV_OK, logger: silentLogger, client }),
    /Usage/,
  );
  assert.equal(fetchImpl.calls.length, 0);
});

// 16. 全リクエストに Authorization ヘッダが付く（anonymous fetch なし）
test('16. 全リクエストに Authorization ヘッダが付く（anonymous fetch なし）', async () => {
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

// 17. GITHUB_TOKEN のみ → TOKEN_MISSING（HTTP 前・fetch 呼出し 0）
test('17. GITHUB_TOKEN のみ設定 → TOKEN_MISSING（HTTP 前 fail-fast・fetch 呼出し 0）', async () => {
  const envGithubOnly = { GITHUB_TOKEN: GITHUB_TOKEN_VALUE };
  const fetchImpl = mkFetch(() => mkRes(200, {}));
  const client = createSharedClient({ fetchImpl, env: envGithubOnly, sleepImpl: noSleep });
  await assert.rejects(
    checkSharedJraPredictions({ argv: ARGV, env: envGithubOnly, logger: silentLogger, client }),
    (e) => e.code === SHARED_FETCH_CODES.TOKEN_MISSING,
  );
  assert.equal(fetchImpl.calls.length, 0, 'GITHUB_TOKEN のみでは fetch が呼ばれてはいけない');
});

// 18. 両 env 存在時、Authorization は KEIBA_DATA_SHARED_TOKEN 値を使用（GITHUB_TOKEN 値は使わない）
test('18. KEIBA_DATA_SHARED_TOKEN+GITHUB_TOKEN 両存在時、Authorization は正式 token 値を使用', async () => {
  const envBoth = { KEIBA_DATA_SHARED_TOKEN: SECRET, GITHUB_TOKEN: GITHUB_TOKEN_VALUE };
  const fetchImpl = mkFetch((url, init) => {
    const auth = init?.headers?.Authorization ?? '';
    assert.ok(
      auth === `Bearer ${SECRET}`,
      `Authorization が正式 token を使っていない。got: ${auth}`,
    );
    assert.ok(
      !auth.includes(GITHUB_TOKEN_VALUE),
      'Authorization に GITHUB_TOKEN 値が使われている',
    );
    return mkRes(404, 'Not Found');
  });
  // client は KEIBA_DATA_SHARED_TOKEN のみを env として渡す（checker が内部でフィルタする設計）
  const client = createSharedClient({ fetchImpl, env: { KEIBA_DATA_SHARED_TOKEN: SECRET }, sleepImpl: noSleep });
  await checkSharedJraPredictions({ argv: ARGV, env: envBoth, logger: silentLogger, client });
  assert.ok(fetchImpl.calls.length > 0, 'fetch が一度も呼ばれていない');
});

// 19. URL パスが jra/racebook と jra/predictions/computer を使用する
test('19. URL パスが jra/racebook と jra/predictions/computer を使用する', async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(decodeURIComponent(url)); return mkRes(404, 'Not Found'); };
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  await run({ client });
  const racebookUrls = calls.filter((u) => u.includes('/contents/jra/racebook/'));
  const computerUrls = calls.filter((u) => u.includes('/contents/jra/predictions/computer/'));
  assert.ok(racebookUrls.length > 0, 'jra/racebook/ への URL が呼ばれていない');
  assert.ok(computerUrls.length > 0, 'jra/predictions/computer/ への URL が呼ばれていない');
});
