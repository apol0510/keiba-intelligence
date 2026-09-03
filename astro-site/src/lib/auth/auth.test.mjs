/**
 * auth.test.mjs — サーバー側認可の不変条件テスト
 *
 * 実行: node --test src/lib/auth/auth.test.mjs （astro-site 直下から）
 *
 * 固定する不変条件（docs/RENEWAL_2026_08.md §3 / §7）:
 *   1. 署名鍵が無い / Cookie が無い / 改竄 / 期限切れ / 壊れた形式 → すべて guest
 *   2. guest は印も買い目も見られない
 *   3. free は印だけ、有料 tier は買い目まで
 *   4. 🔴 **会場では分けない（2026-08-30 に「ライト＝南関」を廃止）**
 *      有料 tier は南関も中央も見える。venue を渡す経路が復活していないことも固定する。
 *   5. 未知の PlanType に有料権限を与えない
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TIER, tierRank, tierAtLeast, planTypeToTier, applyExpiry,
  canSeeMarks, canSeeBetting,
} from './tiers.js';

import {
  SESSION_COOKIE_NAME, SESSION_VERSION, SESSION_REJECT,
  signSession, verifySession, parseCookies, readSessionToken,
  serializeSessionCookie, clearSessionCookie,
} from './session.js';

import {
  resolveEntitlement, viewFlags, GUEST_VIEW, freePageViewFlags, paidPageRedirect,
} from './entitlement.js';

const SECRET = 'test-secret-do-not-use-in-production';
const NOW = Date.parse('2026-08-28T00:00:00Z');

function issue(over = {}) {
  const r = signSession({
    email: 'user@example.com', tier: TIER.PREMIUM, venueAccess: 'all',
    secret: SECRET, nowMs: NOW, ...over,
  });
  assert.ok(r.ok, `signSession failed: ${r.reason}`);
  return r.token;
}

function cookieOf(token) {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`;
}

/* ---------- tiers ---------- */

test('tierRank: 未知の tier は guest 相当', () => {
  assert.equal(tierRank('vip'), tierRank(TIER.GUEST));
  assert.equal(tierRank(undefined), 0);
  assert.ok(tierRank(TIER.PREMIUM) > tierRank(TIER.LIGHT));
  assert.ok(tierRank(TIER.LIGHT) > tierRank(TIER.FREE));
});

test('tierAtLeast: 順序どおりに判定する', () => {
  assert.ok(tierAtLeast(TIER.PREMIUM, TIER.LIGHT));
  assert.ok(!tierAtLeast(TIER.FREE, TIER.LIGHT));
  assert.ok(tierAtLeast(TIER.FREE, TIER.FREE));
});

test('planTypeToTier: 既存 PlanType を写像し、未知の値に有料権限を与えない', () => {
  assert.equal(planTypeToTier('pro'), TIER.PREMIUM);
  assert.equal(planTypeToTier('pro-plus'), TIER.PREMIUM);
  assert.equal(planTypeToTier('premium'), TIER.PREMIUM);
  assert.equal(planTypeToTier('light'), TIER.LIGHT);
  assert.equal(planTypeToTier('free-registered'), TIER.FREE);
  assert.equal(planTypeToTier(''), TIER.FREE);
  assert.equal(planTypeToTier(null), TIER.FREE);
  assert.equal(planTypeToTier('vip'), TIER.FREE);
  assert.equal(planTypeToTier('PRO'), TIER.PREMIUM);
});

test('applyExpiry: 期限切れの有料は free へ落ちる。読めない日付では落とさない', () => {
  assert.equal(applyExpiry(TIER.PREMIUM, '2026-08-01', NOW), TIER.FREE);
  assert.equal(applyExpiry(TIER.PREMIUM, '2026-12-01', NOW), TIER.PREMIUM);
  assert.equal(applyExpiry(TIER.PREMIUM, 'not-a-date', NOW), TIER.PREMIUM);
  assert.equal(applyExpiry(TIER.PREMIUM, null, NOW), TIER.PREMIUM);
  assert.equal(applyExpiry(TIER.FREE, '2026-08-01', NOW), TIER.FREE);
});

