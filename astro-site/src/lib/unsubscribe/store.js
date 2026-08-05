/**
 * 配信停止の記録先（store）— **注入可能**・既定は fail-closed
 *
 * 🔴 重要（2026-08-05 時点の未確定事項）:
 *   token の `recipientRef` を **Customers レコードへ対応付ける方法が未確定**である
 *   （KMA 側 onboarding の `audience.adapterId` / `audience.mode` が provisional）。
 *   したがって **本番 datastore への write は既定で無効**とし、
 *   対応付けが確定するまで解除を確定できない（fail-closed）。
 *
 * 🔴 有効化は環境変数 `UNSUBSCRIBE_WRITE_ENABLED=true` と、実装済み resolver の注入の**両方**が必要。
 *   どちらか欠ければ `unavailable` を返し、**利用者には「一時的に処理できない」と表示**する
 *   （解除できていないのに「完了」と表示しない）。
 */

export const STORE_RESULT = Object.freeze({
  APPLIED: 'applied',
  ALREADY: 'already',
  /** 🔴 未確定 / 未設定のため確定できない（成功と区別する） */
  UNAVAILABLE: 'unavailable',
});

/**
 * in-memory store（**テスト / fixture 専用**）。
 * 冪等: 同一 operationId の再実行では write しない。
 */
export function createInMemoryUnsubscribeStore({ alreadyUnsubscribed = [] } = {}) {
  const ops = new Set();
  const unsubscribed = new Set(alreadyUnsubscribed);
  const writes = [];

  return Object.freeze({
    kind: 'in-memory',
    enabled: true,
    async apply({ operationId, recipientRef, scope, campaignId, nowMs }) {
      if (ops.has(operationId)) {
        return Object.freeze({ result: STORE_RESULT.ALREADY, writes: writes.length });
      }
      const key = scope === 'campaign' ? `${campaignId}\u0000${recipientRef}` : recipientRef;
      if (unsubscribed.has(key)) {
        ops.add(operationId);
        return Object.freeze({ result: STORE_RESULT.ALREADY, writes: writes.length });
      }
      unsubscribed.add(key);
      ops.add(operationId);
      writes.push({ key, atMs: nowMs });
      return Object.freeze({ result: STORE_RESULT.APPLIED, writes: writes.length });
    },
    writeCount: () => writes.length,
    isUnsubscribed: (key) => unsubscribed.has(key),
    snapshot: () => Object.freeze({ ops: [...ops], unsubscribed: [...unsubscribed] }),
  });
}

/** snapshot から復元（restart 後も解除状態と冪等性が保たれることの検証用）。 */
export function restoreInMemoryUnsubscribeStore(snapshot) {
  const store = createInMemoryUnsubscribeStore({ alreadyUnsubscribed: snapshot.unsubscribed ?? [] });
  // ops を復元するため、同一 operationId を再適用しても write されないことを保証する
  const restoredOps = new Set(snapshot.ops ?? []);
  return Object.freeze({
    ...store,
    async apply(args) {
      if (restoredOps.has(args.operationId)) {
        return Object.freeze({ result: STORE_RESULT.ALREADY, writes: store.writeCount() });
      }
      const r = await store.apply(args);
      restoredOps.add(args.operationId);
      return r;
    },
  });
}

/**
 * 本番 store（**既定で無効**）。
 *
 * 🔴 `recipientRef` → Customers レコードの対応付けが確定するまで有効化しない。
 *    有効化には次の**すべて**が必要:
 *      1. `UNSUBSCRIBE_WRITE_ENABLED=true`
 *      2. `resolveRecipient`（recipientRef → レコード ID）の実装を注入
 *      3. `updateUnsubscribeFlag`（実 write）の実装を注入
 *    いずれか欠ければ `unavailable` を返す（**解除できていないのに完了と表示しない**）。
 *
 * @param {object} o
 * @param {boolean} o.writeEnabled                  env 由来（呼び出し側が解決して渡す）
 * @param {Function|null} [o.resolveRecipient]      `(recipientRef) => Promise<recordId|null>`
 * @param {Function|null} [o.updateUnsubscribeFlag] `(recordId) => Promise<void>`
 * @param {Function|null} [o.hasProcessedOperation] `(operationId) => Promise<boolean>`
 * @param {Function|null} [o.markOperation]         `(operationId) => Promise<void>`
 */
export function createProductionUnsubscribeStore({
  writeEnabled = false,
  resolveRecipient = null,
  updateUnsubscribeFlag = null,
  hasProcessedOperation = null,
  markOperation = null,
} = {}) {
  const ready = writeEnabled === true
    && typeof resolveRecipient === 'function'
    && typeof updateUnsubscribeFlag === 'function'
    && typeof hasProcessedOperation === 'function'
    && typeof markOperation === 'function';

  return Object.freeze({
    kind: 'production',
    enabled: ready,
    async apply({ operationId, recipientRef, nowMs }) {
      // 🔴 fail-closed: 未確定・未設定のあいだは write しない
      if (!ready) return Object.freeze({ result: STORE_RESULT.UNAVAILABLE, writes: 0 });

      if (await hasProcessedOperation(operationId)) {
        return Object.freeze({ result: STORE_RESULT.ALREADY, writes: 0 });
      }
      const recordId = await resolveRecipient(recipientRef);
      // 🔴 対応付けできない場合も「完了」にしない
      if (!recordId) return Object.freeze({ result: STORE_RESULT.UNAVAILABLE, writes: 0 });

      await updateUnsubscribeFlag(recordId, { atMs: nowMs });
      await markOperation(operationId);
      return Object.freeze({ result: STORE_RESULT.APPLIED, writes: 1 });
    },
  });
}
