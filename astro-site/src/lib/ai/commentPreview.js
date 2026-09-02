/**
 * commentPreview.js — AI 解説の「無料で見せてよい範囲」をサーバー側で決める
 *
 * 正本: docs/RENEWAL_2026_08.md §7（認可）
 *
 * 背景（2026-09-02 の是正）:
 *   `gemini-race-analysis` は認可を見ずに **全文** を返し、
 *   クライアントが後半をぼかして隠していただけだった。
 *   つまり未権限の閲覧者にも、有料の本文が
 *     - HTTP 応答（JSON）
 *     - localStorage のキャッシュ
 *     - DOM（ぼかし要素の textContent）
 *   のすべてに渡っていた。ぼかしは表示効果であって認可ではない。
 *
 * 🔴 ここでの原則:
 *   1. **隠す部分はサーバーから出さない。** 返すのは可視範囲だけ
 *   2. 権限が判断できないときは **無料扱い**（fail-closed）
 *   3. 分割規則は 1 か所だけに置き、クライアントでは再分割しない
 */

/** 無料で見せる範囲の下限文字数（短文で切りすぎないための床）。 */
export const MIN_PREVIEW_CHARS = 50;
/** 短文（3 文以下）のときに見せる割合。 */
export const SHORT_PREVIEW_RATIO = 0.45;
/** 長文のときに見せる文の数。 */
export const PREVIEW_SENTENCES = 3;

/**
 * 本文を「無料で見せる範囲」と「有料の残り」に分ける。
 *
 * 分割規則は従来クライアントで行っていたものと同じ（見え方を変えないため）。
 *
 * @param {string} text
 * @returns {{ visible: string, hidden: string }}
 */
export function splitFreePreview(text) {
  if (typeof text !== 'string' || !text.trim()) return { visible: '', hidden: '' };

  const fullText = text.split('\n').filter((l) => l.trim()).join('\n');
  const totalSentences = (fullText.match(/。/g) || []).length;

  let cutIdx = -1;
  if (totalSentences <= PREVIEW_SENTENCES) {
    const targetLen = Math.max(MIN_PREVIEW_CHARS, Math.floor(fullText.length * SHORT_PREVIEW_RATIO));
    cutIdx = targetLen;
    const nextPunct = fullText.substring(targetLen).search(/[。、]/);
    if (nextPunct !== -1 && nextPunct < 40) cutIdx = targetLen + nextPunct;
  } else {
    let searchFrom = 0;
    for (let i = 0; i < PREVIEW_SENTENCES; i += 1) {
      const idx = fullText.indexOf('。', searchFrom);
      if (idx === -1) break;
      cutIdx = idx;
      searchFrom = idx + 1;
    }
  }
  if (cutIdx === -1 || cutIdx >= fullText.length - 10) {
    cutIdx = Math.floor(fullText.length * 0.4);
  }

  return {
    visible: fullText.slice(0, cutIdx + 1),
    hidden: fullText.slice(cutIdx + 1),
  };
}

/**
 * 応答に載せてよい本文を決める。
 *
 * 🔴 `paid` が **厳密に true** のときだけ全文を返す。
 *    undefined / null / 'true' / 1 などは無料扱い（fail-closed）。
 * 🔴 有料の残りは戻り値に **含めない**。呼び出し側が誤って足せないように、
 *    そもそも返さない。
 *
 * @param {{ comment: string, paid: boolean }} o
 * @returns {{ comment: string, truncated: boolean }}
 */
export function buildAnalysisPayload({ comment, paid } = {}) {
  const text = typeof comment === 'string' ? comment : '';
  if (paid === true) return { comment: text, truncated: false };

  const { visible, hidden } = splitFreePreview(text);
  // 隠す残りが無ければ切っていないので truncated は false
  return { comment: visible, truncated: hidden.trim().length > 0 };
}
