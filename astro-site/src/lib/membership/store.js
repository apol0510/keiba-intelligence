/**
 * store.js — 会員継続制度の永続化（**注入可能・既定は fail-closed**）
 *
 * 正本: docs/MEMBERSHIP_REWARDS.md §6 / docs/MEMBERSHIP_DATA_MIGRATION.md
 *
 * 🔴 **Airtable アダプタは実装していない。**
 *    継続月数・契約価格・リワード台帳を置く列／テーブルが **本番にまだ存在しない**ため。
 *    Airtable は未知フィールドへの書き込みでリクエスト全体が失敗するので、
 *    列より先にコードを有効化すると **Stripe webhook のプラン付与まで巻き添えで落ちる**。
 *    列の追加・backfill・有効化の順序と rollback は `docs/MEMBERSHIP_DATA_MIGRATION.md`。
 *
 * 🔴 有効化には **環境変数 `MEMBERSHIP_WRITE_ENABLED=true` と実装済みアダプタの注入の両方**が要る。
 *    どちらか欠ければ `unavailable` を返す。
 *    **「交換できました」「付与しました」と表示しない**（できていないのに完了と出さない）。
 *    `src/lib/unsubscribe/store.js` と同じ考え方。
 */

import { createAirtableMembershipStore } from './airtableStore.js';

export const MEMBERSHIP_WRITE_ENV = 'MEMBERSHIP_WRITE_ENABLED';
/**
 * 読み取りだけを先に有効化するためのフラグ（移行手順 §4 の 3）。
 * 🔴 書き込みには `MEMBERSHIP_WRITE_ENABLED` が別途必要。
 */
export const MEMBERSHIP_READ_ENV = 'MEMBERSHIP_READ_ENABLED';

export const STORE_RESULT = Object.freeze({
  APPLIED: 'applied',
  /** 冪等キーが既にある。書き込みは起きていない */
  ALREADY: 'already',
  /** 🔴 未設定 / 無効 / アダプタ未注入。**成功と区別する** */
  UNAVAILABLE: 'unavailable',
});

const flagOn = (env, name) => {
  const v = (env || {})[name];
  return typeof v === 'string' && v.trim().toLowerCase() === 'true';
};

/** env の書き込み許可フラグ。'true' 以外はすべて無効（fail-closed）。 */
export function isWriteEnabled(env) {
  return flagOn(env, MEMBERSHIP_WRITE_ENV);
}

/** 読み取り許可フラグ。書き込みが有効なら読み取りも当然有効。 */
export function isReadEnabled(env) {
  return flagOn(env, MEMBERSHIP_READ_ENV) || isWriteEnabled(env);
}

/**
 * 読み取りだけを通し、**書き込みは必ず拒否する**ラッパ。
 * 移行手順の「読み取りだけを有効化して本番で確認する」段階で使う。
 */
export function readOnlyMembershipStore(inner) {
  const refuse = () => Object.freeze({
    status: STORE_RESULT.UNAVAILABLE, reason: 'write_disabled', writes: 0,
  });
  return Object.freeze({
    kind: `${inner.kind}:read-only`,
    enabled: true,
    reason: null,
    readProfile: (...a) => inner.readProfile(...a),
    readLedger: (...a) => inner.readLedger(...a),
    async appendEntry() { return refuse(); },
    async saveContractPrice() { return refuse(); },
  });
}

/**
 * 既定の store。**何も保存せず、何も返さない。**
 * 本番はこの状態で動く（列が無いため）。
 */
export function createDisabledMembershipStore(reason = 'not_configured') {
  return Object.freeze({
    kind: 'disabled',
    enabled: false,
    reason,
    async readProfile() {
      return Object.freeze({ status: STORE_RESULT.UNAVAILABLE, reason, profile: null });
    },
    async readLedger() {
      return Object.freeze({ status: STORE_RESULT.UNAVAILABLE, reason, entries: null });
    },
    async appendEntry() {
      return Object.freeze({ status: STORE_RESULT.UNAVAILABLE, reason, writes: 0 });
    },
    async saveContractPrice() {
      return Object.freeze({ status: STORE_RESULT.UNAVAILABLE, reason, writes: 0 });
    },
  });
}

/**
 * in-memory store（**テスト / fixture 専用**）。
 * 冪等: 同一 `entryId` の再実行では write しない。
 */
