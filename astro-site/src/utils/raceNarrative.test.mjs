/**
 * raceNarrative.test.mjs — 決定論ナラティブエンジンの不変条件テスト
 *
 * 実行: node --test src/utils/raceNarrative.test.mjs （astro-site 直下から）
 *
 * 固定する不変条件（docs/RENEWAL_2026_08.md §5）:
 *   1. 純関数である（同じ入力 → 常に同じ文章）
 *   2. 推測補完しない（データが無ければ「データ不足」と明示し、一般論で埋めない）
 *   3. 買い目（馬番組み合わせ）を出力しない
 *   4. allowMarks=false のとき役割語（本命/対抗/…）を出力しない
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeVenue,
  normalizePastRace,
  normalizePastRaces,
  detectRunningStyle,
  summarizeRecord,
  formatRecord,
  buildHorseFacts,
  buildHorseNarrative,
  buildPaceMap,
  buildRaceNarrative,
  buildRaceNarrativeBundle,
  STYLE_NIGE,
  STYLE_SENKO,
  STYLE_SASHI,
  STYLE_OIKOMI,
} from './raceNarrative.js';

/* ---------- fixtures ---------- */

const ROLE_WORDS = ['本命', '対抗', '単穴', '連下', '補欠', 'ヒモ'];
/** "3-5.7.8" のような買い目らしき並び */
const BET_PATTERN = /\d+\s*-\s*\d+(\s*[.．]\s*\d+)+/;

function mkRace(over = {}) {
  return {
    date: '2026-08-01',
    venue: '川崎',
    distance: 'ダ1400',
    distanceMeters: 1400,
    rank: 3,
    headCount: 12,
    popularity: 4,
    passingOrder: '5-5-5',
    last3f: '39.5',
    time: '1.28.0',
    paceType: 'M',
    bodyWeight: 480,
    raceName: 'テスト特別',
    ...over,
  };
}

function mkHorse(over = {}) {
  return {
    horseNumber: 1,
    horseName: 'テストホース',
    pt: 130,
    role: '本命',
    jockey: '騎手A',
    recentRaces: [mkRace(), mkRace({ date: '2026-07-01', rank: 1, passingOrder: '1-1-1' })],
    ...over,
  };
}

const RACE_INFO = { date: '2026-08-18', venue: '川崎', distanceMeters: 1400, raceNumber: 11 };

/* ---------- 1. 正規化 ---------- */

test('normalizeVenue: 日付付き・回次付き・JRA1文字を吸収する', () => {
  assert.equal(normalizeVenue('川崎 7.31'), '川崎');
  assert.equal(normalizeVenue('船橋'), '船橋');
  assert.equal(normalizeVenue('5名12.7'), '中京');
  assert.equal(normalizeVenue('東'), '東京');
  assert.equal(normalizeVenue(''), null);
  assert.equal(normalizeVenue(null), null);
});

test('normalizePastRace: rank/finish・headCount/entryCount・距離文字列の差異を吸収する', () => {
  const a = normalizePastRace({ rank: 3, headCount: 12, distance: 'ダ1400' });
  const b = normalizePastRace({ finish: '3', entryCount: 12, distanceMeters: 1400, surface: 'ダ' });
  assert.equal(a.rank, 3);
  assert.equal(b.rank, 3);
  assert.equal(a.headCount, 12);
  assert.equal(b.headCount, 12);
  assert.equal(a.distanceMeters, 1400);
  assert.equal(b.distanceMeters, 1400);
  assert.equal(a.surface, 'ダ');
});

test('normalizePastRace: 取れない項目を 0 や既定値で埋めない', () => {
  const r = normalizePastRace({ venue: '川崎' });
  assert.equal(r.rank, null);
  assert.equal(r.headCount, null);
  assert.equal(r.last3f, null);
  assert.equal(r.bodyWeight, null);
  assert.deepEqual(r.passing, []);
});

