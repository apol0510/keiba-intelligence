/**
 * courseStats.js — 南関 4 場のコース（競馬場 × 距離）別の傾向を、確定結果から集計する（純関数）
 *
 * 入力: keiba-data-shared の nankan/results/YYYY/MM/*.json（{ date, venue, races: [...] }）
 * 出力: src/data/course/nankanCourseStats.json（scripts/buildCourseStats.mjs が書く）
 *
 * 🔴 ここで扱うのはレースの確定結果（着順・枠・人気・通過順・払戻）だけ。KI の予想・的中実績は使わない。
 * 🔴 数値は集計した事実だけを出す。文章（summary）も同じ数値から機械的に作る（言い過ぎない閾値で分岐）。
 */

export const NANKAN_VENUES = Object.freeze([
  { slug: 'ooi', name: '大井' },
  { slug: 'kawasaki', name: '川崎' },
  { slug: 'funabashi', name: '船橋' },
  { slug: 'urawa', name: '浦和' },
]);

/** 1 コースのページを作る最少レース数。これ未満の距離はページにしない（率が安定しない）。 */
export const MIN_RACES = 40;

const VENUE_SLUG = new Map(NANKAN_VENUES.map((v) => [v.name, v.slug]));

const POPULARITY_BUCKETS = Object.freeze([
  { label: '1番人気', min: 1, max: 1 },
  { label: '2番人気', min: 2, max: 2 },
  { label: '3番人気', min: 3, max: 3 },
  { label: '4〜6番人気', min: 4, max: 6 },
  { label: '7番人気以下', min: 7, max: Infinity },
]);

