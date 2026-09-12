/**
 * webhookAlert.test.mjs — webhook 失敗通知の安全契約
 *
 * 🔴 ここで守るのは 4 つ。
 *   1. **本番ホスト以外では送らない**（UAT から production の SendGrid を使わない）
 *   2. **未認証の入力でメールを撃たせない**（同じ理由は時間窓で 1 通だけ）
 *   3. **秘密値・リクエスト内容を通知に含めない**
 *   4. **決済経路に SendGrid を持ち込まない**（送信は既存の send-alert に任せる）
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  shouldNotifyWebhookFailure, buildWebhookAlertPayload, isProductionHost, hostFromHeaders,
  WEBHOOK_ALERT_REASON, WEBHOOK_ALERT_WINDOW_MS, SKIP,
  requiresAlertNonce, verifyAlertNonce, isWellFormedNonce,
  INTERNAL_ALERT_TYPE, ALERT_NONCE_STORE, ALERT_NONCE_TTL_MS,
} from './webhookAlert.js';

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(siteRoot, p), 'utf8');

const PROD = { host: 'keiba-intelligence.jp' };
const ENV = { ALERT_EMAIL: 'ops@example.invalid' };
const REASON = WEBHOOK_ALERT_REASON.INVALID_SIGNATURE;

describe('🔴 本番ホスト以外では通知しない', () => {
  test('UAT / Deploy Preview / localhost からは送らない', () => {
    for (const host of [
      'uat--keiba-intelligence.netlify.app',
      'deploy-preview-42--keiba-intelligence.netlify.app',
      'localhost:8888',
      'keiba-intelligence.netlify.app', // 本番エイリアスだが独自ドメインではない
      '',
    ]) {
      const r = shouldNotifyWebhookFailure({ reason: REASON, headers: { host }, env: ENV });
      assert.equal(r.notify, false, `🔴 ${host} から送ろうとしている`);
      assert.equal(r.skip, SKIP.NOT_PRODUCTION_HOST);
    }
  });

  test('本番の独自ドメインなら送る', () => {
    for (const host of ['keiba-intelligence.jp', 'www.keiba-intelligence.jp', 'KEIBA-INTELLIGENCE.JP', 'keiba-intelligence.jp:443']) {
      const r = shouldNotifyWebhookFailure({ reason: REASON, headers: { host }, env: ENV });
      assert.equal(r.notify, true, `${host} で送れていない`);
    }
  });

  test('host ヘッダーは大文字小文字を問わず読む', () => {
    assert.equal(hostFromHeaders({ Host: 'keiba-intelligence.jp' }), 'keiba-intelligence.jp');
    assert.equal(isProductionHost('keiba-intelligence.jp'), true);
    assert.equal(isProductionHost('example.com'), false);
  });
});

describe('🔴 未認証の入力でメールを撃たせない', () => {
  test('同じ理由は時間窓の中では送らない', () => {
    const nowMs = Date.now();
    const r = shouldNotifyWebhookFailure({
      reason: REASON, headers: PROD, env: ENV, nowMs,
      lastNotifiedAtMs: nowMs - (WEBHOOK_ALERT_WINDOW_MS - 1000),
    });
    assert.equal(r.notify, false);
    assert.equal(r.skip, SKIP.WITHIN_WINDOW);
  });

  test('時間窓を過ぎたら送る', () => {
    const nowMs = Date.now();
    const r = shouldNotifyWebhookFailure({
      reason: REASON, headers: PROD, env: ENV, nowMs,
      lastNotifiedAtMs: nowMs - (WEBHOOK_ALERT_WINDOW_MS + 1000),
    });
    assert.equal(r.notify, true);
    assert.equal(r.dedupeKey, `webhook-alert:${REASON}`);
  });

  test('理由ごとに別の鍵を使う（片方で塞がれない）', () => {
    const a = shouldNotifyWebhookFailure({ reason: WEBHOOK_ALERT_REASON.INVALID_SIGNATURE, headers: PROD, env: ENV });
    const b = shouldNotifyWebhookFailure({ reason: WEBHOOK_ALERT_REASON.NOT_CONFIGURED, headers: PROD, env: ENV });
    assert.notEqual(a.dedupeKey, b.dedupeKey);
  });

  test('🔴 未知の理由では送らない', () => {
    for (const reason of ['boom', '', null, undefined, 'handler_failed']) {
      const r = shouldNotifyWebhookFailure({ reason, headers: PROD, env: ENV });
      assert.equal(r.notify, false, `🔴 ${reason} で送ろうとしている`);
    }
  });

  test('宛先が無ければ送らない', () => {
    for (const env of [{}, { ALERT_EMAIL: '' }, { ALERT_EMAIL: '   ' }]) {
      const r = shouldNotifyWebhookFailure({ reason: REASON, headers: PROD, env });
      assert.equal(r.notify, false);
      assert.equal(r.skip, SKIP.NO_RECIPIENT);
    }
  });
});

describe('🔴 通知の中身に秘密値を入れない', () => {
  test('本文は理由と次の手順だけ', () => {
    const p = buildWebhookAlertPayload({ reason: REASON, nowIso: '2026-09-12T00:00:00.000Z' });
    assert.equal(p.type, 'stripe_webhook_failed');
    assert.equal(p.metadata.reason, REASON);
    assert.ok(p.metadata.nextSteps.length > 0);

    const blob = JSON.stringify(p);
    for (const forbidden of ['whsec_', 'sk_test_', 'sk_live_', 'pat', 'Bearer ', 'stripe-signature']) {
      assert.equal(blob.includes(forbidden), false, `🔴 通知に ${forbidden} が含まれている`);
    }
    // 決済内容・顧客情報も含めない
    for (const forbidden of ['email', 'amount', 'customer', 'invoice']) {
      assert.equal(blob.toLowerCase().includes(forbidden), false, `🔴 通知に ${forbidden} が含まれている`);
    }
  });

  test('再デプロイが要ることを手順に含める（env は deploy 時注入）', () => {
    const p = buildWebhookAlertPayload({ reason: REASON });
    assert.match(p.metadata.nextSteps.join(' '), /再デプロイ/);
  });
});

describe('🔴 決済経路を壊さない', () => {
  const src = read('netlify/functions/stripe-webhook.js');

  test('🔴 stripe-webhook は SendGrid を持ち込まない（送信は send-alert に任せる）', () => {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').toLowerCase();
    assert.equal(code.includes('@sendgrid/mail'), false, '🔴 決済経路に SendGrid が入っている');
    assert.equal(code.includes('sgmail'), false);
    assert.match(src, /functions\/send-alert/);
  });

  test('🔴 通知は失敗しても webhook の応答を変えない（try/catch で閉じる）', () => {
    const fn = src.slice(src.indexOf('async function notifyFailureOnce'), src.indexOf('async function markProcessed'));
    assert.match(fn, /try \{/);
    assert.match(fn, /catch \(err\) \{/);
    assert.equal(/throw /.test(fn), false, '🔴 通知経路が throw しうる');
  });

  test('🔴 通知でリクエストを待たせない（タイムアウトを付ける）', () => {
    const fn = src.slice(src.indexOf('async function notifyFailureOnce'), src.indexOf('async function markProcessed'));
    assert.match(fn, /AbortController/);
    assert.match(fn, /setTimeout\(\(\) => controller\.abort\(\)/);
    assert.match(fn, /clearTimeout/);
  });

  test('🔴 送信前に記録する（多重送信より送り漏れを選ぶ）', () => {
    const fn = src.slice(src.indexOf('async function notifyFailureOnce'), src.indexOf('async function markProcessed'));
    assert.ok(fn.indexOf('store.set(key') < fn.indexOf('await fetch('), '🔴 送信してから記録している');
  });

  test('失敗の 2 経路から呼ばれている', () => {
    assert.match(src, /notifyFailureOnce\(event, 'not_configured'\)/);
    assert.match(src, /notifyFailureOnce\(event, 'invalid_signature'\)/);
  });
});

/* ==================================================================
   🔴 この alert type を外部から発火させない（単回使用 nonce）

   `send-alert` は認証を持たない。そのままだと `stripe_webhook_failed` を
   外部から直接叩けてしまい、webhook 側の 6 時間 dedup を**迂回して**
   メールを撃たせられる。
   ================================================================== */
