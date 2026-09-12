/**
 * webhookAlert.js — Stripe webhook が「静かに失敗する」のを気付けるようにする（判定のみ）
 *
 * 正本: docs/progress.md 2026-09-12
 *
 * ── なぜ要るか（2026-09-12 の UAT 事故）────────────────────────
 * `STRIPE_WEBHOOK_SECRET` が一致しておらず、Stripe の配信 4 件すべてが
 * **400 `invalid_signature`** で失敗していた。決済は成立しているのに
 * Airtable は更新されず、**こちら側には何の通知も無かった**。
 * 気付けたのは、人が Stripe ダッシュボードのエラー率を見に行ったからである。
 *
 * 🔴 この経路が壊れると「支払ったのに権限が開かない」になる。**黙って失敗させない。**
 *
 * ── 設計（決済経路を壊さないための制約）───────────────────────
 *  1. 🔴 **判定はここ（純関数）。送信は既存の `send-alert` に任せる。**
 *     `stripe-webhook` に SendGrid を持ち込まない。決済の critical path に
 *     メール送信の依存を増やさないため。
 *     （`previewMailGuard` の適用対象一覧＝送信関数の集合も変えない）
 *  2. 🔴 **本番ホスト以外では通知しない。** UAT / Deploy Preview から
 *     production の SendGrid を使わない（PR #129 の隔離契約）。
 *     UAT の異常は Stripe ダッシュボードのエラー率で見る。
 *  3. 🔴 **同じ理由で何度も送らない。** 署名不正は**未認証の入力**でも起こせるため、
 *     誰でもメールを撃たせられてはいけない。理由ごとに時間窓で 1 通だけにする。
 *  4. 🔴 **秘密値・リクエスト本文を通知に含めない。** 含めるのは
 *     「どの理由で落ちたか」と「次に何を確認するか」だけ。
 */

/** 通知する失敗の種類。これ以外は通知しない（未知の理由で撃たない）。 */
export const WEBHOOK_ALERT_REASON = Object.freeze({
  /** 署名検証に失敗した（シークレット不一致・ローテーション漏れ）。 */
  INVALID_SIGNATURE: 'invalid_signature',
  /** 鍵が入っていない（env 未設定・deploy 未反映）。 */
  NOT_CONFIGURED: 'not_configured',
});

/** 同じ理由で通知を繰り返さない時間窓。 */
export const WEBHOOK_ALERT_WINDOW_MS = 6 * 60 * 60 * 1000;

/** 通知を見送った理由（ログ用。利用者へは出さない）。 */
export const SKIP = Object.freeze({
  UNKNOWN_REASON: 'unknown_reason',
  NOT_PRODUCTION_HOST: 'not_production_host',
  NO_RECIPIENT: 'no_recipient',
  WITHIN_WINDOW: 'within_window',
  TIME_UNKNOWN: 'time_unknown',
});

/**
 * 🔴 通知してよい本番ホスト。ここに無いホストからは送らない。
 *    `previewMailGuard` は「プレビューなら止める」側の判定だが、
 *    ここは逆向きに **「本番だと分かったときだけ送る」** で閉じる（fail-closed）。
 */
const PRODUCTION_HOSTS = Object.freeze([
  'keiba-intelligence.jp',
  'www.keiba-intelligence.jp',
]);

const normalizeHost = (host) => (typeof host === 'string' ? host.trim().toLowerCase().split(':')[0] : '');

/** リクエストヘッダー（大文字小文字を問わない）から host を取り出す。 */
export function hostFromHeaders(headers) {
  if (!headers || typeof headers !== 'object') return '';
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === 'host') return normalizeHost(headers[k]);
  }
  return '';
}

/** 本番ホストか。判定できなければ false（送らない側へ倒す）。 */
export function isProductionHost(host) {
  const h = normalizeHost(host);
  return !!h && PRODUCTION_HOSTS.includes(h);
}

/**
 * 通知すべきか判定する（**純関数**。I/O を持たない）。
 *
 * @param {object} o
 * @param {string} o.reason              `WEBHOOK_ALERT_REASON` のいずれか
 * @param {object} [o.headers]           リクエストヘッダー（host を見る）
 * @param {object} [o.env]               `ALERT_EMAIL` を含む env
 * @param {number|null} [o.lastNotifiedAtMs] 同じ理由で最後に通知した時刻
 * @param {number} [o.nowMs]
 * @returns {{ notify: boolean, dedupeKey: string|null, skip: string|null }}
 */
export function shouldNotifyWebhookFailure({
  reason, headers = {}, env = {}, lastNotifiedAtMs = null, nowMs = Date.now(),
} = {}) {
  const deny = (skip) => Object.freeze({ notify: false, dedupeKey: null, skip });

  const known = Object.values(WEBHOOK_ALERT_REASON).includes(reason);
  if (!known) return deny(SKIP.UNKNOWN_REASON);

  // 🔴 本番ホスト以外では送らない（UAT から production の SendGrid を使わない）
  if (!isProductionHost(hostFromHeaders(headers))) return deny(SKIP.NOT_PRODUCTION_HOST);

  const to = typeof env.ALERT_EMAIL === 'string' ? env.ALERT_EMAIL.trim() : '';
  if (!to) return deny(SKIP.NO_RECIPIENT);

  if (!Number.isFinite(nowMs)) return deny(SKIP.TIME_UNKNOWN);

  if (Number.isFinite(lastNotifiedAtMs) && nowMs - lastNotifiedAtMs < WEBHOOK_ALERT_WINDOW_MS) {
    return deny(SKIP.WITHIN_WINDOW);
  }

  return Object.freeze({ notify: true, dedupeKey: `webhook-alert:${reason}`, skip: null });
}

