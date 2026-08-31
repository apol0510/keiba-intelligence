/**
 * computerIndexContract.test.mjs
 *
 * 契約外 computerIndex を「値なし」として fail-closed に扱うことの回帰テスト。
 *
 * 守る不変条件:
 *   1. 1/4/8 等の偽値を総合pt へ加算しない（表示ゲートが false になる）
 *   2. 偽値を role 判定（rawScore）に使わない
 *   3. 10〜99 の正しい値は従来どおり使う（既存挙動を壊さない）
 *   4. null を 0 / 10 / 50 等の固定値で補完しない
 *
 * 実行: node --test src/utils/computerIndexContract.test.mjs
 *       (= npm run test:computer-index)
 */
import test from 'node:test';
import assert from 'node:assert';
import {
  toComputerIndex,
  toComputerIndexString,
  isValidComputerIndex,
  COMPUTER_INDEX_MIN,
  COMPUTER_INDEX_MAX,
} from './computerIndexContract.js';
import { normalizeAndAdjust } from './normalizePrediction.js';

/** 総合pt バッジの表示条件と表示値（3画面で共通の式） */
const badgeShown = (ci) => toComputerIndex(ci) != null;
const badgeValue = (ci) => Math.min(100, toComputerIndex(ci) + 10);

test('契約の境界', () => {
  assert.equal(COMPUTER_INDEX_MIN, 10);
  assert.equal(COMPUTER_INDEX_MAX, 99);
  assert.equal(toComputerIndex(10), 10);
  assert.equal(toComputerIndex(99), 99);
  assert.equal(toComputerIndex(9), null);
  assert.equal(toComputerIndex(100), null);
});

test('不変条件1: 偽値(1〜9)を総合pt へ加算しない', () => {
  // shared racebook で実観測された偽値。旧実装では 11/14/18 と表示されていた。
  for (const ci of [1, 2, 4, 6, 8, '1', '4', '8']) {
    assert.equal(badgeShown(ci), false, `computerIndex=${JSON.stringify(ci)} で総合pt が表示されている`);
  }
});

test('不変条件2: 偽値を role 判定(rawScore)に使わない', () => {
  const input = {
    date: '2026-07-18',
    venue: '函館',
    races: [{
      raceNumber: 1,
      horses: [
        { number: 1, name: 'ウマA', computerIndex: '8', totalScore: 0, assignment: '無' },
        { number: 2, name: 'ウマB', computerIndex: '4', totalScore: 0, assignment: '無' },
      ],
    }],
  };
  const out = normalizeAndAdjust(input);
  for (const h of out.races[0].horses) {
    assert.equal(h.rawScore, 0, `偽値が rawScore に入っている: ${h.rawScore}`);
  }
});

test('不変条件3: 10〜99 の正しい値は従来どおり使う', () => {
  // 表示
  assert.equal(badgeShown('78'), true);
  assert.equal(badgeValue('78'), 88, '総合pt = ci + 10 の既存表示式が変わっている');
  assert.equal(badgeValue('95'), 100, '上限 100 のクリップが効いていない');
  // role 判定（COMPI_MIN=45 以上は rawScore に採用される既存挙動）
  const input = {
    date: '2026-07-18',
    venue: '函館',
    races: [{
      raceNumber: 1,
      horses: [
        { number: 1, name: 'ウマA', computerIndex: '78', totalScore: 0, assignment: '無' },
        { number: 2, name: 'ウマB', computerIndex: '44', totalScore: 0, assignment: '無' },
      ],
    }],
  };
  const out = normalizeAndAdjust(input);
  const byNum = Object.fromEntries(out.races[0].horses.map(h => [h.number, h]));
  assert.equal(byNum[1].rawScore, 78, '有効な高コンピ値が rawScore に採用されていない');
  assert.equal(byNum[2].rawScore, 0, 'COMPI_MIN=45 未満の既存挙動が変わっている');
});

test('不変条件4: null を固定値で補完しない', () => {
  for (const ci of [null, undefined, '']) {
    assert.equal(toComputerIndex(ci), null, `${JSON.stringify(ci)} が補完されている`);
    assert.equal(badgeShown(ci), false);
  }
  const input = {
    date: '2026-07-18',
    venue: '函館',
    races: [{
      raceNumber: 1,
      horses: [{ number: 1, name: 'ウマA', computerIndex: null, totalScore: 0, assignment: '無' }],
    }],
  };
  const out = normalizeAndAdjust(input);
  const h = out.races[0].horses[0];
  assert.equal(h.rawScore, 0);
  assert.notEqual(h.rawScore, 10, '固定値 10 で補完している');
  assert.notEqual(h.rawScore, 50, '固定値 50 で補完している');
});

test('偽値と null は同じ扱い（偽値だけ優遇しない）', () => {
  assert.equal(toComputerIndex('4'), toComputerIndex(null));
  assert.equal(badgeShown('4'), badgeShown(null));
});

test('非整数・非数値・範囲外を拒否する', () => {
  for (const ci of ['55.5', 'abc', '55点', true, {}, [], NaN, Infinity, -50, 100, 999]) {
    assert.equal(isValidComputerIndex(ci), false, `${JSON.stringify(ci)} を受理している`);
  }
});

test('全角数字は既存の表記ゆれとして受理する', () => {
  assert.equal(toComputerIndex('７８'), 78);
});

