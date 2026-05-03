/**
 * JRA 速報ベース 的中判定ユーティリティ
 *
 * archiveResultsJra.json の確定データが「broken」(totalPayout=0 / rank=null由来)
 * のとき、live-results (1着/2着のみ) と prediction (印情報) を組み合わせて
 * 暫定的な isHit を再計算するために使う。
 *
 * 的中ルール (KEIBA Intelligence 共通):
 *   1. 本命 (◎) または 対抗 (○) のどちらかが連対 (1着 or 2着) している
 *   2. かつ、1着と2着の両方が「不要馬以外」(マークあり/買い目内) である
 *
 * 「不要馬以外」 = 印あり (本命/対抗/単穴/連下/連下最上位) ∪ 買い目内 (axis/相手/抑え)
 */

const VALID_ROLES = new Set(['本命', '対抗', '単穴', '連下', '連下最上位', '抑え']);
const AXIS_ROLES = new Set(['本命', '対抗']);

/**
 * 予想レースから「不要馬以外」の馬番セットを構築。
 * 印 + 馬単買い目に含まれる全馬番を集約する。
 */
export function buildValidHorseSet(predRace) {
  const set = new Set();
  for (const h of (predRace?.horses || [])) {
    if (VALID_ROLES.has(h.role)) {
      const n = parseInt(h.horseNumber, 10);
      if (Number.isFinite(n)) set.add(n);
    }
  }
  for (const line of (predRace?.bettingLines?.umatan || [])) {
    const m = String(line).match(/^(\d+)-(.+)$/);
    if (!m) continue;
    set.add(parseInt(m[1], 10));
    const aitePart = m[2];
    const main = aitePart.replace(/\(抑え.+\)/, '');
    main.split('.').forEach((s) => {
      const v = parseInt(s, 10);
      if (Number.isFinite(v)) set.add(v);
    });
    const osae = aitePart.match(/\(抑え([0-9.]+)\)/);
    if (osae) {
      osae[1].split('.').forEach((s) => {
        const v = parseInt(s, 10);
        if (Number.isFinite(v)) set.add(v);
      });
    }
  }
  return set;
}

/**
 * 予想レースから 本命/対抗 (軸馬) の馬番セットを構築。
 */
export function buildAxisSet(predRace) {
  const set = new Set();
  for (const h of (predRace?.horses || [])) {
    if (AXIS_ROLES.has(h.role)) {
      const n = parseInt(h.horseNumber, 10);
      if (Number.isFinite(n)) set.add(n);
    }
  }
  return set;
}

/**
 * live race × prediction race で 的中判定。
 * @param {object} liveRace - { raceNumber, results: [{position, number}] }
 * @param {object} predRace - { raceInfo, horses, bettingLines }
 * @returns {{isHit: boolean, first: number?, second: number?, reason: string?}}
 */
export function judgeLiveHit(liveRace, predRace) {
  if (!liveRace || !predRace) {
    return { isHit: false, first: null, second: null, reason: 'data不足' };
  }
  const first = liveRace.results?.find((r) => r.position === 1)?.number ?? null;
  const second = liveRace.results?.find((r) => r.position === 2)?.number ?? null;
  if (!first || !second) {
    return { isHit: false, first, second, reason: 'live未確定' };
  }
  const valid = buildValidHorseSet(predRace);
  const axis = buildAxisSet(predRace);

  const axisConnect = axis.has(first) || axis.has(second);
  const bothValid = valid.has(first) && valid.has(second);

  return {
    isHit: axisConnect && bothValid,
    first,
    second,
    reason: !axisConnect ? '軸馬不連対' : !bothValid ? '不要馬絡み' : null,
  };
}

/**
 * venueCode (TOK/KYO/NII...) → 日本語会場名 (東京/京都/新潟...)
 * archive と prediction は日本語名、live は venueCode を使うため変換に必要。
 */
export const VENUE_CODE_TO_NAME = {
  TOK: '東京',
  NAK: '中山',
  KYO: '京都',
  HAN: '阪神',
  CHU: '中京',
  KOK: '小倉',
  NII: '新潟',
  FKS: '福島',
  FUK: '福島', // alt code
  SAP: '札幌',
  HAK: '函館',
  HKD: '函館', // alt code
};
