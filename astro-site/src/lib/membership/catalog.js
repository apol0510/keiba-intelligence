/**
 * catalog.js — 景品カタログ（データ駆動）
 *
 * 正本: docs/MEMBERSHIP_REWARDS.md §3（M-2 / M-3 / M-6）
 *
 * 🔴 **商品そのものをコードへ固定しない。**
 *    コーヒー・米・菓子等は「想定」であって確定した品目ではない。
 *    カタログの実体は `src/data/membership/rewardCatalog.json`（将来変更できる）。
 *
 * 🔴 fail-closed:
 *    - `status !== 'published'` のカタログは **空として扱う**（下書きを客へ見せない）
 *    - 交換ライン（600 / 1,200 pt）に一致しない item は **除外する**
 *    - 価額が ¥796 を超える item は **除外する**（保守ライン S-1）
 *    - カタログが空のときは「選べるプレゼント」の中身を出さない（制度名だけ出す）
 *
 * 🔴 **保守ライン（`docs/MEMBERSHIP_REWARDS.md` §7.2 / §8.1）**
 *    総付景品の上限は取引価額の 10 分の 2。月額 ¥3,980 に対して **¥796**。
 *    これは「取引価額＝月額」という **いちばん厳しい読み方**での上限であり、
 *    ここに収めておけば取引価額の解釈を確定させる必要がない。
 *    - S-1 景品 1 点は ¥796 以内（`MAX_ITEM_VALUE_YEN`）
 *    - S-2 記念品と通常交換を同月に重ねない（`isMilestoneMonth`）
 *    - S-3 抽選・くじ・先着を入れない（全員同一条件＝総付を維持）
 *    本モジュールは価額の上限判定だけを行い、**円換算・金額表示は行わない**。
 */

import { RANK_ORDER } from './ranks.js';

/** 交換の種類。継続記念品（M-6）は通常のポイント交換とは別枠。 */
export const ITEM_KIND = Object.freeze({
  /** ポイントで交換する景品（M-2 / M-3） */
  REDEEMABLE: 'redeemable',
  /** 継続の節目で贈る記念品（M-6）。ポイントを消費しない */
  MILESTONE: 'milestone',
});

const ITEM_KINDS = Object.freeze(Object.values(ITEM_KIND));
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * 交換ライン（**確定値・2026-09-01**）。正本は `docs/MEMBERSHIP_REWARDS.md` §7.1。
 *
 * 100 pt/月 なので、小はおよそ半年、大はおよそ 1 年で手が届く。
 * 「早めに小さく貰う」「貯めて大きく」を選べるようにして休眠を防ぐ。
 */
export const REDEMPTION_TIERS = Object.freeze([
  Object.freeze({ id: 'small', costPoints: 600 }),
  Object.freeze({ id: 'large', costPoints: 1200 }),
]);

/** 交換ラインのポイント数だけを取り出したもの。 */
export const REDEMPTION_COST_POINTS = Object.freeze(REDEMPTION_TIERS.map((t) => t.costPoints));

/** 継続記念品を贈る月（**確定値**）。 */
export const MILESTONE_MONTHS = Object.freeze([12, 24]);

/**
 * 景品 1 点の価額の上限（**確定値・保守ライン S-1**）。
 *
 * 🔴 月額 ¥3,980 × 10 分の 2 = **¥796**。
 *    これを超える設計にしたくなったら、先に取引価額の確認が要る（§8.2 L-1）。
 *    送料は景品価額に含めない整理が一般的だが、**含めても収まる水準**にしておくこと。
 */
export const MAX_ITEM_VALUE_YEN = 796;

/** その月が継続記念品の月か（S-2: この月は通常交換を出さない）。 */
export function isMilestoneMonth(months) {
  return Number.isInteger(months) && MILESTONE_MONTHS.includes(months);
}

/** 空のカタログ（既定）。 */
export const EMPTY_CATALOG = Object.freeze({
  version: 0,
  status: 'draft',
  items: Object.freeze([]),
});

/**
 * item として妥当か。
 *
 * - `redeemable` … `costPoints` が **確定した交換ライン（600 / 1,200）**のいずれかであること
 * - `milestone`  … `milestoneMonths` が **確定した節目（12 / 24）**のいずれかであること
 * - `valueYen`   … 省略可。指定するなら **¥796 以内**であること（保守ライン S-1）
 * - `minRank`    … 省略可。指定するなら既知のランクであること
 *
 * 🔴 半端なポイント数・上限超えの価額を **無言で丸めない。除外する。**
 *    丸めると、正本に無い条件の景品が客へ出てしまう。
 */
