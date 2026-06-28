/**
 * importPredictionJra.test.mjs — importPrediction (JRA) の単体テスト
 * （node:test / mock client / 実 GitHub 通信なし / ファイル書き込みなし）
 *   node --test scripts/importPredictionJra.test.mjs
 *
 * 確認項目:
 *   - TOKEN_MISSING → isDirectRun path で exit 1
 *   - 不正日付 + TOKEN_MISSING → 日付エラーが先（CLIエラー優先順位）
 *   - 全ソース 404 → null（予想データなし、正常終了）
 *   - sharedPrediction 200 → computer/racebook prediction source を呼ばない
 *   - integrated 404 → computer 200（第2候補成功）
 *   - computer 404 → racebook 200（第3候補成功）
 *   - 各段階の auth/network/malformed → fatal
 *   - fetchJraResultDay: 正しい path / 200 / 404 / 401 / 429 retry / 429 枯渇 / 5xx retry / timeout retry / malformed JSON
 *   - enrichRecentRacesDistance: 距離注入 / 上書きしない / horse 不一致は注入しない
 *   - lookupPastRaceDistance: HKD 使用 (HAK 禁止)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  importPrediction,
  fetchJraResultDay,
  lookupPastRaceDistance,
  enrichRecentRacesDistance,
  clearResultsCache,
} from './importPredictionJra.js';
import { createSharedClient, SHARED_FETCH_CODES } from './lib/sharedFetch.mjs';

const __testDir = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__testDir, 'importPredictionJra.js');

function runScript(args, extraEnv = {}) {
  return spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf-8',
    timeout: 10000,
    env: { PATH: process.env.PATH, ...extraEnv },
  });
}

const MOCK_TOKEN = 'ghp_MOCK_TOKEN_importPredictionJra_test';
const ENV_OK = { KEIBA_DATA_SHARED_TOKEN: MOCK_TOKEN };
const noSleep = async () => {};
const JSON_ACCEPT = 'application/vnd.github+json';

function mkFetch(responder) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init }); return responder(url, calls.length - 1, init); };
  fn.calls = calls;
  return fn;
}

function mkRes(status, body, headers = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (n) => lower[n.toLowerCase()] ?? null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function mkClient(responder) {
  return createSharedClient({ fetchImpl: mkFetch(responder), env: ENV_OK, sleepImpl: noSleep });
}

function mkClientAndFetch(responder) {
  const fetchImpl = mkFetch(responder);
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  return { client, fetchImpl };
}

// raw content file response (Accept: application/vnd.github.raw+json)
function mkRawRes(content) {
  return mkRes(200, JSON.stringify(content));
}

// directory listing entry
function mkDirEntry(name, path) {
  return { name, path, sha: 'abc123', size: 100, type: 'file' };
}

// directory listing response
function mkDirRes(entries) {
  return mkRes(200, entries);
}

// JRA予想データ（単一会場形式）
function mkJraPrediction(venue = '東京') {
  return {
    date: '2026-02-07',
    venue,
    totalRaces: 1,
    races: [{
      raceNumber: 1,
      raceInfo: { raceNumber: '1R', raceName: 'テストレース', distance: '1600m', startTime: '10:00' },
      horses: [
        { number: 1, name: 'テスト馬A', totalScore: 90, assignment: '本命', jockey: '騎手A', trainer: '調教師A', seirei: '牡3', kinryo: '57' },
        { number: 2, name: 'テスト馬B', totalScore: 70, assignment: '対抗', jockey: '騎手B', trainer: '調教師B', seirei: '牝3', kinryo: '55' },
      ],
    }],
  };
}

// ───────────────────────────────────────────────
// テスト 1: TOKEN_MISSING → exit 1
// ───────────────────────────────────────────────
test('1. TOKEN_MISSING: 直接実行時 exit 1', () => {
  const r = runScript(['--date', '2026-02-07'], {});
  assert.strictEqual(r.status, 1, `exit code should be 1, got ${r.status}`);
  assert.ok(r.stderr.includes('TOKEN_MISSING') || r.stderr.includes('FATAL'), `stderr: ${r.stderr}`);
});

// ───────────────────────────────────────────────
// テスト 2: 不正日付 + TOKEN_MISSING → 日付エラーが先
// ───────────────────────────────────────────────
test('2. 不正日付 + TOKEN_MISSING → 日付エラーが TOKEN_MISSING より先', () => {
  const r = runScript(['--date', 'not-a-date'], {});
  assert.strictEqual(r.status, 1, `exit code should be 1, got ${r.status}`);
  assert.ok(
    !r.stderr.includes('TOKEN_MISSING'),
    `should show date error first, not TOKEN_MISSING. stderr: ${r.stderr}`,
  );
  assert.ok(
    r.stderr.includes('YYYY-MM-DD') || r.stderr.includes('日付'),
    `should mention date format error. stderr: ${r.stderr}`,
  );
});

// ───────────────────────────────────────────────
// テスト 3: 全ソース 404 → null（正常）
// ───────────────────────────────────────────────
test('3. 全ソース 404 → importPrediction は null を返す', async () => {
  const client = mkClient(() => mkRes(404, { message: 'Not Found' }));
  const result = await importPrediction('2026-02-08', 'jra', { client });
  assert.strictEqual(result, null);
});

// ───────────────────────────────────────────────
// テスト 4: sharedPrediction 404 → computer 404 → racebook 404 → null（全段階フォールバック）
// ───────────────────────────────────────────────
test('4. sharedPrediction 404 → computer 404 → racebook 404 → null', async () => {
  let callCount = 0;
  const client = mkClient(() => { callCount++; return mkRes(404, { message: 'Not Found' }); });
  const result = await importPrediction('2026-02-09', 'jra', { client });
  assert.strictEqual(result, null);
  assert.ok(callCount >= 3, `expected >=3 calls (shared/computer dir/racebook dir), got ${callCount}`);
});

// ───────────────────────────────────────────────
// テスト 5: sharedPrediction 200 → computer/racebook prediction source を呼ばない
// ───────────────────────────────────────────────
test('5. sharedPrediction 200 → computer/racebook prediction source は呼ばれない（第1候補で確定）', async () => {
  const prediction = mkJraPrediction('東京');

  const { client, fetchImpl } = mkClientAndFetch((url, idx, init) => {
    const accept = init?.headers?.Accept;
    if (url.includes('/predictions/') && accept !== JSON_ACCEPT) {
      // sharedPrediction ファイル (RAW_ACCEPT) → 200
      return mkRawRes(prediction);
    }
    return mkRes(404, { message: 'Not Found' });
  });

  const result = await importPrediction('2026-02-10', 'jra', { client });
  assert.ok(result !== null, 'result should not be null');

  const calledUrls = fetchImpl.calls.map(c => c.url);
  const computerCalled = calledUrls.some(u => u.includes('computer'));
  assert.ok(!computerCalled, `computer dir should NOT be called when sharedPrediction succeeds. URLs: ${calledUrls.join(', ')}`);
});

// ───────────────────────────────────────────────
// テスト 6: integrated 404 → computer 200（第2候補成功）
// ───────────────────────────────────────────────
test('6. sharedPrediction 404 → computer 200 → result 返る（第2候補成功）', async () => {
  const venueData = mkJraPrediction('東京');
  const computerEntry = mkDirEntry('2026-02-11-TOK.json', 'jra/predictions/computer/2026/02/2026-02-11-TOK.json');

  const { client, fetchImpl } = mkClientAndFetch((url, idx, init) => {
    const accept = init?.headers?.Accept;
    if (url.includes('/predictions/computer/')) {
      if (accept === JSON_ACCEPT) return mkDirRes([computerEntry]);
      return mkRawRes(venueData);
    }
    return mkRes(404, { message: 'Not Found' });
  });

  const result = await importPrediction('2026-02-11', 'jra', { client });
  assert.ok(result !== null, 'result should not be null (computer succeeded)');

  const calledUrls = fetchImpl.calls.map(c => c.url);
  assert.ok(calledUrls.some(u => u.includes('computer')), 'computer should have been called as fallback');
});

// ───────────────────────────────────────────────
// テスト 7: computer 404 → racebook 200（第3候補成功）
// ───────────────────────────────────────────────
test('7. sharedPrediction 404 → computer 404 → racebook 200 → result 返る（第3候補成功）', async () => {
  const rbData = {
    track: '東京',
    races: [{
      raceNumber: 1, raceClass: 'テストレース', distance: '2000m', startTime: '10:00', conditions: '',
      horses: [{ number: 1, name: 'テスト馬A', totalScore: 90, marks: ['◎'], jockey: '騎手A', trainer: '調教師A', sexAge: '牡3', weight: 57, computerIndex: null }],
    }],
  };
  const rbEntry = mkDirEntry('2026-02-12-TOK.json', 'jra/racebook/2026/02/2026-02-12-TOK.json');

  const { client, fetchImpl } = mkClientAndFetch((url, idx, init) => {
    const accept = init?.headers?.Accept;
    if (url.includes('/racebook/')) {
      if (accept === JSON_ACCEPT) return mkDirRes([rbEntry]);
      return mkRawRes(rbData);
    }
    return mkRes(404, { message: 'Not Found' });
  });

  const result = await importPrediction('2026-02-12', 'jra', { client });
  assert.ok(result !== null, 'result should not be null (racebook succeeded)');

  const calledUrls = fetchImpl.calls.map(c => c.url);
  assert.ok(calledUrls.some(u => u.includes('/racebook/')), 'racebook should have been called as 3rd fallback');
});

// ───────────────────────────────────────────────
// テスト 8: sharedPrediction 401 → AUTH_FAILED → fatal
// ───────────────────────────────────────────────
test('8. sharedPrediction 401 → AUTH_FAILED → fatal', async () => {
  const client = mkClient(() => mkRes(401, { message: 'Bad credentials' }));
  await assert.rejects(
    () => importPrediction('2026-02-13', 'jra', { client }),
    (e) => {
      assert.ok(
        e.code === SHARED_FETCH_CODES.AUTH_FAILED || e.message.includes('401') || e.message.toLowerCase().includes('auth'),
        `expected AUTH_FAILED, got code=${e.code} message=${e.message}`
      );
      return true;
    }
  );
});

// ───────────────────────────────────────────────
// テスト 9: computer predictions 401 → AUTH_FAILED → fatal
// ───────────────────────────────────────────────
test('9. computer predictions 401 → AUTH_FAILED → fatal', async () => {
  let reqIndex = 0;
  const client = mkClient(() => {
    reqIndex++;
    if (reqIndex === 1) return mkRes(404, { message: 'Not Found' });  // sharedPrediction 404
    return mkRes(401, { message: 'Bad credentials' });
  });

  await assert.rejects(
    () => importPrediction('2026-02-14', 'jra', { client }),
    (e) => {
      assert.ok(
        e.code === SHARED_FETCH_CODES.AUTH_FAILED || e.message.includes('401') || e.message.toLowerCase().includes('auth'),
        `expected AUTH_FAILED, got code=${e.code} message=${e.message}`
      );
      return true;
    }
  );
});

// ───────────────────────────────────────────────
// テスト 10: racebook pastRaces 404 → horseDataMap null でも正常終了
// ───────────────────────────────────────────────
test('10. racebook pastRaces 404 → horseDataMap null でも normalizedResult 返る', async () => {
  const prediction = mkJraPrediction('東京');
  let reqIndex = 0;

  const client = mkClient(() => {
    reqIndex++;
    if (reqIndex === 1) return mkRawRes(prediction);   // sharedPrediction raw
    return mkRes(404, { message: 'Not Found' });       // racebook pastRaces → 404
  });

  const result = await importPrediction('2026-02-15', 'jra', { client });
  assert.ok(result !== null);
  assert.ok(result.normalizedResult !== undefined);
});

// ───────────────────────────────────────────────
// テスト 11: 403 FORBIDDEN → fatal
// ───────────────────────────────────────────────
test('11. 403 FORBIDDEN → fatal（匿名 fallback しない）', async () => {
  const client = mkClient(() => mkRes(403, { message: 'Forbidden' }));
  await assert.rejects(
    () => importPrediction('2026-02-16', 'jra', { client }),
    (e) => {
      assert.ok(
        e.code === SHARED_FETCH_CODES.FORBIDDEN || e.code === SHARED_FETCH_CODES.RATE_LIMITED ||
        e.message.includes('403') || e.message.toLowerCase().includes('forbidden'),
        `expected FORBIDDEN/RATE_LIMITED, got code=${e.code} message=${e.message}`
      );
      return true;
    }
  );
});

// ═══════════════════════════════════════════════
// fetchJraResultDay テスト群
// ═══════════════════════════════════════════════

// ───────────────────────────────────────────────
// テスト 12: fetchJraResultDay — 正しい path を使用し HKD を使用（HAK 禁止）
// ───────────────────────────────────────────────
test('12. fetchJraResultDay: path = jra/results/YYYY/MM/YYYY-MM-DD-HKD.json（HAK 禁止）', async () => {
  clearResultsCache();
  let capturedUrl = null;
  const fetchImpl = mkFetch((url) => { capturedUrl = url; return mkRawRes({ races: [] }); });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });

  await fetchJraResultDay(2026, 6, 1, 'HKD', client);

  assert.ok(capturedUrl !== null, 'fetch should have been called');
  assert.ok(capturedUrl.includes('jra/results/2026/06/2026-06-01-HKD.json'),
    `URL should contain correct path. Got: ${capturedUrl}`);
  assert.ok(!capturedUrl.includes('HAK'), `URL must not contain HAK (use HKD). Got: ${capturedUrl}`);
});

// ───────────────────────────────────────────────
// テスト 13: fetchJraResultDay — 200 → races 配列を返す
// ───────────────────────────────────────────────
test('13. fetchJraResultDay: 200 → races 配列を返す', async () => {
  clearResultsCache();
  const races = [{ raceNumber: 1, distance: 1600, results: [{ name: 'テスト馬A', finishPosition: 1 }] }];
  const client = mkClient(() => mkRawRes({ races }));

  const result = await fetchJraResultDay(2026, 6, 2, 'HKD', client);
  assert.deepStrictEqual(result, races, 'should return races array from response');
});

// ───────────────────────────────────────────────
// テスト 14: fetchJraResultDay — 404 → null
// ───────────────────────────────────────────────
test('14. fetchJraResultDay: 404 → null', async () => {
  clearResultsCache();
  const client = mkClient(() => mkRes(404, { message: 'Not Found' }));

  const result = await fetchJraResultDay(2026, 6, 3, 'HKD', client);
  assert.strictEqual(result, null, 'should return null on 404');
});

// ───────────────────────────────────────────────
// テスト 15: fetchJraResultDay — 401 → fatal
// ───────────────────────────────────────────────
test('15. fetchJraResultDay: 401 → AUTH_FAILED fatal（silent degradation しない）', async () => {
  clearResultsCache();
  const client = mkClient(() => mkRes(401, { message: 'Bad credentials' }));

  await assert.rejects(
    () => fetchJraResultDay(2026, 6, 4, 'HKD', client),
    (e) => {
      assert.strictEqual(e.code, SHARED_FETCH_CODES.AUTH_FAILED,
        `expected AUTH_FAILED, got ${e.code}`);
      return true;
    }
  );
});

// ───────────────────────────────────────────────
// テスト 16: fetchJraResultDay — 429 retry 後成功
// ───────────────────────────────────────────────
test('16. fetchJraResultDay: 429 → retry → 200 成功', async () => {
  clearResultsCache();
  let callCount = 0;
  const races = [{ raceNumber: 1, distance: 1800, results: [] }];
  const fetchImpl = mkFetch(() => {
    callCount++;
    if (callCount < 2) return mkRes(429, { message: 'Rate limited' });
    return mkRawRes({ races });
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });

  const result = await fetchJraResultDay(2026, 6, 5, 'HKD', client);
  assert.ok(Array.isArray(result), 'should return races array after retry');
  assert.ok(callCount >= 2, `should have retried (callCount=${callCount})`);
});

// ───────────────────────────────────────────────
// テスト 17: fetchJraResultDay — 429 枯渇 → fatal
// ───────────────────────────────────────────────
test('17. fetchJraResultDay: 429 retry 枯渇 → RATE_LIMITED fatal', async () => {
  clearResultsCache();
  const client = mkClient(() => mkRes(429, { message: 'Rate limited' }));

  await assert.rejects(
    () => fetchJraResultDay(2026, 6, 6, 'HKD', client),
    (e) => {
      assert.strictEqual(e.code, SHARED_FETCH_CODES.RATE_LIMITED,
        `expected RATE_LIMITED, got ${e.code}`);
      return true;
    }
  );
});

// ───────────────────────────────────────────────
// テスト 18: fetchJraResultDay — 5xx retry 後成功
// ───────────────────────────────────────────────
test('18. fetchJraResultDay: 503 → retry → 200 成功', async () => {
  clearResultsCache();
  let callCount = 0;
  const races = [{ raceNumber: 2, distance: 2000, results: [] }];
  const fetchImpl = mkFetch(() => {
    callCount++;
    if (callCount === 1) return mkRes(503, { message: 'Service Unavailable' });
    return mkRawRes({ races });
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });

  const result = await fetchJraResultDay(2026, 6, 7, 'HKD', client);
  assert.ok(Array.isArray(result), 'should return races array after 5xx retry');
  assert.ok(callCount >= 2, `should have retried on 5xx (callCount=${callCount})`);
});

// ───────────────────────────────────────────────
// テスト 19: fetchJraResultDay — timeout retry 後成功
// ───────────────────────────────────────────────
test('19. fetchJraResultDay: AbortError → retry → 200 成功', async () => {
  clearResultsCache();
  let callCount = 0;
  const races = [{ raceNumber: 3, distance: 1200, results: [] }];
  const fetchImpl = mkFetch(async () => {
    callCount++;
    if (callCount === 1) {
      const e = new Error('The operation was aborted');
      e.name = 'AbortError';
      throw e;
    }
    return mkRawRes({ races });
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });

  const result = await fetchJraResultDay(2026, 6, 8, 'HKD', client);
  assert.ok(Array.isArray(result), 'should return races array after timeout retry');
  assert.ok(callCount >= 2, `should have retried on timeout (callCount=${callCount})`);
});

// ───────────────────────────────────────────────
// テスト 20: fetchJraResultDay — malformed JSON → INVALID_JSON fatal
// ───────────────────────────────────────────────
test('20. fetchJraResultDay: malformed JSON → INVALID_JSON fatal', async () => {
  clearResultsCache();
  const fetchImpl = mkFetch(() => mkRes(200, 'not valid json at all'));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });

  await assert.rejects(
    () => fetchJraResultDay(2026, 6, 9, 'HKD', client),
    (e) => {
      assert.strictEqual(e.code, SHARED_FETCH_CODES.INVALID_JSON,
        `expected INVALID_JSON, got ${e.code}`);
      return true;
    }
  );
});

// ═══════════════════════════════════════════════
// enrichRecentRacesDistance テスト群
// ═══════════════════════════════════════════════

// ───────────────────────────────────────────────
// テスト 21: enrichRecentRacesDistance — 距離が注入される
// ───────────────────────────────────────────────
test('21. enrichRecentRacesDistance: races に horse 名が一致 → distanceMeters 注入', async () => {
  clearResultsCache();
  const horseName = 'テスト馬X';
  const convertedData = {
    venues: [{
      predictions: [{
        horses: [{
          horseName,
          recentRaces: [{ venue: '函6.1', distanceMeters: null }],
        }],
      }],
    }],
  };
  const races = [{ distance: 1600, results: [{ name: horseName, finishPosition: 1 }] }];
  const client = mkClient(() => mkRawRes({ races }));

  // raceDateStr=2026-06-15, venueStr="函6.1" → mo=6, da=1, yr=2026, venueChar='函' → HKD
  await enrichRecentRacesDistance(convertedData, '2026-06-15', client);

  const pr = convertedData.venues[0].predictions[0].horses[0].recentRaces[0];
  assert.strictEqual(pr.distanceMeters, 1600, 'distanceMeters should be injected from results');
});

// ───────────────────────────────────────────────
// テスト 22: enrichRecentRacesDistance — 既に distanceMeters があれば上書きしない
// ───────────────────────────────────────────────
test('22. enrichRecentRacesDistance: distanceMeters 既存 → 上書きしない、fetchも呼ばない', async () => {
  clearResultsCache();
  const convertedData = {
    venues: [{
      predictions: [{
        horses: [{
          horseName: 'テスト馬Y',
          recentRaces: [{ venue: '函5.31', distanceMeters: 1200 }], // 既存値
        }],
      }],
    }],
  };
  const fetchImpl = mkFetch(() => mkRawRes({ races: [] }));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });

  await enrichRecentRacesDistance(convertedData, '2026-06-15', client);

  const pr = convertedData.venues[0].predictions[0].horses[0].recentRaces[0];
  assert.strictEqual(pr.distanceMeters, 1200, 'existing distanceMeters should NOT be overwritten');
  assert.strictEqual(fetchImpl.calls.length, 0, 'no fetch should happen if distanceMeters already set');
});

// ───────────────────────────────────────────────
// テスト 23: lookupPastRaceDistance — horse 名不一致は注入しない
// ───────────────────────────────────────────────
test('23. lookupPastRaceDistance: horse 名不一致 → null を返す（注入しない）', async () => {
  clearResultsCache();
  // races に "テスト馬Z" がいるが lookup する horse は "テスト馬W"
  const races = [{ distance: 1800, results: [{ name: 'テスト馬Z', finishPosition: 1 }] }];
  const client = mkClient(() => mkRawRes({ races }));

  // 函5.20, raceDate=2026-06-01 → mo=5, da=20, yr=2026 (5<6 なので yr=2026のまま) → HKD
  const dist = await lookupPastRaceDistance('テスト馬W', '函5.20', '2026-06-01', client);
  assert.strictEqual(dist, null, 'should return null when horse name does not match');
});

// ───────────────────────────────────────────────
// テスト 24: lookupPastRaceDistance — 函館は HKD（HAK 残留なし）
// ───────────────────────────────────────────────
test('24. lookupPastRaceDistance: 函館 → HKD を使用（HAK 禁止）', async () => {
  clearResultsCache();
  let capturedUrl = null;
  const fetchImpl = mkFetch((url) => { capturedUrl = url; return mkRawRes({ races: [] }); });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });

  // venueStr='函5.1' → venueChar='函' → JRA_VENUE_CODE['函']='HKD'
  await lookupPastRaceDistance('テスト馬V', '函5.1', '2026-06-15', client);

  assert.ok(capturedUrl !== null, 'fetch should be called');
  assert.ok(capturedUrl.includes('HKD'), `URL should contain HKD. Got: ${capturedUrl}`);
  assert.ok(!capturedUrl.includes('HAK'), `URL must NOT contain HAK. Got: ${capturedUrl}`);
});
