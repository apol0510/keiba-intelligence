/**
 * ranks.js — 会員ランクの単一定義（Bronze / Silver / Gold / Platinum）
 *
 * 正本: docs/MEMBERSHIP_REWARDS.md §3.2
 *
 * 🔴 ランク差は **リワード・プレゼント・長期待遇に限定する**。
 *    予想の精度・買い目の内容・有料情報の質に差を付けない。
 *
 * 🔴 ランクは **entitlement / tier / 認可の判断材料にしない**。
 *    `canSeeMarks` / `canSeeBetting` はランクを受け取らない（受け取らせない）。
 *
 * 🔴 fail-closed:
 *    **継続月数が分からなければランクを返さない**（`monthsKnown: false`）。Bronze へ倒さない。
 *    継続月数の起点（TBD-9）は Airtable スキーマ移行と同時に決めるため、
 *    それまでは保存された起点が無く、ランクは「準備中」になる。
 *    「継続しているのに最低ランクを表示する」ことは、根拠の無い待遇を見せることになるため。
 */

/** ランク識別子。表示名は `RANK_LABEL`。 */
export const RANK = Object.freeze({
  BRONZE: 'bronze',
  SILVER: 'silver',
  GOLD: 'gold',
  PLATINUM: 'platinum',
});

/** 低い順。昇格の順序でもある。 */
export const RANK_ORDER = Object.freeze([RANK.BRONZE, RANK.SILVER, RANK.GOLD, RANK.PLATINUM]);

/** 画面に出す表示名（英字のまま出す。仕様所有者の確定表記）。 */
export const RANK_LABEL = Object.freeze({
  [RANK.BRONZE]: 'Bronze',
  [RANK.SILVER]: 'Silver',
  [RANK.GOLD]: 'Gold',
  [RANK.PLATINUM]: 'Platinum',
});

/**
 * 昇格に必要な継続月数（**確定値・2026-09-01**）。
 *
 * 🔴 正本は `docs/MEMBERSHIP_REWARDS.md` §7.1。**片方だけ変更しない。**
 *    `membership.test.mjs` が正本の値と一致していることを固定している。
 *
 * 設計意図: サブスクの解約は 2〜3 か月目に集中しやすいので、最初の昇格（Silver）を
 * その直前の 3 か月に置く。Gold 12・Platinum 24 で 2 年目以降の継続動機を残す。
 */
export const RANK_THRESHOLDS = Object.freeze({
  [RANK.BRONZE]: 0,
  [RANK.SILVER]: 3,
  [RANK.GOLD]: 12,
  [RANK.PLATINUM]: 24,
});

/**
 * 閾値が壊れているとき（順序逆転・欠落など）に倒す先。
 * 🔴 **黙って `RANK_THRESHOLDS` へ戻さない。** 壊れた設定を無視して既定値で動くと、
 *    意図しない待遇を配ってしまう。ランクを返さない（＝「準備中」）方が安全。
 */
export const RANK_THRESHOLDS_UNSET = Object.freeze({
  [RANK.BRONZE]: null,
  [RANK.SILVER]: null,
  [RANK.GOLD]: null,
  [RANK.PLATINUM]: null,
});

const isNonNegativeInt = (v) => Number.isInteger(v) && v >= 0;

/** 既知のランク文字列か。 */
export function isRank(v) {
  return typeof v === 'string' && RANK_ORDER.includes(v);
}

/** 低いほど 0。未知は -1。 */
export function rankIndex(rank) {
  return RANK_ORDER.indexOf(rank);
}

/**
 * 閾値の設定が「使える状態」か。
 *
 * 使えると言えるのは次をすべて満たすときだけ:
 *   - 4 ランクすべてに非負整数が入っている
 *   - 最下位（Bronze）が 0 か月から始まる（継続 0 か月の会員が無ランクにならない）
 *   - 上位ほど大きい（同値・逆転を許さない）
 */
export function isRankThresholdsConfigured(thresholds) {
  if (!thresholds || typeof thresholds !== 'object') return false;
  let prev = -1;
  for (const rank of RANK_ORDER) {
    const v = thresholds[rank];
    if (!isNonNegativeInt(v)) return false;
    if (v <= prev) return false;
    prev = v;
  }
  return thresholds[RANK.BRONZE] === 0;
}

/**
 * 継続月数からランクを決める。
 *
 * @param {number|null} months  継続月数（0 以上の整数）。不明なら null
 * @param {object} [thresholds] 既定は確定値 `RANK_THRESHOLDS`
 * @returns {Readonly<object>}
 *   configured=false … 閾値が壊れている。rank は null
 *   monthsKnown=false … 継続月数が不明（起点未保存 / TBD-9）。rank は null
 */
export function resolveRank(months, thresholds = RANK_THRESHOLDS) {
  const configured = isRankThresholdsConfigured(thresholds);
  const monthsKnown = isNonNegativeInt(months);

  if (!configured || !monthsKnown) {
    return Object.freeze({
      configured,
      monthsKnown,
      months: monthsKnown ? months : null,
      rank: null,
      rankLabel: null,
      nextRank: null,
      nextRankLabel: null,
      monthsToNext: null,
      progressRatio: null,
    });
  }

  let current = RANK_ORDER[0];
  let next = null;
  for (const rank of RANK_ORDER) {
    if (months >= thresholds[rank]) {
      current = rank;
    } else {
      next = rank;
      break;
    }
  }

  const monthsToNext = next ? thresholds[next] - months : null;
  const progressRatio = next
    ? clamp01((months - thresholds[current]) / (thresholds[next] - thresholds[current]))
    : 1;

  return Object.freeze({
    configured: true,
    monthsKnown: true,
    months,
    rank: current,
    rankLabel: RANK_LABEL[current],
    nextRank: next,
    nextRankLabel: next ? RANK_LABEL[next] : null,
    monthsToNext,
    progressRatio,
  });
}

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * env / 設定オブジェクトから閾値を読む。
 *
 * 既定は確定値 `RANK_THRESHOLDS`。`KI_RANK_THRESHOLDS` を置けば上書きできるが、
 * 🔴 **上書きする場合は `docs/MEMBERSHIP_REWARDS.md` §7.1 も同時に直すこと。**
 *
 * 🔴 上書きの内容が壊れている（順序逆転・欠落・非整数）ときは
 *    **確定値へ黙って戻さず** `RANK_THRESHOLDS_UNSET`（＝ランクを出さない）へ倒す。
 *    壊れた設定に気づかないまま既定値で待遇を配るのを防ぐため。
 */
export function readRankThresholds(source) {
  const raw = source && typeof source === 'object' ? source.KI_RANK_THRESHOLDS : null;
  let parsed = null;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return RANK_THRESHOLDS_UNSET;
    }
  } else if (raw && typeof raw === 'object') {
    parsed = raw;
  }
  // 上書きが無ければ確定値
  if (!parsed) return RANK_THRESHOLDS;

  const out = {};
  for (const rank of RANK_ORDER) out[rank] = isNonNegativeInt(parsed[rank]) ? parsed[rank] : null;
  const frozen = Object.freeze(out);
  return isRankThresholdsConfigured(frozen) ? frozen : RANK_THRESHOLDS_UNSET;
}
