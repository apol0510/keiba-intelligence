// KI 馬単 F3 的中判定（単一源）。importResults.js / importResultsJra.js から共通利用する。
//
// 商品仕様（KI固有・AKとは別商品／統一しない）:
//   - メインレース: 本命軸 → 相手上位5頭の一方向のみ（reverseTopK = 0）。抑えなし。
//   - 通常レース  : 各軸 → 相手全頭への前進 + KI評価上位1〜3位のみ逆方向を追加（reverseTopK = 3）。
//                   評価順位4位以下は前進のみ。抑えなし。相手頭数は現行KIロジックが選ぶ全頭。
//   - 相手の並び順（買い目文字列の左→右）= KIの評価順位。位置 index < reverseTopK を逆方向対象とする。
//   - 抑え "(抑え...)" は F3 では生成しない。安全のため解析時に除外し候補外とする。
export function checkUmatanHit(bettingLine, result, reverseTopK = 0) {
  const match = String(bettingLine ?? '').match(/^(\d+)-(.+)$/);
  if (!match) return false;

  const axis = parseInt(match[1]);
  const aitePart = match[2];

  // 本線相手馬（評価順）。抑えは候補外なので除外して解析する。
  const mainPart = aitePart.replace(/\(抑え.+\)/, '');
  const mainAite = mainPart.split('.').map(n => parseInt(n)).filter(n => !isNaN(n));

  const first = result?.results?.[0]?.number;
  const second = result?.results?.[1]?.number;
  if (!first || !second) return false;

  // 前進: 軸が1着、相手（全頭）が2着
  if (axis === first && mainAite.includes(second)) return true;

  // 逆方向: 相手が1着、軸が2着（評価上位 reverseTopK 頭のみ）
  if (axis === second) {
    const idx = mainAite.indexOf(first);
    if (idx >= 0 && idx < reverseTopK) return true;
  }

  return false;
}
