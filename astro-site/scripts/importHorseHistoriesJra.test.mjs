/**
 * importHorseHistoriesJra.test.mjs — PR-KI-4c 専用テスト
 *
 * node --test scripts/importHorseHistoriesJra.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSharedClient, SharedFetchError, SHARED_FETCH_CODES } from './lib/sharedFetch.mjs';
import {
  importHorseHistoriesJra,
  buildSharedPath,
  buildLocalPath,
  resolveVenues,
  validateHorseHistoriesJson,
  ALL_JRA_VENUES,
} from './importHorseHistoriesJra.js';

// ── ヘルパー ──────────────────────────────────────────────────

const DATE = '2026-05-24';
const VENUE = 'TOK';

function makeValidJson(overrides = {}) {
  return {
    source: 'jra-official',
    date: DATE,
    venueCode: VENUE,
    horses: { horse_1: { name: 'テストホース', recentRaces: [] } },
    ...overrides,
  };
}

/** 指定ステータスを返す mock fetch。res.headers.get は常に null。 */
function mockFetchStatus(status, bodyStr = '') {
  return () =>
    Promise.resolve({
      status,
      ok: status >= 200 && status < 300,
      headers: { get: () => null },
      text: () => Promise.resolve(bodyStr),
    });
}

/** 各呼び出しを捕捉する mock fetch。Authorization ヘッダー確認に使用。 */
function captureHeadersFetch(status = 200, bodyStr = '') {
  const calls = [];
  const fn = (url, opts) => {
    calls.push({ url, headers: opts?.headers });
    return Promise.resolve({
      status,
      ok: status >= 200 && status < 300,
      headers: { get: () => null },
      text: () => Promise.resolve(bodyStr),
    });
  };
  return { fn, calls };
}

/** logger を捕捉して返す。 */
function makeLogger() {
  const lines = [];
  return {
    logger: { log: (...a) => lines.push(a.join(' ')), error: (...a) => lines.push(a.join(' ')) },
    lines,
  };
}

/** 書き込みを捕捉する DI ヘルパー。 */
function makeWriteSpy() {
  const writes = [];
  return {
    writeFileFn: (path, content) => writes.push({ path, content }),
    mkdirFn: () => {},
    writes,
  };
}

/** env={KEIBA_DATA_SHARED_TOKEN:'test-token'} + 指定 fetchImpl で client を作成する。 */
function clientWith(fetchImpl) {
  return createSharedClient({
    fetchImpl,
    env: { KEIBA_DATA_SHARED_TOKEN: 'test-token' },
    retries: 0,
    timeoutMs: 5000,
  });
}

// ── TOKEN 契約 ────────────────────────────────────────────────

test('1. KEIBA_DATA_SHARED_TOKEN 未設定 → TOKEN_MISSING を throw（fetch 呼出し 0）', async () => {
  await assert.rejects(
    () => importHorseHistoriesJra({ argv: ['--date', DATE], env: {} }),
    (e) => {
      assert.ok(e instanceof SharedFetchError, 'SharedFetchError でない');
      assert.strictEqual(e.code, SHARED_FETCH_CODES.TOKEN_MISSING, 'code が TOKEN_MISSING でない');
      return true;
    },
  );
});

test('2. GITHUB_TOKEN のみ設定 → TOKEN_MISSING（fetch 呼出し 0）', async () => {
  await assert.rejects(
    () =>
      importHorseHistoriesJra({
        argv: ['--date', DATE],
        env: { GITHUB_TOKEN: 'ghs_dummy' },
      }),
    (e) => {
      assert.ok(e instanceof SharedFetchError);
      assert.strictEqual(e.code, SHARED_FETCH_CODES.TOKEN_MISSING);
      return true;
    },
  );
});

test('3. GITHUB_TOKEN_KEIBA_DATA_SHARED のみ設定 → TOKEN_MISSING', async () => {
  await assert.rejects(
    () =>
      importHorseHistoriesJra({
        argv: ['--date', DATE],
        env: { GITHUB_TOKEN_KEIBA_DATA_SHARED: 'ghp_dummy' },
      }),
    (e) => {
      assert.strictEqual(e.code, SHARED_FETCH_CODES.TOKEN_MISSING);
      return true;
    },
  );
});

