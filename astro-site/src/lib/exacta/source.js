/**
 * exacta/source.js — AI 動的判定の選択を読む（読み取り専用）
 *
 * 正本: KAO `docs/ki-dynamic-selection.md` §3.5
 *
 * 置き場: Netlify Blobs の store `ki-exacta-selections`、key `<YYYY-MM-DD>.jsonl`（`ki_exacta_selection.v1`）。
 * 🔴 KI の公開 repo に発走前の選択を commit しない（ここはサーバー側でだけ読む）。
 * 🔴 書き込みは本モジュールでは行わない（配送経路は切替前に別途用意する）。
 * 🔴 読めなければ空の Map を返す（表示側は「発走前に確定」を出す。F3 には戻さない）。
 */

import { parseSelections } from './selection.js';

export const STORE_NAME = 'ki-exacta-selections';
const CACHE_MS = 60 * 1000;
const cache = new Map();

/** テスト用に読み取り関数を差し替えられるようにする。 */
let reader = async (date) => {
  const { getStore } = await import('@netlify/blobs');
  return getStore(STORE_NAME).get(`${date}.jsonl`, { type: 'text' });
};

export function setReaderForTest(fn) {
  reader = fn;
  cache.clear();
}

/** `date` の選択を `Map<race_id, row>` で返す（60 秒キャッシュ）。 */
export async function loadSelectionsForDate(date, nowMs = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return new Map();
  const hit = cache.get(date);
  if (hit && nowMs - hit.at < CACHE_MS) return hit.value;
  let value = new Map();
  try {
    const text = await reader(date);
    value = parseSelections(text || '');
  } catch {
    value = new Map();
  }
  cache.set(date, { at: nowMs, value });
  return value;
}
