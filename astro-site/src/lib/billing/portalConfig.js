/**
 * portalConfig — KI が開くカスタマーポータルの構成（解約できない構成）
 *
 * 正本: docs/WITHDRAWAL_2026_10.md §5（2026-10-06 MK 確定）
 *
 * 🔴 ポータルに残す機能は **お支払い方法の変更・請求履歴・氏名/住所の変更** だけ。
 *    - 解約（subscription_cancel）: 無効。退会はマイページから即時のみ
 *    - プラン変更（subscription_update）: 無効（プランは 1 本）
 *    - メールアドレスの変更: させない（KI は email で Stripe 顧客と会員を結び付けている）
 *    - ログインページ（login_page）: 無効（KI のマイページからだけ開く）
 * 🔴 構成は metadata の印で見分ける。見つかっても機能が期待と違えば **期待値へ戻す**。
 *    作成・更新・確認のどれかに失敗したら throw する（呼び出し側はポータルを開かない）。
 */

export const PORTAL_CONFIG_MARK = Object.freeze({ key: 'ki_portal', value: 'no-cancel-v1' });

/** KI が求めるポータル機能（create / update の features）。 */
export function desiredPortalFeatures() {
  return {
    payment_method_update: { enabled: true },
    invoice_history: { enabled: true },
    customer_update: { enabled: true, allowed_updates: ['name', 'address'] },
    subscription_cancel: { enabled: false },
    subscription_update: { enabled: false },
  };
}

/** 構成が KI の条件を満たしているか（解約・プラン変更・メール変更ができない）。 */
export function isSafePortalConfiguration(c) {
  const f = c?.features || {};
  if (!c?.active) return false;
  if (f.subscription_cancel?.enabled !== false) return false;
  if (f.subscription_update?.enabled === true) return false;
  if ((f.customer_update?.allowed_updates || []).includes('email')) return false;
  if (c.login_page?.enabled === true) return false;
  return true;
}

function isKiConfiguration(c) {
  return c?.metadata?.[PORTAL_CONFIG_MARK.key] === PORTAL_CONFIG_MARK.value;
}

/**
 * KI 管理の構成を返す（無ければ作る・ずれていれば直す）。
 * @returns {Promise<{ id: string }>}
 */
export async function ensurePortalConfiguration(stripe) {
  const list = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
  const mine = (list?.data || []).find(isKiConfiguration);

  let config = mine;
  if (!config) {
    config = await stripe.billingPortal.configurations.create({
      features: desiredPortalFeatures(),
      metadata: { [PORTAL_CONFIG_MARK.key]: PORTAL_CONFIG_MARK.value },
      name: 'KI: no cancellation (withdraw from mypage)',
    }, { idempotencyKey: `ki-portal-config-${PORTAL_CONFIG_MARK.value}` });
  } else if (!isSafePortalConfiguration(config)) {
    config = await stripe.billingPortal.configurations.update(config.id, {
      features: desiredPortalFeatures(),
      login_page: { enabled: false },
    });
  }

  if (!isSafePortalConfiguration(config)) {
    throw new Error('portal configuration is not safe');
  }
  return { id: config.id };
}
