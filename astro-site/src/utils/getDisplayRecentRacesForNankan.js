/**
 * 南関 recentHorseHistories の「表示用」recentRaces を返す wrapper。
 *
 * 方針（Phase 6 第4段階）:
 *   - 注入済み horse.recentRacesFromHistoriesNankan があればそれを優先（表示専用）
 *   - 無ければ従来の horse.recentRaces を「そのまま」返す（既存UI互換のため正規化しない）
 *   - horse.recentRaces は一切変更しない（本関数は新しい配列を返すだけ）
 *   - 注入元のみ whitelist 正規化＋ finish→rank マッピング（rank 不在時のみ）
 *   - Feature Importance / featureScores / generateAdvancedMetrics には一切接続しない
 *   - slice / reverse は呼び出し側（表示）の既存ロジックを維持する
 *
 * 並び順:
 *   注入元 recentRacesFromHistoriesNankan は「古→新」。
 *   KI の既存 recentRaces は「新→古」のため、注入元を reverse して揃える。
 *   表示側 slice(0,5)（reverse なし・RECENT_LABELS[0]=前走、公式出馬表に合わせ最大5走）。
 */

// 注入元から表示へ渡してよい項目（内部・診断フィールドは落とす）
const DISPLAY_WHITELIST = [
  'date', 'venue', 'venueName', 'venueCode', 'raceNumber', 'raceName',
  'distance', 'distanceMeters', 'surface', 'trackCondition', 'headCount',
  'horseNumber', 'rank', 'finishStatus', 'popularity', 'bodyWeight',
  'jockey', 'carriedWeight', 'time', 'passingOrder', 'last3f', 'margin',
];

// 注入元1走を表示用に正規化（whitelist 抽出 ＋ finish→rank 補完）
function normalizeInjectedRace(r) {
  const out = {};
  for (const k of DISPLAY_WHITELIST) {
    if (r[k] !== undefined) out[k] = r[k];
  }
  // 注入元は rank を持たず finish のみ。rank 不在時だけ finish を写す。
  if (out.rank === undefined && r.finish !== undefined) out.rank = r.finish;
  return out;
}

/**
 * 表示用 recentRaces を「最初に有効な系統」から解決して返す（horse.recentRaces は不変）。
 *
 * 優先順位（表示の正本）:
 *   1. recentRacesFromEntriesNankan（出馬表 entries 由来・最優先・既に表示用形状）
 *   2. recentRacesFromHistoriesNankan（recentHorseHistories 注入・whitelist 正規化＋新→古）
 *   3. recentRaces（legacy・素通し）
 *
 * これにより legacy が空でも entries / histories に実データがあれば過去走欄を描画できる。
 * 描画側はこの戻り値の length で表示可否を判定し、slice(0,5) で最大5走に絞る
 * （実走数不足を 0 埋めしない。null/undefined/非配列は空配列として安全に扱う）。
 *
 * @param {object} horse
 * @returns {Array} 表示用 recentRaces（入力配列・horse は破壊しない）
 */
export function getDisplayRecentRacesForNankan(horse) {
  // 1. entries 由来（出馬表）— 最優先。注入時に表示用形状（rank/carriedWeight 等）へ変換済み。
  const ent = horse && horse.recentRacesFromEntriesNankan;
  if (Array.isArray(ent) && ent.length > 0) return ent;
  // 2. histories 由来（注入）— whitelist 正規化＋ finish→rank、KI 既存と同順（新→古）に揃える。
  const inj = horse && horse.recentRacesFromHistoriesNankan;
  if (Array.isArray(inj) && inj.length > 0) {
    const normalized = inj.map(normalizeInjectedRace);
    return normalized.reverse();
  }
  // 3. 注入が無ければ既存 recentRaces を素通し（正規化しない）
  return (horse && Array.isArray(horse.recentRaces)) ? horse.recentRaces : [];
}

export default getDisplayRecentRacesForNankan;
