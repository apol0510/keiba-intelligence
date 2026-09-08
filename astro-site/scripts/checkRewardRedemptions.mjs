/**
 * checkRewardRedemptions.mjs — 発送待ちの景品交換を監視する（read-only）
 *
 * 正本: docs/MEMBERSHIP_REWARDS.md §7.9（発送対象は `approved` のみ）
 *       docs/MEMBERSHIP_DATA_MIGRATION.md §2.3（RewardRedemptions のスキーマ）
 *
 * 🔴 **read-only。** Airtable への書き込みは 1 件も行わない（GET しか使わない）。
 *
 * 🔴 **fail-closed。** 取得失敗・認証失敗・スキーマ不一致を
 *    「approved 0 件」として扱わない。**exit 1 で監視失敗**にする。
 *    静かに 0 件と report すると、発送待ちを見落としたまま緑になる。
 *
 * 🔴 **通知へ個人情報を出さない。**
 *    `Email` / `RecipientName` / `PostalCode` / `Address` は読まない・出さない。
 *    `RedemptionId` も出さない（形式が `<email>:<itemId>:<requestId>` で
 *    **先頭にメールアドレスが入る**ため。`redemption.js` の `buildRedemptionId`）。
 *    出してよいのは **件数・品名・種別・ポイント・申込日**だけ。
 *
 * 🔴 `requested` は**発送対象ではない**（ポイント減算が未成立の回復待ち）。
 *    件数は参考として数えるが、**通知の判定には使わない**。
 *
 * 使い方:
 *   AIRTABLE_API_KEY=… AIRTABLE_BASE_ID=… node scripts/checkRewardRedemptions.mjs
 *
 * 出力: GITHUB_OUTPUT があれば approved_count / summary / oldest_requested_at を書く。
 */

import { appendFileSync } from 'node:fs';
import {
  REDEMPTION_TABLE, REDEMPTION_FIELDS,
} from '../src/lib/membership/airtableStore.js';

const API = 'https://api.airtable.com/v0';

/** 発送対象。🔴 `requested` を入れない。 */
export const SHIPPABLE_STATUS = 'approved';

/** 🔴 通知へ絶対に載せない列。 */
export const FORBIDDEN_IN_ALERT = Object.freeze([
  REDEMPTION_FIELDS.EMAIL,
  REDEMPTION_FIELDS.RECIPIENT_NAME,
  REDEMPTION_FIELDS.POSTAL_CODE,
  REDEMPTION_FIELDS.ADDRESS,
  REDEMPTION_FIELDS.REDEMPTION_ID,
]);

/** スキーマ確認に必要な列。欠けていたら監視失敗にする。 */
export const REQUIRED_FIELDS = Object.freeze([
  REDEMPTION_FIELDS.STATUS,
  REDEMPTION_FIELDS.ITEM_NAME,
  REDEMPTION_FIELDS.KIND,
  REDEMPTION_FIELDS.COST_POINTS,
  REDEMPTION_FIELDS.REQUESTED_AT,
]);

export const REQUIRED_STATUS_CHOICES = Object.freeze([
  'requested', 'approved', 'shipped', 'cancelled',
]);

export class MonitorError extends Error {}

/** 🔴 応答本文をそのまま出さない（値・フィールド名が混ざりうる）。 */
function shortCode(status, bodyText) {
  let type = '';
  try {
    const j = JSON.parse(String(bodyText || ''));
    const e = j && j.error;
    type = String(typeof e === 'string' ? e : (e && e.type) || '')
      .replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60);
  } catch { /* status だけで十分 */ }
  return type ? `${status}:${type}` : String(status);
}

/**
 * スキーマを検証する。
 * 🔴 テーブルが無い・列が足りない・Status の選択肢が欠けている場合は **throw**。
 *    「0 件」で通さない。
 */
export async function verifySchema({ baseId, apiKey, fetchImpl }) {
  const res = await fetchImpl(`${API.replace('/v0', '/v0')}/meta/bases/${baseId}/tables`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new MonitorError(`スキーマを読めない (${shortCode(res.status, t)})`);
  }
  const schema = await res.json();
  const table = (schema.tables || []).find((t) => t.name === REDEMPTION_TABLE);
  if (!table) throw new MonitorError(`${REDEMPTION_TABLE} が存在しない`);

  const have = new Set((table.fields || []).map((f) => f.name));
  const missing = REQUIRED_FIELDS.filter((n) => !have.has(n));
  if (missing.length) throw new MonitorError(`列が不足: ${missing.join(' / ')}`);

  const status = (table.fields || []).find((f) => f.name === REDEMPTION_FIELDS.STATUS);
  const choices = (status?.options?.choices || []).map((c) => c.name);
  const lack = REQUIRED_STATUS_CHOICES.filter((n) => !choices.includes(n));
  if (lack.length) throw new MonitorError(`Status の選択肢が不足: ${lack.join(' / ')}`);

  return true;
}

