/**
 * attentionMarks.test.mjs — 無料会員の印仕様を固定する
 *
 * 実行: node --test src/utils/attentionMarks.test.mjs （astro-site 直下から）
 *
 * 仕様（docs/RENEWAL_2026_08.md §2 R-3・2026-08-29 確定）:
 *   1. 印は **指数から作る**。指数 1 本 ＝ 新聞の記者 1 人。
 *      各軸が 1 位◎ / 2 位○ / 3 位▲ / 4〜10 位△ を出し、1 列に合算する。
 *   2. **同じ記号が重なる**（'◎◎○▲' のように）。重なり ＝ 指数の一致。
 *   3. 🔴 **1 頭だけを特別扱いする処理を入れない。**
 *      印の多さは指数が一致した結果であって、順位から足したものではない。
 *   4. **データが無い軸は使わない**（捏造しない）。軸が減れば印も減る。
 *   5. △ は買い目の相手（5〜6 頭）より広く保つ。
 *   6. **必ず空欄を残す**。
 *   7. ランダム・時刻に依存しない（決定論的）。
 *   8. 画面の並びは常に馬番昇順。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assignFreeMarks, markCounts, evaluationOrder, availableAxes, poolSizeFor,
  downPerAxis, sortByHorseNumber,
  MARK_SYMBOLS, MAX_AXES, MIN_AXIS_SAMPLES, DOWN_PER_AXIS, minBlankFor,
} from './attentionMarks.js';
import { normalizePastRaces } from './raceNarrative.js';
import { loadNankanRaceDay, loadJraRaceDay, racesOf, racesResolverFor } from '../lib/prediction/loadRaceDay.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf-8');

const ROLES = ['本命', '対抗', '単穴', '連下最上位'];
const RACE_INFO = { venue: '川崎', distance: 1400 };

/**
 * 指数が出そろう出走表を作る。
 * 各馬に、順位とは **別の傾向**を持つ過去走を持たせて軸ごとの順位を散らす
 * （軸がすべて同じ並びになると「複数軸で見ている」ことを検証できない）。
 */
function field(n) {
  return Array.from({ length: n }, (_, i) => {
    const k = i + 1;
    return {
      horseNumber: k,
      horseName: `馬${k}`,
      role: ROLES[i] || '連下',
      pt: 200 - i,
      computerIndex: 90 - ((i * 7) % 60),
      recentRaces: [0, 1, 2].map((j) => ({
        rank: ((i + j * 3) % 9) + 1,
        last3f: 36.0 + (((i * 5 + j * 2) % 40) / 10),
        distance: 1200 + (((i + j) % 4) * 200),
        venue: (i + j) % 3 === 0 ? '川崎' : '大井',
        paceType: (i + j) % 2 === 0 ? 'H' : 'M',
        passingOrder: `${((i + j) % 8) + 1}-${((i + j) % 8) + 1}`,
        date: `2026-0${(j % 6) + 1}-10`,
      })),
    };
  });
}

const pastRacesOf = (h) => normalizePastRaces(h?.recentRaces || []);
const OPTS = { pastRacesOf, raceInfo: RACE_INFO };

const marksOf = (horses, opts = OPTS) => {
  const m = assignFreeMarks(horses, opts);
  return evaluationOrder(horses).map((h) => m.get(h.horseNumber));
};

/* ---------- 1. 指数から作る（新聞の総合印） ---------- */

test('複数の指数が軸として使われる', () => {
  const axes = availableAxes(field(12), pastRacesOf, RACE_INFO);
  assert.ok(axes.length >= 3, `軸が ${axes.length} 本しかない`);
  assert.ok(axes.length <= MAX_AXES, `軸が上限 ${MAX_AXES} を超えている`);
  assert.ok(axes.some((a) => a.key === 'total'), '総合指数が軸に入っていない');
  assert.ok(axes.some((a) => a.key === 'base'), '基礎指数が軸に入っていない');
  // 軸ごとに順位が違う（全部同じ並びなら「複数指数」の意味が無い）
  const firsts = new Set(axes.map((a) => [...a.values.entries()].sort((x, y) => y[1] - x[1])[0][0]));
  assert.ok(firsts.size >= 2, '全軸の 1 位が同じ馬（軸が実質 1 本）');
});

