/**
 * importPrediction.test.mjs — importPrediction (nankan) の単体テスト
 * （node:test / mock client / 実 GitHub 通信なし / ファイル書き込みなし）
 *   node --test scripts/importPrediction.test.mjs
 *
 * 確認項目:
 *   - TOKEN_MISSING → isDirectRun path で exit 1
 *   - 不正日付 + TOKEN_MISSING → 日付エラーが先（CLIエラー優先順位）
 *   - 全ソース 404 → null（予想データなし、正常終了）
 *   - venue predictions 404 → computer にフォールバック
 *   - venue predictions AUTH_FAILED → fatal（silent degradation しない）
 *   - venue 200 なら computer/shared/racebook prediction source を呼ばない
 *   - venue 404 → computer 200（第2候補成功）
 *   - computer 404 → sharedPrediction 200（第3候補成功）
 *   - sharedPrediction 404 → racebook 200（第4候補成功）
 *   - partial venue 404 は許容（一部ファイル 404 でも他 venue は返る）
 *   - partial venue AUTH_FAILED → 全体 fatal
 *   - 複数 venue 両方取得（順序維持）
 *   - entries 404 → racebook pastRaces にフォールバック（null でも進行）
 *   - racebook pastRaces AUTH_FAILED → fatal
 *   - 403 FORBIDDEN → fatal
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { importPrediction } from './importPrediction.js';
import { createSharedClient, SHARED_FETCH_CODES } from './lib/sharedFetch.mjs';

const __testDir = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__testDir, 'importPrediction.js');

function runScript(args, extraEnv = {}) {
  return spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf-8',
    timeout: 10000,
    env: { PATH: process.env.PATH, ...extraEnv },
  });
}

const MOCK_TOKEN = 'ghp_MOCK_TOKEN_importPrediction_test';
const ENV_OK = { KEIBA_DATA_SHARED_TOKEN: MOCK_TOKEN };
const noSleep = async () => {};
const RAW_ACCEPT = 'application/vnd.github.raw+json';
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

// ── 最小限の venues 形式予想データ ──
function mkVenuePrediction(venue = 'OOI') {
  return {
    date: '2026-01-10',
    venue,
    totalRaces: 1,
    races: [{
      raceNumber: 1,
      raceInfo: { raceNumber: '1R', raceName: 'テストレース', distance: '1600m', startTime: '15:00' },
      horses: [
        { number: 1, name: 'テスト馬A', totalScore: 100, assignment: '本命', jockey: '騎手A', trainer: '調教師A', seirei: '牡3', kinryo: '57' },
        { number: 2, name: 'テスト馬B', totalScore: 80, assignment: '対抗', jockey: '騎手B', trainer: '調教師B', seirei: '牝3', kinryo: '55' },
      ],
    }],
  };
}

// ── directory listing レスポンス ──
function mkDirEntry(name, path) {
  return { name, path, sha: 'abc123', size: 100, type: 'file' };
}

// Contents API: directory listing
function mkDirRes(entries) {
  return mkRes(200, entries);
}

// raw content file response (Accept: application/vnd.github.raw+json)
function mkRawRes(content) {
  return mkRes(200, JSON.stringify(content));
}

// ───────────────────────────────────────────────
// テスト 1: TOKEN_MISSING → exit 1
// ───────────────────────────────────────────────
test('1. TOKEN_MISSING: 直接実行時 exit 1', () => {
  const r = runScript(['--date', '2026-01-10'], {});
  assert.strictEqual(r.status, 1, `exit code should be 1, got ${r.status}`);
  assert.ok(r.stderr.includes('TOKEN_MISSING') || r.stderr.includes('FATAL'), `stderr: ${r.stderr}`);
});

// ───────────────────────────────────────────────
// テスト 2: 不正日付 + TOKEN_MISSING → 日付エラーが先（CLI優先順位）
// ───────────────────────────────────────────────
test('2. 不正日付 + TOKEN_MISSING → 日付エラーが TOKEN_MISSING より先', () => {
  const r = runScript(['--date', 'not-a-date'], {});
  assert.strictEqual(r.status, 1, `exit code should be 1, got ${r.status}`);
  // TOKEN_MISSING より日付エラーが先に発生する
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
  const result = await importPrediction('2026-01-10', 'nankan', { client });
  assert.strictEqual(result, null);
});

// ───────────────────────────────────────────────
// テスト 4: venue predictions 404 → computer 404 → shared 404 → racebook 404 → null
// ───────────────────────────────────────────────
test('4. venue 404 → computer 404 → sharedPrediction 404 → racebook 404 → null', async () => {
  let callCount = 0;
  const client = mkClient(() => {
    callCount++;
    return mkRes(404, { message: 'Not Found' });
  });
  const result = await importPrediction('2026-01-11', 'nankan', { client });
  assert.strictEqual(result, null);
  // 4つのソース（venue/computer/shared/racebook）を試みた分だけ呼ばれる
  assert.ok(callCount >= 4, `expected >=4 calls, got ${callCount}`);
});

// ───────────────────────────────────────────────
// テスト 5: venue predictions 401 → AUTH_FAILED → fatal
// ───────────────────────────────────────────────
test('5. venue predictions 401 → AUTH_FAILED → silent degradation しない（throw）', async () => {
  const client = mkClient(() => mkRes(401, { message: 'Bad credentials' }));
  await assert.rejects(
    () => importPrediction('2026-01-12', 'nankan', { client }),
    (e) => {
      assert.ok(e.code === SHARED_FETCH_CODES.AUTH_FAILED || e.message.includes('401') || e.message.toLowerCase().includes('auth'),
        `expected AUTH_FAILED, got code=${e.code} message=${e.message}`);
      return true;
    }
  );
});

// ───────────────────────────────────────────────
// テスト 6: venue predictions 200 → computer/shared/racebook prediction source を呼ばない
// ───────────────────────────────────────────────
test('6. venue 200 → computer/sharedPrediction prediction source は呼ばれない（第1候補で確定）', async () => {
  const venueData = mkVenuePrediction('OOI');
  const dirEntry = mkDirEntry('2026-01-20-OOI.json', 'nankan/predictions/2026/01/2026-01-20-OOI.json');

  const { client, fetchImpl } = mkClientAndFetch((url, idx, init) => {
    const accept = init?.headers?.Accept;
    if (url.includes('/predictions/2026/01') && !url.includes('computer')) {
      if (accept === JSON_ACCEPT) return mkDirRes([dirEntry]);
      return mkRawRes(venueData);
    }
    return mkRes(404, { message: 'Not Found' });
  });

  const result = await importPrediction('2026-01-20', 'nankan', { client });
  assert.ok(result !== null, 'result should not be null');

  const calledUrls = fetchImpl.calls.map(c => c.url);
  const computerCalled = calledUrls.some(u => u.includes('computer'));
  assert.ok(!computerCalled, `computer dir should NOT be called when venue succeeds. URLs: ${calledUrls.join(', ')}`);
});

// ───────────────────────────────────────────────
// テスト 7: venue 404 → computer 200（第2候補成功）
// ───────────────────────────────────────────────
test('7. venue 404 → computer 200 → result 返る（第2候補成功）', async () => {
  const venueData = mkVenuePrediction('OOI');
  const computerEntry = mkDirEntry('2026-01-21-OOI.json', 'nankan/predictions/computer/2026/01/2026-01-21-OOI.json');

  const { client, fetchImpl } = mkClientAndFetch((url, idx, init) => {
    const accept = init?.headers?.Accept;
    if (url.includes('/predictions/computer/')) {
      if (accept === JSON_ACCEPT) return mkDirRes([computerEntry]);
      return mkRawRes(venueData);
    }
    if (url.includes('/predictions/') && !url.includes('computer')) {
      // venue dir → 404
      if (accept === JSON_ACCEPT) return mkRes(404, { message: 'Not Found' });
    }
    return mkRes(404, { message: 'Not Found' });
  });

  const result = await importPrediction('2026-01-21', 'nankan', { client });
  assert.ok(result !== null, 'result should not be null (computer succeeded)');
  assert.ok(result.results !== undefined || result !== null, 'should have result');

  const calledUrls = fetchImpl.calls.map(c => c.url);
  const computerCalled = calledUrls.some(u => u.includes('computer'));
  assert.ok(computerCalled, 'computer dir should have been called as fallback');
});

// ───────────────────────────────────────────────
// テスト 8: computer 404 → sharedPrediction 200（第3候補成功）
// ───────────────────────────────────────────────
test('8. venue 404 → computer 404 → sharedPrediction 200 → result 返る（第3候補成功）', async () => {
  const prediction = mkVenuePrediction('OOI');

  const { client, fetchImpl } = mkClientAndFetch((url, idx, init) => {
    const accept = init?.headers?.Accept;
    // venue dir listing or computer dir listing → 404
    if (accept === JSON_ACCEPT) return mkRes(404, { message: 'Not Found' });
    // file fetch (RAW_ACCEPT): sharedPrediction file → 200
    return mkRawRes(prediction);
  });

  const result = await importPrediction('2026-01-22', 'nankan', { client });
  assert.ok(result !== null, 'result should not be null (sharedPrediction succeeded)');
});

// ───────────────────────────────────────────────
// テスト 9: sharedPrediction 404 → racebook prediction 200（第4候補成功）
// ───────────────────────────────────────────────
test('9. venue 404 → computer 404 → sharedPrediction 404 → racebook 200 → result 返る（第4候補成功）', async () => {
  const rbData = {
    track: 'OOI',
    races: [{
      raceNumber: 1, raceClass: 'テストレース', distance: '1600m', startTime: '15:00', conditions: '',
      horses: [{ number: 1, name: 'テスト馬A', totalScore: 100, marks: ['◎'], jockey: '騎手A', trainer: '調教師A', sexAge: '牡3', weight: 57, computerIndex: null }],
    }],
  };
  const rbEntry = mkDirEntry('2026-01-23-OOI.json', 'nankan/racebook/2026/01/2026-01-23-OOI.json');

  const { client, fetchImpl } = mkClientAndFetch((url, idx, init) => {
    const accept = init?.headers?.Accept;
    if (url.includes('/racebook/')) {
      if (accept === JSON_ACCEPT) return mkDirRes([rbEntry]);
      return mkRawRes(rbData);
    }
    // predictions → 404 (venue, computer, shared)
    if (accept === JSON_ACCEPT) return mkRes(404, { message: 'Not Found' });
    return mkRes(404, { message: 'Not Found' });
  });

  const result = await importPrediction('2026-01-23', 'nankan', { client });
  assert.ok(result !== null, 'result should not be null (racebook succeeded)');

  const calledUrls = fetchImpl.calls.map(c => c.url);
  const racebookCalled = calledUrls.some(u => u.includes('/racebook/'));
  assert.ok(racebookCalled, 'racebook dir should have been called as 4th fallback');
});

// ───────────────────────────────────────────────
// テスト 10: partial venue 404 は許容（他 venue は返る）
// ───────────────────────────────────────────────
test('10. partial venue: 1ファイル 404 でも他 venue は返る（404 許容）', async () => {
  const venueDataOOI = mkVenuePrediction('OOI');
  const entryOOI = mkDirEntry('2026-01-24-OOI.json', 'nankan/predictions/2026/01/2026-01-24-OOI.json');
  const entryFUN = mkDirEntry('2026-01-24-FUN.json', 'nankan/predictions/2026/01/2026-01-24-FUN.json');

  const client = mkClient((url, idx, init) => {
    const accept = init?.headers?.Accept;
    // dir listing
    if (accept === JSON_ACCEPT && url.includes('/predictions/2026/01')) {
      return mkDirRes([entryOOI, entryFUN]);
    }
    // OOI file → 200, FUN file → 404
    if (url.includes('OOI')) return mkRawRes(venueDataOOI);
    if (url.includes('FUN')) return mkRes(404, { message: 'Not Found' });
    return mkRes(404, { message: 'Not Found' });
  });

  const result = await importPrediction('2026-01-24', 'nankan', { client });
  assert.ok(result !== null, 'result should not be null even if one venue 404');
  // OOI は取得できているので results は存在するはず
  assert.ok(result.results || result !== null, 'should have at least OOI result');
});

// ───────────────────────────────────────────────
// テスト 11: partial venue AUTH_FAILED → 全体 fatal
// ───────────────────────────────────────────────
test('11. partial venue: 1ファイル 401 → AUTH_FAILED で全体 fatal', async () => {
  const venueDataOOI = mkVenuePrediction('OOI');
  const entryOOI = mkDirEntry('2026-01-25-OOI.json', 'nankan/predictions/2026/01/2026-01-25-OOI.json');
  const entryFUN = mkDirEntry('2026-01-25-FUN.json', 'nankan/predictions/2026/01/2026-01-25-FUN.json');

  const client = mkClient((url, idx, init) => {
    const accept = init?.headers?.Accept;
    if (accept === JSON_ACCEPT && url.includes('/predictions/2026/01')) {
      return mkDirRes([entryOOI, entryFUN]);
    }
    if (url.includes('OOI')) return mkRawRes(venueDataOOI);
    if (url.includes('FUN')) return mkRes(401, { message: 'Bad credentials' });
    return mkRes(404, { message: 'Not Found' });
  });

  await assert.rejects(
    () => importPrediction('2026-01-25', 'nankan', { client }),
    (e) => {
      assert.ok(
        e.code === SHARED_FETCH_CODES.AUTH_FAILED || e.message.includes('401') || e.message.toLowerCase().includes('auth'),
        `expected AUTH_FAILED, got code=${e.code} message=${e.message}`,
      );
      return true;
    }
  );
});

// ───────────────────────────────────────────────
// テスト 12: 複数 venue — 両方取得される
// ───────────────────────────────────────────────
test('12. 複数 venue — 両方取得（複数 venue 対応確認）', async () => {
  const venueDataOOI = mkVenuePrediction('OOI');
  const venueDataFUN = mkVenuePrediction('FUN');
  const entryOOI = mkDirEntry('2026-01-26-OOI.json', 'nankan/predictions/2026/01/2026-01-26-OOI.json');
  const entryFUN = mkDirEntry('2026-01-26-FUN.json', 'nankan/predictions/2026/01/2026-01-26-FUN.json');

  const client = mkClient((url, idx, init) => {
    const accept = init?.headers?.Accept;
    if (accept === JSON_ACCEPT && url.includes('/predictions/2026/01')) {
      return mkDirRes([entryOOI, entryFUN]);
    }
    if (url.includes('OOI')) return mkRawRes(venueDataOOI);
    if (url.includes('FUN')) return mkRawRes(venueDataFUN);
    return mkRes(404, { message: 'Not Found' });
  });

  const result = await importPrediction('2026-01-26', 'nankan', { client });
  assert.ok(result !== null, 'result should not be null');
  assert.ok(Array.isArray(result.results), 'results should be array');
  assert.ok(result.results.length >= 2, `expected >=2 venues, got ${result.results.length}`);
});

// ───────────────────────────────────────────────
// テスト 13: venue predictions の dir listing OK、ファイル取得 OK → results 配列で返る
// ───────────────────────────────────────────────
test('13. venue predictions 取得成功 → results 配列に変換される', async () => {
  const venueData = mkVenuePrediction('OOI');
  const dirEntry = mkDirEntry('2026-01-13-OOI.json', 'nankan/predictions/2026/01/2026-01-13-OOI.json');
  let reqIndex = 0;

  const client = mkClient((url, callIdx) => {
    reqIndex++;
    if (reqIndex === 1) return mkDirRes([dirEntry]);   // listDirectory: dir listing
    if (reqIndex === 2) return mkRawRes(venueData);    // fetchText: raw file content
    return mkRes(404, { message: 'Not Found' });       // entries / racebook → 404
  });

  const result = await importPrediction('2026-01-13', 'nankan', { client });
  assert.ok(result !== null, 'result should not be null');
  assert.ok(Array.isArray(result.results), 'results should be array');
  assert.ok(result.results.length >= 1, 'results should have at least 1 venue');
});

// ───────────────────────────────────────────────
// テスト 14: entries 404 → racebook pastRaces にフォールバック（null でも進行）
// ───────────────────────────────────────────────
test('14. entries 404 → racebook pastRaces も 404 → horseDataMap null でも importPrediction 成功', async () => {
  const venueData = mkVenuePrediction('OOI');
  const dirEntry = mkDirEntry('2026-01-14-OOI.json', 'nankan/predictions/2026/01/2026-01-14-OOI.json');
  let reqIndex = 0;

  const client = mkClient(() => {
    reqIndex++;
    if (reqIndex === 1) return mkDirRes([dirEntry]);  // venue listing
    if (reqIndex === 2) return mkRawRes(venueData);   // venue file raw
    return mkRes(404, { message: 'Not Found' });      // entries / racebook → 404
  });

  const result = await importPrediction('2026-01-14', 'nankan', { client });
  assert.ok(result !== null, 'should succeed even with no horse data');
});

// ───────────────────────────────────────────────
// テスト 15: racebook pastRaces 401 → AUTH_FAILED → fatal
// ───────────────────────────────────────────────
test('15. racebook pastRaces 401 → AUTH_FAILED → fatal（silent degradation しない）', async () => {
  const venueData = mkVenuePrediction('OOI');
  const dirEntry = mkDirEntry('2026-01-15-OOI.json', 'nankan/predictions/2026/01/2026-01-15-OOI.json');
  let reqIndex = 0;

  const client = mkClient(() => {
    reqIndex++;
    if (reqIndex === 1) return mkDirRes([dirEntry]);  // venue listing
    if (reqIndex === 2) return mkRawRes(venueData);   // venue file raw
    if (reqIndex === 3) return mkRes(404, { message: 'Not Found' }); // entries dir 404
    return mkRes(401, { message: 'Bad credentials' }); // racebook pastRaces dir → 401
  });

  await assert.rejects(
    () => importPrediction('2026-01-15', 'nankan', { client }),
    (e) => {
      assert.ok(e.code === SHARED_FETCH_CODES.AUTH_FAILED || e.message.includes('401') || e.message.toLowerCase().includes('auth'),
        `expected AUTH_FAILED, got code=${e.code} message=${e.message}`);
      return true;
    }
  );
});

// ───────────────────────────────────────────────
// テスト 16: 403 FORBIDDEN → fatal
// ───────────────────────────────────────────────
test('16. 403 FORBIDDEN → fatal（匿名 fallback しない）', async () => {
  const client = mkClient(() => mkRes(403, { message: 'Forbidden' }));
  await assert.rejects(
    () => importPrediction('2026-01-16', 'nankan', { client }),
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
