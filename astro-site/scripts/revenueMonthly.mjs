/**
 * revenueMonthly.mjs — 月間売上の measurement（KAO D-158・`kao.revenue-month/v1`）を作る（read-only）
 *
 * 目的: KI の月間売上 100 万円以上を「継続して」達成しているかを、毎月の実額で測る。
 *       KAO が `docs/measurements/revenue-YYYY-MM-01.json` を読み、MK report の「事業成果」節に出す
 *       （契約: keiba-agent-orchestrator `docs/business-kpi.md`）。
 *
 * 🔴 **read-only。** Stripe・Airtable へ書き込まない（GET だけ）。
 * 🔴 **集計値だけを出す。** 顧客・メール・charge id・invoice id・金額の明細は出さない。
 * 🔴 **fail-closed。** 取得失敗を「売上 0 円」として書かない（exit 1・file を書かない）。
 *
 * 売上の正本は Stripe（CLAUDE.md「請求額の正本は Stripe の Price」）。
 *   gross   = 対象月（JST）に成功した charge の `amount_captured`（JPY は 0 桁通貨）
 *   refunds = 対象月（JST）に作られた refund の `amount`（status succeeded / pending）
 *   net     = gross − refunds
 * ⚠️ 年払いの銀行振込は入金日時の記録が無く、月に割り当てられない → **未計上**として data_quality に明記する。
 *
 * 使い方:
 *   STRIPE_SECRET_KEY=… node scripts/revenueMonthly.mjs --month 2026-09 [--out ../docs/measurements/revenue-2026-09-01.json]
 *   （--month 省略時は JST の前月）
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const SCHEMA = 'kao.revenue-month/v1';
export const TARGET_JPY = 1_000_000;
export const REPO = 'keiba-intelligence';
const STRIPE_API = 'https://api.stripe.com/v1';
const JST_OFFSET_MS = 9 * 3600 * 1000;
const MAX_PAGES = 200;

export class RevenueError extends Error {}

/** 'YYYY-MM' → JST の月初〜翌月初（unix 秒）。 */
export function monthRangeJst(month) {
  const m = /^(20\d{2})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) throw new RevenueError(`month must be YYYY-MM: ${month}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const start = Date.UTC(y, mo - 1, 1) - JST_OFFSET_MS;
  const end = Date.UTC(mo === 12 ? y + 1 : y, mo === 12 ? 0 : mo, 1) - JST_OFFSET_MS;
  return { gte: Math.floor(start / 1000), lt: Math.floor(end / 1000) };
}

/** JST の前月（'YYYY-MM'）。 */
export function previousMonthJst(nowMs = Date.now()) {
  const d = new Date(nowMs + JST_OFFSET_MS);
  const y = d.getUTCMonth() === 0 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
  const m = d.getUTCMonth() === 0 ? 12 : d.getUTCMonth();
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** Stripe の list API を全 page 読む（read-only）。 */
export async function listAll(path, params, { key, fetchImpl = fetch } = {}) {
  if (!key) throw new RevenueError('STRIPE_SECRET_KEY is not set');
  const out = [];
  let startingAfter;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const q = new URLSearchParams({ ...params, limit: '100' });
    if (startingAfter) q.set('starting_after', startingAfter);
    const res = await fetchImpl(`${STRIPE_API}/${path}?${q}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new RevenueError(`stripe ${path} failed: HTTP ${res.status}`);
    const body = await res.json();
    if (!body || !Array.isArray(body.data)) throw new RevenueError(`stripe ${path}: unexpected response`);
    out.push(...body.data);
    if (!body.has_more || body.data.length === 0) return out;
    startingAfter = body.data[body.data.length - 1].id;
  }
  throw new RevenueError(`stripe ${path}: too many pages`);
}

/** charge / refund の一覧から月の集計値（JPY 以外があれば fail-closed）。 */
export function summarize(charges, refunds) {
  let gross = 0;
  let payments = 0;
  for (const c of charges) {
    if (c.status !== 'succeeded' || !c.paid) continue;
    if (String(c.currency).toLowerCase() !== 'jpy') throw new RevenueError('non-JPY charge found');
    gross += Number(c.amount_captured ?? c.amount ?? 0);
    payments += 1;
  }
  let refunded = 0;
  for (const r of refunds) {
    if (r.status !== 'succeeded' && r.status !== 'pending') continue;
    if (String(r.currency).toLowerCase() !== 'jpy') throw new RevenueError('non-JPY refund found');
    refunded += Number(r.amount ?? 0);
  }
  return { gross, refunded, net: gross - refunded, payments };
}

/** 既存の measurement から、当月を含む連続達成月数を数える。 */
export function sustainedMonths(month, netJpy, previous) {
  if (netJpy < TARGET_JPY) return 0;
  let streak = 1;
  let cursor = month;
  for (;;) {
    const [y, m] = cursor.split('-').map(Number);
    cursor = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    const prev = previous.get(cursor);
    if (prev === undefined || !(prev >= TARGET_JPY)) return streak;
    streak += 1;
  }
}

/** docs/measurements の既存 revenue file（month → net_jpy）。 */
export function readPrevious(dir) {
  const out = new Map();
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (!/^revenue-20\d{2}-\d{2}-01\.json$/.test(name)) continue;
    try {
      const doc = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      if (doc.schema === SCHEMA && typeof doc.month === 'string' && typeof doc.net_jpy === 'number') out.set(doc.month, doc.net_jpy);
    } catch { /* 壊れた file は連続月数に数えない */ }
  }
  return out;
}

export async function buildRevenueMonth({ month, key, fetchImpl, previous = new Map(), nowMs = Date.now() }) {
  const range = monthRangeJst(month);
  const params = { 'created[gte]': String(range.gte), 'created[lt]': String(range.lt) };
  const charges = await listAll('charges', params, { key, fetchImpl });
  const refunds = await listAll('refunds', params, { key, fetchImpl });
  const s = summarize(charges, refunds);
  return {
    schema: SCHEMA,
    repo: REPO,
    month,
    currency: 'JPY',
    generatedAt: new Date(nowMs).toISOString(),
    target_jpy: TARGET_JPY,
    gross_jpy: s.gross,
    refunds_jpy: s.refunded,
    net_jpy: s.net,
    by_channel: { stripe: { net_jpy: s.net, payments: s.payments } },
    achieved: s.net >= TARGET_JPY,
    sustained_months: sustainedMonths(month, s.net, previous),
    data_quality: ['年払いの銀行振込は入金日時の記録が無いため未計上（Stripe のみ）'],
    next_tasks: [],
  };
}

async function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const month = arg('--month') ?? previousMonthJst();
  const out = arg('--out');
  const doc = await buildRevenueMonth({
    month, key: process.env.STRIPE_SECRET_KEY,
    previous: out ? readPrevious(dirname(out)) : new Map(),
  });
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, text);
    console.log(JSON.stringify({ status: 'ok', month, out, achieved: doc.achieved }));
  } else {
    process.stdout.write(text);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((e) => {
    // 🔴 例外文に secret を含めない（HTTP status と理由だけ）
    console.error(JSON.stringify({ status: 'error', reason: e instanceof RevenueError ? e.message : 'unexpected' }));
    process.exit(1);
  });
}
