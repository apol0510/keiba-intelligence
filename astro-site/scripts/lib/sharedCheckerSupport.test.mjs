/**
 * sharedCheckerSupport.test.mjs
 *   node --test scripts/lib/sharedCheckerSupport.test.mjs
 *
 * 守りたい契約:
 *   - 一時エラー（rate limit / timeout / 5xx）は exit 2、運用者対応が要るものは exit 1
 *   - exit 2 も非ゼロ＝「成否だけ見る」既存呼び出し側の挙動は変わらない
 *   - 月索引は present / absent / unknown の 3 値。切り詰め時に absent と誤断定しない
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXIT_TRANSIENT,
  isTransientSharedFetchError,
  exitWithSharedFetchError,
  createMonthIndex,
} from './sharedCheckerSupport.mjs';
import { SharedFetchError, SHARED_FETCH_CODES } from './sharedFetch.mjs';

function mkErr(code) {
  return new SharedFetchError(code, `mock ${code}`);
}
function captureExit(error) {
  const written = [];
  let code = null;
  exitWithSharedFetchError(error, { write: (s) => written.push(s), exit: (c) => { code = c; } });
  return { code, out: written.join('') };
}

// ----- 一時エラーの分類 -----

test('1. RATE_LIMITED / TIMEOUT / SERVER_ERROR は一時エラー', () => {
  for (const c of [SHARED_FETCH_CODES.RATE_LIMITED, SHARED_FETCH_CODES.TIMEOUT, SHARED_FETCH_CODES.SERVER_ERROR]) {
    assert.equal(isTransientSharedFetchError(mkErr(c)), true, c);
  }
});

test('2. TOKEN_MISSING / AUTH_FAILED / FORBIDDEN は一時エラーではない', () => {
  for (const c of [SHARED_FETCH_CODES.TOKEN_MISSING, SHARED_FETCH_CODES.AUTH_FAILED, SHARED_FETCH_CODES.FORBIDDEN]) {
    assert.equal(isTransientSharedFetchError(mkErr(c)), false, c);
  }
});

test('3. SharedFetchError でない例外は一時エラー扱いしない', () => {
  assert.equal(isTransientSharedFetchError(new Error('boom')), false);
  assert.equal(isTransientSharedFetchError(undefined), false);
});

// ----- exit code -----

test('4. 一時エラーは exit 2 で TRANSIENT を明示する', () => {
  const { code, out } = captureExit(mkErr(SHARED_FETCH_CODES.RATE_LIMITED));
  assert.equal(code, EXIT_TRANSIENT);
  assert.equal(code, 2);
  assert.match(out, /TRANSIENT/);
});

test('5. token/認証エラーは従来どおり exit 1（TRANSIENT を出さない）', () => {
  const { code, out } = captureExit(mkErr(SHARED_FETCH_CODES.TOKEN_MISSING));
  assert.equal(code, 1);
  assert.doesNotMatch(out, /TRANSIENT/);
});

test('6. exit 2 も非ゼロ＝成否だけ見る既存呼び出し側は挙動不変', () => {
  assert.notEqual(EXIT_TRANSIENT, 0);
});

test('7. message のみ出力し、スタックや余計な情報を出さない', () => {
  const { out } = captureExit(mkErr(SHARED_FETCH_CODES.AUTH_FAILED));
  assert.equal(out, 'mock AUTH_FAILED\n');
});

// ----- 月索引 -----

function mkClient(listing) {
  const calls = [];
  return {
    calls,
    async listDirectory(dir) {
      calls.push(dir);
      return listing(dir);
    },
  };
}
function entries(names) {
  return names.map((n) => ({ name: n, path: `d/${n}`, sha: 's', size: 1, type: 'file' }));
}

test('8. 一覧にあれば present / なければ absent', async () => {
  const c = mkClient(() => entries(['2026-08-08-CHU.json']));
  const idx = createMonthIndex(c, 'main');
  assert.equal(await idx.status('jra/results/2026/08', '2026-08-08-CHU.json'), 'present');
  assert.equal(await idx.status('jra/results/2026/08', '2026-08-08-TOK.json'), 'absent');
});

test('9. 月ディレクトリが無い（404→null）なら absent', async () => {
  const c = mkClient(() => null);
  const idx = createMonthIndex(c, 'main');
  assert.equal(await idx.status('jra/results/2999/01', '2999-01-01-TOK.json'), 'absent');
});

test('10. 1000件に達したら unknown（absent と誤断定しない）', async () => {
  const c = mkClient(() => entries(Array.from({ length: 1000 }, (_, i) => `f${i}.json`)));
  const idx = createMonthIndex(c, 'main');
  assert.equal(await idx.status('jra/results/2026/08', '2026-08-08-TOK.json'), 'unknown');
});

test('11. ディレクトリごとに一覧は1回だけ（cache）', async () => {
  const c = mkClient(() => entries([]));
  const idx = createMonthIndex(c, 'main');
  for (const d of ['2026-08-01', '2026-08-02', '2026-08-03']) {
    await idx.status('jra/results/2026/08', `${d}-TOK.json`);
  }
  await idx.status('jra/racebook/2026/08', '2026-08-01-TOK.json');
  assert.deepEqual(c.calls, ['jra/results/2026/08', 'jra/racebook/2026/08']);
});

test('12. サブディレクトリ entry はファイル名として数えない', async () => {
  const c = mkClient(() => [{ name: 'sub', path: 'd/sub', type: 'dir' }]);
  const idx = createMonthIndex(c, 'main');
  assert.equal(await idx.status('jra/results/2026/08', 'sub'), 'absent');
});

test('13. 一覧の取得失敗はそのまま throw（握り潰さない）', async () => {
  const c = mkClient(() => { throw mkErr(SHARED_FETCH_CODES.RATE_LIMITED); });
  const idx = createMonthIndex(c, 'main');
  await assert.rejects(
    idx.status('jra/results/2026/08', 'x.json'),
    (e) => e.code === SHARED_FETCH_CODES.RATE_LIMITED,
  );
});
