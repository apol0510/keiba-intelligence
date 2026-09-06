/**
 * raceDayContract.test.mjs — venue / date / raceNumber の取り違えを fail-closed で固定する
 *
 * 実行: node --test src/lib/prediction/raceDayContract.test.mjs （astro-site 直下から）
 *
 * ── 背景（2026-08-29）─────────────────────────────────────────────
 * 「11R タブを選んでいるのに 1R が表示される」という報告を受けて調査した。
 * 実際の原因は表示側（長大ページ + `scroll-behavior: smooth` でアンカージャンプが不発）で、
 * データの取り違えではなかった。
 *
 * ただし **取り違えが起きたら重大**（別レースの予想をそのレースのものとして見せる）なので、
 * 以下を恒久的に固定する:
 *
 *   1. 契約: venue / date / raceNumber が揃い、一致していることを検証できる
 *   2. fail-closed: **判定できない（欠損）ものは違反として扱い、描画対象から外す**
 *   3. 実データ: 現在取り込まれている南関・JRA が契約を 1 件の違反もなく満たす
 *   4. 表示配線: タブとパネルが同一の key から作られ、スクロールに依存しない
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  checkRaceDay, isRaceVerified, verifiedRaceDay, RACE_DAY_VIOLATION,
} from './raceDayContract.js';
import { loadNankanRaceDay, loadJraRaceDay, racesOf } from './loadRaceDay.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf-8');

const DATE = '2026-08-18';

function mkRace(rn, over = {}) {
  return {
    raceInfo: { date: DATE, venue: '川崎', raceNumber: rn, raceName: `${rn}R`, ...over },
    horses: [{ horseNumber: 1, horseName: 'A' }],
  };
}

function mkDay(races, over = {}) {
  return {
    category: 'nankan',
    date: DATE,
    venues: [{ venueName: '川崎', data: { predictions: races } }],
    error: null,
    ...over,
  };
}

const codesOf = (r) => r.violations.map((v) => v.code);

/* ---------- 1. 正常系 ---------- */

test('整合しているデータは違反ゼロで通る', () => {
  const r = checkRaceDay(mkDay([mkRace(1), mkRace(2), mkRace(11)]));
  assert.equal(r.ok, true, JSON.stringify(r.violations));
  assert.deepEqual(r.violations, []);
});

/* ---------- 2. 取り違えを検出する ---------- */

test('raceInfo.venue が会場名と違えば違反', () => {
  const r = checkRaceDay(mkDay([mkRace(11, { venue: '大井' })]));
  assert.equal(r.ok, false);
  assert.ok(codesOf(r).includes(RACE_DAY_VIOLATION.VENUE_MISMATCH));
});

test('raceInfo.date が開催日と違えば違反', () => {
  const r = checkRaceDay(mkDay([mkRace(11, { date: '2026-08-17' })]));
  assert.equal(r.ok, false);
  assert.ok(codesOf(r).includes(RACE_DAY_VIOLATION.DATE_MISMATCH));
});

test('raceNumber が重複していれば違反', () => {
  const r = checkRaceDay(mkDay([mkRace(11), mkRace(11)]));
  assert.equal(r.ok, false);
  assert.ok(codesOf(r).includes(RACE_DAY_VIOLATION.RACE_NUMBER_DUPLICATE));
});

test('raceNumber が整数でなければ違反', () => {
  for (const bad of ['11', 11.5, 0, -1, null, undefined, NaN]) {
    const r = checkRaceDay(mkDay([mkRace(bad)]));
    assert.equal(r.ok, false, `raceNumber=${String(bad)} が通ってしまう`);
    assert.ok(codesOf(r).includes(RACE_DAY_VIOLATION.RACE_NUMBER_INVALID));
  }
});

test('会場名の重複を検出する', () => {
  const day = mkDay([mkRace(1)]);
  day.venues.push({ venueName: '川崎', data: { predictions: [mkRace(1)] } });
  const r = checkRaceDay(day);
  assert.ok(codesOf(r).includes(RACE_DAY_VIOLATION.VENUE_NAME_DUPLICATE));
});