export function isValidItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (!isNonEmptyString(item.id) || !isNonEmptyString(item.name)) return false;
  if (!ITEM_KINDS.includes(item.kind)) return false;
  if (item.minRank != null && !RANK_ORDER.includes(item.minRank)) return false;

  // 保守ライン S-1: 価額が分かっているなら上限内であること
  if (item.valueYen != null) {
    if (!Number.isInteger(item.valueYen) || item.valueYen < 0) return false;
    if (item.valueYen > MAX_ITEM_VALUE_YEN) return false;
  }

  if (item.kind === ITEM_KIND.REDEEMABLE) {
    return REDEMPTION_COST_POINTS.includes(item.costPoints);
  }
  return MILESTONE_MONTHS.includes(item.milestoneMonths);
}

/**
 * 生の JSON からカタログを作る。
 * 🔴 `status: 'published'` 以外は **空**として返す（下書きを公開しない）。
 */
export function createCatalog(raw) {
  if (!raw || typeof raw !== 'object') return EMPTY_CATALOG;
  if (raw.status !== 'published') return EMPTY_CATALOG;

  const items = (Array.isArray(raw.items) ? raw.items : [])
    .filter(isValidItem)
    .map((i) => Object.freeze({
      id: i.id,
      name: i.name,
      kind: i.kind,
      costPoints: i.kind === ITEM_KIND.REDEEMABLE ? i.costPoints : null,
      milestoneMonths: i.kind === ITEM_KIND.MILESTONE ? i.milestoneMonths : null,
      valueYen: i.valueYen ?? null,
      minRank: i.minRank ?? null,
      description: isNonEmptyString(i.description) ? i.description : null,
    }));

  const ids = new Set();
  const unique = items.filter((i) => (ids.has(i.id) ? false : (ids.add(i.id), true)));

  return Object.freeze({
    version: Number.isInteger(raw.version) ? raw.version : 0,
    status: 'published',
    items: Object.freeze(unique),
  });
}

/** カタログが客へ出せる状態か。 */
export function isCatalogPublished(catalog) {
  return !!catalog && catalog.status === 'published' && catalog.items.length > 0;
}

/** ポイントで交換できる item だけ。 */
export function redeemableItems(catalog) {
  if (!isCatalogPublished(catalog)) return Object.freeze([]);
  return Object.freeze(catalog.items.filter((i) => i.kind === ITEM_KIND.REDEEMABLE));
}

/** 継続記念品（M-6）だけ。 */
export function milestoneItems(catalog) {
  if (!isCatalogPublished(catalog)) return Object.freeze([]);
  return Object.freeze(catalog.items.filter((i) => i.kind === ITEM_KIND.MILESTONE));
}

/** ランク条件を満たすか。ランクが未確定（null）なら **満たさない**扱い（fail-closed）。 */
function rankAllows(item, rank) {
  if (!item.minRank) return true;
  if (!rank) return false;
  return RANK_ORDER.indexOf(rank) >= RANK_ORDER.indexOf(item.minRank);
}

/**
 * いま交換できる景品と、次に手が届く景品を返す。
 *
 * 🔴 残高が未確定（`balancePoints === null`）なら **何も返さない**。
 *    「あと◯pt」を推測で出さない。
 *
 * 🔴 **保守ライン S-2**: 継続記念品の月（12 / 24 か月）は通常交換を出さない。
 *    同月に記念品と交換品が重なると 1 か月あたりの景品類が合算され、
 *    ¥796 の枠を超えうるため。
 */
export function exchangeView({ catalog, balancePoints, rank, months = null } = {}) {
  const items = redeemableItems(catalog);
  if (!items.length || !Number.isInteger(balancePoints)) {
    return Object.freeze({
      status: 'pending',
      available: Object.freeze([]),
      next: null,
      blockedByMilestone: false,
    });
  }

  // S-2: 記念品の月は通常交換を受け付けない
  if (isMilestoneMonth(months)) {
    return Object.freeze({
      status: 'blocked',
      available: Object.freeze([]),
      next: null,
      blockedByMilestone: true,
    });
  }

  const allowed = items.filter((i) => rankAllows(i, rank));
  const available = allowed.filter((i) => balancePoints >= i.costPoints);
  const upcoming = allowed
    .filter((i) => balancePoints < i.costPoints)
    .sort((a, b) => a.costPoints - b.costPoints);

  const nearest = upcoming[0] || null;

  return Object.freeze({
    status: 'ready',
    blockedByMilestone: false,
    available: Object.freeze(available),
    next: nearest
      ? Object.freeze({
        item: nearest,
        /** 🔴 ポイント。円ではない。 */
        remainingPoints: nearest.costPoints - balancePoints,
        progressRatio: Math.min(1, balancePoints / nearest.costPoints),
      })
      : null,
  });
}
