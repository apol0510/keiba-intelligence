/**
 * membershipView.js — 会員クラブの表示ビュー（マイページ / 料金ページ用）
 *
 * 正本: docs/MEMBERSHIP_REWARDS.md §4 / §5
 *
 * 🔴 **確定値は `docs/MEMBERSHIP_REWARDS.md` §7.1**（100 pt/月・0/3/12/24 か月・
 *    600/1,200 pt・¥796 上限・記念品 12/24 か月・解約後 90 日で失効）。
 *
 * 🔴 **会員ごとのデータ（継続月数・残高・契約価格）はまだ保存先が無い**
 *    （`docs/MEMBERSHIP_DATA_MIGRATION.md`）。読めない項目は `pending` として返し、
 *    ページ側が「準備中」と描く。**0 pt / Bronze / ¥3,980 を推測で当てない。**
 *
 * 🔴 **ランクを認可に使わない。** ここは表示専用であり、`showMarks` / `showBetting` を作らない。
 */

import { TIER, tierAtLeast } from '../auth/tiers.js';
import { RANK_ORDER, RANK_LABEL, resolveRank, readRankThresholds } from './ranks.js';
import { summarizeRewards, readAccrualConfig, MONTHLY_POINTS, GRACE_DAYS } from './rewards.js';
import {
  createCatalog, exchangeView, milestoneItems, isCatalogPublished,
  isMilestoneMonth, MILESTONE_MONTHS, REDEMPTION_TIERS,
} from './catalog.js';
import { resolvePriceLock } from './priceLock.js';

/** 制度の名称。UI はここから引く（表記ゆれと禁止語の混入を防ぐ）。 */
export const MEMBERSHIP_COPY = Object.freeze({
  clubName: 'KI 会員クラブ',
  rewardName: 'KIリワード',
  balanceLabel: 'KIリワード残高',
  monthLabel: '今月の積み上げ',
  nextGiftLabel: '次のプレゼントまで',
  rankLabel: '会員ランク',
  monthsLabel: '継続月数',
  priceLockLabel: '継続価格ロック',
  contractPriceLabel: '現在の契約価格',
  historyLabel: '過去に受け取った特典',
  /** 🔴 未確定を出すときの唯一の表現 */
  pending: '準備中',
});

/**
 * ランクの並び（UI が「Bronze → Silver → Gold → Platinum」を描くため）。
 * 昇格月数は確定値（§7.1）なので UI に出してよい。
 */
export const RANK_LADDER = Object.freeze(RANK_ORDER.map((r) => Object.freeze({
  rank: r,
  label: RANK_LABEL[r],
  months: readRankThresholds(null)[r],
})));

/** UI が参照してよい確定値（画面に出す数値をここに集約する）。 */
export const CONFIRMED = Object.freeze({
  monthlyPoints: MONTHLY_POINTS,
  redemptionCostPoints: Object.freeze(REDEMPTION_TIERS.map((t) => t.costPoints)),
  milestoneMonths: MILESTONE_MONTHS,
  graceDays: GRACE_DAYS,
});

/**
 * 継続月数を求める。
 *
 * 🔴 起点の定義（TBD-9）が未確定なので、**保存された起点が無ければ null**。
 *    「登録日から数える」「初回課金から数える」を勝手に決めない。
 */
export function continuationMonths(startedAtIso, nowMs) {
  if (typeof startedAtIso !== 'string' || !startedAtIso.trim()) return null;
  const start = Date.parse(startedAtIso);
  if (!Number.isFinite(start) || !Number.isFinite(nowMs) || start > nowMs) return null;

  const a = new Date(start);
  const b = new Date(nowMs);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return months < 0 ? 0 : months;
}

/**
 * マイページ用のビューを組み立てる。
 *
 * @param {object} o
 * @param {object} o.entitlement    `entitlementFromAstro` の戻り
 * @param {object|null} o.profile   store から読んだ会員プロフィール（未取得なら null）
 * @param {Array|null} o.ledger     store から読んだリワード台帳（未取得なら null）
 * @param {object} o.config         設定源（env 相当）
 * @param {object} o.catalogSource  景品カタログの生 JSON
 * @param {number|null} o.currentListPriceYen 現在の新規価格（表示用）
 * @param {number} o.nowMs
 */
