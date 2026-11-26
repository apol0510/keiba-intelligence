/**
 * ownIndexImport.mjs — 取込（importPrediction.js / importPredictionJra.js）で KI の独自指数 OWN_INDEX_KI_V1（src/utils/ownIndexKi.js）を当てる。
 *
 * 正本: docs/spec.md §4「独自指数 OWN_INDEX_KI_V1」・docs/decisions.md 2026-11-26（MK 指示）。
 *   - OWN_INDEX_START 以降の開催は、印・役割の順を独自指数（指数 ＋ 先行力・近走・騎手・上がり・コースの 5 項目）で決める。
 *   - 買い目の作り方（mainRaceBetting.js・通常レースの本命軸 / 対抗軸）は変えない。
 *     相手を選ぶときの同じ役割内の順は従来どおり指数の高い順（displayScore = 指数 + 70 のまま）。
 *   - 公開する pt（AI指数）は 表示値 round(1.15 × 独自指数 − 20) + 70、基礎指数の列は独自評価 50 + 5 × 点。指数そのもの（computerIndex）は出さない。
 *   - 騎手成績は開催日より前の確定結果だけ（予想ファイルの騎手 × 結果の着順を馬番で照合・市場ごと）。
 *   🛑 騎手成績を読めなければ、その回の取込は従来の順のまま（fail-closed・ログにコードを出す・取込は止めない）。
 *   🛑 新聞の印・本紙順位は使わない。開催日より前の開催の予想・実績は書き換えない。
 */
import { ownOrder, addJockeyResults } from '../../src/utils/ownIndex.js';
import { ownIndexKiRace, displayOwnIndex, OWN_INDEX_KI_VERSION } from '../../src/utils/ownIndexKi.js';
import { toComputerIndex } from '../../src/utils/computerIndexContract.js';

export const OWN_INDEX_START = '2026-11-28';
/** 騎手成績を数え始める月（keiba-data-shared の予想 × 結果がそろう最初の月） */
export const JOCKEY_STATS_FROM = '2026-02';
const CONCURRENCY = 6;

export const ownIndexOn = (date) => typeof date === 'string' && date >= OWN_INDEX_START;

/** 会場名 → 会場コード（予想ファイルに venueCode が無いとき・コースの項目） */
const VENUE_CODE = Object.freeze({
  大井: 'OOI', 川崎: 'KAW', 船橋: 'FUN', 浦和: 'URA',
  東京: 'TOK', 中山: 'NAK', 京都: 'KYO', 阪神: 'HAN', 中京: 'CHU', 新潟: 'NII', 福島: 'FKS', 小倉: 'KOK', 札幌: 'SAP', 函館: 'HKD',
});
export const venueCodeOf = (raw) => (typeof raw?.venueCode === 'string' && raw.venueCode) || (typeof raw?.trackCode === 'string' && raw.trackCode) || VENUE_CODE[raw?.venue ?? raw?.track] || null;

const ROLE_AT = (i) => (i === 0 ? '本命' : i === 1 ? '対抗' : i === 2 ? '単穴' : i === 3 ? '連下最上位' : i < 7 ? '連下' : '補欠');
const ROLE_MARK = { 本命: '◎', 対抗: '○', 単穴: '▲', 連下最上位: '△', 連下: '△', 補欠: '×', 無: '-' };

