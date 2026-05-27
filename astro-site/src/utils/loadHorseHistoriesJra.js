/**
 * loadHorseHistoriesJra.js
 *
 * astro-site/src/data/horseHistories/jra/YYYY/MM/YYYY-MM-DD-{VENUE_CODE}.json を読み込み、
 * **表示専用** の「過去走配列」を生成して各 horse に注入する。
 *
 * 設計方針:
 *   - 既存 horse.recentRaces は一切上書きしない。注入先は別フィールド recentRacesFromHistories。
 *   - 計算系 (featureScores / mainRaceBetting / adjustPrediction 等) は引き続き
 *     horse.recentRaces を読むため副作用ゼロ。
 *   - データ源は horseHistories.history (全レース履歴)。レース当日 date と一致する race は除外。
 *   - 突合キーは horseName (prediction 側に horseId が無いため。venue 単位で読むので同名衝突は稀)。
 *   - 出力は keiba-intelligence の rf-* 表示構造に合わせる
 *     (venue=フル名 "中京"、dateStr="YY/MM/DD"、distanceMeters=数値、rank=Number、time コロン→ドット変換、_fromHistories=true)。
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// このモジュールが置かれているディレクトリの絶対パス。
// Netlify Functions SSR では process.cwd() が Lambda の cwd になり、
// netlify.toml の included_files で同梱した src/data/horseHistories/** が
// 期待する位置に無いケースがあるため、bundle 相対 path も候補に入れる。
const __moduleDir = (() => {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return null;
  }
})();

const JRA_VENUE_NAME_TO_CODE = {
  '東京': 'TOK',
  '中山': 'NAK',
  '京都': 'KYO',
  '阪神': 'HAN',
  '中京': 'CHU',
  '新潟': 'NII',
  '福島': 'FKS',
  '小倉': 'KOK',
  '札幌': 'SAP',
  '函館': 'HKD',
};

export function jraVenueCodeFromName(name) {
  if (!name) return null;
  return JRA_VENUE_NAME_TO_CODE[name] || null;
}

/**
 * 指定 date/venueCode の horseHistories JSON を読み込む。無ければ null。
 *
 * Netlify Functions SSR では process.cwd() だけでは読めないため、
 * 複数候補 path を順に試して最初に存在するものを採用する。
 *   1. projectRoot (= process.cwd() 既定) 起点
 *      → local build / prerender 時に astro-site/ で動作
 *   2. このモジュール (bundle 後の entry) の dir 起点
 *      → SSR Function bundle で esbuild バンドル後でも有効
 *   3. /var/task 起点 (Netlify Functions の Lambda root)
 *      → included_files で同梱された場合の最終 fallback
 *
 * どれも存在しなければ null を返し、呼び出し側で recentRaces にフォールバック。
 */
export function loadHorseHistoriesForVenue(date, venueCode, projectRoot = process.cwd()) {
  if (!date || !venueCode) return null;
  const m = String(date).match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!m) return null;
  const [year, month] = [m[1], m[2]];
  const filename = `${date}-${venueCode}.json`;
  const subPath = join('src', 'data', 'horseHistories', 'jra', year, month, filename);

  const candidates = [];
  if (projectRoot) candidates.push(join(projectRoot, subPath));
  if (__moduleDir) {
    // utils/ から見て ../data/horseHistories/... (リポジトリ上の物理配置)
    candidates.push(join(__moduleDir, '..', 'data', 'horseHistories', 'jra', year, month, filename));
    // bundle ルート (.netlify/v1/functions/ssr/) と同階層に同梱された場合
    candidates.push(join(__moduleDir, subPath));
    // bundle dir の親に同梱された場合
    candidates.push(join(__moduleDir, '..', subPath));
    candidates.push(join(__moduleDir, '..', '..', subPath));
    candidates.push(join(__moduleDir, '..', '..', '..', subPath));
  }
  // Netlify Functions の Lambda 標準 cwd
  candidates.push(join('/var/task', subPath));

  let file = null;
  for (const c of candidates) {
    if (existsSync(c)) { file = c; break; }
  }
  if (!file) return null;

  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * horseHistories.horses (horseId keyed) を horseName -> entry の Map に変換。
 * 同名衝突は最初の1件のみ。
 */
