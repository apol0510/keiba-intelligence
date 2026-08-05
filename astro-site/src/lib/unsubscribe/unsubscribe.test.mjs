/**
 * 配信停止ページの契約テスト（`node --test`）
 *
 * 🔴 fixture / mock のみを使用。本番 datastore へは一切書き込まない。
 * 実行: npm run test:unsubscribe
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  UNSUBSCRIBE_TOKEN_VERSION, EXPECTED_TENANT_ID, UNSUBSCRIBE_SCOPE, OUTCOME, REJECT, CSRF_REJECT,
  canonicalizeClaims, verifyUnsubscribeToken, operationId,
  issueCsrfToken, verifyCsrfToken, createFixedWindowRateLimiter, buildAuditEntry,
} from './token.js';
import {
  STORE_RESULT, createInMemoryUnsubscribeStore, restoreInMemoryUnsubscribeStore,
  createProductionUnsubscribeStore,
} from './store.js';
import {
  handleGet, handlePost, readCsrfCookie, buildCsrfCookie, CSRF_COOKIE_NAME, RATE_LIMIT,
} from './handler.js';

const SECRET = 'ki-unsub-test-secret-not-real';
const OTHER_SECRET = 'other-tenant-secret-not-real';
const T0 = Date.parse('2026-08-05T06:00:00Z');
const TTL = 30 * 24 * 60 * 60 * 1000;
const REF = 'recKI000000000001';

/** KMA 側の発行を模す（契約が一致していることの確認も兼ねる）。 */
function issue({
  tenantId = EXPECTED_TENANT_ID, recipientRef = REF, scope = UNSUBSCRIBE_SCOPE.MARKETING_ALL,
  campaignId = null, issuedAtMs = T0, expiresAtMs = T0 + TTL, nonce = 'nonce-1', secret = SECRET,
} = {}) {
  const claims = { v: UNSUBSCRIBE_TOKEN_VERSION, tenantId, recipientRef, scope, campaignId, issuedAtMs, expiresAtMs, nonce };
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(canonicalizeClaims(claims), 'utf8').digest('base64url');
  return { token: `${payload}.${sig}`, claims };
}

const limiter = () => createFixedWindowRateLimiter({ limit: RATE_LIMIT.POST, windowMs: RATE_LIMIT.WINDOW_MS });

