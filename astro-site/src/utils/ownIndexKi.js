/**
 * ownIndexKi.js — KI の独自指数（OWN_INDEX_KI_V1）。純関数・依存は ownIndex.js だけ。
 *
 * 独自指数 = 基礎点（公表されている指数・45 以上を評価）＋ 独自評価の点（5 項目）。
 *   各項目で、評価する馬の中の上位 3 分の 1 が +1、下位 3 分の 1 が −1（全頭が同じ値の項目は使わない）。点は −5〜+5。
 *   - 先行力: 近 3 走の 1 コーナーの平均（ownIndex.js ownFactors と同じ）
 *   - 近走: 近 5 走の着順の点（ownIndex.js finishPoint）を新しい順に 1・0.8・0.6・0.4・0.2 で重み付けた平均。記録が無ければ 40
 *   - 騎手: 開催日より前の確定結果での勝率（ownFactors と同じ）
 *   - 上がり: 近 3 走の上がり 3F の最速（ownFactors と同じ）
 *   - コース: 近 5 走のうち今回と同じ競馬場での 3 着以内率 (3 着以内 + 0.5) / (走数 + 1.5)
 *   並び = 独自指数の高い順 → 基礎点の高い順 → 馬番の小さい順。
 * analytics-keiba は OWN_INDEX_V1（4 項目）を使う。KI と AK の最終の印・役割・買い目を同じにしない（AK docs/PREDICTION_LOGIC.md の共通化ルール）。
 * 検証（南関 2,399R・中央 2,699R・2026-02〜11-26）: 本命の単勝・複勝率、馬単の的中率・回収率は指数順と同等（docs/decisions.md 2026-11-26）。
 * 🛑 入力は前日に作られた予想ファイルと、開催日より前の確定結果だけ。
 */
import { ownFactors, finishPoint, jockeyKey, OWN_INDEX_MIN_BASE } from './ownIndex.js';

export const OWN_INDEX_KI_VERSION = 'OWN_INDEX_KI_V1';
export const OWN_INDEX_KI_FACTORS = Object.freeze(['early', 'form5', 'jockey', 'f3', 'course']);

/** 会場コード → 過去走の venue に含まれる文字（南関は場名・中央は 1 文字） */
export const COURSE_KEY = Object.freeze({
  OOI: '大井', KAW: '川崎', FUN: '船橋', URA: '浦和',
  TOK: '東', NAK: '中', KYO: '京', HAN: '阪', CHU: '名', NII: '新', FKS: '福', KOK: '小', SAP: '札', HKD: '函',
});

const finishOf = (run) => {
  const n = parseFloat(String(run?.finish ?? run?.rank ?? '').trim());
  return Number.isInteger(n) && n > 0 ? n : 0;
};

/** 近 5 走の着順の重み付き平均（新しい順の過去走） */
export function form5(recent) {
  const w = [1, 0.8, 0.6, 0.4, 0.2];
  let t = 0;
  let tw = 0;
  (Array.isArray(recent) ? recent : []).slice(0, 5).forEach((r, i) => {
    const f = finishOf(r);
    if (f > 0) { t += finishPoint(f) * w[i]; tw += w[i]; }
  });
  return tw > 0 ? t / tw : 40;
}

/** 近 5 走の同じ競馬場での 3 着以内率（平滑化） */
export function courseRate(recent, venueCode) {
  const key = COURSE_KEY[venueCode];
  if (!key) return 0.5 / 1.5;
  const xs = (Array.isArray(recent) ? recent : []).slice(0, 5).filter((r) => String(r?.venue ?? '').includes(key) && finishOf(r) > 0);
  return (xs.filter((r) => finishOf(r) <= 3).length + 0.5) / (xs.length + 1.5);
}

/**
 * 1 レースの独自指数（OWN_INDEX_KI_V1）。ownIndex.js ownIndexRace と同じ形を返す（ownOrder で並べられる）。
 * @param {Array<{ number, base, recent, jockey?, jockeyRecord? }>} horses recent は新しい順の過去走
 * @param {Map<string, { rides: number, wins: number }>} jockeyStats
 * @param {{ venueCode?: string }} ctx 今回の競馬場（コースの項目）
 */
export function ownIndexKiRace(horses, jockeyStats = new Map(), { venueCode } = {}) {
  const rated = (Array.isArray(horses) ? horses : [])
    .filter((h) => Number.isInteger(h?.number) && typeof h.base === 'number' && Number.isFinite(h.base) && h.base >= OWN_INDEX_MIN_BASE);
  const n = rated.length;
  const fx = new Map(rated.map((h) => {
    const f = ownFactors(h.recent, h.jockeyRecord ?? jockeyStats.get(jockeyKey(h.jockey)));
    return [h.number, { early: f.early, form5: form5(h.recent), jockey: f.jockey, f3: f.f3, course: courseRate(h.recent, venueCode) }];
  }));
  const points = new Map(rated.map((h) => [h.number, 0]));
  for (const k of OWN_INDEX_KI_FACTORS) {
    const vals = rated.map((h) => fx.get(h.number)[k]);
    if (!vals.length || Math.max(...vals) - Math.min(...vals) < 1e-9) continue;
    const order = [...rated].sort((a, b) => fx.get(b.number)[k] - fx.get(a.number)[k] || a.number - b.number);
    order.forEach((h, r) => {
      if (r < n / 3) points.set(h.number, points.get(h.number) + 1);
      else if (r >= n - n / 3) points.set(h.number, points.get(h.number) - 1);
    });
  }
  return new Map(rated.map((h) => [h.number, {
    ownIndex: h.base + points.get(h.number), base: h.base, points: points.get(h.number), factors: fx.get(h.number),
  }]));
}

/** 公開する独自指数の値（順位を変えない単調変換・同じ値にならない）: round(1.15 × 独自指数 − 20) */
export function displayOwnIndex(ownIndex) {
  return Math.round(1.15 * ownIndex - 20);
}
