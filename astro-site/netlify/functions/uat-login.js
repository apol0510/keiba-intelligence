/**
 * uat-login — 恒久 UAT 環境の専用ログイン（判定は uatLogin.js の薄いアダプタ）
 *
 * 正本: docs/UAT_PERMANENT_ENV.md
 *
 * 🔴 本番ホストでは 404。合言葉 env 未設定なら 503（fail-closed）。
 * 🔴 合言葉は **POST の body だけ**で受ける（URL に載せない）。
 * 🔴 発行するのは固定 1 アドレスの **free** セッションのみ。
 *    premium は Test Mode の実決済 → stripe-webhook → refresh-session を通す。
 *
 * 🔴 production の認証（verify-magic-link / refresh-session / send-magic-link）
 *    には手を入れていない。SendGrid にも触れない。
 */

import {
  decideUatLogin,
  extractUatKey,
  UAT_OUTCOME,
  UAT_LOGIN_KEY_ENV,
  UAT_LOGIN_TIER,
  UAT_MEMBER_EMAIL,
} from '../../src/lib/auth/uatLogin.js';
import { SESSION_SECRET_ENV } from '../../src/lib/auth/entitlement.js';
import { signSession, serializeSessionCookie } from '../../src/lib/auth/session.js';

const BASE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
});

const json = (statusCode, payload) => ({
  statusCode,
  headers: { ...BASE_HEADERS, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

/** 合言葉入力フォーム。🔴 合言葉を埋め込まない・GET では受け付けない。 */
function formPage() {
  return {
    statusCode: 200,
    headers: { ...BASE_HEADERS, 'Content-Type': 'text/html; charset=utf-8' },
    body: `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>UAT ログイン</title>
<style>
 body{font-family:system-ui,sans-serif;max-width:26rem;margin:4rem auto;padding:0 1rem;line-height:1.7}
 input,button{font:inherit;width:100%;padding:.6rem;margin-top:.4rem;box-sizing:border-box}
 button{margin-top:1rem;cursor:pointer}
 .note{font-size:.85rem;color:#555;margin-top:1.5rem}
</style></head><body>
<h1>UAT ログイン</h1>
<p>UAT 確認用のテスト会員としてログインします。</p>
<form method="POST" action="/.netlify/functions/uat-login" autocomplete="off">
  <label>合言葉<input type="password" name="key" autocomplete="off" autofocus required></label>
  <button type="submit">ログイン</button>
</form>
<p class="note">この画面は UAT / プレビュー環境にのみ存在します。本番では 404 になります。
発行されるのは無料会員のセッションです。プレミアムの見え方は Test Mode の決済を通してください。</p>
</body></html>`,
  };
}

export async function handler(event) {
  const host = event.headers?.host || '';
  const method = event.httpMethod || '';
  const contentType = event.headers?.['content-type'] || event.headers?.['Content-Type'] || '';

  // body は POST のときだけ読む（GET では合言葉を一切受け取らない）
  let providedKey = null;
  if (typeof method === 'string' && method.toUpperCase() === 'POST') {
    const raw = event.isBase64Encoded && typeof event.body === 'string'
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    providedKey = extractUatKey(raw, contentType);
  }

  const decision = decideUatLogin({ host, method, env: process.env, providedKey });

  switch (decision.outcome) {
    case UAT_OUTCOME.NOT_FOUND:
      return json(404, { error: 'not_found' });

    case UAT_OUTCOME.NOT_CONFIGURED:
      // 🔴 どの env が欠けているかは返すが、値は絶対に返さない
      return json(503, { error: 'not_configured', missing: UAT_LOGIN_KEY_ENV });

    case UAT_OUTCOME.METHOD_NOT_ALLOWED:
      return json(405, { error: 'method_not_allowed' });

    case UAT_OUTCOME.FORM:
      return formPage();

    case UAT_OUTCOME.OK:
    default:
      break;
  }

  const secret = process.env[SESSION_SECRET_ENV];
  const signed = signSession({
    email: UAT_MEMBER_EMAIL,
    tier: UAT_LOGIN_TIER,
    secret,
    nowMs: Date.now(),
  });

  // secret 未設定などは fail-closed（理由は返さない）
  if (!signed.ok) return json(503, { error: 'not_configured', missing: SESSION_SECRET_ENV });

  console.log('🧪 uat-login: issued free session for UAT member');

  return {
    statusCode: 302,
    headers: {
      ...BASE_HEADERS,
      Location: '/mypage',
      'Set-Cookie': serializeSessionCookie(signed.token),
    },
    body: '',
  };
}
