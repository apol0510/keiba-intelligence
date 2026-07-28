#!/usr/bin/env node

/**
 * アーカイブ同期検証スクリプト
 *
 * keiba-data-sharedの最新結果とarchiveResults.jsonの最新日付を比較し、
 * 同期ズレを検知する
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createSharedClient, resolveSharedToken } from './lib/sharedFetch.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

/**
 * keiba-data-sharedから最新の結果日付を取得（認証付き / sharedFetch 使用）
 */
async function getLatestResultDate({ env = process.env, client: _client, resolveToken: _rt } = {}) {
  const rt = _rt ?? resolveSharedToken;
  rt({ env }); // TOKEN_MISSING fail-fast（匿名 fallback 禁止）
  const client = _client ?? createSharedClient({ env });

  const today = new Date();
  const jstNow = new Date(today.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));

  // 過去30日分をチェック
  for (let i = 0; i < 30; i++) {
    const checkDate = new Date(jstNow);
    checkDate.setDate(checkDate.getDate() - i);
    const dateStr = checkDate.toISOString().split('T')[0];
    const [year, month] = dateStr.split('-');

    // 統合ファイルをチェック（required:false = 404 → null）
    const unifiedPath = `nankan/results/${year}/${month}/${dateStr}.json`;
    const unified = await client.fetchJson(unifiedPath, { ref: 'main', required: false });
    if (unified !== null) {
      console.log(`📊 最新結果（統合ファイル）: ${dateStr}`);
      return { date: dateStr, source: 'unified' };
    }

    // 会場別ファイルをチェック
    const venues = ['OOI', 'FUN', 'KAW', 'URA'];
    let totalRaces = 0;
    const foundVenues = [];

    for (const venue of venues) {
      const venuePath = `nankan/results/${year}/${month}/${dateStr}-${venue}.json`;
      const data = await client.fetchJson(venuePath, { ref: 'main', required: false });
      if (data !== null) {
        const raceCount = data.races?.length || 0;
        totalRaces += raceCount;
        foundVenues.push(`${venue}(${raceCount})`);
      }
    }

    if (totalRaces >= 8) {
      console.log(`📊 最新結果（会場別）: ${dateStr} - ${totalRaces}レース (${foundVenues.join(', ')})`);
      return { date: dateStr, source: 'venue-specific', venues: foundVenues, races: totalRaces };
    }
  }

  throw new Error('過去30日間に結果データが見つかりませんでした');
}

/** 日付文字列（YYYY-MM-DD）だけを受け付ける。推測・補完はしない。 */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * archiveResults.json の日付集合を取り出す。
 *
 * ⚠️ **配列の並び順を正本にしない。** 以前は `archive[0]` を「最新」と決め打ちしていたため、
 * 過去日を後から取り込む back-fill（例: 2026-07-27 が既にある状態で 2026-07-24 を追加）で
 * 先頭が過去日になり、正常な import を誤って FAIL させていた。
 * 日付は必ず **date 値**から機械的に決定する。
 *
 * @param {Array<{date?: string}>} archive
 * @returns {Set<string>} YYYY-MM-DD の集合
 */
export function getArchiveDates(archive) {
  if (!Array.isArray(archive)) {
    throw new Error('archiveResults.json が配列ではありません');
  }
  if (archive.length === 0) {
    throw new Error('archiveResults.jsonが空です');
  }
  const dates = new Set();
  for (const entry of archive) {
    const d = entry && entry.date;
    if (typeof d === 'string' && DATE_PATTERN.test(d)) dates.add(d);
  }
  if (dates.size === 0) {
    // 日付が 1 件も取れないのは異常。黙って PASS させない（fail-closed）。
    throw new Error('archiveResults.json から有効な date を取得できませんでした');
  }
  return dates;
}

/**
 * 日付集合の最大値（＝最新日）。配列位置ではなく値で決める。
 * @param {Set<string>|Array<string>} dates
 * @returns {string|null}
 */
export function maxDate(dates) {
  const list = [...dates];
  if (list.length === 0) return null;
  return list.reduce((a, b) => (a > b ? a : b));
}

/**
 * keiba-data-shared に **実際に results ファイルが存在する日付**を列挙する。
 *
 * ⚠️ 以前は「archive 最新日 → shared 最新日」の暦日を全て missing 候補にしていたため、
 * 南関の非開催日（例: 2026-07-25 / 2026-07-26）まで「不足」と誤報していた。
 * ここでは shared のディレクトリ実体だけを根拠にする（新しいデータ源は作らない）。
 *
 * 取得は既存の shared access utility（`createSharedClient().listDirectory`）を再利用する。
 *
 * @returns {Promise<Set<string>>}
 */
