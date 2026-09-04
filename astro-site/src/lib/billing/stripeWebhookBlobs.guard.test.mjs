/**
 * stripeWebhookBlobs.guard.test.mjs — 冪等性が「黙って」失われないこと
 *
 * 🔴 ここで守るのは 3 つ。
 *   1. `@netlify/blobs` を **直接依存として宣言している**
 *      （`@astrojs/netlify` 経由の推移的依存に頼らない。上流が外せば黙って壊れる）
 *   2. Blobs の失敗を **引数なしの `catch {}` で握りつぶさない**
 *      （握りつぶすと `hasProcessed` が常に false になり、冪等性が失われても
 *        応答にもログにも痕跡が出ない ＝ 2026-09-03 に切り分け不能になった）
 *   3. 記録は **処理が成功したあと**（`markProcessed` を先に呼ばない）
 *
 * 🔴 単体テストは `@netlify/blobs` を mock.module で差し替えるため、
 *    **依存が無くてもテストは緑になる**。本番だけ壊れる型の欠陥なので、
 *    ここは実ファイルの中身を静的に検査する。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

describe('stripe-webhook の冪等性（Blobs）', () => {
  const src = read('netlify/functions/stripe-webhook.js');

  test('🔴 @netlify/blobs を直接依存として宣言している', () => {
    const pkg = JSON.parse(read('package.json'));
    const range = pkg.dependencies?.['@netlify/blobs'];
    assert.ok(
      range,
      '🔴 @netlify/blobs が dependencies に無い。' +
        '推移的依存に頼ると上流の都合で黙って消え、冪等性が失われる'
    );
    assert.equal(
      pkg.devDependencies?.['@netlify/blobs'],
      undefined,
      '🔴 devDependencies では本番の関数バンドルに載らない'
    );

    // lockfile のルート依存にも同じ範囲が入っていること（npm ci で再現する）
    const lock = JSON.parse(read('package-lock.json'));
    assert.equal(
      lock.packages?.['']?.dependencies?.['@netlify/blobs'],
      range,
      '🔴 package-lock.json のルート依存が package.json とずれている'
    );
  });

  test('🔴 Blobs の失敗を握りつぶさない（catch {} を置かない）', () => {
    // 🔴 検査対象は Blobs の 3 関数だけに絞る。
    //    ファイル内の他の `catch {}` は詳細を漏らさないための意図的な設計で、
    //    いずれも console.warn / console.error を伴っている（黙っていない）。
    const from = src.indexOf('async function eventStore(event)');
    const to = src.indexOf('/** email から顧客レコードを引く。 */');
    assert.ok(from > -1 && to > from, '🔴 Blobs 区間の目印が見つからない');
    const blobsSection = src.slice(from, to);

    // 引数なしの catch（`catch {` / `catch{`）はログを残せないので禁止
    assert.equal(
      /catch\s*\{/.test(blobsSection),
      false,
      '🔴 Blobs 区間に引数なしの catch がある。失敗の理由が残らず冪等性の欠落を検出できない'
    );

    // 3 つの経路すべてで理由をログに出す
    assert.match(src, /function logBlobsFailure\(/);
    assert.match(src, /logBlobsFailure\('getStore', err\)/);
    assert.match(src, /logBlobsFailure\('get', err\)/);
    assert.match(src, /logBlobsFailure\('set', err\)/);
    assert.match(src, /console\.error\(/);
  });

  test('🔴 v1（Lambda 互換）なので connectLambda で Blobs 環境をつなぐ', () => {
    // 🔴 v1 関数では Blobs の環境が process.env に入らない。
    //    event.blobs / x-nf-* から connectLambda で展開しないと、getStore は
    //    getClientOptions の中で MissingBlobsEnvironmentError を投げる。
    //    2026-09-04 の Test Mode 再送で、これが duplicate:true にならない原因だった。
    assert.match(src, /export async function handler\(event\)/, 'v1（Lambda 互換）の署名が前提');
    assert.match(src, /const \{ getStore, connectLambda \} = await import\('@netlify\/blobs'\)/);
    assert.match(src, /connectLambda\(event\)/);

    // getStore より前に connectLambda を呼ぶ
    const connect = src.indexOf('connectLambda(event);');
    const get = src.indexOf("getStore('stripe-events')");
    assert.ok(connect > -1 && get > connect, '🔴 getStore より後に connectLambda を呼んでいる');

    // event が 3 関数すべてへ渡っている
    assert.match(src, /async function eventStore\(event\)/);
    assert.match(src, /async function hasProcessed\(event, eventId\)/);
    assert.match(src, /async function markProcessed\(event, eventId\)/);
    assert.match(src, /await hasProcessed\(event, stripeEvent\.id\)/);
    assert.match(src, /await markProcessed\(event, stripeEvent\.id\)/);
  });

  test('🔴 単体テストが本番と同じ形の Lambda イベントを送る', () => {
    // 🔴 mock が環境なしで動くと、connectLambda を消しても緑になる
    const t = read('src/lib/billing/stripeWebhook.test.mjs');
    assert.match(t, /blobs: LAMBDA_BLOBS/, '🔴 テストが event.blobs を送っていない');
    assert.match(t, /'x-nf-site-id'/);
    assert.match(t, /connectLambda\(event\)/, '🔴 mock が connectLambda を持たない');
    assert.match(t, /MissingBlobsEnvironmentError/,
      '🔴 mock が「環境が無ければ投げる」本番条件を再現していない');
  });

  test('🔴 store をキャッシュしない（壊れた状態を検出できなくなる）', () => {
    assert.equal(
      /storeCache|cachedStore/.test(src),
      false,
      '🔴 store をキャッシュすると、あとから Blobs が壊れても気づけない'
    );
  });

  test('🔴 記録は処理が成功したあと（先に markProcessed しない）', () => {
    const check = src.indexOf('await hasProcessed(');
    const mark = src.indexOf('await markProcessed(');
    assert.ok(check > -1 && mark > -1);
    assert.ok(
      check < mark,
      '🔴 markProcessed が hasProcessed より先にある'
    );
  });
});
