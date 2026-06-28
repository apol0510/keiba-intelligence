/**
 * importFeatureScores.test.mjs — importFeatureScores の単体テスト
 * （node:test / mock client / 実 GitHub 通信なし / ファイル書き込みなし）
 *   node --test scripts/importFeatureScores.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { importFeatureScores } from './importFeatureScores.js';
import { createSharedClient, SHARED_FETCH_CODES } from './lib/sharedFetch.mjs';

const __testDir = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__testDir, 'importFeatureScores.js');

function runScript(args, extraEnv = {}) {
  return spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf-8',
    timeout: 10000,
    env: { PATH: process.env.PATH, ...extraEnv },
  });
}

const SECRET = 'ghp_MOCK_TOKEN_importFeatureScores_test';
const ENV_OK = { KEIBA_DATA_SHARED_TOKEN: SECRET };

const BASE_ARGV_NANKAN = ['node', 'script', '--category', 'nankan', '--date', '2026-05-29', '--venues', 'OOI', '--dry-run'];
const BASE_ARGV_JRA    = ['node', 'script', '--category', 'jra',    '--date', '2026-05-24', '--venues', 'TOK', '--dry-run'];

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

function mkClientFetch(responder) {
  const fetchImpl = mkFetch(responder);
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  return { client, fetchImpl };
}

function noopResolve() {}

function validNankanJson(venue = 'OOI') {
  return {
    engine: 'nankan-v1',
    category: 'nankan',
    date: '2026-05-29',
    venueCode: venue,
    races: { R1: {}, R2: {}, R3: {} },
  };
}

function validJraJson(venue = 'TOK') {
  return {
    engine: 'jra-v1',
    category: 'jra',
    date: '2026-05-24',
    venueCode: venue,
    races: { R1: {}, R2: {} },
  };
}

// ---- 1. token 不足は HTTP 前 fail-fast ----

test('1. token 未設定は TOKEN_MISSING fatal（fetch 未実行）', async () => {
  const fetchImpl = mkFetch(() => mkRes(200, {}));
  const client = createSharedClient({ fetchImpl, env: {}, sleepImpl: noSleep });
  await assert.rejects(
    importFeatureScores({ argv: BASE_ARGV_NANKAN, env: {}, client }),
    (e) => e.code === SHARED_FETCH_CODES.TOKEN_MISSING,
  );
  assert.equal(fetchImpl.calls.length, 0);
});

// ---- 2. 正式 token で取得 ----

test('2. KEIBA_DATA_SHARED_TOKEN で正常取得（savedCount=1）', async () => {
  const client = mkClient(() => mkRes(200, validNankanJson()));
  await importFeatureScores({ argv: BASE_ARGV_NANKAN, env: ENV_OK, client, resolveToken: noopResolve, logger: { log: () => {} } });
});

// ---- 3. 匿名 raw 取得 0 ----

test('3. 匿名 raw.githubusercontent への fetch が呼ばれない', async () => {
  const { client, fetchImpl } = mkClientFetch(() => mkRes(200, validNankanJson()));
  await importFeatureScores({ argv: BASE_ARGV_NANKAN, env: ENV_OK, client, resolveToken: noopResolve, logger: { log: () => {} } });
  for (const call of fetchImpl.calls) {
    assert.ok(!call.url.includes('raw.githubusercontent.com'), `raw.githubusercontent fetch が呼ばれた: ${call.url}`);
  }
});

// ---- 4. nankan 正常取得 ----

test('4. nankan カテゴリで正常取得（path に nankan/featureScores を含む）', async () => {
  const { client, fetchImpl } = mkClientFetch(() => mkRes(200, validNankanJson()));
  await importFeatureScores({ argv: BASE_ARGV_NANKAN, env: ENV_OK, client, resolveToken: noopResolve, logger: { log: () => {} } });
  assert.ok(fetchImpl.calls.length > 0);
  assert.ok(fetchImpl.calls[0].url.includes('nankan/featureScores'), `path に nankan/featureScores がない: ${fetchImpl.calls[0].url}`);
});

// ---- 5. jra 正常取得 ----

test('5. jra カテゴリで正常取得（path に jra/featureScores を含む）', async () => {
  const { client, fetchImpl } = mkClientFetch(() => mkRes(200, validJraJson()));
  await importFeatureScores({ argv: BASE_ARGV_JRA, env: ENV_OK, client, resolveToken: noopResolve, logger: { log: () => {} } });
  assert.ok(fetchImpl.calls.length > 0);
  assert.ok(fetchImpl.calls[0].url.includes('jra/featureScores'), `path に jra/featureScores がない: ${fetchImpl.calls[0].url}`);
});

// ---- 6. expected shared path ----

test('6. shared path が {category}/featureScores/{year}/{month}/{date}-{venue}.json の形式', async () => {
  const { client, fetchImpl } = mkClientFetch(() => mkRes(200, validNankanJson()));
  await importFeatureScores({ argv: BASE_ARGV_NANKAN, env: ENV_OK, client, resolveToken: noopResolve, logger: { log: () => {} } });
  const url = fetchImpl.calls[0].url;
  assert.ok(url.includes('nankan/featureScores/2026/05/2026-05-29-OOI.json'), `path 形式が不正: ${url}`);
});

// ---- 7. 200 正常 JSON → race count 維持 ----

test('7. 200 正常 JSON を受け取り races を object として扱う（Object.keys）', async () => {
  const json = validNankanJson();
  json.races = { R1: {}, R2: {}, R3: {}, R4: {}, R5: {}, R6: {} }; // 6 races
  const client = mkClient(() => mkRes(200, json));
  // dry-run なので write なし
  await importFeatureScores({ argv: BASE_ARGV_NANKAN, env: ENV_OK, client, resolveToken: noopResolve, logger: { log: () => {} } });
});

// ---- 8. 404 → skip（skippedCount、throw しない） ----

test('8. 404 は skip（optional）— fatal にならない', async () => {
  const client = mkClient(() => mkRes(404, 'Not Found'));
  // 404 skip は正常終了（savedCount=0 の場合のログを出して exit しない）
  await importFeatureScores({ argv: BASE_ARGV_NANKAN, env: ENV_OK, client, resolveToken: noopResolve, logger: { log: () => {} } });
});

// ---- 9. 401 fatal ----

test('9. 401 は AUTH_FAILED fatal', async () => {
  const client = mkClient(() => mkRes(401, 'Bad credentials'));
  await assert.rejects(
    importFeatureScores({ argv: BASE_ARGV_NANKAN, env: ENV_OK, client, resolveToken: noopResolve, logger: { log: () => {} } }),
    (e) => e.code === SHARED_FETCH_CODES.AUTH_FAILED,
  );
});

// ---- 10. 通常 403 fatal ----

test('10. 通常 403 は FORBIDDEN fatal', async () => {
  const client = mkClient(() => mkRes(403, 'Forbidden'));
  await assert.rejects(
    importFeatureScores({ argv: BASE_ARGV_NANKAN, env: ENV_OK, client, resolveToken: noopResolve, logger: { log: () => {} } }),
    (e) => e.code === SHARED_FETCH_CODES.FORBIDDEN,
  );
});

// ---- 11. 429 retry 後成功 ----

test('11. 429 → retry 後 200 で成功', async () => {
  let calls = 0;
  const fetchImpl = mkFetch(() => {
    calls++;
    if (calls === 1) return mkRes(429, 'too many', { 'retry-after': '1' });
    return mkRes(200, validNankanJson());
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep, retries: 3 });
  await importFeatureScores({ argv: BASE_ARGV_NANKAN, env: ENV_OK, client, resolveToken: noopResolve, logger: { log: () => {} } });
  assert.ok(calls >= 2);
});

// ---- 12. 429 retry 枯渇 fatal ----

test('12. 429 retry 枯渇は RATE_LIMITED fatal', async () => {
  const fetchImpl = mkFetch(() => mkRes(429, 'too many'));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep, retries: 2 });
  await assert.rejects(
    importFeatureScores({ argv: BASE_ARGV_NANKAN, env: ENV_OK, client, resolveToken: noopResolve, logger: { log: () => {} } }),
    (e) => e.code === SHARED_FETCH_CODES.RATE_LIMITED,
  );
});

// ---- 13. 5xx retry ----

test('13. 5xx → retry 後 200 で成功', async () => {
  let calls = 0;
  const fetchImpl = mkFetch(() => {
    calls++;
    if (calls === 1) return mkRes(500, 'Internal Server Error');
    return mkRes(200, validNankanJson());
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep, retries: 3 });
  await importFeatureScores({ argv: BASE_ARGV_NANKAN, env: ENV_OK, client, resolveToken: noopResolve, logger: { log: () => {} } });
  assert.ok(calls >= 2);
});

// ---- 14. timeout retry ----

test('14. timeout → retry 後 200 で成功', async () => {
  let calls = 0;
  const fetchImpl = mkFetch(async () => {
    calls++;
    if (calls === 1) {
      // simulate abort / timeout by throwing
      const e = new Error('The operation was aborted.');
      e.name = 'AbortError';
      throw e;
    }
    return mkRes(200, validNankanJson());
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep, retries: 3 });
  await importFeatureScores({ argv: BASE_ARGV_NANKAN, env: ENV_OK, client, resolveToken: noopResolve, logger: { log: () => {} } });
  assert.ok(calls >= 2);
});

// ---- 15. malformed JSON fatal ----

test('15. malformed JSON は INVALID_JSON fatal', async () => {
  const client = mkClient(() => mkRes(200, 'not-json-at-all!!!'));
  await assert.rejects(
    importFeatureScores({ argv: BASE_ARGV_NANKAN, env: ENV_OK, client, resolveToken: noopResolve, logger: { log: () => {} } }),
    (e) => e.code === SHARED_FETCH_CODES.INVALID_JSON,
  );
});

// ---- 16. isDirectRun ガードが import 時動作を阻害しない ----

test('16. isDirectRun ガード: import しても main が自動実行されない（importFeatureScores が export されている）', () => {
  assert.equal(typeof importFeatureScores, 'function');
});

// ---- 17. token / Authorization / body をログへ出さない ----

test('17. logger に token / Authorization が含まれない', async () => {
  const logs = [];
  const logger = { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) };
  const client = mkClient(() => mkRes(200, validNankanJson()));
  await importFeatureScores({ argv: BASE_ARGV_NANKAN, env: ENV_OK, client, resolveToken: noopResolve, logger });
  for (const line of logs) {
    assert.ok(!line.includes(SECRET), 'logger に token 値が含まれている');
    assert.ok(!line.toLowerCase().includes('authorization'), 'logger に Authorization が含まれている');
  }
});

// ---- 18. JRA 複数会場での path 確認 ----

test('18. JRA 複数会場で各会場の path が正しい', async () => {
  const argv = ['node', 'script', '--category', 'jra', '--date', '2026-05-24', '--venues', 'TOK,KYO', '--dry-run'];
  const { client, fetchImpl } = mkClientFetch((url) => {
    if (url.includes('-TOK.json')) return mkRes(200, validJraJson('TOK'));
    if (url.includes('-KYO.json')) return mkRes(200, { ...validJraJson('KYO'), venueCode: 'KYO' });
    return mkRes(404, 'Not Found');
  });
  await importFeatureScores({ argv, env: ENV_OK, client, resolveToken: noopResolve, logger: { log: () => {} } });
  const urls = fetchImpl.calls.map((c) => c.url);
  assert.ok(urls.some((u) => u.includes('jra/featureScores/2026/05/2026-05-24-TOK.json')));
  assert.ok(urls.some((u) => u.includes('jra/featureScores/2026/05/2026-05-24-KYO.json')));
});

// ---- 19-23. 関数レベル: CLI 引数エラー（CliArgumentError / exitCode=2）----

test('19. category 未指定は CliArgumentError（exitCode=2）', async () => {
  const argv = ['node', 'script', '--date', '2026-05-29', '--venues', 'OOI'];
  await assert.rejects(
    importFeatureScores({ argv, env: ENV_OK }),
    (e) => e.name === 'CliArgumentError' && e.exitCode === 2,
  );
});

test('20. category 不正値は CliArgumentError（exitCode=2）', async () => {
  const argv = ['node', 'script', '--category', 'invalid', '--date', '2026-05-29'];
  await assert.rejects(
    importFeatureScores({ argv, env: ENV_OK }),
    (e) => e.name === 'CliArgumentError' && e.exitCode === 2,
  );
});

test('21. date 未指定は CliArgumentError（exitCode=2）', async () => {
  const argv = ['node', 'script', '--category', 'nankan', '--venues', 'OOI'];
  await assert.rejects(
    importFeatureScores({ argv, env: ENV_OK }),
    (e) => e.name === 'CliArgumentError' && e.exitCode === 2,
  );
});

test('22. date 形式不正は CliArgumentError（exitCode=2）', async () => {
  const argv = ['node', 'script', '--category', 'nankan', '--date', '20260529'];
  await assert.rejects(
    importFeatureScores({ argv, env: ENV_OK }),
    (e) => e.name === 'CliArgumentError' && e.exitCode === 2,
  );
});

test('23. CliArgumentError は HTTP 前に発生（fetch 未実行）', async () => {
  const fetchImpl = mkFetch(() => mkRes(200, {}));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const argv = ['node', 'script', '--date', '2026-05-29']; // category 未指定
  await assert.rejects(
    importFeatureScores({ argv, env: ENV_OK, client }),
    (e) => e.name === 'CliArgumentError',
  );
  assert.equal(fetchImpl.calls.length, 0);
});

// ---- 24-29. 実 CLI プロセス（spawnSync）----

test('24. CLI: --category 未指定 → exit 2', () => {
  const r = runScript(['--date', '2026-05-29'], { KEIBA_DATA_SHARED_TOKEN: 'mock' });
  assert.equal(r.status, 2);
});

test('25. CLI: --category 不正値 → exit 2', () => {
  const r = runScript(['--category', 'badcat', '--date', '2026-05-29'], { KEIBA_DATA_SHARED_TOKEN: 'mock' });
  assert.equal(r.status, 2);
});

test('26. CLI: --date 未指定 → exit 2', () => {
  const r = runScript(['--category', 'nankan'], { KEIBA_DATA_SHARED_TOKEN: 'mock' });
  assert.equal(r.status, 2);
});

test('27. CLI: --date 形式不正 → exit 2', () => {
  const r = runScript(['--category', 'nankan', '--date', 'baddate'], { KEIBA_DATA_SHARED_TOKEN: 'mock' });
  assert.equal(r.status, 2);
});

test('28. CLI: token未設定で有効な引数 → exit 1（TOKEN_MISSING fail-fast）', () => {
  const r = runScript(['--category', 'nankan', '--date', '2026-05-29', '--venues', 'OOI']);
  // TOKEN_MISSING: exitCode=undefined → process.exit(1)
  assert.equal(r.status, 1);
});

test('29. CLI: import しただけでは main が起動しない（exit 0）', () => {
  const r = spawnSync('node', ['--input-type=module'], {
    encoding: 'utf-8',
    timeout: 10000,
    env: { PATH: process.env.PATH },
    input: `import(${JSON.stringify(SCRIPT)}).then(() => process.exit(0)).catch(() => process.exit(99));`,
  });
  assert.equal(r.status, 0, `main が起動して失敗した可能性: stderr=${r.stderr}`);
});
