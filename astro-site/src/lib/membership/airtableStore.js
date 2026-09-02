/**
 * airtableStore.js — 会員継続制度の Airtable アダプタ
 *
 * 正本: docs/MEMBERSHIP_DATA_MIGRATION.md
 *
 * 🔴 **本番にはまだ列もテーブルも無い。** そのため既定では使われない
 *    （`store.js` の `resolveMembershipStore` が `MEMBERSHIP_WRITE_ENABLED` を見る）。
 *
 * 🔴 **列が無い状態で書きに行かないこと。**
 *    Airtable は未知フィールドへの書き込みで **リクエスト全体を 422 で失敗させる**。
 *    そのため本アダプタは:
 *      - 未知フィールド / テーブル無しを検出したら **`unavailable` を返して以後書きに行かない**
 *      - 例外を投げない（呼び出し側の描画を巻き添えにしない）
 *      - Airtable のエラー本文を呼び出し側へ返さない（内部情報を漏らさない）
 *
 * 🔴 **既存の列（PlanType / Status / AccessEnabled）には一切触らない。**
 *    これらは有料会員の閲覧権限そのもの。触ると会員が買い目を見られなくなる。
 *    本アダプタが書くのは membership 用に追加した列と台帳テーブルだけ。
 */

import { STORE_RESULT } from './store.js';
import { createContractPrice } from './priceLock.js';

/** Customers 側に追加する列（§2.1）。**既存列はここに含めない。** */
export const CUSTOMER_FIELDS = Object.freeze({
  STARTED_AT: 'MembershipStartedAt',
  CANCELLED_AT: 'CancelledAt',
  PRICE_YEN: 'ContractPriceYen',
  PRICE_ID: 'ContractPriceId',
  CURRENCY: 'ContractCurrency',
  PRICE_STARTED_AT: 'ContractStartedAt',
});

/** リワード台帳テーブル（§2.2）。 */
export const LEDGER_TABLE = 'RewardLedger';
export const LEDGER_FIELDS = Object.freeze({
  ENTRY_ID: 'EntryId',
  EMAIL: 'Email',
  TYPE: 'Type',
  POINTS: 'Points',
  OCCURRED_AT: 'OccurredAt',
  SOURCE_REF: 'SourceRef',
});

const API = 'https://api.airtable.com/v0';

/** スキーマがまだ無いことを示す理由。**これを受け取ったら書きに行かない。** */
export const SCHEMA_MISSING = 'schema_missing';

const normEmail = (v) => String(v || '').trim().toLowerCase();
const escapeFormula = (v) => String(v).replace(/"/g, '\\"');

/**
 * Airtable の応答から「スキーマがまだ無い」を判定する。
 * - 422 UNKNOWN_FIELD_NAME … 列が無い
 * - 404 / NOT_FOUND / TABLE_NOT_FOUND … テーブルが無い
 */
function isSchemaMissing(status, bodyText) {
  if (status === 404) return true;
  if (status !== 422) return false;
  const t = String(bodyText || '');
  return t.includes('UNKNOWN_FIELD_NAME') || t.includes('TABLE_NOT_FOUND');
}

/**
 * 日付だけの列（`Date (ISO)`）へ入れる値を作る。
 *
 * 🔴 Airtable の **date 型（時刻なし）** に ISO の日時を送ると
 *    `422 INVALID_VALUE_FOR_COLUMN` で拒否される（2026-09-02 に発生）。
 *    列の型は `docs/MEMBERSHIP_DATA_MIGRATION.md` §2.1 / §2.2 で
 *    `Date (ISO)` と定められており、**送る側を合わせる**のが正しい。
 * 🔴 `typecast: true` は使わない（勝手な変換を許すと別の列も静かに壊れる）。
 *
 * 🔴 日付の切り方は **Asia/Tokyo**。
 *    日本向けサービスであり、画面表示も JST。UTC で切ると
 *    JST 早朝の支払いが前日になり、月境界で「今月の積み上げ」がずれる。
 *
 * @param {number|string|null} value  ミリ秒 または ISO 文字列
 * @returns {string|null} `YYYY-MM-DD`。判断できなければ null（＝書かない）
 */
export const AIRTABLE_DATE_TIME_ZONE = 'Asia/Tokyo';

export function toAirtableDate(value) {
  const ms = typeof value === 'number' ? value : Date.parse(String(value || ''));
  if (!Number.isFinite(ms)) return null;
  // en-CA は YYYY-MM-DD 形式
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: AIRTABLE_DATE_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms));
}

