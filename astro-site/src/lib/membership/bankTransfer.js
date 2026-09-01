/**
 * bankTransfer.js — 銀行振込の入金確認を会員継続制度へ接続する（純関数）
 *
 * 正本: docs/MEMBERSHIP_REWARDS.md §7.1 / §7.6 / §7.7
 *
 * 銀行振込の流れ（既存・変更しない）:
 *   /apply で申込 → `bank-transfer-application.js` が Status='pending' / AccessEnabled=false で作成
 *   → 入金を確認して Airtable の Status を active にする
 *   → Automation が `send-payment-confirmation-auto.js` を叩き、
 *      メール送信 → `PaymentEmailSent=true` / `AccessEnabled=true` / `ExpirationDate` を書く
 *
 * 🔴 **入金確認日＝この関数が動いた日**である（TBD-9）。
 *    申込日（`CreatedAt`）は起点にしない。払っていない期間を継続期間に数えないため。
 *
 * 🔴 **判定できなければ付与しない（fail-closed）。**
 *    `plan_type` から期間が確定できない場合、月額へ丸めずに保留する。
 *
 * 🔴 **このモジュールは認可に触れない。**
 *    `AccessEnabled` / `Status` / `PlanType` を読み書きしない（静的ガードで固定）。
 */

import { MONTHLY_POINTS, PERIOD_MONTHS, buildEntryId, ENTRY_TYPE } from './rewards.js';

/**
 * `plan_type` → 1 期の月数。
 *
 * 🔴 **`send-payment-confirmation-auto.js` の `calculateExpirationDate` と同じ規則**にする。
 *    有効期限の計算と付与の計算がずれると、期限と継続月数が食い違う。
 *    片方を変えるときは両方を直すこと（テストで一致を固定している）。
 */
export const BANK_PLAN_TERM_MONTHS = Object.freeze({
  yearly: PERIOD_MONTHS.ANNUAL,          // 年払い ¥39,800 → 12 か月
  light: PERIOD_MONTHS.MONTHLY,
  'monthly-nankan': PERIOD_MONTHS.MONTHLY,
  'monthly-jra': PERIOD_MONTHS.MONTHLY,
  // 🔴 lifetime は期間が定まらない（有効期限 2099-12-31 固定）ので付与しない
});

/**
 * 1 期の月数を決める。
 * 🔴 未知・未設定・`lifetime` は **null（＝付与しない）**。既定へ丸めない。
 */
export function periodMonthsForBankPlan(planType) {
  if (typeof planType !== 'string') return null;
  const key = planType.trim();
  const months = BANK_PLAN_TERM_MONTHS[key];
  return Number.isInteger(months) && months > 0 ? months : null;
}

/**
 * 支払い期間の識別子。**冪等キーの材料**になる。
 *
 * 🔴 期ごとに 1 つ。`ExpirationDate` は入金確認のたびに更新されるので、
 *    「レコード ＋ その期の期限」で 1 期を一意に表せる。
 *    同じ入金確認をやり直しても同じ期限になるため、**二重付与しない**。
 */
export function buildBankTermRef({ recordId, expirationDate } = {}) {
  const id = typeof recordId === 'string' ? recordId.trim() : '';
  const exp = expirationDate ? String(expirationDate).slice(0, 10) : '';
  if (!id || !exp) return null;
  return `bank:${id}:${exp}`;
}

/**
 * 有効期限から **入金確認日を復元する**。
 *
 * 🔴 これが「再実行での回復」を可能にしている。
 *    `send-payment-confirmation-auto.js` は入金確認時に
 *    `ExpirationDate = その日 + 期間` を書く。したがって
 *    **`ExpirationDate − 期間 = 入金確認日`** が後からでも戻せる。
 *
 * 🔴 **現在時刻で代用しない。** 一度目の Step 5 が失敗して数日後に再実行した場合、
 *    現在時刻を使うと起点も付与日時も実際の入金日とずれる。
 *
 * @returns {string|null} `YYYY-MM-DD`。復元できなければ null
 */
