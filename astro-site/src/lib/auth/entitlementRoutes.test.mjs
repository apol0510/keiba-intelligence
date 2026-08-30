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

test('RaceNewspaper: 買い目は showBetting のときだけ組み立てる（CSS で隠さない）', () => {
  const src = read('src/components/newspaper/RaceNewspaper.astro');
  assert.match(src, /const showBetting = !!view\?\.showBetting/);
  // 買い目は showBetting のときだけ展開して RaceEntryTable へ渡す
  assert.match(
    src,
    /const bettingPlan = showBetting && validBetting\.length/,
    '買い目が showBetting で守られていない',
  );
  // 「隠すだけ」の実装が復活していないこと
  refute(/pro-user-only/, src, 'CSS で隠す旧方式のクラスが復活している');
});

test('🔴 下部の買い目セクションが復活していない（抽出パネルに一本化・2026-08-30）', () => {
  const src = read('src/components/newspaper/RaceNewspaper.astro');
  refute(/rp-betting/, src, '削除した下部の買い目セクションが残っている');
  refute(/validBetting\.map/, src, '買い目の生文字列を直接並べている');
});

test('🔴 結論は出馬表より前に置く（2026-08-30）', () => {
  const src = read('src/components/newspaper/RaceNewspaper.astro');
  const body = src.slice(src.indexOf('<section class="racepaper"'), src.indexOf('<style>'));
  const conclusion = body.indexOf('rp-conclusion');
  const table = body.indexOf('<RaceEntryTable');
  const pace = body.indexOf('<PaceMap');
  assert.ok(conclusion > 0 && table > 0 && pace > 0, '要素が見つからない');
  assert.ok(pace < conclusion, '結論が展開予想より前にある');
  assert.ok(conclusion < table, '結論が出馬表の後ろに取り残されている');
});

/* ---------- 順位を推測させない（2026-08-29 仕様確定） ---------- */

test('RaceNewspaper: 並び順は常に馬番昇順（評価順に並べ替えない）', () => {
  const src = read('src/components/newspaper/RaceNewspaper.astro');
  assert.match(src, /sortByHorseNumber\(allHorses\)/, '馬番昇順で並べていない');
  refute(/sortHorsesByRole/, code('src/components/newspaper/RaceNewspaper.astro'),
    '評価順の並べ替えが復活している');
  // 既定で開く行も tier で変えない（本命を開くと順位が漏れる）
  refute(/role === '本命'/, code('src/components/newspaper/RaceNewspaper.astro'),
    '既定オープンが本命に依存している');
});