/** 指定 Status のレコードを全件読む（ページング）。 */
export async function fetchByStatus({ baseId, apiKey, fetchImpl, status }) {
  const out = [];
  let offset;
  do {
    const q = new URLSearchParams({
      pageSize: '100',
      filterByFormula: `{${REDEMPTION_FIELDS.STATUS}} = "${status}"`,
    });
    if (offset) q.set('offset', offset);
    const res = await fetchImpl(`${API}/${baseId}/${encodeURIComponent(REDEMPTION_TABLE)}?${q}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new MonitorError(`${status} を読めない (${shortCode(res.status, t)})`);
    }
    const data = await res.json();
    out.push(...(data.records || []));
    offset = data.offset;
  } while (offset);
  return out;
}

/**
 * 通知に載せる要約を作る。
 * 🔴 個人情報を含む列は**読まない**。品名・種別・ポイント・申込日だけを使う。
 */
export function summarize(records) {
  const byItem = new Map();
  let oldest = null;

  for (const r of records) {
    const f = r.fields || {};
    const name = f[REDEMPTION_FIELDS.ITEM_NAME] || '(品名なし)';
    const kind = f[REDEMPTION_FIELDS.KIND] || '';
    const key = kind === 'milestone' ? `${name}（記念品）` : name;
    byItem.set(key, (byItem.get(key) || 0) + 1);

    const at = f[REDEMPTION_FIELDS.REQUESTED_AT];
    if (at && (!oldest || String(at) < String(oldest))) oldest = String(at);
  }

  const lines = [...byItem.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([name, n]) => `  ${name} × ${n}`);

  return Object.freeze({
    count: records.length,
    breakdown: lines,
    oldestRequestedAt: oldest,
  });
}

/** 通知本文。🔴 個人情報は 1 文字も入れない。 */
export function buildBody({ approved, requestedCount }) {
  return [
    'マコさん、',
    '',
    `発送待ちの景品交換が **${approved.count} 件** あります。`,
    '',
    '【内訳】',
    ...(approved.breakdown.length ? approved.breakdown : ['  (品名を取得できませんでした)']),
    '',
    ...(approved.oldestRequestedAt ? [`【最も古い申込】 ${approved.oldestRequestedAt}`, ''] : []),
    '【対応方法】',
    '  Airtable の RewardRedemptions を開き、Status = approved の行を発送してください。',
    '  発送後は Status を shipped に、ShippedAt を発送日にしてください。',
    '',
    '🔴 requested は発送対象ではありません。',
    '   ポイントの減算がまだ成立していない回復待ちの状態です（docs/MEMBERSHIP_REWARDS.md §7.9）。',
    `   参考: 現在 requested は ${requestedCount} 件です。`,
    '',
    '【受取人・住所】',
    '  この通知には個人情報を含めていません。Airtable 上でご確認ください。',
    '',
    '【GitHub Actions ログ】',
    '  https://github.com/apol0510/keiba-intelligence/actions',
    '',
    '---',
    'このメールは自動送信されています。',
    'ワークフロー: check-reward-redemptions.yml',
  ].join('\n');
}

/** GITHUB_OUTPUT へ複数行を安全に書く。 */
function writeOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const delim = `__EOF_${name}_${Date.now()}__`;
  appendFileSync(file, `${name}<<${delim}\n${value}\n${delim}\n`);
}

export async function run({ env = process.env, fetchImpl = fetch } = {}) {
  const apiKey = env.AIRTABLE_API_KEY;
  const baseId = env.AIRTABLE_BASE_ID;

  // 🔴 資格情報が無いのを「0 件」にしない
  if (!apiKey || !baseId) {
    throw new MonitorError('AIRTABLE_API_KEY / AIRTABLE_BASE_ID が未設定（値は出力しない）');
  }

  await verifySchema({ baseId, apiKey, fetchImpl });

  const approvedRecords = await fetchByStatus({
    baseId, apiKey, fetchImpl, status: SHIPPABLE_STATUS,
  });
  // requested は通知の判定に使わない。本文へ参考として件数だけ載せる。
  const requestedRecords = await fetchByStatus({
    baseId, apiKey, fetchImpl, status: 'requested',
  });

  const approved = summarize(approvedRecords);
  const requestedCount = requestedRecords.length;

  writeOutput('approved_count', String(approved.count));
  writeOutput('requested_count', String(requestedCount));
  if (approved.count > 0) {
    writeOutput('subject', `🎁 発送待ちの景品交換が ${approved.count} 件あります`);
    writeOutput('body', buildBody({ approved, requestedCount }));
  }

  return Object.freeze({ approved, requestedCount });
}

/** CLI 実行時のみ。import されたときは走らない。 */
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  run()
    .then(({ approved, requestedCount }) => {
      console.log(`✅ 監視成功: approved ${approved.count} 件 / requested ${requestedCount} 件`);
      if (approved.count > 0) {
        console.log('   内訳:');
        for (const l of approved.breakdown) console.log(` ${l}`);
        console.log('   → 通知を送ります');
      } else {
        console.log('   → 発送待ちなし。通知は送りません');
      }
    })
    .catch((e) => {
      // 🔴 0 件として通さない。監視失敗として落とす。
      console.error(`❌ 監視失敗: ${e instanceof MonitorError ? e.message : '予期しないエラー'}`);
      process.exit(1);
    });
}
