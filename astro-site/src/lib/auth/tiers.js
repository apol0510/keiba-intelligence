/**
 * tiers.js — 会員 tier の単一定義
 *
 * 正本: docs/RENEWAL_2026_08.md §3
 *
 * tier は 4 つだけ。これ以外を新設しない。
 *
 *   guest   … 未登録。印と買い目以外はすべて見える
 *   free    … 無料会員（メール認証済み）。印が見える
 *   light   … 🟡 **プラン自体は保留（2026-08-30）**。`/pricing` に導線を出さない。
 *             既存の Airtable `PlanType='light'` を free へ落とさないために tier は残す。
 *             権限は premium と同じ（南関＋中央の買い目）。
 *   premium … 有料。南関東＋中央競馬の買い目が見える
 *
 * 🔴 **会場による出し分けは廃止した（2026-08-30・仕様所有者の指示）。**
 *    「ライト＝南関のみ」という概念を無くし、**有料なら全会場**が見える。
 *    `venueAccess` / `venueAllowed` / `VENUE` は削除済み。復活させないこと。
 *    （Airtable の `VenueAccess` 列は残っているが **読まない**。）
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
   表示可否（単一判定）
   ------------------------------------------------------------------ */

/** 印（◎○▲△）を出してよいか。free 以上で開く。 */
export function canSeeMarks(tier) {
  return tierAtLeast(tier, TIER.FREE);
}

/**
 * 買い目を出してよいか。
 *
 * 🔴 **会場では分けない（2026-08-30）。** 有料 tier なら南関も中央も見える。
 *    引数は tier だけ。`venue` / `venueAccess` を受け取ってはいけない。
 */
export function canSeeBetting(tier) {
  return tierAtLeast(tier, TIER.LIGHT);
}

/** tier の日本語表示名（UI 用）。 */
export function tierLabel(tier) {
  switch (tier) {
    case TIER.PREMIUM: return 'プレミアム';
    // 🟡 プランは保留中。既存会員のセッションにのみ現れる
    case TIER.LIGHT: return '有料会員';
    case TIER.FREE: return '無料会員';
    default: return 'ゲスト';
  }
}
