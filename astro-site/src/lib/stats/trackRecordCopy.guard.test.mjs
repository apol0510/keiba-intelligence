/**
 * trackRecordCopy.guard.test.mjs — 旧 5 点基準の回収率・投資額・払戻額・合計配当・収支を顧客向け画面に出さない
 *
 * 正本: docs/decisions.md 2026-10-19「旧 5 点基準の回収率…を撤去」（2026-10-06 MK 決定の実行）/ docs/measurements/TRACK_RECORD_CONSISTENCY_2026_10.md
 *
 * 🔴 archive の回収率は「表示した全組（平均約 15 組）で的中を判定し、分母は 1R 5 点×100 円」で算出しており、
 *    どの買い方でも再現できない。2026-10-06 に MK が顧客向け表示からの撤去を決めた。
 * 🔴 的中率・的中レース数は残す（保存済み isHit と表示した組の一致を確認済み）。
 * 🔴 frontmatter の集計コードは対象外（表示しなければよい。過去データは書き換えない）。
 *
 * 例外（このガードの対象外。別の MK 判断で扱う）:
 *   - NankanHorseStatsPanel.astro: 馬の戦績 DB の回収率（KI の成績ではない）
 *   - BaseLayout.astro のフッター固定値（71.1% / 186.4%）と既定 description の固定値: 出典の無い固定値の扱いは別判断
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const EXEMPT_FILES = new Set(['src/components/NankanHorseStatsPanel.astro']);

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const ASTRO_FILES = ['src/pages', 'src/layouts', 'src/components']
  .flatMap((d) => walk(join(ROOT, d)))
  .filter((p) => p.endsWith('.astro'))
  .map((p) => relative(ROOT, p))
  .filter((p) => !EXEMPT_FILES.has(p));

/** frontmatter（--- 〜 ---）を除いたテンプレート部分。 */
function templateOf(src) {
  if (!src.startsWith('---')) return src;
  const end = src.indexOf('\n---', 3);
  return end === -1 ? src : src.slice(end + 4);
}

/** コメント行を除いた行。 */
function visibleLines(src) {
  return src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*|<!--)/.test(l));
}

/** BaseLayout フッターの固定値（範囲外・別判断）だけを許す。 */
function isOutOfScopeFixedValue(file, line) {
  return file === 'src/layouts/BaseLayout.astro' && /footer-stat-label">回収率</.test(line);
}

test('🔴 顧客向け画面のテンプレートで回収率・投資額・払戻額・合計配当・収支の集計値を表示しない', () => {
  const bad = [];
  for (const f of ASTRO_FILES) {
    for (const line of visibleLines(templateOf(read(f)))) {
      if (/\{[^}]*\b(returnRate|totalPayout|betAmount|totalBetAmount|profit|highestPayout)\b[^}]*\}/.test(line)) {
        bad.push(`${f}: ${line.trim()}`);
      }
      if (/(回収率|投資額|払戻額|合計配当)/.test(line) && !/msg\.includes/.test(line) && !isOutOfScopeFixedValue(f, line)) {
        bad.push(`${f}: ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('🔴 ページの title / description（OG にも使われる）に回収率を入れない', () => {
  const bad = [];
  for (const f of ASTRO_FILES.filter((p) => p.startsWith('src/pages/'))) {
    for (const line of read(f).split('\n')) {
      if (/(title|description|Title|Description)\s*=/.test(line) && /(回収率|returnRate|totalPayout)/.test(line)) {
        bad.push(`${f}: ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('🔴 トップページに通算回収率と「払戻÷投資」の説明を出さない・的中率は残す', () => {
  const src = read('src/pages/index.astro');
  assert.equal(/totals\.all\.returnRate|returnRate\)/.test(src), false, 'トップに回収率が残っている');
  assert.equal(/払戻\s*÷\s*投資/.test(src), false, 'トップに回収率の算式が残っている');
  assert.match(src, /totals\.all\.hitRate/, 'トップの的中率（実測）が消えている');
});

test('🔴 料金・予想ページに回収率の算出説明を残さない', () => {
  for (const f of ['src/pages/pricing.astro', 'src/pages/prediction/nankan/index.astro', 'src/pages/prediction/jra/index.astro']) {
    const src = read(f);
    assert.equal(/払戻\s*÷\s*投資/.test(src), false, `${f}: 回収率の算式が残っている`);
    assert.equal(src.includes('回収率はどう計算'), false, `${f}: 回収率の FAQ が残っている`);
  }
});

test('🔴 FAQ に旧 5 点基準（集計上の基準点数）の説明を残さない', () => {
  const src = read('src/pages/faq.astro');
  assert.equal(/基準点数/.test(src), false);
});

test('🔴 AI チャットは archive の集計値（回収率）を参照しない', () => {
  const kb = read('netlify/functions/gemini-chat.js');
  assert.equal(/archiveResults|archiveTotals|returnRate/.test(kb), false);
  assert.equal(kb.includes('回収率グラフ'), false);
});
