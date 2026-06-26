import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { injectHorseHistoriesIntoVenues } from './loadHorseHistoriesJra.js';

// JRA 最新予想（複数会場対応）を読み込み、horseHistories を表示専用注入して返す。
// free-prediction/jra のメインページと、過去走/特徴量の遅延フラグメントルートで共有し、
// 会場順序（venueIndex）を完全一致させるための単一ソース。
// 元 src/pages/free-prediction/jra/index.astro のローダーをそのまま移設（挙動不変）。
export function loadJraLatestVenues(cwd) {
  const predictionsDir = join(cwd, 'src', 'data', 'predictions', 'jra');
  let predictionData = null;
  let venues = [];
  let isMultiVenue = false;
  let error = null;

  try {
    if (existsSync(predictionsDir)) {
      const years = readdirSync(predictionsDir).filter((name) => /^\d{4}$/.test(name));
      let allFiles = [];

      for (const year of years) {
        const yearPath = join(predictionsDir, year);
        const months = readdirSync(yearPath).filter((name) => /^\d{2}$/.test(name));
        for (const month of months) {
          const monthPath = join(yearPath, month);
          const files = readdirSync(monthPath).filter(
            (file) => file.endsWith('.json') && /^\d{4}-\d{2}-\d{2}\.json$/.test(file)
          );
          for (const file of files) {
            const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
            if (dateMatch) {
              allFiles.push({
                date: dateMatch[1],
                path: join(monthPath, file),
                timestamp: new Date(dateMatch[1]).getTime(),
              });
            }
          }
        }
      }

      allFiles.sort((a, b) => b.timestamp - a.timestamp);
      const latestPath = allFiles.length > 0 ? allFiles[0].path : null;

      if (latestPath) {
        const rawData = JSON.parse(readFileSync(latestPath, 'utf-8'));
        if (rawData.venues && Array.isArray(rawData.venues)) {
          isMultiVenue = true;
          venues = rawData.venues;
          predictionData = rawData;
        } else if (rawData.eventInfo && rawData.predictions) {
          isMultiVenue = false;
          venues = [{
            venue: rawData.eventInfo.venue,
            eventInfo: rawData.eventInfo,
            predictions: rawData.predictions,
          }];
          predictionData = rawData;
        } else {
          throw new Error('予想データのフォーマットが不正です');
        }
      } else {
        throw new Error('中央競馬の予想データがありません');
      }
    } else {
      throw new Error('中央競馬の予想データフォルダが見つかりません');
    }
  } catch (err) {
    error = err.message;
  }

  const targetDate = predictionData?.date || predictionData?.eventInfo?.date || null;
  if (!error && Array.isArray(venues) && venues.length > 0 && targetDate) {
    try {
      injectHorseHistoriesIntoVenues(venues, targetDate, cwd);
    } catch (_e) {
      // 表示専用フォールバック。失敗時は既存 recentRaces のまま表示。
    }
  }

  return { predictionData, venues, isMultiVenue, error, targetDate };
}
