/**
 * adminKeyClient.js — メルマガ配信管理画面（/admin/newsletter）から管理 API を呼ぶ（ブラウザ専用）
 *
 * 管理 API は `X-KI-Admin-Key` ヘッダーの鍵でのみ管理者を認める（`adminAuth.js`・registry e1f0c2ce）。
 * 画面は鍵を一度だけ入力させ、**このタブの sessionStorage** にだけ置く
 * （タブを閉じれば消える。localStorage・Cookie・URL には置かない）。
 * 403 が返ったら鍵を消し、次の操作で入力し直させる。
 */

const STORAGE_KEY = 'ki_admin_api_key';
export const ADMIN_KEY_HEADER_NAME = 'X-KI-Admin-Key';

function readStored() {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function writeStored(value) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* 保存できなくても、このリクエストには使える */
  }
}

export function clearAdminKey() {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}

/** 鍵を返す。未入力なら入力を求める。キャンセルされたら空文字。 */
export function getAdminKey() {
  const stored = readStored();
  if (stored) return stored;
  const entered = (window.prompt('管理キーを入力してください（このタブを閉じると消えます）') || '').trim();
  if (entered) writeStored(entered);
  return entered;
}

/**
 * 管理 API を呼ぶ。鍵はヘッダーでだけ送る（body・URL には載せない）。
 * @returns {Promise<Response>}
 */
export async function adminFetch(url, init = {}) {
  const key = getAdminKey();
  if (!key) throw new Error('管理キーが入力されていません');
  const res = await fetch(url, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { ...(init.headers || {}), [ADMIN_KEY_HEADER_NAME]: key },
  });
  if (res.status === 403) clearAdminKey();
  return res;
}

/** 403 のときに画面へ出す文言。 */
export const ADMIN_FORBIDDEN_MESSAGE = '管理キーが正しくないか、サーバー側で管理キーが設定されていません。';
