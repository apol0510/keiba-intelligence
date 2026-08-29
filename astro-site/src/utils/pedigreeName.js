/**
 * pedigreeName.js — 血統名として表示してよい値かを判定する（fail-closed）
 *
 * 正本: docs/RENEWAL_2026_08.md §4
 *
 * ── なぜ必要か（2026-08-29 発見）───────────────────────────────
 * 南関 `horseStats` の `profile.damsire`（母の父）に、**馬名ではなく
 * 「性齢 毛色 生年月日 中同名」がそのまま入っている**レコードが多数ある。
 * 実データ 437 件中 **164 件（37.5%）** がこの形だった。
 *
 *   例: "牡6 鹿毛 20.2.22 中同名" / "牝3 青鹿毛 23.3.25 中同名"
 *
 * これは上流（uma_info 由来の解析）で列がずれていることを示す。
 * `dam`（母）は 437 件すべて正常であり、`damsire` 固有の問題である。
 *
 * そのまま出すと **母の父として誤った情報を表示する**ことになるため、
 * 「馬名として妥当でない値は表示しない」ことにした。
 * 上流が直れば自動的に表示される（こちら側で値を補完・修正はしない）。
 *
 * 🔴 推測で直さない。判定できない値は **出さない**（fail-closed）。
 */

/** 毛色の表記（この語を含む値は馬名ではない）。 */
const COAT_COLORS = [
  '鹿毛', '黒鹿毛', '青鹿毛', '栗毛', '栃栗毛', '芦毛', '青毛', '白毛',
];

/** 馬名として明らかに不正なパターン。 */
const REJECT_PATTERNS = [
  /[牡牝セン騸]\s*\d/,          // 性齢（牡6 / 牝3 / セ5）
  /\d+\s*[.．]\s*\d+\s*[.．]\s*\d+/, // 生年月日（20.2.22）
  /同名/,                        // 「中同名」「外同名」
  /^\d+$/,                       // 数字のみ
];

/** 馬名の長さの上限（日本の競走馬名は 9 文字/18 バイト以内。余裕を見て 24）。 */
const MAX_LENGTH = 24;

/**
 * 血統名として表示してよい値か。
 * @param {unknown} v
 * @returns {boolean}
 */
export function isPlausiblePedigreeName(v) {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (!s) return false;
  if (s.length > MAX_LENGTH) return false;
  if (COAT_COLORS.some((c) => s.includes(c))) return false;
  if (REJECT_PATTERNS.some((re) => re.test(s))) return false;
  return true;
}

/**
 * 表示用に整えた血統名。妥当でなければ null（＝表示しない）。
 * @param {unknown} v
 * @returns {string|null}
 */
export function cleanPedigreeName(v) {
  return isPlausiblePedigreeName(v) ? v.trim() : null;
}
