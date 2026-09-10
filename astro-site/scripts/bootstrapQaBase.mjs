/**
 * bootstrapQaBase.mjs — QA 専用 Airtable base に本番と同じスキーマを作る
 *
 * 正本: docs/QA_STRIPE_TESTMODE_RUNBOOK.md
 *
 * 🔴 **production base には絶対に触らない。**
 *    対象が `AIRTABLE_BASE_ID`（production）と一致したら**即座に中止**する。
 *    レコードは 1 件も読まないし書かない。作るのは**テーブルと列だけ**。
 *
 * 🔴 冪等: 既にあるテーブルは**作り直さない**（列の差分だけ報告する）。
 *
 * 使い方:
 *   AIRTABLE_API_KEY=…（QA base にアクセスできる PAT）
 *   AIRTABLE_QA_BASE_ID=appXXXX（🔴 QA base。production ではない）
 *   AIRTABLE_BASE_ID=appYYYY（production。誤爆を防ぐためだけに渡す）
 *   node scripts/bootstrapQaBase.mjs            # 何を作るか出すだけ（既定）
 *   node scripts/bootstrapQaBase.mjs --apply    # 実際に作る
 */

const APPLY = process.argv.includes('--apply');
const KEY = process.env.AIRTABLE_API_KEY;
const QA = process.env.AIRTABLE_QA_BASE_ID;
const PROD = process.env.AIRTABLE_BASE_ID;
const API = 'https://api.airtable.com/v0/meta/bases';

const iso = { dateFormat: { name: 'iso' } };
const isoTime = { dateFormat: { name: 'iso' }, timeZone: 'utc' };
const num = { precision: 0 };
const sel = (...names) => ({ choices: names.map((name) => ({ name })) });

/**
 * 本番の schema（2026-09-10 に Metadata API から抽出）。
 * 🔴 各配列の**先頭が primary field**。本番と同じ列にしてある。
 * 🔴 計算列（formula / rollup / lookup）は本番にも無い。
 */
const TABLES = [
  {
    name: 'Customers',
    fields: [
      { name: 'Email', type: 'singleLineText' },
      { name: 'Name', type: 'singleLineText' },
      { name: 'Plan', type: 'singleSelect', options: sel('light', 'pro') },
      { name: 'PlanType', type: 'singleSelect', options: sel('free-registered', 'light', 'pro', 'premium', 'free') },
      { name: 'plan_type', type: 'singleSelect', options: sel('lifetime', 'yearly', 'light', 'monthly-nankan', 'monthly-jra') },
      { name: 'VenueAccess', type: 'singleSelect', options: sel('all', 'nankan', 'jra') },
      { name: 'Status', type: 'singleSelect', options: sel('pending', 'active', 'cancelled', 'expired', 'suspended', 'unpaid', 'refunded', 'withdrawn', 'test', 'inactive', 'payment_failed') },
      { name: 'PaymentEmailSent', type: 'checkbox', options: { icon: 'check', color: 'greenBright' } },
      { name: 'PaymentMethod', type: 'singleSelect', options: sel('Bank Transfer') },
      { name: 'ExpirationDate', type: 'dateTime', options: isoTime },
      { name: '有効期限', type: 'dateTime', options: isoTime },
      { name: 'AccessEnabled', type: 'checkbox', options: { icon: 'check', color: 'greenBright' } },
      { name: 'CreatedAt', type: 'dateTime', options: isoTime },
      { name: 'Source', type: 'singleLineText' },
      { name: 'Brand', type: 'multipleSelects', options: sel('analytics-keiba', 'keiba-intelligence') },
      { name: 'ServiceType', type: 'multipleSelects', options: sel('analytics-keiba', 'keiba-intelligence') },
      { name: 'AudienceType', type: 'singleSelect', options: sel('free', 'light', 'standard', 'premium', 'premium-combo', 'expired', 'unpaid', 'admin-test') },
      { name: 'UnsubscribedAnalyticsKeiba', type: 'checkbox', options: { icon: 'check', color: 'greenBright' } },
      { name: 'UnsubscribedKeibaIntelligence', type: 'checkbox', options: { icon: 'check', color: 'greenBright' } },
      { name: 'UnsubscribedAtAnalyticsKeiba', type: 'dateTime', options: isoTime },
      { name: 'UnsubscribedAtKeibaIntelligence', type: 'dateTime', options: isoTime },
      { name: 'LastNewsletterSentAt', type: 'dateTime', options: isoTime },
      { name: 'LastNewsletterBrand', type: 'singleSelect', options: sel('analytics-keiba', 'keiba-intelligence') },
      { name: 'MembershipStartedAt', type: 'date', options: iso },
      { name: 'CancelledAt', type: 'date', options: iso },
      { name: 'ContractPriceYen', type: 'number', options: num },
      { name: 'ContractPriceId', type: 'singleLineText' },
      { name: 'ContractCurrency', type: 'singleLineText' },
      { name: 'ContractStartedAt', type: 'date', options: iso },
    ],
  },
  {
    // 🔴 マジックリンクのログインに要る。これが無いと QA 会員でログインできない
    name: 'AuthTokens',
    fields: [
      { name: 'Token', type: 'singleLineText' },
      { name: 'Email', type: 'email' },
      { name: 'ExpiresAt', type: 'dateTime', options: isoTime },
      { name: 'Used', type: 'checkbox', options: { icon: 'check', color: 'greenBright' } },
      { name: 'CreatedAt', type: 'dateTime', options: isoTime },
      { name: 'Ip_Address', type: 'singleLineText' },
      { name: 'User_Agent', type: 'multilineText' },
    ],
  },
  {
    name: 'RewardLedger',
    fields: [
      { name: 'EntryId', type: 'singleLineText' },
      { name: 'Email', type: 'singleLineText' },
      { name: 'Type', type: 'singleSelect', options: sel('accrual', 'redemption', 'adjustment', 'expiry') },
      { name: 'Points', type: 'number', options: num },
      { name: 'OccurredAt', type: 'date', options: iso },
      { name: 'PeriodMonths', type: 'number', options: num },
      { name: 'SourceRef', type: 'singleLineText' },
      { name: 'Note', type: 'multilineText' },
    ],
  },
  {
    name: 'RewardRedemptions',
    fields: [
      { name: 'RedemptionId', type: 'singleLineText' },
      { name: 'Email', type: 'singleLineText' },
      { name: 'ItemId', type: 'singleLineText' },
      { name: 'ItemName', type: 'singleLineText' },
      { name: 'Kind', type: 'singleLineText' },
      { name: 'CostPoints', type: 'number', options: num },
      { name: 'MilestoneMonths', type: 'number', options: num },
      { name: 'Status', type: 'singleSelect', options: sel('requested', 'approved', 'shipped', 'cancelled') },
      { name: 'RequestedAt', type: 'date', options: iso },
      { name: 'ShippedAt', type: 'date', options: iso },
      { name: 'RecipientName', type: 'singleLineText' },
      { name: 'PostalCode', type: 'singleLineText' },
      { name: 'Address', type: 'multilineText' },
    ],
  },
];

