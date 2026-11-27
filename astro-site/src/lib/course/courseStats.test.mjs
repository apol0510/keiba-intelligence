import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRaces, buildCourseStats, buildSummary, winnerLastCornerPosition, NANKAN_VENUES } from './courseStats.js';

const here = dirname(fileURLToPath(import.meta.url));

function race(raceNumber, { venue = '大井', distance = 1200, date = '2026-11-01', winner = { bracket: 1, number: 1, popularity: 1 }, corner = [1, 2, 3], tansho = 200 } = {}) {
  return {
    date, venue, raceNumber, distance, surface: 'ダート', horses: 3,
    results: [
      { rank: 1, ...winner },
      { rank: 2, bracket: 6, number: 6, popularity: 2 },
      { rank: 3, bracket: 8, number: 8, popularity: 7 },
    ],
    payouts: { tansho: [{ number: String(winner.number), payout: tansho }], umatan: [{ payout: 1500 }], sanrentan: [{ payout: 9000 }] },
    cornerData: [{ corner: '３角', order: [9, 9] }, { corner: '４角', order: corner }],
  };
}

test('collectRaces: fills venue from the file, drops duplicates and races without results', () => {
  const r = race(1);
  const files = [
    { date: '2026-11-01', venue: '大井', races: [{ ...r, venue: undefined }, { ...race(2), results: [] }] },
    { date: '2026-11-01', venue: '大井', races: [r] },
    { date: '2026-11-01', venue: '園田', races: [race(3, { venue: '園田' })] },
  ];
  const out = collectRaces(files);
  assert.equal(out.length, 1);
  assert.equal(out[0].venue, '大井');
});

test('winnerLastCornerPosition: position in the last corner order, null when absent', () => {
  assert.equal(winnerLastCornerPosition(race(1, { corner: [4, 1, 2] })), 2);
  assert.equal(winnerLastCornerPosition(race(1, { corner: [4, 5] })), null);
});

test('buildCourseStats: per-course rates and minimum race count', () => {
  const races = [
    ...Array.from({ length: 4 }, (_, i) => race(i + 1)),
    race(5, { winner: { bracket: 5, number: 5, popularity: 4 }, corner: [2, 3, 4, 6, 7, 5], tansho: 1200 }),
    race(6, { distance: 1600 }),
  ];
  const s = buildCourseStats(collectRaces([{ races }]), { minRaces: 5 });
  assert.equal(s.courses.length, 1);
  const c = s.courses[0];
  assert.equal(c.slug, 'ooi-1200');
  assert.equal(c.races, 5);
  assert.equal(c.popularity[0].winRate, 100); // 1番人気 4 頭すべて 1 着
  assert.equal(c.popularity[3].winRate, 100); // 4〜6番人気 1 頭が 1 着
  assert.equal(c.brackets[0].starters, 4);
  assert.equal(c.inner.top3Rate, 100);
  assert.deepEqual([c.winnerCorner.front, c.winnerCorner.back], [4, 1]);
  assert.equal(c.payouts.tanshoMedian, 200);
  assert.equal(c.payouts.tanshoOver1000Rate, 20);
  assert.equal(s.baseline.races, 6);
});

test('buildSummary: wording follows the numbers (thresholds)', () => {
  const base = { popularity: [{ winRate: 40 }], winnerCorner: { frontRate: 60 } };
  const course = {
    popularity: [{ winRate: 50 }],
    inner: { top3Rate: 30 }, outer: { top3Rate: 20 },
    winnerCorner: { frontRate: 50 },
    payouts: { tanshoMedian: 300, umatanMedian: 2000 },
  };
  const s = buildSummary(course, base).join('\n');
  assert.match(s, /信頼しやすい/);
  assert.match(s, /内枠が有利/);
  assert.match(s, /差し・追い込みも届きやすい/);
  assert.match(s, /2,000円/);
  const flat = buildSummary({ ...course, popularity: [{ winRate: 41 }], inner: { top3Rate: 25 }, outer: { top3Rate: 24 }, winnerCorner: { frontRate: 61 } }, base).join('\n');
  assert.doesNotMatch(flat, /有利|信頼しやすい|波乱|高配当が出やすい/);
});

test('committed data file: shape the pages rely on', () => {
  const data = JSON.parse(readFileSync(join(here, '..', '..', 'data', 'course', 'nankanCourseStats.json'), 'utf-8'));
  assert.equal(data.schema, 'ki.nankan-course-stats/v1');
  assert.ok(data.courses.length >= 4);
  const slugs = new Set(NANKAN_VENUES.map((v) => v.slug));
  for (const c of data.courses) {
    assert.match(c.slug, /^[a-z]+-\d{3,4}$/);
    assert.ok(slugs.has(c.venueSlug));
    assert.ok(c.races >= data.minRaces);
    assert.equal(c.popularity.length, 5);
    assert.equal(c.brackets.length, 8);
    assert.ok(Array.isArray(c.summary) && c.summary.length > 0);
  }
});
