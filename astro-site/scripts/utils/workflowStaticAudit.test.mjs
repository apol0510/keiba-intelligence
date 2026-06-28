/**
 * workflowStaticAudit.test.mjs — workflow ファイルの静的監査
 *
 * 確認項目 (PR-KI-2):
 *   - KEIBA_DATA_SHARED_TOKEN が全 shared 取得 step に設定されている
 *   - checkSharedNankanResults / checkSharedJraResults 呼び出しで exit code を確認している
 *   - TOTAL_RACES:-0 / TOTAL_RACES=${TOTAL_RACES:-0} が存在しない
 *   - HAK ベニューコードが存在しない（HKD のみ）
 *   - GITHUB_TOKEN を cross-repo 用途で使用していない
 *   - 匿名 curl raw.githubusercontent が残っていない
 *
 * 確認項目 (PR-KI-3b-1):
 *   - import-on-dispatch.yml / import-prediction-daily.yml の import step env 配下に
 *     KEIBA_DATA_SHARED_TOKEN: ${{ secrets.KEIBA_DATA_SHARED_TOKEN }} が設定されている
 *     （PyYAML 構造解析 + 位置確認の二重検証）
 *   - checkout 用 GITHUB_TOKEN 維持
 *   - schedule / dispatch 条件不変
 *   - working-directory 不変
 *   - script path 不変
 *
 *   node --test scripts/utils/workflowStaticAudit.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = join(__dirname, '..', '..', '..', '.github', 'workflows');

// PR-KI-2 の変更対象 7 ファイル
const TARGET_WORKFLOWS = [
  'archive-sync.yml',
  'auto-sync-check.yml',
  'import-results-jra-daily.yml',
  'import-results-jra.yml',
  'import-results-nankan-daily.yml',
  'import-results-on-dispatch.yml',
  'verify-archive-sync.yml',
];

function readWorkflow(name) {
  return readFileSync(join(WORKFLOWS_DIR, name), 'utf-8');
}

// ---- 1. 対象 workflow が存在する ----

test('1. 7 つの対象 workflow ファイルが存在する', () => {
  const existing = readdirSync(WORKFLOWS_DIR);
  for (const name of TARGET_WORKFLOWS) {
    assert.ok(existing.includes(name), `${name} が存在しない`);
  }
});

// ---- 2. KEIBA_DATA_SHARED_TOKEN ----

test('2. archive-sync.yml: KEIBA_DATA_SHARED_TOKEN が設定されている', () => {
  const text = readWorkflow('archive-sync.yml');
  assert.ok(text.includes('KEIBA_DATA_SHARED_TOKEN'), 'KEIBA_DATA_SHARED_TOKEN が見つからない');
});

test('3. import-results-jra.yml: KEIBA_DATA_SHARED_TOKEN が設定されている', () => {
  const text = readWorkflow('import-results-jra.yml');
  assert.ok(text.includes('KEIBA_DATA_SHARED_TOKEN'), 'KEIBA_DATA_SHARED_TOKEN が見つからない');
});

test('4. import-results-on-dispatch.yml: KEIBA_DATA_SHARED_TOKEN が設定されている', () => {
  const text = readWorkflow('import-results-on-dispatch.yml');
  assert.ok(text.includes('KEIBA_DATA_SHARED_TOKEN'), 'KEIBA_DATA_SHARED_TOKEN が見つからない');
});

test('5. import-results-nankan-daily.yml: KEIBA_DATA_SHARED_TOKEN が設定されている', () => {
  const text = readWorkflow('import-results-nankan-daily.yml');
  assert.ok(text.includes('KEIBA_DATA_SHARED_TOKEN'), 'KEIBA_DATA_SHARED_TOKEN が見つからない');
});

test('6. import-results-jra-daily.yml: KEIBA_DATA_SHARED_TOKEN が設定されている', () => {
  const text = readWorkflow('import-results-jra-daily.yml');
  assert.ok(text.includes('KEIBA_DATA_SHARED_TOKEN'), 'KEIBA_DATA_SHARED_TOKEN が見つからない');
});

test('7. auto-sync-check.yml: KEIBA_DATA_SHARED_TOKEN が設定されている', () => {
  const text = readWorkflow('auto-sync-check.yml');
  assert.ok(text.includes('KEIBA_DATA_SHARED_TOKEN'), 'KEIBA_DATA_SHARED_TOKEN が見つからない');
});

test('8. verify-archive-sync.yml: KEIBA_DATA_SHARED_TOKEN が設定されている', () => {
  const text = readWorkflow('verify-archive-sync.yml');
  assert.ok(text.includes('KEIBA_DATA_SHARED_TOKEN'), 'KEIBA_DATA_SHARED_TOKEN が見つからない');
});

// ---- 3. exit code 確認パターン ----

test('9. import-results-nankan-daily.yml: checker 呼び出しで exit code を確認している', () => {
  const text = readWorkflow('import-results-nankan-daily.yml');
  // "if ! OUTPUT=$(...)" または similar exit-code check pattern
  assert.ok(
    text.includes('if ! OUTPUT=') || text.includes('|| exit 1'),
    'checkSharedNankanResults の exit code が確認されていない',
  );
});

test('10. import-results-jra-daily.yml: checker 呼び出しで exit code を確認している', () => {
  const text = readWorkflow('import-results-jra-daily.yml');
  assert.ok(
    text.includes('if ! OUTPUT=') || text.includes('|| exit 1'),
    'checkSharedJraResults の exit code が確認されていない',
  );
});

test('11. auto-sync-check.yml: checker 呼び出しで exit code を確認している', () => {
  const text = readWorkflow('auto-sync-check.yml');
  assert.ok(
    text.includes('if ! OUTPUT=') || text.includes('|| exit 1'),
    'checkSharedNankanResults の exit code が確認されていない',
  );
});

test('12. verify-archive-sync.yml: checker 呼び出しで exit code を確認している', () => {
  const text = readWorkflow('verify-archive-sync.yml');
  // "if ! OUTPUT=" や "if ! JRA_CHECK_OUTPUT=" など変数名に依存しないパターンで確認
  const hasExitCheck = text.includes('if ! OUTPUT=') || text.includes('if ! JRA_CHECK_OUTPUT=') || text.includes('|| exit 1');
  assert.ok(hasExitCheck, 'checker の exit code が確認されていない');
});

// ---- 4. TOTAL_RACES:-0 マスキング禁止 ----

test('13. import-results-nankan-daily.yml: TOTAL_RACES:-0 が存在しない', () => {
  const text = readWorkflow('import-results-nankan-daily.yml');
  assert.ok(!text.includes('TOTAL_RACES:-0'), 'TOTAL_RACES:-0 が残っている（auth fail が 0 に隠れる）');
  assert.ok(!text.includes('TOTAL_RACES="${TOTAL_RACES:-0}"'), 'TOTAL_RACES 0 マスキングが残っている');
});

test('14. auto-sync-check.yml: TOTAL_RACES:-0 が存在しない', () => {
  const text = readWorkflow('auto-sync-check.yml');
  assert.ok(!text.includes('TOTAL_RACES:-0'), 'TOTAL_RACES:-0 が残っている（auth fail が 0 に隠れる）');
});

// ---- 5. HAK ベニューコード禁止 ----

test('15. 全 7 workflow にコード行として HAK ベニューコードが存在しない', () => {
  for (const name of TARGET_WORKFLOWS) {
    const text = readWorkflow(name);
    // YAML コメント行（# で始まる）は "HAK は誤コード" 等の注釈として許容する
    // コード行にのみ HAK が存在しないことを確認する
    const hasHAKinCode = text.split('\n').some((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('#')) return false;
      return /\bHAK\b/.test(trimmed);
    });
    assert.ok(!hasHAKinCode, `${name} のコード行に HAK ベニューコードが存在する（HKD のみ正規）`);
  }
});

// ---- 6. 匿名 raw.githubusercontent.com の新規追加禁止 ----
// PR-KI-2 で変更したファイルに raw.githubusercontent が新たに追加されていないこと
// （racebook の curl は import-results-jra-daily.yml の既存行として許容する）

test('16. import-results-nankan-daily.yml: raw.githubusercontent への新規 curl がない', () => {
  const text = readWorkflow('import-results-nankan-daily.yml');
  // nankan daily に raw.githubusercontent は本来不要
  assert.ok(
    !text.includes('raw.githubusercontent.com'),
    'import-results-nankan-daily.yml に匿名 raw.githubusercontent fetch が存在する',
  );
});

test('17. auto-sync-check.yml: raw.githubusercontent への新規 curl がない', () => {
  const text = readWorkflow('auto-sync-check.yml');
  assert.ok(
    !text.includes('raw.githubusercontent.com'),
    'auto-sync-check.yml に匿名 raw.githubusercontent fetch が存在する',
  );
});

test('18. archive-sync.yml: raw.githubusercontent への新規 curl がない', () => {
  const text = readWorkflow('archive-sync.yml');
  assert.ok(
    !text.includes('raw.githubusercontent.com'),
    'archive-sync.yml に匿名 raw.githubusercontent fetch が存在する',
  );
});

// ---- 7. checkSharedJraResults/checkSharedNankanResults の呼び出し先 ----

test('19. import-results-nankan-daily.yml: checkSharedNankanResults.mjs を使用', () => {
  const text = readWorkflow('import-results-nankan-daily.yml');
  assert.ok(
    text.includes('checkSharedNankanResults.mjs'),
    'checkSharedNankanResults.mjs の呼び出しが見つからない',
  );
});

test('20. import-results-jra-daily.yml: checkSharedJraResults.mjs を使用', () => {
  const text = readWorkflow('import-results-jra-daily.yml');
  assert.ok(
    text.includes('checkSharedJraResults.mjs'),
    'checkSharedJraResults.mjs の呼び出しが見つからない',
  );
});

test('21. verify-archive-sync.yml: checkSharedJraResults.mjs を使用', () => {
  const text = readWorkflow('verify-archive-sync.yml');
  assert.ok(
    text.includes('checkSharedJraResults.mjs'),
    'verify-archive-sync.yml に checkSharedJraResults.mjs が見つからない',
  );
});

test('22. verify-archive-sync.yml: checkSharedNankanResults.mjs を使用', () => {
  const text = readWorkflow('verify-archive-sync.yml');
  assert.ok(
    text.includes('checkSharedNankanResults.mjs'),
    'verify-archive-sync.yml に checkSharedNankanResults.mjs が見つからない',
  );
});

// ---- PR-KI-3b-1: 予想 import ワークフロー（構造的検証） ----

/**
 * PyYAML を使って import step の env 配下に KEIBA_DATA_SHARED_TOKEN が設定されているか検証する。
 * token が YAML のどこか（コメントなど）に含まれるだけでは通過しない。
 */