test('normalizePastRaces: 配列以外・空要素を落とす', () => {
  assert.deepEqual(normalizePastRaces(null), []);
  assert.deepEqual(normalizePastRaces([null, {}, 3]), []);
  assert.equal(normalizePastRaces([mkRace()]).length, 1);
});

/* ---------- 2. 脚質・成績 ---------- */

test('detectRunningStyle: 1角1番手は逃げ', () => {
  const races = normalizePastRaces([mkRace({ passingOrder: '1-1-1' })]);
  assert.equal(detectRunningStyle(races).style, STYLE_NIGE);
});

test('detectRunningStyle: 頭数比で先行/差し/追込を分ける', () => {
  const senko = normalizePastRaces([mkRace({ passingOrder: '3-3-3', headCount: 12 })]);
  const sashi = normalizePastRaces([mkRace({ passingOrder: '7-7-7', headCount: 12 })]);
  const oikomi = normalizePastRaces([mkRace({ passingOrder: '11-11-10', headCount: 12 })]);
  assert.equal(detectRunningStyle(senko).style, STYLE_SENKO);
  assert.equal(detectRunningStyle(sashi).style, STYLE_SASHI);
  assert.equal(detectRunningStyle(oikomi).style, STYLE_OIKOMI);
});

test('detectRunningStyle: 通過順が無ければ null（推測しない）', () => {
  const races = normalizePastRaces([mkRace({ passingOrder: null })]);
  const st = detectRunningStyle(races);
  assert.equal(st.style, null);
  assert.equal(st.samples, 0);
});

test('summarizeRecord / formatRecord: 着別度数を数える', () => {
  const races = normalizePastRaces([
    mkRace({ rank: 1 }), mkRace({ rank: 2 }), mkRace({ rank: 3 }), mkRace({ rank: 8 }),
  ]);
  const rec = summarizeRecord(races);
  assert.equal(rec.starts, 4);
  assert.equal(formatRecord(rec), '〔1-1-1-1〕');
  assert.equal(rec.top3, 3);
  assert.equal(formatRecord({ starts: 0 }), null);
});

test('summarizeRecord: 同一会場のみに絞り込める', () => {
  const races = normalizePastRaces([
    mkRace({ venue: '川崎', rank: 1 }),
    mkRace({ venue: '大井', rank: 5 }),
  ]);
  const rec = summarizeRecord(races, (r) => r.venue === '川崎');
  assert.equal(rec.starts, 1);
  assert.equal(rec.win, 1);
});

/* ---------- 3. 事実抽出 ---------- */

test('buildHorseFacts: 過去走ゼロなら hasData=false で他は埋めない', () => {
  const facts = buildHorseFacts({ horseNumber: 1, recentRaces: [] }, { raceInfo: RACE_INFO });
  assert.equal(facts.hasData, false);
  assert.equal(facts.style, null);
  assert.equal(facts.lastRun, null);
  assert.equal(facts.overall, null);
});

test('buildHorseFacts: 馬体重差・連続好走・同距離帯を算出する', () => {
  const horse = mkHorse({
    recentRaces: [
      mkRace({ date: '2026-08-01', rank: 2, bodyWeight: 492 }),
      mkRace({ date: '2026-07-01', rank: 3, bodyWeight: 480 }),
      mkRace({ date: '2026-06-01', rank: 7, bodyWeight: 478 }),
    ],
  });
  const facts = buildHorseFacts(horse, { raceInfo: RACE_INFO });
  assert.equal(facts.bodyWeightDelta, 12);
  assert.equal(facts.top3Streak, 2);
  assert.equal(facts.sameDistance.starts, 3);
  assert.equal(facts.layoffDays, 17);
});

test('buildHorseFacts: featureHighlights は rank<=2 のみ採用する', () => {
  const features = {
    speedIndex: { value: 70, rank: 1 },
    staminaRating: { value: 60, rank: 5 },
    formTrend: { value: 55, rank: 2 },
  };
  const facts = buildHorseFacts(mkHorse(), { raceInfo: RACE_INFO, features });
  assert.equal(facts.featureHighlights.length, 2);
  assert.equal(facts.featureHighlights[0].key, 'speedIndex');
});

