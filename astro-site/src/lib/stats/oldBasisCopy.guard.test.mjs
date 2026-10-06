/**
 * oldBasisCopy.guard.test.mjs — 旧 5 点基準の回収率・投資額・払戻額・収支を顧客向け画面に出さない（2026-10-06 MK）
 *
 * 🔴 回収率は**どの基準でも**顧客画面に出さない（2026-10-06 MK: マイナス収支となる回収率を主要 KPI として公開しない）。
 *    表示買い目基準の回収率（lib/stats/displayedBets・data/stats/displayed*）は内部計測のみ。
 *    的中は、表示した馬単の組み合わせに確定した組み合わせが含まれたレースを数える（全 4,526 レースで一致を確認済み）。
 * 🔴 例外: NankanHorseStatsPanel（馬の戦績 DB の回収率＝KI の成績ではない）・AIBettingSection（どのページからも使っていない）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const EXEMPT = new Set(['src/components/NankanHorseStatsPanel.astro', 'src/components/AIBettingSection.astro']);


function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** コメント行を除いた「顧客に出る」行。 */
function visibleLines(src) {
  return src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l));
}

const files = ['src/pages', 'src/layouts', 'src/components']
  .flatMap((d) => walk(join(ROOT, d)))
  .filter((p) => p.endsWith('.astro'))
  .map((p) => relative(ROOT, p))
  .filter((p) => !EXEMPT.has(p));

test('🔴 顧客向け画面に旧基準の回収率・投資額・払戻額・合計配当・収支を出さない', () => {
  const bad = [];
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    const body = src.includes('---') ? src.slice(src.indexOf('---', 3) + 3) : src;   // frontmatter の計算は対象外
    for (const line of visibleLines(body)) {
      if (/\{[^}]*\b(returnRate|recoveryRate|totalPayout|betAmount|totalInvestment|profit)\b[^}]*\}/.test(line)) bad.push(`${f}: ${line.trim()}`);
      if (/(回収率|投資額|払戻額|合計配当|プラス収支)/.test(line) && !/AIChat|msg\.includes/.test(line)) bad.push(`${f}: ${line.trim()}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('🔴 SEO（title / description）に旧基準の回収率を入れない・ページ名は「AI予想結果」', () => {
  const bad = [];
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    for (const line of src.split('\n')) {
      if (/(title|description|Title|Description)\s*=/.test(line) && /(回収率|的中実績|returnRate)/.test(line)) bad.push(`${f}: ${line.trim()}`);
    }
  }
  assert.deepEqual(bad, []);
  const layout = readFileSync(join(ROOT, 'src/layouts/BaseLayout.astro'), 'utf8');
  assert.equal(/71\.1%|186\.4%|回収率186/.test(layout), false, '固定の古い数字が残っている');
  assert.match(layout, /AI予想結果 ▾/);
});

test('🔴 AI チャットの知識に旧基準の回収率・廃止プランを入れない', () => {
  const kb = readFileSync(join(ROOT, 'netlify/functions/gemini-chat.js'), 'utf8');
  for (const w of ['186.4', '71.1%', '88,000', '6,600', '12,000/月', '本線+抑え']) assert.equal(kb.includes(w), false, w);
});

test('的中の数え方の注記がある（結果・アーカイブ）', () => {
  for (const f of ['src/pages/results/[year]/[month]/[day].astro', 'src/pages/results/[year]/[month]/index.astro',
    'src/pages/archive/nankan/index.astro', 'src/pages/archive/jra/index.astro']) {
    assert.match(readFileSync(join(ROOT, f), 'utf8'), /AI全選定（会員に表示した馬単の組み合わせのすべて）に、確定した馬単の組み合わせが含まれていた/, f);
  }
});

test('🔴 表示買い目基準の回収率（内部計測）を顧客画面へ持ち込まない', () => {
  const bad = files.filter((f) => /displayedSummary|DisplayedBasisStats/.test(readFileSync(join(ROOT, f), 'utf8')));
  assert.deepEqual(bad, []);
});
