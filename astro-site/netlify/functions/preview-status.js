/**
 * preview-status — プレビュー機能の設定状態だけを返す診断エンドポイント
 *
 * 正本: docs/RENEWAL_2026_08.md §7.2.5
 *
 * 🔴 **秘密値を一切返さない。** 返すのは boolean と長さ・ホスト種別だけ。
 *    合言葉そのもの、その一部、ハッシュも返さない。
 *
 * 何のためにあるか:
 *   Deploy Preview で有料プレビューが効かないとき、原因が
 *   「env が届いていない」のか「合言葉が違う」のかを切り分けるため。
 *   Netlify の環境変数は **deploy context スコープ**を持ち、
 *   Production のみに設定すると Deploy Preview には届かない。
 *
 * 🔴 本番ホストでは 404 を返す（診断面を本番に晒さない）。
 */

import { isPreviewHost, PREVIEW_PAID_KEY_ENV } from '../../src/lib/auth/previewMode.js';
import { SESSION_SECRET_ENV } from '../../src/lib/auth/entitlement.js';

export async function handler(event) {
  const host = event.headers?.host || '';
  const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };

  // 🔴 本番では存在しないものとして扱う
  if (!isPreviewHost(host)) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'not_found' }) };
  }

  const paid = process.env[PREVIEW_PAID_KEY_ENV];
  const secret = process.env[SESSION_SECRET_ENV];

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      host,
      isPreviewHost: true,
      // 🔴 値は返さない。設定の有無と長さだけ（長さは不一致の切り分けに要る）
      paidPreviewKeyConfigured: typeof paid === 'string' && paid.trim().length > 0,
      paidPreviewKeyLength: typeof paid === 'string' ? paid.trim().length : 0,
      sessionSecretConfigured: typeof secret === 'string' && secret.trim().length > 0,
      context: process.env.CONTEXT || null,
      branch: process.env.BRANCH || null,
    }),
  };
}