/**
 * 応答から「原因を特定できる短い符号」を作る。
 *
 * 🔴 本文をそのまま出さない。Airtable のエラー本文は
 *    フィールド名や値を含むことがある（例: 不正な値をそのまま echo する）。
 *    ここで取るのは **HTTP status と `error.type`（機械可読な短い符号）だけ**。
 * 🔴 `error.message` は使わない（値が混ざるため）。
 *
 * 例: `403:INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND` / `429` / `422:INVALID_VALUE_FOR_COLUMN`
 */
export function errorCodeFrom(status, bodyText) {
  const code = Number.isFinite(status) ? String(status) : 'unknown';
  let type = '';
  try {
    const j = JSON.parse(String(bodyText || ''));
    const e = j && j.error;
    const t = typeof e === 'string' ? e : (e && e.type) || '';
    // 英数と _ - . のみ。長さも制限する（値が紛れ込む余地を残さない）
    type = String(t).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60);
  } catch {
    /* JSON でなければ status だけで判断する */
  }
  return type ? `${code}:${type}` : code;
}

/**
 * Airtable アダプタを作る。
 *
 * @param {object} o
 * @param {string} o.apiKey   🔴 値をログ・戻り値へ出さない
 * @param {string} o.baseId
 * @param {string} [o.customersTable]
 * @param {Function} [o.fetchImpl] テスト用に差し替える
 */
