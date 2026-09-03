/**
 * commentAuth.test.mjs — AI 解説の有料本文が未権限へ渡らないこと（認可迂回テスト）
 *
 * 背景（2026-09-02 の是正）:
 *   `gemini-race-analysis` は認可を見ずに **全文** を返し、
 *   クライアントが後半をぼかしていただけだった。未権限の閲覧者にも
 *   HTTP 応答・localStorage・DOM のすべてに有料本文が渡っていた。
 *
 * 🔴 ここで守るのは 4 つ。
 *   1. 未権限へ返す本文に **隠す部分が 1 文字も混ざらない**
 *   2. 権限が判断できないときは無料扱い（fail-closed）
 *   3. 応答を共有キャッシュへ載せない（CDN が有料本文を配らない）
 *   4. クライアントは本文を分割しない・隠した本文を DOM へ入れない
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { splitFreePreview, buildAnalysisPayload } from './commentPreview.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const LONG = [
  '1着は3番ホースA。道中は好位につけ、直線で抜け出した。',
  '2着は7番ホースB。外を回して伸びたが届かなかった。',
  '3着は12番ホースC。内をついて粘り込んだ。',
  '本命は3番で的中。買い目は3-7.12で、払戻は1200円だった。',
  '次走はこの組み合わせを軸に狙いたい。',
].join('\n');

describe('AI 解説の認可', () => {
  test('🔴 未権限の応答に「隠す部分」が混ざらない', () => {
    const { visible, hidden } = splitFreePreview(LONG);
    assert.ok(hidden.trim().length > 0, '前提: 隠す部分がある文章で試す');

    const free = buildAnalysisPayload({ comment: LONG, paid: false });
    assert.equal(free.truncated, true);
    assert.equal(free.comment, visible);

    // 🔴 隠す側にしか出てこない語句が、返す本文に 1 つも無いこと
    const hiddenOnly = hidden
      .split(/[。、\n]/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 4 && !visible.includes(x));
    assert.ok(hiddenOnly.length > 0, '前提: 隠す側だけに出る語句がある');
    for (const frag of hiddenOnly) {
      assert.equal(free.comment.includes(frag), false, `🔴 有料本文が漏れている: ${frag}`);
    }

    // 分割は取りこぼしも重複もしない
    assert.equal(visible + hidden, LONG.split('\n').filter((l) => l.trim()).join('\n'));
  });

  test('🔴 権限が真でないものはすべて無料扱い（fail-closed）', () => {
    for (const notPaid of [undefined, null, false, 0, 1, '', 'true', 'premium', {}, []]) {
      const r = buildAnalysisPayload({ comment: LONG, paid: notPaid });
      assert.equal(r.truncated, true, `🔴 paid=${JSON.stringify(notPaid)} を有料として扱っている`);
      assert.ok(r.comment.length < LONG.length, `🔴 paid=${JSON.stringify(notPaid)} で全文を返している`);
    }
    // 有料は true のときだけ
    const paid = buildAnalysisPayload({ comment: LONG, paid: true });
    assert.equal(paid.truncated, false);
    assert.equal(paid.comment, LONG);
  });

  test('🔴 戻り値に隠した本文を持たせない', () => {
    const r = buildAnalysisPayload({ comment: LONG, paid: false });
    // hidden / full などの名前で残していないこと（呼び出し側が足せてしまう）
    assert.deepEqual(Object.keys(r).sort(), ['comment', 'truncated']);
  });

  test('短い本文・空文字でも壊れない', () => {
    assert.deepEqual(splitFreePreview(''), { visible: '', hidden: '' });
    assert.deepEqual(splitFreePreview(null), { visible: '', hidden: '' });
    const short = buildAnalysisPayload({ comment: 'ひとこと。', paid: false });
    assert.ok(short.comment.length <= 'ひとこと。'.length);
    // 切る余地が無ければ truncated は立てない（案内だけ出るのを避ける）
    const tiny = buildAnalysisPayload({ comment: '短', paid: false });
    assert.equal(tiny.truncated, false);
  });
});

describe('サーバー側の作り（静的検査）', () => {
  // コメントは対象外（経緯の説明で旧ヘッダー名に触れてよい）
  const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const fn = stripComments(read('netlify/functions/gemini-race-analysis.js'));

  test('🔴 Cookie を見て権限を決めている', () => {
    assert.match(fn, /resolveEntitlement\(/);
    assert.match(fn, /cookieHeader/);
    assert.match(fn, /ent\.showBetting === true/);
    // 例外時は無料扱い
    assert.match(fn, /catch \(e\)[\s\S]{0,160}return false;/);
  });

  test('🔴 応答は必ず buildAnalysisPayload を通す', () => {
    assert.match(fn, /buildAnalysisPayload\(\{ comment, paid: await isPaidViewer\(event\) \}\)/);
    // 生の comment をそのまま返していない
    assert.equal(/JSON\.stringify\(\{ success: true, comment \}\)/.test(fn), false,
      '🔴 認可を通さずに全文を返している');
  });

  test('🔴 共有キャッシュに載せない', () => {
    assert.equal(/s-maxage/.test(fn), false, '🔴 CDN が有料本文を保持しうる');
    assert.equal(/'public, max-age/.test(fn), false);
    assert.match(fn, /'Cache-Control': 'private, no-store'/);
    assert.match(fn, /Vary: 'Cookie'/);
  });

  test('🔴 credentials 付きの呼び出しで CORS が壊れない', () => {
    // `*` と credentials は併用できない
    assert.equal(/'Access-Control-Allow-Origin': '\*'/.test(fn), false);
    assert.match(fn, /resolveSiteOrigin\(event\.headers\)/);
    assert.match(fn, /'Access-Control-Allow-Credentials': 'true'/);
  });
});

describe('クライアント側の作り（静的検査）', () => {
  const c = read('src/components/AIRaceComment.astro');

  test('🔴 隠した本文を DOM へ入れない', () => {
    assert.equal(c.includes('blur.textContent'), false,
      '🔴 ぼかし要素に本文を入れている（DOM から読める）');
    assert.equal(c.includes('const hidden = fullText.slice'), false,
      '🔴 クライアントが本文を分割している');
  });

  test('🔴 Cookie を送り、サーバーの判定に従う', () => {
    assert.match(c, /credentials: 'include'/);
    assert.match(c, /data\.truncated === true/);
    // 表示キャッシュは権限ごとに分ける
    assert.match(c, /const kind = await viewerKind\(\);/);
    assert.match(c, /-\$\{kind\}`/);
  });

  test('🔴 クライアントで data-masked を書き換えて解除しない', () => {
    assert.equal(/dataset\.masked = 'false'/.test(c), false,
      '🔴 クライアントがマスクを解除している');
  });
});
