/**
 * performance.test.mjs — 公開実績（的中率・回収率）の単一源を固定する
 *
 * 正本: docs/PERFORMANCE_STATS.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PERFORMANCE_BASIS,
  EXCLUDE_REASON,
  raceOutcome,
  dayPerformance,
  summarize,
  combinedSummary,
  monthlySummaries,
  venueSummary,
  formatPercent,
  formatSignedYen,
} from './performance.js';
import { buildBettingPlan } from '../../utils/bettingPlan.js';
import { checkUmatanHit } from '../../utils/umatanHit.js';
import { isMainRace } from '../../utils/mainRaceBetting.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(here, '../../..');
const read = (rel) => fs.readFileSync(path.join(SITE, rel), 'utf8');
const nankan = JSON.parse(read('src/data/archiveResults.json'));
const jra = JSON.parse(read('src/data/archiveResultsJra.json'));

const race = (over = {}) => ({
  raceNumber: 1,
  venue: '大井',
  result: { first: { number: 4 }, second: { number: 6 } },
  bettingLines: ['4-6.8.12(抑え10.7)'],
  umatan: { combination: '4-6', payout: 1230 },
  isHit: true,
  ...over,
});

/* ---------- 算定式 ---------- */

test('通常レース: 投資 = 表示した組の数 × 100、的中で実払戻をそのまま足す', () => {
  // 4→6/8/12 の前進 3 組 + 上位 3 頭の逆方向 3 組 = 6 組（抑えは買わない）
  const o = raceOutcome(race(), { isMain: false });
  assert.deepEqual(o, { counted: true, hit: true, points: 6, investment: 600, payout: 1230 });
});

test('メインレース: 一方向のみ（逆方向の組で決まっても的中にしない）', () => {
  const r = race({ result: { first: { number: 6 }, second: { number: 4 } }, umatan: { combination: '6-4', payout: 990 } });
  assert.equal(raceOutcome(r, { isMain: true }).hit, false);
  assert.equal(raceOutcome(r, { isMain: true }).points, 3);
  assert.equal(raceOutcome(r, { isMain: false }).hit, true);
});

test('抑えの組で決まっても的中にしない（抑えは投資にも含めない）', () => {
  const r = race({ result: { first: { number: 4 }, second: { number: 10 } }, umatan: { combination: '4-10', payout: 5000 } });
  const o = raceOutcome(r, { isMain: false });
  assert.equal(o.hit, false);
  assert.equal(o.payout, 0);
  assert.equal(o.points, 6);
});

test('推測しない: 着順が無い・買い目が無い・払戻の組が着順と食い違うレースは集計外', () => {
  assert.deepEqual(raceOutcome(race({ result: {} }), { isMain: false }), { counted: false, reason: EXCLUDE_REASON.NO_RESULT });
  assert.deepEqual(raceOutcome(race({ bettingLines: [] }), { isMain: false }), { counted: false, reason: EXCLUDE_REASON.NO_BETS });
  assert.deepEqual(
    raceOutcome(race({ umatan: { combination: '4-8', payout: 5690 } }), { isMain: false }),
    { counted: false, reason: EXCLUDE_REASON.PAYOUT_MISMATCH },
  );
});

test('上限・補正を置かない（高配当は 200% を超えてもそのまま）', () => {
  // 1 レースだけの開催 → そのレースがメイン（一方向 3 組 = 300 円）
  const s = dayPerformance({ date: '2026-01-01', races: [race({ umatan: { combination: '4-6', payout: 98760 } })] });
  assert.equal(s.investment, 300);
  assert.equal(s.returnRate, Math.round((98760 / 300) * 1000) / 10);
  assert.ok(s.returnRate > 200);
});

test('足してから割る（率の平均を取らない）・分母 0 は null', () => {
  // どちらも 1 レース開催＝メイン（3 組 = 300 円）
  const a = { date: '2026-01-01', races: [race()] }; // 300 投資 / 1230 払戻
  const b = { date: '2026-01-02', races: [race({ bettingLines: ['1-3.5.7.9.11'], result: { first: { number: 1 }, second: { number: 2 } }, umatan: { combination: '1-2', payout: 300 } })] }; // 500 投資 / 外れ
  const s = summarize([a, b]);
  assert.equal(s.investment, 800);
  assert.equal(s.payout, 1230);
  assert.equal(s.returnRate, 153.8); // 日別の率の平均（410% と 0% → 205%）ではない
  assert.equal(s.hitRate, 50);
  assert.equal(summarize([]).returnRate, null);
  assert.equal(formatPercent(null), '—');
  assert.equal(formatSignedYen(-1500), '−¥1,500');
});

