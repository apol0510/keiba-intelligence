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
import { createContractPrice } from './priceLock.js';
import { BANK_YEARLY_PRICE_YEN } from '../billing/plans.js';

/**
 * `plan_type` → 1 期の月数。
 *
 * 🔴 **`send-payment-confirmation-auto.js` の `calculateExpirationDate` と同じ規則**にする。
 *    有効期限の計算と付与の計算がずれると、期限と継続月数が食い違う。
 *    片方を変えるときは両方を直すこと（テストで一致を固定している）。
 */
/**
 * 銀行振込で **契約価格が正本で確定している** プラン。
 *
 * 🔴 年払い（¥39,800）だけ。他の銀行プランは確定した価格が正本に無い
 *    （ライト ¥6,600 / 月払い ¥12,000 系は廃止済み・`CLAUDE.md`）。
 *    推測で入れると M-1 の価格ロックが**誤った額で固定**されるので保存しない。
 *    保存しなければ画面は「準備中」のままで、これは fail-closed として正しい。
 */
export const BANK_CONTRACT_PRICE_YEN = Object.freeze({
  yearly: BANK_YEARLY_PRICE_YEN,
});

/** 契約価格の priceId。Stripe の Price ではないので、由来が分かる識別子にする。 */
export const BANK_PRICE_ID_PREFIX = 'bank:';

/**
 * 銀行振込年払いの価格改定日。
 *
 * `BANK_YEARLY_PRICE_YEN = 39800` は commit `3cdd0c4e`（**2026-08-30**）で新設された。
 * それ以前の年払いは **¥66,000**（`docs/decisions.md`）。
 *
 * 🔴 **この日より前に始まった契約へ現在価格を当てはめてはいけない。**
 *    M-1 は「会員が**加入した時点**の契約価格を保持する」制度であり、
 *    `ContractPriceYen` が空という理由だけで現在価格を書くと**別の金額を捏造**することになる。
 */
export const BANK_PRICE_REVISION_DATE = '2026-08-30';

/**
 * 銀行振込の契約価格を作る。確定額が無いプランは **null**（保存しない）。
 *
 * 🔴 呼び出してよいのは `planBankMembershipUpdate` が
 *    **「今回の入金確認で始まる、改定後の新規契約」だと確認できたときだけ**。
 *    この関数自体は新規かどうかを判断しない（額と形を作るだけ）。
 *
 * @param {string} planType     `plan_type`
 * @param {string} startedAtIso 契約の起点（＝**今回の入金確認日**）
 */
export function bankContractPriceFor(planType, startedAtIso) {
  const key = typeof planType === 'string' ? planType.trim() : '';
  const amountYen = BANK_CONTRACT_PRICE_YEN[key];
  if (!Number.isInteger(amountYen)) return null;
  return createContractPrice({
    amountYen,
    currency: 'jpy',
    priceId: `${BANK_PRICE_ID_PREFIX}${key}`,
    startedAtIso,
  });
}

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
/**
 * 顧客レコードが **価格改定以降に作られた**と証明できるか。
 *
 * 🔴 fail-closed。空・不正・改定前は **false**（＝現在価格を書かない）。
 * 🔴 これは「レコードの新しさ」の判定であって、契約起点の決定ではない。
 */
export function recordCreatedAfterRevision(createdAt) {
  const raw = typeof createdAt === 'string' ? createdAt.trim() : '';
  if (!raw) return false;
  const day = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return day >= BANK_PRICE_REVISION_DATE;
}

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
  /** 契約価格が正本で確定していないプラン（年払い以外）。推測で入れない */
  NO_CONTRACT_PRICE: 'no_contract_price',
  /** 今回の入金確認で契約が新しく始まらない（既存契約）。現在価格を当てはめない */
  NO_NEW_CONTRACT: 'no_new_contract',
  /** 価格改定日より前に始まった契約。現在価格とは別の金額なので書かない */
  LEGACY_CONTRACT: 'legacy_contract',
  /** 顧客レコード自体が価格改定より前から存在する。今回が初回契約ではない */
  LEGACY_RECORD: 'legacy_record',
  /** レコードの作成時期が分からない。改定後の新規だと証明できない */
  UNKNOWN_RECORD_AGE: 'unknown_record_age',
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

  /**
   * 契約価格（M-1 継続価格ロック）。
   *
   * 🔴 **今回の入金確認で契約が新しく始まる場合だけ**作る（`startedAtIso` が立つとき）。
   *    既に `MembershipStartedAt` がある会員は**過去に契約が始まっている**ので、
   *    現在価格を当てはめてはいけない（更新のたびに現在価格で上書きしたのと同じになる）。
   *
   * 🔴 さらに **起点が価格改定日以降**であることを要求する。
   *    改定前（〜2026-08-29）の年払いは **¥66,000** で、現在価格とは別物である。
   *
   * 🔴 これらを満たさない会員の契約価格は **null のまま**にする。
   *    画面は「準備中」になるが、**誤った金額を出すより正しい**（fail-closed）。
   *    実際の請求額をレコード単位で確認できたときに、別途 backfill する。
   */
  let contract = null;
  if (!email || !startedAtIso) {
    skipped.push(BANK_SKIP.NO_NEW_CONTRACT);
  } else if (startedAtIso < BANK_PRICE_REVISION_DATE) {
    // 改定前に始まった契約。現在価格を書かない
    skipped.push(BANK_SKIP.LEGACY_CONTRACT);
  } else if (!recordCreatedAfterRevision(fields.CreatedAt)) {
    /**
     * 🔴 **`MembershipStartedAt` が空 ≠ 今回が初回契約**。
     *    起点を取り逃したまま続いている旧会員は、次回更新でこの分岐に入る。
     *    その会員の起点（＝今回の入金確認日）は改定後になるため、
     *    ここを塞がないと **旧年払い（¥66,000）へ ¥39,800 を書いてしまう**。
     *
     * 🔴 `CreatedAt` は **`MembershipStartedAt` の値には使わない**（申込日であって
     *    支払い成功日ではない）。ここでは
     *    **「このレコードが改定より前から存在したか」の fail-closed 判定**にだけ使う。
     *    分からない（`CreatedAt` が空）場合も**書かない**。
     */
    skipped.push(fields.CreatedAt ? BANK_SKIP.LEGACY_RECORD : BANK_SKIP.UNKNOWN_RECORD_AGE);
  } else {
    contract = bankContractPriceFor(fields.plan_type, startedAtIso);
    if (!contract) skipped.push(BANK_SKIP.NO_CONTRACT_PRICE);
  }

  return Object.freeze({
    startedAtIso,
    entry,
    contract,
    confirmedAtIso: resolvedConfirmedAt,
    skipped: Object.freeze(skipped),
  });
}
