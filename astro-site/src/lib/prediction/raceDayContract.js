/**
 * raceDayContract.js — 開催データの整合性契約（fail-closed）
 *
 * 正本: docs/RENEWAL_2026_08.md §4
 *
 * ── なぜあるか ───────────────────────────────────────────────────
 * 2026-08-29、「11R を選んだのに 1R が表示される」という報告を受けて調査した。
 * 原因は表示側（長大ページ + `scroll-behavior: smooth` でアンカージャンプが不発）で、
 * データの取り違えではなかった。
 *
 * しかし **venue / date / raceNumber の取り違えは起きたら重大**（別レースの予想を
 * そのレースのものとして見せてしまう）であり、起きていないことを常時保証したい。
 * そこで本モジュールで契約を定義し、**描画前に検証して、通らないレースは描画しない**。
 *
 * ── 契約 ─────────────────────────────────────────────────────────
 *  1. `day.date` は `YYYY-MM-DD`
 *  2. 会場名は非空・会場間で一意
 *  3. 各レースは `raceInfo` を持つ
 *  4. `raceInfo.raceNumber` は 1 以上の整数
 *  5. `raceNumber` は会場内で一意
 *  6. `raceInfo.venue` は **その会場名と一致**（欠損も違反）
 *  7. `raceInfo.date` は **開催日と一致**（欠損も違反）
 *  8. `horses` は配列
 *
 * 🔴 **判定できない（欠損している）場合も違反として扱う**。
 *    「たぶん合っているだろう」で通さない。これが fail-closed の意味である。
 */

export const RACE_DAY_VIOLATION = Object.freeze({
  DATE_INVALID: 'date_invalid',
  VENUE_NAME_MISSING: 'venue_name_missing',
  VENUE_NAME_DUPLICATE: 'venue_name_duplicate',
  RACE_INFO_MISSING: 'race_info_missing',
  RACE_NUMBER_INVALID: 'race_number_invalid',
  RACE_NUMBER_DUPLICATE: 'race_number_duplicate',
  VENUE_MISMATCH: 'venue_mismatch',
  DATE_MISMATCH: 'date_mismatch',
  HORSES_INVALID: 'horses_invalid',
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

/** 会場エントリからレース配列を取り出す（`loadRaceDay.racesOf` と同じ規則）。 */
function racesOfVenue(venue) {
  const d = venue?.data;
  if (Array.isArray(d?.predictions)) return d.predictions;
  if (Array.isArray(d?.races)) return d.races;
  return [];
}

/**
 * 開催データを検証する。**データは書き換えない。**
 *
 * @param {object} day loadRaceDay の戻り
 * @returns {{ ok: boolean, violations: Array<{code:string, venue:string|null, raceNumber:number|null, detail:string}> }}
 */
export function checkRaceDay(day) {
  const violations = [];
  const add = (code, detail, venue = null, raceNumber = null) =>
    violations.push({ code, detail, venue, raceNumber });

  const date = day?.date ?? null;
  if (!isNonEmptyString(date) || !DATE_RE.test(date)) {
    add(RACE_DAY_VIOLATION.DATE_INVALID, `開催日が不正: ${String(date)}`);
  }

  const venues = Array.isArray(day?.venues) ? day.venues : [];
  const seenVenueNames = new Set();

  for (const venue of venues) {
    const venueName = venue?.venueName;
    if (!isNonEmptyString(venueName)) {
      add(RACE_DAY_VIOLATION.VENUE_NAME_MISSING, '会場名が無い');
      continue;
    }
    if (seenVenueNames.has(venueName)) {
      add(RACE_DAY_VIOLATION.VENUE_NAME_DUPLICATE, `会場名が重複: ${venueName}`, venueName);
    }
    seenVenueNames.add(venueName);

    const seenRaceNumbers = new Set();

    for (const race of racesOfVenue(venue)) {
      const info = race?.raceInfo;
      if (!info || typeof info !== 'object') {
        add(RACE_DAY_VIOLATION.RACE_INFO_MISSING, 'raceInfo が無い', venueName);
        continue;
      }

      const rn = info.raceNumber;
      if (!Number.isInteger(rn) || rn < 1) {
        add(RACE_DAY_VIOLATION.RACE_NUMBER_INVALID, `raceNumber が不正: ${String(rn)}`, venueName);
        continue;
      }
      if (seenRaceNumbers.has(rn)) {
        add(RACE_DAY_VIOLATION.RACE_NUMBER_DUPLICATE, `raceNumber が重複: ${rn}`, venueName, rn);
      }
      seenRaceNumbers.add(rn);

      // 🔴 欠損も違反（fail-closed）
      if (!isNonEmptyString(info.venue) || info.venue !== venueName) {
        add(
          RACE_DAY_VIOLATION.VENUE_MISMATCH,
          `raceInfo.venue=${String(info.venue)} が会場 ${venueName} と一致しない`,
          venueName, rn,
        );
      }
      if (!isNonEmptyString(info.date) || info.date !== date) {
        add(
          RACE_DAY_VIOLATION.DATE_MISMATCH,
          `raceInfo.date=${String(info.date)} が開催日 ${String(date)} と一致しない`,
          venueName, rn,
        );
      }
      if (!Array.isArray(race?.horses)) {
        add(RACE_DAY_VIOLATION.HORSES_INVALID, 'horses が配列でない', venueName, rn);
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

/** 1 レースだけを検証する（描画直前のふるい分け用）。 */
export function isRaceVerified(race, { venueName, date } = {}) {
  const info = race?.raceInfo;
  if (!info || typeof info !== 'object') return false;
  if (!Number.isInteger(info.raceNumber) || info.raceNumber < 1) return false;
  if (!isNonEmptyString(info.venue) || info.venue !== venueName) return false;
  if (!isNonEmptyString(info.date) || info.date !== date) return false;
  if (!Array.isArray(race?.horses)) return false;
  return true;
}

/**
 * 検証を通ったレースだけに絞り込んだ開催データを返す。
 *
 * 🔴 通らなかったレースは **描画しない**（別レースの内容を出すより、出さない方が安全）。
 * 🔴 元の day / venue / race オブジェクトは書き換えない。
 *
 * @returns {{ day: object, dropped: Array<{venue:string, raceNumber:number|null}>, violations: Array }}
 */
export function verifiedRaceDay(day) {
  const { violations } = checkRaceDay(day);
  const date = day?.date ?? null;
  const dropped = [];

  const venues = (Array.isArray(day?.venues) ? day.venues : []).map((venue) => {
    const venueName = venue?.venueName ?? null;
    const races = racesOfVenue(venue);
    const kept = [];

    for (const race of races) {
      if (isRaceVerified(race, { venueName, date })) kept.push(race);
      else dropped.push({ venue: venueName, raceNumber: race?.raceInfo?.raceNumber ?? null });
    }

    // 元データを壊さないよう、必要なときだけ差し替えた新しい会場オブジェクトを作る
    if (kept.length === races.length) return venue;
    return { ...venue, data: { ...(venue?.data || {}), predictions: kept, races: undefined } };
  });

  return { day: { ...day, venues }, dropped, violations };
}