/* ---------- 実データでの不変条件 ---------- */

test('🔴 的中の意味が変わらない: 集計した全レースで hit === 保存済み isHit（checkUmatanHit とも一致）', () => {
  let counted = 0;
  for (const entries of [nankan, jra]) {
    for (const e of entries) {
      const per = {};
      for (const r of e.races) per[r.venue] = (per[r.venue] || 0) + 1;
      for (const r of e.races) {
        const isMain = isMainRace(r.raceNumber, per[r.venue]);
        const o = raceOutcome(r, { isMain });
        if (!o.counted) continue;
        counted += 1;
        assert.equal(o.hit, !!r.isHit, `${e.date} ${r.venue}${r.raceNumber}R`);
        const res = { results: [{ number: r.result.first.number }, { number: r.result.second.number }] };
        const single = r.bettingLines.some((l) => checkUmatanHit(l, res, isMain ? 0 : 3));
        assert.equal(o.hit, single, `checkUmatanHit ${e.date} ${r.venue}${r.raceNumber}R`);
      }
    }
  }
  assert.ok(counted > 4000);
});

test('🔴 Premium の買い目を作り直さない: 投資点数は Premium 画面と同じ buildBettingPlan の combos', () => {
  const src = read('src/lib/stats/performance.js');
  assert.match(src, /import \{ buildBettingPlan, UNIT_PRICE_YEN \} from '..\/..\/utils\/bettingPlan.js'/);
  assert.match(read('src/components/newspaper/RaceNewspaper.astro'), /buildBettingPlan\(validBetting/);
  const e = nankan.find((x) => x.races.length > 0);
  const per = {};
  for (const r of e.races) per[r.venue] = (per[r.venue] || 0) + 1;
  const expected = e.races.reduce((n, r) => n + buildBettingPlan(r.bettingLines, { isMain: isMainRace(r.raceNumber, per[r.venue]) }).combos.length, 0);
  assert.equal(dayPerformance(e).points, expected - excludedPoints(e, per));
});

function excludedPoints(e, per) {
  return e.races.reduce((n, r) => {
    const o = raceOutcome(r, { isMain: isMainRace(r.raceNumber, per[r.venue]) });
    return o.counted ? n : n + buildBettingPlan(r.bettingLines ?? [], { isMain: isMainRace(r.raceNumber, per[r.venue]) }).combos.length;
  }, 0);
}

test('🔴 結果・買い目・払戻の原データを変更しない（集計の前後で archive が同一）', () => {
  const before = JSON.stringify([nankan, jra]);
  combinedSummary(nankan, jra);
  monthlySummaries(nankan);
  venueSummary(nankan, '大井');
  assert.equal(JSON.stringify([nankan, jra]), before);
});

test('同じ入力なら同じ結果（並び順にも依存しない）', () => {
  const a = summarize(nankan);
  const b = summarize([...nankan].reverse());
  assert.deepEqual(a, b);
  assert.equal(a.basis, PERFORMANCE_BASIS);
});

test('🔴 南関と JRA を混ぜない: 合算 = 南関 + JRA、内訳は各ファイルだけから', () => {
  const c = combinedSummary(nankan, jra);
  assert.deepEqual(c.nankan, summarize(nankan));
  assert.deepEqual(c.jra, summarize(jra));
  for (const k of ['races', 'hits', 'investment', 'payout', 'days']) assert.equal(c.all[k], c.nankan[k] + c.jra[k]);
});

test('月別・会場別の合計は通算と一致する（ページ間で数字が食い違わない）', () => {
  for (const entries of [nankan, jra]) {
    const t = summarize(entries);
    const months = monthlySummaries(entries);
    for (const k of ['races', 'hits', 'investment', 'payout']) {
      assert.equal(months.reduce((n, m) => n + m[k], 0), t[k], k);
    }
    const venues = [...new Set(entries.flatMap((e) => e.races.map((r) => r.venue)))];
    for (const k of ['races', 'hits', 'investment', 'payout']) {
      assert.equal(venues.reduce((n, v) => n + venueSummary(entries, v)[k], 0), t[k], `venue ${k}`);
    }
  }
});

/* ---------- 公開ページの静的ガード ---------- */

const STAT_PAGES = [
  'src/pages/index.astro',
  'src/pages/results/[year]/[month]/[day].astro',
  'src/pages/results/[year]/[month]/index.astro',
  'src/pages/archive/nankan/index.astro',
  'src/pages/archive/jra/index.astro',
  'src/pages/archive/nankan/[year]/index.astro',
  'src/pages/archive/nankan/[year]/[month]/index.astro',
  'src/pages/archive/jra/[year]/[month]/index.astro',
  'src/pages/venues/[venue]/index.astro',
  'src/pages/stats/[venue].astro',
];

test('🔴 成績を出すページは単一源だけを使い、archive の旧 5 点基準の保存値を読まない', () => {
  for (const p of STAT_PAGES) {
    const src = read(p);
    assert.match(src, /lib\/stats\/performance\.js/, `${p} が単一源を使っていない`);
    assert.doesNotMatch(src, /\b(entry|dayData|e)\.(betAmount|returnRate|hitRate|totalPayout|hitRaces|betPointsPerRace|recoveryRate)\b/, `${p} が保存値を直接読んでいる`);
    assert.doesNotMatch(src, /totalPayout\s*\/\s*\w*[bB]etAmount|payout\s*\/\s*\w*[iI]nvestment/, `${p} が独自に回収率を割り算している`);
    assert.doesNotMatch(src, /bettingPoints\s*\|\|/, `${p} が別の点数基準を使っている`);
  }
});

const PUBLIC_UI = () => {
  const out = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(path.join(SITE, dir), { withFileTypes: true })) {
      const rel = path.join(dir, f.name);
      if (f.isDirectory()) walk(rel);
      else if (/\.(astro|js|mjs|ts)$/.test(f.name) && !/\.test\./.test(f.name)) out.push(rel);
    }
  };
  for (const d of ['src/pages', 'src/components', 'src/layouts']) walk(d);
  out.push('netlify/functions/gemini-chat.js');
  return out;
};

