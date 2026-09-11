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
 *   node scripts/bootstrapQaBase.mjs --check    # 🔴 read-only。本番と同じ形か照合する
 */

const APPLY = process.argv.includes('--apply');
const CHECK = process.argv.includes('--check');
const KEY = process.env.AIRTABLE_API_KEY;
const QA = process.env.AIRTABLE_QA_BASE_ID;
const PROD = process.env.AIRTABLE_BASE_ID;
const API = 'https://api.airtable.com/v0/meta/bases';

const iso = { dateFormat: { name: 'iso' } };
/**
 * 🔴 `dateTime` は作成時に `timeFormat` が**必須**（2026-09-11 に 422
 * `INVALID_FIELD_TYPE_OPTIONS_FOR_CREATE` で実際に踏んだ）。
 * 読み取り時の形と作成時に要求される形は違う。`timeFormat` は**表示設定**であり、
 * 保存される値（ISO のタイムスタンプ）は変わらない＝ production の意味は変えない。
 */
const isoTime = { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' };
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

/** 列の型・オプションを比較用の短い文字列にする。 */
export function fieldSignature(field) {
  const o = field.options || {};
  const parts = [field.type];
  if (o.choices) parts.push(`choices=${o.choices.map((c) => c.name).join(',')}`);
  if (o.dateFormat) parts.push(`dateFormat=${o.dateFormat.name}`);
  if (o.precision != null) parts.push(`precision=${o.precision}`);
  return parts.join(' ');
}

/**
 * 期待するスキーマと実際のスキーマを突き合わせる（**純関数**）。
 *
 * 🔴 「本番に無い列」は落とさない（Airtable が既定で足す列があるため）。
 *    落とすのは **不足・型違い・primary 違い**だけ。
 */
export function diffSchema(expectedTables, actualTables) {
  const actual = new Map(actualTables.map((t) => [t.name, t]));
  const problems = [];
  const report = [];

  for (const want of expectedTables) {
    const got = actual.get(want.name);
    if (!got) {
      problems.push(`${want.name}: テーブルが無い`);
      report.push({ table: want.name, ok: false, missing: want.fields.map((f) => f.name), mismatched: [], extra: [] });
      continue;
    }

    const gotFields = new Map(got.fields.map((f) => [f.name, f]));
    const missing = [];
    const mismatched = [];
    for (const wf of want.fields) {
      const gf = gotFields.get(wf.name);
      if (!gf) { missing.push(wf.name); continue; }
      const a = fieldSignature(wf);
      const b = fieldSignature(gf);
      if (a !== b) mismatched.push(`${wf.name}: 期待「${a}」/ 実際「${b}」`);
    }

    const primaryName = got.fields.find((f) => f.id === got.primaryFieldId)?.name;
    const wantPrimary = want.fields[0].name;
    const primaryOk = primaryName === wantPrimary;

    if (missing.length) problems.push(`${want.name}: 列が不足 → ${missing.join(' / ')}`);
    if (mismatched.length) problems.push(`${want.name}: 型が違う → ${mismatched.join(' / ')}`);
    if (!primaryOk) problems.push(`${want.name}: primary が違う（期待 ${wantPrimary} / 実際 ${primaryName}）`);

    report.push({
      table: want.name, ok: !missing.length && !mismatched.length && primaryOk,
      missing, mismatched, primaryOk, wantPrimary, primaryName,
      extra: got.fields.filter((f) => !want.fields.some((w) => w.name === f.name)).map((f) => f.name),
    });
  }
  return { ok: problems.length === 0, problems, report };
}

/**
 * ── 🔴 Metadata API の「作成時に有効な options」──────────────────────────
 *
 * 正本: https://airtable.com/developers/web/api/field-model
 *
 * 🔴 **読み取り時に返ってくる形と、作成時に要求される形は違う。**
 *    production から読んだ schema をそのまま送ると 422 になる列がある。
 *    2026-09-11 に `dateTime` の `timeFormat` 欠落で実際に踏んだ
 *    （`INVALID_FIELD_TYPE_OPTIONS_FOR_CREATE`）。
 *
 * ここでの検証は**送信前**に行う。ネットワークへ出る前に落とすことで、
 * 「1 テーブル作った所で 422 で止まり、base が中途半端に残る」事故を防ぐ。
 */
const DATE_FORMAT_NAMES = new Set(['local', 'friendly', 'us', 'european', 'iso']);
const TIME_FORMAT_NAMES = new Set(['12hour', '24hour']);
const CHECKBOX_COLORS = new Set([
  'greenBright', 'tealBright', 'cyanBright', 'blueBright', 'purpleBright',
  'pinkBright', 'redBright', 'orangeBright', 'yellowBright', 'grayBright',
]);
const CHECKBOX_ICONS = new Set(['check', 'xCheckbox', 'star', 'heart', 'thumbsUp', 'flag', 'dot']);
/** options を**付けてはいけない**型。 */
const NO_OPTIONS_TYPES = new Set(['singleLineText', 'multilineText', 'email', 'url', 'phoneNumber']);
/**
 * 🔴 primary field（各テーブルの**先頭列**）に使えない型。
 * `singleLineText` / `number` / `date` などは使える。
 */
const PRIMARY_FORBIDDEN_TYPES = new Set([
  'checkbox', 'multipleSelects', 'multipleAttachments', 'multipleRecordLinks',
  'multipleCollaborators', 'button', 'formula', 'rollup', 'count', 'lookup',
  'multipleLookupValues', 'createdTime', 'lastModifiedTime', 'createdBy',
  'lastModifiedBy', 'autoNumber',
]);
/** 🔴 API では**作成できない**型（計算列・自動列）。 */
const UNCREATABLE_TYPES = new Set([
  'formula', 'rollup', 'lookup', 'multipleLookupValues', 'count',
  'createdTime', 'lastModifiedTime', 'createdBy', 'lastModifiedBy',
  'autoNumber', 'button',
]);

/**
 * 1 列が「作成時の payload」として妥当か検証する（**純関数**）。
 *
 * @returns {string|null} 問題があれば理由、無ければ null
 */
export function validateCreateField(field) {
  if (!field || typeof field.name !== 'string' || !field.name) return '列名が無い';
  const { type, options } = field;
  if (typeof type !== 'string' || !type) return `${field.name}: type が無い`;
  if (UNCREATABLE_TYPES.has(type)) return `${field.name}: ${type} は API で作成できない型`;

  const has = (o) => o && typeof o === 'object';

  if (NO_OPTIONS_TYPES.has(type)) {
    if (has(options) && Object.keys(options).length > 0) {
      return `${field.name}: ${type} に options を付けてはいけない`;
    }
    return null;
  }

  switch (type) {
    case 'dateTime': {
      if (!has(options)) return `${field.name}: dateTime に options が要る`;
      if (!has(options.dateFormat) || !DATE_FORMAT_NAMES.has(options.dateFormat.name)) {
        return `${field.name}: dateTime の dateFormat.name が不正`;
      }
      // 🔴 ここが 2026-09-11 の 422 の原因
      if (!has(options.timeFormat) || !TIME_FORMAT_NAMES.has(options.timeFormat.name)) {
        return `${field.name}: dateTime は timeFormat.name（12hour / 24hour）が必須`;
      }
      if (typeof options.timeZone !== 'string' || !options.timeZone) {
        return `${field.name}: dateTime は timeZone が必須`;
      }
      return null;
    }
    case 'date': {
      if (!has(options)) return `${field.name}: date に options が要る`;
      if (!has(options.dateFormat) || !DATE_FORMAT_NAMES.has(options.dateFormat.name)) {
        return `${field.name}: date の dateFormat.name が不正`;
      }
      // date は時刻を持たない。付けると 422 になる
      if (options.timeFormat) return `${field.name}: date に timeFormat を付けてはいけない`;
      if (options.timeZone) return `${field.name}: date に timeZone を付けてはいけない`;
      return null;
    }
    case 'checkbox': {
      if (!has(options)) return `${field.name}: checkbox に options が要る`;
      if (!CHECKBOX_ICONS.has(options.icon)) return `${field.name}: checkbox の icon が不正`;
      if (!CHECKBOX_COLORS.has(options.color)) return `${field.name}: checkbox の color が不正`;
      return null;
    }
    case 'number':
    case 'percent': {
      if (!has(options)) return `${field.name}: ${type} に options が要る`;
      const p = options.precision;
      if (!Number.isInteger(p) || p < 0 || p > 8) return `${field.name}: ${type} の precision は 0〜8 の整数`;
      return null;
    }
    case 'currency': {
      if (!has(options)) return `${field.name}: currency に options が要る`;
      const p = options.precision;
      if (!Number.isInteger(p) || p < 0 || p > 7) return `${field.name}: currency の precision は 0〜7 の整数`;
      if (typeof options.symbol !== 'string' || !options.symbol) return `${field.name}: currency は symbol が必須`;
      return null;
    }
    case 'singleSelect':
    case 'multipleSelects': {
      if (!has(options) || !Array.isArray(options.choices) || options.choices.length === 0) {
        return `${field.name}: ${type} は choices が必須`;
      }
      for (const c of options.choices) {
        if (!c || typeof c.name !== 'string' || !c.name) return `${field.name}: choices に名前の無い選択肢がある`;
        // 作成時に既存 id は指定しない
        if (c.id) return `${field.name}: 作成時の choices に id を付けてはいけない`;
      }
      return null;
    }
    default:
      // 明示的に扱っていない型は、options の有無を判断できないので通す
      return null;
  }
}

/**
 * TABLES 全体を「作成時の payload」として検証する（**純関数**）。
 *
 * @returns {string[]} 問題の一覧（空なら妥当）
 */
export function validateCreateSchema(tables) {
  const problems = [];
  for (const t of tables) {
    if (!t?.name) { problems.push('テーブル名が無い'); continue; }
    if (!Array.isArray(t.fields) || t.fields.length === 0) {
      problems.push(`${t.name}: 列が無い`);
      continue;
    }
    const seen = new Set();
    for (const f of t.fields) {
      if (seen.has(f?.name)) problems.push(`${t.name}: 列名が重複している → ${f.name}`);
      seen.add(f?.name);
      const bad = validateCreateField(f);
      if (bad) problems.push(`${t.name}.${bad}`);
    }
    // 🔴 先頭列が primary field になる。primary に使えない型を弾く
    const first = t.fields[0];
    if (first && PRIMARY_FORBIDDEN_TYPES.has(first.type)) {
      problems.push(`${t.name}: primary field に ${first.type} は使えない（先頭列を変えること）`);
    }
  }
  return problems;
}

/**
 * 🔴 production への誤爆を防ぐ最重要チェック。**fail-closed。**
 *
 * 🔴 **比較相手（production の base id）が無ければ、誤爆かどうかを判定できない。**
 *    判定できないまま進むのは「安全弁が無い状態で書き込む」のと同じなので、
 *    その場合も**中止する**（2026-09-12 に fail-open だったのを修正）。
 *
 * 中止する条件:
 *   1. `AIRTABLE_QA_BASE_ID` が未設定 / 形式不正
 *   2. `AIRTABLE_BASE_ID`（production）が未設定 ← 🔴 これが fail-closed の要
 *   3. 対象 base が production base と同じ
 *
 * @returns {string|null} 中止すべき理由。問題なければ null
 */
export function assertNotProduction(qaBaseId, prodBaseId) {
  const qa = typeof qaBaseId === 'string' ? qaBaseId.trim() : '';
  const prod = typeof prodBaseId === 'string' ? prodBaseId.trim() : '';

  if (!qa) return '対象 base（AIRTABLE_QA_BASE_ID）が未設定';
  if (!/^app[A-Za-z0-9]+$/.test(qa)) return '対象 base の形式が不正';

  // 🔴 fail-closed: 比較相手が無い＝誤爆チェックが成立しない
  if (!prod) {
    return 'production base（AIRTABLE_BASE_ID）が未設定。'
      + '誤爆チェックが成立しないので中止する（production と同じ base かどうか判定できない）';
  }

  if (qa === prod) return '対象が production base と同じ。中止する';
  return null;
}

async function main() {
  if (!KEY) fail('AIRTABLE_API_KEY が未設定');
  const bad = assertNotProduction(QA, PROD);
  if (bad) fail(bad);

  // 🔴 ネットワークへ出る前に payload を検証する。
  //    1 テーブル作った所で 422 で止まり base が中途半端に残る事故を防ぐ。
  const schemaProblems = validateCreateSchema(TABLES);
  if (schemaProblems.length) {
    fail(`作成 payload が Metadata API の仕様に合わない:\n   - ${schemaProblems.join('\n   - ')}`);
  }

  console.log(`\n🔧 QA base bootstrap — mode: ${APPLY ? 'apply' : 'dry-run'}`);
  console.log(`   対象 base : ${QA.slice(0, 6)}…（production とは別であることを確認済み）\n`);

  const res = await fetch(`${API}/${QA}/tables`, { headers: { Authorization: `Bearer ${KEY}` } });
  if (!res.ok) fail(`対象 base の schema を読めない (${res.status})。PAT に対象 base への schema 権限があるか確認`);
  const actualTables = (await res.json()).tables;
  const existing = new Map(actualTables.map((t) => [t.name, t]));

  if (CHECK) {
    const { ok, report } = diffSchema(TABLES, actualTables);
    console.log('   本番と同じ形か照合（read-only）\n');
    for (const r of report) {
      console.log(`  ${r.ok ? '✅' : '🔴'} ${r.table.padEnd(20)} primary=${r.primaryName ?? '(無)'}${r.primaryOk === false ? ` 🔴 期待 ${r.wantPrimary}` : ''}`);
      if (r.missing?.length) console.log(`      🔴 不足: ${r.missing.join(' / ')}`);
      for (const m of r.mismatched || []) console.log(`      🔴 ${m}`);
      if (r.extra?.length) console.log(`      🟡 本番に無い列（許容）: ${r.extra.join(' / ')}`);
    }
    console.log(`\n  テーブル ${TABLES.length} / 期待する列 合計 ${TABLES.reduce((s, t) => s + t.fields.length, 0)}`);
    console.log(`  実際のテーブル ${actualTables.length} / 列 合計 ${actualTables.reduce((s, t) => s + t.fields.length, 0)}`);

    // 🔴 レコードが 0 件であることの確認（production を複製していないことの裏取り）
    let total = 0;
    for (const t of TABLES) {
      const rr = await fetch(`https://api.airtable.com/v0/${QA}/${encodeURIComponent(t.name)}?maxRecords=3`,
        { headers: { Authorization: `Bearer ${KEY}` } });
      if (!rr.ok) { console.log(`  🟡 ${t.name} の件数を確認できない (${rr.status})`); continue; }
      const n = ((await rr.json()).records || []).length;
      total += n;
      console.log(`  ${n === 0 ? '✅' : '🔴'} ${t.name.padEnd(20)} レコード ${n === 0 ? '0 件' : `${n} 件以上ある`}`);
    }
    if (total > 0) console.log('\n  🔴 レコードがある。production base を複製していないか確認すること。');

    console.log(ok && total === 0 ? '\n✅ 本番と同じスキーマ・レコード 0 件。' : '\n🔴 上の指摘を確認すること。');
    if (!ok || total > 0) process.exit(1);
    return;
  }

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
      // 🔴 原因の特定に要るので type と message の両方を出す。
      //    Airtable のエラー本文に secret は含まれない。
      let detail = '';
      try {
        const j = await created.json();
        const type = j?.error?.type ? String(j.error.type) : '';
        const msg = j?.error?.message ? String(j.error.message) : '';
        detail = [type, msg].filter(Boolean).join(': ').slice(0, 300);
      } catch { /* status で足りる */ }
      fail(`${table.name} の作成に失敗 (${created.status}${detail ? ` ${detail}` : ''})`
        + '\n   🔴 列の options が作成時の仕様に合っていない可能性がある。'
        + '\n      docs/QA_STRIPE_TESTMODE_RUNBOOK.md と validateCreateField() を確認すること。');
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