export function createAirtableMembershipStore({
  apiKey, baseId, customersTable = 'Customers', fetchImpl,
} = {}) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!apiKey || !baseId || !doFetch) {
    return null; // 呼び出し側が disabled store へ倒す
  }

  /** スキーマ欠落を一度でも検出したら以後は触らない（何度も 422 を出さない）。 */
  let schemaMissing = false;

  const unavailable = (reason) => Object.freeze({ status: STORE_RESULT.UNAVAILABLE, reason, writes: 0 });

  async function call(path, { method = 'GET', body } = {}) {
    const res = await doFetch(`${API}/${baseId}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (res.ok) return { ok: true, data: await res.json() };

    // 🔴 本文は判定にだけ使い、呼び出し側へは返さない
    let text = '';
    try { text = await res.text(); } catch { /* 読めなくても判定は続ける */ }
    if (isSchemaMissing(res.status, text)) schemaMissing = true;
    return {
      ok: false,
      status: res.status,
      schemaMissing: isSchemaMissing(res.status, text),
      // 🔴 原因を追えるだけの符号。本文・値は含めない
      code: errorCodeFrom(res.status, text),
    };
  }

  async function findCustomer(email) {
    const formula = encodeURIComponent(`LOWER({Email}) = "${escapeFormula(normEmail(email))}"`);
    const r = await call(`${encodeURIComponent(customersTable)}?maxRecords=1&filterByFormula=${formula}`);
    if (!r.ok) return null;
    return r.data.records?.[0] || null;
  }

  return Object.freeze({
    kind: 'airtable',
    enabled: true,
    reason: null,
    /** 移行前かどうか（`--check` から参照する） */
    isSchemaMissing: () => schemaMissing,

    async readProfile(email) {
      if (schemaMissing) return Object.freeze({ status: STORE_RESULT.UNAVAILABLE, reason: SCHEMA_MISSING, profile: null });
      try {
        const rec = await findCustomer(email);
        if (!rec) return Object.freeze({ status: STORE_RESULT.UNAVAILABLE, reason: 'customer_not_found', profile: null });

        const f = rec.fields || {};
        // 🔴 列がまだ無ければ値は入ってこない → null のまま（推測で埋めない）
        const contract = createContractPrice({
          amountYen: f[CUSTOMER_FIELDS.PRICE_YEN],
          currency: f[CUSTOMER_FIELDS.CURRENCY],
          priceId: f[CUSTOMER_FIELDS.PRICE_ID],
          startedAtIso: f[CUSTOMER_FIELDS.PRICE_STARTED_AT],
        });

        return Object.freeze({
          status: STORE_RESULT.APPLIED,
          reason: null,
          recordId: rec.id,
          profile: Object.freeze({
            membershipStartedAtIso: f[CUSTOMER_FIELDS.STARTED_AT] || null,
            cancelledAtIso: f[CUSTOMER_FIELDS.CANCELLED_AT] || null,
            contractPrice: contract,
          }),
        });
      } catch {
        return Object.freeze({ status: STORE_RESULT.UNAVAILABLE, reason: 'read_failed:exception', profile: null });
      }
    },

    async readLedger(email) {
      if (schemaMissing) return Object.freeze({ status: STORE_RESULT.UNAVAILABLE, reason: SCHEMA_MISSING, entries: null });
      try {
        const formula = encodeURIComponent(`LOWER({${LEDGER_FIELDS.EMAIL}}) = "${escapeFormula(normEmail(email))}"`);
        const r = await call(`${encodeURIComponent(LEDGER_TABLE)}?pageSize=100&filterByFormula=${formula}`);
        if (!r.ok) {
          return Object.freeze({
            status: STORE_RESULT.UNAVAILABLE,
            reason: r.schemaMissing ? SCHEMA_MISSING : `read_failed:${r.code}`,
            entries: null,
          });
        }
        const entries = (r.data.records || []).map((rec) => {
          const f = rec.fields || {};
          const at = Date.parse(f[LEDGER_FIELDS.OCCURRED_AT]);
          return {
            entryId: f[LEDGER_FIELDS.ENTRY_ID],
            type: f[LEDGER_FIELDS.TYPE],
            points: f[LEDGER_FIELDS.POINTS],
            occurredAtMs: Number.isFinite(at) ? at : NaN,
            ref: f[LEDGER_FIELDS.SOURCE_REF] || null,
          };
        });
        // 🔴 壊れた行は `rewards.js` の isValidEntry が集計から外す（ここでは捨てない）
        return Object.freeze({ status: STORE_RESULT.APPLIED, reason: null, entries: Object.freeze(entries) });
      } catch {
        return Object.freeze({ status: STORE_RESULT.UNAVAILABLE, reason: 'read_failed:exception', entries: null });
      }
    },

    /**
     * 台帳へ 1 行追記する。**冪等**（同じ `entryId` があれば書かない）。
     */
    async appendEntry(email, entry) {
      if (schemaMissing) return unavailable(SCHEMA_MISSING);
      if (!entry || typeof entry.entryId !== 'string' || !entry.entryId) return unavailable('invalid_entry');
      try {
        const formula = encodeURIComponent(`{${LEDGER_FIELDS.ENTRY_ID}} = "${escapeFormula(entry.entryId)}"`);
        const found = await call(`${encodeURIComponent(LEDGER_TABLE)}?maxRecords=1&filterByFormula=${formula}`);
        if (!found.ok) return unavailable(found.schemaMissing ? SCHEMA_MISSING : `read_failed:${found.code}`);
        if (found.data.records?.length) {
          return Object.freeze({ status: STORE_RESULT.ALREADY, reason: null, writes: 0 });
        }

        const created = await call(encodeURIComponent(LEDGER_TABLE), {
          method: 'POST',
          body: {
            records: [{
              fields: {
                [LEDGER_FIELDS.ENTRY_ID]: entry.entryId,
                [LEDGER_FIELDS.EMAIL]: normEmail(email),
                [LEDGER_FIELDS.TYPE]: entry.type,
                [LEDGER_FIELDS.POINTS]: entry.points,
                [LEDGER_FIELDS.OCCURRED_AT]: toAirtableDate(entry.occurredAtMs),
                ...(entry.ref ? { [LEDGER_FIELDS.SOURCE_REF]: entry.ref } : {}),
              },
            }],
          },
        });
        if (!created.ok) return unavailable(created.schemaMissing ? SCHEMA_MISSING : `write_failed:${created.code}`);
        return Object.freeze({ status: STORE_RESULT.APPLIED, reason: null, writes: 1 });
      } catch {
        return unavailable('write_failed:exception');
      }
    },

    /**
     * 契約価格を保存する。
     * 🔴 **既に入っていれば上書きしない**（加入時の価格を保持するのが制度の目的 M-1）。
     */
    async saveContractPrice(email, contract) {
      if (schemaMissing) return unavailable(SCHEMA_MISSING);
      if (!contract) return unavailable('invalid_contract');
      try {
        const rec = await findCustomer(email);
        if (!rec) return unavailable('customer_not_found');
        if (rec.fields?.[CUSTOMER_FIELDS.PRICE_YEN] != null) {
          return Object.freeze({ status: STORE_RESULT.ALREADY, reason: null, writes: 0 });
        }
        const updated = await call(`${encodeURIComponent(customersTable)}/${rec.id}`, {
          method: 'PATCH',
          body: {
            fields: {
              [CUSTOMER_FIELDS.PRICE_YEN]: contract.amountYen,
              [CUSTOMER_FIELDS.CURRENCY]: contract.currency,
              [CUSTOMER_FIELDS.PRICE_ID]: contract.priceId,
              [CUSTOMER_FIELDS.PRICE_STARTED_AT]: toAirtableDate(contract.startedAtIso),
            },
          },
        });
        if (!updated.ok) return unavailable(updated.schemaMissing ? SCHEMA_MISSING : `write_failed:${updated.code}`);
        return Object.freeze({ status: STORE_RESULT.APPLIED, reason: null, writes: 1 });
      } catch {
        return unavailable('write_failed:exception');
      }
    },
  });
}
