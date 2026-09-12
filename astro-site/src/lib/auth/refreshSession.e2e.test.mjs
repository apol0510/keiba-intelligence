/**
 * refreshSession.e2e.test.mjs — 決済反映の最後の 1 手を**実ハンドラで**通しで確かめる
 *
 * 実行: npm run test:refresh-session （astro-site 直下から）
 *   node --experimental-test-module-mocks --test src/lib/auth/refreshSession.e2e.test.mjs
 *
 * ── なぜこのテストが要るか（2026-09-12 の UAT 事故）──────────────
 * Stripe の決済は成立し、webhook も（署名を直したあと）Airtable を premium に
 * 更新できていたのに、`/mypage` の上部は「無料会員」のままだった。
 * 原因は **セッション Cookie が古いまま**で、`refresh-session` が
 * 決済後に一度も走っていなかったこと。
 *
 * 🔴 そのとき判明したのは、**`refresh-session` の実ハンドラを動かすテストが
 *    1 つも無かった**ということ（`refreshSession.guard.test.mjs` は
 *    ソースを文字列として読む静的ガードで、実行はしていない）。
 *    決済反映の鎖の最後の 1 手が未被覆だった。
 *
 * ── ここで固定する鎖 ──────────────────────────────────────────
 *   Airtable が premium（＝ webhook が書いた状態）
 *     → refresh-session が Cookie を出し直す
 *     → その Cookie で entitlement が premium
 *     → 買い目が開く（showBetting）
 *
 * webhook が Airtable を書くところまでは `test:stripe`
 * （`src/lib/billing/stripeWebhook.test.mjs`）が実ハンドラで見ている。
 * 本ファイルはその**続き**を受け持つ。
 *
 * 🔴 ネットワークは使わない。`airtable` だけ差し替え、関数の実コードを動かす。
 */