test('🔴 会場で分ける仕組みが tiers.js に存在しない', async () => {
  const mod = await import('./tiers.js');
  for (const gone of ['venueAllowed', 'normalizeVenueAccess', 'VENUE', 'canSeePremiumExtras']) {
    assert.equal(mod[gone], undefined, `${gone} が復活している（会場で分ける概念は廃止）`);
  }
});

test('canSeeMarks / canSeeBetting: tier 境界', () => {
  assert.ok(!canSeeMarks(TIER.GUEST));
  assert.ok(canSeeMarks(TIER.FREE));

  assert.ok(!canSeeBetting(TIER.GUEST));
  assert.ok(!canSeeBetting(TIER.FREE));
  assert.ok(canSeeBetting(TIER.LIGHT));
  assert.ok(canSeeBetting(TIER.PREMIUM));
});

test('🔴 canSeeBetting は会場を受け取らない（渡しても結果が変わらない）', () => {
  // 第 2 引数を付けても無視される＝会場での出し分けが復活していない
  assert.equal(canSeeBetting(TIER.LIGHT, { venue: 'jra', venueAccess: 'nankan' }), true);
  assert.equal(canSeeBetting(TIER.PREMIUM, { venue: 'nankan', venueAccess: 'jra' }), true);
  assert.equal(canSeeBetting.length, 1, 'canSeeBetting が会場の引数を持っている');
});

/* ---------- session ---------- */

test('signSession → verifySession: 往復できる', () => {
  const token = issue({ tier: TIER.LIGHT });
  const v = verifySession({ token, secret: SECRET, nowMs: NOW });
  assert.ok(v.ok);
  assert.equal(v.session.email, 'user@example.com');
  assert.equal(v.session.tier, TIER.LIGHT);
});

test('🟡 venueAccess は署名材料に残す（外すと発行済み Cookie が全部無効になる）', () => {
  // 会場での出し分けは廃止したが、payload から外すと全員ログアウトになるため形式は維持する
  const token = issue({ tier: TIER.PREMIUM, venueAccess: 'nankan' });
  const v = verifySession({ token, secret: SECRET, nowMs: NOW });
  assert.ok(v.ok, '既存形式の Cookie が検証できない');
  assert.equal(v.session.venueAccess, 'nankan');
});

test('signSession: secret 無しでは発行しない', () => {
  const r = signSession({ email: 'a@b.c', tier: TIER.FREE, secret: '', nowMs: NOW });
  assert.ok(!r.ok);
  assert.equal(r.reason, SESSION_REJECT.SECRET_MISSING);
  assert.equal(r.token, null);
});

test('verifySession: secret 未設定・token 無しは拒否', () => {
  const token = issue();
  assert.equal(verifySession({ token, secret: '', nowMs: NOW }).reason, SESSION_REJECT.SECRET_MISSING);
  assert.equal(verifySession({ token: '', secret: SECRET, nowMs: NOW }).reason, SESSION_REJECT.TOKEN_MISSING);
});

test('verifySession: payload を改竄すると落ちる（tier の昇格を防ぐ）', () => {
  const token = issue({ tier: TIER.FREE });
  const [ver, payload, sig] = token.split('.');
  const claims = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  claims.tier = TIER.PREMIUM;
  const forged = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const v = verifySession({ token: `${ver}.${forged}.${sig}`, secret: SECRET, nowMs: NOW });
  assert.ok(!v.ok);
  assert.equal(v.reason, SESSION_REJECT.SIGNATURE_INVALID);
  assert.equal(v.session, null);
});

test('verifySession: 別の secret で署名された token を受け付けない', () => {
  const token = signSession({ email: 'a@b.c', tier: TIER.PREMIUM, secret: 'other-secret', nowMs: NOW }).token;
  assert.ok(!verifySession({ token, secret: SECRET, nowMs: NOW }).ok);
});

