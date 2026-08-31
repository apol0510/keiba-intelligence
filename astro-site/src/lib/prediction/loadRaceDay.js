/**
 * loadRaceDay.js — 予想 1 開催日ぶんの読み込み（南関 / JRA 共通の形へ正規化）
 *
 * 正本: docs/RENEWAL_2026_08.md §4
 *
 * これまで `prediction/*` と `free-prediction/*` の 4 ページが同じ読み込みを重複実装しており、
 * 片方だけ直して退行する原因になっていた（docs/ui-cross-plan-regression-policy.md）。
 * 本モジュールを単一ソースにして 6 経路すべてが同じデータを見る。
 *
 * 🔴 既存の読み込み挙動は変えていない:
 *   - 南関: `src/data/predictions/YYYY-MM-DD-{venue}.json`（同日複数会場をすべて読む）
 *           ＋ recentHorseHistories / entries / horseStats の**表示専用注入**（失敗は非致命）
 *   - JRA : `loadJraLatestVenues()`（horseHistories 注入込み）をそのまま使う
 *   - featureScores は `loadFeatureScores()` を会場・日付ごとに読む（読めなければ null）
 *
 * 🔴 何も算出しない。印・PT・買い目・過去走の値を書き換えない。
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { loadJraLatestVenues } from '../../utils/loadJraLatest.js';
import { injectHorseHistoriesIntoVenues } from '../../utils/loadHorseHistoriesJra.js';
import {
  injectRecentHorseHistoriesNankanIntoData,
  nankanVenueCode,
} from '../../utils/injectRecentHorseHistoriesNankan.js';
import { injectEntriesRecentRacesNankanIntoData } from '../../utils/injectEntriesRecentRacesNankan.js';
import { injectHorseStatsNankanIntoData } from '../../utils/injectHorseStatsNankan.js';
import { getDisplayRecentRacesForNankan } from '../../utils/getDisplayRecentRacesForNankan.js';
import {
  loadFeatureScores, getHorseFeatures, hasUsableFeatureScores, venueCodeFromName,
} from '../../utils/loadFeatureScores.js';
import { generateAdvancedMetrics } from '../../utils/featureScores.js';

/** ファイル名の会場スラッグ → 日本語会場名。 */
const NANKAN_VENUE_NAME = Object.freeze({
  ooi: '大井',
  funabashi: '船橋',
  kawasaki: '川崎',
  urawa: '浦和',
});

/** featureScores の 6 項目がすべて揃う馬だけ stored を返す（既存ページと同じ判定）。 */
const FEATURE_KEYS = Object.freeze([
  'speedIndex', 'staminaRating', 'formTrend', 'trackCompatibility', 'distanceFitness', 'jockeyFactor',
]);

export function usableFeaturesFor(featureScoresData, raceNumber, horseNumber) {
  if (!featureScoresData) return null;
  if (!hasUsableFeatureScores(featureScoresData, raceNumber, horseNumber)) return null;
  const fs6 = getHorseFeatures(featureScoresData, raceNumber, horseNumber);
  if (!fs6) return null;
  if (!FEATURE_KEYS.every((k) => fs6[k] && fs6[k].value != null)) return null;
  return fs6;
}

/**
 * 南関の最新開催日を読み込む。
 * @returns {{ category:'nankan', date:string|null, venues:Array, error:string|null }}
 */