describe('token 検証', () => {
  test('正常 token で確認画面を出せる', () => {
    const r = verifyUnsubscribeToken({ token: issue().token, secret: SECRET, nowMs: T0 + 1000 });
    assert.equal(r.ok, true);
    assert.equal(r.outcome, OUTCOME.CONFIRMABLE);
    assert.equal(r.claims.recipientRef, REF);
  });

  test('🔴 token にメールアドレスが含まれない', () => {
    const payload = Buffer.from(issue().token.split('.')[0], 'base64url').toString('utf8');
    assert.equal(payload.includes('@'), false);
  });

  test('🔴 改竄を拒否', () => {
    const { token, claims } = issue();
    const forged = Buffer.from(JSON.stringify({ ...claims, recipientRef: 'recVICTIM' }), 'utf8').toString('base64url');
    const r = verifyUnsubscribeToken({ token: `${forged}.${token.split('.')[1]}`, secret: SECRET, nowMs: T0 });
    assert.equal(r.reason, REJECT.SIGNATURE_INVALID);
    assert.equal(r.outcome, OUTCOME.INVALID);
  });

  test('🔴 期限を伸ばす改竄も署名で落ちる', () => {
    const { token, claims } = issue();
    const forged = Buffer.from(JSON.stringify({ ...claims, expiresAtMs: T0 + 1e12 }), 'utf8').toString('base64url');
    const r = verifyUnsubscribeToken({ token: `${forged}.${token.split('.')[1]}`, secret: SECRET, nowMs: T0 + TTL + 1 });
    assert.equal(r.reason, REJECT.SIGNATURE_INVALID);
  });

  test('🔴 期限切れは expired として区別', () => {
    const r = verifyUnsubscribeToken({ token: issue().token, secret: SECRET, nowMs: T0 + TTL + 1 });
    assert.equal(r.reason, REJECT.EXPIRED);
    assert.equal(r.outcome, OUTCOME.EXPIRED);
  });

  test('🔴 別 tenant の token を拒否（どの tenant かは教えない）', () => {
    const r = verifyUnsubscribeToken({ token: issue({ tenantId: 'other-brand' }).token, secret: SECRET, nowMs: T0 });
    assert.equal(r.reason, REJECT.TENANT_MISMATCH);
    assert.equal(r.outcome, OUTCOME.INVALID);
  });

  test('🔴 analytics-keiba の token を拒否（KMA 対象外ブランド）', () => {
    const r = verifyUnsubscribeToken({ token: issue({ tenantId: 'analytics-keiba' }).token, secret: SECRET, nowMs: T0 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, REJECT.TENANT_MISMATCH);
  });

  test('🔴 別 secret では検証できない', () => {
    const r = verifyUnsubscribeToken({ token: issue({ secret: OTHER_SECRET }).token, secret: SECRET, nowMs: T0 });
    assert.equal(r.reason, REJECT.SIGNATURE_INVALID);
  });

  test('🔴 壊れた形式・未知 version・secret 欠落を拒否', () => {
    for (const token of ['', 'x', 'a.b.c', '.sig', 'p.', 'bm90LWpzb24.sig']) {
      assert.equal(verifyUnsubscribeToken({ token, secret: SECRET, nowMs: T0 }).ok, false, token);
    }
    const { claims } = issue();
    const old = Buffer.from(JSON.stringify({ ...claims, v: 'unsub-v0' }), 'utf8').toString('base64url');
    assert.equal(verifyUnsubscribeToken({ token: `${old}.x`, secret: SECRET, nowMs: T0 }).reason, REJECT.VERSION_UNKNOWN);
    assert.equal(verifyUnsubscribeToken({ token: issue().token, secret: '', nowMs: T0 }).reason, REJECT.SECRET_MISSING);
  });

  test('operationId は tenant 込みで email を含まない', () => {
    const id = operationId(issue().claims);
    assert.ok(id.startsWith(`${EXPECTED_TENANT_ID}/`));
    assert.equal(id.includes('@'), false);
  });
});

describe('GET — 確認画面（解除は確定しない）', () => {
  test('正常 token で確認画面 ＋ CSRF が発行される', () => {
    const { token } = issue();
    const r = handleGet({ token, secret: SECRET, nowMs: T0, rateLimiter: limiter(), clientKey: 'ip1' });
    assert.equal(r.status, 200);
    assert.equal(r.view.outcome, OUTCOME.CONFIRMABLE);
    assert.ok(r.csrf.token);
    assert.match(r.csrf.cookie, /HttpOnly/);
    assert.match(r.csrf.cookie, /Secure/);
    assert.match(r.csrf.cookie, /SameSite=Lax/);
  });

  test('🔴 GET では store へ書き込まない（store を渡していない＝構造的に不可能）', () => {
    const store = createInMemoryUnsubscribeStore();
    handleGet({ token: issue().token, secret: SECRET, nowMs: T0, rateLimiter: limiter(), clientKey: 'ip1' });
    assert.equal(store.writeCount(), 0);
  });

  test('期限切れ 410 / 不正 400', () => {
    const rl = limiter();
    assert.equal(handleGet({ token: issue().token, secret: SECRET, nowMs: T0 + TTL + 1, rateLimiter: rl, clientKey: 'a' }).status, 410);
    assert.equal(handleGet({ token: 'broken', secret: SECRET, nowMs: T0, rateLimiter: rl, clientKey: 'b' }).status, 400);
  });

  test('🔴 rate limit を超えると 429', () => {
    const rl = createFixedWindowRateLimiter({ limit: 2, windowMs: 60000 });
    const args = { token: issue().token, secret: SECRET, nowMs: T0, rateLimiter: rl, clientKey: 'same' };
    assert.equal(handleGet(args).status, 200);
    assert.equal(handleGet(args).status, 200);
    const blocked = handleGet(args);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.view.rateLimited, true);
  });
});

