/**
 * subscriptionState — Stripe のサブスクを「マイページに出す状態」へ写す（純粋関数）
 *
 * 正本: docs/WITHDRAWAL_2026_10.md（退会）/ docs/RETENTION_2026_10.md（状態表示の経緯）
 *
 * 🔴 マイページへ返すのは **状態と日付だけ**。顧客 ID・email・金額の内訳・
 *    解約理由は返さない（呼び出し元はブラウザ）。
 *
 * 🔴 解約予約の表現は API 版 / 請求モードで 2 通りある。両方を「解約予約中」と扱う。
 *      - 旧来: `cancel_at_period_end: true`
 *      - flexible 請求モード（KI の本番）: `cancel_at_period_end: false` ＋ `cancel_at: <期間末>`
 *        （2026-10 の本番イベントで実測。ポータルから解約するとこちらになる）
 */

/** 有効とみなすサブスク状態（stripe-webhook.js と同じ）。 */
export const ACTIVE_STATUSES = new Set(['active', 'trialing']);

export const SUB_STATE = Object.freeze({
  /** 継続中（次回更新あり） */
  ACTIVE: 'active',
  /**
   * 解約予約中（期間末まで利用可・次回請求なし）。
   * 🔴 2026-10-06 以降、KI は新しい予約を作らない（ポータルの解約も無効）。
   *    既存の予約を **表示するためだけ**に残している。取り消し機能は無い。
   */
  CANCEL_SCHEDULED: 'cancel_scheduled',
  /** 有効なサブスクが無い（銀行振込・未加入・終了済み） */
  NONE: 'none',
});

const DAY_MS = 24 * 60 * 60 * 1000;

function toIso(sec) {
  return Number.isFinite(sec) && sec > 0 ? new Date(sec * 1000).toISOString() : null;
}

/**
 * 現在の期間末（秒）。
 * 🔴 新しい API 版では `current_period_end` がサブスク直下から items へ移った。両方を見る。
 */
export function currentPeriodEndSec(sub) {
  const top = sub?.current_period_end;
  if (Number.isFinite(top) && top > 0) return top;
  const item = sub?.items?.data?.[0]?.current_period_end;
  return Number.isFinite(item) && item > 0 ? item : null;
}

/** 解約予約中か。 */
export function isCancelScheduled(sub) {
  if (!sub || !ACTIVE_STATUSES.has(sub.status)) return false;
  if (sub.cancel_at_period_end === true) return true;
  return Number.isFinite(sub.cancel_at) && sub.cancel_at > 0;
}

/**
 * 有効なサブスク一覧から、マイページに出す 1 件を選ぶ。
 * 🔴 KI のプレミアムは 1 人 1 契約。複数あれば「継続中」を優先し、
 *    次に期間末が遅いものを選ぶ（表示を決定的にする）。
 */
export function pickSubscription(subs) {
  const active = (subs || []).filter((s) => s && ACTIVE_STATUSES.has(s.status));
  if (!active.length) return null;
  return [...active].sort((a, b) => {
    const ca = isCancelScheduled(a) ? 1 : 0;
    const cb = isCancelScheduled(b) ? 1 : 0;
    if (ca !== cb) return ca - cb;
    return (currentPeriodEndSec(b) || 0) - (currentPeriodEndSec(a) || 0);
  })[0];
}

/**
 * マイページ用の要約。
 * @returns {{ state: string, renewsAt: string|null, endsAt: string|null, daysLeft: number|null }}
 */
export function summarizeSubscription(sub, nowMs = Date.now()) {
  if (!sub || !ACTIVE_STATUSES.has(sub.status)) {
    return { state: SUB_STATE.NONE, renewsAt: null, endsAt: null, daysLeft: null };
  }
  if (isCancelScheduled(sub)) {
    const endSec = Number.isFinite(sub.cancel_at) && sub.cancel_at > 0 ? sub.cancel_at : currentPeriodEndSec(sub);
    const endsAt = toIso(endSec);
    const daysLeft = endsAt ? Math.max(0, Math.ceil((Date.parse(endsAt) - nowMs) / DAY_MS)) : null;
    return { state: SUB_STATE.CANCEL_SCHEDULED, renewsAt: null, endsAt, daysLeft };
  }
  return { state: SUB_STATE.ACTIVE, renewsAt: toIso(currentPeriodEndSec(sub)), endsAt: null, daysLeft: null };
}

/**
 * 退会（即時終了）の対象を決める（純関数）。docs/WITHDRAWAL_2026_10.md §3
 *
 * 🔴 本人の契約だけを対象にする:
 *    - 候補は **セッションの email で検索した Stripe 顧客**のサブスクだけ（呼び出し側）
 *    - さらにサブスクの `metadata.ki_email` がセッションの email と一致すること
 *      （webhook が会員状態を反映するときの鍵と同じ。一致しなければ反映先を取り違える）
 * 🔴 識別できないときは **終了しない**（fail-closed）:
 *    - 有効な契約が 2 件以上 → `multiple_subscriptions`
 *    - ki_email が無い・一致しない → `ownership_mismatch`
 * 🔴 解約予約中（既存の期間末キャンセル）も、本人が退会を確定したときだけ対象にする。
 *    予約を勝手に即時終了へ変換する処理はどこにも無い。
 *
 * @returns {{ ok: true, sub: object } | { ok: false, error: string, already?: boolean }}
 */
export function withdrawalTarget(subs, email) {
  const norm = (v) => String(v || '').trim().toLowerCase();
  const me = norm(email);
  const list = (subs || []).filter(Boolean);
  const active = list.filter((s) => ACTIVE_STATUSES.has(s.status));
  if (active.length === 0) {
    // 二重押し・再送: すでに KI の退会操作で終了済みなら成功として扱う（書き込まない）
    const done = list.some((s) => s.status === 'canceled'
      && s.cancellation_details?.comment === WITHDRAW_COMMENT
      && norm(s.metadata?.ki_email) === me);
    return done ? { ok: false, error: 'already_withdrawn', already: true } : { ok: false, error: 'no_active_subscription' };
  }
  if (active.length > 1) return { ok: false, error: 'multiple_subscriptions' };
  const sub = active[0];
  if (!me || norm(sub.metadata?.ki_email) !== me) return { ok: false, error: 'ownership_mismatch' };
  return { ok: true, sub };
}

/** Stripe の解約記録に残す印（KI のマイページから本人が退会したこと）。 */
export const WITHDRAW_COMMENT = 'ki_mypage_immediate_withdrawal';

/**
 * 即時終了のパラメータ。
 * 🔴 日割りの返金・クレジットは作らない（prorate=false）。未請求分の即時請求もしない（invoice_now=false）。
 *    料金・返金の扱いは利用規約 第4条のまま変えない。
 */
export function withdrawCancelParams() {
  return {
    prorate: false,
    invoice_now: false,
    cancellation_details: { comment: WITHDRAW_COMMENT },
  };
}

/** 二重押し・再送で 2 回目の終了要求にならないよう、契約ごとに 1 キー。 */
export function withdrawIdempotencyKey(sub) {
  return `ki-withdraw-${sub.id}`;
}
