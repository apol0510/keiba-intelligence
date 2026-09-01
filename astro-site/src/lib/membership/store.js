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

export const MEMBERSHIP_WRITE_ENV = 'MEMBERSHIP_WRITE_ENABLED';

export const STORE_RESULT = Object.freeze({
  APPLIED: 'applied',
  /** 冪等キーが既にある。書き込みは起きていない */
  ALREADY: 'already',
  /** 🔴 未設定 / 無効 / アダプタ未注入。**成功と区別する** */
  UNAVAILABLE: 'unavailable',
});

/** env の書き込み許可フラグ。'true' 以外はすべて無効（fail-closed）。 */
export function isWriteEnabled(env) {
  const v = (env || {})[MEMBERSHIP_WRITE_ENV];
  return typeof v === 'string' && v.trim().toLowerCase() === 'true';
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
 * 🔴 フラグが無い / アダプタが無い → **disabled**（本番の既定）。
 */
export function resolveMembershipStore({ env, adapter } = {}) {
  if (!isWriteEnabled(env)) return createDisabledMembershipStore('write_disabled');
  if (!adapter || typeof adapter.readProfile !== 'function') {
    return createDisabledMembershipStore('adapter_missing');
  }
  return adapter;
}