export function deriveConfirmedAtFromExpiration(expirationDate, periodMonths) {
  if (!expirationDate || !Number.isInteger(periodMonths) || periodMonths <= 0) return null;
  const iso = String(expirationDate).slice(0, 10);
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getUTCDate();
  const base = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - periodMonths, 1));
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(day, lastDay));
  return base.toISOString().slice(0, 10);
}

/** 判定の理由（ログ・テスト用。利用者へは出さない）。 */
export const BANK_SKIP = Object.freeze({
  NO_EMAIL: 'no_email',
  UNKNOWN_TERM: 'unknown_term',
  NO_EXPIRATION: 'no_expiration',
  NO_RECORD_ID: 'no_record_id',
  ALREADY_STARTED: 'already_started',
  /** 入金確認日を復元できない（期間が不明など） */
  NO_CONFIRMED_AT: 'no_confirmed_at',
});

/**
 * 入金確認時に会員継続制度へ反映する内容を決める（**純関数・I/O なし**）。
 *
 * @param {object} o
 * @param {object} o.fields        Airtable のレコード（更新前）
 * @param {string} o.recordId
 * @param {string} o.expirationDate この入金で設定した有効期限
 * @param {string|null} [o.confirmedAtIso] 入金確認日。
 *   **初回実行のときだけ**「いま確認した」時刻を渡す。
 *   🔴 **再実行（回復）のときは渡さない**（null）。`ExpirationDate − 期間` から復元する。
 *   現在時刻で代用すると、数日後の再実行で起点と付与日時が実際の入金日とずれる。
 * @returns {{ startedAtIso, entry, confirmedAtIso, skipped }}
 *   startedAtIso … `MembershipStartedAt` に書く値。既に入っていれば null（**上書きしない**）
 *   entry        … 台帳へ積む付与エントリ。判定できなければ null
 */
export function planBankMembershipUpdate({
  fields = {}, recordId, expirationDate, confirmedAtIso = null,
} = {}) {
  const skipped = [];
  const email = typeof fields.Email === 'string' ? fields.Email.trim() : '';
  if (!email) skipped.push(BANK_SKIP.NO_EMAIL);
  if (!recordId) skipped.push(BANK_SKIP.NO_RECORD_ID);
  if (!expirationDate) skipped.push(BANK_SKIP.NO_EXPIRATION);

  const periodMonths = periodMonthsForBankPlan(fields.plan_type);
  if (periodMonths == null) skipped.push(BANK_SKIP.UNKNOWN_TERM);

  // 🔴 入金確認日: 初回は渡された時刻、再実行（回復）は有効期限から復元する。
  //    どちらも取れなければ **現在時刻で代用しない**（付与も起点も見送る）。
  const resolvedConfirmedAt = confirmedAtIso
    ? String(confirmedAtIso).slice(0, 10)
    : deriveConfirmedAtFromExpiration(expirationDate, periodMonths);
  if (!resolvedConfirmedAt) skipped.push(BANK_SKIP.NO_CONFIRMED_AT);

  // 🔴 起点は **初回の入金確認日**。更新（2 期目以降）で動かさない
  const alreadyStarted = !!fields.MembershipStartedAt;
  if (alreadyStarted) skipped.push(BANK_SKIP.ALREADY_STARTED);

  const startedAtIso = (!alreadyStarted && email && recordId && resolvedConfirmedAt)
    ? resolvedConfirmedAt
    : null;

  let entry = null;
  if (email && periodMonths != null && recordId && expirationDate && resolvedConfirmedAt) {
    const ref = buildBankTermRef({ recordId, expirationDate });
    const entryId = ref ? buildEntryId({ type: ENTRY_TYPE.ACCRUAL, email, ref }) : null;
    const occurredAtMs = Date.parse(`${resolvedConfirmedAt}T00:00:00.000Z`);
    if (entryId && Number.isFinite(occurredAtMs)) {
      entry = Object.freeze({
        entryId,
        type: ENTRY_TYPE.ACCRUAL,
        points: MONTHLY_POINTS * periodMonths,
        occurredAtMs,
        ref,
        periodMonths,
      });
    }
  }

  return Object.freeze({
    startedAtIso,
    entry,
    confirmedAtIso: resolvedConfirmedAt,
    skipped: Object.freeze(skipped),
  });
}