export async function collectSharedResultDates({
  env = process.env,
  client: _client,
  resolveToken: _rt,
  days = 30,
  now,
} = {}) {
  const rt = _rt ?? resolveSharedToken;
  rt({ env }); // TOKEN_MISSING fail-fast（匿名 fallback 禁止）
  const client = _client ?? createSharedClient({ env });

  const base = now ? new Date(now) : new Date();
  const jstNow = new Date(base.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));

  // 対象期間に掛かる年月と、期間内の日付集合を作る
  const months = new Set();
  const window = new Set();
  for (let i = 0; i < days; i++) {
    const d = new Date(jstNow);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    window.add(dateStr);
    const [year, month] = dateStr.split('-');
    months.add(`${year}/${month}`);
  }

  const dates = new Set();
  for (const ym of months) {
    // 404（その月のディレクトリ自体が無い）は「結果なし」として扱う。
    // それ以外の失敗（401 / 5xx / 429 / 不正レスポンス）は throw されるため PASS にはならない。
    const entries = await client.listDirectory(`nankan/results/${ym}`, { ref: 'main', required: false });
    if (entries === null) continue;
    for (const e of entries) {
      if (!e || e.type !== 'file') continue;
      // 統合ファイル YYYY-MM-DD.json / 会場別 YYYY-MM-DD-{CODE}.json の双方を受け付ける
      const m = /^(\d{4}-\d{2}-\d{2})(?:-[A-Z]{2,4})?\.json$/.exec(e.name);
      if (!m) continue;
      if (window.has(m[1])) dates.add(m[1]);
    }
  }
  return dates;
}

/**
 * 同期判定（純粋関数）。
 *
 * shared に results が存在する日付集合と archive の日付集合の**差分**で判定する。
 * 暦日の連続性・配列順・件数には依存しない。
 *
 * @returns {{ok: boolean, missing: string[], latestSharedDate: string|null,
 *            latestArchiveDate: string|null, sharedCount: number, archiveCount: number}}
 */
export function evaluateArchiveSync({ sharedDates, archiveDates } = {}) {
  const shared = sharedDates instanceof Set ? sharedDates : new Set(sharedDates || []);
  const archive = archiveDates instanceof Set ? archiveDates : new Set(archiveDates || []);

  if (shared.size === 0) {
    // shared 側が 1 件も取れないのは取得失敗の可能性がある。無条件 PASS にしない（fail-closed）。
    throw new Error('keiba-data-shared に results が 1 件も見つかりませんでした（取得失敗の可能性）');
  }

  const missing = [...shared].filter((d) => !archive.has(d)).sort();

  return {
    ok: missing.length === 0,
    missing,
    latestSharedDate: maxDate(shared),
    latestArchiveDate: maxDate(archive),
    sharedCount: shared.size,
    archiveCount: archive.size,
  };
}

/**
 * archiveResults.json を読み込む（CLI 用）
 */
function readArchive() {
  const archivePath = join(projectRoot, 'src', 'data', 'archiveResults.json');
  return JSON.parse(readFileSync(archivePath, 'utf-8'));
}

/**
 * メイン処理
 */
async function main() {
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📋 アーカイブ同期検証`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  try {
    // 1. 最新結果日付（表示用。判定そのものには使わない）
    const latestResult = await getLatestResultDate();

    console.log();

    // 2. shared に results が実在する日付集合（暦日の推測はしない）
    const sharedDates = await collectSharedResultDates();

    // 3. archive の日付集合（配列順に依存しない）
    const archiveDates = getArchiveDates(readArchive());
    console.log(`📚 最新アーカイブ: ${maxDate(archiveDates)}`);

    console.log();

    // 4. 差分で判定
    const verdict = evaluateArchiveSync({ sharedDates, archiveDates });

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🔍 同期状態チェック`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`   最新結果: ${latestResult.date} (${latestResult.source === 'unified' ? '統合ファイル' : `会場別: ${latestResult.venues.join(', ')}`})`);
    console.log(`   最新アーカイブ: ${verdict.latestArchiveDate}`);
    console.log(`   shared に results がある日: ${verdict.sharedCount}日 / うち archive 未反映: ${verdict.missing.length}日`);
    console.log();

    if (verdict.ok) {
      console.log(`✅ 同期OK: shared に results がある日は全て archive に反映されています`);
      console.log(`   （非開催日は shared に results が無いため対象外。過去日の後追い取込も誤検知しません）`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
      process.exit(0);
    }

    console.error(`❌ 同期ズレ検出: shared に存在する results が archive に反映されていません`);
    console.error(`   keiba-data-sharedには結果が存在しますが、archiveResults.jsonに追加されていません。`);
    console.error(`   自動インポートが失敗している可能性があります。`);
    console.error();
    console.error(`【不足している日付】（shared に results が実在する日のみ）`);
    verdict.missing.forEach(date => {
      console.error(`   - ${date}`);
    });
    console.error();
    console.error(`【対処方法】`);
    console.error(`   以下のコマンドで手動インポートを実行してください:`);
    verdict.missing.forEach(date => {
      console.error(`   node scripts/importResults.js --date ${date}`);
    });
    console.error();
    console.error(`【再発防止のために確認すること】`);
    console.error(`   1. GitHub Actions の Import Results (Dispatch) が実行されたか確認`);
    console.error(`   2. repository_dispatch イベントが送信されたか確認`);
    console.error(`   3. keiba-data-shared の dispatch-results-intelligence.yml を確認`);
    console.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    process.exit(1);

  } catch (error) {
    console.error(`\n❌ エラーが発生しました: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

// テスト用 export（CLI動作は変えない。isDirectRun ガードで main は直接実行時のみ起動する）
// getArchiveDates / maxDate / collectSharedResultDates / evaluateArchiveSync は宣言時に export 済み。
export { getLatestResultDate };

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) main();