test('RaceEntryTable: 役割バッジを描画しない（HTML に残さない）', () => {
  const src = read('src/components/newspaper/RaceEntryTable.astro');
  refute(/role-tag/, src, '役割バッジが復活している');
  refute(/\{r\.role\s*&&/, src, '役割を直接描画している');
  refute(/is-honmei/, src, '本命の行強調が残っている（順位が漏れる）');
});

test('RaceEntryTable: 印の列は無料会員のみ（有料では出さない・R-8）', () => {
  const src = read('src/components/newspaper/RaceEntryTable.astro');
  assert.match(src, /const showMarkColumn = showAttention && !showRanked/, '印の列が無料限定でない');
  assert.match(src, /\{showMarkColumn && <th class="c-mark">/, '印の列が showMarkColumn で守られていない');
  // 有料向けの役割印を組み立てない
  const body = code('src/components/newspaper/RaceEntryTable.astro');
  refute(/getRoleMark/, body, '有料向けの役割印を作っている（印は有料で出さない）');
});

test('RaceEntryTable: AI指数の実数値は有料 tier のみ。無料はモザイクで値を持たない', () => {
  const src = read('src/components/newspaper/RaceEntryTable.astro');
  assert.match(src, /const showRanked = !!view\?\.showBetting/, 'AI指数の判定が showBetting でない');
  assert.match(src, /const maskScore = showAttention && !showRanked/, 'モザイク判定が無い');
  assert.match(src, /pt: showRanked &&/, 'AI指数の実数値が showRanked で守られていない');
  // モザイクは値ではなくプレースホルダを描画する
  assert.match(src, /maskScore\s*\n?\s*\? <span class="num-pill num-masked"/, 'モザイクを描画していない');
  assert.match(src, /num-masked[\s\S]*?filter:\s*blur/, 'モザイクの見た目が無い');
  // 🔴 CSS のぼかしだけで実数値を隠す実装を禁止（開発者ツールで読めるため）
  assert.ok(!/num-masked[^>]*>\{r\.pt\}/.test(src), 'モザイク内に実数値を描画している');
});

test('RaceEntryTable: 無料会員の印は「印」1 列に重複付与する', () => {
  const src = read('src/components/newspaper/RaceEntryTable.astro');
  assert.match(src, /const showAttention = !!view\?\.showMarks/, '印の判定が showMarks でない');
  assert.match(src, /assignFreeMarks\(/, '重複印の算出を使っていない');
  assert.match(src, /freeMark/, '重複印を描画していない');
  assert.match(src, /\{showMarkColumn && <th class="c-mark">/, '印の列が showMarkColumn で守られていない');
  // 評価項目別の列を増やさない（印は 1 列だけ）
  const heads = [...src.matchAll(/<th class="c-([a-z]+)"/g)].map((m) => m[1]);
  assert.equal(heads.filter((h) => h === 'mark').length, 1, '印の列が 1 つでない');
});

test('HorseDetailPanel: AI指数の実数値は有料 tier のみ。無料はモザイク', () => {
  const src = read('src/components/newspaper/HorseDetailPanel.astro');
  assert.match(src, /const showScore = !!view\?\.showBetting/, 'AI指数の判定が showBetting でない');
  assert.match(src, /const maskScore = !!view\?\.showMarks && !showScore/, 'モザイク判定が無い');
  assert.match(src, /const pt = showScore &&/, 'AI指数 が showScore で守られていない');
  assert.match(src, /hdp-pt-masked/, '詳細のモザイクが無い');
});

test('RaceNewspaper: AI結論（本命の名指し）は有料 tier のみ生成・描画する', () => {
  const src = read('src/components/newspaper/RaceNewspaper.astro');
  assert.match(src, /allowMarks: showBetting/, '結論の生成が showBetting で守られていない');
  assert.match(src, /\{showBetting && bundle\.conclusion\?\.text && \(/, '結論の描画が showBetting で守られていない');
});

test('出馬表の詳細は既定ですべて閉じている', () => {
  const src = read('src/components/newspaper/RaceEntryTable.astro');
  // 詳細行は無条件に hidden（条件付き hidden＝既定で開く実装を禁止）
  assert.match(src, /class="ret-detail"[^>]*data-detail=\{rowId\} hidden>/,
    '詳細行が既定で閉じていない');
  assert.match(src, /aria-expanded="false"/, 'aria-expanded が false 固定でない');
  const body = code('src/components/newspaper/RaceEntryTable.astro');
  assert.ok(!/defaultOpenHorseNumber/.test(body), '既定オープンの仕組みが残っている');
  assert.ok(!/is-open'\s*:/.test(body), '初期状態で is-open を付けている');

  const paper = code('src/components/newspaper/RaceNewspaper.astro');
  assert.ok(!/defaultOpenHorseNumber/.test(paper), 'RaceNewspaper が既定オープンを渡している');
});

test('出馬表の行アコーディオンは表示のみで認可に関与しない', () => {
  const src = code('src/components/newspaper/RaceEntryTable.astro');
  // クライアント JS で権限を判定していないこと
  refute(/sessionStorage|localStorage/, src, 'アコーディオンがクライアント保存値を読んでいる');
  refute(/showBetting\s*=\s*true/, src, 'アコーディオンが買い目を開こうとしている');
});

/**
 * テンプレート部（frontmatter `---` の外・`<style>` を除く）を返す。
 * ここに書いた文字列は **HTML として出力される**（HTML コメントも含む）。
 */
function template(p) {
  const src = read(p);
  const m = src.match(/^---[\s\S]*?\n---\n/);
  const body = m ? src.slice(m[0].length) : src;
  return body.replace(/<style[\s\S]*?<\/style>/g, ' ');
}

test('予想画面のテンプレートに役割語を書かない（HTML コメント含め残さない）', () => {
  const RANK_WORDS = ['本命', '対抗', '単穴', '連下', '補欠', 'ヒモ'];
  const files = [
    ...PREDICTION_ROUTES,
    'src/components/newspaper/RaceDayBoard.astro',
    'src/components/newspaper/RaceNewspaper.astro',
    'src/components/newspaper/RaceEntryTable.astro',
    'src/components/newspaper/HorseDetailPanel.astro',
    'src/components/newspaper/TierRibbon.astro',
  ];
  for (const f of files) {
    const body = template(f);
    for (const w of RANK_WORDS) {
      assert.ok(!body.includes(w),
        `${f}: テンプレートに「${w}」がある（HTML コメント含め出力される）`);
    }
  }
});

test('印の記号は算出モジュール由来で、行テンプレートに直書きしない', () => {
  // 無料の印は `assignFreeMarks` の戻り値、有料の印は `getRoleMark` の戻り値を描画する。
  // 行テンプレートに ◎ 等を直書きすると、評価と無関係な固定表示になり得るため禁止。
  const src = template('src/components/newspaper/RaceEntryTable.astro');
  const rowPart = src.slice(src.indexOf('<tbody'), src.indexOf('</tbody>'));
  for (const m of ['◎', '○', '▲', '△', '☆']) {
    assert.ok(!rowPart.includes(m), `行テンプレートに印「${m}」が直書きされている`);
  }
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
    'src/components/newspaper/RaceEntryTable.astro',
    'src/components/newspaper/HorseDetailPanel.astro',
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
  refute(/winProbability|expectedValue/, code('src/components/newspaper/HorseDetailPanel.astro'),
    'HorseDetailPanel が未検証の勝率・期待値を表示している');
  refute(/winProbability|expectedValue/, code('src/components/newspaper/RaceEntryTable.astro'),
    'RaceEntryTable が未検証の勝率・期待値を表示している');
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
