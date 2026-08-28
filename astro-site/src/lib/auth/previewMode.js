/**
 * previewMode.js — Deploy Preview 限定の「無料会員の見え方」プレビュー
 *
 * 正本: docs/RENEWAL_2026_08.md §3 / §7
 *
 * ── 何のためにあるか ──────────────────────────────────────────────
 * 仕様所有者が「無料登録したらどう見えるか」を **ログインせずに** 確認するための仕組み。
 * `?view=free` を付けると、その 1 リクエストだけ **印（役割マーク・PT・評価順の並び）** が開く。
 *
 * ── 🔴 安全契約（ここを緩めない）─────────────────────────────────
 *  1. **上限は `free`。** 買い目（light 以上）へは**絶対に上げない**。
 *     この仕組みで `showBetting` が true になる経路を作ってはいけない。
 *  2. **本番ホストでは常に無効。** `keiba-intelligence.jp` / `www.` /
 *     `keiba-intelligence.netlify.app`（本番エイリアス）では受け付けない。
 *  3. 有効なのは **Deploy Preview / ブランチデプロイ / localhost のみ**。
 *  4. 既に本物のセッションで free 以上なら **何もしない**（権限を下げも上げもしない）。
 *  5. 画面に「プレビュー表示中」を必ず出す（本物の会員状態と混同させない）。
 *
 * ── なぜホスト名で判定するか ─────────────────────────────────────
 * Netlify の `CONTEXT` はビルド時変数で、SSR 関数のランタイムで確実に読める保証がない。
 * ホスト名は Netlify のルーティングそのものなので、判定が実態とずれない。
 * 仮にホストヘッダを偽装されても、この仕組みで開くのは **印まで**であり、
 * 買い目は開かない（契約 1）。
 */

import { TIER, tierAtLeast } from './tiers.js';

/** クエリパラメータ名。 */
export const PREVIEW_PARAM = 'view';

/** この仕組みで到達できる最大 tier。**変更禁止**（買い目を開かないための上限）。 */
export const PREVIEW_MAX_TIER = TIER.FREE;

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
 * @returns {string|null} `free` または null（プレビューを適用しない）
 */
export function resolvePreviewTier({ host, searchParams } = {}) {
  if (!isPreviewHost(host)) return null;
  if (!searchParams || typeof searchParams.get !== 'function') return null;

  const raw = searchParams.get(PREVIEW_PARAM);
  if (typeof raw !== 'string') return null;

  const v = raw.trim().toLowerCase();
  // 🔴 受け付けるのは 'free' だけ。'light' / 'premium' は**無視する**（買い目を開かない）。
  if (v !== TIER.FREE) return null;

  return PREVIEW_MAX_TIER;
}

/**
 * 実体の entitlement にプレビューを重ねる。
 *
 * 🔴 上げるのは印（`showMarks`）だけ。`showBetting` / `showPremiumExtras` は
 *    **元の値をそのまま維持する**（プレビューで買い目が開くことはない）。
 * 🔴 既に free 以上なら何もしない。
 *
 * @param {object} entitlement resolveEntitlement の戻り
 * @param {object} o           resolvePreviewTier と同じ引数
 * @returns {object} 変更後の entitlement（`preview: true` が付く）
 */
export function applyPreview(entitlement, o = {}) {
  const base = entitlement || {};
  if (tierAtLeast(base.tier, TIER.FREE)) return base;

  const previewTier = resolvePreviewTier(o);
  if (!previewTier) return base;

  return Object.freeze({
    ...base,
    tier: previewTier,
    tierLabel: '無料会員（プレビュー）',
    // 🔴 印だけを開く
    showMarks: true,
    // 🔴 買い目・premium 限定は元のまま（false）
    showBetting: !!base.showBetting,
    showPremiumExtras: !!base.showPremiumExtras,
    // 本物のログインではない
    authenticated: false,
    preview: true,
    reason: 'preview',
  });
}
