/**
 * previewMailGuard.test.mjs — 本番以外のホストからメールを送らせない
 *
 * 正本: `docs/decisions.md`（2026-09-11「プレビュー環境からのメール送信を止める」）
 *
 * 🔴 2026-09-10、Stripe Test Mode の QA（branch deploy）からマジックリンクを要求したら
 *    **production の SendGrid アカウントで実際にメールが飛んだ**。
 *    `SENDGRID_API_KEY` が `all` スコープで、branch deploy にも production の値が入るため。
 *    受信できない QA 用アドレス宛だったので、**バウンスが本番の送信者評価に付いた**。
 *
 * ここで固定するのは 3 点。
 *   1. 本番ホストでは **絶対に止めない**（本番のメールを壊さない）
 *   2. Deploy Preview / ブランチデプロイ / localhost では **止める**
 *   3. **送信するすべての関数**がこのガードを通り、**書き込みより前**に置かれている
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  isMailSendBlocked, PREVIEW_MAIL_BLOCKED, PREVIEW_MAIL_BLOCKED_STATUS,
} from './previewMailGuard.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

/** 🔴 メールを送るすべての Netlify Function。 */
const MAIL_SENDERS = Object.freeze([
  'bank-transfer-application', 'contact-form', 'send-magic-link', 'send-alert',
  'register-free', 'send-test', 'send-broadcast', 'send-payment-confirmation-auto',
]);

describe('ホスト判定', () => {
  test('🔴 本番ホストでは止めない', () => {
    for (const host of ['keiba-intelligence.jp', 'www.keiba-intelligence.jp',
      'keiba-intelligence.netlify.app', 'KEIBA-INTELLIGENCE.JP', 'keiba-intelligence.jp:443']) {
      assert.equal(isMailSendBlocked({ host }), false, `🔴 本番 ${host} で送信を止めている`);
    }
  });

  test('🔴 ホストが読めないときも止めない（本番を壊さない側へ倒す）', () => {
    for (const headers of [undefined, null, {}, { host: '' }, { host: '   ' }]) {
      assert.equal(isMailSendBlocked(headers), false, JSON.stringify(headers));
    }
  });

  test('🔴 Deploy Preview / ブランチデプロイ / localhost では止める', () => {
    for (const host of [
      'deploy-preview-128--keiba-intelligence.netlify.app',
      'qa-stripe-testmode--keiba-intelligence.netlify.app',
      'localhost:4321', '127.0.0.1:8888', 'mymac.local',
    ]) {
      assert.equal(isMailSendBlocked({ host }), true, `🔴 ${host} から送信できてしまう`);
    }
  });

  test('`Host`（大文字）でも判定する', () => {
    assert.equal(isMailSendBlocked({ Host: 'qa--keiba-intelligence.netlify.app' }), true);
  });

  test('ブロック時の応答は原因が分かり、秘密を含まない', () => {
    assert.equal(PREVIEW_MAIL_BLOCKED_STATUS, 503);
    assert.equal(PREVIEW_MAIL_BLOCKED.error, 'mail_disabled_on_preview');
    assert.match(PREVIEW_MAIL_BLOCKED.message, /プレビュー|QA/);
    const body = JSON.stringify(PREVIEW_MAIL_BLOCKED);
    for (const bad of ['SENDGRID', 'apiKey', 'SG.', 'token']) {
      assert.equal(body.includes(bad), false, `🔴 応答に ${bad} が含まれる`);
    }
  });
});

describe('すべての送信関数がガードを通る', () => {
  test('🔴 送信する関数を数え漏らしていない', () => {
    // 実ファイルを走査して、送信しているのに一覧へ入っていない関数が無いか見る
    const dir = join(root, 'netlify/functions');
    const found = readdirSync(dir)
      .filter((f) => f.endsWith('.js'))
      .filter((f) => /sgMail\.send|v3\/mail\/send/.test(readFileSync(join(dir, f), 'utf8')))
      .map((f) => f.replace(/\.js$/, ''));
    assert.deepEqual(found.sort(), [...MAIL_SENDERS].sort(),
      '🔴 送信する関数が増減している。ガードの適用漏れを確認すること');
  });

  for (const name of MAIL_SENDERS) {
    test(`🔴 ${name}: ガードがあり、送信・書き込みより前にある`, () => {
      const lines = read(`netlify/functions/${name}.js`).split('\n');
      const at = (re) => lines.findIndex((l) => re.test(l)) + 1;

      const guard = at(/isMailSendBlocked\(event\.headers\)/);
      assert.notEqual(guard, 0, '🔴 ガードが無い');
      assert.match(read(`netlify/functions/${name}.js`),
        /previewMailGuard\.js/, '🔴 共有ガードを import していない');

      const handler = at(/exports\.handler/);
      assert.ok(guard > handler, '🔴 ガードがハンドラの外にある');

      // ハンドラ以降で最初に現れる送信・書き込みより前にあること
      let firstWrite = 0;
      for (let i = handler; i < lines.length; i++) {
        if (/sgMail\.send|v3\/mail\/send|\.create\(|\.update\(|marketing\/contacts/.test(lines[i])) {
          firstWrite = i + 1; break;
        }
      }
      if (firstWrite) {
        assert.ok(guard < firstWrite,
          `🔴 ガード(${guard}) が送信・書き込み(${firstWrite}) より後にある`);
      }
    });
  }

  test('🔴 ガードを握りつぶしていない（早期 return している）', () => {
    for (const name of MAIL_SENDERS) {
      const src = read(`netlify/functions/${name}.js`);
      assert.match(src, /if \(isMailSendBlocked\(event\.headers\)\) \{[\s\S]{0,320}?return \{/,
        `🔴 ${name} がブロック時に return していない`);
    }
  });
});