test('4. 両 token 設定 → KEIBA_DATA_SHARED_TOKEN のみを Authorization に使用', async () => {
  const { fn, calls } = captureHeadersFetch(200, JSON.stringify(makeValidJson()));
  const client = createSharedClient({
    fetchImpl: fn,
    env: { KEIBA_DATA_SHARED_TOKEN: 'real-token', GITHUB_TOKEN: 'ghs_must_not_use' },
    retries: 0,
  });
  const { writes } = makeWriteSpy();
  await importHorseHistoriesJra({
    argv: ['--date', DATE, '--venues', VENUE],
    env: { KEIBA_DATA_SHARED_TOKEN: 'real-token', GITHUB_TOKEN: 'ghs_must_not_use' },
    client,
    writeFileFn: writes.push.bind(writes),
    mkdirFn: () => {},
  });
  assert.ok(calls.length > 0, 'fetch が呼ばれなかった');
  for (const call of calls) {
    const auth = call.headers?.Authorization ?? '';
    assert.ok(auth.includes('real-token'), `Authorization に real-token がない: ${auth}`);
    assert.ok(!auth.includes('ghs_must_not_use'), `GITHUB_TOKEN が Authorization に混入: ${auth}`);
  }
});

test('5. TOKEN_MISSING の場合 fetch 呼出しは 0 回', async () => {
  let fetchCount = 0;
  const mockFetch = () => { fetchCount++; return Promise.resolve({ status: 200, ok: true, headers: { get: () => null }, text: () => Promise.resolve('{}') }); };
  try {
    await importHorseHistoriesJra({ argv: ['--date', DATE], env: {}, client: createSharedClient({ fetchImpl: mockFetch, env: { KEIBA_DATA_SHARED_TOKEN: 'dummy' }, retries: 0 }) });
  } catch { /* expected */ }
  // TOKEN_MISSING は requireCrossRepoToken から来るため、env={} → client の前に throw される
  // DI client を渡していても env={} で requireCrossRepoToken が先に throw する
  const { writes } = makeWriteSpy();
  try {
    await importHorseHistoriesJra({ argv: ['--date', DATE], env: {} });
  } catch { /* expected */ }
  assert.strictEqual(fetchCount, 0, `fetch が ${fetchCount} 回呼ばれた（期待値 0）`);
});

// ── HTTP ステータス ───────────────────────────────────────────

test('6. 200 → saved、exit 0', async () => {
  const { writes, writeFileFn, mkdirFn } = makeWriteSpy();
  const code = await importHorseHistoriesJra({
    argv: ['--date', DATE, '--venues', VENUE],
    env: { KEIBA_DATA_SHARED_TOKEN: 'tok' },
    client: clientWith(mockFetchStatus(200, JSON.stringify(makeValidJson()))),
    writeFileFn,
    mkdirFn,
  });
  assert.strictEqual(code, 0, `exit code が ${code}（期待値 0）`);
  assert.strictEqual(writes.length, 1, `writes 数が ${writes.length}（期待値 1）`);
});

test('7. 404 → skip、exit 5（all skipped）', async () => {
  const code = await importHorseHistoriesJra({
    argv: ['--date', DATE, '--venues', VENUE],
    env: { KEIBA_DATA_SHARED_TOKEN: 'tok' },
    client: clientWith(mockFetchStatus(404)),
    writeFileFn: () => {},
    mkdirFn: () => {},
  });
  assert.strictEqual(code, 5, `exit code が ${code}（期待値 5）`);
});

test('8. partial missing（一部 404、一部 200）→ exit 0、saved=1 skip=1', async () => {
  let callIdx = 0;
  const responses = [
    () => Promise.resolve({ status: 200, ok: true, headers: { get: () => null }, text: () => Promise.resolve(JSON.stringify(makeValidJson({ venueCode: 'TOK' }))) }),
    () => Promise.resolve({ status: 404, ok: false, headers: { get: () => null }, text: () => Promise.resolve('Not Found') }),
  ];
  const { writes, writeFileFn, mkdirFn } = makeWriteSpy();
  const { logger, lines } = makeLogger();
  const code = await importHorseHistoriesJra({
    argv: ['--date', DATE, '--venues', 'TOK,NAK'],
    env: { KEIBA_DATA_SHARED_TOKEN: 'tok' },
    client: createSharedClient({ fetchImpl: () => responses[callIdx++](), env: { KEIBA_DATA_SHARED_TOKEN: 'tok' }, retries: 0 }),
    logger,
    writeFileFn,
    mkdirFn,
  });
  assert.strictEqual(code, 0, `exit code が ${code}（期待値 0）`);
  assert.strictEqual(writes.length, 1, `writes=${writes.length}（期待値 1）`);
  const skipLine = lines.find((l) => l.includes('skip'));
  assert.ok(skipLine, 'skip ログがない');
});

