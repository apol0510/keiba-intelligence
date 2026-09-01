#!/usr/bin/env node
/**
 * membershipMigration.mjs — 会員継続制度の移行ツール
 *
 * 正本: docs/MEMBERSHIP_DATA_MIGRATION.md
 *
 * 🔴 **既定は read-only。** 書き込みには 3 つ揃える必要がある（どれか欠けたら実行しない）:
 *      1. `--apply`
 *      2. 環境変数 `MEMBERSHIP_MIGRATION_APPLY=true`
 *      3. `--confirm-write`
 *    これは事故防止であって、承認の代わりではない。
 *    **本番への実行は `CLAUDE.md` の高リスク境界（承認必須）。**
 *
 * 🔴 **`MembershipStartedAt` に書く値は「支払い成功日」**（TBD-9・`MEMBERSHIP_REWARDS.md` §7.6）。
 *    Airtable の `CreatedAt` は **申込日であって支払い成功日ではない**
 *    （銀行振込は pending で作られ、入金確認は手作業のためずれる）。
 *    そのため `CreatedAt` は **候補として表示するだけ**で、自動では書かない。
 *    実際に書くには次のどちらかが要る:
 *      --from-file <path>     … 確認済みの入金日を渡す（推奨）
 *      --accept-created-at    … 🔴 CreatedAt を支払い成功日として扱うことを明示的に引き受ける
 *
 * 使い方:
 *   node scripts/membershipMigration.mjs --check     # 読み取りのみ。現状監査
 *   node scripts/membershipMigration.mjs --dry-run   # 書く予定の内容を出すだけ（既定）
 *   node scripts/membershipMigration.mjs --dry-run --from-file paid-dates.json
 *   node scripts/membershipMigration.mjs --apply --from-file paid-dates.json --confirm-write   # 🔴 承認後のみ
 *
 * paid-dates.json の形式（メールアドレス → 支払い成功日）:
 *   { "member@example.com": "2026-03-24" }
 *
 * 🔴 このスクリプトは **既存列（PlanType / Status / AccessEnabled）を一切変更しない**。
 *    触ってよいのは membership 用に追加した列だけ。
 */

import { createRequire } from 'node:module';
import { CUSTOMER_FIELDS, LEDGER_TABLE, LEDGER_FIELDS } from '../src/lib/membership/airtableStore.js';

const require = createRequire(import.meta.url);

const API = 'https://api.airtable.com/v0';
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);

const MODE = has('--check') ? 'check' : (has('--apply') ? 'apply' : 'dry-run');

/** 確認済みの支払い成功日（`--from-file`）。無ければ空。 */
function loadPaidDates() {
  const i = argv.indexOf('--from-file');
  if (i < 0 || !argv[i + 1]) return null;
  try {
    const { readFileSync } = require('node:fs');
    const raw = JSON.parse(readFileSync(argv[i + 1], 'utf8'));
    const out = new Map();
    for (const [email, date] of Object.entries(raw)) {
      if (typeof date === 'string' && Number.isFinite(Date.parse(date))) {
        out.set(String(email).trim().toLowerCase(), date);
      }
    }
    return out;
  } catch {
    return null;
  }
}

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const CUSTOMERS = process.env.AIRTABLE_TABLE_NAME || 'Customers';

/** 有料とみなす PlanType（`tiers.js` の planTypeToTier と同じ集合）。 */
const PAID_PLAN_TYPES = new Set(['premium', 'pro', 'pro-plus', 'light']);

/**
 * 入金確認日の逆算に使う期間（月数）。
 *
 * 🔴 根拠: `netlify/functions/send-payment-confirmation-auto.js` の
 *    `calculateExpirationDate(planType)` が **入金確認時に**
 *    `ExpirationDate = その日 + 期間` を書き込んでいる。
 *    したがって `ExpirationDate − 期間 = 入金確認日` が復元できる。
 *    （推測ではなく、書き込み側のコードから導ける値である）
 */
function termMonthsFor(planType) {
  switch (planType) {
    case 'lifetime': return null;   // 2099-12-31 固定なので逆算できない
    case 'yearly': return 12;
    case 'light':
    case 'monthly-nankan':
    case 'monthly-jra': return 1;
    default: return null;           // 🔴 既定へ丸めない（不明は不明のまま）
  }
}

