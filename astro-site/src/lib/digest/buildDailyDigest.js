/**
 * buildDailyDigest.js — 開催日ダイジェスト（メルマガの報酬コンテンツの素材）
 *
 * 正本: docs/RENEWAL_2026_08.md §8.3 K-3
 *
 * 何を作るか:
 *   - **メインレース詳細**（レース展望＋出走各馬の短評）
 *   - **注目馬**（上位評価の中で、過去走の裏づけが最も厚い馬）
 *   - **穴馬**（上位評価ではないが、人気を覆した実績・上がり上位などの材料がある馬）
 *
 * 🔴 絶対条件:
 *   - **買い目（馬番組み合わせ）を一切含めない**（CLAUDE.md 絶対厳守）。
 *     入力にも `bettingLines` を渡さないし、出力にも書かない。
 *   - 推測で選ばない。**選定理由は必ず過去走・特徴量から取れた事実**とし、
 *     材料が 1 つも無い馬は選ばない（無理に埋めない）。
 *   - 純関数。I/O を持たない（ファイル書き出しは呼び出し側の責務）。
 */

import {
  buildRaceNarrativeBundle,
  buildHorseFacts,
  normalizePastRaces,
  formatRecord,
} from '../../utils/raceNarrative.js';
import { isMainRace } from '../../utils/mainRaceBetting.js';

/** 上位評価とみなす役割（注目馬の母集団）。 */
const HEADLINE_ROLES = new Set(['本命', '対抗']);

/**
 * 事実から「推せる材料」を取り出す。materials が空なら候補にしない。
 * @returns {{score:number, materials:string[]}}
 */
export function evaluateMaterials(facts, { raceVenue } = {}) {
  const materials = [];
  let score = 0;

  if (facts?.top3Streak >= 3) {
    materials.push(`${facts.top3Streak}戦続けて3着以内`);
    score += 3;
  } else if (facts?.top3Streak === 2) {
    materials.push('2戦続けて3着以内');
    score += 2;
  }

  if (facts?.sameVenue && facts.sameVenue.starts >= 2 && facts.sameVenue.top3Rate >= 0.5) {
    materials.push(`${raceVenue || '当該コース'}で${formatRecord(facts.sameVenue)}`);
    score += 2;
  }

  if (facts?.sameDistance && facts.sameDistance.starts >= 2 && facts.sameDistance.top3Rate >= 0.5) {
    materials.push(`この距離帯で${formatRecord(facts.sameDistance)}`);
    score += 2;
  }

  if (facts?.last3fFieldRank === 1 && facts.bestLast3f != null) {
    materials.push(`近走の上がり${facts.bestLast3f.toFixed(1)}はメンバー最速`);
    score += 3;
  } else if (facts?.last3fFieldRank === 2 && facts.bestLast3f != null) {
    materials.push(`近走の上がり${facts.bestLast3f.toFixed(1)}はメンバー2位`);
    score += 2;
  }

  const top = facts?.featureHighlights?.[0];
  if (top && top.rank === 1) {
    materials.push(`${top.label}が出走馬中トップ`);
    score += 2;
  } else if (top && top.rank === 2) {
    materials.push(`${top.label}が出走馬中2位`);
    score += 1;
  }

  if (facts?.upsetRun?.popularity != null && facts.upsetRun.rank != null) {
    materials.push(`${facts.upsetRun.popularity}番人気で${facts.upsetRun.rank}着に食い込んだ実績`);
    score += 3;
  }

  if (facts?.highPaceRun) {
    materials.push('ハイペースでも粘れる');
    score += 1;
  }

  return { score, materials };
}

/** 1 レースぶんの候補を作る（内部用）。 */
function candidatesForRace(race, bundle, venueName, resolveRaces) {
  const horses = Array.isArray(race?.horses) ? race.horses : [];
  const raceInfo = race?.raceInfo || {};
  const out = [];

  for (const h of horses) {
    const facts = buildHorseFacts(h, {
      raceInfo,
      fieldStats: bundle.fieldStats,
      pastRaces: normalizePastRaces(resolveRaces(h)),
    });
    const { score, materials } = evaluateMaterials(facts, { raceVenue: raceInfo.venue });
    if (!materials.length) continue;

    out.push({
      venue: venueName,
      raceNumber: raceInfo.raceNumber ?? null,
      raceName: raceInfo.raceName || null,
      horseNumber: h.horseNumber ?? null,
      horseName: h.horseName || null,
      role: h.role || null,
      score,
      materials,
      comment: bundle.horses.get(h.horseNumber)?.text || null,
    });
  }

  return out;
}