test('9. 401 → failedCount++、exit 4', async () => {
  const code = await importHorseHistoriesJra({
    argv: ['--date', DATE, '--venues', VENUE],
    env: { KEIBA_DATA_SHARED_TOKEN: 'tok' },
    client: clientWith(mockFetchStatus(401)),
    writeFileFn: () => {},
    mkdirFn: () => {},
  });
  assert.strictEqual(code, 4);
});

test('10. 403 forbidden → exit 4', async () => {
  const code = await importHorseHistoriesJra({
    argv: ['--date', DATE, '--venues', VENUE],
    env: { KEIBA_DATA_SHARED_TOKEN: 'tok' },
    client: clientWith(mockFetchStatus(403, 'Forbidden')),
    writeFileFn: () => {},
    mkdirFn: () => {},
  });
  assert.strictEqual(code, 4);
});

test('11. rate-limit 403（retry-after ヘッダー）→ exit 4', async () => {
  const rateLimitFetch = () =>
    Promise.resolve({
      status: 403,
      ok: false,
      headers: { get: (h) => (h === 'retry-after' ? '60' : null) },
      text: () => Promise.resolve('rate limited'),
    });
  const code = await importHorseHistoriesJra({
    argv: ['--date', DATE, '--venues', VENUE],
    env: { KEIBA_DATA_SHARED_TOKEN: 'tok' },
    client: createSharedClient({ fetchImpl: rateLimitFetch, env: { KEIBA_DATA_SHARED_TOKEN: 'tok' }, retries: 0 }),
    writeFileFn: () => {},
    mkdirFn: () => {},
  });
  assert.strictEqual(code, 4);
});

test('12. 429 → exit 4', async () => {
  const code = await importHorseHistoriesJra({
    argv: ['--date', DATE, '--venues', VENUE],
    env: { KEIBA_DATA_SHARED_TOKEN: 'tok' },
    client: clientWith(mockFetchStatus(429)),
    writeFileFn: () => {},
    mkdirFn: () => {},
  });
  assert.strictEqual(code, 4);
});

test('13. 500 → exit 4', async () => {
  const code = await importHorseHistoriesJra({
    argv: ['--date', DATE, '--venues', VENUE],
    env: { KEIBA_DATA_SHARED_TOKEN: 'tok' },
    client: clientWith(mockFetchStatus(500, 'Internal Server Error')),
    writeFileFn: () => {},
    mkdirFn: () => {},
  });
  assert.strictEqual(code, 4);
});

test('14. network error → exit 4', async () => {
  const netErrFetch = () => Promise.reject(new Error('ECONNREFUSED'));
  const code = await importHorseHistoriesJra({
    argv: ['--date', DATE, '--venues', VENUE],
    env: { KEIBA_DATA_SHARED_TOKEN: 'tok' },
    client: createSharedClient({ fetchImpl: netErrFetch, env: { KEIBA_DATA_SHARED_TOKEN: 'tok' }, retries: 0 }),
    writeFileFn: () => {},
    mkdirFn: () => {},
  });
  assert.strictEqual(code, 4);
});

test('15. timeout (AbortError) → exit 4', async () => {
  const timeoutFetch = () => {
    const err = new Error('The user aborted a request.');
    err.name = 'AbortError';
    return Promise.reject(err);
  };
  const code = await importHorseHistoriesJra({
    argv: ['--date', DATE, '--venues', VENUE],
    env: { KEIBA_DATA_SHARED_TOKEN: 'tok' },
    client: createSharedClient({ fetchImpl: timeoutFetch, env: { KEIBA_DATA_SHARED_TOKEN: 'tok' }, retries: 0 }),
    writeFileFn: () => {},
    mkdirFn: () => {},
  });
  assert.strictEqual(code, 4);
});

