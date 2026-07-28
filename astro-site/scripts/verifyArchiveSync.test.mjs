/**
 * verifyArchiveSync.test.mjs — verifyArchiveSync の getLatestResultDate 部分の単体テスト
 * （node:test / mock client / 実 GitHub 通信なし / ファイル読取なし）
 *   node --test scripts/verifyArchiveSync.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getLatestResultDate,
  getArchiveDates,
  maxDate,
  collectSharedResultDates,
  evaluateArchiveSync,
} from './verifyArchiveSync.js';
import { createSharedClient, SHARED_FETCH_CODES } from './lib/sharedFetch.mjs';

const SECRET = 'ghp_MOCK_TOKEN_verifyArchiveSync_test';
const ENV_OK = { KEIBA_DATA_SHARED_TOKEN: SECRET };

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

function noopResolve() {}

test('1. token 未設定は TOKEN_MISSING fatal（fetch 未実行）', async () => {
  const fetchImpl = mkFetch(() => mkRes(200, {}));
  const client = createSharedClient({ fetchImpl, env: {}, sleepImpl: noSleep });
  await assert.rejects(
    getLatestResultDate({ env: {}, client }),
    (e) => e.code === SHARED_FETCH_CODES.TOKEN_MISSING,
  );
  assert.equal(fetchImpl.calls.length, 0);
});

test('2. 統合ファイルが存在する日付を返す（source=unified）', async () => {
  // 今日以外全部 404、今日の統合ファイルのみ 200
  const target = '2026-05-10';
  const fetchImpl = mkFetch((url) => {
    if (url.includes(`${target}/nankan/results`)) return mkRes(200, { races: Array(20).fill({ id: 'r' }), venue: '大井' });
    // URL は "nankan/results/YYYY/MM/DATE.json" 形式なのでこちらで判定
    if (url.includes(target.replace(/-/g, '/'))) return mkRes(200, { races: Array(20).fill({ id: 'r' }), venue: '大井' });
    if (url.includes(target.slice(5).replace('-', '/') + '/' + target)) return mkRes(200, { races: Array(20).fill({ id: 'r' }), venue: '大井' });
    return mkRes(404, 'Not Found');
  });
  // getLatestResultDate は JST 今日から遡るため、today を差し込むのが難しい
  // ここでは最初のリクエスト（今日）が hit するよう統合ファイルを常に 200 で返すクライアントを使う
  const client = createSharedClient({
    fetchImpl: mkFetch(() => mkRes(200, { races: Array(20).fill({ id: 'r' }), venue: '大井' })),
    env: ENV_OK,
    sleepImpl: noSleep,
  });
  const result = await getLatestResultDate({ client, resolveToken: noopResolve });
  assert.equal(result.source, 'unified');
  assert.ok(typeof result.date === 'string');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(result.date));
});

test('3. 統合 404 → 会場別 (totalRaces>=8) で source=venue-specific', async () => {
  // 統合は常に 404、per-venue の OOI は 200
  // URL は "…-OOI.json?ref=main" 形式なので includes を使う（正規表現 $ は末尾一致せず）
  const fetchImpl = mkFetch((url) => {
    if (url.includes('-OOI.json')) return mkRes(200, { races: Array(12).fill({ id: 'r' }) });
    return mkRes(404, 'Not Found'); // 統合 + その他の会場
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  const result = await getLatestResultDate({ client, resolveToken: noopResolve });
  assert.equal(result.source, 'venue-specific');
  assert.ok(result.races >= 8);
});

test('4. 全 30 日 404 → "過去30日間に結果データが見つかりませんでした" throw', async () => {
  const client = mkClient(() => mkRes(404, 'Not Found'));
  await assert.rejects(
    getLatestResultDate({ client, resolveToken: noopResolve }),
    (e) => e.message.includes('過去30日間に結果データが見つかりませんでした'),
  );
});

test('5. 401 は AUTH_FAILED fatal（即座に throw）', async () => {
  const client = mkClient(() => mkRes(401, 'Bad credentials'));
  await assert.rejects(
    getLatestResultDate({ client, resolveToken: noopResolve }),
    (e) => e.code === SHARED_FETCH_CODES.AUTH_FAILED,
  );
});

test('6. 5xx は SERVER_ERROR fatal', async () => {
  const client = mkClient(() => mkRes(500, 'error'));
  await assert.rejects(
    getLatestResultDate({ client, resolveToken: noopResolve }),
    (e) => e.code === SHARED_FETCH_CODES.SERVER_ERROR,
  );
});

test('7. 429 は RATE_LIMITED fatal', async () => {
  const fetchImpl = mkFetch(() => mkRes(429, 'too many'));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep, retries: 2 });
  await assert.rejects(
    getLatestResultDate({ client, resolveToken: noopResolve }),
    (e) => e.code === SHARED_FETCH_CODES.RATE_LIMITED,
  );
});

test('8. per-venue totalRaces < 8 は hit とみなさない（8 未満はスキップ）', async () => {
  // 統合は常に 404、per-venue は 5 races のみ（< 8 threshold）
  const fetchImpl = mkFetch((url) => {
    if (url.match(/-OOI\.json$/)) return mkRes(200, { races: Array(5).fill({ id: 'r' }) });
    return mkRes(404, 'Not Found');
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  // 全 30 日 5 races（< 8）→ どの日も hit しない → throw
  await assert.rejects(
    getLatestResultDate({ client, resolveToken: noopResolve }),
    (e) => e.message.includes('過去30日間に結果データが見つかりませんでした'),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 2026-07-28 追加: 過去日 back-fill の誤 FAIL 恒久修正
//
// 事故: 2026-07-27 が既に archive にある状態で 2026-07-24 OOI を後追い import したところ、
//       archive[0] が 07-24 になり「最新アーカイブ=07-24 / 最新結果=07-27 → 3日ズレ」と
//       誤判定して FAIL。commit 前のゲートだったため取り込んだ 07-24 が破棄された。
//       さらに非開催日 07-25 / 07-26 まで「不足」と誤報していた。
// ─────────────────────────────────────────────────────────────────────────────

test('9. getArchiveDates: 配列の並び順に依存せず date 値から最新日を決める', () => {
  // back-fill 直後を再現: 先頭が過去日（07-24）、より新しい 07-27 が後ろにある
  const archive = [
    { date: '2026-07-24', venue: '大井' },
    { date: '2026-07-27', venue: '川崎' },
    { date: '2026-07-23', venue: '大井' },
  ];
  const dates = getArchiveDates(archive);
  assert.equal(maxDate(dates), '2026-07-27'); // ← archive[0] なら 07-24 になり誤判定していた
  assert.equal(dates.size, 3);
});

test('10. getArchiveDates: 空配列 / date 不在は fail-closed（throw）', () => {
  assert.throws(() => getArchiveDates([]), /空/);
  assert.throws(() => getArchiveDates([{ venue: '大井' }]), /有効な date/);
  assert.throws(() => getArchiveDates(null), /配列ではありません/);
});

test('11. 今回ケース: 07-27 既存 + 07-24 後追い import + 07-25/26 は shared に無し → PASS', () => {
  const sharedDates = new Set(['2026-07-22', '2026-07-23', '2026-07-24', '2026-07-27']);
  // import 後の archive（07-24 が先頭に挿入された状態）
  const archiveDates = getArchiveDates([
    { date: '2026-07-24', venue: '大井' },
    { date: '2026-07-27', venue: '川崎' },
    { date: '2026-07-23', venue: '大井' },
    { date: '2026-07-22', venue: '大井' },
  ]);

  const verdict = evaluateArchiveSync({ sharedDates, archiveDates });

  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.missing, []);
  assert.equal(verdict.latestArchiveDate, '2026-07-27');
  // 非開催日は shared に results が無いので missing に現れない
  assert.equal(verdict.missing.includes('2026-07-25'), false);
  assert.equal(verdict.missing.includes('2026-07-26'), false);
});

test('12. negative: shared にあるのに archive に無い日は FAIL として検出する', () => {
  const sharedDates = new Set(['2026-07-23', '2026-07-24', '2026-07-27']);
  const archiveDates = new Set(['2026-07-23', '2026-07-27']); // 07-24 が欠落（事故当時の実状態）

  const verdict = evaluateArchiveSync({ sharedDates, archiveDates });

  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.missing, ['2026-07-24']);
});

test('13. negative: 最新日が archive に無い場合も FAIL（最大値比較に退化していない）', () => {
  const sharedDates = new Set(['2026-07-23', '2026-07-27']);
  const archiveDates = new Set(['2026-07-23']);
  const verdict = evaluateArchiveSync({ sharedDates, archiveDates });
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.missing, ['2026-07-27']);
});

test('14. fail-closed: shared 側が 0 件なら PASS にせず throw', () => {
  assert.throws(
    () => evaluateArchiveSync({ sharedDates: new Set(), archiveDates: new Set(['2026-07-27']) }),
    /1 件も見つかりませんでした/,
  );
});

test('15. collectSharedResultDates: shared のディレクトリ実体だけを根拠にする', async () => {
  const now = new Date('2026-07-28T12:00:00+09:00');
  const listing = [
    { name: '2026-07-24-OOI.json', type: 'file' },
    { name: '2026-07-27-KAW.json', type: 'file' },
    { name: '2026-07-23.json', type: 'file' },      // 統合ファイル形式も拾う
    { name: '2026-07-25-OOI.txt', type: 'file' },   // .json 以外は拾わない
    { name: 'README.md', type: 'file' },
    { name: 'archive', type: 'dir' },               // ディレクトリは拾わない
    { name: '2026-05-01-OOI.json', type: 'file' },  // 期間外は拾わない
  ];
  const fetchImpl = mkFetch((url) => {
    if (url.includes('/nankan/results/2026/07')) return mkRes(200, listing);
    return mkRes(404, 'Not Found'); // 2026/06 は存在しない扱い
  });
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });

  const dates = await collectSharedResultDates({ client, resolveToken: noopResolve, now, days: 30 });

  assert.deepEqual([...dates].sort(), ['2026-07-23', '2026-07-24', '2026-07-27']);
  // 非開催日は列挙されない（暦日補完をしていないことの固定）
  assert.equal(dates.has('2026-07-25'), false);
  assert.equal(dates.has('2026-07-26'), false);
});

test('16. collectSharedResultDates: 401 は fail-closed（空集合で PASS させない）', async () => {
  const fetchImpl = mkFetch(() => mkRes(401, 'unauthorized'));
  const client = createSharedClient({ fetchImpl, env: ENV_OK, sleepImpl: noSleep });
  await assert.rejects(
    collectSharedResultDates({ client, resolveToken: noopResolve, now: new Date('2026-07-28T12:00:00+09:00') }),
    (e) => e.code === SHARED_FETCH_CODES.AUTH_FAILED,
  );
});

test('17. collectSharedResultDates: token 未設定は fetch する前に TOKEN_MISSING', async () => {
  const fetchImpl = mkFetch(() => mkRes(200, []));
  const client = createSharedClient({ fetchImpl, env: {}, sleepImpl: noSleep });
  await assert.rejects(
    collectSharedResultDates({ env: {}, client }),
    (e) => e.code === SHARED_FETCH_CODES.TOKEN_MISSING,
  );
  assert.equal(fetchImpl.calls.length, 0);
});