function toInt(v) {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * 結果ファイルの配列から、重複のないレース一覧を作る。
 * 古いファイルは race.venue が空のことがあるので、ファイルの venue で補う。
 * @param {Array<{date?:string, venue?:string, races?:object[]}>} files
 */
export function collectRaces(files) {
  const byKey = new Map();
  for (const file of Array.isArray(files) ? files : []) {
    for (const r of Array.isArray(file?.races) ? file.races : []) {
      const date = r?.date || file?.date;
      const venue = r?.venue || file?.venue;
      const raceNumber = toInt(r?.raceNumber);
      const distance = toInt(r?.distance);
      if (!date || !VENUE_SLUG.has(venue) || raceNumber === null || distance === null) continue;
      const results = (Array.isArray(r.results) ? r.results : [])
        .map((x) => ({ rank: toInt(x?.rank), bracket: toInt(x?.bracket), number: toInt(x?.number), popularity: toInt(x?.popularity) }))
        .filter((x) => x.rank !== null && x.number !== null);
      if (results.length === 0) continue;
      byKey.set(`${date}|${venue}|${raceNumber}`, {
        date, venue, raceNumber, distance,
        surface: r.surface || 'ダート',
        horses: toInt(r.horses) ?? results.length,
        results,
        payouts: r.payouts && typeof r.payouts === 'object' ? r.payouts : {},
        cornerData: Array.isArray(r.cornerData) ? r.cornerData : [],
      });
    }
  }
  return [...byKey.values()].sort((a, b) => (a.date + a.venue + String(a.raceNumber).padStart(2, '0')).localeCompare(b.date + b.venue + String(b.raceNumber).padStart(2, '0')));
}

function rate(n, d) {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : null;
}

function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

function firstPayout(payouts, key) {
  const list = Array.isArray(payouts?.[key]) ? payouts[key] : [];
  const p = toInt(list[0]?.payout);
  return p !== null && p > 0 ? p : null;
}

/** 4 コーナー（最後の通過順）で勝ち馬が何番手だったか。通過順に載っていなければ null。 */
export function winnerLastCornerPosition(race) {
  const winner = race.results.find((x) => x.rank === 1);
  const last = race.cornerData[race.cornerData.length - 1];
  if (!winner || !last || !Array.isArray(last.order)) return null;
  const flat = last.order.flat(Infinity).map(toInt);
  const i = flat.indexOf(winner.number);
  return i >= 0 ? i + 1 : null;
}

function counter() {
  return { starters: 0, win: 0, top3: 0 };
}

function finish(c) {
  return { starters: c.starters, win: c.win, top3: c.top3, winRate: rate(c.win, c.starters), top3Rate: rate(c.top3, c.starters) };
}

function aggregateRaces(races) {
  const pop = POPULARITY_BUCKETS.map(() => counter());
  const brackets = Array.from({ length: 8 }, () => counter());
  const inner = counter();
  const outer = counter();
  const corner = { known: 0, front: 0, mid: 0, back: 0 };
  const tansho = [];
  const umatan = [];
  const sanrentan = [];
  let tanshoOver1000 = 0;
  let tanshoKnown = 0;
  let fieldTotal = 0;

  for (const race of races) {
    fieldTotal += race.horses;
    for (const h of race.results) {
      const isWin = h.rank === 1;
      const isTop3 = h.rank >= 1 && h.rank <= 3;
      if (h.popularity !== null) {
        const bi = POPULARITY_BUCKETS.findIndex((b) => h.popularity >= b.min && h.popularity <= b.max);
        if (bi >= 0) { pop[bi].starters++; if (isWin) pop[bi].win++; if (isTop3) pop[bi].top3++; }
      }
      if (h.bracket !== null && h.bracket >= 1 && h.bracket <= 8) {
        const b = brackets[h.bracket - 1];
        const side = h.bracket <= 4 ? inner : outer;
        for (const c of [b, side]) { c.starters++; if (isWin) c.win++; if (isTop3) c.top3++; }
      }
    }
    const pos = winnerLastCornerPosition(race);
    if (pos !== null) {
      corner.known++;
      if (pos <= 2) corner.front++;
      else if (pos <= 5) corner.mid++;
      else corner.back++;
    }
    const t = firstPayout(race.payouts, 'tansho');
    if (t !== null) { tansho.push(t); tanshoKnown++; if (t >= 1000) tanshoOver1000++; }
    const u = firstPayout(race.payouts, 'umatan');
    if (u !== null) umatan.push(u);
    const s = firstPayout(race.payouts, 'sanrentan');
    if (s !== null) sanrentan.push(s);
  }

  return {
    races: races.length,
    from: races[0]?.date ?? null,
    to: races[races.length - 1]?.date ?? null,
    avgField: races.length ? Math.round((fieldTotal / races.length) * 10) / 10 : null,
    popularity: POPULARITY_BUCKETS.map((b, i) => ({ label: b.label, ...finish(pop[i]) })),
    brackets: brackets.map((c, i) => ({ bracket: i + 1, ...finish(c) })),
    inner: finish(inner),
    outer: finish(outer),
    winnerCorner: {
      known: corner.known,
      front: corner.front, mid: corner.mid, back: corner.back,
      frontRate: rate(corner.front, corner.known), midRate: rate(corner.mid, corner.known), backRate: rate(corner.back, corner.known),
    },
    payouts: {
      tanshoMedian: median(tansho),
      umatanMedian: median(umatan),
      sanrentanMedian: median(sanrentan),
      tanshoOver1000Rate: rate(tanshoOver1000, tanshoKnown),
    },
  };
}

/** 数値から機械的に作る要点。閾値を超えたときだけ「有利」「波乱」などの言葉を使う。 */
export function buildSummary(course, baseline) {
  const out = [];
  const fav = course.popularity[0];
  const baseFav = baseline.popularity[0];
  if (fav.winRate !== null && baseFav.winRate !== null) {
    const diff = fav.winRate - baseFav.winRate;
    const tone = diff >= 5 ? 'より高く、1番人気が信頼しやすいコースです。'
      : diff <= -5 ? 'より低く、人気馬が崩れて高配当が出やすいコースです。'
        : 'とほぼ同じです。';
    out.push(`1番人気の勝率は${fav.winRate}%で、南関4場の平均（${baseFav.winRate}%）${tone}`);
  }
  if (course.inner.top3Rate !== null && course.outer.top3Rate !== null) {
    const diff = course.inner.top3Rate - course.outer.top3Rate;
    const tone = diff >= 3 ? '内枠が有利です。' : diff <= -3 ? '外枠が有利です。' : '枠の内外による差は小さめです。';
    out.push(`3着以内に入る率は内枠（1〜4枠）${course.inner.top3Rate}%・外枠（5〜8枠）${course.outer.top3Rate}%で、${tone}`);
  }
  const wc = course.winnerCorner;
  if (wc.frontRate !== null) {
    const baseFront = baseline.winnerCorner.frontRate;
    const tone = baseFront !== null && wc.frontRate - baseFront >= 5 ? '前に行ける馬が特に有利なコースです。'
      : baseFront !== null && wc.frontRate - baseFront <= -5 ? '差し・追い込みも届きやすいコースです。'
        : '';
    out.push(`勝ち馬の${wc.frontRate}%が4コーナーを2番手以内で回っています${baseFront !== null ? `（南関4場の平均${baseFront}%）` : ''}。${tone}`);
  }
  const p = course.payouts;
  if (p.tanshoMedian !== null && p.umatanMedian !== null) {
    out.push(`単勝の配当は中央値${p.tanshoMedian.toLocaleString('ja-JP')}円、馬単は中央値${p.umatanMedian.toLocaleString('ja-JP')}円です。`);
  }
  return out;
}

/**
 * レース一覧からコース別の集計を作る。
 * @param {ReturnType<typeof collectRaces>} races
 * @param {{minRaces?:number, generatedAt?:string}} [opts]
 */
export function buildCourseStats(races, { minRaces = MIN_RACES, generatedAt = null } = {}) {
  const list = Array.isArray(races) ? races : [];
  const baseline = aggregateRaces(list);
  const groups = new Map();
  for (const r of list) {
    const key = `${VENUE_SLUG.get(r.venue)}-${r.distance}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const venueOrder = new Map(NANKAN_VENUES.map((v, i) => [v.slug, i]));
  const courses = [];
  for (const [slug, rs] of groups) {
    if (rs.length < minRaces) continue;
    const venueSlug = slug.slice(0, slug.lastIndexOf('-'));
    const course = {
      slug,
      venueSlug,
      venue: rs[0].venue,
      surface: rs[0].surface,
      distance: rs[0].distance,
      ...aggregateRaces(rs),
    };
    course.summary = buildSummary(course, baseline);
    courses.push(course);
  }
  courses.sort((a, b) => (venueOrder.get(a.venueSlug) - venueOrder.get(b.venueSlug)) || (a.distance - b.distance));
  return {
    schema: 'ki.nankan-course-stats/v1',
    generatedAt,
    source: 'keiba-data-shared nankan/results',
    minRaces,
    baseline: { races: baseline.races, from: baseline.from, to: baseline.to, popularity: baseline.popularity, inner: baseline.inner, outer: baseline.outer, winnerCorner: baseline.winnerCorner, payouts: baseline.payouts },
    courses,
  };
}