import { test, describe, mock, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { TIER } from './tiers.js';
import { signSession, verifySession, SESSION_COOKIE_NAME } from './session.js';
import { resolveEntitlement, viewFlags } from './entitlement.js';

const SESSION_SECRET = 'session-secret-for-test-only';
/** 🔴 実在しないドメイン。本番・UAT のアドレスを使わない。 */
const MEMBER = 'uat@example.invalid';
const HOST = 'uat--example.netlify.app';
const DAY = 24 * 60 * 60 * 1000;

/** Airtable の差し替え（メモリ上）。 */
const db = {
  rows: [],
  reset() {
    this.rows = [{
      id: 'recMEMBER',
      fields: { Email: MEMBER, PlanType: 'free-registered', Status: 'active', AccessEnabled: true },
    }];
  },
};

let handler;

before(async () => {
  process.env.AIRTABLE_API_KEY = 'key_test';
  process.env.AIRTABLE_BASE_ID = 'app_test';
  process.env.SESSION_SIGNING_SECRET = SESSION_SECRET;

  mock.module('airtable', {
    defaultExport: class AirtableStub {
      constructor() {}
      base() {
        return () => ({
          select(opts) {
            return {
              async firstPage() {
                const m = String(opts?.filterByFormula || '').match(/\{Email\} = "(.*)"/);
                const email = m ? m[1].replace(/\\"/g, '"') : null;
                const row = db.rows.find((r) => r.fields.Email === email);
                return row ? [row] : [];
              },
            };
          },
        });
      }
    },
  });

  ({ handler } = await import('../../../netlify/functions/refresh-session.js'));
});

beforeEach(() => {
  db.reset();
  process.env.SESSION_SIGNING_SECRET = SESSION_SECRET;
});

/** 会員としてログイン済みの Cookie ヘッダーを作る。 */
function loggedInCookie(tier, { nowMs, ttlSeconds = 7 * 24 * 60 * 60 } = {}) {
  const signed = signSession({ email: MEMBER, tier, secret: SESSION_SECRET, nowMs, ttlSeconds });
  assert.ok(signed.ok, 'テスト用セッションを作れない');
  return { header: `${SESSION_COOKIE_NAME}=${encodeURIComponent(signed.token)}`, token: signed.token, expiresAtMs: signed.expiresAtMs };
}

async function callRefresh(cookieHeader) {
  const res = await handler({
    httpMethod: 'POST',
    headers: { cookie: cookieHeader, host: HOST },
    body: '',
  });
  return { ...res, json: JSON.parse(res.body || '{}') };
}

/** Set-Cookie から token を取り出す。 */
function tokenFromSetCookie(setCookie) {
  const m = String(setCookie || '').match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

describe('🔴 決済反映の最後の 1 手（refresh-session の実ハンドラ）', () => {
  test('🔴 Airtable が premium なら、free の Cookie を premium へ出し直す', async () => {
    const nowMs = Date.now();
    // webhook が書いたあとの状態
    db.rows[0].fields.PlanType = 'premium';

    const { header } = loggedInCookie(TIER.FREE, { nowMs });
    const res = await callRefresh(header);

    assert.equal(res.statusCode, 200);
    assert.equal(res.json.tier, TIER.PREMIUM, '🔴 premium へ上がっていない');
    assert.equal(res.json.changed, true, '🔴 changed:true が返っていない');
    assert.ok(res.headers['Set-Cookie'], '🔴 Set-Cookie が返っていない');
    assert.match(res.headers['Set-Cookie'], /HttpOnly/);
    assert.match(res.headers['Set-Cookie'], /SameSite=Lax/);
  });

  test('🔴 出し直した Cookie で entitlement が premium になり、買い目が開く', async () => {
    const nowMs = Date.now();
    db.rows[0].fields.PlanType = 'premium';

    const { header } = loggedInCookie(TIER.FREE, { nowMs });
    const res = await callRefresh(header);
    const token = tokenFromSetCookie(res.headers['Set-Cookie']);
    assert.ok(token, 'Set-Cookie から token を取り出せない');

    // 出し直された Cookie をそのまま次のリクエストへ渡す
    const ent = resolveEntitlement({
      cookieHeader: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
      env: { SESSION_SIGNING_SECRET: SESSION_SECRET },
      nowMs: nowMs + 1000,
    });
    const view = viewFlags(ent);

    assert.equal(ent.tier, TIER.PREMIUM);
    assert.equal(ent.authenticated, true);
    assert.equal(view.showBetting, true, '🔴 買い目が開いていない');
    assert.equal(view.showMarks, true);
  });

  test('🔴 セッションの寿命を延ばさない（残り時間を引き継ぐ）', async () => {
    const nowMs = Date.now();
    db.rows[0].fields.PlanType = 'premium';

    // 残り 2 日のセッション
    const { header, expiresAtMs } = loggedInCookie(TIER.FREE, { nowMs, ttlSeconds: 2 * 24 * 60 * 60 });
    const res = await callRefresh(header);
    const token = tokenFromSetCookie(res.headers['Set-Cookie']);
    const verified = verifySession({ token, secret: SESSION_SECRET, nowMs: nowMs + 1000 });

    assert.equal(verified.ok, true);
    assert.ok(
      verified.session.expiresAtMs <= expiresAtMs + 2000,
      '🔴 満了が先送りされている（無期限ログインになる）',
    );
  });

  /* ----------------------------------------------------------------
     事故当時の状態：webhook が失敗していて Airtable がまだ free
     ---------------------------------------------------------------- */

  test('🔴 Airtable がまだ free-registered なら昇格しない（changed:false・Cookie を出さない）', async () => {
    const nowMs = Date.now();
    const { header } = loggedInCookie(TIER.FREE, { nowMs });
    const res = await callRefresh(header);

    assert.equal(res.statusCode, 200);
    assert.equal(res.json.tier, TIER.FREE);
    assert.equal(res.json.changed, false);
    assert.equal(res.headers['Set-Cookie'], undefined, '🔴 変化が無いのに Cookie を出し直している');
  });

  test('🔴 レコードが無ければ降格させない（判断材料が無い）', async () => {
    const nowMs = Date.now();
    db.rows = [];
    const { header } = loggedInCookie(TIER.PREMIUM, { nowMs });
    const res = await callRefresh(header);

    assert.equal(res.statusCode, 200);
    assert.equal(res.json.tier, TIER.PREMIUM, '🔴 レコードが無いだけで降格している');
    assert.equal(res.json.changed, false);
  });

  test('有効期限切れの premium は free へ落とす', async () => {
    const nowMs = Date.now();
    db.rows[0].fields.PlanType = 'premium';
    db.rows[0].fields.ExpirationDate = new Date(nowMs - DAY).toISOString();

    const { header } = loggedInCookie(TIER.PREMIUM, { nowMs });
    const res = await callRefresh(header);

    assert.equal(res.json.tier, TIER.FREE);
    assert.equal(res.json.changed, true);
  });

  /* ----------------------------------------------------------------
     ログインの入口にしない / fail-closed
     ---------------------------------------------------------------- */

  test('🔴 ログインの入口にしない（セッションが無ければ 401）', async () => {
    db.rows[0].fields.PlanType = 'premium';
    const res = await callRefresh('');
    assert.equal(res.statusCode, 401);
    assert.equal(res.json.error, 'login_required');
    assert.equal(res.headers['Set-Cookie'], undefined);
  });

  test('🔴 署名鍵が無ければ Cookie を出し直さない（fail-closed）', async () => {
    const nowMs = Date.now();
    db.rows[0].fields.PlanType = 'premium';
    const { header } = loggedInCookie(TIER.FREE, { nowMs });

    delete process.env.SESSION_SIGNING_SECRET;
    const res = await callRefresh(header);

    // 鍵が無いと入口の entitlement も成立しないため、昇格は起きない
    assert.notEqual(res.json.changed, true, '🔴 鍵が無いのに Cookie を出し直している');
    assert.equal(res.headers['Set-Cookie'], undefined);
  });

  test('POST 以外は受けない', async () => {
    const res = await handler({ httpMethod: 'GET', headers: { host: HOST }, body: '' });
    assert.equal(res.statusCode, 405);
  });
});
