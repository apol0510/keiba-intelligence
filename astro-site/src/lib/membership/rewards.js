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
 *    **台帳が読めなければ残高を返さない**（`pending`）。0 pt と言い切らない。
 *    台帳の保存先はまだ無い（`docs/MEMBERSHIP_DATA_MIGRATION.md`）ので、
 *    本番では当面 `pending` のまま＝画面は「準備中」になる。
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
 * 毎月の付与ポイント（**確定値・2026-09-01**）。
 *
 * 🔴 正本は `docs/MEMBERSHIP_REWARDS.md` §7.1。**片方だけ変更しない。**
 *
 * 単位を意図的に円から切り離してある（1pt = ¥1 にしない）。
 * 🔴 **円換算を画面に出さないため**であり、原資の増減は「pt あたりの調達単価」という
 *    内部の話として吸収する。会員に見える 100 pt/月 は変えない。
 */
export const MONTHLY_POINTS = 100;

/** 年払い（銀行振込 ¥39,800）1 期あたりの月数（**確定値**）。 */
export const ANNUAL_TERM_MONTHS = 12;

/** 解約後にポイントを保持する日数（**確定値**）。これを過ぎたら失効。 */
export const GRACE_DAYS = 90;

/**
 * 付与設定（**確定値**）。
 *
 * 🔴 `rankBonusPoints` は **null（ランク倍率は当面なし）**。
 *    上位ランクの優遇は **ポイント量ではなく「選べる景品・記念品等の待遇」**で行う
 *    （`catalog.js` の `minRank`）。ここに倍率を足すと待遇差が二重になる。
 */
export const ACCRUAL = Object.freeze({
  monthlyPoints: MONTHLY_POINTS,
  rankBonusPoints: null,
});

/**
 * 壊れた設定に倒す先。
 * 🔴 **黙って `ACCRUAL` へ戻さない**（壊れた上書きに気づかないまま配らないため）。
 */
export const ACCRUAL_UNSET = Object.freeze({
  monthlyPoints: null,
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

/** ポイントの生死。 */
export const POINTS_STATUS = Object.freeze({
  /** 契約中。失効しない */
  ACTIVE: 'active',
  /** 解約したが 90 日以内。再加入で復活する */
  GRACE: 'grace',
  /** 解約から 90 日を過ぎた。失効 */
  EXPIRED: 'expired',
});

/**
 * 解約日からポイントの生死を決める（**確定値: 契約中は失効なし / 解約後 90 日で失効**）。
 *
 * 🔴 「継続の報酬」である以上、**契約が続いている限り失効させない**。
 *    解約で必ず期限が来るので、未使用ポイントが無限に積み上がることもない。
 *
 * @param {string|null} cancelledAtIso 解約日。契約中なら null
 * @param {number} nowMs
 */
export function resolvePointsStatus({ cancelledAtIso, nowMs = Date.now() } = {}) {
  if (!isNonEmptyString(cancelledAtIso)) {
    return Object.freeze({ status: POINTS_STATUS.ACTIVE, expiresAtMs: null, daysLeft: null });
  }
  const cancelled = Date.parse(cancelledAtIso);
  // 🔴 解約日が読めないときは失効させない（誤って残高を消さない）
  if (!Number.isFinite(cancelled) || !isFiniteNumber(nowMs)) {
    return Object.freeze({ status: POINTS_STATUS.ACTIVE, expiresAtMs: null, daysLeft: null });
  }
  const expiresAtMs = cancelled + GRACE_DAYS * 24 * 60 * 60 * 1000;
  if (nowMs >= expiresAtMs) {
    return Object.freeze({ status: POINTS_STATUS.EXPIRED, expiresAtMs, daysLeft: 0 });
  }
  return Object.freeze({
    status: POINTS_STATUS.GRACE,
    expiresAtMs,
    daysLeft: Math.ceil((expiresAtMs - nowMs) / (24 * 60 * 60 * 1000)),
  });
}

/** 90 日以内の再加入か（ポイントと価格ロックの復活条件・**確定値**）。 */
export function isWithinGrace({ cancelledAtIso, nowMs = Date.now() } = {}) {
  return resolvePointsStatus({ cancelledAtIso, nowMs }).status !== POINTS_STATUS.EXPIRED;
}

/**
 * 台帳を集計する。
 *
 * @param {object} o
 * @param {Array} o.entries        台帳エントリ（順不同でよい）
 * @param {object} [o.accrual]     付与設定（既定は確定値 `ACCRUAL`）
 * @param {boolean} o.ledgerKnown  台帳を実際に読めたか（読めていないなら false）
 * @param {string|null} [o.cancelledAtIso] 解約日。契約中なら null
 * @param {number} o.nowMs
 * @returns {Readonly<object>}
 *   status: 'ready' | 'pending' | 'expired'
 */
export function summarizeRewards({
  entries, accrual = ACCRUAL, ledgerKnown = false, cancelledAtIso = null, nowMs = Date.now(),
} = {}) {
  const configured = isAccrualConfigured(accrual);

  if (!configured) return pendingSummary('accrual_unset');
  if (!ledgerKnown) return pendingSummary('ledger_unavailable');

  // 🔴 解約後 90 日を過ぎたら残高を出さない（失効）
  const points = resolvePointsStatus({ cancelledAtIso, nowMs });
  if (points.status === POINTS_STATUS.EXPIRED) {
    return Object.freeze({
      status: 'expired',
      reason: 'grace_elapsed',
      balancePoints: null,
      monthAccrualPoints: null,
      entryCount: null,
      pointsStatus: points,
      redemptions: Object.freeze([]),
    });
  }

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
    pointsStatus: points,
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
    pointsStatus: null,
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
export function buildAccrualEntry({ accrual = ACCRUAL, rank, email, periodRef, occurredAtMs } = {}) {
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
 * 年払い（銀行振込 ¥39,800）1 期ぶんの付与エントリを作る（**確定値: 12 か月相当**）。
 *
 * 🔴 年払い会員を対象から外すと、**先にまとめて払った人が不利になる**ため対象に含める。
 *    12 か月分（100 pt × 12 = 1,200 pt）を一括で付与する。
 *
 * @param {string} o.termRef 年払い期の識別子（申込 ID 等）。冪等キーに使う
 */
export function buildAnnualAccrualEntry({ accrual = ACCRUAL, email, termRef, occurredAtMs } = {}) {
  if (!isAccrualConfigured(accrual)) return null;
  if (!isNonEmptyString(email) || !isNonEmptyString(termRef)) return null;
  if (!isFiniteNumber(occurredAtMs)) return null;

  const entryId = buildEntryId({ type: ENTRY_TYPE.ACCRUAL, email, ref: termRef });
  if (!entryId) return null;

  return Object.freeze({
    entryId,
    type: ENTRY_TYPE.ACCRUAL,
    points: accrual.monthlyPoints * ANNUAL_TERM_MONTHS,
    occurredAtMs,
    ref: termRef,
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
 *
 * 既定は確定値 `ACCRUAL`。`KI_REWARD_ACCRUAL` で上書きできるが、
 * 🔴 **上書きする場合は `docs/MEMBERSHIP_REWARDS.md` §7.1 も同時に直すこと。**
 * 🔴 上書きが壊れているときは **確定値へ黙って戻さず** `ACCRUAL_UNSET` へ倒す。
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
  // 上書きが無ければ確定値
  if (!parsed) return ACCRUAL;

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