test('verifySession: 期限切れは拒否', () => {
  const token = issue({ ttlSeconds: 60 });
  const v = verifySession({ token, secret: SECRET, nowMs: NOW + 61_000 });
  assert.equal(v.reason, SESSION_REJECT.EXPIRED);
});

test('verifySession: 壊れた形式・未知バージョンは拒否', () => {
  assert.equal(verifySession({ token: 'garbage', secret: SECRET, nowMs: NOW }).reason, SESSION_REJECT.MALFORMED);
  assert.equal(verifySession({ token: 'a.b.c.d', secret: SECRET, nowMs: NOW }).reason, SESSION_REJECT.MALFORMED);
  const token = issue();
  const bumped = token.replace(SESSION_VERSION, 'kis-v99');
  assert.equal(verifySession({ token: bumped, secret: SECRET, nowMs: NOW }).reason, SESSION_REJECT.VERSION_UNKNOWN);
});

test('parseCookies / readSessionToken: 壊れた入力でも例外を投げない', () => {
  assert.deepEqual(parseCookies(null), {});
  assert.deepEqual(parseCookies(';;;'), {});
  assert.equal(readSessionToken('other=1'), null);
  const token = issue();
  assert.equal(readSessionToken(`other=1; ${cookieOf(token)}; x=2`), token);
});

test('serializeSessionCookie: HttpOnly / SameSite / Secure が付く', () => {
  const c = serializeSessionCookie('tok');
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Lax/);
  assert.match(c, /Secure/);
  assert.match(c, /Path=\//);
  assert.doesNotMatch(serializeSessionCookie('tok', { secure: false }), /Secure/);
});

test('clearSessionCookie: 即時失効させる', () => {
  const c = clearSessionCookie();
  assert.match(c, /Max-Age=0/);
  assert.match(c, /Expires=/);
});

/* ---------- entitlement（fail-closed） ---------- */

test('resolveEntitlement: 署名鍵が無ければ guest', () => {
  const e = resolveEntitlement({ cookieHeader: cookieOf(issue()), env: {}, nowMs: NOW });
  assert.equal(e.tier, TIER.GUEST);
  assert.equal(e.reason, 'secret_missing');
  assert.equal(e.showMarks, false);
  assert.equal(e.showBetting, false);
});

test('resolveEntitlement: Cookie が無ければ guest', () => {
  const e = resolveEntitlement({ cookieHeader: null, env: { SESSION_SIGNING_SECRET: SECRET }, nowMs: NOW });
  assert.equal(e.tier, TIER.GUEST);
  assert.equal(e.reason, 'no_session');
});

test('resolveEntitlement: 改竄された Cookie は guest', () => {
  const e = resolveEntitlement({
    cookieHeader: `${SESSION_COOKIE_NAME}=kis-v1.aaaa.bbbb`,
    env: { SESSION_SIGNING_SECRET: SECRET }, nowMs: NOW,
  });
  assert.equal(e.tier, TIER.GUEST);
  assert.equal(e.showBetting, false);
});

test('resolveEntitlement: free は印だけ、買い目は出さない', () => {
  const e = resolveEntitlement({
    cookieHeader: cookieOf(issue({ tier: TIER.FREE })),
    env: { SESSION_SIGNING_SECRET: SECRET }, nowMs: NOW, venue: 'nankan',
  });
  assert.equal(e.tier, TIER.FREE);
  assert.equal(e.showMarks, true);
  assert.equal(e.showBetting, false);
  assert.equal(e.authenticated, true);
});

test('resolveEntitlement: 有料 tier は買い目まで開く', () => {
  const e = resolveEntitlement({
    cookieHeader: cookieOf(issue({ tier: TIER.LIGHT })),
    env: { SESSION_SIGNING_SECRET: SECRET }, nowMs: NOW,
  });
  assert.equal(e.showBetting, true);
  assert.equal(e.showPremiumExtras, undefined, 'premium 限定フラグは廃止した');
});