test('16. malformed JSON → exit 4', async () => {
  const code = await importHorseHistoriesJra({
    argv: ['--date', DATE, '--venues', VENUE],
    env: { KEIBA_DATA_SHARED_TOKEN: 'tok' },
    client: clientWith(mockFetchStatus(200, 'NOT_JSON{{')),
    writeFileFn: () => {},
    mkdirFn: () => {},
  });
  assert.strictEqual(code, 4);
});

// ── セキュリティ ──────────────────────────────────────────────

test('17. token 値がログに出力されない', async () => {
  const { logger, lines } = makeLogger();
  const SECRET = 'ghp_super_secret_token_xyz_123';
  await importHorseHistoriesJra({
    argv: ['--date', DATE, '--venues', VENUE],
    env: { KEIBA_DATA_SHARED_TOKEN: SECRET },
    client: clientWith(mockFetchStatus(200, JSON.stringify(makeValidJson()))),
    logger,
    writeFileFn: () => {},
    mkdirFn: () => {},
  });
  for (const line of lines) {
    assert.ok(!line.includes(SECRET), `token 値がログに含まれている: ${line}`);
  }
});

test('18. Authorization ヘッダー文字列がログに出力されない', async () => {
  const { logger, lines } = makeLogger();
  await importHorseHistoriesJra({
    argv: ['--date', DATE, '--venues', VENUE],
    env: { KEIBA_DATA_SHARED_TOKEN: 'secret' },
    client: clientWith(mockFetchStatus(200, JSON.stringify(makeValidJson()))),
    logger,
    writeFileFn: () => {},
    mkdirFn: () => {},
  });
  for (const line of lines) {
    assert.ok(!/Authorization/i.test(line), `Authorization がログに含まれている: ${line}`);
    assert.ok(!/Bearer/i.test(line), `Bearer がログに含まれている: ${line}`);
  }
});

test('19. raw.githubusercontent.com への fetch が発生しない', async () => {
  const { fn, calls } = captureHeadersFetch(200, JSON.stringify(makeValidJson()));
  await importHorseHistoriesJra({
    argv: ['--date', DATE, '--venues', VENUE],
    env: { KEIBA_DATA_SHARED_TOKEN: 'tok' },
    client: createSharedClient({ fetchImpl: fn, env: { KEIBA_DATA_SHARED_TOKEN: 'tok' }, retries: 0 }),
    writeFileFn: () => {},
    mkdirFn: () => {},
  });
  for (const call of calls) {
    assert.ok(
      !call.url.includes('raw.githubusercontent.com'),
      `raw.githubusercontent.com が呼ばれた: ${call.url}`,
    );
  }
});

// ── CLI 引数 ─────────────────────────────────────────────────

test('20. --date なし → exit 2', async () => {
  const code = await importHorseHistoriesJra({
    argv: [],
    env: { KEIBA_DATA_SHARED_TOKEN: 'tok' },
    writeFileFn: () => {},
    mkdirFn: () => {},
  });
  assert.strictEqual(code, 2);
});

test('21. 不正な日付フォーマット → exit 2', async () => {
  const code = await importHorseHistoriesJra({
    argv: ['--date', '20260524'],
    env: { KEIBA_DATA_SHARED_TOKEN: 'tok' },
    writeFileFn: () => {},
    mkdirFn: () => {},
  });
  assert.strictEqual(code, 2);
});

test('22. 不明会場コードはエラーにならず fetch を試みる（404 扱い可）', async () => {
  const code = await importHorseHistoriesJra({
    argv: ['--date', DATE, '--venues', 'XYZ'],
    env: { KEIBA_DATA_SHARED_TOKEN: 'tok' },
    client: clientWith(mockFetchStatus(404)),
    writeFileFn: () => {},
    mkdirFn: () => {},
  });
  // 404 → skipped → exit 5（all skipped）
  assert.strictEqual(code, 5);
});

// ── パス ────────────────────────────────────────────────────

test('23. buildSharedPath: 正しいパス形式', () => {
  assert.strictEqual(
    buildSharedPath('2026-05-24', 'TOK'),
    'jra/horseHistories/2026/05/2026-05-24-TOK.json',
  );
});

test('24. buildLocalPath: src/data/horseHistories/jra/YYYY/MM/ に格納', () => {
  const p = buildLocalPath('2026-05-24', 'TOK');
  assert.ok(p.includes('horseHistories/jra/2026/05'), `パスが期待値と異なる: ${p}`);
  assert.ok(p.endsWith('2026-05-24-TOK.json'), `ファイル名が期待値と異なる: ${p}`);
});