export { TABLES };

function fail(msg) { console.error(`🔴 ${msg}`); process.exit(1); }

/** 🔴 production への誤爆を防ぐ最重要チェック。 */
export function assertNotProduction(qaBaseId, prodBaseId) {
  if (!qaBaseId) return '対象 base（AIRTABLE_QA_BASE_ID）が未設定';
  if (!/^app[A-Za-z0-9]+$/.test(qaBaseId)) return '対象 base の形式が不正';
  if (prodBaseId && qaBaseId === prodBaseId) return '🔴 対象が production base と同じ。中止する';
  return null;
}

async function main() {
  if (!KEY) fail('AIRTABLE_API_KEY が未設定');
  const bad = assertNotProduction(QA, PROD);
  if (bad) fail(bad);

  console.log(`\n🔧 QA base bootstrap — mode: ${APPLY ? 'apply' : 'dry-run'}`);
  console.log(`   対象 base : ${QA.slice(0, 6)}…（production とは別であることを確認済み）\n`);

  const res = await fetch(`${API}/${QA}/tables`, { headers: { Authorization: `Bearer ${KEY}` } });
  if (!res.ok) fail(`対象 base の schema を読めない (${res.status})。PAT に対象 base への schema 権限があるか確認`);
  const existing = new Map((await res.json()).tables.map((t) => [t.name, t]));

  for (const table of TABLES) {
    const found = existing.get(table.name);
    if (found) {
      const have = new Set(found.fields.map((f) => f.name));
      const missing = table.fields.filter((f) => !have.has(f.name)).map((f) => f.name);
      console.log(`  ✅ ${table.name} は既にある（${found.fields.length} 列）`);
      if (missing.length) console.log(`     🔴 不足: ${missing.join(' / ')}（このスクリプトは列の追加をしない。手動で足すこと）`);
      continue;
    }
    if (!APPLY) {
      console.log(`  ⬜ ${table.name} を作る（${table.fields.length} 列・primary=${table.fields[0].name}）`);
      continue;
    }
    const created = await fetch(`${API}/${QA}/tables`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: table.name, fields: table.fields }),
    });
    if (!created.ok) {
      let code = '';
      try { const j = await created.json(); code = j?.error?.type || j?.error?.message || ''; } catch { /* status で足りる */ }
      fail(`${table.name} の作成に失敗 (${created.status}${code ? ` ${String(code).slice(0, 60)}` : ''})`);
    }
    const j = await created.json();
    console.log(`  ✅ ${table.name} を作成（id: ${j.id} / ${j.fields.length} 列）`);
  }

  console.log(APPLY
    ? '\n✅ 完了。次は docs/QA_STRIPE_TESTMODE_RUNBOOK.md の env 設定へ。'
    : '\n（dry-run。実際に作るには --apply）');
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().catch(() => fail('例外で終了（内容は出力しない）'));
