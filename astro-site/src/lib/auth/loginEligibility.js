/**
 * loginEligibility.js — ログインリンクを送ってよい会員状態と、認証後に書く会員状態
 *
 * 正本: docs/measurements/LOGIN_RECOVERY_2026_10.md
 *
 * 背景（2026-10-19 の本番導線監査で確認）:
 *   `send-magic-link` は `Status !== 'active'` をすべて 403「アカウントが無効です」で止めていた。
 *   その結果、次の 3 種類の人が **ログインできず、自力で戻る手段が無かった**。
 *
 *   | Status | どうしてそうなるか | 正本上の扱い |
 *   |---|---|---|
 *   | `pending` | 無料登録したが確認リンク（15 分）を開く前に期限切れ | 本人確認が済めば無料会員（`register-free` は再送を許す） |
 *   | `inactive` | 有料契約の終了・退会（`stripe-webhook` が PlanType=free と同時に書く） | 退会後も無料会員として印まで見られる・再利用は改めて申し込む（WITHDRAWAL_2026_10.md） |
 *   | `payment_failed` | カード決済の失敗（`stripe-webhook`） | アクセスは即時停止しない（stripe-webhook のコメント・TBD-10） |
 *
 *   `start-purchase` は `pending` だけを `register-free` へ回していたが、
 *   `inactive` の人がプランを申し込むと `send-magic-link` の 403 → 502 で **再契約もできなかった**。
 *
 * 🔴 権限（tier）は変えない。tier は従来どおり `PlanType` と有効期限・退会記録だけで決まる
 *    （`verify-magic-link` の `planTypeToTier` / `applyExpiry` / `tierForNewSession`）。
 *    ここで決めるのは「本人のメールアドレスへログインリンクを送るか」だけ。
 * 🔴 `suspended` / `cancelled`（管理者による停止・旧運用）や未知の値は従来どおり送らない（fail-closed）。
 */

/** ログインリンクを送ってよい Status。これ以外（未知・空を含む）は 403。 */
export const LOGIN_LINK_STATUSES = Object.freeze(['active', 'pending', 'inactive', 'payment_failed']);

/**
 * @param {unknown} status Airtable Customers.Status
 * @returns {boolean}
 */
export function canRequestLoginLink(status) {
  return typeof status === 'string' && LOGIN_LINK_STATUSES.includes(status);
}

/**
 * マジックリンクの認証が成功したときに Customers へ書くフィールド。
 *
 * 🔴 従来の挙動（認証で `Status: active` / `AccessEnabled: true`）は **本人確認の完了** を意味する。
 *    それが当てはまるのは `pending`（未確認）と空。`active` は従来どおり同じ値を書く（挙動不変）。
 *    `inactive`（契約終了）や `payment_failed`（決済失敗）を `active` に戻すと、
 *    契約状態の記録を消してしまう（配信対象の条件などにも使われている）ので **書かない**。
 * 🔴 PlanType が空なら free-registered を入れる（従来どおり。有料プランは上書きしない）。
 *
 * @param {{Status?: unknown, PlanType?: unknown}} fields
 * @returns {Record<string, unknown>|null} 書くものが無ければ null
 */
export function verifiedCustomerUpdate(fields) {
  const f = fields && typeof fields === 'object' ? fields : {};
  const status = typeof f.Status === 'string' ? f.Status : '';
  const update = {};
  if (status === '' || status === 'pending' || status === 'active') {
    update.Status = 'active';
    update.AccessEnabled = true;
  }
  if (!f.PlanType) update.PlanType = 'free-registered';
  return Object.keys(update).length ? update : null;
}