test('同じ記号が重なる（指数の一致がそのまま印の数になる）', () => {
  const marks = marksOf(field(12));
  assert.ok(marks.some((m) => /(.)\1/u.test(m)), '同じ記号の重なりが 1 つも無い');
  assert.ok(marks.some((m) => m.length >= 3), '印が 3 つ以上の馬が居ない');
});

test('各軸は 1位◎ 2位○ 3位▲ 4位以下△ を出す', () => {
  const horses = field(12);
  const axes = availableAxes(horses, pastRacesOf, RACE_INFO);
  const marks = assignFreeMarks(horses, OPTS);
  const down = downPerAxis(poolSizeFor(horses.length));

  // 軸の数だけ ◎ が配られる（同じ馬に重なることもある）
  const total = (sym) => [...marks.values()].reduce((n, m) => n + [...m].filter((c) => c === sym).length, 0);
  assert.equal(total('◎'), axes.length, '◎ の総数が軸の本数と一致しない');
  assert.equal(total('○'), axes.length, '○ の総数が軸の本数と一致しない');
  assert.equal(total('▲'), axes.length, '▲ の総数が軸の本数と一致しない');
  assert.equal(total('△'), axes.length * down, '△ の総数が 軸×1軸あたりの△ と一致しない');
});

test('downPerAxis: 4 で固定（軸の本数でも頭数でも変えない）', () => {
  assert.equal(DOWN_PER_AXIS, 4);
  for (const pool of [7, 8, 10, 12, 14]) assert.equal(downPerAxis(pool), DOWN_PER_AXIS);
  assert.equal(downPerAxis(6), 3); // プールに収まらない分だけ削る
  assert.equal(downPerAxis(3), 0);
  assert.equal(downPerAxis(0), 0);
});

