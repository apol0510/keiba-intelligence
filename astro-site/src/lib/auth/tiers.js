/**
 * tiers.js — 会員 tier の単一定義
 *
 * 正本: docs/RENEWAL_2026_08.md §3
 *
 * tier は 4 つだけ。これ以外を新設しない。
 *
 *   guest   … 未登録。印と買い目以外はすべて見える
 *   free    … 無料会員（メール認証済み）。印（役割・PT・PT順の並び）が見える
 *   light   … 有料（下位）。買い目が見える
 *   premium … 有料（上位）。全会場・全レースの買い目が見える
 *
 * 🔴 fail-closed の定義:
 *   - セッションが無い / 署名が不正 / 期限切れ / 例外   → **guest**
 *   - 認証済みだが PlanType が未知の値                  → **free**
 *     （メール所有は証明されている。有料権限だけを与えない）
 */

export const TIER = Object.freeze({
  GUEST: 'guest',
  FREE: 'free',
  LIGHT: 'light',
  PREMIUM: 'premium',
});

/** 権限の強さ。比較にのみ使う。 */
const RANK = Object.freeze({
  [TIER.GUEST]: 0,
  [TIER.FREE]: 1,
  [TIER.LIGHT]: 2,
  [TIER.PREMIUM]: 3,
});

export const ALL_TIERS = Object.freeze([TIER.GUEST, TIER.FREE, TIER.LIGHT, TIER.PREMIUM]);

/** 既知の tier 文字列か。 */
export function isTier(v) {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(RANK, v);
}

/** 未知の値は guest（0）として扱う。 */
export function tierRank(tier) {
  return isTier(tier) ? RANK[tier] : RANK[TIER.GUEST];
}

/** tier が min 以上か。 */
export function tierAtLeast(tier, min) {
  return tierRank(tier) >= tierRank(min);
}

/**
 * Airtable `Customers.PlanType` → tier。
 *
 * 🔴 認証済みの顧客レコードに対してのみ呼ぶこと。
 *    未認証の入力を渡してはいけない（この関数は guest を返さない）。
 */
export function planTypeToTier(planType) {
  const p = typeof planType === 'string' ? planType.trim().toLowerCase() : '';
  switch (p) {
    case 'premium':
    case 'pro':
    case 'pro-plus':
      return TIER.PREMIUM;
    case 'light':
      return TIER.LIGHT;
    case '':
    case 'free':
    case 'free-registered':
      return TIER.FREE;
    default:
      // 未知の値に有料権限を与えない（認証済みなので free まで）
      return TIER.FREE;
  }
}

/** 有効期限切れの有料会員を free へ落とす。日付が読めない場合は落とさない。 */
export function applyExpiry(tier, expiresAt, nowMs) {
  if (!tierAtLeast(tier, TIER.LIGHT)) return tier;
  if (!expiresAt) return tier;
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return tier; // 読めない値で権限を落とさない（誤剥奪の防止）
  return t < nowMs ? TIER.FREE : tier;
}

/* ------------------------------------------------------------------
   会場アクセス
   ------------------------------------------------------------------ */

export const VENUE = Object.freeze({ NANKAN: 'nankan', JRA: 'jra' });

/** VenueAccess（'all' / 'jra' / 'nankan'）の正規化。未知は 'all' にしない。 */
export function normalizeVenueAccess(v) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (s === VENUE.JRA || s === VENUE.NANKAN) return s;
  if (s === 'all' || s === '') return 'all';
  return 'all';
}

/** 当該会場の有料コンテンツを見てよいか。 */
export function venueAllowed(venueAccess, venue) {
  const a = normalizeVenueAccess(venueAccess);
  if (a === 'all') return true;
  return a === venue;
}

/* ------------------------------------------------------------------
   表示可否（単一判定）
   ------------------------------------------------------------------ */

/**
 * 印（役割マーク・PT・PT順の並び）を出してよいか。
 * 会場によらず free 以上で開く。
 */
export function canSeeMarks(tier) {
  return tierAtLeast(tier, TIER.FREE);
}

/**
 * 買い目を出してよいか。有料 tier かつ会場アクセスが一致する場合のみ。
 *
 * @param {string} tier
 * @param {object} [o]
 * @param {string} [o.venue]        'nankan' | 'jra'
 * @param {string} [o.venueAccess]  'all' | 'nankan' | 'jra'
 */
export function canSeeBetting(tier, { venue, venueAccess } = {}) {
  if (!tierAtLeast(tier, TIER.LIGHT)) return false;
  if (!venue) return true;
  return venueAllowed(venueAccess, venue);
}

/** 穴馬レポート等の premium 限定コンテンツ。 */
export function canSeePremiumExtras(tier) {
  return tierAtLeast(tier, TIER.PREMIUM);
}

/** tier の日本語表示名（UI 用）。 */
export function tierLabel(tier) {
  switch (tier) {
    case TIER.PREMIUM: return 'プレミアム';
    case TIER.LIGHT: return 'ライト';
    case TIER.FREE: return '無料会員';
    default: return 'ゲスト';
  }
}
