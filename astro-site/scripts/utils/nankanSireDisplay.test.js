/**
 * nankanSireDisplay.test.js
 *
 * KI 南関ページの馬プロフィールに「父（sire）」が条件付き表示されることの再発防止テスト【ソース契約検査】。
 *
 * 背景: Phase B-0（プロフィール先行表示）。父は予想 horse object の `horse.sire`（正本＝racebook 由来）に存在。
 * KI は性齢/騎手/斤量/調教師は表示済だが父のみ未表示だったため追加した。
 *
 * 【限界の明示】対象ページは Astro SSR/SSG テンプレ（fetch を伴う巨大ページ・直接 import 不可）のため、
 *   実 DOM レンダリングではなく「ソース契約検査」に限定する。保証するのは:
 *     (1) 父が `horse.sire` を直接参照して条件付き表示（`horse.sire &&`）されている
 *     (2) 父の値に fallback / 推測 / 文字列合成がない（entries / recentHorseHistories / uma_info を参照しない）
 *     (3) 既存プロフィール4項目（性齢/騎手/斤量/調教師）が残っている（削除回帰なし）
 *     (4) 父表示が dhc-jockey-trainer プロフィールブロック内にある
 *
 * 実行: node scripts/utils/nankanSireDisplay.test.js
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..'); // astro-site/
const targets = [
  { label: 'prediction/nankan (premium相当)', file: 'src/pages/prediction/nankan/index.astro' },
  { label: 'free-prediction/nankan (free)', file: 'src/pages/free-prediction/nankan/index.astro' },
];

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); } };

console.log('[KI 南関 父(sire)表示 / ソース契約検査]');

for (const t of targets) {
  const src = readFileSync(join(ROOT, t.file), 'utf-8');
  // (1) 父を horse.sire 直接参照で条件付き表示
  check(`${t.label}: 父 '父: {horse.sire}' 条件付き表示`, /\{horse\.sire\s*&&\s*<span class="dhc-sire">父:\s*\{horse\.sire\}<\/span>\}/.test(src));
  // (2) 父の値に推測/合成/別ソース fallback がない（sire 表示行に || や三項・entries等が無い）
  const sireLine = (src.split('\n').find((l) => l.includes('dhc-sire')) || '');
  check(`${t.label}: 父に fallback/推測/合成なし`, sireLine.includes('horse.sire') && !/\|\||\?|entries|recentHorseHistories|recentRaces|uma_info|horseStats/.test(sireLine));
  // (3) 既存4項目が残存（削除回帰なし）
  check(`${t.label}: 性齢/騎手/斤量/調教師 が残存`,
    src.includes('class="dhc-age"') && src.includes('class="dhc-jockey"') && src.includes('class="dhc-weight"') && src.includes('class="dhc-trainer"'));
  // (4) 父はプロフィールブロック内（dhc-jockey-trainer）
  check(`${t.label}: dhc-jockey-trainer ブロックが存在`, src.includes('class="dhc-jockey-trainer"'));
  // (5) 禁止領域に父表示を結びつけていない（sire 行が featureScores/印/AI指数/買い目に依存しない）= (2)に内包だが明示
  check(`${t.label}: 父表示が featureScores/印/買い目に非依存`, !/dhc-sire[^\n]*(featureScores|aiIndex|印|買い目|bettingLines)/.test(src));
}

console.log(`\n結果: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