describe('🔴 stripe_webhook_failed を未認証の外部入力から発火させない', () => {
  const VALID = 'a'.repeat(64);
  const nowMs = Date.UTC(2026, 8, 12, 12, 0, 0);
  const iso = (ms) => new Date(ms).toISOString();

  test('この type だけ nonce を要求する', () => {
    assert.equal(requiresAlertNonce(INTERNAL_ALERT_TYPE), true);
    assert.equal(INTERNAL_ALERT_TYPE, 'stripe_webhook_failed');
  });

  test('🔴 既存の alert type には影響しない（nonce 不要のまま）', () => {
    for (const t of [
      'github_actions_failed', 'hit_rate_zero', 'no_prediction_data',
      'results_import_failed', 'results_auto_added', 'anything_else',
    ]) {
      assert.equal(requiresAlertNonce(t), false, `🔴 ${t} に nonce を要求している`);
      // nonce が無くても通る
      assert.equal(verifyAlertNonce({ type: t, nonce: null, storedAtIso: null, nowMs }).ok, true);
    }
  });

  test('🔴 nonce が無ければ拒否（外部からの直叩き）', () => {
    for (const nonce of [undefined, null, '', 'short', 'Z'.repeat(64), 'a'.repeat(63)]) {
      const v = verifyAlertNonce({ type: INTERNAL_ALERT_TYPE, nonce, storedAtIso: iso(nowMs), nowMs });
      assert.equal(v.ok, false, `🔴 nonce=${nonce} が通っている`);
      assert.equal(v.reason, 'nonce_missing');
    }
  });

  test('🔴 Blobs に無い nonce は拒否（推測・捏造）', () => {
    const v = verifyAlertNonce({ type: INTERNAL_ALERT_TYPE, nonce: VALID, storedAtIso: null, nowMs });
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'nonce_unknown');
  });

  test('🔴 期限切れの nonce は拒否（使い回し）', () => {
    const v = verifyAlertNonce({
      type: INTERNAL_ALERT_TYPE, nonce: VALID,
      storedAtIso: iso(nowMs - ALERT_NONCE_TTL_MS - 1000), nowMs,
    });
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'nonce_expired');
  });

  test('未来日時の nonce も拒否（時刻の細工）', () => {
    const v = verifyAlertNonce({
      type: INTERNAL_ALERT_TYPE, nonce: VALID, storedAtIso: iso(nowMs + 10 * 60 * 1000), nowMs,
    });
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'nonce_future');
  });

  test('読めない発行時刻は拒否', () => {
    const v = verifyAlertNonce({ type: INTERNAL_ALERT_TYPE, nonce: VALID, storedAtIso: 'not-a-date', nowMs });
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'nonce_unreadable');
  });

  test('webhook が発行した直後の nonce は通る', () => {
    const v = verifyAlertNonce({ type: INTERNAL_ALERT_TYPE, nonce: VALID, storedAtIso: iso(nowMs - 500), nowMs });
    assert.equal(v.ok, true);
  });

  test('nonce の形は 16 進 64 文字', () => {
    assert.equal(isWellFormedNonce(VALID), true);
    assert.equal(isWellFormedNonce('abc'), false);
    assert.equal(isWellFormedNonce(null), false);
  });
});