test('取込境界は保存形式（文字列）を維持する — 既存データとの型不一致を作らない', () => {
  // 取り込み結果 JSON の computerIndex は従来から文字列。契約ゲートで number へ
  // 変わると既存データと型が食い違うため、文字列版を使うことを固定する。
  assert.strictEqual(toComputerIndexString('78'), '78');
  assert.strictEqual(toComputerIndexString(78), '78');
  assert.strictEqual(typeof toComputerIndexString(78), 'string');
  assert.strictEqual(toComputerIndexString('4'), null, '偽値は null');
  assert.strictEqual(toComputerIndexString(null), null);
  assert.strictEqual(toComputerIndexString(''), null);
});

test('取込スクリプトは文字列版を使っている（number 化させない）', () => {
  const SCRIPTS = join(SRC, '..', 'scripts');
  for (const f of ['importPredictionJra.js', 'importPrediction.js']) {
    const s = readFileSync(join(SCRIPTS, f), 'utf8');
    assert.ok(s.includes('toComputerIndexString('), `${f}: 文字列版を使っていない`);
    assert.ok(!/computerIndex:\s*toComputerIndex\(/.test(s), `${f}: 数値版を代入に使っている（型が変わる）`);
  }
});

// ── 契約が「3画面すべて + role 判定経路」に適用されていることを静的に固定する ──
// 新しい画面が契約を通さずに computerIndex を直接表示すると、偽値がまた出る。
import { readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(astro|js|ts|jsx|tsx)$/.test(e) && !/\.test\./.test(e)) out.push(p);
  }
  return out;
}

test('computerIndex を読む本番コードは必ず契約を通す', () => {
  const offenders = [];
  for (const f of walk(SRC)) {
    if (f.endsWith('computerIndexContract.js')) continue;
    const s = readFileSync(f, 'utf8');
    if (!s.includes('computerIndex')) continue;
    // computerIndex を Number()/parseInt() で直接数値化している箇所を禁止する
    const raw = s.match(/(?:Number|parseInt)\(\s*[^)]*\bcomputerIndex\b/g) || [];
    if (raw.length > 0) offenders.push(`${f.replace(SRC, 'src')}: ${raw.length}件`);
  }
  assert.deepEqual(offenders, [],
    `computerIndex を契約を通さず直接数値化している箇所がある:\n  ${offenders.join('\n  ')}`);
});

// 2026-08-28: 総合pt バッジの描画は 3 画面の直書きから共通コンポーネント
//   `components/newspaper/RaceEntryTable.astro` へ集約された（docs/RENEWAL_2026_08.md）。
//   ガードの意図（バッジが契約ゲートを通ること・対象画面から消えないこと）は変えず、
//   「描画点で契約を通す」＋「対象画面が描画点へ到達する」の 2 段で固定する。
test('コンピ指数（表示名: 基礎指数）の描画点が契約ゲートを使っている', () => {
  // 2026-08-29: 表示名を「総合pt」→「基礎指数」に変更した。
  //   旧 JRA 画面では computerIndex を「総合pt」と表示していたが、
  //   新 UI では KI 自身のスコアを「AI指数」と呼ぶため、名称の衝突を避けて改称した。
  //   「コンピ」は裏側の呼称であり、画面には出さない。
  const rel = 'components/newspaper/RaceEntryTable.astro';
  const s = readFileSync(join(SRC, rel), 'utf8');
  assert.ok(s.includes('基礎指数'), `${rel}: 基礎指数の列が見つからない（対象がずれている）`);
  assert.ok(s.includes('toComputerIndex('), `${rel}: 契約ゲート toComputerIndex を通していない`);
  assert.ok(!/computerIndex\s*!=\s*null\s*&&\s*[^&]*computerIndex\s*!==\s*''/.test(s),
    `${rel}: 旧 null/空だけのガードが残っている（偽値がすり抜ける）`);
});

test('JRA 予想3画面が総合pt バッジの描画点へ到達している', () => {
  const pages = [
    'pages/prediction/jra/index.astro',
    'pages/free-prediction/jra/[date].astro',
    'pages/free-prediction/jra/index.astro',
  ];
  for (const rel of pages) {
    const s = readFileSync(join(SRC, rel), 'utf8');
    const direct = s.includes('toComputerIndex(');
    const viaBoard = s.includes('RaceDayBoard');
    assert.ok(direct || viaBoard,
      `${rel}: 総合pt バッジの描画点へ到達していない（直接ゲートも RaceDayBoard 経由も無い）`);
  }
});

test('RaceDayBoard → RaceNewspaper → RaceEntryTable → HorseDetailPanel の描画経路が保たれている', () => {
  const board = readFileSync(join(SRC, 'components/newspaper/RaceDayBoard.astro'), 'utf8');
  assert.ok(board.includes('RaceNewspaper'), 'RaceDayBoard が RaceNewspaper を使っていない');
  const paper = readFileSync(join(SRC, 'components/newspaper/RaceNewspaper.astro'), 'utf8');
  assert.ok(paper.includes('RaceEntryTable'), 'RaceNewspaper が RaceEntryTable を使っていない');
  const table = readFileSync(join(SRC, 'components/newspaper/RaceEntryTable.astro'), 'utf8');
  assert.ok(table.includes('HorseDetailPanel'), 'RaceEntryTable が HorseDetailPanel を使っていない');
});