export function loadNankanRaceDay(cwd = process.cwd()) {
  const dir = join(cwd, 'src', 'data', 'predictions');
  const out = { category: 'nankan', date: null, venues: [], error: null };

  try {
    if (!existsSync(dir)) throw new Error('予想データフォルダが見つかりません');

    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.json') && /^\d{4}-\d{2}-\d{2}-[a-z]+\.json$/.test(f))
      .map((f) => {
        const m = f.match(/^(\d{4}-\d{2}-\d{2})-([a-z]+)\.json$/);
        return m ? { file: f, date: m[1], venueSlug: m[2], ts: new Date(m[1]).getTime() } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.ts - a.ts);

    if (!files.length) throw new Error('予想データがありません');

    out.date = files[0].date;

    for (const info of files.filter((f) => f.date === out.date)) {
      const data = JSON.parse(readFileSync(join(dir, info.file), 'utf-8'));
      const venueName = NANKAN_VENUE_NAME[info.venueSlug] || info.venueSlug;
      const code = nankanVenueCode(info.venueSlug);

      // 表示専用の注入。いずれも失敗は非致命（既存表示を維持する）。
      try { injectRecentHorseHistoriesNankanIntoData(data, code, cwd); } catch { /* noop */ }
      try { injectEntriesRecentRacesNankanIntoData(data, code, cwd); } catch { /* noop */ }
      try { injectHorseStatsNankanIntoData(data, code, cwd); } catch { /* noop */ }

      let featureScores = null;
      try {
        const fsCode = venueCodeFromName('nankan', venueName);
        featureScores = fsCode ? loadFeatureScores('nankan', out.date, fsCode, cwd) : null;
      } catch { featureScores = null; }

      out.venues.push({ venueName, venueSlug: info.venueSlug, venueCode: code, data, featureScores });
    }
  } catch (err) {
    out.error = err?.message || String(err);
  }

  return out;
}

/**
 * JRA の最新開催日を読み込む。
 * @returns {{ category:'jra', date:string|null, venues:Array, error:string|null }}
 */
export function loadJraRaceDay(cwd = process.cwd()) {
  const out = { category: 'jra', date: null, venues: [], error: null };

  try {
    const loaded = loadJraLatestVenues(cwd);
    if (loaded?.error) out.error = loaded.error;

    // loadJraLatestVenues の venues は `{ venue, eventInfo, predictions }` の配列。
    // 南関側と同じ `{ venueName, data: { eventInfo, predictions } }` へ揃える。
    const list = Array.isArray(loaded?.venues) ? loaded.venues : [];
    for (const v of list) {
      const data = { eventInfo: v?.eventInfo || null, predictions: v?.predictions || [] };
      const venueName = v?.venue || v?.eventInfo?.venue || '—';
      const date = v?.eventInfo?.date || loaded?.targetDate || null;
      if (!out.date && date) out.date = date;

      let featureScores = null;
      try {
        const fsCode = venueCodeFromName('jra', venueName);
        featureScores = fsCode && date ? loadFeatureScores('jra', date, fsCode, cwd) : null;
      } catch { featureScores = null; }

      out.venues.push({ venueName, venueSlug: null, venueCode: null, data, featureScores });
    }

    if (!out.venues.length && !out.error) out.error = '予想データがありません';
  } catch (err) {
    out.error = err?.message || String(err);
  }

  return out;
}

/**
 * 南関の特定開催（slug = `YYYY-MM-DD-{venue}`）を読み込む。
 * 最新日ではなく指定日を読む点だけが `loadNankanRaceDay` と異なる。
 */
export function loadNankanRaceDayBySlug(slug, cwd = process.cwd()) {
  const out = { category: 'nankan', date: null, venues: [], error: null };
  try {
    const m = typeof slug === 'string' ? slug.match(/^(\d{4}-\d{2}-\d{2})-([a-z]+)$/) : null;
    if (!m) throw new Error('予想データが見つかりません');
    const [, date, venueSlug] = m;

    const file = join(cwd, 'src', 'data', 'predictions', `${slug}.json`);
    if (!existsSync(file)) throw new Error('予想データが見つかりません');

    const data = JSON.parse(readFileSync(file, 'utf-8'));
    const venueName = NANKAN_VENUE_NAME[venueSlug] || venueSlug;
    const code = nankanVenueCode(venueSlug);

    try { injectRecentHorseHistoriesNankanIntoData(data, code, cwd); } catch { /* noop */ }
    try { injectEntriesRecentRacesNankanIntoData(data, code, cwd); } catch { /* noop */ }
    try { injectHorseStatsNankanIntoData(data, code, cwd); } catch { /* noop */ }

    let featureScores = null;
    try {
      const fsCode = venueCodeFromName('nankan', venueName);
      featureScores = fsCode ? loadFeatureScores('nankan', date, fsCode, cwd) : null;
    } catch { featureScores = null; }

    out.date = date;
    out.venues.push({ venueName, venueSlug, venueCode: code, data, featureScores });
  } catch (err) {
    out.error = err?.message || String(err);
  }
  return out;
}

/** JRA の特定開催日（`YYYY-MM-DD`）を読み込む。 */
export function loadJraRaceDayByDate(date, cwd = process.cwd()) {
  const out = { category: 'jra', date: null, venues: [], error: null };
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) throw new Error('予想データが見つかりません');
    const [y, mo] = date.split('-');
    const file = join(cwd, 'src', 'data', 'predictions', 'jra', y, mo, `${date}.json`);
    if (!existsSync(file)) throw new Error('予想データが見つかりません');

    const raw = JSON.parse(readFileSync(file, 'utf-8'));
    let venues = [];
    if (Array.isArray(raw?.venues)) venues = raw.venues;
    else if (raw?.eventInfo && raw?.predictions) {
      venues = [{ venue: raw.eventInfo.venue, eventInfo: raw.eventInfo, predictions: raw.predictions }];
    } else {
      throw new Error('予想データのフォーマットが不正です');
    }

    try { injectHorseHistoriesIntoVenues(venues, date, cwd); } catch { /* noop */ }

    out.date = date;
    for (const v of venues) {
      const venueName = v?.venue || v?.eventInfo?.venue || '—';
      let featureScores = null;
      try {
        const fsCode = venueCodeFromName('jra', venueName);
        featureScores = fsCode ? loadFeatureScores('jra', date, fsCode, cwd) : null;
      } catch { featureScores = null; }
      out.venues.push({
        venueName,
        venueSlug: null,
        venueCode: null,
        data: { eventInfo: v?.eventInfo || null, predictions: v?.predictions || [] },
        featureScores,
      });
    }
  } catch (err) {
    out.error = err?.message || String(err);
  }
  return out;
}

