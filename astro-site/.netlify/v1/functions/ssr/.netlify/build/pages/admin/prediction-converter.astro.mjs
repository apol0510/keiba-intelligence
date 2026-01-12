import { c as createAstro, d as createComponent, i as renderComponent, r as renderTemplate, m as maybeRenderHead, f as addAttribute } from '../../chunks/astro/server_BKC9sGbb.mjs';
import 'piccolore';
import { $ as $$BaseLayout } from '../../chunks/BaseLayout_iUX2XXnr.mjs';
/* empty css                                                   */
export { renderers } from '../../renderers.mjs';

const $$Astro = createAstro("https://keiba-intelligence.keiba.link");
const prerender = false;
const $$PredictionConverter = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$PredictionConverter;
  let result = null;
  let errorMessage = null;
  if (Astro2.request.method === "POST") {
    try {
      const formData = await Astro2.request.formData();
      const raceDate = formData.get("raceDate");
      const venue = formData.get("venue");
      const raceNumber = formData.get("raceNumber");
      const horseData = formData.get("horseData");
      const horses = parseInputData(horseData);
      const rolesAssigned = assignInitialRoles(horses);
      const rolesAdjusted = applyAdjustmentRules(rolesAssigned);
      const bettingLines = generateBettingLines(rolesAdjusted);
      const predictionJSON = outputJSON({
        raceDate,
        venue,
        raceNumber,
        horses: rolesAdjusted,
        bettingLines
      });
      result = {
        horses: rolesAdjusted,
        bettingLines,
        json: predictionJSON
      };
    } catch (error) {
      errorMessage = error.message;
    }
  }
  function parseInputData(rawInput) {
    const lines = rawInput.trim().split("\n");
    const horses = [];
    let currentHorse = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const roleMatch = line.match(/^[◎○▲△×]\s+(\d+)\s+(.+?)\s+(?:本命|対抗|単穴)$/);
      if (roleMatch) {
        currentHorse = {
          horseNumber: parseInt(roleMatch[1], 10),
          horseName: roleMatch[2],
          pt: null
        };
        continue;
      }
      const scoreMatch = line.match(/累積スコア[：:]\s*(\d+(?:\.\d+)?)pt/);
      if (scoreMatch && currentHorse) {
        currentHorse.pt = parseFloat(scoreMatch[1]);
        horses.push({ ...currentHorse });
        currentHorse = null;
        continue;
      }
      const shortMatch = line.match(/^(\d+)\s+(.+?)\s+\((\d+(?:\.\d+)?)pt\)/);
      if (shortMatch) {
        horses.push({
          horseNumber: parseInt(shortMatch[1], 10),
          horseName: shortMatch[2],
          pt: parseFloat(shortMatch[3])
        });
        continue;
      }
      const simpleMatch = line.match(/^(\d+)[,\s]+(.+?)[,\s]+(\d+(?:\.\d+)?)$/);
      if (simpleMatch) {
        horses.push({
          horseNumber: parseInt(simpleMatch[1], 10),
          horseName: simpleMatch[2],
          pt: parseFloat(simpleMatch[3])
        });
        continue;
      }
    }
    horses.sort((a, b) => {
      if (b.pt !== a.pt) return b.pt - a.pt;
      return a.horseNumber - b.horseNumber;
    });
    return horses;
  }
  function assignInitialRoles(horses) {
    if (horses.length < 4) {
      throw new Error("\u6700\u4F4E4\u982D\u5FC5\u8981\u3067\u3059\uFF08\u672C\u547D1/\u5BFE\u62971/\u5358\u7A742\uFF09");
    }
    const remaining = horses.slice(4);
    if (remaining.length === 0) {
      return horses.map((horse, index) => {
        let role = "";
        if (index === 0) role = "\u672C\u547D";
        else if (index === 1) role = "\u5BFE\u6297";
        else if (index === 2 || index === 3) role = "\u5358\u7A74";
        return { ...horse, role };
      });
    }
    const minPt = Math.min(...remaining.map((h) => h.pt));
    return horses.map((horse, index) => {
      let role = "";
      if (index === 0) role = "\u672C\u547D";
      else if (index === 1) role = "\u5BFE\u6297";
      else if (index === 2 || index === 3) role = "\u5358\u7A74";
      else if (horse.pt === minPt) role = "\u6291\u3048";
      else role = "\u9023\u4E0B";
      return { ...horse, role };
    });
  }
  function applyAdjustmentRules(horses) {
    let adjusted = [...horses];
    const honmei = adjusted.find((h) => h.role === "\u672C\u547D");
    const isHonmeiFixed = honmei && honmei.pt >= 89 && honmei.pt <= 90;
    if (!isHonmeiFixed) {
      const taikou = adjusted.find((h) => h.role === "\u5BFE\u6297");
      if (honmei && taikou && honmei.pt - taikou.pt <= 3) {
        if (taikou.horseNumber < honmei.horseNumber) {
          honmei.role = "\u5BFE\u6297";
          taikou.role = "\u672C\u547D";
        }
      }
    }
    if (!isHonmeiFixed) {
      const currentHonmei = adjusted.find((h) => h.role === "\u672C\u547D");
      if (currentHonmei && currentHonmei.pt <= 86) {
        const currentTaikou2 = adjusted.find((h) => h.role === "\u5BFE\u6297");
        const tananaList2 = adjusted.filter((h) => h.role === "\u5358\u7A74");
        if (currentTaikou2 && tananaList2.length > 0) {
          tananaList2.sort((a, b) => {
            if (b.pt !== a.pt) return b.pt - a.pt;
            return a.horseNumber - b.horseNumber;
          });
          currentHonmei.role = "\u5BFE\u6297";
          currentTaikou2.role = "\u672C\u547D";
          tananaList2[0].role = "\u5BFE\u6297";
        }
      }
    }
    const currentTaikou = adjusted.find((h) => h.role === "\u5BFE\u6297");
    const tananaList = adjusted.filter((h) => h.role === "\u5358\u7A74");
    if (currentTaikou && tananaList.length > 0) {
      tananaList.sort((a, b) => {
        if (b.pt !== a.pt) return b.pt - a.pt;
        return a.horseNumber - b.horseNumber;
      });
      const topTanana = tananaList[0];
      if (currentTaikou.pt - topTanana.pt <= 3) {
        if (topTanana.horseNumber < currentTaikou.horseNumber) {
          currentTaikou.role = "\u5358\u7A74";
          topTanana.role = "\u5BFE\u6297";
        }
      }
    }
    const finalTananaList = adjusted.filter((h) => h.role === "\u5358\u7A74");
    const renkaList = adjusted.filter((h) => h.role === "\u9023\u4E0B");
    if (finalTananaList.length === 2 && renkaList.length > 0) {
      finalTananaList.sort((a, b) => {
        if (b.pt !== a.pt) return b.pt - a.pt;
        return a.horseNumber - b.horseNumber;
      });
      renkaList.sort((a, b) => {
        if (b.pt !== a.pt) return b.pt - a.pt;
        return a.horseNumber - b.horseNumber;
      });
      const bottomTanana = finalTananaList[1];
      const topRenka = renkaList[0];
      if (bottomTanana.pt - topRenka.pt <= 2) {
        if (topRenka.horseNumber < bottomTanana.horseNumber) {
          bottomTanana.role = "\u9023\u4E0B";
          topRenka.role = "\u5358\u7A74";
        }
      }
    }
    const roleOrder = { "\u672C\u547D": 0, "\u5BFE\u6297": 1, "\u5358\u7A74": 2, "\u9023\u4E0B": 3, "\u6291\u3048": 4 };
    adjusted.sort((a, b) => {
      if (roleOrder[a.role] !== roleOrder[b.role]) return roleOrder[a.role] - roleOrder[b.role];
      if (b.pt !== a.pt) return b.pt - a.pt;
      return a.horseNumber - b.horseNumber;
    });
    return adjusted;
  }
  function generateBettingLines(horses) {
    const honmei = horses.find((h) => h.role === "\u672C\u547D");
    const taikou = horses.find((h) => h.role === "\u5BFE\u6297");
    const tanana = horses.filter((h) => h.role === "\u5358\u7A74");
    const renka = horses.filter((h) => h.role === "\u9023\u4E0B");
    const osae = horses.filter((h) => h.role === "\u6291\u3048");
    if (!honmei) throw new Error("\u672C\u547D\u304C\u5B58\u5728\u3057\u307E\u305B\u3093");
    if (!taikou) throw new Error("\u5BFE\u6297\u304C\u5B58\u5728\u3057\u307E\u305B\u3093");
    const osaeStr = osae.length > 0 ? `(\u6291\u3048${osae.map((h) => h.horseNumber).join(".")})` : "";
    const line1Horses = [taikou, ...tanana, ...renka].filter(Boolean);
    const line1 = `${honmei.horseNumber}-${line1Horses.map((h) => h.horseNumber).join(".")}${osaeStr}`;
    const line2Horses = [honmei, ...tanana, ...renka].filter(Boolean);
    const line2 = `${taikou.horseNumber}-${line2Horses.map((h) => h.horseNumber).join(".")}${osaeStr}`;
    return [line1, line2];
  }
  function outputJSON(data) {
    const { raceDate, venue, raceNumber, horses, bettingLines } = data;
    const output = {
      raceInfo: {
        date: raceDate,
        venue,
        raceNumber: parseInt(raceNumber, 10)
      },
      horses: horses.map((h) => ({
        horseNumber: h.horseNumber,
        horseName: h.horseName,
        pt: h.pt,
        role: h.role
      })),
      bettingLines: {
        umatan: Array.isArray(bettingLines) ? bettingLines : [bettingLines]
      },
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    return JSON.stringify(output, null, 2);
  }
  return renderTemplate`<!-- <AuthCheck /> 一時的に無効化 -->${renderComponent($$result, "BaseLayout", $$BaseLayout, { "title": "\u4E88\u60F3\u7BA1\u7406\u753B\u9762", "description": "\u7279\u5FB4\u91CF\u30C7\u30FC\u30BF\u3092\u5165\u529B\u3057\u3066JSON\u4E88\u60F3\u30C7\u30FC\u30BF\u3092\u751F\u6210\u3057\u307E\u3059", "data-astro-cid-ri35buz5": true }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<section class="admin-section" data-astro-cid-ri35buz5> <div class="container" data-astro-cid-ri35buz5> <h1 class="page-title" data-astro-cid-ri35buz5>予想管理画面（Prediction Converter）</h1> <p class="page-description" data-astro-cid-ri35buz5>
レース情報と馬データ（pt値）を入力して、予想JSONを生成します。<br data-astro-cid-ri35buz5> <strong data-astro-cid-ri35buz5>※ pt値は外部で計算済みの値を入力してください（このツールではpt計算を行いません）</strong> </p> <!-- 入力フォーム --> <div class="card form-card" data-astro-cid-ri35buz5> <h2 data-astro-cid-ri35buz5>レース情報・馬データ入力</h2> <form method="POST" data-astro-cid-ri35buz5> <div class="form-group" data-astro-cid-ri35buz5> <label for="raceDate" data-astro-cid-ri35buz5>開催日</label> <input type="date" id="raceDate" name="raceDate" required class="form-input" data-astro-cid-ri35buz5> </div> <div class="form-group" data-astro-cid-ri35buz5> <label for="venue" data-astro-cid-ri35buz5>競馬場</label> <select id="venue" name="venue" required class="form-input" data-astro-cid-ri35buz5> <option value="" data-astro-cid-ri35buz5>選択してください</option> <option value="大井" data-astro-cid-ri35buz5>大井</option> <option value="川崎" data-astro-cid-ri35buz5>川崎</option> <option value="船橋" data-astro-cid-ri35buz5>船橋</option> <option value="浦和" data-astro-cid-ri35buz5>浦和</option> </select> </div> <div class="form-group" data-astro-cid-ri35buz5> <label for="raceNumber" data-astro-cid-ri35buz5>レース番号</label> <input type="number" id="raceNumber" name="raceNumber" min="1" max="12" required class="form-input" data-astro-cid-ri35buz5> </div> <div class="form-group" data-astro-cid-ri35buz5> <label for="horseData" data-astro-cid-ri35buz5>馬データ（1行1頭：馬番,馬名,pt）</label> <textarea id="horseData" name="horseData" rows="12" required class="form-textarea" placeholder="例:
1,マコスペシャル,90.5
2,クロチャンプ,86.2
3,ケイバスター,82.0
4,ナンカンキング,77.3
5,オオイプリンス,70.0" data-astro-cid-ri35buz5></textarea> </div> <button type="submit" class="btn btn-primary btn-lg w-full" data-astro-cid-ri35buz5>
予想データ生成
</button> </form> </div> <!-- エラー表示 --> ${errorMessage && renderTemplate`<div class="card error-card" data-astro-cid-ri35buz5> <h3 data-astro-cid-ri35buz5>エラー</h3> <p data-astro-cid-ri35buz5>${errorMessage}</p> </div>`} <!-- 結果表示 --> ${result && renderTemplate`<div class="results-section" data-astro-cid-ri35buz5> <div class="race-card card" data-astro-cid-ri35buz5> <h2 class="section-title" data-astro-cid-ri35buz5>生成結果</h2> <!-- pt一覧表示 --> <div class="pt-summary" data-astro-cid-ri35buz5> <h3 data-astro-cid-ri35buz5>📊 pt一覧（同点馬番昇順）</h3> <div class="pt-display" data-astro-cid-ri35buz5> ${result.horses.map((h, i) => renderTemplate`<span class="pt-item" data-astro-cid-ri35buz5> ${h.horseNumber}(${h.pt})${i < result.horses.length - 1 ? " / " : ""} </span>`)} </div> <button type="button" class="btn btn-secondary btn-sm mt-2"${addAttribute(`navigator.clipboard.writeText('${result.horses.map((h) => `${h.horseNumber}:${h.pt}`).join(" / ")}').then(() => alert('pt\u4E00\u89A7\u3092\u30B3\u30D4\u30FC\u3057\u307E\u3057\u305F\uFF01'))`, "onclick")} data-astro-cid-ri35buz5>
📋 pt一覧をコピー
</button> </div> <!-- 買い目表示 --> <div class="betting-section" data-astro-cid-ri35buz5> <h3 data-astro-cid-ri35buz5>🎯 買い目（馬単）2段構成</h3> <div class="betting-lines-container" data-astro-cid-ri35buz5> ${Array.isArray(result.bettingLines) ? result.bettingLines.map((line, index) => renderTemplate`<div class="betting-line-item" data-astro-cid-ri35buz5> <span class="line-number" data-astro-cid-ri35buz5>${index === 0 ? "\u672C\u547D\u8EF8" : "\u5BFE\u6297\u8EF8"}</span> <span class="betting-line" data-astro-cid-ri35buz5>${line}</span> </div>`) : renderTemplate`<div class="betting-line-item" data-astro-cid-ri35buz5> <span class="betting-line" data-astro-cid-ri35buz5>${result.bettingLines}</span> </div>`} </div> </div> <!-- 役割別馬一覧 --> <div class="horses-prediction" data-astro-cid-ri35buz5> <h3 data-astro-cid-ri35buz5>🏇 役割別馬一覧</h3> <!-- 本命・対抗・単穴 --> <div class="top-horses" data-astro-cid-ri35buz5> ${result.horses.filter((h) => ["\u672C\u547D", "\u5BFE\u6297", "\u5358\u7A74"].includes(h.role)).map((horse) => renderTemplate`<div${addAttribute(`horse-item ${horse.role === "\u672C\u547D" ? "honmei" : horse.role === "\u5BFE\u6297" ? "taikou" : "tanana"}`, "class")} data-astro-cid-ri35buz5> <div class="horse-mark" data-astro-cid-ri35buz5> ${horse.role === "\u672C\u547D" ? "\u25CE" : horse.role === "\u5BFE\u6297" ? "\u25CB" : "\u25B2"} </div> <div class="horse-info" data-astro-cid-ri35buz5> <div class="horse-header-line" data-astro-cid-ri35buz5> <span class="horse-number" data-astro-cid-ri35buz5>${horse.horseNumber}</span> <span class="horse-name" data-astro-cid-ri35buz5>${horse.horseName}</span> <span class="role-badge" data-astro-cid-ri35buz5>${horse.role}</span> </div> <div class="horse-score" data-astro-cid-ri35buz5>
累積スコア: <strong data-astro-cid-ri35buz5>${horse.pt}pt</strong> </div> </div> </div>`)} </div> <!-- 連下候補馬 --> ${result.horses.filter((h) => h.role === "\u9023\u4E0B").length > 0 && renderTemplate`<div class="horse-group renka" data-astro-cid-ri35buz5> <div class="group-header" data-astro-cid-ri35buz5>△ 連下候補馬</div> <div class="group-list" data-astro-cid-ri35buz5> ${result.horses.filter((h) => h.role === "\u9023\u4E0B").map((horse, index, arr) => renderTemplate`<span class="horse-compact" data-astro-cid-ri35buz5> <strong data-astro-cid-ri35buz5>${horse.horseNumber}</strong> ${horse.horseName} <span class="pt-value" data-astro-cid-ri35buz5>(${horse.pt}pt)</span>${index < arr.length - 1 ? "\u3001" : ""} </span>`)} </div> </div>`} <!-- 抑え候補馬 --> ${result.horses.filter((h) => h.role === "\u6291\u3048").length > 0 && renderTemplate`<div class="horse-group osae" data-astro-cid-ri35buz5> <div class="group-header" data-astro-cid-ri35buz5>× 抑え候補馬</div> <div class="group-list" data-astro-cid-ri35buz5> ${result.horses.filter((h) => h.role === "\u6291\u3048").map((horse, index, arr) => renderTemplate`<span class="horse-compact" data-astro-cid-ri35buz5> <strong data-astro-cid-ri35buz5>${horse.horseNumber}</strong> ${horse.horseName} <span class="pt-value" data-astro-cid-ri35buz5>(${horse.pt}pt)</span>${index < arr.length - 1 ? "\u3001" : ""} </span>`)} </div> </div>`} </div> <!-- JSON出力 --> <div class="json-output" data-astro-cid-ri35buz5> <h3 data-astro-cid-ri35buz5>JSON出力（予想ページ用）</h3> <textarea readonly rows="20" class="json-textarea" data-astro-cid-ri35buz5>${result.json}</textarea> <button type="button" class="btn btn-secondary mt-2" onclick="navigator.clipboard.writeText(this.previousElementSibling.value).then(() => alert('JSONをコピーしました！'))" data-astro-cid-ri35buz5>
JSONをコピー
</button> </div> </div> </div>`} <!-- 使用方法 --> <div class="card info-card" data-astro-cid-ri35buz5> <h2 data-astro-cid-ri35buz5>使用方法</h2> <ol data-astro-cid-ri35buz5> <li data-astro-cid-ri35buz5><strong data-astro-cid-ri35buz5>pt値の準備:</strong> 外部ツールでpt値を計算してください</li> <li data-astro-cid-ri35buz5><strong data-astro-cid-ri35buz5>データ入力:</strong> レース情報と馬データ（馬番,馬名,pt）を入力</li> <li data-astro-cid-ri35buz5><strong data-astro-cid-ri35buz5>生成実行:</strong> 「予想データ生成」ボタンをクリック</li> <li data-astro-cid-ri35buz5><strong data-astro-cid-ri35buz5>JSON保存:</strong> 生成されたJSONをコピーして、予想データファイルに保存</li> <li data-astro-cid-ri35buz5><strong data-astro-cid-ri35buz5>Git管理:</strong> 変更をコミット・プッシュして自動デプロイ</li> </ol> <h3 data-astro-cid-ri35buz5>処理ロジック概要</h3> <ul data-astro-cid-ri35buz5> <li data-astro-cid-ri35buz5><strong data-astro-cid-ri35buz5>初期割当:</strong> pt降順で本命/対抗/単穴/連下/抑えを仮割当</li> <li data-astro-cid-ri35buz5><strong data-astro-cid-ri35buz5>調整ルール①:</strong> 本命ptが89〜90pt → 本命枠のみ絶対軸固定</li> <li data-astro-cid-ri35buz5><strong data-astro-cid-ri35buz5>調整ルール②:</strong> 本命と対抗のpt差が3pt以内 → 入れ替え判定</li> <li data-astro-cid-ri35buz5><strong data-astro-cid-ri35buz5>調整ルール③:</strong> 本命ptが86pt以下 → 対抗を本命に昇格</li> <li data-astro-cid-ri35buz5><strong data-astro-cid-ri35buz5>調整ルール④:</strong> 対抗と単穴最上位のpt差が3pt以内 → 入れ替え判定</li> <li data-astro-cid-ri35buz5><strong data-astro-cid-ri35buz5>調整ルール⑤:</strong> 単穴下位と連下最上位のpt差が2pt以内 → 入れ替え判定</li> <li data-astro-cid-ri35buz5><strong data-astro-cid-ri35buz5>同点ルール:</strong> 全ての比較・ソートで馬番昇順を採用</li> </ul> </div> </div> </section>  ` })}`;
}, "/Users/apolon/Library/Mobile Documents/com~apple~CloudDocs/WorkSpace/keiba-intelligence/astro-site/src/pages/admin/prediction-converter.astro", void 0);

const $$file = "/Users/apolon/Library/Mobile Documents/com~apple~CloudDocs/WorkSpace/keiba-intelligence/astro-site/src/pages/admin/prediction-converter.astro";
const $$url = "/admin/prediction-converter";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$PredictionConverter,
  file: $$file,
  prerender,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
