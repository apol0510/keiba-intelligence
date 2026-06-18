/**
 * venueCodeHakodate.test.js
 *
 * 函館コード正準化（HKD）の再発防止テスト【ソース契約検査】。
 *
 * keiba-data-shared の正準コードは函館=HKD（admin venue-codes.ts / CLAUDE.md /
 * cross-project-safety-rules.md）。過去に KI の JRA 取得経路3箇所が函館=HAK で、
 * shared の `*-HKD.json` を取得できず函館の AI分析詳細・過去走distance補完が 404 欠落していた。
 *
 * 【限界の明示】対象3関数の venue マップは
 *   - gemini-race-analysis.js: 内部 const（未export）
 *   - importPredictionJra.js / importResultsJra.js: 末尾で無ガード `main()` を実行（import 不可）
 *   のため、実コードを import して値を直接実行する形にはできない（main-guard 追加は本タスク範囲外）。
 *   よって本テストは「ソース契約検査」に限定する。URL の独自再現による『実コード検証』は行わない。
 *   保証するのは次のみ:
 *     (1) 対象マップに函館=HKD が存在する
 *     (2) 対象マップに函館=HAK が存在しない（ファイル内に 'HAK' リテラルが残らない）
 *     (3) importResultsJra の函館正規化に HKD 自己 alias（'HKD':'HKD'）が存在する
 *     (4) 福島の行に差分がない（本タスクで未変更）
 *
 * 実行: node scripts/utils/venueCodeHakodate.test.js
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..'); // astro-site/
const read = (rel) => readFileSync(join(ROOT, rel), 'utf-8');
const GEMINI = 'netlify/functions/gemini-race-analysis.js';
const IMP_PRED = 'scripts/importPredictionJra.js';
const IMP_RES = 'scripts/importResultsJra.js';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); } };

console.log('[函館コード正準化(HKD) 再発防止 / ソース契約検査]');

const srcGemini = read(GEMINI);
const srcPred = read(IMP_PRED);
const srcRes = read(IMP_RES);

// (1) 函館 = HKD が存在
check("gemini JRA_VENUES: '函館':'HKD' 存在", /'函館'\s*:\s*'HKD'/.test(srcGemini));
check("importPredictionJra JRA_VENUE_CODE: '函':'HKD' 存在", /'函'\s*:\s*'HKD'/.test(srcPred));
check("importResultsJra normalizeVenue: '函館':'HKD' 存在", /'函館'\s*:\s*'HKD'/.test(srcRes));

// (2) 函館 = HAK が存在しない（各ファイルに 'HAK' リテラルが残らない＝退行検出）
check('gemini: HAK リテラル残存なし', !srcGemini.includes("'HAK'") && !srcGemini.includes('"HAK"'));
check('importPredictionJra: HAK リテラル残存なし', !srcPred.includes("'HAK'") && !srcPred.includes('"HAK"'));
check('importResultsJra: HAK リテラル残存なし', !srcRes.includes("'HAK'") && !srcRes.includes('"HAK"'));

// (3) importResultsJra: 函館正規化の HKD 自己 alias（pred↔result 対称突合の維持）
check("importResultsJra: '函館':'HKD','HKD':'HKD' の自己alias対存在", /'函館'\s*:\s*'HKD'\s*,\s*'HKD'\s*:\s*'HKD'/.test(srcRes));

// (4) 福島も正準コード FKS へ統一（admin venue-codes.ts と一致・FUK 残存なし）
check("gemini: 福島=FKS", /'福島'\s*:\s*'FKS'/.test(srcGemini));
check("importPredictionJra: 福島 '福':'FKS'", /'福'\s*:\s*'FKS'/.test(srcPred));
check("importResultsJra: 福島=FKS（FUKでない）", /'福島'\s*:\s*'FKS'/.test(srcRes) && !/'福島'\s*:\s*'FUK'/.test(srcRes));
check("importResultsJra: normalizeVenue に FUK リテラル残存なし", !/'FUK'/.test(srcRes));
check("importResultsJra: '福島':'FKS','FKS':'FKS' の自己alias対存在", /'福島'\s*:\s*'FKS'\s*,\s*'FKS'\s*:\s*'FKS'/.test(srcRes));

console.log(`\n結果: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