test('開催日が不正なら違反', () => {
  for (const bad of [null, '', '2026/08/18', '20260818']) {
    const r = checkRaceDay(mkDay([mkRace(1)], { date: bad }));
    assert.ok(codesOf(r).includes(RACE_DAY_VIOLATION.DATE_INVALID), `date=${String(bad)}`);
  }
});

/* ---------- 3. fail-closed（欠損も違反） ---------- */

test('raceInfo.venue が欠損していても違反にする（推測で通さない）', () => {
  const race = mkRace(11);
  delete race.raceInfo.venue;
  const r = checkRaceDay(mkDay([race]));
  assert.equal(r.ok, false);
  assert.ok(codesOf(r).includes(RACE_DAY_VIOLATION.VENUE_MISMATCH));
});

test('raceInfo.date が欠損していても違反にする', () => {
  const race = mkRace(11);
  delete race.raceInfo.date;
  const r = checkRaceDay(mkDay([race]));
  assert.equal(r.ok, false);
  assert.ok(codesOf(r).includes(RACE_DAY_VIOLATION.DATE_MISMATCH));
});

test('raceInfo ごと欠損していても違反にする', () => {
  const r = checkRaceDay(mkDay([{ horses: [] }]));
  assert.equal(r.ok, false);
  assert.ok(codesOf(r).includes(RACE_DAY_VIOLATION.RACE_INFO_MISSING));
});

test('horses が配列でなければ違反', () => {
  const race = mkRace(11);
  race.horses = null;
  const r = checkRaceDay(mkDay([race]));
  assert.ok(codesOf(r).includes(RACE_DAY_VIOLATION.HORSES_INVALID));
});

test('isRaceVerified: 一致しないレースは通さない', () => {
  const ok = { venueName: '川崎', date: DATE };
  assert.equal(isRaceVerified(mkRace(11), ok), true);
  assert.equal(isRaceVerified(mkRace(11, { venue: '大井' }), ok), false);
  assert.equal(isRaceVerified(mkRace(11, { date: '2026-08-17' }), ok), false);
  assert.equal(isRaceVerified(mkRace(11), { venueName: '大井', date: DATE }), false);
  assert.equal(isRaceVerified(null, ok), false);
});

/* ---------- 4. 検証を通らないレースは描画対象から外す ---------- */

test('verifiedRaceDay: 違反レースを取り除き、正しいレースは残す', () => {
  const day = mkDay([mkRace(1), mkRace(11, { venue: '大井' }), mkRace(12)]);
  const { day: verified, dropped } = verifiedRaceDay(day);
  const kept = racesOf(verified.venues[0]).map((r) => r.raceInfo.raceNumber);
  assert.deepEqual(kept, [1, 12]);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].raceNumber, 11);
});

test('verifiedRaceDay: 元データを書き換えない', () => {
  const day = mkDay([mkRace(1), mkRace(11, { venue: '大井' })]);
  const before = racesOf(day.venues[0]).length;
  verifiedRaceDay(day);
  assert.equal(racesOf(day.venues[0]).length, before, '入力が破壊された');
});

test('verifiedRaceDay: すべて正しいときは会場オブジェクトを作り替えない', () => {
  const day = mkDay([mkRace(1), mkRace(2)]);
  const { day: verified, dropped } = verifiedRaceDay(day);
  assert.equal(dropped.length, 0);
  assert.equal(verified.venues[0], day.venues[0], '不要な作り替えが起きている');
});

/* ---------- 5. 実データ ---------- */

test('取り込み済みの南関データが契約を満たす', () => {
  const day = loadNankanRaceDay(ROOT);
  if (day.error && !day.venues.length) return; // データが無い環境ではスキップ
  const r = checkRaceDay(day);
  assert.deepEqual(r.violations.slice(0, 5), [], `南関データに違反: ${r.violations.length}件`);
});

