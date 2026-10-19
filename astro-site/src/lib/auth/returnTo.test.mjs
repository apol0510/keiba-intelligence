/**
 * returnTo.test.mjs — ログイン後の戻り先が open redirect にならない
 *
 * 実行: node --test src/lib/auth/returnTo.test.mjs（npm run test:auth に含む）
 * 正本: docs/measurements/LOGIN_RETURN_TO_2026_10.md
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  RETURN_PARAM,
  RETURN_TO_MAX_LENGTH,
  normalizeReturnTo,
  returnToQuery,
  returnToKind,
  loginHrefFor,
  returnToFromReferrer,
  paidEquivalentPath,
} from './returnTo.js';

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(siteRoot, p), 'utf8');

const ORIGIN = 'https://keiba-intelligence.jp';

describe('許可リストのパスは受け付ける', () => {
  for (const p of [
    '/mypage',
    '/mypage/',
    '/prediction/jra',
    '/prediction/nankan',
    '/prediction/2026-10-19-ooi-11r',
    '/free-prediction/nankan/2026-10-19',
    '/free-prediction/jra/2026-10-19/',
    '/free-prediction',
    '/results',
    '/results-jra',
    '/results/2026/10/19',
  ]) {
    test(p, () => assert.equal(normalizeReturnTo(p), p));
  }
});

describe('🔴 open redirect・不正な値は null（＝従来の /mypage）', () => {
  const cases = [
    // 外部 URL・スキーム
    'https://evil.example/prediction/jra',
    'http://keiba-intelligence.jp/prediction/jra',
    '//evil.example',
    '//evil.example/prediction/jra',
    '/\\evil.example',
    '\\\\evil.example',
    '/\\/evil.example',
    'javascript:alert(1)',
    'data:text/html,x',
    // 相対・空・型違い
    'prediction/jra',
    '',
    ' /prediction/jra',
    '/prediction/jra ',
    null,
    undefined,
    1,
    {},
    ['/prediction/jra'],
    // エンコード・トラバーサル
    '/prediction/%2F%2Fevil.example',
    '/%2F%2Fevil.example',
    '/%5Cevil.example',
    '/prediction/..',
    '/prediction/../admin',
    '/prediction/./jra',
    '/prediction//evil.example',
    '/prediction/jra\n',
    '/prediction/jra\r\nSet-Cookie:x',
    '/prediction/jra\t',
    '/prediction/jra\u0000',
    '/prediction/ｊｒａ',
    // クエリ・ハッシュ・認証情報
    '/prediction/jra?x=1',
    '/prediction/jra#x',
    '/prediction/jra@evil.example',
    '/prediction/jra:443',
    // 許可外のパス
    '/admin',
    '/admin/newsletter',
    '/pricing',
    '/login',
    '/auth/verify',
    '/.netlify/functions/logout',
    '/',
    '/PREDICTION/jra',
    '/predictionx',
    '/prediction-evil',
    '/mypage/evil',
    '/results-jra/x',
    '/archive/nankan',
    // 長すぎる
    '/prediction/' + 'a'.repeat(RETURN_TO_MAX_LENGTH),
  ];
  for (const v of cases) {
    test(JSON.stringify(typeof v === 'string' && v.length > 60 ? `${v.slice(0, 20)}…(${v.length})` : v), () => {
      assert.equal(normalizeReturnTo(v), null);
      assert.equal(returnToQuery(v), '');
      assert.equal(returnToKind(v), 'none');
      assert.equal(loginHrefFor(v), '/login');
    });
  }

  test('長さの上限ちょうどは受け付け、1 文字超えたら拒否', () => {
    const base = '/prediction/';
    const ok = base + 'a'.repeat(RETURN_TO_MAX_LENGTH - base.length);
    assert.equal(ok.length, RETURN_TO_MAX_LENGTH);
    assert.equal(normalizeReturnTo(ok), ok);
    assert.equal(normalizeReturnTo(ok + 'a'), null);
  });
});

describe('マジックリンク用クエリ・GA4 分類・/login リンク', () => {
  test('returnToQuery は intentQuery と同じ形（先頭 & ・エンコード済み）', () => {
    assert.equal(returnToQuery('/prediction/jra'), `&${RETURN_PARAM}=%2Fprediction%2Fjra`);
  });

  test('returnToKind は固定の列挙値だけ（パスは送らない）', () => {
    assert.equal(returnToKind('/prediction/jra'), 'prediction');
    assert.equal(returnToKind('/free-prediction/nankan/2026-10-19'), 'free_prediction');
    assert.equal(returnToKind('/results/2026/10/19'), 'results');
    assert.equal(returnToKind('/results-jra'), 'results');
    assert.equal(returnToKind('/mypage'), 'mypage');
    assert.equal(returnToKind(null), 'none');
  });

  test('loginHrefFor: 許可リストのページだけ ?next= を付ける（/mypage は既定なので付けない）', () => {
    assert.equal(loginHrefFor('/prediction/nankan'), '/login?next=%2Fprediction%2Fnankan');
    assert.equal(loginHrefFor('/mypage'), '/login');
    assert.equal(loginHrefFor('/archive/nankan'), '/login');
  });
});

describe('無料ページ → 有料ページの対応（有料ページの 302 の逆）', () => {
  test('固定の対応だけ', () => {
    assert.equal(paidEquivalentPath('/free-prediction/nankan'), '/prediction/nankan');
    assert.equal(paidEquivalentPath('/free-prediction/nankan/'), '/prediction/nankan');
    assert.equal(paidEquivalentPath('/free-prediction/jra'), '/prediction/jra');
    assert.equal(paidEquivalentPath('/free-prediction/nankan/2026-10-19-ooi'), '/prediction/2026-10-19-ooi');
  });

  test('対応の無いページ・不正値は null', () => {
    for (const v of ['/free-prediction/nankan/archive', '/free-prediction/jra/2026-10-19', '/free-prediction/jra/archive',
      '/free-prediction', '/prediction/nankan', '/mypage', '/results', '//evil.example', '/free-prediction/nankan/a/b', null]) {
      assert.equal(paidEquivalentPath(v), null, String(v));
    }
  });
});

describe('直前のページ（referrer）からの補助', () => {
  test('同一オリジンの許可リストのパスだけ（クエリ・ハッシュは捨てる）', () => {
    assert.equal(returnToFromReferrer(`${ORIGIN}/prediction/jra?x=1#y`, ORIGIN), '/prediction/jra');
    assert.equal(returnToFromReferrer(`${ORIGIN}/free-prediction/nankan`, ORIGIN), '/free-prediction/nankan');
  });

  test('🔴 別オリジン・許可外・壊れた値は null', () => {
    assert.equal(returnToFromReferrer('https://evil.example/prediction/jra', ORIGIN), null);
    assert.equal(returnToFromReferrer('https://keiba-intelligence.jp.evil.example/prediction/jra', ORIGIN), null);
    assert.equal(returnToFromReferrer('http://keiba-intelligence.jp/prediction/jra', ORIGIN), null);
    assert.equal(returnToFromReferrer(`${ORIGIN}/admin`, ORIGIN), null);
    assert.equal(returnToFromReferrer(`${ORIGIN}/login`, ORIGIN), null);
    assert.equal(returnToFromReferrer('not a url', ORIGIN), null);
    assert.equal(returnToFromReferrer('', ORIGIN), null);
    assert.equal(returnToFromReferrer(`${ORIGIN}/prediction/jra`, ''), null);
  });
});

describe('静的ガード（経路が同じ検査を通る・email を URL に載せない）', () => {
  test('send-magic-link: 購入意図が優先、戻り先は returnToQuery 経由だけ', () => {
    const src = read('netlify/functions/send-magic-link.js');
    assert.match(src, /intentQuery\(intent\) \|\| returnToQuery\(next\)/);
    assert.doesNotMatch(src, /encodeURIComponent\(email\)/, '🔴 email を URL に載せている');
  });

  test('verify-magic-link: normalizeReturnTo を通した値を resumePathFor の fallback にする', () => {
    const src = read('netlify/functions/verify-magic-link.js');
    assert.match(src, /const nextPath = normalizeReturnTo\(rawNext\);/);
    assert.match(src, /redirectTo = \(nextPath && canSeeBetting\(tier\) && paidEquivalentPath\(nextPath\)\) \|\| nextPath \|\| redirectTo;\s*\n[\s\S]{0,120}redirectTo = resumePathFor\(rawIntent, redirectTo\);/);
  });

  test('/login・/auth/verify は normalizeReturnTo を通してから送る', () => {
    const login = read('src/pages/login.astro');
    assert.match(login, /normalizeReturnTo\(new URLSearchParams\(window\.location\.search\)\.get\(RETURN_PARAM\)\)/);
    assert.doesNotMatch(login, /next:\s*email|email.*RETURN_PARAM/);
    const verify = read('src/pages/auth/verify.astro');
    assert.match(verify, /const next = normalizeReturnTo\(urlParams\.get\(RETURN_PARAM\)\)/);
  });

  test('returnTo.js は tier・セッション・署名鍵に触れない（認可に使わない）', () => {
    const src = read('src/lib/auth/returnTo.js');
    const code = src.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    for (const w of ['SESSION_SIGNING_SECRET', 'signSession', 'TIER', 'tier', 'cookie', 'Cookie']) {
      assert.equal(code.includes(w), false, w);
    }
  });
});
