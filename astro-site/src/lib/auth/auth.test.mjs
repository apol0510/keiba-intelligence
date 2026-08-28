/**
 * auth.test.mjs — サーバー側認可の不変条件テスト
 *
 * 実行: node --test src/lib/auth/auth.test.mjs （astro-site 直下から）
 *
 * 固定する不変条件（docs/RENEWAL_2026_08.md §3 / §7）:
 *   1. 署名鍵が無い / Cookie が無い / 改竄 / 期限切れ / 壊れた形式 → すべて guest
 *   2. guest は印も買い目も見られない
 *   3. free は印だけ、light/premium は買い目まで
 *   4. 会場アクセスが一致しない有料会員には買い目を出さない
 *   5. 未知の PlanType に有料権限を与えない
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TIER, tierRank, tierAtLeast, planTypeToTier, applyExpiry,
  normalizeVenueAccess, venueAllowed, canSeeMarks, canSeeBetting, canSeePremiumExtras,
} from './tiers.js';

import {
  SESSION_COOKIE_NAME, SESSION_VERSION, SESSION_REJECT,
  signSession, verifySession, parseCookies, readSessionToken,
  serializeSessionCookie, clearSessionCookie,
} from './session.js';

import { resolveEntitlement, viewFlags, GUEST_VIEW } from './entitlement.js';

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

test('venueAllowed: 会場限定の有料会員は他会場を見られない', () => {
  assert.ok(venueAllowed('all', 'jra'));
  assert.ok(venueAllowed('jra', 'jra'));
  assert.ok(!venueAllowed('jra', 'nankan'));
  assert.equal(normalizeVenueAccess('  JRA '), 'jra');
  assert.equal(normalizeVenueAccess('unknown'), 'all');
});

test('canSeeMarks / canSeeBetting / canSeePremiumExtras: tier 境界', () => {
  assert.ok(!canSeeMarks(TIER.GUEST));
  assert.ok(canSeeMarks(TIER.FREE));

  assert.ok(!canSeeBetting(TIER.GUEST));
  assert.ok(!canSeeBetting(TIER.FREE));
  assert.ok(canSeeBetting(TIER.LIGHT));
  assert.ok(canSeeBetting(TIER.PREMIUM));

  assert.ok(!canSeeBetting(TIER.LIGHT, { venue: 'jra', venueAccess: 'nankan' }));
  assert.ok(canSeeBetting(TIER.LIGHT, { venue: 'jra', venueAccess: 'all' }));

  assert.ok(!canSeePremiumExtras(TIER.LIGHT));
  assert.ok(canSeePremiumExtras(TIER.PREMIUM));
});

/* ---------- session ---------- */

test('signSession → verifySession: 往復できる', () => {
  const token = issue({ tier: TIER.LIGHT, venueAccess: 'nankan' });
  const v = verifySession({ token, secret: SECRET, nowMs: NOW });
  assert.ok(v.ok);
  assert.equal(v.session.email, 'user@example.com');
  assert.equal(v.session.tier, TIER.LIGHT);
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

test('resolveEntitlement: light は買い目まで、premium 限定は出さない', () => {
  const e = resolveEntitlement({
    cookieHeader: cookieOf(issue({ tier: TIER.LIGHT })),
    env: { SESSION_SIGNING_SECRET: SECRET }, nowMs: NOW, venue: 'nankan',
  });
  assert.equal(e.showBetting, true);
  assert.equal(e.showPremiumExtras, false);
});

test('resolveEntitlement: 会場が違う有料会員に買い目を出さない', () => {
  const e = resolveEntitlement({
    cookieHeader: cookieOf(issue({ tier: TIER.PREMIUM, venueAccess: 'nankan' })),
    env: { SESSION_SIGNING_SECRET: SECRET }, nowMs: NOW, venue: 'jra',
  });
  assert.equal(e.tier, TIER.PREMIUM);
  assert.equal(e.showMarks, true);
  assert.equal(e.showBetting, false);
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
  assert.equal(GUEST_VIEW.showPremiumExtras, false);
});