test('取り込み済みの JRA データが契約を満たす（複数会場でも混ざらない）', () => {
  const day = loadJraRaceDay(ROOT);
  if (day.error && !day.venues.length) return;
  const r = checkRaceDay(day);
  assert.deepEqual(r.violations.slice(0, 5), [], `JRAデータに違反: ${r.violations.length}件`);

  // 会場ごとに raceNumber が 1..N で揃っていること
  for (const venue of day.venues) {
    const nums = racesOf(venue).map((x) => x.raceInfo.raceNumber);
    assert.deepEqual(
      [...nums].sort((a, b) => a - b),
      nums.slice().sort((a, b) => a - b),
      `${venue.venueName}: raceNumber の並びが壊れている`,
    );
    assert.equal(new Set(nums).size, nums.length, `${venue.venueName}: raceNumber が重複`);
  }
});

/* ---------- 6. 表示配線（タブとパネルの取り違え防止） ---------- */

test('RaceDayBoard: タブとパネルを同一の key から作っている', () => {
  const src = read('src/components/newspaper/RaceDayBoard.astro');
  // key は venueIndex と rn からのみ作る
  assert.match(src, /key:\s*`\$\{venueIndex\}-\$\{rn\}`/, 'key の生成が venueIndex/rn 由来でない');
  // タブ・パネルの双方が同じ e.key を使う
  assert.match(src, /data-race-tab=\{e\.key\}/, 'タブが e.key を使っていない');
  assert.match(src, /data-race-panel=\{e\.key\}/, 'パネルが e.key を使っていない');
  assert.match(src, /id=\{`race-\$\{e\.key\}`\}/, 'パネル id が e.key 由来でない');
  assert.match(src, /aria-controls=\{`race-\$\{e\.key\}`\}/, 'aria-controls が e.key 由来でない');
});