export function createInMemoryMembershipStore({ profiles = {}, ledgers = {} } = {}) {
  const profileMap = new Map(Object.entries(profiles));
  const ledgerMap = new Map(Object.entries(ledgers).map(([k, v]) => [k, [...v]]));
  const writes = [];

  const key = (email) => String(email || '').trim().toLowerCase();

  return Object.freeze({
    kind: 'in-memory',
    enabled: true,
    reason: null,

    async readProfile(email) {
      const p = profileMap.get(key(email)) || null;
      return Object.freeze({ status: STORE_RESULT.APPLIED, reason: null, profile: p });
    },

    async readLedger(email) {
      const entries = ledgerMap.get(key(email)) || [];
      return Object.freeze({ status: STORE_RESULT.APPLIED, reason: null, entries: Object.freeze([...entries]) });
    },

    async appendEntry(email, entry) {
      if (!entry || typeof entry.entryId !== 'string') {
        return Object.freeze({ status: STORE_RESULT.UNAVAILABLE, reason: 'invalid_entry', writes: writes.length });
      }
      const k = key(email);
      const list = ledgerMap.get(k) || [];
      if (list.some((e) => e.entryId === entry.entryId)) {
        return Object.freeze({ status: STORE_RESULT.ALREADY, reason: null, writes: writes.length });
      }
      list.push(entry);
      ledgerMap.set(k, list);
      writes.push({ kind: 'entry', email: k, entryId: entry.entryId });
      return Object.freeze({ status: STORE_RESULT.APPLIED, reason: null, writes: writes.length });
    },

    async saveContractPrice(email, contract) {
      if (!contract) {
        return Object.freeze({ status: STORE_RESULT.UNAVAILABLE, reason: 'invalid_contract', writes: writes.length });
      }
      const k = key(email);
      const p = profileMap.get(k) || {};
      // 🔴 契約価格は **上書きしない**。契約時の値を保持するのが制度の目的（M-1）。
      if (p.contractPrice) {
        return Object.freeze({ status: STORE_RESULT.ALREADY, reason: null, writes: writes.length });
      }
      profileMap.set(k, { ...p, contractPrice: contract });
      writes.push({ kind: 'contract', email: k, priceId: contract.priceId });
      return Object.freeze({ status: STORE_RESULT.APPLIED, reason: null, writes: writes.length });
    },

    writeCount: () => writes.length,
    snapshot: () => Object.freeze({
      profiles: Object.fromEntries(profileMap),
      ledgers: Object.fromEntries([...ledgerMap].map(([k, v]) => [k, [...v]])),
    }),
  });
}

/**
 * 実行時に使う store を決める。
 *
 * 段階:
 *   フラグ無し                        → **disabled**（本番の現状。何も読まない・書かない）
 *   `MEMBERSHIP_READ_ENABLED=true`    → Airtable から**読むだけ**（書き込みは拒否）
 *   `MEMBERSHIP_WRITE_ENABLED=true`   → 読み書き
 *
 * 🔴 いずれも **列とテーブルが作成済みであること**が前提
 *    （`docs/MEMBERSHIP_DATA_MIGRATION.md` §4。列の追加が先、有効化が後）。
 *    列が無いまま有効化しても、アダプタ側が `schema_missing` を検出して
 *    書きに行かないので既存の会員データは壊れない。
 *
 * @param {object} [o.adapter]  テストで差し替える場合のみ指定
 */
export function resolveMembershipStore({ env, adapter, fetchImpl } = {}) {
  const readable = isReadEnabled(env);
  if (!readable) return createDisabledMembershipStore('read_disabled');

  let store = adapter;
  if (!store) {
    // 実行時に env から Airtable アダプタを組み立てる（値は保持しない）
    const e = env || {};
    store = createAirtableMembershipStore({
      apiKey: e.AIRTABLE_API_KEY,
      baseId: e.AIRTABLE_BASE_ID,
      customersTable: e.AIRTABLE_TABLE_NAME || 'Customers',
      fetchImpl,
    });
  }
  if (!store || typeof store.readProfile !== 'function') {
    return createDisabledMembershipStore('adapter_missing');
  }
  return isWriteEnabled(env) ? store : readOnlyMembershipStore(store);
}