test('🔴 △ の集合が買い目の相手の集合と一致しない（漏洩防止）', () => {
  const day = loadNankanRaceDay(ROOT);
  if (day.error && !day.venues.length) return;
  const past = (h) => normalizePastRaces(racesResolverFor('nankan')(h));
  let checked = 0;
  const leaks = [];
  for (const venue of day.venues) {
    for (const race of racesOf(venue)) {
      const horses = race?.horses || [];
      if (horses.length < 8) continue;
      const lines = race?.bettingLines?.umatan || [];
      const partners = new Set();
      for (const line of lines) {
        const rhs = String(line).split('-')[1];
        if (!rhs) continue;
        for (const p of rhs.replace(/\(.*/, '').split('.')) {
          if (p.trim()) partners.add(Number(p.trim()));
        }
      }
      if (!partners.size) continue;
      checked += 1;
      const m = assignFreeMarks(horses, { pastRacesOf: past, raceInfo: race.raceInfo || {} });
      const down = new Set([...m.entries()].filter(([, s]) => s.includes('△')).map(([k]) => k));
      const same = down.size === partners.size && [...partners].every((p) => down.has(p));
      if (same) leaks.push(`${race.raceInfo.raceNumber}R: △ が買い目の相手と完全一致`);
    }
  }
  assert.ok(checked > 0, '買い目を持つレースが 0');
  assert.deepEqual(leaks, [], leaks.join(' / '));
});

/* ---------- 2. 🔴 1 頭だけを特別扱いしない（今回の失敗の再発防止） ---------- */

test('実装に「評価順 1 位なら印を足す」ような特別扱いが無い', () => {
  const src = read('src/utils/attentionMarks.js');
  assert.ok(!/rank\s*===\s*1/.test(src), '評価順 1 位を特別扱いする分岐が残っている');
  assert.ok(!/i\s*===\s*0\s*\?/.test(src), '先頭の馬だけを特別扱いする分岐が残っている');
  // 印は軸のランキングからのみ付く
  assert.match(src, /ranked\[i\]/, '軸のランキングから印を付けていない');
});

test('印の強さは「指数の一致」で決まる（順位だけでは決まらない）', () => {
  const strong = (s) => [...s].filter((c) => '◎○▲'.includes(c)).length;

  const before = assignFreeMarks(field(12), OPTS).get(1);

  // 評価順 1 位の馬だけ、他の指数の支持を失わせる
  const horses = field(12);
  horses[0].recentRaces = horses[0].recentRaces.map((r) => ({ ...r, rank: 12, last3f: 41.5 }));
  horses[0].computerIndex = 12;
  const after = assignFreeMarks(horses, OPTS).get(1);

  assert.ok(strong(after) < strong(before),
    `指数の支持を失っても ◎○▲ が減らない（${before} → ${after}）`);
  assert.ok(after.includes('◎'), '総合指数の ◎ は残るはず');
});

/* ---------- 3. データが無い軸は使わない ---------- */

test('過去走が無ければ軸が減り、印も減る（捏造しない）', () => {
  const bare = field(12).map((h) => ({ ...h, recentRaces: [], computerIndex: null }));
  const axes = availableAxes(bare, () => [], null);
  assert.equal(axes.length, 1, '過去走・基礎指数が無いのに軸が増えている');
  assert.equal(axes[0].key, 'total');

  const rich = availableAxes(field(12), pastRacesOf, RACE_INFO).length;
  assert.ok(rich > 1, 'データがあるのに軸が増えない');

  const cBare = markCounts(bare, { pastRacesOf: () => [], raceInfo: null });
  const cRich = markCounts(field(12), OPTS);
  assert.ok(cBare['◎'] <= cRich['◎'], 'データが無いほうが ◎ が多い');
});

test('軸が 1 本も無ければ印を出さない', () => {
  const none = [{ horseNumber: 1, pt: null }, { horseNumber: 2, pt: null }, { horseNumber: 3, pt: null }];
  const m = assignFreeMarks(none, { pastRacesOf: () => [], raceInfo: null });
  assert.deepEqual([...m.values()], ['', '', '']);
});

test('全頭同じ値の指数は軸にしない（順位が付かない）', () => {
  const flat = field(12).map((h) => ({ ...h, computerIndex: 55 }));
  const axes = availableAxes(flat, pastRacesOf, RACE_INFO);
  assert.ok(!axes.some((a) => a.key === 'base'), '全頭同値の基礎指数が軸になっている');
});

test('サンプルが少なすぎる指数は軸にしない', () => {
  const few = field(12).map((h, i) => ({ ...h, computerIndex: i < MIN_AXIS_SAMPLES - 1 ? 80 - i : null }));
  const axes = availableAxes(few, pastRacesOf, RACE_INFO);
  assert.ok(!axes.some((a) => a.key === 'base'), `${MIN_AXIS_SAMPLES} 頭未満でも軸になっている`);
});

/* ---------- 4. △ の広さと空欄 ---------- */

test('△ は買い目の相手（5〜6 頭）より広い', () => {
  for (const n of [8, 10, 12, 14, 16, 18]) {
    const c = markCounts(field(n), OPTS);
    const min = n >= 12 ? 6 : 4;
    assert.ok(c['△'] >= min, `${n}頭立てで △=${c['△']}（相手を絞り込めてしまう）`);
  }
});

test('必ず空欄を残す', () => {
  for (const n of [8, 10, 12, 14, 16, 18]) {
    const c = markCounts(field(n), OPTS);
    assert.ok(c.blank >= minBlankFor(n), `${n}頭立てで空欄=${c.blank}`);
  }
});

test('全頭に印が付くことはない', () => {
  for (const n of [7, 8, 9, 10, 12, 16, 18]) {
    const marks = marksOf(field(n));
    assert.ok(marks.some((m) => m === ''), `${n}頭立てで空欄が 0`);
  }
});

/* ---------- 5. 決定論 ---------- */

test('同じ入力からは常に同じ印になる', () => {
  const a = marksOf(field(14));
  const b = marksOf(field(14));
  assert.deepEqual(a, b);
});

test('入力の並び順を変えても印が変わらない', () => {
  const horses = field(14);
  const shuffled = [...horses].reverse();
  const m1 = assignFreeMarks(horses, OPTS);
  const m2 = assignFreeMarks(shuffled, OPTS);
  for (const h of horses) assert.equal(m2.get(h.horseNumber), m1.get(h.horseNumber), `馬${h.horseNumber}`);
});

test('実装がランダム・時刻に依存していない', () => {
  const src = read('src/utils/attentionMarks.js');
  assert.ok(!/Math\.random/.test(src), 'Math.random を使っている');
  assert.ok(!/Date\.now|new Date\(/.test(src), '時刻に依存している');
});

/* ---------- 6. 並び順 ---------- */

test('sortByHorseNumber: 常に馬番昇順（評価の影響を受けない）', () => {
  const byPt = [...field(12)].sort((a, b) => b.pt - a.pt).reverse();
  assert.deepEqual(
    sortByHorseNumber(byPt).map((h) => h.horseNumber),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  );
  assert.deepEqual(sortByHorseNumber(null), []);
});

/* ---------- 7. 実データ ---------- */

test('実データ: 全レースで △ の広さ・空欄・軸の本数を満たす', () => {
  let checked = 0;
  const bad = [];
  for (const [cat, load] of [['nankan', loadNankanRaceDay], ['jra', loadJraRaceDay]]) {
    const day = load(ROOT);
    if (day.error && !day.venues.length) continue;
    const resolve = racesResolverFor(cat);
    const past = (h) => normalizePastRaces(resolve(h));
    for (const venue of day.venues) {
      for (const race of racesOf(venue)) {
        const horses = race?.horses || [];
        if (horses.length < 8) continue;
        checked += 1;
        const info = race.raceInfo || {};
        const opts = { pastRacesOf: past, raceInfo: info };
        const c = markCounts(horses, opts);
        const axes = availableAxes(
          evaluationOrder(horses).slice(0, poolSizeFor(horses.length)), past, info,
        );
        const label = `${venue.venueName}${info.raceNumber}R(${horses.length}頭)`;

        if (axes.length < 1) bad.push(`${label}: 軸が 0 本`);
        if (axes.length > MAX_AXES) bad.push(`${label}: 軸が ${axes.length} 本`);
        if (c['◎'] < 1) bad.push(`${label}: ◎=0`);
        if (c['△'] < 4) bad.push(`${label}: △=${c['△']}（相手を絞り込めてしまう）`);
        if (c.blank < minBlankFor(horses.length)) bad.push(`${label}: 空欄=${c.blank}`);
        // 全頭に印は付かない
        if (c.blank === 0) bad.push(`${label}: 空欄が 0`);
      }
    }
  }
  assert.ok(checked > 0, '検査対象が 0 レース');
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} 件の逸脱`);
});

test('実データ: 印が最も重い馬は ◎ を持つ（新聞と同じ重みで読める）', () => {
  // 新聞の読み方と同じ重み。△ の数だけでは上に来ない
  const WEIGHT = { '◎': 4, '○': 3, '▲': 2, '△': 1 };
  const weigh = (s) => [...s].reduce((n, c) => n + (WEIGHT[c] || 0), 0);

  const day = loadNankanRaceDay(ROOT);
  if (day.error && !day.venues.length) return;
  const past = (h) => normalizePastRaces(racesResolverFor('nankan')(h));
  let checked = 0;
  for (const venue of day.venues) {
    for (const race of racesOf(venue)) {
      const horses = race?.horses || [];
      if (horses.length < 8) continue;
      const info = race.raceInfo || {};
      const m = assignFreeMarks(horses, { pastRacesOf: past, raceInfo: info });
      const best = [...m.entries()].sort((a, b) => weigh(b[1]) - weigh(a[1]))[0];
      assert.ok(best[1].includes('◎'), `${info.raceNumber}R: 印が最も重い馬に ◎ が無い（${best[1]}）`);
      checked += 1;
    }
  }
  assert.ok(checked > 0, '検査対象が 0 レース');
});

/* ---------- 8. 配線 ---------- */

test('RaceEntryTable が指数ベースの印を使っている', () => {
  const src = read('src/components/newspaper/RaceEntryTable.astro');
  assert.match(src, /assignFreeMarks\(horses,\s*\{[^}]*pastRacesOf/s, '過去走を渡していない（軸が総合指数だけになる）');
  assert.match(src, /raceInfo/, 'レース情報を渡していない（距離・コース適性の軸が使えない）');
  assert.match(src, /freeMark/, '印の描画が無い');
  assert.ok(!/role-tag/.test(src), '役割バッジが残っている');
});

test('RaceNewspaper が raceInfo を出馬表へ渡している', () => {
  const src = read('src/components/newspaper/RaceNewspaper.astro');
  assert.match(src, /raceInfo=\{raceInfo\}/, 'raceInfo を渡していない');
});

test('印は ◎○▲△ の 4 種類だけ', () => {
  assert.deepEqual(MARK_SYMBOLS, ['◎', '○', '▲', '△']);
});
