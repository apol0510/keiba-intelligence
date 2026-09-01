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
 *    - 必要ポイント（TBD-3）が入っていない item は **除外する**
 *    - カタログが空のときは「選べるプレゼント」の中身を出さない（制度名だけ出す）
 *
 * 🔴 景品の**価額**（TBD-4）は景品表示法の確認（§8 L-1〜L-4）が済むまで扱わない。
 *    本モジュールは価額を受け取らないし、円換算も行わない。
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

/** 空のカタログ（既定）。 */
export const EMPTY_CATALOG = Object.freeze({
  version: 0,
  status: 'draft',
  items: Object.freeze([]),
});

/**
 * item として妥当か。
 *
 * - `redeemable` … `costPoints` が正の整数であること（未確定なら除外）
 * - `milestone`  … `milestoneMonths` が非負整数であること（未確定なら除外）
 * - `minRank`    … 省略可。指定するなら既知のランクであること
 */
export function isValidItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (!isNonEmptyString(item.id) || !isNonEmptyString(item.name)) return false;
  if (!ITEM_KINDS.includes(item.kind)) return false;
  if (item.minRank != null && !RANK_ORDER.includes(item.minRank)) return false;

  if (item.kind === ITEM_KIND.REDEEMABLE) {
    return Number.isInteger(item.costPoints) && item.costPoints > 0;
  }
  return Number.isInteger(item.milestoneMonths) && item.milestoneMonths >= 0;
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
 */
export function exchangeView({ catalog, balancePoints, rank } = {}) {
  const items = redeemableItems(catalog);
  if (!items.length || !Number.isInteger(balancePoints)) {
    return Object.freeze({
      status: 'pending',
      available: Object.freeze([]),
      next: null,
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
