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
