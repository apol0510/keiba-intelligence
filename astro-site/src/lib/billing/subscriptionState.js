/**
 * subscriptionState — Stripe のサブスクを「マイページに出す状態」へ写す（純粋関数）
 *
 * 正本: docs/RETENTION_2026_10.md
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
  /** 解約予約中（期間末まで利用可・次回請求なし） */
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
 *    次に期間末が遅いものを選ぶ（取り消し対象を取り違えないよう決定的に選ぶ）。
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
 * 解約予約を取り消すための update パラメータ。取り消す対象でなければ null。
 *
 * 🔴 予約の表現に合わせて戻す（両方立っていれば両方戻す）。
 *    `cancel_at: ''` は Stripe API で「未設定に戻す」の意味（Emptyable）。
 */
export function resumeParams(sub) {
  if (!isCancelScheduled(sub)) return null;
  const params = {};
  if (sub.cancel_at_period_end === true) params.cancel_at_period_end = false;
  if (Number.isFinite(sub.cancel_at) && sub.cancel_at > 0) params.cancel_at = '';
  return params;
}
