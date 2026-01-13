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
  let previewResults = null;
  let generateResults = null;
  let errors = [];
  let action = null;
  if (Astro2.request.method === "POST") {
    try {
      const formData = await Astro2.request.formData();
      action = formData.get("action");
      const raceDate = formData.get("raceDate");
      const venue = formData.get("venue");
      const allRacesData = formData.get("allRacesData");
      const racesData = parseAllRaces(allRacesData);
      if (action === "preview") {
        previewResults = [];
        errors = [];
        for (const raceData of racesData) {
          try {
            const horses = parseInputData(raceData.horseData);
            previewResults.push({
              raceNumber: raceData.raceNumber,
              horseCount: horses.length,
              topHorse: horses[0] || null,
              secondHorse: horses[1] || null
            });
          } catch (error) {
            errors.push({
              raceNumber: raceData.raceNumber,
              message: error.message
            });
          }
        }
      } else if (action === "generate") {
        generateResults = [];
        errors = [];
        for (const raceData of racesData) {
          try {
            const horses = parseInputData(raceData.horseData);
            const rolesAssigned = assignInitialRoles(horses);
            const rolesAdjusted = applyAdjustmentRules(rolesAssigned);
            const bettingLines = generateBettingLines(rolesAdjusted);
            const predictionJSON = outputJSON({
              raceDate,
              venue,
              raceNumber: raceData.raceNumber,
              horses: rolesAdjusted,
              bettingLines
            });
            generateResults.push({
              raceNumber: raceData.raceNumber,
              horses: rolesAdjusted,
              bettingLines,
              json: predictionJSON
            });
          } catch (error) {
            errors.push({
              raceNumber: raceData.raceNumber,
              message: error.message
            });
          }
        }
        if (generateResults.length > 0) {
          const allPredictionsJSON = outputAllRacesJSON({
            raceDate,
            venue,
            races: generateResults
          });
          generateResults.allPredictionsJSON = allPredictionsJSON;
        }
      }
    } catch (error) {
      errors.push({
        raceNumber: "ALL",
        message: error.message
      });
    }
  }
  function parseAllRaces(rawInput) {
    const races = [];
    const lines = rawInput.trim().split("\n");
    let currentRaceNumber = null;
    let currentRaceData = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const raceMatch = line.match(/^===(\d+)R===/);
      if (raceMatch) {
        if (currentRaceNumber !== null && currentRaceData.length > 0) {
          races.push({
            raceNumber: currentRaceNumber,
            horseData: currentRaceData.join("\n")
          });
        }
        currentRaceNumber = parseInt(raceMatch[1], 10);
        currentRaceData = [];
        continue;
      }
      if (currentRaceNumber !== null && line) {
        currentRaceData.push(line);
      }
    }
    if (currentRaceNumber !== null && currentRaceData.length > 0) {
      races.push({
        raceNumber: currentRaceNumber,
        horseData: currentRaceData.join("\n")
      });
    }
    return races;
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
  function outputAllRacesJSON(data) {
    const { raceDate, venue, races } = data;
    const output = {
      eventInfo: {
        date: raceDate,
        venue,
        totalRaces: races.length
      },
      predictions: races.map((race) => {
        const raceData = JSON.parse(race.json);
        return raceData;
      }),
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    return JSON.stringify(output, null, 2);
  }
  return renderTemplate`<!-- <AuthCheck /> 一時的に無効化 -->${renderComponent($$result, "BaseLayout", $$BaseLayout, { "title": "\u4E88\u60F3\u7BA1\u7406\u753B\u9762\uFF08\u516812\u30EC\u30FC\u30B9\u4E00\u62EC\u751F\u6210\uFF09", "description": "\u516812\u30EC\u30FC\u30B9\u306E\u7279\u5FB4\u91CF\u30C7\u30FC\u30BF\u3092\u4E00\u62EC\u5165\u529B\u3057\u3066JSON\u4E88\u60F3\u30C7\u30FC\u30BF\u3092\u751F\u6210\u3057\u307E\u3059", "data-astro-cid-ri35buz5": true }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<section class="admin-section" data-astro-cid-ri35buz5> <div class="container" data-astro-cid-ri35buz5> <h1 class="page-title" data-astro-cid-ri35buz5>予想管理画面（全12レース一括生成）</h1> <p class="page-description" data-astro-cid-ri35buz5>
開催日・競馬場を指定し、全12レースのデータを一括入力して予想JSONを生成します。<br data-astro-cid-ri35buz5> <strong data-astro-cid-ri35buz5>※ pt値は外部で計算済みの値を入力してください</strong><br data-astro-cid-ri35buz5> <strong data-astro-cid-ri35buz5>※ エラーレースはスキップされ、成功分のみ出力されます</strong> </p> <!-- 入力フォーム --> <div class="card form-card" data-astro-cid-ri35buz5> <h2 data-astro-cid-ri35buz5>開催情報・全レースデータ入力</h2> <form method="POST" data-astro-cid-ri35buz5> <div class="form-group" data-astro-cid-ri35buz5> <label for="raceDate" data-astro-cid-ri35buz5>開催日</label> <input type="date" id="raceDate" name="raceDate" required class="form-input" data-astro-cid-ri35buz5> </div> <div class="form-group" data-astro-cid-ri35buz5> <label for="venue" data-astro-cid-ri35buz5>競馬場</label> <select id="venue" name="venue" required class="form-input" data-astro-cid-ri35buz5> <option value="" data-astro-cid-ri35buz5>選択してください</option> <option value="大井" data-astro-cid-ri35buz5>大井</option> <option value="川崎" data-astro-cid-ri35buz5>川崎</option> <option value="船橋" data-astro-cid-ri35buz5>船橋</option> <option value="浦和" data-astro-cid-ri35buz5>浦和</option> </select> </div> <div class="form-group" data-astro-cid-ri35buz5> <label for="allRacesData" data-astro-cid-ri35buz5>全12レースデータ（===1R===区切り）</label> <textarea id="allRacesData" name="allRacesData" rows="30" required class="form-textarea" placeholder="例:
===1R===
1,マコスペシャル,90.5
2,クロチャンプ,86.2
3,ケイバスター,82.0
4,ナンカンキング,77.3

===2R===
1,オオイプリンス,88.0
2,カワサキホープ,84.5
...

===12R===
..." data-astro-cid-ri35buz5></textarea> </div> <div class="button-group" data-astro-cid-ri35buz5> <button type="submit" name="action" value="preview" class="btn btn-secondary btn-lg" data-astro-cid-ri35buz5>
📊 プレビュー（確認のみ）
</button> <button type="submit" name="action" value="generate" class="btn btn-primary btn-lg" data-astro-cid-ri35buz5>
🚀 全レース生成
</button> </div> </form> </div> <!-- エラー一覧 --> ${errors.length > 0 && renderTemplate`<div class="card error-card" data-astro-cid-ri35buz5> <h3 data-astro-cid-ri35buz5>⚠️ エラー一覧（${errors.length}件）</h3> <ul class="error-list" data-astro-cid-ri35buz5> ${errors.map((err) => renderTemplate`<li data-astro-cid-ri35buz5> <strong data-astro-cid-ri35buz5>${err.raceNumber === "ALL" ? "\u5168\u4F53\u30A8\u30E9\u30FC" : `${err.raceNumber}R`}:</strong> ${err.message} </li>`)} </ul> </div>`} <!-- プレビュー結果 --> ${previewResults && renderTemplate`<div class="card preview-card" data-astro-cid-ri35buz5> <h2 data-astro-cid-ri35buz5>📊 プレビュー結果（${previewResults.length}レース）</h2> <div class="preview-grid" data-astro-cid-ri35buz5> ${previewResults.map((race) => renderTemplate`<div class="preview-item" data-astro-cid-ri35buz5> <div class="preview-header" data-astro-cid-ri35buz5>${race.raceNumber}R</div> <div class="preview-body" data-astro-cid-ri35buz5> <div class="preview-stat" data-astro-cid-ri35buz5>頭数: <strong data-astro-cid-ri35buz5>${race.horseCount}頭</strong></div> ${race.topHorse && renderTemplate`<div class="preview-stat" data-astro-cid-ri35buz5>本命候補: <strong data-astro-cid-ri35buz5>${race.topHorse.horseNumber}.${race.topHorse.horseName} (${race.topHorse.pt}pt)</strong></div>`} ${race.secondHorse && renderTemplate`<div class="preview-stat" data-astro-cid-ri35buz5>対抗候補: <strong data-astro-cid-ri35buz5>${race.secondHorse.horseNumber}.${race.secondHorse.horseName} (${race.secondHorse.pt}pt)</strong></div>`} </div> </div>`)} </div> <p class="preview-note" data-astro-cid-ri35buz5>
✅ 問題なければ「全レース生成」ボタンをクリックして本番生成してください
</p> </div>`} <!-- 生成結果 --> ${generateResults && generateResults.length > 0 && renderTemplate`<div class="results-section" data-astro-cid-ri35buz5> <div class="card success-card" data-astro-cid-ri35buz5> <h2 data-astro-cid-ri35buz5>✅ 生成成功（${generateResults.length}レース）</h2> </div> <!-- 全レース統合JSON --> <div class="card all-json-card" data-astro-cid-ri35buz5> <h2 data-astro-cid-ri35buz5>📦 全レース統合JSON（${generateResults.length}レース分）</h2> <textarea readonly rows="15" class="json-textarea" id="allPredictionsJSON" data-astro-cid-ri35buz5>${generateResults.allPredictionsJSON}</textarea> <button type="button" class="btn btn-primary mt-2" onclick="navigator.clipboard.writeText(document.getElementById('allPredictionsJSON').value).then(() => alert('全レース統合JSONをコピーしました！'))" data-astro-cid-ri35buz5>
📋 全レース統合JSONをコピー
</button> </div> <!-- 各レース詳細（折りたたみ） --> ${generateResults.map((race, index) => renderTemplate`<details class="race-details"${addAttribute(index === 0, "open")} data-astro-cid-ri35buz5> <summary class="race-summary" data-astro-cid-ri35buz5>${race.raceNumber}R - 本命: ${race.horses.find((h) => h.role === "\u672C\u547D")?.horseNumber}.${race.horses.find((h) => h.role === "\u672C\u547D")?.horseName} / 対抗: ${race.horses.find((h) => h.role === "\u5BFE\u6297")?.horseNumber}.${race.horses.find((h) => h.role === "\u5BFE\u6297")?.horseName}</summary> <div class="race-card" data-astro-cid-ri35buz5> <!-- pt一覧表示 --> <div class="pt-summary" data-astro-cid-ri35buz5> <h3 data-astro-cid-ri35buz5>📊 pt一覧（同点馬番昇順）</h3> <div class="pt-display" data-astro-cid-ri35buz5> ${race.horses.map((h, i) => renderTemplate`<span class="pt-item" data-astro-cid-ri35buz5> ${h.horseNumber}(${h.pt})${i < race.horses.length - 1 ? " / " : ""} </span>`)} </div> </div> <!-- 買い目表示 --> <div class="betting-section" data-astro-cid-ri35buz5> <h3 data-astro-cid-ri35buz5>🎯 買い目（馬単）2段構成</h3> <div class="betting-lines-container" data-astro-cid-ri35buz5> ${Array.isArray(race.bettingLines) ? race.bettingLines.map((line, idx) => renderTemplate`<div class="betting-line-item" data-astro-cid-ri35buz5> <span class="line-number" data-astro-cid-ri35buz5>${idx === 0 ? "\u672C\u547D\u8EF8" : "\u5BFE\u6297\u8EF8"}</span> <span class="betting-line" data-astro-cid-ri35buz5>${line}</span> </div>`) : renderTemplate`<div class="betting-line-item" data-astro-cid-ri35buz5> <span class="betting-line" data-astro-cid-ri35buz5>${race.bettingLines}</span> </div>`} </div> </div> <!-- 役割別馬一覧 --> <div class="horses-prediction" data-astro-cid-ri35buz5> <h3 data-astro-cid-ri35buz5>🏇 役割別馬一覧</h3> <!-- 本命・対抗・単穴 --> <div class="top-horses" data-astro-cid-ri35buz5> ${race.horses.filter((h) => ["\u672C\u547D", "\u5BFE\u6297", "\u5358\u7A74"].includes(h.role)).map((horse) => renderTemplate`<div${addAttribute(`horse-item ${horse.role === "\u672C\u547D" ? "honmei" : horse.role === "\u5BFE\u6297" ? "taikou" : "tanana"}`, "class")} data-astro-cid-ri35buz5> <div class="horse-mark" data-astro-cid-ri35buz5> ${horse.role === "\u672C\u547D" ? "\u25CE" : horse.role === "\u5BFE\u6297" ? "\u25CB" : "\u25B2"} </div> <div class="horse-info" data-astro-cid-ri35buz5> <div class="horse-header-line" data-astro-cid-ri35buz5> <span class="horse-number" data-astro-cid-ri35buz5>${horse.horseNumber}</span> <span class="horse-name" data-astro-cid-ri35buz5>${horse.horseName}</span> <span class="role-badge" data-astro-cid-ri35buz5>${horse.role}</span> </div> <div class="horse-score" data-astro-cid-ri35buz5>
累積スコア: <strong data-astro-cid-ri35buz5>${horse.pt}pt</strong> </div> </div> </div>`)} </div> <!-- 連下候補馬 --> ${race.horses.filter((h) => h.role === "\u9023\u4E0B").length > 0 && renderTemplate`<div class="horse-group renka" data-astro-cid-ri35buz5> <div class="group-header" data-astro-cid-ri35buz5>△ 連下候補馬</div> <div class="group-list" data-astro-cid-ri35buz5> ${race.horses.filter((h) => h.role === "\u9023\u4E0B").map((horse, idx, arr) => renderTemplate`<span class="horse-compact" data-astro-cid-ri35buz5> <strong data-astro-cid-ri35buz5>${horse.horseNumber}</strong> ${horse.horseName} <span class="pt-value" data-astro-cid-ri35buz5>(${horse.pt}pt)</span>${idx < arr.length - 1 ? "\u3001" : ""} </span>`)} </div> </div>`} <!-- 抑え候補馬 --> ${race.horses.filter((h) => h.role === "\u6291\u3048").length > 0 && renderTemplate`<div class="horse-group osae" data-astro-cid-ri35buz5> <div class="group-header" data-astro-cid-ri35buz5>× 抑え候補馬</div> <div class="group-list" data-astro-cid-ri35buz5> ${race.horses.filter((h) => h.role === "\u6291\u3048").map((horse, idx, arr) => renderTemplate`<span class="horse-compact" data-astro-cid-ri35buz5> <strong data-astro-cid-ri35buz5>${horse.horseNumber}</strong> ${horse.horseName} <span class="pt-value" data-astro-cid-ri35buz5>(${horse.pt}pt)</span>${idx < arr.length - 1 ? "\u3001" : ""} </span>`)} </div> </div>`} </div> <!-- 個別JSON出力 --> <div class="json-output" data-astro-cid-ri35buz5> <h3 data-astro-cid-ri35buz5>個別JSON（${race.raceNumber}R）</h3> <textarea readonly rows="15" class="json-textarea"${addAttribute(`json-${race.raceNumber}`, "id")} data-astro-cid-ri35buz5>${race.json}</textarea> <button type="button" class="btn btn-secondary mt-2"${addAttribute(`navigator.clipboard.writeText(document.getElementById('json-${race.raceNumber}').value).then(() => alert('${race.raceNumber}R\u306EJSON\u3092\u30B3\u30D4\u30FC\u3057\u307E\u3057\u305F\uFF01'))`, "onclick")} data-astro-cid-ri35buz5>
📋 ${race.raceNumber}R JSONをコピー
</button> </div> </div> </details>`)} </div>`} <!-- 使用方法 --> <div class="card info-card" data-astro-cid-ri35buz5> <h2 data-astro-cid-ri35buz5>使用方法</h2> <ol data-astro-cid-ri35buz5> <li data-astro-cid-ri35buz5><strong data-astro-cid-ri35buz5>pt値の準備:</strong> 外部ツールで全12レース分のpt値を計算</li> <li data-astro-cid-ri35buz5><strong data-astro-cid-ri35buz5>データ入力:</strong> 開催日・競馬場を入力後、全レースデータを===1R===区切りで入力</li> <li data-astro-cid-ri35buz5><strong data-astro-cid-ri35buz5>プレビュー:</strong> 「プレビュー」ボタンで頭数・本命候補を確認（エラーレース確認）</li> <li data-astro-cid-ri35buz5><strong data-astro-cid-ri35buz5>生成実行:</strong> 「全レース生成」ボタンで本番生成</li> <li data-astro-cid-ri35buz5><strong data-astro-cid-ri35buz5>JSON保存:</strong> 全レース統合JSONをコピーして予想データファイルに保存</li> <li data-astro-cid-ri35buz5><strong data-astro-cid-ri35buz5>Git管理:</strong> 変更をコミット・プッシュして自動デプロイ</li> </ol> <h3 data-astro-cid-ri35buz5>入力フォーマット例</h3> <pre class="format-example" data-astro-cid-ri35buz5>===1R===
1,マコスペシャル,90.5
2,クロチャンプ,86.2
3,ケイバスター,82.0
4,ナンカンキング,77.3

===2R===
1,オオイプリンス,88.0
2,カワサキホープ,84.5
...

===12R===
...</pre> <h3 data-astro-cid-ri35buz5>エラーハンドリング</h3> <ul data-astro-cid-ri35buz5> <li data-astro-cid-ri35buz5>エラーレースは自動でスキップされ、成功分のみ出力されます</li> <li data-astro-cid-ri35buz5>エラー詳細はページ上部に表示されます（レース番号+エラー内容）</li> <li data-astro-cid-ri35buz5>最低4頭（本命/対抗/単穴2）必要です</li> </ul> <h3 data-astro-cid-ri35buz5>処理ロジック概要</h3> <ul data-astro-cid-ri35buz5> <li data-astro-cid-ri35buz5><strong data-astro-cid-ri35buz5>初期割当:</strong> pt降順で本命/対抗/単穴/連下/抑えを仮割当</li> <li data-astro-cid-ri35buz5><strong data-astro-cid-ri35buz5>調整ルール①:</strong> 本命ptが89〜90pt → 本命枠のみ絶対軸固定</li> <li data-astro-cid-ri35buz5><strong data-astro-cid-ri35buz5>調整ルール②:</strong> 本命と対抗のpt差が3pt以内 → 入れ替え判定</li> <li data-astro-cid-ri35buz5><strong data-astro-cid-ri35buz5>調整ルール③:</strong> 本命ptが86pt以下 → 対抗を本命に昇格</li> <li data-astro-cid-ri35buz5><strong data-astro-cid-ri35buz5>調整ルール④:</strong> 対抗と単穴最上位のpt差が3pt以内 → 入れ替え判定</li> <li data-astro-cid-ri35buz5><strong data-astro-cid-ri35buz5>調整ルール⑤:</strong> 単穴下位と連下最上位のpt差が2pt以内 → 入れ替え判定</li> <li data-astro-cid-ri35buz5><strong data-astro-cid-ri35buz5>同点ルール:</strong> 全ての比較・ソートで馬番昇順を採用</li> </ul> </div> </div> </section>  ` })}`;
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