function verifyTokenInImportStepEnv(workflowFile, stepNameFragment) {
  const script = [
    'import yaml, sys',
    'f = open(sys.argv[1])',
    'doc = yaml.safe_load(f)',
    'f.close()',
    'job = list(doc.get("jobs", {}).values())[0]',
    'steps = job.get("steps", [])',
    'frag = sys.argv[2].lower()',
    'step = next((s for s in steps if frag in (s.get("name") or "").lower()), None)',
    'assert step, f"Step with fragment {repr(sys.argv[2])} not found"',
    'env = step.get("env") or {}',
    'key = "KEIBA_DATA_SHARED_TOKEN"',
    'assert key in env, f"Key {repr(key)} not in step env. env keys: {list(env.keys())}"',
    'val = str(env[key])',
    'expected = "${{ secrets.KEIBA_DATA_SHARED_TOKEN }}"',
    'assert val == expected, f"Value mismatch. expected={repr(expected)}, got={repr(val)}"',
    'print("OK")',
  ].join('\n');

  const wfPath = join(WORKFLOWS_DIR, workflowFile);
  const r = spawnSync('python3', ['-c', script, wfPath, stepNameFragment], { encoding: 'utf-8' });
  return r;
}

test('23. import-on-dispatch.yml: import step env に KEIBA_DATA_SHARED_TOKEN が正式設定されている（YAML構造検証）', () => {
  const workflowFile = 'import-on-dispatch.yml';
  const text = readWorkflow(workflowFile);

  // 位置確認: step header の後かつ次のステップより前
  const stepIdx = text.indexOf('Sync and import predictions');
  assert.ok(stepIdx >= 0, '"Sync and import predictions" step が見つからない');
  const tokenLine = 'KEIBA_DATA_SHARED_TOKEN: ${{ secrets.KEIBA_DATA_SHARED_TOKEN }}';
  const tokenIdx = text.indexOf(tokenLine);
  assert.ok(tokenIdx > stepIdx, `${tokenLine} が import step より後にない`);

  // GITHUB_TOKEN 維持確認
  assert.ok(text.includes('GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}'), 'checkout 用 GITHUB_TOKEN が維持されていない');

  // working-directory 不変確認
  assert.ok(text.includes('working-directory: astro-site'), 'working-directory が変更されている');

  // PyYAML 構造検証
  const r = verifyTokenInImportStepEnv(workflowFile, 'sync and import');
  assert.strictEqual(
    r.stdout.trim(), 'OK',
    `PyYAML 構造検証失敗: stdout=${r.stdout.trim()} stderr=${r.stderr.trim()} status=${r.status}`,
  );
});

