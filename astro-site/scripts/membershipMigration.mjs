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
 * 使い方:
 *   node scripts/membershipMigration.mjs --check     # 読み取りのみ。現状監査
 *   node scripts/membershipMigration.mjs --dry-run   # 書く予定の内容を出すだけ（既定）
 *   node scripts/membershipMigration.mjs --apply --confirm-write   # 🔴 承認後のみ
 *
 * 🔴 このスクリプトは **既存列（PlanType / Status / AccessEnabled）を一切変更しない**。
 *    触ってよいのは membership 用に追加した列だけ。
 */

import { CUSTOMER_FIELDS, LEDGER_TABLE, LEDGER_FIELDS } from '../src/lib/membership/airtableStore.js';

const API = 'https://api.airtable.com/v0';
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);

const MODE = has('--check') ? 'check' : (has('--apply') ? 'apply' : 'dry-run');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const CUSTOMERS = process.env.AIRTABLE_TABLE_NAME || 'Customers';

/** 有料とみなす PlanType（`tiers.js` の planTypeToTier と同じ集合）。 */
const PAID_PLAN_TYPES = new Set(['premium', 'pro', 'pro-plus', 'light']);

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

  // --- 列の有無（実データから判定。Meta API は権限が要るため使わない） ---
  const present = new Set();
  for (const r of rows) for (const k of Object.keys(r.fields || {})) present.add(k);

  console.log('=== 追加が必要な列（Customers）===');
  const missingCols = [];
  for (const [k, name] of Object.entries(CUSTOMER_FIELDS)) {
    const ok = present.has(name);
    if (!ok) missingCols.push(name);
    console.log(`  ${ok ? '✅ 済' : '⬜ 未'}  ${name}  (${k})`);
  }

  const ledger = await listAll(LEDGER_TABLE);
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
    console.log(`  必要な列: ${Object.values(LEDGER_FIELDS).join(' / ')}`);
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
  const planned = [];
  for (const r of paid) {
    const f = r.fields || {};
    if (f[CUSTOMER_FIELDS.STARTED_AT]) continue;   // 既に入っている
    if (!f.CreatedAt) continue;                    // 🔴 推測で埋めない
    planned.push({ id: r.id, hash: await maskEmail(f.Email), value: f.CreatedAt });
  }

  console.log(`\n=== 書き込み予定 ${planned.length} 件（${CUSTOMER_FIELDS.STARTED_AT} のみ）===`);
  for (const p of planned) console.log(`    ${p.hash}  ← ${String(p.value).slice(0, 10)}`);
  console.log('  🔴 既存列（PlanType / Status / AccessEnabled）には触れない');

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
