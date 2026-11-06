/**
 * broadcastStage.js — メルマガ管理画面（/admin/newsletter）が送るステージの選択と送信 body
 *
 * ステージ = 1 回の配信の**送信上限件数**（`send-broadcast` の `maxRecords: stage`）。
 * 値の正本は `NEWSLETTER_MIGRATION.md`（50 → 100 → … → 15,000）。ここにない値は画面から送らない。
 *
 * 🔴 既定値を置かない。未選択なら body を作らない（= API を呼ばない）。
 * 🔴 stage は数値で送る。`send-broadcast` は受け取った値をそのまま Airtable の Number 列と
 *    `maxRecords` に使い、`create-broadcast` のように parseInt しない。
 * 🔴 本番送信は、同じステージの Dry-Run を済ませた配信だけ（draft → dry-run → locked）。
 *    これは画面の確認であり、API の検証はここに依存しない。
 */

export const BROADCAST_STAGES = Object.freeze([
  { value: 50, label: 'Stage 1: 50件' },
  { value: 100, label: 'Stage 2: 100件' },
  { value: 300, label: 'Stage 3: 300件' },
  { value: 500, label: 'Stage 4: 500件' },
  { value: 1000, label: 'Stage 5: 1,000件' },
  { value: 3000, label: 'Stage 6: 3,000件' },
  { value: 7000, label: 'Stage 7: 7,000件' },
  { value: 15000, label: 'Stage 8: 15,000件' },
]);

export const STAGE_REQUIRED_MESSAGE = 'ステージを選択してください';
export const DRY_RUN_REQUIRED_MESSAGE = '本番送信の前に、同じステージで Dry-Run を実行してください';
export const STAGE_MISMATCH_MESSAGE = '選択中のステージが Dry-Run のステージと違います。選び直すか、Dry-Run をやり直してください';

const ALLOWED_STAGES = new Set(BROADCAST_STAGES.map((s) => s.value));

/** 画面の入力値を許可された数値へ変換する。未選択・一覧にない値は null。 */
export function parseBroadcastStage(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const text = String(raw).trim();
  if (!/^[0-9]+$/.test(text)) return null;
  const stage = Number(text);
  return ALLOWED_STAGES.has(stage) ? stage : null;
}

function requireStage(raw) {
  const stage = parseBroadcastStage(raw);
  if (stage === null) throw new Error(STAGE_REQUIRED_MESSAGE);
  return stage;
}

/** `create-broadcast` の body。未選択なら throw。 */
export function buildCreateBroadcastBody({ subject, bodyHtml, stageInput, createdBy }) {
  return { subject, body_html: bodyHtml, stage: requireStage(stageInput), created_by: createdBy };
}

/** `send-broadcast`（Dry-Run）の body。未選択なら throw。 */
export function buildDryRunBody(broadcast, stageInput) {
  return { broadcast_id: broadcast.broadcast_id, dry_run: true, stage: requireStage(stageInput) };
}

/** `send-broadcast`（本番送信）の body。未選択・Dry-Run 未実施・ステージ不一致なら throw。 */
export function buildSendBody(broadcast, stageInput) {
  const stage = requireStage(stageInput);
  if (broadcast.status !== 'dry-run') throw new Error(DRY_RUN_REQUIRED_MESSAGE);
  if (Number(broadcast.stage) !== stage) throw new Error(STAGE_MISMATCH_MESSAGE);
  return { broadcast_id: broadcast.broadcast_id, dry_run: false, confirm: true, stage };
}