/** ISO 日付から nか月前を求める（日の繰り上がりを起こさない）。 */
function minusMonths(iso, months) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getUTCDate();
  const base = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, 1));
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(day, lastDay));
  return base.toISOString().slice(0, 10);
}

/**
 * 会員レコードから **入金確認日の候補**を導く。
 *
 * 🔴 推測しない。導けるのは次をすべて満たすときだけ:
 *    - `ExpirationDate`（または `有効期限`）がある
 *    - `plan_type` から期間が確定できる
 *    - 逆算した日が **未来でない**（未来なら手動延長などで書き換わっている）
 *    - 申込日（`CreatedAt`）があるなら、その **0〜60 日後**に収まる
 *      （大きく離れていれば更新後の日付で、初回入金日ではない）
 */
function derivePaidAt(fields, nowIso) {
  const exp = fields.ExpirationDate || fields['有効期限'] || null;
  const planType = fields.plan_type || null;
  if (!exp) return { value: null, reason: 'ExpirationDate なし' };
  if (!planType) return { value: null, reason: 'plan_type なし（期間が確定できない）' };

  const term = termMonthsFor(planType);
  if (term == null) return { value: null, reason: `期間を確定できない plan_type=${planType}` };

  const derived = minusMonths(exp, term);
  if (!derived) return { value: null, reason: 'ExpirationDate が日付として読めない' };
  if (derived > nowIso) return { value: null, reason: `逆算値が未来（${derived}）＝手動延長の可能性` };

  const created = fields.CreatedAt ? String(fields.CreatedAt).slice(0, 10) : null;
  if (created) {
    const gapDays = Math.round((Date.parse(derived) - Date.parse(created)) / 86400000);
    if (gapDays < -1) return { value: null, reason: `逆算値が申込より前（${gapDays}日）＝不整合` };
    if (gapDays > 60) return { value: null, reason: `申込から${gapDays}日後＝更新後の日付の可能性` };
    return { value: derived, reason: `ExpirationDate(${String(exp).slice(0, 10)}) − ${term}か月, 申込+${gapDays}日` };
  }
  return { value: null, reason: '申込日が無く突合できない（要手動確認）' };
}

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
  fail('AIRTABLE_API_KEY / AIRTABLE_BASE_ID が未設定（値は出力しない）');
}

