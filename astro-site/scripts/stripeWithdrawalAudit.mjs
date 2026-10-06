/**
 * stripeWithdrawalAudit — 退会（即時のみ）の本番前提を確かめる運用スクリプト
 *
 * 正本: docs/WITHDRAWAL_2026_10.md §6 / §8
 *
 * 既定は **read-only**:
 *   - 有効な契約の件数 / うち解約予約中（cancel_at / cancel_at_period_end）の件数と終了日
 *   - カスタマーポータル構成ごとの「解約できるか」「ログインページの有無」
 * `--apply-default-no-cancel` を付けたときだけ、**アカウント既定のポータル構成の解約を無効にする**。
 *   🔴 変えるのは `features.subscription_cancel.enabled=false` だけ（カード変更・請求履歴等は触らない）。
 *   🔴 既存の契約・予約には一切書き込まない。
 *
 * 実行（鍵は表示しない。Netlify の production env を注入して実行する）:
 *   cd astro-site && netlify dev:exec --context production -- node scripts/stripeWithdrawalAudit.mjs
 *   cd astro-site && netlify dev:exec --context production -- node scripts/stripeWithdrawalAudit.mjs --apply-default-no-cancel
 *   （🔴 `--` が無いと `--apply-default-no-cancel` を netlify CLI が自分のオプションとして拒否する）
 *
 * 🟡 2026-10-07 実測: ローカルの `netlify dev:exec --context production` で注入される
 *    STRIPE_SECRET_KEY は Stripe に拒否された（StripeAuthenticationError）。本番の秘密値は
 *    ローカルへ取り出せない前提で、同じ確認・設定は Stripe ダッシュボードで行う
 *    （サブスク一覧の「アクティブ」/ 設定 → Billing → カスタマーポータル → キャンセル）。
 *
 * 🔴 出力に email・顧客 ID・サブスク ID を出さない（件数と日付だけ）。
 */

import Stripe from 'stripe';

export function isScheduled(sub) {
  if (!sub || !['active', 'trialing'].includes(sub.status)) return false;
  return sub.cancel_at_period_end === true || (Number.isFinite(sub.cancel_at) && sub.cancel_at > 0);
}

export function summarizeSubs(subs) {
  const active = subs.filter((s) => ['active', 'trialing'].includes(s.status));
  const scheduled = active.filter(isScheduled);
  const ends = scheduled
    .map((s) => s.cancel_at || s.current_period_end || s.items?.data?.[0]?.current_period_end)
    .filter(Boolean)
    .map((sec) => new Date(sec * 1000).toISOString())
    .sort();
  return { active: active.length, scheduled: scheduled.length, scheduledEnds: ends };
}

export function summarizeConfig(c) {
  return {
    default: !!c.is_default,
    active: !!c.active,
    ki: c.metadata?.ki_portal || null,
    cancel: c.features?.subscription_cancel?.enabled === true,
    planChange: c.features?.subscription_update?.enabled === true,
    cardUpdate: c.features?.payment_method_update?.enabled === true,
    invoices: c.features?.invoice_history?.enabled === true,
    loginPage: c.login_page?.enabled === true,
  };
}

/** 既定構成へ送る更新。🔴 解約の無効化だけ。 */
export function defaultNoCancelUpdate() {
  return { features: { subscription_cancel: { enabled: false } } };
}

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) { console.error('STRIPE_SECRET_KEY が無い（netlify dev:exec --context production で実行する）'); process.exit(2); }
  const mode = key.startsWith('sk_live') || key.startsWith('rk_live') ? 'live' : 'test';
  const apply = process.argv.includes('--apply-default-no-cancel');
  const stripe = new Stripe(key);

  const subs = [];
  for await (const s of stripe.subscriptions.list({ status: 'all', limit: 100 })) subs.push(s);
  const configs = [];
  for await (const c of stripe.billingPortal.configurations.list({ limit: 100 })) configs.push(c);

  console.log(JSON.stringify({ mode, subscriptions: summarizeSubs(subs), portalConfigs: configs.map(summarizeConfig) }, null, 2));

  if (!apply) return;
  const def = configs.find((c) => c.is_default);
  if (!def) { console.log('既定構成なし（変更不要）'); return; }
  if (def.features?.subscription_cancel?.enabled !== true) { console.log('既定構成は既に解約不可（変更なし）'); return; }
  const updated = await stripe.billingPortal.configurations.update(def.id, defaultNoCancelUpdate());
  console.log('既定構成を更新:', JSON.stringify(summarizeConfig(updated)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error('失敗:', e?.type || e?.name || 'error'); process.exit(1); });
}
