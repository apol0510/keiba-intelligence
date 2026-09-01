/**
 * rewards.js — KI リワード台帳の集計
 *
 * 正本: docs/MEMBERSHIP_REWARDS.md §3.3
 *
 * 🔴 KI リワードは **Premium を継続することで自動的に積み上がる**。
 *    ログイン報酬・育成・クリック報酬ではない（KAA 型の仕組みを持ち込まない）。
 *
 * 🔴 **リワードは現金・預金ではない。換金可能な残高として実装しない。**
 *    - 円への換算を行う関数を作らない
 *    - 出金・送金・譲渡の経路を作らない
 *    - 表示語は「KIリワード残高」「今月の積み上げ」「次のプレゼントまであと◯◯」
 *      （禁止語は `membershipCopy.guard.test.mjs` が静的に検出する）
 *
 * 🔴 fail-closed:
 *    毎月の付与ポイント数（TBD-1）・失効期限（TBD-6）・解約時の扱い（TBD-7）は **未確定**。
 *    付与設定が無い状態で残高を「0 pt」と表示すると、確定していない制度を
 *    確定したかのように見せることになるため、**`pending` を返す**。
 */

/** 台帳エントリの種別。 */
export const ENTRY_TYPE = Object.freeze({
  /** 継続による自動付与 */
  ACCRUAL: 'accrual',
  /** プレゼント交換による減算 */
  REDEMPTION: 'redemption',
  /** 運用上の手動調整（正負どちらもありうる） */
  ADJUSTMENT: 'adjustment',
  /** 失効による減算（TBD-6 が確定するまで発生させない） */
  EXPIRY: 'expiry',
});

const ENTRY_TYPES = Object.freeze(Object.values(ENTRY_TYPE));

/**
 * 付与設定。
 *
 * 🔴 **TBD-1（未確定）。既定値を置かない。**
 *    `monthlyPoints` にも `rankMultipliers` にも仮の数字を入れてはいけない。
 */
export const ACCRUAL_UNSET = Object.freeze({
  monthlyPoints: null,
  /** ランク別の上乗せ（長期会員優遇 M-4）。未確定。 */
  rankBonusPoints: null,
});

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

/** 付与設定が使える状態か。 */
export function isAccrualConfigured(cfg) {
  if (!cfg || typeof cfg !== 'object') return false;
  return Number.isInteger(cfg.monthlyPoints) && cfg.monthlyPoints > 0;
}

/** 台帳エントリとして妥当か。壊れた行は集計から除く（例外は投げない）。 */
export function isValidEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (!isNonEmptyString(entry.entryId)) return false;
  if (!ENTRY_TYPES.includes(entry.type)) return false;
  if (!Number.isInteger(entry.points)) return false;
  if (!isFiniteNumber(entry.occurredAtMs)) return false;
  // 付与は正、交換・失効は負でなければならない（符号の取り違えを検出する）
  if (entry.type === ENTRY_TYPE.ACCRUAL && entry.points <= 0) return false;
  if (entry.type === ENTRY_TYPE.REDEMPTION && entry.points >= 0) return false;
  if (entry.type === ENTRY_TYPE.EXPIRY && entry.points >= 0) return false;
  return true;
}

/**
 * 冪等キー。同じキーの行を二度書かない（二重付与・二重交換の防止）。
 *
 * 🔴 email をそのまま含める。ログ・画面へ出さないこと（`viewFlags` 相当の配慮）。
 */
export function buildEntryId({ type, email, ref }) {
  if (!ENTRY_TYPES.includes(type) || !isNonEmptyString(email) || !isNonEmptyString(ref)) return null;
  return `${type}:${email.trim().toLowerCase()}:${ref.trim()}`;
}

/** 同一 `entryId` を 1 件に畳む（at-least-once の重複配信に耐える）。 */
export function dedupeEntries(entries) {
  const seen = new Set();
  const out = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!isValidEntry(e)) continue;
    if (seen.has(e.entryId)) continue;
    seen.add(e.entryId);
    out.push(e);
  }
  return out;
}

/**
 * 台帳を集計する。
 *
 * @param {object} o
 * @param {Array} o.entries        台帳エントリ（順不同でよい）
 * @param {object} o.accrual       付与設定（未確定なら `ACCRUAL_UNSET`）
 * @param {boolean} o.ledgerKnown  台帳を実際に読めたか（読めていないなら false）
 * @param {number} o.nowMs
 * @returns {Readonly<object>}
 *   status: 'ready' | 'pending'
 *   pending の理由は `reason`（'accrual_unset' / 'ledger_unavailable'）
 */
