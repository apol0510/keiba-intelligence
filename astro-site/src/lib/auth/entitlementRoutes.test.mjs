/**
 * entitlementRoutes.test.mjs — 予想画面の認可配線を静的に検証する
 *
 * 実行: node --test src/lib/auth/entitlementRoutes.test.mjs （astro-site 直下から）
 *
 * 目的:
 *   2026-08-17 監査 A-1 / A-3 / A-5 の再発防止。
 *   「サーバーで買い目を描画して CSS で隠す」「クライアント保存値で権限を決める」
 *   「認証チェックをハードコードで無効化する」という 3 つの退行を、
 *   ファイル内容の構造検証で止める。
 *
 *   ※ 実描画の検証は別途 dev server 経由で行っており、本テストはその配線が
 *      将来外されないことを固定する（`computerIndexContract.test.mjs` と同じ方式）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf-8');

/**
 * コメントを除いたコード本体。
 * 「禁止語がコードに無いこと」を見るとき、**説明コメント中の言及**で落ちないようにする。
 */
const code = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

/** 巨大なファイル内容を assert の diff に出さないための否定アサーション。 */
function refute(re, src, message) {
  assert.ok(!re.test(src), message);
}

/** docs/ui-cross-plan-regression-policy.md の対象経路。ここを減らさない。 */
const PREDICTION_ROUTES = [
  'src/pages/prediction/nankan/index.astro',
  'src/pages/prediction/jra/index.astro',
  'src/pages/prediction/[slug].astro',
  'src/pages/free-prediction/nankan/index.astro',
  'src/pages/free-prediction/jra/index.astro',
  'src/pages/free-prediction/nankan/[slug].astro',
  'src/pages/free-prediction/jra/[date].astro',
];

test('対象の予想経路がすべて存在する（経路を減らして「直った」ことにしない）', () => {
  for (const p of PREDICTION_ROUTES) {
    assert.ok(existsSync(join(ROOT, p)), `経路が消えている: ${p}`);
  }
});