test('RaceDayBoard: レース切替がスクロールに依存しない（不具合の再発防止）', () => {
  const src = read('src/components/newspaper/RaceDayBoard.astro');
  assert.ok(!/scrollIntoView\s*\(/.test(src), 'scrollIntoView に依存している');
  assert.ok(!/href=\{`#race-/.test(src), 'アンカージャンプに戻っている');
  // 選択したレースだけを表示する実装であること
  assert.match(src, /data-race-panel/, 'レースパネルの制御が無い');
  assert.match(src, /function selectRace\(/, 'レース選択の実装が無い');
});

test('RaceEntryTable: 列見出しが sticky として機能する条件を壊していない', () => {
  // 2026-08-29: 祖先の overflow で sticky が無効化され、列見出しがスクロールで
  //   完全に消えていた（実測 theadTop=-365px）。列名が読めないと
  //   「印」「AI指数」等の内容が判別できないため、条件を固定する。
  const src = read('src/components/newspaper/RaceEntryTable.astro');

  // .ret に overflow を付けない（sticky の基準が変わる）
  const retBlock = src.slice(src.indexOf('\n  .ret {'), src.indexOf('.ret-table {'));
  assert.ok(!/overflow\s*:/.test(retBlock), '.ret に overflow が復活している（sticky が壊れる）');

  // 見出しはサイトヘッダーの下へ固定する
  assert.match(src, /\.ret-table thead th \{[\s\S]*?position:\s*sticky/, '列見出しが sticky でない');
  assert.match(src, /top:\s*var\(--nav-height/, '列見出しがヘッダーの高さを考慮していない');
  assert.ok(!/\.ret-table thead th \{[\s\S]*?top:\s*0;/.test(src), '見出しが top:0 でヘッダーに隠れる');
});

test('BaseLayout: ナビの実寸を --nav-height へ反映している', () => {
  const src = read('src/layouts/BaseLayout.astro');
  assert.match(src, /--nav-height/, 'ナビ高さの反映が無い');
  assert.match(src, /offsetHeight/, '実寸を測っていない（固定値だと崩れる）');
  const css = read('src/styles/global.scss');
  assert.match(css, /--nav-height:/, 'トークンの既定値が無い');
});

/* ------------------------------------------------------------------
   有料表示ではリード文（rdb-lead）を描画しない（2026-09-06）

   「全レースの馬柱・過去走・AI短評・展開予想を無料で公開しています。」は
   有料会員に対して意味を成さないため、**要素ごと出さない**。
   🔴 代替文言も出さない。無料会員・guest の表示は現状維持。

   🔴 `.astro` は node:test から import できない（ERR_UNKNOWN_FILE_EXTENSION）ため、
      ソースの構造を静的に固定する。
   ------------------------------------------------------------------ */

test('🔴 有料表示ではリード文を描画しない（要素ごと出さない）', () => {
  const src = read('src/components/newspaper/RaceDayBoard.astro');

  // リード文は条件付きレンダリングの中にある
  assert.match(
    src,
    /\{!isPaidView && \([\s\S]{0,200}?class="rdb-lead"/,
    '🔴 リード文が無条件に描画されている（有料会員にも「無料で公開」と出る）',
  );

  // 🔴 代替文言を出さない（三項演算子で else 側に何かを描画していない）
  const lead = src.slice(src.indexOf('isPaidView &&'), src.indexOf('rdb-dropped'));
  assert.equal(/:\s*\(/.test(lead), false, '🔴 有料表示に代替文言を出している');
  assert.equal(lead.includes('rdb-lead-paid'), false, '🔴 有料用のリード文を足している');

  // 無料 / guest 向けの文面は変えない
  assert.match(src, /全レースの馬柱・過去走・AI短評・展開予想を<b>無料で公開<\/b>しています。/,
    '🔴 無料・guest 向けの文面が変わっている');
});

test('🔴 有料判定は既存の view.showBetting を使う（新しい判定を作らない）', () => {
  const src = read('src/components/newspaper/RaceDayBoard.astro');

  assert.match(src, /const isPaidView = !!view\?\.showBetting;/,
    '🔴 既存の entitlement（view.showBetting）以外で有料を判定している');

  // 🔴 tier 名を直接見比べる判定を持ち込まない（entitlement の一本化を崩さない）
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const bad of ["=== 'premium'", "=== 'light'", "=== 'pro'", 'includes(\'premium\')']) {
    assert.equal(code.includes(bad), false, `🔴 tier を直接比較している（${bad}）`);
  }

  // 🔴 印 / AI指数 / 買い目の出し分けには手を入れていない。
  //    Props の型宣言に showMarks があるのは従来どおり。ここで見るのは **使用**。
  assert.equal(/view\s*[?]?\.\s*showMarks/.test(code), false,
    '🔴 RaceDayBoard が showMarks を独自に扱い始めている（出し分けは下位に委ねる）');
  // 買い目も同様に、この階層で分岐させない（有料判定に使う showBetting は除く）
  assert.equal(/view\s*[?]?\.\s*showBetting/g.test(code)
    && (code.match(/view\s*[?]?\.\s*showBetting/g) || []).length > 1, false,
    '🔴 showBetting を isPaidView 以外の場所でも見ている');
});

test('🔴 中央・南関の 4 経路すべてが同じ RaceDayBoard に view を渡す', () => {
  // 共有コンポーネントなので、どれか 1 経路だけ直しても意味が無い
  const pages = [
    'src/pages/free-prediction/nankan/index.astro',
    'src/pages/free-prediction/jra/index.astro',
    'src/pages/prediction/nankan/index.astro',
    'src/pages/prediction/jra/index.astro',
  ];
  for (const page of pages) {
    const src = read(page);
    assert.match(src, /import RaceDayBoard from/, `${page}: RaceDayBoard を使っていない`);
    assert.match(src, /<RaceDayBoard[^>]*view=\{view\}/,
      `${page}: view を渡していない（有料判定が効かない）`);
  }
});

test('RaceDayBoard: 描画前に契約検証を通している（fail-closed）', () => {
  const src = read('src/components/newspaper/RaceDayBoard.astro');
  assert.match(src, /verifiedRaceDay\(/, '契約検証を通していない');
  assert.match(src, /const \{ day, dropped \} = verifiedRaceDay\(rawDay\)/, '検証済みデータを描画に使っていない');
});
