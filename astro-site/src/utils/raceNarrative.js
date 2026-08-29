/**
 * raceNarrative.js — 決定論ナラティブエンジン（層1）
 *
 * 正本: docs/RENEWAL_2026_08.md §5
 *
 * 目的:
 *   数値（PT・特徴量）だけの機械的な見た目をやめ、過去走・特徴量から
 *   「競馬新聞の短評」に相当する日本語の文章を **純関数で** 生成する。
 *
 * 設計原則:
 *   1. **純関数**。fetch / fs / 乱数 / Date.now を使わない。同じ入力からは常に同じ文章。
 *   2. **推測補完しない**。事実が取れない項目は文に出さない。一般論（「調子は良さそう」等）で
 *      埋めない。1 つも取れなければ「データ不足」と明示する。
 *   3. **買い目を扱わない**。bettingLines / hitLines を引数に取らないし、馬番の組み合わせを
 *      出力しない（CLAUDE.md 絶対厳守）。
 *   4. **印は tier で制御する**。role（本命/対抗/…）と pt に触れる文は `allowMarks: true` の
 *      ときだけ生成する。未登録（guest）向け出力には役割語を一切含めない。
 *
 * データ元の差異吸収:
 *   過去走は prediction JSON（recentRaces）/ entries(南関) / horseHistories(JRA) /
 *   recentHorseHistories(南関) で形が違う。normalizePastRace() で 1 つの形に揃えてから使う。
 */

/* ============================================================
   1. 正規化
   ============================================================ */

const JRA_VENUE_MAP = {
  東: '東京', 中: '中山', 京: '京都', 阪: '阪神', 小: '小倉',
  新: '新潟', 福: '福島', 札: '札幌', 函: '函館', 名: '中京',
};

/** "川崎 7.31" / "5名12.7" / "船橋" → "川崎" / "中京" / "船橋" */
export function normalizeVenue(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // 先頭の数字（回次）を落とす
  const body = s.replace(/^[0-9０-９]+/, '');
  // 空白・日付らしき部分より前を取る
  const head = body.split(/[\s　]/)[0] || body;
  // 会場名（漢字・カタカナ）だけを取り出す
  const m = head.match(/^[^\d.．/-]+/);
  const name = (m ? m[0] : head).trim();
  if (!name) return null;
  if (name.length === 1 && JRA_VENUE_MAP[name]) return JRA_VENUE_MAP[name];
  return name;
}

function toNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** "ダ1400" / "1400" / 1400 → 1400 */
function toDistanceMeters(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  const m = String(v).match(/(\d{3,4})/);
  return m ? Number(m[1]) : null;
}

/** "ダ1400" / "ダート" → "ダ" ／ "芝1600" → "芝" */
function toSurface(...candidates) {
  for (const c of candidates) {
    if (c == null) continue;
    const s = String(c);
    if (/芝/.test(s)) return '芝';
    if (/ダ/.test(s)) return 'ダ';
  }
  return null;
}

/** "1-1-1" / "5-6-7" / "4-3" → [1,1,1] */
function parsePassing(v) {
  if (v == null) return [];
  return String(v)
    .split(/[-‐−ー－\s]+/)
    .map((x) => toNumber(x))
    .filter((x) => x != null && x > 0);
}

/**
 * 日付の正規化。`YYYY-MM-DD` と JRA 側の表示用 `YY/MM/DD` の両方を受ける。
 * それ以外は null（推測で年を補わない）。
 */
