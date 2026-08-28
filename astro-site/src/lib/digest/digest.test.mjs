/**
 * digest.test.mjs — 開催日ダイジェスト（メルマガ素材）の不変条件テスト
 *
 * 実行: node --test src/lib/digest/digest.test.mjs （astro-site 直下から）
 *
 * 固定する不変条件（docs/RENEWAL_2026_08.md §8.3 / CLAUDE.md 絶対厳守）:
 *   1. **買い目（馬番組み合わせ）を出力しない**。禁止キーも持たない
 *   2. 材料（過去走・特徴量から取れた事実）が無い馬を選ばない
 *   3. 注目馬は上位評価、穴馬はそれ以外から選ぶ
 *   4. 実データが無くても壊れない
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDailyDigest, renderDigestText, evaluateMaterials } from './buildDailyDigest.js';
import { buildHorseFacts, normalizePastRaces } from '../../utils/raceNarrative.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf-8');

/** "3-5.7.8" のような買い目らしき並び */
const BET_PATTERN = /\d+\s*-\s*\d+(\s*[.．]\s*\d+)+/;

function mkPast(over = {}) {
  return {
    date: '2026-08-01', venue: '川崎', distance: 'ダ1400', distanceMeters: 1400,
    rank: 2, headCount: 12, popularity: 3, passingOrder: '3-3-3',
    last3f: '39.0', bodyWeight: 480, paceType: 'M', ...over,
  };
}

function mkHorse(n, role, over = {}) {
  return {
    horseNumber: n,
    horseName: `馬${n}`,
    role,
    pt: 150 - n,
    recentRaces: [mkPast(), mkPast({ date: '2026-07-01', rank: 3 })],
    ...over,
  };
}

/** 12R 開催（メインレース＝R11。mainRaceBetting.getMainRaceNumber の仕様に合わせる）。 */
function mkDay(over = {}) {
  const mainHorses = [
    mkHorse(1, '本命'),
    mkHorse(2, '対抗'),
    mkHorse(3, '連下'),
  ];
  const predictions = [];
  for (let rn = 1; rn <= 12; rn += 1) {
    predictions.push({
      raceInfo: {
        date: '2026-08-18', venue: '川崎', raceNumber: rn,
        raceName: rn === 11 ? 'テスト特別' : `${rn}R`, distance: 1400,
      },
      horses: rn === 11 ? mainHorses : [mkHorse(1, '本命')],
      bettingLines: { umatan: ['1-2.3.4.5.6'] },
    });
  }
  return {
    category: 'nankan',
    date: '2026-08-18',
    venues: [{ venueName: '川崎', data: { predictions } }],
    error: null,
    ...over,
  };
}

const OPTS = { racesOf: (v) => v.data.predictions, resolveRaces: (h) => h.recentRaces };

/* ---------- 1. 買い目を出力しない ---------- */

test('ダイジェストに買い目らしき文字列が含まれない', () => {
  const d = buildDailyDigest(mkDay(), OPTS);
  const json = JSON.stringify(d);
  assert.ok(!BET_PATTERN.test(json), `買い目らしき文字列が含まれている: ${json.slice(0, 200)}`);
});

test('ダイジェストに禁止キーが含まれない', () => {
  const json = JSON.stringify(buildDailyDigest(mkDay(), OPTS));
  for (const key of ['bettingLines', 'hitLines', 'umatan', 'raceResults', 'honmeiHit']) {
    assert.ok(!json.includes(`"${key}"`), `禁止キー ${key} が含まれている`);
  }
});

test('メール本文にも買い目が出ない', () => {
  const text = renderDigestText(buildDailyDigest(mkDay(), OPTS));
  assert.ok(!BET_PATTERN.test(text), `本文に買い目らしき文字列: ${text}`);
});

test('生成スクリプトが保存前に買い目を検証している', () => {
  const src = read('scripts/generateDailyDigest.mjs');
  assert.match(src, /assertNoBettingLines\(/, '保存前の検証が無い');
  assert.match(src, /BET_PATTERN/, '買い目パターンの検証が無い');
  assert.match(src, /保存を中止/, '検出時に書き込みを止めていない');
});

/* ---------- 2. 材料が無ければ選ばない ---------- */

test('evaluateMaterials: 材料が無ければ空を返す（無理に埋めない）', () => {
  const facts = buildHorseFacts({ horseNumber: 1, recentRaces: [] }, { raceInfo: {} });
  const { materials, score } = evaluateMaterials(facts);
  assert.deepEqual(materials, []);
  assert.equal(score, 0);
});

test('evaluateMaterials: 事実がある馬だけスコアが付く', () => {
  const pastRaces = normalizePastRaces([
    mkPast({ rank: 1 }), mkPast({ rank: 2, date: '2026-07-01' }), mkPast({ rank: 3, date: '2026-06-01' }),
  ]);
  const facts = buildHorseFacts({ horseNumber: 1 }, {
    raceInfo: { venue: '川崎', distanceMeters: 1400 }, pastRaces,
  });
  const { materials, score } = evaluateMaterials(facts, { raceVenue: '川崎' });
  assert.ok(materials.length >= 2, `materials=${JSON.stringify(materials)}`);
  assert.ok(score > 0);
});

test('材料が 1 つも無い馬は候補に入らない', () => {
  const day = mkDay();
  for (const race of day.venues[0].data.predictions) {
    race.horses = [{ horseNumber: 1, horseName: 'データなし', role: '本命', pt: 100, recentRaces: [] }];
  }
  const d = buildDailyDigest(day, OPTS);
  assert.equal(d.spotlight.length, 0);
  assert.equal(d.longshots.length, 0);
});

/* ---------- 3. 選定の区分 ---------- */

test('注目馬は本命・対抗から、穴馬はそれ以外から選ばれる', () => {
  const d = buildDailyDigest(mkDay(), OPTS);
  for (const s of d.spotlight) assert.ok(['本命', '対抗'].includes(s.role), `spotlight role=${s.role}`);
  for (const s of d.longshots) assert.ok(!['本命', '対抗'].includes(s.role), `longshot role=${s.role}`);
});

test('選定された馬には必ず理由（materials）が付く', () => {
  const d = buildDailyDigest(mkDay(), OPTS);
  for (const s of [...d.spotlight, ...d.longshots]) {
    assert.ok(Array.isArray(s.materials) && s.materials.length > 0, `${s.horseName} に理由が無い`);
  }
});

test('メインレースが抽出され、展望と各馬の短評が入る', () => {
  const d = buildDailyDigest(mkDay(), OPTS);
  assert.equal(d.mainRaces.length, 1);
  const main = d.mainRaces[0];
  assert.equal(main.raceNumber, 11);
  assert.ok(main.outlook && main.outlook.length > 0);
  assert.equal(main.horses.length, 3);
  for (const h of main.horses) assert.ok(h.comment && h.comment.length > 0);
});

/* ---------- 4. 壊れない ---------- */

test('データが無くても例外を投げない', () => {
  const empty = buildDailyDigest({ category: 'jra', date: null, venues: [] }, OPTS);
  assert.equal(empty.mainRaces.length, 0);
  assert.equal(empty.spotlight.length, 0);
  assert.equal(renderDigestText(empty).length >= 0, true);
  assert.doesNotThrow(() => buildDailyDigest(null, OPTS));
  assert.equal(renderDigestText(null), '');
});

test('schemaVersion を持つ（将来の形式変更を検知できる）', () => {
  assert.equal(buildDailyDigest(mkDay(), OPTS).schemaVersion, 'ki-daily-digest-v1');
});