/* ---------- 4. 文章化の不変条件 ---------- */

test('buildHorseNarrative: データ不足を一般論で埋めず、明示する', () => {
  const out = buildHorseNarrative({ horseNumber: 5, horseName: 'ノーデータ', recentRaces: [] }, {
    raceInfo: RACE_INFO,
  });
  assert.equal(out.insufficient, true);
  assert.match(out.text, /データ/);
  // 一般論の定型句を出さない
  assert.doesNotMatch(out.text, /調子は良さそう|期待できる|好走が見込める/);
});

test('buildHorseNarrative: 未登録向けにも役割語を出さない', () => {
  const out = buildHorseNarrative(mkHorse({ role: '本命' }), {
    raceInfo: RACE_INFO, allowMarks: false,
  });
  for (const w of ROLE_WORDS) {
    assert.ok(!out.text.includes(w), `guest 向け文章に「${w}」が含まれている: ${out.text}`);
  }
});

/**
 * 🔴 2026-08-29 仕様確定:
 *    短評から本命順位を推測できてはいけない。役割語は **どの tier でも** 出さない。
 */
const RANK_WORDS = ['本命', '対抗', '単穴', '連下', '補欠', 'ヒモ', '上位評価', '推す', '軸'];

test('buildHorseNarrative: どの役割・どの tier でも役割語を出さない', () => {
  for (const role of ['本命', '対抗', '単穴', '連下最上位', '連下', '補欠', '無', null]) {
    for (const allowMarks of [true, false]) {
      const out = buildHorseNarrative(mkHorse({ role }), { raceInfo: RACE_INFO, allowMarks });
      for (const w of RANK_WORDS) {
        assert.ok(!out.text.includes(w), `role=${role} allowMarks=${allowMarks}: 「${w}」が短評に含まれる → ${out.text}`);
      }
      assert.equal(out.lead, null, `role=${role}: lead が残っている`);
      for (const sentence of out.sentences) {
        for (const w of RANK_WORDS) {
          assert.ok(!sentence.includes(w), `role=${role}: sentences に「${w}」が含まれる`);
        }
      }
    }
  }
});

test('buildHorseNarrative: 役割を変えても文章が変わらない（役割が推測できない）', () => {
  const base = buildHorseNarrative(mkHorse({ role: null }), { raceInfo: RACE_INFO, allowMarks: true }).text;
  for (const role of ['本命', '対抗', '単穴', '連下最上位', '連下', '補欠']) {
    const out = buildHorseNarrative(mkHorse({ role }), { raceInfo: RACE_INFO, allowMarks: true });
    assert.equal(out.text, base, `role=${role} で文章が変わっている（役割が漏れる）`);
  }
});

test('buildHorseNarrative: 買い目らしき馬番の並びを出力しない', () => {
  const out = buildHorseNarrative(mkHorse(), { raceInfo: RACE_INFO, allowMarks: true });
  assert.doesNotMatch(out.text, BET_PATTERN);
});

test('buildHorseNarrative: 純関数（同じ入力から同じ文章）', () => {
  const h = mkHorse();
  const a = buildHorseNarrative(h, { raceInfo: RACE_INFO, allowMarks: true });
  const b = buildHorseNarrative(mkHorse(), { raceInfo: RACE_INFO, allowMarks: true });
  assert.equal(a.text, b.text);
});

test('buildHorseNarrative: maxSentences を超えない（役割語を除く）', () => {
  const out = buildHorseNarrative(mkHorse({ role: null }), {
    raceInfo: RACE_INFO, maxSentences: 2,
  });
  assert.ok(out.sentences.length <= 2, `sentences=${out.sentences.length}`);
});

/* ---------- 5. 展開・レース展望 ---------- */