describe('🔴 nonce の発行と検証の配線', () => {
  const webhookSrc = read('netlify/functions/stripe-webhook.js');
  const alertSrc = read('netlify/functions/send-alert.js');

  test('🔴 nonce を作れるのは webhook だけ（乱数 32 バイト）', () => {
    assert.match(webhookSrc, /randomBytes\(32\)\.toString\('hex'\)/);
    assert.equal(/randomBytes/.test(alertSrc), false, '🔴 send-alert が nonce を作っている');
  });

  test('🔴 dedup を通ったあとに発行する（迂回させない）', () => {
    const fn = webhookSrc.slice(
      webhookSrc.indexOf('async function notifyFailureOnce'),
      webhookSrc.indexOf('async function markProcessed'),
    );
    assert.ok(fn.length > 0, 'notifyFailureOnce を切り出せていない');
    const iDedupe = fn.indexOf('if (!decision.notify) return;');
    const iMint = fn.indexOf('randomBytes(32)');
    assert.ok(iDedupe > 0 && iMint > 0, 'dedup 判定または nonce 発行が見つからない');
    assert.ok(iDedupe < iMint, '🔴 dedup 判定より前に nonce を発行している');
  });

  test('🔴 nonce を置けなければ送らない（fail-closed）', () => {
    assert.match(webhookSrc, /if \(!nonceStore\) \{[\s\S]{0,200}return;/);
  });

  test('🔴 send-alert は検証 NG なら 403 を返し、送信しない', () => {
    assert.match(alertSrc, /if \(!verdict\.ok\) \{/);
    assert.match(alertSrc, /statusCode: 403[\s\S]{0,80}forbidden/);
    // 検証は SendGrid の送信より前
    assert.ok(alertSrc.indexOf('verifyAlertNonce') < alertSrc.indexOf('sgMail.send'),
      '🔴 送信してから検証している');
  });

  test('🔴 単回使用（検証後に消す）', () => {
    assert.match(alertSrc, /store\.delete\(nonce\)/);
    assert.ok(alertSrc.indexOf('verifyAlertNonce') < alertSrc.indexOf('store.delete(nonce)'));
  });

  test('両者が同じストア名を使う', () => {
    assert.match(webhookSrc, /ALERT_NONCE_STORE/);
    assert.match(alertSrc, /ALERT_NONCE_STORE/);
    assert.equal(ALERT_NONCE_STORE, 'alert-nonces');
  });

  test('🔴 新しい production secret / env を増やしていない', () => {
    // env 名の新規追加が無いこと（既存 ALERT_EMAIL 以外の env を要求しない）
    const lib = read('src/lib/billing/webhookAlert.js');
    for (const bad of ['ALERT_TOKEN', 'INTERNAL_TOKEN', 'WEBHOOK_ALERT_SECRET', 'ALERT_SECRET']) {
      assert.equal(lib.includes(bad), false, `🔴 新しい env ${bad} を要求している`);
      assert.equal(alertSrc.includes(bad), false, `🔴 新しい env ${bad} を要求している`);
      assert.equal(webhookSrc.includes(bad), false, `🔴 新しい env ${bad} を要求している`);
    }
  });
});
