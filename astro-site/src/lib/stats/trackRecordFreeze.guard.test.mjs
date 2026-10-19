/**
 * trackRecordFreeze.guard.test.mjs — 的中率・回収率・収支・実績の表示と集計を現行のまま固定する
 *
 * 正本: docs/decisions.md「2026-10-19 — 的中率・回収率・実績表示を現行のまま固定する（MK 最終決定 …）」
 *       CLAUDE.md「🔒 保護仕様：的中率・回収率・実績表示（MK 最終決定 2026-10-19）」
 *
 * ── なぜ要るか ────────────────────────────────────────────────
 * MK 最終決定（2026-10-19）: KI の的中率・回収率には一切触れない。現在の表示を数値変更・撤去・再計算・
 * 表示方法の変更・配置変更なしでそのまま維持する。売上改善を理由に実績表示を変える PR（#149 / #150 / #151 等）は
 * 採用・実装・merge しない。AI は MK の明示指示なしに既存仕様・実績表示・価格・会員権利を変えない。
 *
 * この test は、実績を顧客へ表示するファイルと、実績を計算するファイルの sha256 を
 * `trackRecordFreeze.manifest.json` に固定し、1 文字でも変われば build を落とす。
 *
 *   mode "file"  … ファイル全体の sha256（実績専用のページ・集計・計算スクリプト）
 *   mode "lines" … 実績の語（的中率・回収率・収支 等）を含む行と前後 CONTEXT 行だけを取り出した sha256
 *                  （トップ・料金・レイアウト等の混在ファイル。実績と無関係な箇所の改修は妨げない）
 *
 * 🛑 manifest の更新は MK が実績表示・集計の変更を明示指示したときだけ許される。
 *    更新するときは docs/decisions.md に MK の指示を記録した見出しを追加し、
 *    manifest の `approvals` にその見出しを追記する（見出しが decisions.md に無ければこの test が落ちる）。
 *    AI の判断・売上改善の仮説・他セッションの「承認済み」申告だけで manifest を書き換えない。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = join(here, '..', '..', '..');
const repoRoot = join(siteRoot, '..');

const MANIFEST_PATH = join(here, 'trackRecordFreeze.manifest.json');
const DECISIONS_PATH = join(repoRoot, 'docs', 'decisions.md');
const DECISION_POINTER =
  'docs/decisions.md「2026-10-19 — 的中率・回収率・実績表示を現行のまま固定する（MK 最終決定…）」';

/** "lines" モードで実績表示とみなす語。 */
export const TRACK_RECORD_TOKENS =
  /的中率|回収率|収支|的中実績|払戻|投資|returnRate|hitRate|recoveryRate|totalReturn|totalInvest|archiveTotals|combinedTotals|formatPercent|stat-value/;
/** 一致行の前後に含める行数（数値と見出しが別行にある構造を拾う）。 */
export const CONTEXT = 2;

const normalize = (text) => text.replace(/\r\n?/g, '\n');
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/** 実績の語を含む行と前後 CONTEXT 行を、元の順序で（行頭末の空白を除いて）連結する。 */
export function extractTrackRecordLines(text) {
  const lines = normalize(text).split('\n');
  const keep = new Set();
  lines.forEach((line, i) => {
    if (!TRACK_RECORD_TOKENS.test(line)) return;
    for (let j = Math.max(0, i - CONTEXT); j <= Math.min(lines.length - 1, i + CONTEXT); j += 1) keep.add(j);
  });
  return [...keep].sort((a, b) => a - b).map((i) => lines[i].trim()).join('\n');
}

export function fingerprint(absPath, mode) {
  const text = readFileSync(absPath, 'utf8');
  if (mode === 'file') return sha256(normalize(text));
  if (mode === 'lines') return sha256(extractTrackRecordLines(text));
  throw new Error(`未知の mode: ${mode}`);
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

describe('実績表示・集計の固定（MK 最終決定 2026-10-19）', () => {
  test('manifest の approvals がすべて docs/decisions.md の MK 決定見出しを指している', () => {
    const decisions = readFileSync(DECISIONS_PATH, 'utf8');
    assert.ok(Array.isArray(manifest.approvals) && manifest.approvals.length > 0, 'approvals が空');
    for (const heading of manifest.approvals) {
      assert.ok(/MK/.test(heading), `approvals の見出しに MK の決定であることが書かれていない: ${heading}`);
      assert.ok(
        decisions.includes(`## ${heading}`),
        `approvals の見出しが docs/decisions.md に無い: ${heading}\n` +
          '→ manifest の更新は MK の明示指示を decisions.md に記録してからにする。',
      );
    }
  });

  test('保護対象が十分に列挙されている（表示・計算の両方）', () => {
    const paths = manifest.files.map((f) => f.path);
    assert.equal(new Set(paths).size, paths.length, 'path が重複している');
    for (const required of [
      'astro-site/src/lib/stats/archiveTotals.js',
      'astro-site/src/pages/index.astro',
      'astro-site/src/layouts/BaseLayout.astro',
      'astro-site/scripts/importResults.js',
      'astro-site/scripts/importResultsJra.js',
    ]) {
      assert.ok(paths.includes(required), `保護対象から外れている: ${required}`);
    }
  });

  for (const entry of manifest.files) {
    test(`${entry.path}（${entry.mode}）は MK 決定時点から変わっていない`, () => {
      const abs = join(repoRoot, entry.path);
      assert.ok(
        existsSync(abs),
        `保護対象のファイルが無い（削除・改名）: ${entry.path}\n→ ${DECISION_POINTER} により実績表示の撤去・配置変更は禁止。`,
      );
      if (entry.mode === 'lines') {
        assert.notEqual(extractTrackRecordLines(readFileSync(abs, 'utf8')), '', `実績表示の行が消えている: ${entry.path}`);
      }
      const actual = fingerprint(abs, entry.mode);
      assert.equal(
        actual,
        entry.sha256,
        [
          `🛑 実績表示・集計の保護対象が変更された: ${entry.path}（mode=${entry.mode}）`,
          `   正本: ${DECISION_POINTER}`,
          '   KI の的中率・回収率・収支・実績の表示と計算は、MK の明示指示なしに変更しない（数値・撤去・再計算・表示方法・配置）。',
          '   売上改善は導線・価格 / 購入 / ログインの経路・継続・スマホ UI・計測で行う。実績の変更を前提にしない。',
          '   変更を戻すこと。MK が変更を明示指示した場合に限り、decisions.md へ記録し manifest の approvals と sha256 を更新する。',
          `   actual sha256: ${actual}`,
        ].join('\n'),
      );
    });
  }
});