test('🔴 出典不明の固定マーケティング値（71.1% / 186.4% / 71% / 186% 等）が公開 UI に残らない', () => {
  for (const p of PUBLIC_UI()) {
    const src = read(p).split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n');
    assert.doesNotMatch(src, /(71\.1|186\.4|217\.1|212\.8|234(\.0)?)\s*%/, p);
    assert.doesNotMatch(src, /(的中率|回収率)\s*[0-9０-９]{2,3}(\.[0-9])?\s*[%％]/, `${p} に固定の率が書かれている`);
  }
});

test('🔴 AK の数値・ロジックを参照しない（126% / 62% / analytics-keiba）', () => {
  for (const p of ['src/lib/stats/performance.js', ...STAT_PAGES]) {
    const src = read(p);
    assert.doesNotMatch(src, /analytics-keiba|analyticsKeiba/i, p);
    assert.doesNotMatch(src, /\b126(\.0)?\s*%|\b62(\.0)?\s*%/, p);
  }
});

test('🔴 「厳選」を顧客向け UI に出さない', () => {
  for (const p of PUBLIC_UI()) assert.doesNotMatch(read(p), /厳選/, p);
});

test('🔴 閉じた #150 系の実装（上位表示の段階・凍結）を持ち込まない', () => {
  for (const p of [...PUBLIC_UI(), 'src/lib/stats/performance.js', 'src/utils/bettingPlan.js']) {
    assert.doesNotMatch(read(p), /selectionTiers|displayedSelection|ki-top-v1|AI上位表示|displayedBets|freeze:displayed/, p);
  }
});

test('🔴 固定の的中率・回収率が焼き込まれた旧画像（トップ Hero PC・登録 CTA）へ戻さない', async () => {
  const { createHash } = await import('node:crypto');
  // 2026-10-06 以前の画像（71.1% / 186.4% / 124.6% を含む）の SHA-256
  const OLD = {
    'public/images/KI_hero_PC.png': 'd8802ca07190c419f1f50642d07166f80efdab76c1b611536cad415bf118905f',
    'public/images/KI_register_PC.png': 'c3aec8f6c984c5cec04bf3d9e0acdfc793a4667031d31e9338294370184234f2',
    'public/images/KI_register_Mobile.png': '43ebebc9be6248b0351ef6b381cdab237d861e3aad6a21e2ed770411201a92cb',
  };
  for (const [rel, sha] of Object.entries(OLD)) {
    const buf = fs.readFileSync(path.join(SITE, rel));
    assert.notEqual(createHash('sha256').update(buf).digest('hex'), sha, `${rel} が旧画像に戻っている`);
  }
  // Hero PC は数値カード行を切り落とした高さ（PNG IHDR の高さ）
  const hero = fs.readFileSync(path.join(SITE, 'public/images/KI_hero_PC.png'));
  assert.equal(hero.readUInt32BE(20), 715);
  assert.match(read('src/pages/index.astro'), /width="1536"\s+height="715"/);
});