// ── validation ───────────────────────────────────────────────

test('25. validateHorseHistoriesJson: 正常 JSON で true', () => {
  assert.strictEqual(validateHorseHistoriesJson(makeValidJson(), VENUE, DATE), true);
});

test('26. validateHorseHistoriesJson: source 不一致 → throw', () => {
  assert.throws(
    () => validateHorseHistoriesJson({ ...makeValidJson(), source: 'unknown' }, VENUE, DATE),
    /unexpected source/,
  );
});

test('27. validateHorseHistoriesJson: date 不一致 → throw', () => {
  assert.throws(
    () => validateHorseHistoriesJson({ ...makeValidJson(), date: '2099-01-01' }, VENUE, DATE),
    /date mismatch/,
  );
});

test('28. validateHorseHistoriesJson: venueCode 不一致 → failedCount に繋がる', async () => {
  const json = makeValidJson({ venueCode: 'KYO' }); // TOK を期待するのに KYO
  const code = await importHorseHistoriesJra({
    argv: ['--date', DATE, '--venues', VENUE],
    env: { KEIBA_DATA_SHARED_TOKEN: 'tok' },
    client: clientWith(mockFetchStatus(200, JSON.stringify(json))),
    writeFileFn: () => {},
    mkdirFn: () => {},
  });
  assert.strictEqual(code, 4, `venueCode 不一致で exit 4 を期待したが ${code}`);
});

// ── 保存 JSON ─────────────────────────────────────────────────

test('29. 保存 JSON は JSON.stringify(json, null, 2) と一致する', async () => {
  const original = makeValidJson();
  const { writes, writeFileFn, mkdirFn } = makeWriteSpy();
  await importHorseHistoriesJra({
    argv: ['--date', DATE, '--venues', VENUE],
    env: { KEIBA_DATA_SHARED_TOKEN: 'tok' },
    client: clientWith(mockFetchStatus(200, JSON.stringify(original))),
    writeFileFn,
    mkdirFn,
  });
  assert.strictEqual(writes.length, 1, '書き込みが 1 件でない');
  const parsed = JSON.parse(writes[0].content);
  assert.deepStrictEqual(parsed, original, '保存 JSON が元データと一致しない');
  // インデント 2 スペース確認
  assert.strictEqual(writes[0].content, JSON.stringify(original, null, 2), 'インデント形式が異なる');
});

// ── exit code ────────────────────────────────────────────────

test('30. exit 0（全 saved）', async () => {
  const code = await importHorseHistoriesJra({
    argv: ['--date', DATE, '--venues', VENUE],
    env: { KEIBA_DATA_SHARED_TOKEN: 'tok' },
    client: clientWith(mockFetchStatus(200, JSON.stringify(makeValidJson()))),
    writeFileFn: () => {},
    mkdirFn: () => {},
  });
  assert.strictEqual(code, 0);
});

test('31. exit 4（全 failed）', async () => {
  const code = await importHorseHistoriesJra({
    argv: ['--date', DATE, '--venues', 'TOK,NAK'],
    env: { KEIBA_DATA_SHARED_TOKEN: 'tok' },
    client: clientWith(mockFetchStatus(500, 'error')),
    writeFileFn: () => {},
    mkdirFn: () => {},
  });
  assert.strictEqual(code, 4);
});

test('32. exit 5（全 404）', async () => {
  const code = await importHorseHistoriesJra({
    argv: ['--date', DATE, '--venues', 'TOK,NAK'],
    env: { KEIBA_DATA_SHARED_TOKEN: 'tok' },
    client: clientWith(mockFetchStatus(404)),
    writeFileFn: () => {},
    mkdirFn: () => {},
  });
  assert.strictEqual(code, 5);
});

// ── エクスポート / resolveVenues ──────────────────────────────

test('33. resolveVenues: デフォルトは ALL_JRA_VENUES', () => {
  assert.deepStrictEqual(resolveVenues(null), ALL_JRA_VENUES);
  assert.deepStrictEqual(resolveVenues(''), ALL_JRA_VENUES);
});

test('34. resolveVenues: カンマ区切り文字列を大文字配列に変換', () => {
  assert.deepStrictEqual(resolveVenues('tok,kyo,nii'), ['TOK', 'KYO', 'NII']);
});
