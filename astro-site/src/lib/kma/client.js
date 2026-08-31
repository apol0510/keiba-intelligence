/**
 * client.js — KMA（keiba-marketing-automation）連携クライアント
 *
 * 正本: docs/RENEWAL_2026_08.md §8
 *
 * 背景:
 *   メルマガ・ステップ配信の正本は KMA（マルチブランド MA 基盤）であり、
 *   `keiba-intelligence` ブランドは KMA 側に既に登録されている。
 *   KI 側に配信エンジンを作らない（仕様が二重化して必ず乖離するため）。
 *
 * 本モジュールの責務は **イベントの送出だけ**:
 *   - 無料登録    → 無料 onboarding シーケンスへ enroll を依頼する
 *   - 課金開始/解約 → 会員状態の変化を通知する
 *
 * 🔴 安全契約（KMA 側 `signup-enroll.js` の契約に合わせる）:
 *   - **既定 disabled**。`KMA_ENROLL_ENABLED` が 'true' でなければ何もしない（no-op）。
 *   - `KMA_BASE_URL` / `KMA_ADMIN_TOKEN` のいずれかが無ければ何もしない。
 *   - **eventId 必須**（KMA 側の冪等キー）。呼び出し側が決定論的に作る。
 *   - 既定は `mode: 'dry-run'`。実際に enroll するのは `KMA_ENROLL_WRITE_ENABLED` が 'true' のときだけ。
 *   - **呼び出し失敗を上流の処理に伝播させない**（登録・課金の完了を妨げない）。
 *   - token・メールアドレスをログに出さない。
 */

const BRAND_ID = 'keiba-intelligence';

/** タイムアウト（ms）。上流の処理をブロックしないよう短く。 */
const TIMEOUT_MS = 4000;

export const KMA_RESULT = Object.freeze({
  DISABLED: 'disabled',
  NOT_CONFIGURED: 'not_configured',
  INVALID_INPUT: 'invalid_input',
  SENT: 'sent',
  FAILED: 'failed',
});

const isOn = (v) => typeof v === 'string' && v.trim().toLowerCase() === 'true';
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

/** env から設定を解決する。🔴 値そのものを返すのは呼び出し直前まで。 */
export function resolveKmaConfig(env) {
  const e = env || {};
  return {
    enabled: isOn(e.KMA_ENROLL_ENABLED),
    writeEnabled: isOn(e.KMA_ENROLL_WRITE_ENABLED),
    baseUrl: nonEmpty(e.KMA_BASE_URL) ? e.KMA_BASE_URL.trim().replace(/\/+$/, '') : null,
    adminToken: nonEmpty(e.KMA_ADMIN_TOKEN) ? e.KMA_ADMIN_TOKEN.trim() : null,
  };
}

/**
 * 決定論的な eventId を作る（同じ出来事からは同じ id ＝ KMA 側で冪等になる）。
 * メールアドレスは含めない（KMA へは identity として別途渡す）。
 */
export function buildEventId({ kind, identityKey, occurredAt }) {
  const day = typeof occurredAt === 'string' ? occurredAt.slice(0, 10) : '';
  return `ki:${kind}:${identityKey}:${day}`;
}

/**
 * KMA へイベントを送る。
 *
 * @param {object} o
 * @param {'signup'|'subscription-started'|'subscription-cancelled'} o.kind
 * @param {string} o.identity        KMA が受け取る identity（メールアドレス）
 * @param {string} o.eventId
 * @param {object} o.env
 * @param {Function} [o.fetchImpl]   テスト用
 * @returns {Promise<{result:string, status:number|null}>}
 */
export async function sendKmaEvent({ kind, identity, eventId, env, fetchImpl } = {}) {
  const cfg = resolveKmaConfig(env);

  if (!cfg.enabled) return { result: KMA_RESULT.DISABLED, status: null };
  if (!cfg.baseUrl || !cfg.adminToken) return { result: KMA_RESULT.NOT_CONFIGURED, status: null };
  if (!nonEmpty(kind) || !nonEmpty(identity) || !nonEmpty(eventId)) {
    return { result: KMA_RESULT.INVALID_INPUT, status: null };
  }

  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') return { result: KMA_RESULT.NOT_CONFIGURED, status: null };

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;

  try {
    const res = await doFetch(`${cfg.baseUrl}/.netlify/functions/signup-enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.adminToken}`,
      },
      body: JSON.stringify({
        brand: BRAND_ID,
        eventId,
        identity,
        kind,
        // 🔴 write は二重フラグの両方が true のときだけ要求する
        mode: cfg.writeEnabled ? 'write' : 'dry-run',
      }),
      signal: controller ? controller.signal : undefined,
    });

    // 🔴 応答本文をログへ出さない（KMA 側の内部区分・PII の露出防止）
    return {
      result: res.ok ? KMA_RESULT.SENT : KMA_RESULT.FAILED,
      status: typeof res.status === 'number' ? res.status : null,
    };
  } catch {
    return { result: KMA_RESULT.FAILED, status: null };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 上流処理から安全に呼ぶためのラッパ。**絶対に throw しない**。
 * 戻り値は運用ログ用の区分のみ（メールアドレスを含めない）。
 */
export async function notifyKma(params) {
  try {
    const r = await sendKmaEvent(params);
    if (r.result !== KMA_RESULT.DISABLED && r.result !== KMA_RESULT.NOT_CONFIGURED) {
      console.log(`ℹ️ KMA notify: kind=${params?.kind} result=${r.result} status=${r.status ?? '-'}`);
    }
    return r;
  } catch {
    return { result: KMA_RESULT.FAILED, status: null };
  }
}