describe('POST — 解除の確定', () => {
  function setup() {
    const store = createInMemoryUnsubscribeStore();
    const { token } = issue();
    const csrf = issueCsrfToken({ unsubscribeToken: token, nowMs: T0, secret: SECRET });
    return { store, token, csrf, rl: limiter() };
  }

  test('確認画面からの POST で解除が完了する', async () => {
    const { store, token, csrf, rl } = setup();
    const r = await handlePost({
      token, csrfForm: csrf, csrfCookie: csrf, secret: SECRET, nowMs: T0, rateLimiter: rl, clientKey: 'ip', store,
    });
    assert.equal(r.status, 200);
    assert.equal(r.view.outcome, OUTCOME.COMPLETED);
    assert.equal(store.writeCount(), 1);
  });

  test('🔴 同一 token の再 POST で二重 write なし（冪等）', async () => {
    const { store, token, csrf, rl } = setup();
    const args = { token, csrfForm: csrf, csrfCookie: csrf, secret: SECRET, nowMs: T0, rateLimiter: rl, clientKey: 'ip', store };
    const first = await handlePost(args);
    const again = await handlePost({ ...args, nowMs: T0 + 1000 });
    assert.equal(first.view.outcome, OUTCOME.COMPLETED);
    assert.equal(again.view.outcome, OUTCOME.ALREADY_UNSUBSCRIBED);
    assert.equal(store.writeCount(), 1, '実 write は 1 回だけ');
  });

  test('🔴 CSRF なし / 不一致 / 改竄を拒否（403・write 0）', async () => {
    for (const patch of [
      { csrfForm: null },
      { csrfCookie: null },
      { csrfCookie: 'different.value' },
      { csrfForm: '9999999999999.tampered', csrfCookie: '9999999999999.tampered' },
    ]) {
      const { store, token, csrf, rl } = setup();
      const r = await handlePost({
        token, csrfForm: csrf, csrfCookie: csrf, secret: SECRET, nowMs: T0,
        rateLimiter: rl, clientKey: 'ip', store, ...patch,
      });
      assert.equal(r.status, 403, JSON.stringify(patch));
      assert.equal(r.view.outcome, OUTCOME.INVALID);
      assert.equal(store.writeCount(), 0, 'CSRF 失敗時に write しない');
    }
  });

  test('🔴 CSRF 期限切れを拒否', async () => {
    const { store, token, csrf, rl } = setup();
    const r = await handlePost({
      token, csrfForm: csrf, csrfCookie: csrf, secret: SECRET,
      nowMs: T0 + 31 * 60 * 1000, rateLimiter: rl, clientKey: 'ip', store,
    });
    assert.equal(r.status, 403);
    assert.equal(store.writeCount(), 0);
  });

  test('🔴 別 token 用の CSRF を流用できない', async () => {
    const { store, rl } = setup();
    const a = issue({ nonce: 'n-a' });
    const b = issue({ nonce: 'n-b' });
    const csrfForB = issueCsrfToken({ unsubscribeToken: b.token, nowMs: T0, secret: SECRET });
    const r = await handlePost({
      token: a.token, csrfForm: csrfForB, csrfCookie: csrfForB, secret: SECRET,
      nowMs: T0, rateLimiter: rl, clientKey: 'ip', store,
    });
    assert.equal(r.status, 403);
    assert.equal(store.writeCount(), 0);
  });

  test('🔴 改竄 / 期限切れ / 別 tenant token は write しない', async () => {
    for (const [token, expected] of [
      ['broken.token', 400],
      [issue({ tenantId: 'analytics-keiba' }).token, 400],
    ]) {
      const store = createInMemoryUnsubscribeStore();
      const csrf = issueCsrfToken({ unsubscribeToken: token, nowMs: T0, secret: SECRET });
      const r = await handlePost({
        token, csrfForm: csrf, csrfCookie: csrf, secret: SECRET, nowMs: T0,
        rateLimiter: limiter(), clientKey: 'ip', store,
      });
      assert.equal(r.status, expected);
      assert.equal(store.writeCount(), 0);
    }
    // 期限切れ
    const store = createInMemoryUnsubscribeStore();
    const { token } = issue();
    const csrf = issueCsrfToken({ unsubscribeToken: token, nowMs: T0 + TTL + 1, secret: SECRET });
    const r = await handlePost({
      token, csrfForm: csrf, csrfCookie: csrf, secret: SECRET, nowMs: T0 + TTL + 1,
      rateLimiter: limiter(), clientKey: 'ip', store,
    });
    assert.equal(r.status, 410);
    assert.equal(store.writeCount(), 0);
  });

  test('🔴 rate limit 超過で 429・write 0', async () => {
    const store = createInMemoryUnsubscribeStore();
    const rl = createFixedWindowRateLimiter({ limit: 1, windowMs: 60000 });
    const { token } = issue();
    const csrf = issueCsrfToken({ unsubscribeToken: token, nowMs: T0, secret: SECRET });
    const args = { token, csrfForm: csrf, csrfCookie: csrf, secret: SECRET, nowMs: T0, rateLimiter: rl, clientKey: 'same', store };
    await handlePost(args);
    const blocked = await handlePost(args);
    assert.equal(blocked.status, 429);
    assert.equal(store.writeCount(), 1, '2 回目は write されない');
  });

  test('既に解除済みなら already 表示（write なし）', async () => {
    const store = createInMemoryUnsubscribeStore({ alreadyUnsubscribed: [REF] });
    const { token } = issue();
    const csrf = issueCsrfToken({ unsubscribeToken: token, nowMs: T0, secret: SECRET });
    const r = await handlePost({
      token, csrfForm: csrf, csrfCookie: csrf, secret: SECRET, nowMs: T0,
      rateLimiter: limiter(), clientKey: 'ip', store,
    });
    assert.equal(r.view.outcome, OUTCOME.ALREADY_UNSUBSCRIBED);
    assert.equal(store.writeCount(), 0);
  });

  test('🔴 restart 後も解除状態と冪等性が保たれる', async () => {
    const store = createInMemoryUnsubscribeStore();
    const { token } = issue();
    const csrf = issueCsrfToken({ unsubscribeToken: token, nowMs: T0, secret: SECRET });
    await handlePost({
      token, csrfForm: csrf, csrfCookie: csrf, secret: SECRET, nowMs: T0,
      rateLimiter: limiter(), clientKey: 'ip', store,
    });

    // restart を模す。CSRF は 30 分で失効するため、利用者が確認画面を開き直した状況＝新しい CSRF を使う。
    const laterMs = T0 + 9e6;
    const restored = restoreInMemoryUnsubscribeStore(store.snapshot());
    const freshCsrf = issueCsrfToken({ unsubscribeToken: token, nowMs: laterMs, secret: SECRET });
    const after = await handlePost({
      token, csrfForm: freshCsrf, csrfCookie: freshCsrf, secret: SECRET, nowMs: laterMs,
      rateLimiter: limiter(), clientKey: 'ip', store: restored,
    });
    assert.equal(after.view.outcome, OUTCOME.ALREADY_UNSUBSCRIBED);
    assert.equal(restored.writeCount(), 0, 'restart 後に再 write しない');
  });

  test('🔴 古い CSRF は restart の有無にかかわらず拒否される（期限が効いている証拠）', async () => {
    const store = createInMemoryUnsubscribeStore();
    const { token } = issue();
    const staleCsrf = issueCsrfToken({ unsubscribeToken: token, nowMs: T0, secret: SECRET });
    const r = await handlePost({
      token, csrfForm: staleCsrf, csrfCookie: staleCsrf, secret: SECRET, nowMs: T0 + 9e6,
      rateLimiter: limiter(), clientKey: 'ip', store,
    });
    assert.equal(r.status, 403);
    assert.equal(store.writeCount(), 0);
  });
});