/** カテゴリで切り替えるだけのラッパ。 */
export function loadRaceDay(category, cwd = process.cwd()) {
  return category === 'jra' ? loadJraRaceDay(cwd) : loadNankanRaceDay(cwd);
}

/* ------------------------------------------------------------------
   描画側へ渡す resolver
   ------------------------------------------------------------------ */

/**
 * 南関の過去走の解決順（既存 `getDisplayRecentRacesForNankan` に委譲）:
 *   entries → recentHorseHistories → legacy recentRaces
 */
export function nankanRacesResolver() {
  return (horse) => getDisplayRecentRacesForNankan(horse) || [];
}

/**
 * JRA の過去走。情報量の多い順に選ぶ:
 *   1. `historyForDetails`（人気・頭数・馬場・馬体重・1着馬・日付を持つ。最大 20 走 → 5 走に切る）
 *   2. `recentRacesFromHistories`（着順・距離・時計のみ）
 *   3. legacy `recentRaces`
 *
 * ⚠️ JRA の上流データには **上がり3F と通過順が無い**。そのため JRA では
 *    脚質判定・上がり比較・展開予想が出せない（推測で埋めない）。
 *    上流での補完が必要。docs/progress.md の Open Questions を参照。
 */
export function jraRacesResolver() {
  return (horse) => {
    const detailed = horse?.historyForDetails;
    if (Array.isArray(detailed) && detailed.length) return detailed.slice(0, 5);
    const injected = horse?.recentRacesFromHistories;
    if (Array.isArray(injected) && injected.length) return injected;
    return Array.isArray(horse?.recentRaces) ? horse.recentRaces : [];
  };
}

export function racesResolverFor(category) {
  return category === 'jra' ? jraRacesResolver() : nankanRacesResolver();
}