test('🔴 会場限定の古い Cookie でも買い目が開く（会場で分けないため）', () => {
  // VenueAccess='nankan' の既存会員が中央の買い目も見られることを固定する
  const e = resolveEntitlement({
    cookieHeader: cookieOf(issue({ tier: TIER.PREMIUM, venueAccess: 'nankan' })),
    env: { SESSION_SIGNING_SECRET: SECRET }, nowMs: NOW,
  });
  assert.equal(e.tier, TIER.PREMIUM);
  assert.equal(e.showMarks, true);
  assert.equal(e.showBetting, true);
  assert.equal(e.venueAccess, undefined, 'entitlement が venueAccess を持ち出している');
});

test('viewFlags: email を含めない（UI へ PII を渡さない）', () => {
  const e = resolveEntitlement({
    cookieHeader: cookieOf(issue()), env: { SESSION_SIGNING_SECRET: SECRET }, nowMs: NOW,
  });
  const v = viewFlags(e);
  assert.equal(v.email, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(v, 'email'), false);
  assert.equal(v.tier, TIER.PREMIUM);
});

test('GUEST_VIEW: 既定は何も開けない', () => {
  assert.equal(GUEST_VIEW.tier, TIER.GUEST);
  assert.equal(GUEST_VIEW.showMarks, false);
  assert.equal(GUEST_VIEW.showBetting, false);
});

/* ------------------------------------------------------------------
   無料ページ / 有料ページの分離（2026-09-03 仕様所有者の指示）

   🔴 「無料会員が pro 予想にアクセスできてしまう」
   🔴 「プレミアム会員で無料予想を開くと買い目が見えてしまう」
      → URL で分ける。有料ページは入れない／無料ページは買い目を出さない。
   ------------------------------------------------------------------ */

const asView = (tier, showMarks, showBetting) => ({
  tier, tierLabel: tier, showMarks, showBetting, authenticated: true, preview: false,
});

test('🔴 無料ページは有料会員でも買い目を出さない', () => {
  for (const tier of ['light', 'premium']) {
    const v = freePageViewFlags(asView(tier, true, true));
    assert.equal(v.showBetting, false, `${tier} に買い目が出ている`);
  }
});

test('無料ページでも印は tier どおりに残す（無料会員に印を見せるのが目的）', () => {
  assert.equal(freePageViewFlags(asView('free', true, false)).showMarks, true);
  assert.equal(freePageViewFlags(asView('guest', false, false)).showMarks, false);
});

test('無料ページのビューは tier 表示を壊さない', () => {
  const v = freePageViewFlags(asView('premium', true, true));
  assert.equal(v.tier, 'premium');
  assert.equal(v.authenticated, true);
});

test('🔴 有料ページ: 買い目を出せない tier は追い出す', () => {
  for (const tier of ['guest', 'free']) {
    assert.equal(
      paidPageRedirect(asView(tier, tier === 'free', false), '/free-prediction/nankan'),
      '/free-prediction/nankan',
      `${tier} が有料ページに入れてしまう`,
    );
  }
});

test('有料ページ: 買い目を出せる tier は素通し', () => {
  for (const tier of ['light', 'premium']) {
    assert.equal(paidPageRedirect(asView(tier, true, true), '/free-prediction/nankan'), null);
  }
});

test('🔴 有料ページ: 判定できないときは入れない（fail-closed）', () => {
  for (const v of [null, undefined, {}, { showBetting: 'true' }, { showBetting: 1 }]) {
    assert.equal(
      paidPageRedirect(v, '/free-prediction/jra'), '/free-prediction/jra',
      `壊れたビューで素通ししている: ${JSON.stringify(v)}`,
    );
  }
});

test('有料ページ: 行き先が無ければ /pricing へ', () => {
  assert.equal(paidPageRedirect(asView('free', true, false), ''), '/pricing');
  assert.equal(paidPageRedirect(asView('free', true, false)), '/pricing');
});