export function normalizeDate(v) {
  if (typeof v !== 'string' || !v.trim()) return null;
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (m) return `20${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/**
 * 過去走 1 件を共通形へ正規化する。
 * 取れなかった項目は null のまま返す（0 や既定値で埋めない）。
 */
export function normalizePastRace(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const rank = toNumber(raw.rank ?? raw.finish ?? raw.order ?? null);
  const headCount = toNumber(raw.headCount ?? raw.entryCount ?? null);
  const passing = parsePassing(raw.passingOrder);

  return {
    date: normalizeDate(raw.date) || normalizeDate(raw._dateStr),
    venue: normalizeVenue(raw.venue),
    raceName: raw.raceName || null,
    distanceMeters: toDistanceMeters(raw.distanceMeters ?? raw.distance ?? raw._displayDistance ?? null),
    surface: toSurface(raw.surface, raw.displayDistance, raw._displayDistance, raw.distance),
    trackCondition: raw.trackCondition || null,
    rank: rank != null && rank > 0 ? rank : null,
    finishStatus: raw.finishStatus || null,
    headCount: headCount != null && headCount > 0 ? headCount : null,
    popularity: toNumber(raw.popularity),
    passing,
    firstCorner: passing.length ? passing[0] : null,
    lastCorner: passing.length ? passing[passing.length - 1] : null,
    last3f: toNumber(raw.last3f),
    time: raw.time || null,
    paceType: raw.paceType || null,
    bodyWeight: toNumber(raw.bodyWeight),
    winner: raw.winner || raw.winnerName || raw.opponentName || null,
  };
}

/** 配列を正規化し、無効な要素を除く。 */
export function normalizePastRaces(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizePastRace).filter((r) => r && (r.rank != null || r.date || r.venue));
}

/* ============================================================
   2. 事実の抽出（すべて実データ由来）
   ============================================================ */

export const STYLE_NIGE = '逃げ';
export const STYLE_SENKO = '先行';
export const STYLE_SASHI = '差し';
export const STYLE_OIKOMI = '追込';

/**
 * 通過順から脚質を判定する。
 * 1 角の絶対位置と（分かる場合は）頭数比で決める。頭数不明時は絶対位置のみ。
 */
export function detectRunningStyle(pastRaces) {
  const races = Array.isArray(pastRaces) ? pastRaces : [];
  const votes = [];

  for (const r of races.slice(0, 5)) {
    const pos = r.firstCorner;
    if (pos == null) continue;
    if (pos === 1) { votes.push(STYLE_NIGE); continue; }
    if (r.headCount && r.headCount >= 4) {
      const ratio = pos / r.headCount;
      if (ratio <= 0.35) votes.push(STYLE_SENKO);
      else if (ratio <= 0.7) votes.push(STYLE_SASHI);
      else votes.push(STYLE_OIKOMI);
    } else {
      if (pos <= 3) votes.push(STYLE_SENKO);
      else if (pos <= 7) votes.push(STYLE_SASHI);
      else votes.push(STYLE_OIKOMI);
    }
  }

  if (!votes.length) return { style: null, confidence: null, samples: 0 };

  const count = new Map();
  votes.forEach((v) => count.set(v, (count.get(v) || 0) + 1));
  let best = votes[0]; // 同数なら直近（votes[0] は最新走）を優先
  let bestN = count.get(best);
  for (const [k, n] of count) {
    if (n > bestN) { best = k; bestN = n; }
  }

  const confidence = votes.length >= 3 ? 'high' : votes.length === 2 ? 'mid' : 'low';
  return { style: best, confidence, samples: votes.length };
}

/** 着別度数 [1着-2着-3着-着外] を数える。 */
export function summarizeRecord(pastRaces, predicate = () => true) {
  const rec = { starts: 0, win: 0, second: 0, third: 0, out: 0 };
  for (const r of pastRaces || []) {
    if (r.rank == null) continue;
    if (!predicate(r)) continue;
    rec.starts += 1;
    if (r.rank === 1) rec.win += 1;
    else if (r.rank === 2) rec.second += 1;
    else if (r.rank === 3) rec.third += 1;
    else rec.out += 1;
  }
  rec.top3 = rec.win + rec.second + rec.third;
  rec.top3Rate = rec.starts ? rec.top3 / rec.starts : null;
  return rec;
}

/** 〔2-1-0-1〕形式の文字列。starts が 0 なら null。 */
export function formatRecord(rec) {
  if (!rec || !rec.starts) return null;
  return `〔${rec.win}-${rec.second}-${rec.third}-${rec.out}〕`;
}

function diffDays(fromISO, toISO) {
  if (!fromISO || !toISO) return null;
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

/**
 * レース全体の統計（馬ごとの相対比較に使う）。
 * 各馬の「直近走の最速上がり」を集めて順位を出す。
 */
export function buildFieldStats(horses, resolveRaces) {
  const entries = [];
  for (const h of horses || []) {
    const races = resolveRaces ? resolveRaces(h) : normalizePastRaces(h.recentRaces);
    const best = races
      .map((r) => r.last3f)
      .filter((x) => x != null && x > 20 && x < 60);
    entries.push({
      horseNumber: h.horseNumber,
      bestLast3f: best.length ? Math.min(...best) : null,
      style: detectRunningStyle(races).style,
    });
  }

  const ranked = entries
    .filter((e) => e.bestLast3f != null)
    .sort((a, b) => a.bestLast3f - b.bestLast3f);

  const last3fRank = new Map();
  ranked.forEach((e, i) => last3fRank.set(e.horseNumber, i + 1));

  const styleCount = { [STYLE_NIGE]: 0, [STYLE_SENKO]: 0, [STYLE_SASHI]: 0, [STYLE_OIKOMI]: 0 };
  const styleByHorse = new Map();
  for (const e of entries) {
    styleByHorse.set(e.horseNumber, e.style);
    if (e.style && styleCount[e.style] != null) styleCount[e.style] += 1;
  }

  return {
    last3fRank,
    last3fRanked: ranked.length,
    styleCount,
    styleByHorse,
    fieldSize: entries.length,
  };
}

/**
 * 1 頭ぶんの事実を抽出する。文章化はしない。
 *
 * @param {object} horse       予想 JSON の horse（recentRaces 等を含む）
 * @param {object} ctx
 * @param {object} ctx.raceInfo    { venue, distanceMeters, date, surface }
 * @param {object} [ctx.fieldStats] buildFieldStats の戻り
 * @param {object} [ctx.features]  featureScores の当該馬ぶん { speedIndex:{value,rank}, ... }
 * @param {Array}  [ctx.pastRaces] 正規化済み過去走（省略時は horse.recentRaces を正規化）
 */
export function buildHorseFacts(horse, ctx = {}) {
  const raceInfo = ctx.raceInfo || {};
  const races = ctx.pastRaces || normalizePastRaces(horse?.recentRaces);
  const facts = {
    hasData: races.length > 0,
    runs: races.length,
    style: null,
    styleConfidence: null,
    lastRun: null,
    prevRun: null,
    overall: null,
    sameVenue: null,
    sameDistance: null,
    bestLast3f: null,
    last3fFieldRank: null,
    bodyWeightDelta: null,
    layoffDays: null,
    upsetRun: null,
    highPaceRun: null,
    top3Streak: 0,
    featureHighlights: [],
    winStreakBroken: false,
  };

  if (!races.length) return facts;

  const st = detectRunningStyle(races);
  facts.style = st.style;
  facts.styleConfidence = st.confidence;

  facts.lastRun = races[0] || null;
  facts.prevRun = races[1] || null;

  facts.overall = summarizeRecord(races);

  const venue = normalizeVenue(raceInfo.venue);
  if (venue) {
    facts.sameVenue = summarizeRecord(races, (r) => r.venue === venue);
    if (!facts.sameVenue.starts) facts.sameVenue = null;
  }

  const dist = toDistanceMeters(raceInfo.distanceMeters ?? raceInfo.distance);
  if (dist) {
    facts.sameDistance = summarizeRecord(
      races,
      (r) => r.distanceMeters != null && Math.abs(r.distanceMeters - dist) <= 200,
    );
    if (!facts.sameDistance.starts) facts.sameDistance = null;
  }

  const l3 = races.map((r) => r.last3f).filter((x) => x != null && x > 20 && x < 60);
  facts.bestLast3f = l3.length ? Math.min(...l3) : null;
  if (ctx.fieldStats && ctx.fieldStats.last3fRank && horse?.horseNumber != null) {
    facts.last3fFieldRank = ctx.fieldStats.last3fRank.get(horse.horseNumber) ?? null;
  }

  if (facts.lastRun?.bodyWeight != null && facts.prevRun?.bodyWeight != null) {
    facts.bodyWeightDelta = facts.lastRun.bodyWeight - facts.prevRun.bodyWeight;
  }

  if (raceInfo.date && facts.lastRun?.date) {
    facts.layoffDays = diffDays(facts.lastRun.date, raceInfo.date);
  }

  // 人気を大きく上回った好走（人気6番手以下で3着内）
  facts.upsetRun = races.find((r) => r.rank != null && r.rank <= 3 && r.popularity != null && r.popularity >= 6) || null;

  // ハイペースでの好走
  facts.highPaceRun = races.find((r) => r.paceType === 'H' && r.rank != null && r.rank <= 3) || null;

  // 直近の連続3着内
  for (const r of races) {
    if (r.rank != null && r.rank <= 3) facts.top3Streak += 1;
    else break;
  }

  // 特徴量の突出（rank 1〜2 のみ採用）
  const f = ctx.features;
  if (f && typeof f === 'object') {
    const LABELS = {
      speedIndex: 'スピード指数',
      staminaRating: 'スタミナ',
      formTrend: '調子',
      trackCompatibility: 'コース適性',
      distanceFitness: '距離適性',
      jockeyFactor: '騎手',
    };
    for (const [key, label] of Object.entries(LABELS)) {
      const item = f[key];
      if (item && item.rank != null && item.rank <= 2 && item.value != null) {
        facts.featureHighlights.push({ key, label, rank: item.rank, value: item.value });
      }
    }
    facts.featureHighlights.sort((a, b) => a.rank - b.rank);
  }

  return facts;
}

/* ============================================================
   3. 文章化
   ============================================================ */

/** 決定論的な擬似ランダム（同じ種からは常に同じ値）。文の言い回しを散らすためだけに使う。 */
function seedOf(value) {
  const s = String(value ?? '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function pick(list, seed, salt = 0) {
  if (!list.length) return '';
  return list[(seed + salt) % list.length];
}

function ordinalRank(n) {
  return `${n}着`;
}

function venueDistanceLabel(r) {
  const parts = [];
  if (r.venue) parts.push(r.venue);
  if (r.distanceMeters) parts.push(`${r.surface || ''}${r.distanceMeters}m`);
  return parts.join('');
}

/** 前走を 1 文にする。 */
function sentenceLastRun(facts, seed) {
  const r = facts.lastRun;
  if (!r) return null;

  const where = venueDistanceLabel(r);
  const head = where ? `前走は${where}で` : '前走は';

  if (r.rank == null) {
    return r.finishStatus ? `${head}${r.finishStatus}。` : null;
  }

  const detail = [];
  if (r.popularity != null && r.headCount != null) detail.push(`${r.headCount}頭立ての${r.popularity}番人気`);
  else if (r.popularity != null) detail.push(`${r.popularity}番人気`);

  const tail = [];
  if (r.last3f != null) tail.push(`上がり${r.last3f.toFixed(1)}`);
  if (r.passing.length >= 2) tail.push(`通過${r.passing.join('-')}`);

  let core;
  if (r.rank === 1) {
    core = pick(['勝ち切った', '押し切った', '完勝'], seed, 1);
  } else if (r.rank <= 3) {
    core = `${ordinalRank(r.rank)}`;
  } else if (r.headCount && r.rank >= r.headCount - 1) {
    core = `${ordinalRank(r.rank)}と苦戦`;
  } else {
    core = `${ordinalRank(r.rank)}`;
  }

  let s = head;
  if (detail.length) s += `${detail.join('')}で`;
  s += core;
  if (tail.length) s += `（${tail.join('・')}）`;
  s += '。';
  return s;
}

/** 適性（コース・距離）を 1 文にする。強い方を優先。 */
function sentenceAptitude(facts, raceInfo, seed) {
  const cands = [];

  if (facts.sameVenue && facts.sameVenue.starts >= 2) {
    const rec = formatRecord(facts.sameVenue);
    const venue = normalizeVenue(raceInfo.venue);
    const rate = facts.sameVenue.top3Rate;
    if (rate != null && rate >= 0.5) {
      const phrase = pick([
        `${venue}は${rec}と相性がよく、舞台は合う。`,
        `${venue}で${rec}と結果を残しており、条件は向く。`,
        `${venue}実績は${rec}。コースへの不安はない。`,
      ], seed, 5);
      cands.push({ score: 3 + rate, text: phrase });
    } else if (facts.sameVenue.starts >= 3 && rate === 0) {
      cands.push({ score: 1, text: `${venue}では${rec}と結果が出ていない。` });
    } else {
      cands.push({ score: 1.5, text: `${venue}は${rec}。` });
    }
  }

  if (facts.sameDistance && facts.sameDistance.starts >= 2) {
    const rec = formatRecord(facts.sameDistance);
    const d = toDistanceMeters(raceInfo.distanceMeters ?? raceInfo.distance);
    const rate = facts.sameDistance.top3Rate;
    if (rate != null && rate >= 0.5) {
      const phrase = pick([
        `${d}m前後は${rec}で、この距離帯は守備範囲。`,
        `${d}m前後で${rec}。距離への対応は済んでいる。`,
        `${d}m前後は${rec}と手堅い。`,
      ], seed, 6);
      cands.push({ score: 3 + rate, text: phrase });
    } else {
      cands.push({ score: 1.4, text: `${d}m前後は${rec}。` });
    }
  }

  if (!cands.length) return null;
  cands.sort((a, b) => b.score - a.score);
  return cands[0].text;
}

/** 脚質・展開の 1 文。 */
function sentenceStyle(facts, fieldStats, seed) {
  if (!facts.style) return null;
  const s = facts.style;

  const variants = {
    [STYLE_NIGE]: ['ハナを切るタイプ', '主導権を取りたい型'],
    [STYLE_SENKO]: ['前々で運ぶ型', '好位を取れる脚質'],
    [STYLE_SASHI]: ['中団から差す型', '脚を溜めて伸びるタイプ'],
    [STYLE_OIKOMI]: ['後方から追い込む型', '末脚に賭けるタイプ'],
  };
  const label = pick(variants[s] || [s], seed, 2);

  // 展開との噛み合わせ（逃げ馬の数が分かるときのみ）
  if (fieldStats && fieldStats.styleCount) {
    const front = (fieldStats.styleCount[STYLE_NIGE] || 0) + (fieldStats.styleCount[STYLE_SENKO] || 0);
    if (s === STYLE_NIGE && (fieldStats.styleCount[STYLE_NIGE] || 0) >= 2) {
      return `${label}だが、同型が複数おり主導権争いは激しくなりそう。`;
    }
    if ((s === STYLE_SASHI || s === STYLE_OIKOMI) && front >= 4) {
      return `${label}。前が飛ばす組み合わせなら展開は向く。`;
    }
    if (s === STYLE_SENKO && front <= 2) {
      return `${label}。前がそろわず楽に運べる可能性がある。`;
    }
  }
  return `${label}。`;
}

/** 上がり・特徴量の 1 文。 */
function sentenceEdge(facts, seed) {
  const bits = [];

  if (facts.last3fFieldRank != null && facts.last3fFieldRank <= 3 && facts.bestLast3f != null) {
    const label = facts.last3fFieldRank === 1 ? 'メンバー最速' : `メンバー${facts.last3fFieldRank}位`;
    bits.push(`近走の上がり${facts.bestLast3f.toFixed(1)}は${label}`);
  }

  if (facts.featureHighlights.length) {
    const top = facts.featureHighlights[0];
    const label = top.rank === 1 ? '出走馬中トップ' : '出走馬中2位';
    bits.push(`${top.label}は${label}`);
  }

  if (!bits.length) return null;
  return `${bits.join('、')}。`;
}

/** 状態（馬体重・休養・連続好走）の 1 文。 */
function sentenceCondition(facts, seed) {
  const bits = [];

  if (facts.top3Streak >= 3) bits.push(`${facts.top3Streak}戦続けて3着以内`);
  else if (facts.top3Streak === 2) bits.push('2戦続けて好走中');

  if (facts.bodyWeightDelta != null && Math.abs(facts.bodyWeightDelta) >= 8) {
    const sign = facts.bodyWeightDelta > 0 ? '+' : '';
    bits.push(`前走は馬体${sign}${facts.bodyWeightDelta}kg`);
  }

  if (facts.layoffDays != null) {
    if (facts.layoffDays >= 90) bits.push(`${Math.round(facts.layoffDays / 30)}か月ぶりの実戦`);
    else if (facts.layoffDays <= 8) bits.push('連闘');
  }

  if (facts.upsetRun && facts.upsetRun.popularity != null && facts.upsetRun.rank != null) {
    bits.push(`${facts.upsetRun.popularity}番人気で${facts.upsetRun.rank}着に食い込んだ実績`);
  } else if (facts.highPaceRun) {
    bits.push('ハイペースでも粘れる');
  }

  if (!bits.length) return null;
  return `${bits.join('、')}。`;
}

/**
 * 1 頭ぶんの短評を生成する。
 *
 * @param {object} horse
 * @param {object} ctx  buildHorseFacts と同じ。加えて:
 * @param {boolean} [ctx.allowMarks=false]  true のとき役割語（本命/対抗…）を文頭に添える
 * @param {number}  [ctx.maxSentences=3]
 * @returns {{ text: string, sentences: string[], facts: object, insufficient: boolean }}
 */
export function buildHorseNarrative(horse, ctx = {}) {
  const facts = ctx.facts || buildHorseFacts(horse, ctx);
  const raceInfo = ctx.raceInfo || {};
  const seed = seedOf(`${horse?.horseNumber ?? ''}:${horse?.horseName ?? ''}`);
  const maxSentences = ctx.maxSentences ?? 3;

  if (!facts.hasData) {
    return {
      text: '過去走のデータが取得できていないため、今回は数値のみでの評価となる。',
      lead: null,
      sentences: ['過去走のデータが取得できていないため、今回は数値のみでの評価となる。'],
      facts,
      insufficient: true,
    };
  }

  const ordered = [
    sentenceLastRun(facts, seed),
    sentenceAptitude(facts, raceInfo, seed),
    sentenceEdge(facts, seed),
    sentenceStyle(facts, ctx.fieldStats, seed),
    sentenceCondition(facts, seed),
  ].filter(Boolean);

  const sentences = ordered.slice(0, maxSentences);

  if (!sentences.length) {
    return {
      text: '判断材料になる過去走の記録が不足している。',
      lead: null,
      sentences: ['判断材料になる過去走の記録が不足している。'],
      facts,
      insufficient: true,
    };
  }

  // 役割語は allowMarks のときだけ添える（guest には出さない）
  //
  // 🔴 `sentences` には **役割語を含めない**。
  //    一覧の抜粋（閉じた行に出す 1 文）が「ヒモまで。」だけになってしまい、
  //    無料会員のほうが未登録より情報が乏しくなるため（2026-08-29 修正）。
  //    役割語は `lead` として分けて返し、`text` にだけ連結する。
  let lead = null;
  if (ctx.allowMarks && horse?.role) {
    const ROLE_LEAD = {
      本命: '本命に推す。',
      対抗: '対抗に取る。',
      単穴: '単穴として警戒。',
      連下最上位: 'ヒモの最上位。',
      連下: 'ヒモまで。',
      補欠: '評価は控えめ。',
    };
    lead = ROLE_LEAD[horse.role] || null;
  }

  return {
    text: `${lead || ''}${sentences.join('')}`,
    lead,
    sentences,
    facts,
    insufficient: false,
  };
}

/* ============================================================
   4. レース単位の展望・展開
   ============================================================ */

/**
 * 想定隊列。逃げ → 先行 → 差し → 追込 の順に馬番を並べる。
 * 脚質が取れない馬は unknown に入れる（推測で割り当てない）。
 */
export function buildPaceMap(horses, ctx = {}) {
  const resolve = ctx.resolveRaces || ((h) => normalizePastRaces(h.recentRaces));
  const groups = {
    [STYLE_NIGE]: [], [STYLE_SENKO]: [], [STYLE_SASHI]: [], [STYLE_OIKOMI]: [], unknown: [],
  };

  for (const h of horses || []) {
    const st = detectRunningStyle(resolve(h));
    const key = st.style || 'unknown';
    groups[key].push({
      horseNumber: h.horseNumber,
      horseName: h.horseName,
      confidence: st.confidence,
      samples: st.samples,
    });
  }

  for (const k of Object.keys(groups)) {
    groups[k].sort((a, b) => (a.horseNumber ?? 99) - (b.horseNumber ?? 99));
  }

  const front = groups[STYLE_NIGE].length + groups[STYLE_SENKO].length;
  const known = horses?.length ? horses.length - groups.unknown.length : 0;

  let pace = null;
  if (known >= 4) {
    const ratio = front / known;
    if (groups[STYLE_NIGE].length >= 3 || ratio >= 0.55) pace = 'H';
    else if (groups[STYLE_NIGE].length === 0 && ratio <= 0.25) pace = 'S';
    else pace = 'M';
  }

  return { groups, pace, frontCount: front, knownCount: known };
}

const PACE_LABEL = { H: 'ハイペース', M: '平均ペース', S: 'スローペース' };

/**
 * レース展望。**印・買い目に触れない**（allowMarks でも触れない。
 * 買い目は BET_POINT_LOGIC の領域であり、本エンジンは扱わない）。
 *
 * @returns {{ text: string, sentences: string[], paceMap: object }}
 */
export function buildRaceNarrative(race, ctx = {}) {
  const raceInfo = race?.raceInfo || race || {};
  const horses = race?.horses || ctx.horses || [];
  const paceMap = ctx.paceMap || buildPaceMap(horses, ctx);
  const seed = seedOf(`${raceInfo.date ?? ''}:${raceInfo.venue ?? ''}:${raceInfo.raceNumber ?? ''}`);

  const sentences = [];

  // 1. 条件
  const dist = toDistanceMeters(raceInfo.distanceMeters ?? raceInfo.distance);
  const head = [];
  if (raceInfo.venue) head.push(normalizeVenue(raceInfo.venue));
  if (dist) head.push(`${dist}m`);
  const n = horses.length || toNumber(raceInfo.horseCount);
  if (head.length && n) {
    sentences.push(`${head.join('')}・${n}頭立て。`);
  } else if (head.length) {
    sentences.push(`${head.join('')}。`);
  }

  // 2. 展開
  const nige = paceMap.groups[STYLE_NIGE];
  if (paceMap.pace) {
    const label = PACE_LABEL[paceMap.pace];
    if (nige.length >= 2) {
      sentences.push(`逃げ候補が${nige.length}頭おり、${label}になりやすい組み合わせ。`);
    } else if (nige.length === 1) {
      sentences.push(`${nige[0].horseNumber}番が単騎で行けそうで、${label}想定。`);
    } else {
      sentences.push(`明確な逃げ馬が見当たらず、${label}想定。`);
    }
  }

  // 3. 展開が向く脚質
  if (paceMap.pace === 'H') {
    sentences.push(pick(
      ['流れが速くなるぶん、差し・追込に出番がある。', '前が競り合えば、後ろから運ぶ馬に目が向く。'],
      seed, 3,
    ));
  } else if (paceMap.pace === 'S') {
    sentences.push(pick(
      ['落ち着いた流れなら、前で運べる馬が有利。', 'スローなら位置取りがそのまま結果に出やすい。'],
      seed, 4,
    ));
  }

  // 4. 上がり最速候補（データ事実であり印ではない）
  if (ctx.fieldStats && ctx.fieldStats.last3fRanked >= 3) {
    const topEntry = [...ctx.fieldStats.last3fRank.entries()].find(([, r]) => r === 1);
    if (topEntry) sentences.push(`近走の上がり最速は${topEntry[0]}番。`);
  }

  if (!sentences.length) {
    sentences.push('展開を判断できるだけの過去走データがそろっていない。');
  }

  return { text: sentences.join(''), sentences, paceMap };
}

/**
 * 結論文。**役割語を使うため allowMarks が必須**。買い目（馬番組み合わせ）は出力しない。
 */
export function buildConclusionNarrative(race, ctx = {}) {
  if (!ctx.allowMarks) return null;
  const horses = race?.horses || [];
  const honmei = horses.find((h) => h.role === '本命');
  if (!honmei) return null;

  const facts = ctx.factsByHorse?.get?.(honmei.horseNumber)
    || buildHorseFacts(honmei, { ...ctx, raceInfo: race?.raceInfo });

  const reasons = [];
  if (facts.sameVenue && facts.sameVenue.top3Rate != null && facts.sameVenue.top3Rate >= 0.5) {
    reasons.push(`当該コースで${formatRecord(facts.sameVenue)}`);
  }
  if (facts.sameDistance && facts.sameDistance.top3Rate != null && facts.sameDistance.top3Rate >= 0.5) {
    reasons.push(`この距離帯で${formatRecord(facts.sameDistance)}`);
  }
  if (facts.last3fFieldRank === 1) reasons.push('近走の上がりがメンバー最速');
  if (facts.featureHighlights.length) reasons.push(`${facts.featureHighlights[0].label}が出走馬中上位`);
  if (facts.top3Streak >= 2) reasons.push(`${facts.top3Streak}戦続けて3着以内`);

  const name = honmei.horseName || `${honmei.horseNumber}番`;
  const sentences = [];
  if (reasons.length) {
    sentences.push(`${honmei.horseNumber}番${name}を本命に取る。`);
    sentences.push(`${reasons.slice(0, 3).join('、')}という点を評価した。`);
  } else {
    sentences.push(`${honmei.horseNumber}番${name}を本命に取る。`);
    sentences.push('過去走から強く推せる材料は多くないが、総合評価で最上位と判断した。');
  }

  return { text: sentences.join(''), sentences };
}

/* ============================================================
   5. まとめ生成（ページから 1 回呼べば全部そろう）
   ============================================================ */

/**
 * レース 1 本ぶんの文章一式を生成する。
 *
 * @param {object} race  { raceInfo, horses }
 * @param {object} opts
 * @param {boolean} [opts.allowMarks=false]   印（役割語）を出してよいか
 * @param {Function} [opts.resolveRaces]      horse → 生の過去走配列（南関 entries 等の差異吸収用）
 * @param {Function} [opts.resolveFeatures]   horse → featureScores の当該馬ぶん
 * @returns {{ race: object, horses: Map<number, object>, paceMap: object, conclusion: object|null }}
 */
export function buildRaceNarrativeBundle(race, opts = {}) {
  const horses = race?.horses || [];
  const raceInfo = race?.raceInfo || {};
  const rawResolve = opts.resolveRaces || ((h) => h?.recentRaces);
  const resolveRaces = (h) => normalizePastRaces(rawResolve(h));

  const fieldStats = buildFieldStats(horses, resolveRaces);
  const paceMap = buildPaceMap(horses, { resolveRaces });

  const byHorse = new Map();
  const factsByHorse = new Map();

  for (const h of horses) {
    const pastRaces = resolveRaces(h);
    const features = opts.resolveFeatures ? opts.resolveFeatures(h) : null;
    const facts = buildHorseFacts(h, { raceInfo, fieldStats, features, pastRaces });
    factsByHorse.set(h.horseNumber, facts);
    byHorse.set(
      h.horseNumber,
      buildHorseNarrative(h, {
        raceInfo, fieldStats, features, pastRaces, facts,
        allowMarks: !!opts.allowMarks,
        maxSentences: opts.maxSentences,
      }),
    );
  }

  const raceNarrative = buildRaceNarrative(race, { paceMap, fieldStats, resolveRaces });
  const conclusion = buildConclusionNarrative(race, {
    allowMarks: !!opts.allowMarks, factsByHorse, fieldStats,
  });

  return { race: raceNarrative, horses: byHorse, paceMap, fieldStats, conclusion };
}