/**
 * レース 1 本ぶんの特徴量 resolver を作る。
 *
 * 優先順:
 *   1. 取込済み featureScores（6 項目そろっている馬のみ。value と rank を持つ）
 *   2. `generateAdvancedMetrics` による算出（南関は featureScores 未整備の日があるため）
 *
 * 2 の場合 rank は**このレース内の値の降順**で算出する（stored と同じ意味にそろえる）。
 *
 * 🔴 勝率・期待値は返さない。較正が未検証のため表示しない
 *    （docs/progress.md / 過去の JRA 期待値 -25% 問題）。
 */
export function featuresResolverForRace(race, featureScoresData) {
  const raceInfo = race?.raceInfo || {};
  const horses = Array.isArray(race?.horses) ? race.horses : [];
  const raceNumber = raceInfo?.raceNumber;

  /** @type {Map<number, object>} */
  const table = new Map();

  // 1) stored
  const missing = [];
  for (const h of horses) {
    const stored = usableFeaturesFor(featureScoresData, raceNumber, h?.horseNumber);
    if (stored) table.set(h?.horseNumber, stored);
    else missing.push(h);
  }

  // 2) fallback（stored が無い馬がいる場合のみ算出する）
  if (missing.length && horses.length) {
    const computed = new Map();
    for (const h of horses) {
      let m = null;
      try {
        m = generateAdvancedMetrics(h, horses, raceInfo);
      } catch { m = null; }
      if (!m) continue;
      // formTrend だけ生値が -50〜+50 の中心ゼロ表現なので、stored（0〜100）へそろえる。
      const rawTrend = Number(String(m.formTrend).replace('+', ''));
      computed.set(h?.horseNumber, {
        speedIndex: Number(m.speedIndex),
        staminaRating: Number(m.staminaRating),
        formTrend: Number.isFinite(rawTrend) ? Math.max(0, Math.min(100, rawTrend + 50)) : NaN,
        trackCompatibility: Number(m.trackCompatibility),
        distanceFitness: Number(m.distanceFitness),
        jockeyFactor: Number(m.jockeyFactor),
      });
    }

    // rank をレース内で算出（値の降順。同値は同順位にせず出現順で決める）
    const ranks = {};
    for (const key of FEATURE_KEYS) {
      const sorted = [...computed.entries()]
        .filter(([, v]) => Number.isFinite(v[key]))
        .sort((a, b) => b[1][key] - a[1][key]);
      sorted.forEach(([hn], i) => {
        ranks[key] = ranks[key] || new Map();
        ranks[key].set(hn, i + 1);
      });
    }

    for (const h of missing) {
      const v = computed.get(h?.horseNumber);
      if (!v) continue;
      const out = {};
      for (const key of FEATURE_KEYS) {
        if (!Number.isFinite(v[key])) continue;
        out[key] = { value: v[key], rank: ranks[key]?.get(h?.horseNumber) ?? null, source: 'computed' };
      }
      if (Object.keys(out).length) table.set(h?.horseNumber, out);
    }
  }

  return (horse) => table.get(horse?.horseNumber) || null;
}

/** 後方互換: 馬番だけで stored を引く（fallback なし）。 */
export function featuresResolverFor(featureScoresData, raceNumber) {
  return (horse) => usableFeaturesFor(featureScoresData, raceNumber, horse?.horseNumber);
}

/**
 * 南関 horseStats（血統・持時計・距離成績・騎手相性・詳細近走）をそのまま返す resolver。
 * JRA には存在しないため null になる（描画側で項目ごと出さない）。
 */
export function statsResolver() {
  return (horse) => {
    const st = horse?.horseStatsNankan;
    return st && typeof st === 'object' ? st : null;
  };
}

/** レース配列を取り出す（prediction JSON の形は南関/JRA 共通で `predictions`）。 */
export function racesOf(venueEntry) {
  const d = venueEntry?.data;
  if (Array.isArray(d?.predictions)) return d.predictions;
  if (Array.isArray(d?.races)) return d.races;
  return [];
}