test('buildPaceMap: 脚質ごとに分類し、判定不能は unknown へ入れる', () => {
  const horses = [
    mkHorse({ horseNumber: 1, recentRaces: [mkRace({ passingOrder: '1-1-1' })] }),
    mkHorse({ horseNumber: 2, recentRaces: [mkRace({ passingOrder: '3-3-3', headCount: 12 })] }),
    mkHorse({ horseNumber: 3, recentRaces: [mkRace({ passingOrder: null })] }),
  ];
  const pm = buildPaceMap(horses);
  assert.deepEqual(pm.groups[STYLE_NIGE].map((x) => x.horseNumber), [1]);
  assert.deepEqual(pm.groups[STYLE_SENKO].map((x) => x.horseNumber), [2]);
  assert.deepEqual(pm.groups.unknown.map((x) => x.horseNumber), [3]);
});

test('buildPaceMap: 逃げ候補が3頭以上ならハイペース想定', () => {
  const horses = [1, 2, 3, 4].map((n) => mkHorse({
    horseNumber: n,
    recentRaces: [mkRace({ passingOrder: n === 4 ? '9-9-9' : '1-1-1', headCount: 12 })],
  }));
  assert.equal(buildPaceMap(horses).pace, 'H');
});

test('buildRaceNarrative: 役割語・買い目を出力しない', () => {
  const race = {
    raceInfo: RACE_INFO,
    horses: [1, 2, 3, 4].map((n) => mkHorse({ horseNumber: n })),
  };
  const out = buildRaceNarrative(race, {});
  for (const w of ROLE_WORDS) {
    assert.ok(!out.text.includes(w), `レース展望に「${w}」が含まれている: ${out.text}`);
  }
  assert.doesNotMatch(out.text, BET_PATTERN);
});

test('buildRaceNarrative: データが無くても空文字を返さない', () => {
  const out = buildRaceNarrative({ raceInfo: {}, horses: [] }, {});
  assert.ok(out.text.length > 0);
});

/* ---------- 6. バンドル ---------- */

test('buildRaceNarrativeBundle: 全頭ぶんの文章がそろう', () => {
  const race = {
    raceInfo: RACE_INFO,
    horses: [1, 2, 3].map((n) => mkHorse({ horseNumber: n, horseName: `馬${n}` })),
  };
  const b = buildRaceNarrativeBundle(race, { allowMarks: false });
  assert.equal(b.horses.size, 3);
  for (const [, v] of b.horses) assert.ok(v.text.length > 0);
});

test('buildRaceNarrativeBundle: allowMarks=false では結論を返さない', () => {
  const race = { raceInfo: RACE_INFO, horses: [mkHorse({ role: '本命' })] };
  assert.equal(buildRaceNarrativeBundle(race, { allowMarks: false }).conclusion, null);
});

test('buildRaceNarrativeBundle: allowMarks=true の結論も買い目を含まない', () => {
  const race = {
    raceInfo: RACE_INFO,
    horses: [
      mkHorse({ horseNumber: 6, horseName: '本命馬', role: '本命' }),
      mkHorse({ horseNumber: 4, horseName: '対抗馬', role: '対抗' }),
      mkHorse({ horseNumber: 1, horseName: '単穴馬', role: '単穴' }),
    ],
  };
  const b = buildRaceNarrativeBundle(race, { allowMarks: true });
  assert.ok(b.conclusion);
  assert.doesNotMatch(b.conclusion.text, BET_PATTERN);
});

test('buildRaceNarrativeBundle: resolveRaces で別形式の過去走を渡せる（南関 entries 等）', () => {
  const race = {
    raceInfo: RACE_INFO,
    horses: [{ horseNumber: 1, horseName: 'A', recentRaces: [] }],
  };
  const b = buildRaceNarrativeBundle(race, {
    resolveRaces: () => [{ finish: 1, venue: '川崎', distance: 'ダ1400', passingOrder: '1-1-1' }],
  });
  assert.equal(b.horses.get(1).insufficient, false);
  assert.deepEqual(b.paceMap.groups[STYLE_NIGE].map((x) => x.horseNumber), [1]);
});