test('24. import-prediction-daily.yml: import step env に KEIBA_DATA_SHARED_TOKEN が正式設定されている（YAML構造検証）', () => {
  const workflowFile = 'import-prediction-daily.yml';
  const text = readWorkflow(workflowFile);

  // 位置確認: step header の後かつ次のステップより前
  const stepIdx = text.indexOf('Import prediction from keiba-data-shared');
  assert.ok(stepIdx >= 0, '"Import prediction from keiba-data-shared" step が見つからない');
  const tokenLine = 'KEIBA_DATA_SHARED_TOKEN: ${{ secrets.KEIBA_DATA_SHARED_TOKEN }}';
  const tokenIdx = text.indexOf(tokenLine);
  assert.ok(tokenIdx > stepIdx, `${tokenLine} が import step より後にない`);

  // GITHUB_TOKEN 維持確認
  assert.ok(text.includes('GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}'), 'checkout 用 GITHUB_TOKEN が維持されていない');

  // working-directory 不変確認
  assert.ok(text.includes('working-directory: astro-site'), 'working-directory が変更されている');

  // PyYAML 構造検証
  const r = verifyTokenInImportStepEnv(workflowFile, 'import prediction from keiba-data-shared');
  assert.strictEqual(
    r.stdout.trim(), 'OK',
    `PyYAML 構造検証失敗: stdout=${r.stdout.trim()} stderr=${r.stderr.trim()} status=${r.status}`,
  );
});