describe('🔴 本番 store は既定で fail-closed', () => {
  test('write が無効なら unavailable（完了と表示しない）', async () => {
    const store = createProductionUnsubscribeStore({ writeEnabled: false });
    assert.equal(store.enabled, false);
    const r = await store.apply({ operationId: 'op', recipientRef: REF, nowMs: T0 });
    assert.equal(r.result, STORE_RESULT.UNAVAILABLE);
  });

  test('🔴 resolver 未実装なら write が有効でも unavailable', async () => {
    const store = createProductionUnsubscribeStore({ writeEnabled: true });
    assert.equal(store.enabled, false);
    assert.equal((await store.apply({ operationId: 'op', recipientRef: REF, nowMs: T0 })).result, STORE_RESULT.UNAVAILABLE);
  });

  test('🔴 handlePost は unavailable を 503 にし「完了」と表示しない', async () => {
    const store = createProductionUnsubscribeStore({ writeEnabled: false });
    const { token } = issue();
    const csrf = issueCsrfToken({ unsubscribeToken: token, nowMs: T0, secret: SECRET });
    const r = await handlePost({
      token, csrfForm: csrf, csrfCookie: csrf, secret: SECRET, nowMs: T0,
      rateLimiter: limiter(), clientKey: 'ip', store,
    });
    assert.equal(r.status, 503);
    assert.notEqual(r.view.outcome, OUTCOME.COMPLETED);
    assert.equal(r.view.temporarilyUnavailable, true);
  });

  test('recipientRef を解決できない場合も unavailable', async () => {
    const store = createProductionUnsubscribeStore({
      writeEnabled: true,
      resolveRecipient: async () => null,
      updateUnsubscribeFlag: async () => {},
      hasProcessedOperation: async () => false,
      markOperation: async () => {},
    });
    assert.equal(store.enabled, true);
    assert.equal((await store.apply({ operationId: 'op', recipientRef: REF, nowMs: T0 })).result, STORE_RESULT.UNAVAILABLE);
  });

  test('全部揃えば applied（構造の確認のみ・実接続はしない）', async () => {
    const writes = [];
    const ops = new Set();
    const store = createProductionUnsubscribeStore({
      writeEnabled: true,
      resolveRecipient: async (ref) => (ref === REF ? 'recResolved' : null),
      updateUnsubscribeFlag: async (id) => { writes.push(id); },
      hasProcessedOperation: async (op) => ops.has(op),
      markOperation: async (op) => { ops.add(op); },
    });
    assert.equal((await store.apply({ operationId: 'op1', recipientRef: REF, nowMs: T0 })).result, STORE_RESULT.APPLIED);
    assert.equal((await store.apply({ operationId: 'op1', recipientRef: REF, nowMs: T0 })).result, STORE_RESULT.ALREADY);
    assert.deepEqual(writes, ['recResolved'], '二重 write なし');
  });
});