function monthsBetween(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}/${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

const _memo = new Map();
export function clearJockeyStatsMemo() { _memo.clear(); }

/**
 * 開催日より前の騎手成績（keiba-data-shared の API client）。
 * @returns {Promise<Map<string, { rides: number, wins: number }>>} 読めなければ throw（呼び出し側が fail-closed にする）
 */
export async function loadJockeyStats(client, category, date) {
  const key = `${category}|${date}`;
  if (_memo.has(key)) return _memo.get(key);
  const pairs = [];
  for (const ym of monthsBetween(JOCKEY_STATS_FROM, date.slice(0, 7))) {
    const preds = await client.listDirectory(`${category}/predictions/computer/${ym}`, { ref: 'main', required: false });
    const res = await client.listDirectory(`${category}/results/${ym}`, { ref: 'main', required: false });
    if (!preds || !res) continue;
    const resByName = new Map(res.filter((e) => e.type !== 'dir').map((e) => [e.name, e]));
    for (const e of preds) {
      const m = e.name.match(/^(\d{4}-\d{2}-\d{2})-[A-Z]{3}\.json$/);
      if (m && m[1] < date && resByName.has(e.name)) pairs.push({ date: m[1], pred: e, res: resByName.get(e.name) });
    }
  }
  pairs.sort((a, b) => a.date.localeCompare(b.date) || a.pred.name.localeCompare(b.pred.name));
  const bodies = await pool(pairs, CONCURRENCY, async (p) => [
    await client.fetchJsonFromEntry(p.pred, { ref: 'main', required: false }),
    await client.fetchJsonFromEntry(p.res, { ref: 'main', required: false }),
  ]);
  const stats = new Map();
  for (const [pred, res] of bodies) if (pred && res) addJockeyResults(stats, pred, res);
  _memo.set(key, stats);
  return stats;
}

/**
 * 予想ファイル（会場 1 つ）の 1 レース → 独自指数（馬番 → 値）。
 * 入力は予想ファイルの馬（computerIndex・pastRaces〔古い順〕・jockey）。
 */
export function ownIndexForRace(rawHorses, jockeyStats, scoreRace = ownIndexKiRace, ctx = {}) {
  const horses = (Array.isArray(rawHorses) ? rawHorses : []).map((h) => ({
    number: Number(h?.number),
    base: toComputerIndex(h?.computerIndex),
    jockey: h?.jockey ?? h?.kisyu ?? '',
    recent: [...(Array.isArray(h?.pastRaces) ? h.pastRaces : Array.isArray(h?._pastRaces) ? h._pastRaces : [])].reverse(),
  })).filter((h) => Number.isInteger(h.number) && h.base != null);
  return scoreRace(horses, jockeyStats, ctx);
}

/**
 * 正規化・調整済みの会場データ（normalizeAndAdjust の戻り値）の役割を独自指数の順に付け直す（破壊的）。
 * @param {object} normalized normalizeAndAdjust の戻り値（races[].horses[]）
 * @param {object} rawVenue その会場の予想ファイル（races[].horses[] に computerIndex・pastRaces・jockey）
 * @param {{ scoreRace?: Function, version?: string }} opts scoreRace は (horses, jockeyStats, { venueCode }) → Map<馬番, { ownIndex, base, points }>（既定 ownIndexKiRace）
 * @returns {{ races: number, applied: number, missing: number }}
 */
export function applyOwnIndexToVenue(normalized, rawVenue, jockeyStats, { scoreRace = ownIndexKiRace, version = OWN_INDEX_KI_VERSION } = {}) {
  const venueCode = venueCodeOf(rawVenue) ?? venueCodeOf(normalized);
  const rawByRace = new Map((rawVenue?.races ?? []).map((r) => [Number(String(r?.raceNumber ?? r?.raceInfo?.raceNumber ?? '').replace(/\D/g, '')), r]));
  let applied = 0;
  let missing = 0;
  for (const race of normalized?.races ?? []) {
    if (!race?.hasHorseData || !Array.isArray(race.horses)) continue;
    const raw = rawByRace.get(Number(race.raceNumber));
    const index = raw ? ownIndexForRace(raw.horses, jockeyStats, scoreRace, { venueCode }) : new Map();
    if (index.size === 0) { missing++; continue; }
    const rank = new Map(ownOrder(index).map((n, i) => [n, i]));
    for (const h of race.horses) {
      const v = index.get(Number(h.number));
      if (!v) {
        h.role = '無';
        h.rawScore = 0;
        h.displayScore = 0;
      } else {
        h.role = ROLE_AT(rank.get(Number(h.number)));
        // 相手の同じ役割内の順は従来どおり指数の高い順（mainRaceBetting.js は pt ?? displayScore で並べる）
        h.rawScore = v.base;
        h.displayScore = v.base + 70;
        h.ownIndex = v.ownIndex; // 並び順だけに使う（公開しない）
        h.ownDisplay = displayOwnIndex(v.ownIndex);
        h.ownPoints = v.points;
      }
      h.mark = ROLE_MARK[h.role] ?? '-';
    }
    race.rankVersion = version;
    applied++;
  }
  return { races: (normalized?.races ?? []).length, applied, missing };
}

/** 公開する pt（AI指数）。独自指数があれば 表示値 + 70（表示値 = round(1.15 × 独自指数 − 20)）、無ければ従来の値 */
export function publishedPt(h, fallback) {
  return Number.isFinite(h?.ownDisplay) ? h.ownDisplay + 70 : fallback;
}

/** 公開する基礎指数（独自評価 50 + 5 × 点・30〜70）。独自指数の無い馬は null */
export function publishedOwnEval(h) {
  return Number.isInteger(h?.ownPoints) ? 50 + 5 * h.ownPoints : null;
}

/**
 * 取込の 1 開催分（複数会場）に独自指数を当てる。開催日が OWN_INDEX_START より前なら何もしない。
 * @param {Array<{ normalized: object, raw: object }>} venues
 * @returns {Promise<{ status: 'off' | 'applied' | 'stats_unavailable', applied?: number, missing?: number }>}
 */
export async function applyOwnIndexToDay(venues, { date, category, client, log = console.log, scoreRace = ownIndexKiRace, version = OWN_INDEX_KI_VERSION }) {
  if (!ownIndexOn(date)) return { status: 'off' };
  let stats;
  try {
    stats = await loadJockeyStats(client, category, date);
  } catch (e) {
    log(`⚠️  [OWN-INDEX] stats_unavailable ${category} ${date} code=${e?.code ?? 'error'} → 従来の順のまま`);
    return { status: 'stats_unavailable' };
  }
  let applied = 0;
  let missing = 0;
  for (const { normalized, raw } of venues) {
    const r = applyOwnIndexToVenue(normalized, raw, stats, { scoreRace, version });
    applied += r.applied;
    missing += r.missing;
  }
  log(`✅ [OWN-INDEX] ${version} ${category} ${date}: ${applied}R に適用（独自指数なし ${missing}R・騎手 ${stats.size} 人）`);
  return { status: 'applied', applied, missing };
}