export function summarizeRewards({ entries, accrual, ledgerKnown = false, nowMs = Date.now() } = {}) {
  const configured = isAccrualConfigured(accrual);

  if (!configured) return pendingSummary('accrual_unset');
  if (!ledgerKnown) return pendingSummary('ledger_unavailable');

  const rows = dedupeEntries(entries);
  const balance = rows.reduce((sum, e) => sum + e.points, 0);

  const monthStart = startOfMonthMs(nowMs);
  const monthAccrual = rows
    .filter((e) => e.type === ENTRY_TYPE.ACCRUAL && e.occurredAtMs >= monthStart && e.occurredAtMs <= nowMs)
    .reduce((sum, e) => sum + e.points, 0);

  const redemptions = rows
    .filter((e) => e.type === ENTRY_TYPE.REDEMPTION)
    .sort((a, b) => b.occurredAtMs - a.occurredAtMs);

  return Object.freeze({
    status: 'ready',
    reason: null,
    /** 🔴 ポイント。円ではない。 */
    balancePoints: balance,
    monthAccrualPoints: monthAccrual,
    entryCount: rows.length,
    redemptions: Object.freeze(redemptions.map((e) => Object.freeze({
      entryId: e.entryId,
      points: e.points,
      occurredAtMs: e.occurredAtMs,
      ref: e.ref ?? null,
    }))),
  });
}

function pendingSummary(reason) {
  return Object.freeze({
    status: 'pending',
    reason,
    balancePoints: null,
    monthAccrualPoints: null,
    entryCount: null,
    redemptions: Object.freeze([]),
  });
}

function startOfMonthMs(nowMs) {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/**
 * 継続 1 か月ぶんの付与エントリを作る。
 *
 * 🔴 付与設定が未確定なら **null を返す**（0 pt の行を作らない）。
 * 🔴 ランク別の上乗せ（M-4 長期会員優遇）も未確定なら加算しない。
 *
 * @param {object} o
 * @param {object} o.accrual  付与設定
 * @param {string|null} o.rank  会員ランク（未確定なら null → 上乗せなし）
 * @param {string} o.email
 * @param {string} o.periodRef  課金期間の識別子（Stripe invoice id 等）。冪等キーに使う
 * @param {number} o.occurredAtMs
 */
export function buildAccrualEntry({ accrual, rank, email, periodRef, occurredAtMs } = {}) {
  if (!isAccrualConfigured(accrual)) return null;
  if (!isNonEmptyString(email) || !isNonEmptyString(periodRef)) return null;
  if (!isFiniteNumber(occurredAtMs)) return null;

  const bonusMap = accrual.rankBonusPoints;
  const bonus = rank && bonusMap && Number.isInteger(bonusMap[rank]) && bonusMap[rank] > 0
    ? bonusMap[rank]
    : 0;

  const points = accrual.monthlyPoints + bonus;
  const entryId = buildEntryId({ type: ENTRY_TYPE.ACCRUAL, email, ref: periodRef });
  if (!entryId) return null;

  return Object.freeze({
    entryId,
    type: ENTRY_TYPE.ACCRUAL,
    points,
    occurredAtMs,
    ref: periodRef,
  });
}

/**
 * 交換エントリを作る。
 *
 * 🔴 残高が足りない交換は **作らない**（マイナス残高を許さない）。
 * 🔴 集計が `pending`（付与設定未確定 / 台帳が読めない）なら **作らない**。
 */
export function buildRedemptionEntry({ summary, costPoints, email, redemptionId, occurredAtMs } = {}) {
  if (!summary || summary.status !== 'ready') return null;
  if (!Number.isInteger(costPoints) || costPoints <= 0) return null;
  if (summary.balancePoints < costPoints) return null;
  if (!isNonEmptyString(email) || !isNonEmptyString(redemptionId)) return null;
  if (!isFiniteNumber(occurredAtMs)) return null;

  const entryId = buildEntryId({ type: ENTRY_TYPE.REDEMPTION, email, ref: redemptionId });
  if (!entryId) return null;

  return Object.freeze({
    entryId,
    type: ENTRY_TYPE.REDEMPTION,
    points: -costPoints,
    occurredAtMs,
    ref: redemptionId,
  });
}

/**
 * 付与設定を読む（env / 設定オブジェクト）。
 * 🔴 読めない・0 以下・非整数は **未設定**として扱う（推測補完しない）。
 */
export function readAccrualConfig(source) {
  const raw = source && typeof source === 'object' ? source.KI_REWARD_ACCRUAL : null;
  let parsed = null;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return ACCRUAL_UNSET;
    }
  } else if (raw && typeof raw === 'object') {
    parsed = raw;
  }
  if (!parsed) return ACCRUAL_UNSET;

  const monthlyPoints = Number.isInteger(parsed.monthlyPoints) && parsed.monthlyPoints > 0
    ? parsed.monthlyPoints
    : null;

  let rankBonusPoints = null;
  if (parsed.rankBonusPoints && typeof parsed.rankBonusPoints === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(parsed.rankBonusPoints)) {
      if (Number.isInteger(v) && v > 0) out[k] = v;
    }
    if (Object.keys(out).length) rankBonusPoints = Object.freeze(out);
  }

  const cfg = Object.freeze({ monthlyPoints, rankBonusPoints });
  return isAccrualConfigured(cfg) ? cfg : ACCRUAL_UNSET;
}