export function buildHorseNameIndex(historiesJson) {
  const idx = new Map();
  if (!historiesJson || typeof historiesJson !== 'object') return idx;
  const horses = historiesJson.horses || {};
  for (const entry of Object.values(horses)) {
    if (!entry || typeof entry !== 'object') continue;
    const name = entry.horseName;
    if (!name) continue;
    if (!idx.has(name)) idx.set(name, entry);
  }
  return idx;
}

// horseHistories の race entry を keiba-intelligence rf-* 表示用に変換。
//   keiba-intelligence display の参照フィールド:
//     r.venue (rf-venue にそのまま) / r._dateStr (rf-date 用) / r.distanceMeters (rf-dist)
//     r.rank / r.finishStatus / r.time (1.25.4 ドット形式) / r.last3f / r.paceType
//   _fromHistories: true で display 側が "新聞由来 recentRaceMeta() を通さない" 分岐に入る。
function convertHistoryRaceToKiShape(h) {
  if (!h || typeof h !== 'object') return null;
  const dm = String(h.date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const dateStr = dm ? `${dm[1].slice(2)}/${dm[2]}/${dm[3]}` : '';
  const finishNum = Number(h.finish);
  const rank = Number.isFinite(finishNum) ? finishNum : null;
  const finishStatus = (typeof h.finish === 'string' && !Number.isFinite(finishNum)) ? h.finish : '';
  const distanceMetersNum = Number(h.distanceMeters);
  const distanceMeters = Number.isFinite(distanceMetersNum) ? distanceMetersNum : null;
  // horseHistories の time は "1:25.4"、display 側の regex は /\d\.\d\d\.\d/ (ドット形式) を期待。コロン→ドット変換。
  const time = h.time ? String(h.time).replace(/:/g, '.') : '';
  return {
    venue: h.venue || '',
    distanceMeters,
    rank,
    finishStatus,
    time,
    last3f: '',
    paceType: '',
    _dateStr: dateStr,
    _fromHistories: true,
  };
}

/**
 * 1頭ぶんの horseHistories から、表示用 race 配列 (最大 5 走) を生成する。
 * history (全レース履歴) を使用し、excludeDate と一致する race は除外、最大 5 走。
 *
 * recent5 は仕様上 [0]=当日レース を含むため、当日除外後は最大 4 走しか取れず
 * 「最大 5 走表示」の目的を満たせない。よって全件保持の history を使う。
 */
export function pickRecentRacesFromHistories(horseHistoryEntry, excludeDate) {
  if (!horseHistoryEntry || typeof horseHistoryEntry !== 'object') return null;
  const source = Array.isArray(horseHistoryEntry.history)
    ? horseHistoryEntry.history
    : (Array.isArray(horseHistoryEntry.recent5) ? horseHistoryEntry.recent5 : null);
  if (!source) return null;
  const filtered = source.filter((r) => r && r.date !== excludeDate);
  const converted = filtered.slice(0, 5).map(convertHistoryRaceToKiShape).filter(Boolean);
  return converted.length > 0 ? converted : null;
}

/**
 * venues 配列内の各 horse に対し、表示専用 recentRacesFromHistories を注入する。
 * 既存 horse.recentRaces は触らない。失敗時はサイレント fallback 前提。
 *
 * @param {Array} venues  [{ venue, predictions: [{ horses: [...] }] }]
 * @param {string} date YYYY-MM-DD
 * @param {string} [projectRoot]
 */
export function injectHorseHistoriesIntoVenues(venues, date, projectRoot) {
  if (!Array.isArray(venues) || venues.length === 0 || !date) return;
  for (const venueData of venues) {
    const venueCode = jraVenueCodeFromName(venueData?.venue);
    if (!venueCode) continue;
    const historiesJson = loadHorseHistoriesForVenue(date, venueCode, projectRoot);
    if (!historiesJson) continue;
    const nameIndex = buildHorseNameIndex(historiesJson);
    if (nameIndex.size === 0) continue;
    for (const race of (venueData.predictions || [])) {
      for (const horse of (race?.horses || [])) {
        if (!horse || !horse.horseName) continue;
        const histHorse = nameIndex.get(horse.horseName);
        if (!histHorse) continue;
        const built = pickRecentRacesFromHistories(histHorse, date);
        if (built && built.length > 0) {
          horse.recentRacesFromHistories = built;
        }
      }
    }
  }
}
