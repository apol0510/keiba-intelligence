/**
 * magicLinkBase.test.mjs — マジックリンクの送信先
 *
 * 🔴 これは **ワンタイムのログイン token の宛先**を決める値である。
 *    任意のホストを許すと token を第三者へ送り出せてしまうため、
 *    許可リスト外は **すべて本番へ倒す**（fail-closed）ことを固定する。
 *
 * 🔴 認証の意味・有効期限・認可条件は変えていない。
 *    このテストはリンクの向き先だけを見る。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  DEFAULT_MAGIC_LINK_BASE, MAGIC_LINK_BASE_ENV,
  resolveMagicLinkBase, buildMagicLinkUrl,
} from './magicLinkBase.js';

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(siteRoot, p), 'utf8');

const withBase = (v) => (v === undefined ? {} : { [MAGIC_LINK_BASE_ENV]: v });

describe('env 未設定 → 本番 URL（Production の挙動は不変）', () => {
  test('未設定・空・空白は本番', () => {
    for (const v of [undefined, '', '   ']) {
      assert.equal(resolveMagicLinkBase(withBase(v)), 'https://keiba-intelligence.jp');
    }
    assert.equal(resolveMagicLinkBase(null), 'https://keiba-intelligence.jp');
    assert.equal(resolveMagicLinkBase(undefined), 'https://keiba-intelligence.jp');
  });

  test('既定値の定数が本番 URL である', () => {
    assert.equal(DEFAULT_MAGIC_LINK_BASE, 'https://keiba-intelligence.jp');
  });

  test('未設定時に組み立てられる URL が従来と同一', () => {
    assert.equal(
      buildMagicLinkUrl('abc123', {}),
      'https://keiba-intelligence.jp/auth/verify?token=abc123',
    );
  });
});

describe('Branch deploy 用 env → その URL', () => {
  test('Netlify のブランチデプロイ / Deploy Preview を受け付ける', () => {
    for (const v of [
      'https://test-stripe-testmode-e2e-2026-09-01--keiba-intelligence.netlify.app',
      'https://deploy-preview-91--keiba-intelligence.netlify.app',
      'https://keiba-intelligence.netlify.app',
    ]) {
      assert.equal(resolveMagicLinkBase(withBase(v)), v, `受け付けるべき: ${v}`);
    }
  });

  test('本番・www も明示指定できる', () => {
    assert.equal(resolveMagicLinkBase(withBase('https://keiba-intelligence.jp')), 'https://keiba-intelligence.jp');
    assert.equal(resolveMagicLinkBase(withBase('https://www.keiba-intelligence.jp')), 'https://www.keiba-intelligence.jp');
  });

  test('ローカル開発は http を許す', () => {
    assert.equal(resolveMagicLinkBase(withBase('http://localhost:4321')), 'http://localhost:4321');
    assert.equal(resolveMagicLinkBase(withBase('http://127.0.0.1:8888')), 'http://127.0.0.1:8888');
  });

  test('末尾スラッシュは origin へ正規化される', () => {
    assert.equal(
      resolveMagicLinkBase(withBase('https://foo--keiba-intelligence.netlify.app/')),
      'https://foo--keiba-intelligence.netlify.app',
    );
  });

  test('Branch 用 URL でリンクが組み立つ', () => {
    const base = 'https://test-stripe-testmode-e2e-2026-09-01--keiba-intelligence.netlify.app';
    assert.equal(
      buildMagicLinkUrl('tok_1', withBase(base)),
      `${base}/auth/verify?token=tok_1`,
    );
  });
});

describe('🔴 不正値は fail-closed（production 以外へ倒さない）', () => {
  const BAD = [
    'not-a-url',
    'http://evil.example.com',
    'https://evil.example.com',
    'https://keiba-intelligence.jp.evil.com',          // サフィックス偽装
    'https://evil.com/?x=https://keiba-intelligence.jp',
    'https://netlify.app.evil.com',                     // サフィックス偽装
    'http://keiba-intelligence.jp',                     // 本番は https のみ
    'https://user:pass@keiba-intelligence.jp',          // 認証情報付き
    'https://keiba-intelligence.jp/auth',               // パス付き
    'https://keiba-intelligence.jp/?a=1',               // クエリ付き
    'https://keiba-intelligence.jp/#x',                 // ハッシュ付き
    'javascript:alert(1)',
    'data:text/html,x',
    'file:///etc/passwd',
    'ftp://keiba-intelligence.jp',
    '//keiba-intelligence.jp',
    ' https://evil.com ',
  ];

  test('すべて本番 URL へ倒れる', () => {
    for (const v of BAD) {
      assert.equal(
        resolveMagicLinkBase(withBase(v)),
        'https://keiba-intelligence.jp',
        `🔴 本番以外へ倒れている: ${v}`,
      );
    }
  });

  test('🔴 token を許可外ホストへ送り出さない', () => {
    for (const v of BAD) {
      const url = buildMagicLinkUrl('SECRET_TOKEN', withBase(v));
      assert.ok(url.startsWith('https://keiba-intelligence.jp/'), `🔴 ${v} で外部へ向いた: ${url}`);
    }
  });

  test('token が無ければリンクを作らない', () => {
    for (const t of [undefined, null, '', '   ', 123, {}]) {
      assert.equal(buildMagicLinkUrl(t, {}), null);
    }
  });

  test('token は URL エンコードされる', () => {
    assert.equal(buildMagicLinkUrl('a b&c=d', {}), 'https://keiba-intelligence.jp/auth/verify?token=a%20b%26c%3Dd');
  });
});

describe('認証の意味・有効期限・認可条件を変えていない', () => {
  test('🔴 send-magic-link.js は URL の組み立てだけを差し替えている', () => {
    const src = read('netlify/functions/send-magic-link.js');
    assert.match(src, /buildMagicLinkUrl\(token, process\.env\)/);
    // ハードコードされた本番 URL は残っていない（既定値はモジュール側が持つ）
    assert.doesNotMatch(src, /const magicLink = `https:\/\/keiba-intelligence\.jp/);
  });

  test('🔴 セッション・token の意味に関わる定数を変えていない', () => {
    const session = read('src/lib/auth/session.js');
    assert.match(session, /export const SESSION_TTL_SECONDS = 7 \* 24 \* 60 \* 60;/);
    assert.match(session, /export const SESSION_VERSION = 'kis-v1';/);
    assert.match(session, /export const SESSION_COOKIE_NAME = 'ki_session';/);
  });

  test('🔴 magicLinkBase は署名鍵・セッションに触れない', () => {
    const src = read('src/lib/auth/magicLinkBase.js');
    for (const w of ['SESSION_SIGNING_SECRET', 'signSession', 'verifySession', 'ki_session', 'canSeeBetting']) {
      const inCode = src.split('\n').filter((l) => {
        const t = l.trimStart();
        return l.includes(w) && !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
      });
      assert.deepEqual(inCode, [], `magicLinkBase.js が ${w} を参照している`);
    }
  });
});