describe('🔴 PII / secret 非露出', () => {
  test('画面へ渡す view に email / recipientRef / token が無い', async () => {
    const store = createInMemoryUnsubscribeStore();
    const { token } = issue();
    const csrf = issueCsrfToken({ unsubscribeToken: token, nowMs: T0, secret: SECRET });
    const got = handleGet({ token, secret: SECRET, nowMs: T0, rateLimiter: limiter(), clientKey: 'ip' });
    const posted = await handlePost({
      token, csrfForm: csrf, csrfCookie: csrf, secret: SECRET, nowMs: T0,
      rateLimiter: limiter(), clientKey: 'ip', store,
    });
    for (const v of [got.view, posted.view]) {
      const json = JSON.stringify(v);
      assert.equal(json.includes('@'), false);
      assert.equal(json.includes(REF), false);
      assert.equal(json.includes(SECRET), false);
      assert.equal(json.includes(token), false);
    }
  });

  test('🔴 監査ログは tenantId / 相関 ID / 結果 / 時刻 のみ', () => {
    const entry = buildAuditEntry({ operationId: operationId(issue().claims), outcome: OUTCOME.COMPLETED, atMs: T0 });
    assert.deepEqual(Object.keys(entry).sort(), ['atMs', 'correlationId', 'outcome', 'tenantId']);
    const json = JSON.stringify(entry);
    assert.equal(json.includes(REF), false);
    assert.equal(json.includes('@'), false);
    assert.match(entry.correlationId, /^[0-9a-f]{16}$/);
  });
});

describe('CSRF cookie の扱い', () => {
  test('cookie を組み立てて読み戻せる', () => {
    const cookie = buildCsrfCookie('abc.def');
    assert.match(cookie, new RegExp(`^${CSRF_COOKIE_NAME}=abc\\.def;`));
    assert.match(cookie, /Path=\/unsubscribe/);
    assert.equal(readCsrfCookie(`foo=1; ${CSRF_COOKIE_NAME}=abc.def; bar=2`), 'abc.def');
  });

  test('cookie が無ければ null', () => {
    assert.equal(readCsrfCookie(''), null);
    assert.equal(readCsrfCookie('other=1'), null);
    assert.equal(readCsrfCookie(null), null);
  });
});

describe('🔴 KMA 契約との一致', () => {
  test('version / scope 語彙が KMA と一致する', () => {
    assert.equal(UNSUBSCRIBE_TOKEN_VERSION, 'unsub-v1');
    assert.deepEqual(Object.values(UNSUBSCRIBE_SCOPE).sort(), ['campaign', 'marketing-all']);
    assert.equal(EXPECTED_TENANT_ID, 'keiba-intelligence');
  });

  test('CSRF の署名・検証が自己整合する', () => {
    const { token } = issue();
    const csrf = issueCsrfToken({ unsubscribeToken: token, nowMs: T0, secret: SECRET });
    assert.equal(verifyCsrfToken({ formValue: csrf, cookieValue: csrf, unsubscribeToken: token, nowMs: T0, secret: SECRET }).ok, true);
    assert.equal(
      verifyCsrfToken({ formValue: csrf, cookieValue: csrf, unsubscribeToken: token, nowMs: T0, secret: OTHER_SECRET }).reason,
      CSRF_REJECT.INVALID,
    );
  });
});