async function airtable(path, init = {}) {
  const res = await fetch(`${API}/${AIRTABLE_BASE_ID}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch { /* noop */ }
    const schemaMissing = res.status === 404
      || (res.status === 422 && (body.includes('UNKNOWN_FIELD_NAME') || body.includes('TABLE_NOT_FOUND')));
    return { ok: false, status: res.status, schemaMissing };
  }
  return { ok: true, data: await res.json() };
}

/**
 * Metadata API で schema を読む（PAT に `schema.bases:read` がある場合）。
 * 🔴 権限が無ければ null を返し、呼び出し側は実データからの推定へ落ちる。
 */
async function fetchSchema() {
  const res = await fetch(`https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}/tables`, {
    headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function listAll(table) {
  const out = [];
  let offset;
  do {
    const q = new URLSearchParams({ pageSize: '100' });
    if (offset) q.set('offset', offset);
    const r = await airtable(`${encodeURIComponent(table)}?${q}`);
    if (!r.ok) return r;
    out.push(...(r.data.records || []));
    offset = r.data.offset;
  } while (offset);
  return { ok: true, records: out };
}

/** 🔴 メールは出力しない。突き合わせ用に短いハッシュだけ出す。 */
async function maskEmail(email) {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(String(email || '')).digest('hex').slice(0, 8);
}

async function main() {
  console.log(`\n🔍 membership migration — mode: ${MODE}`);
  console.log(`   base: ${AIRTABLE_BASE_ID.slice(0, 3)}…  table: ${CUSTOMERS}\n`);

  const customers = await listAll(CUSTOMERS);
  if (!customers.ok) fail(`Customers を読めない (status ${customers.status})`);
  const rows = customers.records;

  // --- 列の有無 ---
  // 🔴 実データからの推定は「値が入っている列」しか見えない。
  //    列を作った直後は全レコードが空なので未検出になる。
  //    そのため schema を読めるならそちらを正とする。
  const schema = await fetchSchema();
  const present = new Set();
  let source = '実データからの推定（schema 読み取り権限なし）';
  if (schema) {
    const t = schema.tables.find((x) => x.name === CUSTOMERS);
    if (t) {
      for (const f of t.fields) present.add(f.name);
      source = 'Metadata API（schema.bases:read）';
    }
  }
  if (!schema) {
    for (const r of rows) for (const k of Object.keys(r.fields || {})) present.add(k);
  }

  console.log(`=== 追加が必要な列（Customers）===  [判定元: ${source}]`);
  const missingCols = [];
  for (const [k, name] of Object.entries(CUSTOMER_FIELDS)) {
    const ok = present.has(name);
    if (!ok) missingCols.push(name);
    console.log(`  ${ok ? '✅ 済' : '⬜ 未'}  ${name}  (${k})`);
  }

  const ledger = await listAll(LEDGER_TABLE);
  const ledgerSchema = schema?.tables.find((x) => x.name === LEDGER_TABLE) || null;
  console.log(`\n=== 台帳テーブル ${LEDGER_TABLE} ===`);
  if (ledger.ok) {
    console.log(`  ✅ 存在（${ledger.records.length} 行）`);
  } else if (ledger.status === 403) {
    // 🔴 Airtable は「テーブルが無い」と「トークンに権限が無い」をどちらも 403 で返しうる。
    //    テーブルを作っただけでは足りず、**PAT のアクセス範囲の確認**も要る。
    console.log('  ⬜ 未作成、または PAT にこのテーブルへのアクセス権が無い (403)');
    console.log('     → 作成後、同じ --check で ✅ になることを必ず確認すること');
  } else {
    console.log(`  ⬜ 未作成 / 読めない (status ${ledger.status})`);
  }
  if (ledger.ok) {
    if (ledgerSchema) {
      const have = new Set(ledgerSchema.fields.map((f) => f.name));
      const missing = Object.values(LEDGER_FIELDS).filter((n) => !have.has(n));
      console.log(`  列: ${[...have].join(' / ')}`);
      console.log(missing.length ? `  🔴 不足: ${missing.join(' / ')}` : '  ✅ 必要な列はそろっている');
    } else {
      console.log(`  必要な列: ${Object.values(LEDGER_FIELDS).join(' / ')}`);
    }
  }

  // --- backfill 対象 ---
  const paid = rows.filter((r) => PAID_PLAN_TYPES.has(String(r.fields?.PlanType || '').toLowerCase()));
  const withCreatedAt = paid.filter((r) => r.fields?.CreatedAt);
  const alreadySet = paid.filter((r) => r.fields?.[CUSTOMER_FIELDS.STARTED_AT]);

  console.log('\n=== backfill 対象（MembershipStartedAt）===');
  console.log(`  会員レコード総数        : ${rows.length}`);
  console.log(`  有料会員（backfill 対象）: ${paid.length}`);
  console.log(`    うち CreatedAt あり     : ${withCreatedAt.length}  ← 自動で埋められる`);
  console.log(`    うち CreatedAt なし     : ${paid.length - withCreatedAt.length}  🔴 手動確認が必要（推測で埋めない）`);
  console.log(`    うち設定済み            : ${alreadySet.length}`);

  console.log('\n  --- 内訳（メールはハッシュ）---');
  for (const r of paid) {
    const f = r.fields || {};
    const id = await maskEmail(f.Email);
    const src = f.CreatedAt ? `CreatedAt=${String(f.CreatedAt).slice(0, 10)}` : '🔴 起点不明';
    console.log(`    ${id}  ${String(f.PlanType).padEnd(8)} ${String(f.PaymentMethod || '-').padEnd(14)} ${src}`);
  }

  if (MODE === 'check') {
    console.log('\n✅ read-only の監査のみ実行した。書き込みは行っていない。');
    return;
  }

  // --- 書く予定の内容 ---
  // 🔴 起点は「支払い成功日」。CreatedAt（申込日）は候補にすぎない（TBD-9・§7.6）
  const paidDates = loadPaidDates();
  const acceptCreatedAt = has('--accept-created-at');

  const nowIso = new Date().toISOString().slice(0, 10);
  const planned = [];
  const needsConfirmation = [];
  const unknownList = [];
  for (const r of paid) {
    const f = r.fields || {};
    if (f[CUSTOMER_FIELDS.STARTED_AT]) continue;   // 既に入っている
    const hash = await maskEmail(f.Email);
    const confirmed = paidDates?.get(String(f.Email || '').trim().toLowerCase());
    const derived = derivePaidAt(f, nowIso);

    if (confirmed) {
      planned.push({ id: r.id, hash, value: confirmed, source: '確認済み(--from-file)' });
    } else if (derived.value) {
      // 🔴 入金確認処理のコードから逆算できた値。根拠を必ず併記する
      planned.push({ id: r.id, hash, value: derived.value, source: `逆算: ${derived.reason}` });
    } else if (f.CreatedAt && acceptCreatedAt) {
      planned.push({ id: r.id, hash, value: f.CreatedAt, source: '申込日(--accept-created-at)' });
    } else if (f.CreatedAt) {
      needsConfirmation.push({ hash, candidate: f.CreatedAt, why: derived.reason });
    } else {
      unknownList.push({ hash, why: derived.reason });
    }
  }

  console.log(`\n=== 書き込み予定 ${planned.length} 件（${CUSTOMER_FIELDS.STARTED_AT} のみ）===`);
  console.log('    根拠: send-payment-confirmation-auto.js が入金確認時に');
  console.log('          ExpirationDate = その日 + 期間 を書いている → 逆算で入金確認日が復元できる');
  for (const p of planned) {
    console.log(`    ${p.hash}  ← ${String(p.value).slice(0, 10)}`);
    console.log(`               ${p.source}`);
  }
  if (needsConfirmation.length) {
    console.log(`\n=== 🔴 手動確認が必要 ${needsConfirmation.length} 件（このままでは書かない）===`);
    for (const p of needsConfirmation) {
      console.log(`    ${p.hash}  申込日=${String(p.candidate).slice(0, 10)}  理由: ${p.why}`);
    }
    console.log('    --from-file で確認済みの入金日を渡すこと（--accept-created-at は申込日で妥協する場合のみ）。');
  }
  if (unknownList.length) {
    console.log(`\n=== 🔴 起点不明 ${unknownList.length} 件（空のままにする）===`);
    for (const p of unknownList) console.log(`    ${p.hash}  理由: ${p.why}`);
    console.log('    推測で埋めない。0 か月（Bronze）でも埋めない。画面は「準備中」になる。');
  }
  console.log('\n  🔴 既存列（PlanType / Status / AccessEnabled）には触れない');

  if (MODE === 'dry-run') {
    console.log('\n✅ dry-run。書き込みは行っていない。');
    return;
  }

  // --- ここから先は書き込み（3 条件が揃わなければ実行しない）---
  if (missingCols.length) {
    fail(`列が未作成のため実行できない: ${missingCols.join(', ')}（先に列を追加すること）`);
  }
  if (process.env.MEMBERSHIP_MIGRATION_APPLY !== 'true') {
    fail('MEMBERSHIP_MIGRATION_APPLY=true が無い（事故防止）');
  }
  if (!has('--confirm-write')) {
    fail('--confirm-write が無い（事故防止）');
  }

  console.log('\n✍️  書き込みを開始する');
  let written = 0;
  for (let i = 0; i < planned.length; i += 10) {
    const chunk = planned.slice(i, i + 10);
    const r = await airtable(encodeURIComponent(CUSTOMERS), {
      method: 'PATCH',
      body: JSON.stringify({
        records: chunk.map((p) => ({ id: p.id, fields: { [CUSTOMER_FIELDS.STARTED_AT]: p.value } })),
      }),
    });
    if (!r.ok) fail(`書き込み失敗 (status ${r.status})。ここまで ${written} 件`);
    written += chunk.length;
  }
  console.log(`✅ ${written} 件を更新した`);
  console.log('   rollback: 同じ列を空にすれば戻る（既存列は触っていない）');
}

main().catch((e) => fail(`予期しない失敗: ${e?.name || 'Error'}`));