/**
 * 開催日ダイジェストを作る。
 *
 * @param {object} day  loadRaceDay の戻り（{ category, date, venues }）
 * @param {object} opts
 * @param {Function} opts.resolveRaces        horse → 生の過去走配列
 * @param {Function} [opts.resolveFeaturesFor] (race, venueEntry) → resolveFeatures
 * @param {Function} [opts.racesOf]           venueEntry → レース配列
 * @param {number}   [opts.pickCount=2]       注目馬・穴馬の最大件数
 * @returns {object} メルマガ素材（買い目を含まない）
 */
export function buildDailyDigest(day, opts = {}) {
  const racesOf = opts.racesOf || ((v) => v?.data?.predictions || []);
  const resolveRaces = opts.resolveRaces || ((h) => h?.recentRaces);
  const pickCount = opts.pickCount ?? 2;

  const digest = {
    schemaVersion: 'ki-daily-digest-v1',
    category: day?.category || null,
    date: day?.date || null,
    venues: [],
    mainRaces: [],
    spotlight: [],
    longshots: [],
    // 🔴 買い目は入れない。この鍵を追加してはいけない。
  };

  const allCandidates = [];

  for (const venue of (day?.venues || [])) {
    const races = racesOf(venue);
    if (!races.length) continue;
    digest.venues.push(venue.venueName);

    for (const race of races) {
      const raceInfo = race?.raceInfo || {};
      const resolveFeatures = opts.resolveFeaturesFor
        ? opts.resolveFeaturesFor(race, venue)
        : undefined;

      // 🔴 buildRaceNarrativeBundle には race.bettingLines を渡さない
      const bundle = buildRaceNarrativeBundle(
        { raceInfo, horses: race?.horses || [] },
        { allowMarks: true, resolveRaces, resolveFeatures },
      );

      const cands = candidatesForRace(race, bundle, venue.venueName, resolveRaces);
      allCandidates.push(...cands);

      if (isMainRace(raceInfo.raceNumber, races.length)) {
        digest.mainRaces.push({
          venue: venue.venueName,
          raceNumber: raceInfo.raceNumber ?? null,
          raceName: raceInfo.raceName || null,
          startTime: raceInfo.startTime || null,
          distance: raceInfo.distance ?? null,
          horseCount: (race?.horses || []).length,
          outlook: bundle.race?.text || null,
          conclusion: bundle.conclusion?.text || null,
          pace: bundle.paceMap?.pace || null,
          horses: (race?.horses || []).map((h) => ({
            horseNumber: h.horseNumber ?? null,
            horseName: h.horseName || null,
            role: h.role || null,
            comment: bundle.horses.get(h.horseNumber)?.text || null,
          })),
        });
      }
    }
  }

  const byScore = (a, b) => (b.score - a.score) || ((a.raceNumber ?? 99) - (b.raceNumber ?? 99));

  digest.spotlight = allCandidates
    .filter((c) => HEADLINE_ROLES.has(c.role))
    .sort(byScore)
    .slice(0, pickCount);

  digest.longshots = allCandidates
    .filter((c) => !HEADLINE_ROLES.has(c.role) && c.score >= 3)
    .sort(byScore)
    .slice(0, pickCount);

  return digest;
}

/**
 * ダイジェストを平文メール向けの文章にする。
 * 🔴 馬番の組み合わせを作らない（1 頭ずつしか書かない）。
 */
export function renderDigestText(digest) {
  if (!digest) return '';
  const lines = [];

  lines.push(`【${digest.date || ''} ${digest.venues.join('・')}】`);
  lines.push('');

  if (digest.spotlight.length) {
    lines.push('■ 注目馬');
    for (const s of digest.spotlight) {
      lines.push(`・${s.venue}${s.raceNumber}R ${s.horseNumber}番 ${s.horseName}`);
      for (const m of s.materials.slice(0, 3)) lines.push(`　- ${m}`);
    }
    lines.push('');
  }

  if (digest.longshots.length) {
    lines.push('■ 穴馬');
    for (const s of digest.longshots) {
      lines.push(`・${s.venue}${s.raceNumber}R ${s.horseNumber}番 ${s.horseName}`);
      for (const m of s.materials.slice(0, 3)) lines.push(`　- ${m}`);
    }
    lines.push('');
  }

  for (const main of digest.mainRaces) {
    lines.push(`■ メインレース ${main.venue}${main.raceNumber}R ${main.raceName || ''}`);
    if (main.outlook) lines.push(main.outlook);
    if (main.conclusion) lines.push(main.conclusion);
    lines.push('');
  }

  return lines.join('\n').trim();
}