export function buildMembershipView({
  entitlement,
  profile = null,
  ledger = null,
  config = {},
  catalogSource = null,
  currentListPriceYen = null,
  nowMs = Date.now(),
} = {}) {
  // 解約日。契約中なら null（`rewards.js` が 90 日の失効判定に使う）
  const cancelledAtIso = profile?.cancelledAtIso || null;
  const tier = entitlement?.tier || TIER.GUEST;
  const isPaid = tierAtLeast(tier, TIER.LIGHT);

  const thresholds = readRankThresholds(config);
  const accrual = readAccrualConfig(config);
  const catalog = createCatalog(catalogSource);

  const months = continuationMonths(profile?.membershipStartedAtIso, nowMs);
  const rank = resolveRank(months, thresholds);

  const rewards = summarizeRewards({
    entries: ledger,
    accrual,
    ledgerKnown: Array.isArray(ledger),
    cancelledAtIso,
    nowMs,
  });

  const exchange = exchangeView({
    catalog,
    balancePoints: rewards.balancePoints,
    rank: rank.rank,
    months,
  });

  const priceLock = resolvePriceLock({
    isPaid,
    contract: profile?.contractPrice || null,
    currentListPriceYen,
  });

  return Object.freeze({
    /** 有料契約中か（会員クラブの主対象）。ランクは認可に使わない */
    isPaid,
    tier,
    tierLabel: entitlement?.tierLabel || null,

    months: Object.freeze({
      status: months == null ? 'pending' : 'ready',
      value: months,
    }),

    rank: Object.freeze({
      status: rank.configured && rank.monthsKnown ? 'ready' : 'pending',
      rank: rank.rank,
      label: rank.rankLabel,
      nextRank: rank.nextRank,
      nextLabel: rank.nextRankLabel,
      monthsToNext: rank.monthsToNext,
      progressRatio: rank.progressRatio,
      ladder: RANK_LADDER,
    }),

    rewards: Object.freeze({
      status: rewards.status,
      reason: rewards.reason,
      /** 🔴 ポイント。円ではない */
      balancePoints: rewards.balancePoints,
      monthAccrualPoints: rewards.monthAccrualPoints,
      /** active / grace / expired（解約後 90 日） */
      pointsStatus: rewards.pointsStatus?.status || null,
      expiresAtMs: rewards.pointsStatus?.expiresAtMs || null,
      daysLeft: rewards.pointsStatus?.daysLeft ?? null,
    }),

    gifts: Object.freeze({
      status: exchange.status,
      available: exchange.available,
      next: exchange.next,
      /** 🔴 記念品の月は通常交換を出さない（保守ライン S-2） */
      blockedByMilestone: !!exchange.blockedByMilestone,
      isMilestoneMonth: isMilestoneMonth(months),
      /** 継続記念品（M-6）。カタログ未公開なら空 */
      milestones: milestoneItems(catalog),
      catalogPublished: isCatalogPublished(catalog),
    }),

    priceLock: Object.freeze({
      status: priceLock.status,
      contractPriceYen: priceLock.contractPriceYen,
      contractStartedAtIso: priceLock.contractStartedAtIso,
      cheaperThanCurrent: priceLock.cheaperThanCurrent,
    }),

    history: Object.freeze({
      status: rewards.status,
      items: rewards.redemptions,
    }),
  });
}

/**
 * `/pricing` の柱2 に出す訴求。
 *
 * 🔴 **出してよい数値は §7.1 の確定値だけ**（100 pt/月・0/3/12/24 か月・
 *    600/1,200 pt・記念品 12/24 か月・解約後 90 日）。
 * 🔴 **景品の品目は書かない**（未確定・カタログはデータ駆動）。
 */
export const PRICING_BENEFITS = Object.freeze([
  Object.freeze({
    id: 'reward',
    title: 'KIリワードが毎月100ptずつ積み上がる',
    body: 'プレミアムを続けている間、毎月100ptが自動で積み上がります。ログインや操作は必要ありません。',
  }),
  Object.freeze({
    id: 'rank',
    title: 'Bronze → Silver → Gold → Platinum',
    body: '続けた月数に応じて会員ランクが上がります（3か月・12か月・24か月）。ランクで変わるのは選べるプレゼントなどの待遇だけで、予想の内容・買い目・情報の質に差はありません。',
  }),
  Object.freeze({
    id: 'gift',
    title: '選べるプレゼント',
    body: '600ptと1,200ptの2段階でご用意します。条件を満たすと、複数の候補からお好きなものを選んで受け取れます。抽選はありません。',
  }),
  Object.freeze({
    id: 'milestone',
    title: '長期継続の記念品',
    body: '12か月・24か月の節目には、通常の交換とは別に記念の品をお贈りします。',
  }),
  Object.freeze({
    id: 'pricelock',
    title: '継続価格ロック',
    body: 'ご契約中は、加入されたときの価格のまま続けられます。新規の価格が変わっても、契約中の会員さまの金額は上がりません。解約後90日以内に再開された場合は、ポイントと以前の価格が戻ります。',
  }),
]);