for (const route of PREDICTION_ROUTES) {
  test(`${route}: サーバー側 entitlement で tier を決めている`, () => {
    const src = read(route);
    assert.match(src, /entitlementFromAstro\s*\(/, 'entitlementFromAstro を呼んでいない');
    assert.match(src, /viewFlags\s*\(/, 'viewFlags を使っていない');
    assert.match(src, /export const prerender = false/, 'SSR でないと閲覧者ごとの判定ができない');
  });

  test(`${route}: 認証チェックのハードコード無効化が無い（監査 A-5）`, () => {
    const src = code(route);
    refute(/isAuthenticated\s*=\s*true/, src, `${route}: isAuthenticated のハードコードが復活している`);
    refute(/userPlan\s*=\s*['"]pro/, src, `${route}: userPlan のハードコードが復活している`);
  });

  test(`${route}: クライアント保存値で権限を決めていない（監査 A-3）`, () => {
    const src = code(route);
    refute(/sessionStorage/, src, `${route}: sessionStorage を参照している`);
    refute(/localStorage\.getItem\(\s*['"](user-plan|auth_data)/, src, `${route}: localStorage の plan を参照している`);
  });

  test(`${route}: 買い目を直接描画していない（描画は RaceNewspaper に集約）`, () => {
    const src = code(route);
    refute(/bettingLines\s*\./, src, `${route}: ページが bettingLines を直接展開している`);
    refute(/AIBettingSection/, src, `${route}: 認可を持たない買い目コンポーネントを使っている`);
  });
}

/* ---------- 描画コンポーネント側の不変条件 ---------- */

test('RaceNewspaper: 買い目は showBetting のときだけ描画する（CSS で隠さない）', () => {
  const src = read('src/components/newspaper/RaceNewspaper.astro');
  assert.match(src, /const showBetting = !!view\?\.showBetting/);
  // 買い目ブロックは showBetting の条件式の中にある
  assert.match(src, /\{showBetting && validBetting\.length > 0 && \(/, '買い目が showBetting で守られていない');
  // 「隠すだけ」の実装が復活していないこと
  refute(/pro-user-only/, src, 'CSS で隠す旧方式のクラスが復活している');
});

test('RaceNewspaper: 印（役割・PT）は showMarks のときだけ描画する', () => {
  const src = read('src/components/newspaper/RaceNewspaper.astro');
  assert.match(src, /const showMarks = !!view\?\.showMarks/);
  // 並び順も tier で分ける（PT 降順は序列＝印が読めるため）
  assert.match(src, /showMarks\s*\n?\s*\?\s*sortHorsesByRole/, '未登録時に馬番順へ落としていない');
});

test('HorseColumn: 印と PT は showMarks の条件下でのみ組み立てる', () => {
  const src = read('src/components/newspaper/HorseColumn.astro');
  assert.match(src, /const showMarks = !!view\?\.showMarks/);
  assert.match(src, /const mark = showMarks && horse\?\.role/, '印が showMarks で守られていない');
  assert.match(src, /const pt = showMarks &&/, 'PT が showMarks で守られていない');
  assert.match(src, /\{showMarks && \(mark \|\| pt != null\) && \(/, '印ブロックが showMarks で守られていない');
});

test('文章生成に買い目を渡していない（CLAUDE.md 絶対厳守）', () => {
  const rn = read('src/components/newspaper/RaceNewspaper.astro');
  // buildRaceNarrativeBundle への引数に bettingLines を含めない
  const call = rn.slice(rn.indexOf('buildRaceNarrativeBundle('), rn.indexOf('const pastOf'));
  refute(/bettingLines/, call, '文章生成へ買い目を渡している');
  refute(/hitLines/, call, '文章生成へ的中ラインを渡している');

  // エンジン本体（コメントを除く）が買い目に触れないこと
  const engine = code('src/utils/raceNarrative.js');
  refute(/hitLines/, engine, 'ナラティブエンジンが hitLines を参照している');
  refute(/bettingLines/, engine, 'ナラティブエンジンが bettingLines を参照している');
});

test('捏造された数値を表示しない（Math.random による期待値の復活防止）', () => {
  const targets = [
    ...PREDICTION_ROUTES,
    'src/components/newspaper/RaceNewspaper.astro',
    'src/components/newspaper/HorseColumn.astro',
    'src/components/newspaper/FeatureBars.astro',
    'src/components/newspaper/RaceDayBoard.astro',
  ];
  for (const f of targets) {
    refute(/Math\.random\s*\(/, code(f), `${f} が乱数由来の数値を描画している`);
  }
});

test('勝率・期待値を紙面に出していない（較正が未検証のため）', () => {
  refute(/winProbability|expectedValue/, code('src/components/newspaper/FeatureBars.astro'),
    'FeatureBars が未検証の勝率・期待値を表示している');
  refute(/winProbability|expectedValue/, code('src/components/newspaper/HorseColumn.astro'),
    'HorseColumn が未検証の勝率・期待値を表示している');
});

test('Netlify Functions: セッションは署名付き Cookie を発行・検証している', () => {
  const verify = read('netlify/functions/verify-magic-link.js');
  assert.match(verify, /signSession\(/, 'Cookie を発行していない');
  assert.match(verify, /serializeSessionCookie\(/);
  assert.match(verify, /SESSION_SIGNING_SECRET/);

  const get = read('netlify/functions/get-session.js');
  assert.match(get, /resolveEntitlement\(/, 'サーバー側判定を使っていない');
  refute(/getStore\s*\(/, get, 'get-session に Blobs 依存が残っている');

  const logout = read('netlify/functions/logout.js');
  assert.match(logout, /clearSessionCookie\(/);
});

test('本番ドメインが CORS 許可 origin に入っている（監査 A-8）', () => {
  for (const f of [
    'netlify/functions/verify-magic-link.js',
    'netlify/functions/get-session.js',
    'netlify/functions/logout.js',
  ]) {
    assert.match(read(f), /https:\/\/keiba-intelligence\.jp/, `${f} に本番ドメインが無い`);
  }
});
