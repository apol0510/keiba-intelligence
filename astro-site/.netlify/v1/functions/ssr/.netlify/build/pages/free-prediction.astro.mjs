import { d as createComponent, i as renderComponent, r as renderTemplate, m as maybeRenderHead, f as addAttribute } from '../chunks/astro/server_BKC9sGbb.mjs';
import 'piccolore';
import { $ as $$BaseLayout } from '../chunks/BaseLayout_EN32_9Bi.mjs';
/* empty css                                           */
export { renderers } from '../renderers.mjs';

const prerender = true;
const $$FreePrediction = createComponent(($$result, $$props, $$slots) => {
  const todayDate = "2026-01-10\uFF08\u91D1\uFF09";
  const venue = "\u5927\u4E95\u7AF6\u99AC\u5834";
  const totalRaces = 12;
  const samplePredictions = [
    {
      raceNumber: 10,
      raceName: "\u7B2C10R \u6C5F\u6238\u524D\u7279\u5225",
      distance: "\u30C0\u30FC\u30C81200m",
      grade: "3\u6B73\u4EE5\u4E0A\u30AA\u30FC\u30D7\u30F3",
      weather: "\u6674",
      track: "\u826F",
      horses: [
        { number: 3, name: "\u30B9\u30D4\u30FC\u30C9\u30B9\u30BF\u30FC", confidence: 95, prediction: "\u25CE", odds: 2.1 },
        { number: 7, name: "\u30B5\u30F3\u30E9\u30A4\u30BA\u30AD\u30F3\u30B0", confidence: 82, prediction: "\u25CB", odds: 4.5 },
        { number: 1, name: "\u30C0\u30C3\u30B7\u30E5\u30A6\u30A7\u30FC\u30D6", confidence: 71, prediction: "\u25B2", odds: 6.8 },
        { number: 5, name: "\u30A8\u30FC\u30B9\u30D5\u30A1\u30A4\u30BF\u30FC", confidence: 58, prediction: "\u25B3", odds: 11.2 },
        { number: 9, name: "\u30E9\u30D4\u30C3\u30C9\u30D5\u30A9\u30FC\u30B9", confidence: 45, prediction: "\u2606", odds: 15.3 }
      ],
      aiComment: "\u25CE3\u756A\u30B9\u30D4\u30FC\u30C9\u30B9\u30BF\u30FC\u306F\u524D\u8D70\u597D\u5185\u5BB9\u3067\u4ECA\u56DE\u3082\u8EF8\u3068\u3057\u3066\u4FE1\u983C\u3067\u304D\u307E\u3059\u3002\u25CB7\u756A\u30B5\u30F3\u30E9\u30A4\u30BA\u30AD\u30F3\u30B0\u306F\u5C55\u958B\u304C\u5411\u3051\u3070\u5C4A\u304F\u4F4D\u7F6E\u306B\u3044\u307E\u3059\u3002"
    },
    {
      raceNumber: 11,
      raceName: "\u7B2C11R \u6771\u4EAC\u6E7E\u30AB\u30C3\u30D7",
      distance: "\u30C0\u30FC\u30C81600m",
      grade: "3\u6B73\u4EE5\u4E0AA1",
      weather: "\u6674",
      track: "\u826F",
      horses: [
        { number: 5, name: "\u30B4\u30FC\u30EB\u30C9\u30E9\u30C3\u30B7\u30E5", confidence: 91, prediction: "\u25CE", odds: 3.2 },
        { number: 2, name: "\u30B9\u30C6\u30A3\u30FC\u30EB\u30CF\u30FC\u30C8", confidence: 85, prediction: "\u25CB", odds: 4.1 },
        { number: 8, name: "\u30D5\u30A1\u30A4\u30A2\u30FC\u30DC\u30FC\u30EB", confidence: 74, prediction: "\u25B2", odds: 5.9 },
        { number: 4, name: "\u30B5\u30F3\u30C0\u30FC\u30DC\u30EB\u30C8", confidence: 62, prediction: "\u25B3", odds: 9.5 },
        { number: 1, name: "\u30D6\u30EC\u30A4\u30BA\u30AD\u30F3\u30B0", confidence: 51, prediction: "\u2606", odds: 13.7 }
      ],
      aiComment: "\u25CE5\u756A\u30B4\u30FC\u30EB\u30C9\u30E9\u30C3\u30B7\u30E5\u306F\u8FD13\u8D70\u5B89\u5B9A\u3057\u3066\u304A\u308A\u4ECA\u56DE\u3082\u4E2D\u5FC3\u3002\u25CB2\u756A\u30B9\u30C6\u30A3\u30FC\u30EB\u30CF\u30FC\u30C8\u306F\u5185\u67A0\u6709\u5229\u3067\u5DEE\u3057\u5207\u308B\u53EF\u80FD\u6027\u3042\u308A\u3002"
    },
    {
      raceNumber: 12,
      raceName: "\u7B2C12R \u7FBD\u7530\u76C3",
      distance: "\u30C0\u30FC\u30C82000m",
      grade: "3\u6B73\u4EE5\u4E0AA2",
      weather: "\u6674",
      track: "\u826F",
      horses: [
        { number: 6, name: "\u30DE\u30A4\u30C6\u30A3\u30FC\u30AD\u30F3\u30B0", confidence: 88, prediction: "\u25CE", odds: 2.8 },
        { number: 3, name: "\u30D1\u30EF\u30FC\u30CF\u30A6\u30B9", confidence: 79, prediction: "\u25CB", odds: 5.3 },
        { number: 9, name: "\u30ED\u30F3\u30B0\u30C7\u30A3\u30B9\u30BF\u30F3\u30B9", confidence: 68, prediction: "\u25B2", odds: 7.2 },
        { number: 2, name: "\u30B9\u30C6\u30A4\u30E4\u30FC\u30BA", confidence: 55, prediction: "\u25B3", odds: 10.8 },
        { number: 7, name: "\u30A8\u30F3\u30C9\u30E9\u30F3\u30CA\u30FC", confidence: 48, prediction: "\u2606", odds: 14.5 }
      ],
      aiComment: "\u25CE6\u756A\u30DE\u30A4\u30C6\u30A3\u30FC\u30AD\u30F3\u30B0\u306F\u9577\u8DDD\u96E2\u5B9F\u7E3E\u8C4A\u5BCC\u3067\u4ECA\u56DE\u3082\u8EF8\u3068\u3057\u3066\u5B89\u5B9A\u3002\u25CB3\u756A\u30D1\u30EF\u30FC\u30CF\u30A6\u30B9\u306F\u8FFD\u3044\u8FBC\u307F\u30BF\u30A4\u30D7\u3067\u5C55\u958B\u6B21\u7B2C\u3002"
    }
  ];
  const stats = {
    hitRate: 78.1,
    recoveryRate: 125.3,
    totalRaces: 360,
    hits: 281
  };
  return renderTemplate`${renderComponent($$result, "BaseLayout", $$BaseLayout, { "title": "\u7121\u6599\u4E88\u60F3", "description": "KEIBA Intelligence\u306E\u7121\u6599\u4E88\u60F3\u30DA\u30FC\u30B8\u3002\u672C\u65E5\u306E\u5357\u95A2\u7AF6\u99AC\u306E\u4E88\u60F3\u3092\u7121\u6599\u3067\u516C\u958B\u3002AI\u5206\u6790\u306B\u3088\u308B\u4FE1\u983C\u5EA6\u4ED8\u304D\u4E88\u60F3\u3067\u3001\u8CB7\u3044\u76EE\u306F\u6709\u6599\u30D7\u30E9\u30F3\u3067\u63D0\u4F9B\u3002", "data-astro-cid-mpifc4zf": true }, { "default": ($$result2) => renderTemplate`  ${maybeRenderHead()}<section class="free-prediction-header gradient-bg" data-astro-cid-mpifc4zf> <div class="container text-center" data-astro-cid-mpifc4zf> <h1 class="fade-in" data-astro-cid-mpifc4zf>本日の無料予想</h1> <p class="section-subtitle slide-in" data-astro-cid-mpifc4zf>
AI分析による信頼度付き予想を無料公開<br data-astro-cid-mpifc4zf>
買い目情報は有料プランでご提供
</p> <div class="header-info" data-astro-cid-mpifc4zf> <div class="info-item" data-astro-cid-mpifc4zf> <span class="info-label" data-astro-cid-mpifc4zf>開催日</span> <span class="info-value" data-astro-cid-mpifc4zf>${todayDate}</span> </div> <div class="info-item" data-astro-cid-mpifc4zf> <span class="info-label" data-astro-cid-mpifc4zf>競馬場</span> <span class="info-value" data-astro-cid-mpifc4zf>${venue}</span> </div> <div class="info-item" data-astro-cid-mpifc4zf> <span class="info-label" data-astro-cid-mpifc4zf>レース数</span> <span class="info-value" data-astro-cid-mpifc4zf>${totalRaces}R</span> </div> </div> </div> </section>  <section class="stats-banner" data-astro-cid-mpifc4zf> <div class="container" data-astro-cid-mpifc4zf> <div class="stats-grid" data-astro-cid-mpifc4zf> <div class="stat-card card" data-astro-cid-mpifc4zf> <div class="stat-icon" data-astro-cid-mpifc4zf>🎯</div> <div class="stat-value" data-astro-cid-mpifc4zf>${stats.hitRate}%</div> <div class="stat-label" data-astro-cid-mpifc4zf>的中率</div> </div> <div class="stat-card card" data-astro-cid-mpifc4zf> <div class="stat-icon" data-astro-cid-mpifc4zf>💰</div> <div class="stat-value" data-astro-cid-mpifc4zf>${stats.recoveryRate}%</div> <div class="stat-label" data-astro-cid-mpifc4zf>回収率</div> </div> <div class="stat-card card" data-astro-cid-mpifc4zf> <div class="stat-icon" data-astro-cid-mpifc4zf>📊</div> <div class="stat-value" data-astro-cid-mpifc4zf>${stats.hits}/${stats.totalRaces}</div> <div class="stat-label" data-astro-cid-mpifc4zf>的中数</div> </div> </div> </div> </section>  <section class="predictions" data-astro-cid-mpifc4zf> <div class="container" data-astro-cid-mpifc4zf> <div class="section-header" data-astro-cid-mpifc4zf> <h2 class="section-title" data-astro-cid-mpifc4zf>後半3レース予想</h2> <p class="section-subtitle" data-astro-cid-mpifc4zf>
無料プランでは後半3レースの予想を公開。買い目情報を見るには<a href="/pricing" data-astro-cid-mpifc4zf>有料プラン</a>への登録が必要です。
</p> </div> <div class="predictions-list" data-astro-cid-mpifc4zf> ${samplePredictions.map((race) => renderTemplate`<div class="race-card card" data-astro-cid-mpifc4zf> <div class="race-header" data-astro-cid-mpifc4zf> <div class="race-title" data-astro-cid-mpifc4zf> <span class="race-number" data-astro-cid-mpifc4zf>第${race.raceNumber}R</span> <span class="race-name" data-astro-cid-mpifc4zf>${race.raceName}</span> </div> <div class="race-info" data-astro-cid-mpifc4zf> <span class="badge badge-info" data-astro-cid-mpifc4zf>${race.distance}</span> <span class="badge badge-secondary" data-astro-cid-mpifc4zf>${race.grade}</span> <span class="weather-info" data-astro-cid-mpifc4zf>☀️ ${race.weather} / 馬場: ${race.track}</span> </div> </div> <div class="horses-table" data-astro-cid-mpifc4zf> <table data-astro-cid-mpifc4zf> <thead data-astro-cid-mpifc4zf> <tr data-astro-cid-mpifc4zf> <th data-astro-cid-mpifc4zf>印</th> <th data-astro-cid-mpifc4zf>馬番</th> <th data-astro-cid-mpifc4zf>馬名</th> <th data-astro-cid-mpifc4zf>信頼度</th> <th data-astro-cid-mpifc4zf>オッズ</th> </tr> </thead> <tbody data-astro-cid-mpifc4zf> ${race.horses.map((horse) => renderTemplate`<tr${addAttribute(`confidence-${Math.floor(horse.confidence / 20)}`, "class")} data-astro-cid-mpifc4zf> <td class="prediction-mark" data-astro-cid-mpifc4zf>${horse.prediction}</td> <td class="horse-number" data-astro-cid-mpifc4zf>${horse.number}</td> <td class="horse-name" data-astro-cid-mpifc4zf>${horse.name}</td> <td class="confidence" data-astro-cid-mpifc4zf> <div class="confidence-bar" data-astro-cid-mpifc4zf> <div class="confidence-fill"${addAttribute(`width: ${horse.confidence}%`, "style")} data-astro-cid-mpifc4zf></div> </div> <span class="confidence-value" data-astro-cid-mpifc4zf>${horse.confidence}%</span> </td> <td class="odds" data-astro-cid-mpifc4zf>${horse.odds}倍</td> </tr>`)} </tbody> </table> </div> <div class="ai-comment" data-astro-cid-mpifc4zf> <div class="comment-header" data-astro-cid-mpifc4zf> <span class="comment-icon" data-astro-cid-mpifc4zf>🤖</span> <span class="comment-title" data-astro-cid-mpifc4zf>AI分析コメント</span> </div> <p data-astro-cid-mpifc4zf>${race.aiComment}</p> </div> <div class="premium-cta" data-astro-cid-mpifc4zf> <div class="lock-icon" data-astro-cid-mpifc4zf>🔒</div> <div class="cta-content" data-astro-cid-mpifc4zf> <h3 data-astro-cid-mpifc4zf>買い目情報は有料プランで提供</h3> <p data-astro-cid-mpifc4zf>馬単・三連複の買い目、穴馬情報、コース別攻略法などを有料プランでご提供しています。</p> <div class="cta-buttons" data-astro-cid-mpifc4zf> <a href="/pricing" class="btn btn-primary" data-astro-cid-mpifc4zf>料金プランを見る</a> <a href="/results" class="btn btn-secondary" data-astro-cid-mpifc4zf>的中実績を見る</a> </div> </div> </div> </div>`)} </div> </div> </section>  <section class="upgrade-section gradient-bg" data-astro-cid-mpifc4zf> <div class="container text-center" data-astro-cid-mpifc4zf> <h2 data-astro-cid-mpifc4zf>有料プランで買い目をゲット</h2> <p class="mb-3" data-astro-cid-mpifc4zf>
月額¥2,980から。馬単・三連複の買い目、穴馬情報、コース別攻略法を提供。<br data-astro-cid-mpifc4zf>
1日あたり¥99（缶コーヒー1本分）で本格的な競馬予想が利用可能。
</p> <div class="upgrade-plans" data-astro-cid-mpifc4zf> <div class="upgrade-plan-card card" data-astro-cid-mpifc4zf> <div class="plan-name" data-astro-cid-mpifc4zf>ライト</div> <div class="plan-price" data-astro-cid-mpifc4zf>¥2,980<span data-astro-cid-mpifc4zf>/月</span></div> <div class="plan-features" data-astro-cid-mpifc4zf>
✅ 後半3レース買い目<br data-astro-cid-mpifc4zf>
✅ 馬単買い目提供
</div> <a href="/pricing" class="btn btn-primary w-full" data-astro-cid-mpifc4zf>詳細を見る</a> </div> <div class="upgrade-plan-card card featured" data-astro-cid-mpifc4zf> <div class="badge badge-success" data-astro-cid-mpifc4zf>おすすめ</div> <div class="plan-name" data-astro-cid-mpifc4zf>スタンダード</div> <div class="plan-price" data-astro-cid-mpifc4zf>¥4,980<span data-astro-cid-mpifc4zf>/月</span></div> <div class="plan-features" data-astro-cid-mpifc4zf>
✅ 全レース買い目<br data-astro-cid-mpifc4zf>
✅ データ可視化
</div> <a href="/pricing" class="btn btn-primary w-full" data-astro-cid-mpifc4zf>詳細を見る</a> </div> <div class="upgrade-plan-card card" data-astro-cid-mpifc4zf> <div class="plan-name" data-astro-cid-mpifc4zf>プレミアム</div> <div class="plan-price" data-astro-cid-mpifc4zf>¥6,980<span data-astro-cid-mpifc4zf>/月</span></div> <div class="plan-features" data-astro-cid-mpifc4zf>
✅ 三連複買い目<br data-astro-cid-mpifc4zf>
✅ 穴馬情報
</div> <a href="/pricing" class="btn btn-primary w-full" data-astro-cid-mpifc4zf>詳細を見る</a> </div> </div> </div> </section>  <section class="disclaimer" data-astro-cid-mpifc4zf> <div class="container" data-astro-cid-mpifc4zf> <div class="disclaimer-card card" data-astro-cid-mpifc4zf> <h3 data-astro-cid-mpifc4zf>⚠️ ご利用上の注意</h3> <ul data-astro-cid-mpifc4zf> <li data-astro-cid-mpifc4zf>本予想はAI分析に基づく参考情報であり、的中を保証するものではありません。</li> <li data-astro-cid-mpifc4zf>馬券の購入は自己責任でお願いいたします。</li> <li data-astro-cid-mpifc4zf>オッズは暫定値であり、レース直前に変動する可能性があります。</li> <li data-astro-cid-mpifc4zf>無料予想は後半3レースのみ公開。全レース予想は有料プランでご提供します。</li> <li data-astro-cid-mpifc4zf>予想データの無断転載・二次利用を禁止します。</li> </ul> </div> </div> </section>  ` })}`;
}, "/Users/apolon/Library/Mobile Documents/com~apple~CloudDocs/WorkSpace/keiba-intelligence/astro-site/src/pages/free-prediction.astro", void 0);

const $$file = "/Users/apolon/Library/Mobile Documents/com~apple~CloudDocs/WorkSpace/keiba-intelligence/astro-site/src/pages/free-prediction.astro";
const $$url = "/free-prediction";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$FreePrediction,
  file: $$file,
  prerender,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
