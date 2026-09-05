/**
 * raceDayDate.test.mjs — 開催日の曜日が timezone に左右されないことを固定する
 *
 * ── 背景（2026-09-05）─────────────────────────────────────────────
 * `/free-prediction/*` の開催日が **2026-09-04 を「木」と表示**していた。正しくは「金」。
 *
 * 原因は `new Date(`${d}T00:00:00+09:00`).getDay()`。
 * `getDay()` は **実行環境のローカル時刻**で曜日を返すため、Netlify（UTC）では
 * JST 0:00 = 前日 15:00 UTC となり、**1 日前の曜日**になっていた。
 *
 * 🔴 ここで固定するのは 3 つ。
 *   1. 2026-09-04 は **金**（報告された実例）
 *   2. どの timezone で実行しても**同じ結果**（西半球・東半球の両端で確認）
 *   3. 実装に `getDay()` / `new Date(文字列)` を戻さない（静的ガード）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { weekdayOf, formatRaceDate } from './raceDayDate.js';

const here = dirname(fileURLToPath(import.meta.url));

test('🔴 2026-09-04 は「金」（報告された実例）', () => {
  assert.equal(weekdayOf('2026-09-04'), '金');
  assert.equal(formatRaceDate('2026-09-04'), '9月4日(金)');
});

test('前後の日も正しく数える', () => {
  assert.equal(weekdayOf('2026-09-03'), '木');
  assert.equal(weekdayOf('2026-09-05'), '土');
  assert.equal(weekdayOf('2026-09-06'), '日');
  // 月初・月末・うるう日
  assert.equal(formatRaceDate('2026-01-01'), '1月1日(木)');
  assert.equal(formatRaceDate('2026-12-31'), '12月31日(木)');
  assert.equal(weekdayOf('2024-02-29'), '木');
});

test('🔴 timezone を変えても結果が変わらない', () => {
  // 🔴 子プロセスで TZ を変えて実行する。Node は起動時に TZ を読むため、
  //    同一プロセス内で process.env.TZ を書き換えても反映されない。
  const script = `
    import { weekdayOf } from ${JSON.stringify(join(here, 'raceDayDate.js'))};
    process.stdout.write([
      weekdayOf('2026-09-04'),
      weekdayOf('2026-01-01'),
      weekdayOf('2026-12-31'),
    ].join(','));
  `;
  const run = (tz) => execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  });

  const expected = '金,木,木';
  for (const tz of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Etc/GMT+12']) {
    assert.equal(run(tz), expected, `🔴 TZ=${tz} で曜日が変わっている`);
  }
});

test('判定できない入力は空文字（日付は失わない）', () => {
  assert.equal(weekdayOf(null), '');
  assert.equal(weekdayOf(''), '');
  assert.equal(weekdayOf('2026-9-4'), '');
  assert.equal(weekdayOf('2026-02-30'), '', '存在しない日付を繰り上げて曜日を出している');
  // formatRaceDate は入力をそのまま返す（表示から日付を消さない）
  assert.equal(formatRaceDate('unknown'), 'unknown');
  assert.equal(formatRaceDate(null), '');
});

test('🔴 実装に getDay() / new Date(文字列) を戻さない', () => {
  const src = readFileSync(join(here, 'raceDayDate.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(/\.getDay\(\)/.test(code), false,
    '🔴 getDay() は実行環境のローカル時刻で曜日を返す（UTC ビルドで 1 日ずれる）');
  assert.match(code, /Date\.UTC\(/);
  assert.match(code, /getUTCDay\(\)/);
  // 文字列から Date を作らない（`new Date('2026-09-04')` も UTC 解釈でずれる）
  assert.equal(/new Date\(\s*[`'"]/.test(code), false,
    '🔴 文字列から Date を作っている');

  // 呼び出し側にも残っていないこと
  const board = readFileSync(join(here, '..', '..', 'components', 'newspaper', 'RaceDayBoard.astro'), 'utf8');
  const boardCode = board.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(/\.getDay\(\)/.test(boardCode), false,
    '🔴 RaceDayBoard に getDay() が戻っている');
  assert.match(board, /formatRaceDate/);
});
