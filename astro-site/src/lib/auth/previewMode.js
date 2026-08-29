/**
 * previewMode.js — Deploy Preview 限定の「無料会員の見え方」プレビュー
 *
 * 正本: docs/RENEWAL_2026_08.md §3 / §7
 *
 * ── 何のためにあるか ──────────────────────────────────────────────
 * 仕様所有者が各 tier の見え方を **ログインせずに** 確認するための仕組み。
 *
 *   `?view=free`                     … 合言葉なし。印まで開く
 *   `?view=light&key=…`              … 合言葉必須。買い目まで開く（対象会場のみ）
 *   `?view=premium&key=…`            … 合言葉必須。全会場の買い目まで開く
 *
 * ── 🔴 安全契約（ここを緩めない）─────────────────────────────────
 *  1. **本番ホストでは常に無効。** `keiba-intelligence.jp` / `www.` /
 *     `keiba-intelligence.netlify.app`（本番エイリアス）では受け付けない。
 *  2. 有効なのは **Deploy Preview / ブランチデプロイ / localhost のみ**。
 *  3. **`?view=free` は合言葉なしで使える**（印までしか開かないため）。
 *  4. **`?view=light` / `?view=premium` は合言葉（`key`）必須**。
 *     合言葉は env `PREVIEW_PAID_KEY` に置く。**未設定なら有料プレビューは成立しない**。
 *     Deploy Preview の URL は公開されているため、合言葉が無いと
 *     買い目が誰でも読めてしまう（2026-08-17 監査 A-1 と同じ穴になる）。
 *  5. 合言葉の照合は **timing-safe**。長さが違えば即座に拒否する。
 *  6. 既に本物のセッションで同等以上なら **何もしない**（権限を下げも上げもしない）。
 *  7. 画面に「プレビュー表示中」を必ず出す（本物の会員状態と混同させない）。
 *
 * ── なぜホスト名で判定するか ─────────────────────────────────────
 * Netlify の `CONTEXT` はビルド時変数で、SSR 関数のランタイムで確実に読める保証がない。
 * ホスト名は Netlify のルーティングそのものなので、判定が実態とずれない。
 * 仮にホストヘッダを偽装されても、合言葉が無ければ開くのは **印まで**である（契約 3・4）。
 */

import { timingSafeEqual } from 'node:crypto';
import { TIER, tierAtLeast, tierRank, canSeeMarks, canSeeBetting, canSeePremiumExtras, tierLabel } from './tiers.js';

/** クエリパラメータ名。 */
export const PREVIEW_PARAM = 'view';
/** 有料プレビューの合言葉を渡すクエリパラメータ名。 */
export const PREVIEW_KEY_PARAM = 'key';

/** 合言葉を置く env のキー名（🔴 値は扱わない）。 */
export const PREVIEW_PAID_KEY_ENV = 'PREVIEW_PAID_KEY';

/** 合言葉なしで到達できる最大 tier。**変更禁止**。 */
export const PREVIEW_MAX_TIER = TIER.FREE;
/** 合言葉ありで到達できる最大 tier。 */
export const PREVIEW_MAX_TIER_WITH_KEY = TIER.PREMIUM;

/** 受け付ける tier 値。 */
const REQUESTABLE = Object.freeze([TIER.FREE, TIER.LIGHT, TIER.PREMIUM]);

/** 合言葉の timing-safe 照合。未設定・空・不一致はすべて false。 */
function keyMatches(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** 本番ホスト。ここでは絶対にプレビューを効かせない。 */
const PRODUCTION_HOSTS = Object.freeze([
  'keiba-intelligence.jp',
  'www.keiba-intelligence.jp',
  // 本番の Netlify エイリアス（301 で独自ドメインへ転送されるが、念のため除外する）
  'keiba-intelligence.netlify.app',
]);

/** ホスト名からポートを落として小文字化する。 */
function normalizeHost(host) {
  if (typeof host !== 'string') return '';
  return host.trim().toLowerCase().split(':')[0];
}

/**
 * このホストでプレビューを許可してよいか。
 * 許可: `deploy-preview-N--<site>.netlify.app` / `<branch>--<site>.netlify.app` / localhost
 */
export function isPreviewHost(host) {
  const h = normalizeHost(host);
  if (!h) return false;
  if (PRODUCTION_HOSTS.includes(h)) return false;
  if (h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local')) return true;
  // `--` を含む netlify.app サブドメインは Deploy Preview / ブランチデプロイのみ
  return h.endsWith('.netlify.app') && h.includes('--');
}

/**
 * リクエストから「プレビューで見せる tier」を決める。
 *
 * @param {object} o
 * @param {string} o.host                 リクエストの Host ヘッダー
 * @param {URLSearchParams|null} o.searchParams
 * @param {object} [o.env]  `PREVIEW_PAID_KEY` を含む env
 * @returns {string|null} `free` / `light` / `premium`、または null（適用しない）
 */
export function resolvePreviewTier({ host, searchParams, env } = {}) {
  // 🔴 本番ホストでは何があっても無効
  if (!isPreviewHost(host)) return null;
  if (!searchParams || typeof searchParams.get !== 'function') return null;

  const raw = searchParams.get(PREVIEW_PARAM);
  if (typeof raw !== 'string') return null;

  const requested = raw.trim().toLowerCase();
  if (!REQUESTABLE.includes(requested)) return null;

  // 合言葉なしで開けるのは free まで
  if (requested === TIER.FREE) return PREVIEW_MAX_TIER;

  // 🔴 有料プレビューは合言葉必須。env 未設定なら成立しない（fail-closed）
  const expected = (env || {})[PREVIEW_PAID_KEY_ENV];
  if (typeof expected !== 'string' || !expected.trim()) return null;
  if (!keyMatches(searchParams.get(PREVIEW_KEY_PARAM), expected.trim())) return null;

  // 上限を超えない
  return tierRank(requested) > tierRank(PREVIEW_MAX_TIER_WITH_KEY)
    ? PREVIEW_MAX_TIER_WITH_KEY
    : requested;
}

/**
 * 実体の entitlement にプレビューを重ねる。
 *
 * 🔴 到達できる tier は `resolvePreviewTier` が決める（合言葉なしなら free まで）。
 * 🔴 既に本物のセッションが同等以上なら何もしない。
 *
 * @param {object} entitlement resolveEntitlement の戻り
 * @param {object} o           resolvePreviewTier と同じ引数
 * @returns {object} 変更後の entitlement（`preview: true` が付く）
 */
export function applyPreview(entitlement, o = {}) {
  const base = entitlement || {};

  const previewTier = resolvePreviewTier(o);
  if (!previewTier) return base;

  // 🔴 既に本物のセッションが同等以上なら何もしない（下げも上げもしない）
  if (tierAtLeast(base.tier, previewTier)) return base;

  const venueAccess = base.venueAccess || 'all';
  return Object.freeze({
    ...base,
    tier: previewTier,
    tierLabel: `${tierLabel(previewTier)}（プレビュー）`,
    showMarks: canSeeMarks(previewTier),
    showBetting: canSeeBetting(previewTier, { venue: o.venue, venueAccess }),
    showPremiumExtras: canSeePremiumExtras(previewTier),
    // 本物のログインではない
    authenticated: false,
    preview: true,
    reason: 'preview',
  });
}