/* ------------------------------------------------------------------
   🔴 この alert type を外部から発火させない（単回使用 nonce）

   `send-alert` は認証を持たない（誰でも POST できる）。そのままだと
   `type: 'stripe_webhook_failed'` を外部から直接叩けてしまい、
   webhook 側の 6 時間 dedup を**迂回して**メールを撃たせられる。

   そこで、この type だけは **`stripe-webhook` が発行した単回使用の nonce** を
   必須にする。nonce は Blobs に置かれ、`send-alert` が**検証して消す**。

   🔴 env を増やさない（新しい production secret を作らない）。
   🔴 nonce を作れるのは webhook だけ。webhook は 6 時間 dedup を通ったときしか
      発行しないので、**dedup の迂回もできない**。
   🔴 検証できないとき（nonce 無し・見つからない・期限切れ・Blobs が読めない）は
      **送らない**（fail-closed）。
   ------------------------------------------------------------------ */

/** 🔴 外部から直接発火させない alert type。 */
export const INTERNAL_ALERT_TYPE = 'stripe_webhook_failed';

/** nonce を置く Blobs ストア名。両方の関数で同じ名前を使う。 */
export const ALERT_NONCE_STORE = 'alert-nonces';

/** nonce の有効期間。発行から送信までは一瞬なので短くてよい。 */
export const ALERT_NONCE_TTL_MS = 5 * 60 * 1000;

/** この type は nonce の検証が要るか。 */
export function requiresAlertNonce(type) {
  return type === INTERNAL_ALERT_TYPE;
}

/** nonce の形（16 進 64 文字）。 */
const NONCE_RE = /^[0-9a-f]{64}$/;

export function isWellFormedNonce(nonce) {
  return typeof nonce === 'string' && NONCE_RE.test(nonce);
}

/**
 * nonce を検証する（**純関数**。Blobs の読み出し結果を渡す）。
 *
 * @param {object} o
 * @param {string} o.type
 * @param {string|null} o.nonce        リクエストで渡された nonce
 * @param {string|null} o.storedAtIso  Blobs に入っていた発行時刻（無ければ null）
 * @param {number} [o.nowMs]
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function verifyAlertNonce({ type, nonce, storedAtIso, nowMs = Date.now() } = {}) {
  // この type 以外は対象外（既存の呼び出し元に影響させない）
  if (!requiresAlertNonce(type)) return Object.freeze({ ok: true, reason: null });

  if (!isWellFormedNonce(nonce)) return Object.freeze({ ok: false, reason: 'nonce_missing' });
  if (typeof storedAtIso !== 'string' || !storedAtIso) {
    return Object.freeze({ ok: false, reason: 'nonce_unknown' });
  }
  const issuedAtMs = Date.parse(storedAtIso);
  if (!Number.isFinite(issuedAtMs)) return Object.freeze({ ok: false, reason: 'nonce_unreadable' });
  if (nowMs - issuedAtMs > ALERT_NONCE_TTL_MS) return Object.freeze({ ok: false, reason: 'nonce_expired' });
  if (issuedAtMs - nowMs > 60 * 1000) return Object.freeze({ ok: false, reason: 'nonce_future' });

  return Object.freeze({ ok: true, reason: null });
}

/** 理由ごとの「次に何を確認するか」。🔴 秘密値は書かない。 */
const NEXT_STEPS = Object.freeze({
  [WEBHOOK_ALERT_REASON.INVALID_SIGNATURE]: [
    'Stripe ダッシュボード → Webhook → 対象の送信先で、署名シークレットを確認する',
    'Netlify の STRIPE_WEBHOOK_SECRET が、その送信先のものと一致しているか確認する',
    '🔴 env は deploy 時に注入される。値を直したら再デプロイが要る',
    '直したあと、Stripe の「再送する」で失敗したイベントを送り直す（冪等なので二重反映しない）',
  ],
  [WEBHOOK_ALERT_REASON.NOT_CONFIGURED]: [
    'Netlify の STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET が設定されているか確認する',
    '🔴 env は deploy 時に注入される。設定したら再デプロイが要る',
  ],
});

/**
 * `send-alert` へ渡す本文を組み立てる（**純関数**）。
 *
 * 🔴 リクエスト本文・署名・鍵・顧客情報を**一切含めない**。
 */
export function buildWebhookAlertPayload({ reason, nowIso = new Date().toISOString() } = {}) {
  const steps = NEXT_STEPS[reason] || [];
  return Object.freeze({
    type: 'stripe_webhook_failed',
    date: nowIso,
    details: `Stripe webhook が ${reason} で失敗しています。決済が成立していても会員の権限が開きません。`,
    metadata: Object.freeze({
      reason,
      nextSteps: steps,
      // 🔴 同じ理由の通知は時間窓で 1 通だけ。以後は Stripe のエラー率で追う
      windowHours: WEBHOOK_ALERT_WINDOW_MS / (60 * 60 * 1000),
    }),
  });
}
