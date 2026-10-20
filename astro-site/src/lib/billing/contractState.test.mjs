/**
 * contractState.test.mjs — 契約が終わった元会員にマイページで「いつ終わったか」を示す（表示専用）
 *
 * 正本: docs/measurements/CONTRACT_ENDED_VISIBILITY_2026_10.md
 *
 * 固定すること:
 *   1. active は paidEntitlement.customerSessionTier と必ず一致（権限の判定を複製・変更しない）
 *   2. lapsed（有料・契約中 Status のまま期限切れ）/ ended（inactive・解約日あり）/ none を区別し、終了日は JST
 *   3. 文言は固定（値引き・期限煽りなし）。導線は既存の /pricing 1 つ
 *   4. 読み取りは本人の email だけ・失敗は null・返す列は契約列だけ
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { contractState, contractEndedNotice, toJstDate, CONTRACT_STATE } from './contractState.js';
import { readContractFields, CONTRACT_FIELD_NAMES } from './contractFields.js';
import { customerSessionTier } from '../auth/paidEntitlement.js';
import { TIER, tierAtLeast } from '../auth/tiers.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, '..', '..', '..', p), 'utf8');
const NOW = Date.parse('2026-10-20T03:00:00Z');
const PAST = '2026-10-15';
const FUTURE = '2026-12-01';

describe('contractState', () => {
  test('active: 有料 PlanType・active・期限なし / 未来', () => {
    assert.deepEqual(contractState({ PlanType: 'premium', Status: 'active' }, NOW), { state: 'active', endedOn: null });
    assert.deepEqual(contractState({ PlanType: 'premium', Status: 'payment_failed', ExpirationDate: FUTURE }, NOW), { state: 'active', endedOn: null });
  });

  test('lapsed: 有料・Status active のまま有効期限が過去 → 終了日は有効期限', () => {
    assert.deepEqual(contractState({ PlanType: 'premium', Status: 'active', ExpirationDate: PAST }, NOW), { state: 'lapsed', endedOn: PAST });
    assert.deepEqual(contractState({ PlanType: 'premium', Status: 'active', '有効期限': PAST }, NOW), { state: 'lapsed', endedOn: PAST });
    assert.deepEqual(contractState({ PlanType: 'premium', Status: 'payment_failed', ExpirationDate: '2026-09-30T14:59:59.000Z' }, NOW), { state: 'lapsed', endedOn: '2026-09-30' });
  });

  test('ended: inactive / 解約日あり → 終了日は解約日、無ければ過去の有効期限、それも無ければ null', () => {
    assert.deepEqual(contractState({ PlanType: 'free', Status: 'inactive', CancelledAt: '2026-10-07' }, NOW), { state: 'ended', endedOn: '2026-10-07' });
    assert.deepEqual(contractState({ PlanType: 'free', Status: 'inactive' }, NOW), { state: 'ended', endedOn: null });
    assert.deepEqual(contractState({ PlanType: 'premium', Status: 'inactive', ExpirationDate: PAST }, NOW), { state: 'ended', endedOn: PAST });
    assert.deepEqual(contractState({ PlanType: 'free-registered', Status: 'active', CancelledAt: '2026-09-01' }, NOW), { state: 'ended', endedOn: '2026-09-01' });
  });

  test('none: 無料登録・未確認・入金確認前・空・壊れた値', () => {
    for (const f of [
      { PlanType: 'free-registered', Status: 'active' },
      { PlanType: 'free-registered', Status: 'pending' },
      { PlanType: 'premium', Status: 'pending' }, // 銀行振込の入金確認前
      { PlanType: 'premium', Status: 'active', ExpirationDate: 'not-a-date' }, // 読めない期限は推測しない
      {}, null, undefined, 'x',
    ]) {
      assert.deepEqual(contractState(f, NOW), { state: 'none', endedOn: null }, JSON.stringify(f));
    }
  });

  test('🔴 active は customerSessionTier（権限の判定）と必ず一致する', () => {
    const plans = ['premium', 'light', 'free', 'free-registered', '', undefined, 'unknown'];
    const statuses = ['active', 'payment_failed', 'inactive', 'pending', 'cancelled', '', undefined];
    const expiries = [undefined, '', PAST, FUTURE, 'bad'];
    const cancels = [undefined, '2026-10-01'];
    let n = 0;
    for (const PlanType of plans) for (const Status of statuses) for (const ExpirationDate of expiries) for (const CancelledAt of cancels) {
      const f = { PlanType, Status, ExpirationDate, CancelledAt };
      const paid = tierAtLeast(customerSessionTier(f, NOW), TIER.LIGHT);
      const cs = contractState(f, NOW);
      assert.equal(cs.state === CONTRACT_STATE.ACTIVE, paid, JSON.stringify(f));
      assert.ok(Object.values(CONTRACT_STATE).includes(cs.state));
      n += 1;
    }
    assert.equal(n, 490);
  });
});

test('toJstDate: JST の日付・読めない値は null', () => {
  assert.equal(toJstDate('2026-10-15'), '2026-10-15');
  assert.equal(toJstDate('2026-10-15T15:30:00Z'), '2026-10-16');
  for (const bad of ['', '  ', 'x', null, undefined, 1, {}]) assert.equal(toJstDate(bad), null);
});

test('contractEndedNotice: 固定文言（終了日あり / なし）・active と none は出さない', () => {
  assert.equal(contractEndedNotice({ state: 'lapsed', endedOn: '2026-10-05' }), 'ご契約期間は2026年10月5日に終了しました。');
  assert.equal(contractEndedNotice({ state: 'ended', endedOn: '2026-09-30' }), 'ご契約期間は2026年9月30日に終了しました。');
  assert.equal(contractEndedNotice({ state: 'ended', endedOn: null }), '有料プランのご契約期間は終了しました。');
  assert.equal(contractEndedNotice({ state: 'active', endedOn: null }), null);
  assert.equal(contractEndedNotice({ state: 'none', endedOn: null }), null);
  assert.equal(contractEndedNotice(null), null);
  // 🔴 値引き・期限煽り・成績訴求を入れない
  for (const s of ['ended', 'lapsed']) {
    const t = contractEndedNotice({ state: s, endedOn: '2026-10-05' });
    assert.equal(/割引|OFF|%|限定|今だけ|お得|的中|回収/.test(t), false, t);
  }
});

describe('readContractFields（読み取りのみ）', () => {
  const env = { AIRTABLE_API_KEY: 'key_test', AIRTABLE_BASE_ID: 'app_test' };
  const me = ['member', 'example.invalid'].join('@');

  test('本人の email で 1 件だけ読み、契約列だけを返す', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ records: [{ fields: { Email: me, Name: 'テスト', PlanType: 'premium', Status: 'active', ExpirationDate: PAST, Phone: 'x' } }] }) };
    };
    const f = await readContractFields({ email: me, env, fetchImpl });
    assert.deepEqual(f, { PlanType: 'premium', Status: 'active', ExpirationDate: PAST });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, 'GET');
    assert.match(calls[0].url, /\/Customers\?maxRecords=1&filterByFormula=/);
    assert.equal(calls[0].url.includes('fields'), false, 'fields[] で絞らない（列が無い base で 422 になる）');
    for (const k of Object.keys(f)) assert.ok(CONTRACT_FIELD_NAMES.includes(k));
  });

  test('🔴 式インジェクション: 引用符を含む値は形式検証で読まない', async () => {
    let called = false;
    const r = await readContractFields({ email: 'a"),TRUE(),("@x.invalid', env, fetchImpl: async () => { called = true; } });
    assert.equal(r, null);
    assert.equal(called, false);
  });

  test('失敗・設定なし・空は null（例外を投げない）', async () => {
    assert.equal(await readContractFields({ email: me, env: {}, fetchImpl: async () => ({ ok: true }) }), null);
    assert.equal(await readContractFields({ email: me, env, fetchImpl: async () => ({ ok: false, status: 500 }) }), null);
    assert.equal(await readContractFields({ email: me, env, fetchImpl: async () => { throw new Error('net'); } }), null);
    assert.equal(await readContractFields({ email: me, env, fetchImpl: async () => ({ ok: true, json: async () => ({ records: [] }) }) }), null);
  });

  test('タイムアウトで中断して null', async () => {
    const fetchImpl = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('abort'))));
    assert.equal(await readContractFields({ email: me, env, fetchImpl, timeoutMs: 20 }), null);
  });
});

test('mypage.astro: 無料表示のお支払い欄に 1 行だけ・既存の /pricing 導線 1 つのまま', () => {
  const src = read('src/pages/mypage.astro');
  assert.match(src, /const contractNotice = ent\.authenticated && !isPaid && !justWithdrawn && ent\.email\n\s*\? contractEndedNotice\(contractState\(await readContractFields\(\{ email: ent\.email, env: runtimeEnv \}\), Date\.now\(\)\)\)\n\s*: null;/);
  const block = src.slice(src.indexOf('<!-- お支払い -->'), src.indexOf('アカウント管理: 退会'));
  assert.match(block, /\{contractNotice && <p class="mp-contract-ended" id="mp-contract-ended">\{contractNotice\}<\/p>\}\n\s*<p>買い目をご覧いただくには有料プランへのお申し込みが必要です。<\/p>\n\s*<a class="mp-btn mp-btn-primary" href="\/pricing">プランを見る<\/a>/);
  assert.equal((block.match(/href="\/pricing"/g) || []).length, 1, 'CTA を増やさない');
  // 🔴 権限の判定には使わない（contractState の結果で tier / isPaid を変えない）
  assert.equal(/isPaid\s*=.*contract/i.test(src), false);
  assert.equal(/ent\.tier\s*=/.test(src), false);
});

test('🔴 paidEntitlement.js（権限の判定）は呼ぶだけで変えていない', () => {
  const src = read('src/lib/billing/contractState.js');
  assert.match(src, /import \{ customerSessionTier, isPaidPlanType, isPaidStatus, expiryState \} from '\.\.\/auth\/paidEntitlement\.js';/);
  assert.equal(/fetch|update|create/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), false, 'contractState は I/O しない');
});
