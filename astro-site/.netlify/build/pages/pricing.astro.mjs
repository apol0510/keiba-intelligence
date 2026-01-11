import { d as createComponent, i as renderComponent, r as renderTemplate, m as maybeRenderHead, f as addAttribute, j as renderScript } from '../chunks/astro/server_BKC9sGbb.mjs';
import 'piccolore';
import { $ as $$BaseLayout } from '../chunks/BaseLayout_EN32_9Bi.mjs';
/* empty css                                   */
export { renderers } from '../renderers.mjs';

const prerender = true;
const $$Pricing = createComponent(($$result, $$props, $$slots) => {
  const plans = [
    {
      id: "free",
      name: "\u30D5\u30EA\u30FC",
      price: 0,
      yearlyPrice: 0,
      period: "\u7121\u6599",
      description: "\u4E88\u60F3\u95B2\u89A7\u306E\u307F",
      features: [
        { text: "\u5F53\u65E5\u306E\u4E88\u60F3\u95B2\u89A7", included: true },
        { text: "\u904E\u53BB\u306E\u7684\u4E2D\u5B9F\u7E3E\u78BA\u8A8D", included: true },
        { text: "\u8CB7\u3044\u76EE\u60C5\u5831", included: false },
        { text: "\u30C7\u30FC\u30BF\u53EF\u8996\u5316", included: false },
        { text: "\u7A74\u99AC\u60C5\u5831", included: false }
      ],
      cta: "\u7121\u6599\u3067\u59CB\u3081\u308B",
      ctaLink: "/free-prediction",
      highlighted: false
    },
    {
      id: "light",
      name: "\u30E9\u30A4\u30C8",
      price: 2980,
      yearlyPrice: 29800,
      period: "/\u6708",
      description: "\u5F8C\u534A3\u30EC\u30FC\u30B9\u8CB7\u3044\u76EE",
      features: [
        { text: "\u5F8C\u534A3\u30EC\u30FC\u30B9\u4E88\u60F3", included: true },
        { text: "\u99AC\u5358\u8CB7\u3044\u76EE\u63D0\u4F9B", included: true },
        { text: "\u7684\u4E2D\u5B9F\u7E3E\u95B2\u89A7", included: true },
        { text: "\u30C7\u30FC\u30BF\u53EF\u8996\u5316", included: true },
        { text: "\u5168\u30EC\u30FC\u30B9\u8CB7\u3044\u76EE", included: false }
      ],
      cta: "\u30E9\u30A4\u30C8\u30D7\u30E9\u30F3\u3092\u59CB\u3081\u308B",
      ctaLink: "#thrivecart-light",
      highlighted: false,
      dailyPrice: 99
    },
    {
      id: "standard",
      name: "\u30B9\u30BF\u30F3\u30C0\u30FC\u30C9",
      price: 4980,
      yearlyPrice: 49800,
      period: "/\u6708",
      description: "\u5168\u30EC\u30FC\u30B9\u99AC\u5358\u8CB7\u3044\u76EE",
      features: [
        { text: "\u5168\u30EC\u30FC\u30B9\u4E88\u60F3", included: true },
        { text: "\u99AC\u5358\u8CB7\u3044\u76EE\u63D0\u4F9B", included: true },
        { text: "\u7684\u4E2D\u5B9F\u7E3E\u95B2\u89A7", included: true },
        { text: "\u30C7\u30FC\u30BF\u53EF\u8996\u5316", included: true },
        { text: "\u5357\u95A24\u5834\u5BFE\u5FDC", included: true }
      ],
      cta: "\u30B9\u30BF\u30F3\u30C0\u30FC\u30C9\u30D7\u30E9\u30F3\u3092\u59CB\u3081\u308B",
      ctaLink: "#thrivecart-standard",
      highlighted: true,
      badge: "\u304A\u3059\u3059\u3081",
      dailyPrice: 166
    },
    {
      id: "premium",
      name: "\u30D7\u30EC\u30DF\u30A2\u30E0",
      price: 6980,
      yearlyPrice: 69800,
      period: "/\u6708",
      description: "\u5168\u30EC\u30FC\u30B9\u4E09\u9023\u8907\u8CB7\u3044\u76EE",
      features: [
        { text: "\u5168\u30EC\u30FC\u30B9\u4E88\u60F3", included: true },
        { text: "\u4E09\u9023\u8907\u8CB7\u3044\u76EE\u63D0\u4F9B", included: true },
        { text: "\u9AD8\u914D\u5F53\u72D9\u3044\u6226\u7565", included: true },
        { text: "\u7A74\u99AC\u60C5\u5831", included: true },
        { text: "\u30C7\u30FC\u30BF\u53EF\u8996\u5316", included: true }
      ],
      cta: "\u30D7\u30EC\u30DF\u30A2\u30E0\u30D7\u30E9\u30F3\u3092\u59CB\u3081\u308B",
      ctaLink: "#thrivecart-premium",
      highlighted: false,
      dailyPrice: 233
    },
    {
      id: "ultimate",
      name: "\u30A2\u30EB\u30C6\u30A3\u30E1\u30C3\u30C8",
      price: 8980,
      yearlyPrice: 89800,
      period: "/\u6708",
      description: "\u99AC\u5358+\u4E09\u9023\u8907+\u7A74\u99AC",
      features: [
        { text: "\u5168\u30EC\u30FC\u30B9\u4E88\u60F3", included: true },
        { text: "\u99AC\u5358+\u4E09\u9023\u8907\u8CB7\u3044\u76EE", included: true },
        { text: "\u7A74\u99AC\u60C5\u5831", included: true },
        { text: "\u30B3\u30FC\u30B9\u5225\u653B\u7565\u6CD5", included: true },
        { text: "\u512A\u5148\u30B5\u30DD\u30FC\u30C8", included: true }
      ],
      cta: "\u30A2\u30EB\u30C6\u30A3\u30E1\u30C3\u30C8\u30D7\u30E9\u30F3\u3092\u59CB\u3081\u308B",
      ctaLink: "#thrivecart-ultimate",
      highlighted: false,
      dailyPrice: 299
    }
  ];
  const aiPlusPlan = {
    name: "AI Plus",
    price: 19800,
    period: "/\u6708",
    description: "1\u978D\u8D85\u7CBE\u5BC6\u4E88\u60F3",
    features: [
      { text: "1\u978D\u306E\u307F\u8D85\u7CBE\u5BC6AI\u4E88\u60F3", included: true },
      { text: "\u30DE\u30EB\u30C1\u8CB7\u3044\u76EE\u63D0\u4F9B", included: true },
      { text: "\u7279\u5FB4\u91CF\u8A73\u7D30\u5206\u6790", included: true },
      { text: "\u30EC\u30FC\u30B9\u5C55\u958B\u4E88\u6E2C", included: true },
      { text: "\u9AD8\u7CBE\u5EA6\u72D9\u3044\uFF08\u56DE\u53CE\u7387150%+\uFF09", included: true }
    ],
    cta: "AI Plus\u30D7\u30E9\u30F3\u3092\u59CB\u3081\u308B",
    ctaLink: "#thrivecart-ai-plus",
    note: "\u203B \u5358\u54C1\u8CFC\u5165\u306E\u307F\u3002\u4ED6\u30D7\u30E9\u30F3\u3068\u306E\u4F75\u7528\u4E0D\u53EF\u3002"
  };
  return renderTemplate`${renderComponent($$result, "BaseLayout", $$BaseLayout, { "title": "\u6599\u91D1\u30D7\u30E9\u30F3", "description": "KEIBA Intelligence\u306E\u6599\u91D1\u30D7\u30E9\u30F3\u3002\u6708\u984D\xA52,980\u304B\u3089\u59CB\u3081\u3089\u308C\u308B\u4F4E\u4FA1\u683C\u8A2D\u5B9A\u3002\u30D5\u30EA\u30FC\u30D7\u30E9\u30F3\u304B\u3089\u6700\u4E0A\u4F4D\u30A2\u30EB\u30C6\u30A3\u30E1\u30C3\u30C8\u30D7\u30E9\u30F3\u307E\u3067\u3001\u3042\u306A\u305F\u306E\u30CB\u30FC\u30BA\u306B\u5408\u308F\u305B\u3066\u9078\u3079\u307E\u3059\u3002", "data-astro-cid-lmkygsfs": true }, { "default": ($$result2) => renderTemplate`  ${maybeRenderHead()}<section class="pricing-header gradient-bg" data-astro-cid-lmkygsfs> <div class="container text-center" data-astro-cid-lmkygsfs> <h1 class="fade-in" data-astro-cid-lmkygsfs>料金プラン</h1> <p class="section-subtitle slide-in" data-astro-cid-lmkygsfs>
低価格で始められる、明確な料金体系。<br data-astro-cid-lmkygsfs>
1日あたり¥99（缶コーヒー1本分）から本格的な競馬予想が利用可能。
</p> </div> </section>  <section class="pricing-plans" data-astro-cid-lmkygsfs> <div class="container" data-astro-cid-lmkygsfs> <h2 class="section-title text-center" data-astro-cid-lmkygsfs>メインプラン</h2> <div class="pricing-toggle text-center mb-4" data-astro-cid-lmkygsfs> <button class="toggle-btn active" data-billing="monthly" data-astro-cid-lmkygsfs>月額払い</button> <button class="toggle-btn" data-billing="yearly" data-astro-cid-lmkygsfs>年額払い<span class="badge badge-success ml-1" data-astro-cid-lmkygsfs>2ヶ月無料</span></button> </div> <div class="grid grid-5" data-astro-cid-lmkygsfs> ${plans.map((plan) => renderTemplate`<div${addAttribute(`pricing-card card ${plan.highlighted ? "featured" : ""}`, "class")} data-astro-cid-lmkygsfs> ${plan.badge && renderTemplate`<div class="badge badge-success" data-astro-cid-lmkygsfs>${plan.badge}</div>`} <div class="plan-header" data-astro-cid-lmkygsfs> <div class="plan-name" data-astro-cid-lmkygsfs>${plan.name}</div> <div class="plan-price" data-astro-cid-lmkygsfs> <span class="price monthly-price" data-astro-cid-lmkygsfs>¥${plan.price.toLocaleString()}</span> <span class="price yearly-price" style="display: none;" data-astro-cid-lmkygsfs>¥${plan.yearlyPrice.toLocaleString()}</span> <span class="period" data-astro-cid-lmkygsfs>${plan.period}</span> </div> ${plan.dailyPrice && renderTemplate`<div class="daily-price monthly-price" data-astro-cid-lmkygsfs>1日あたり¥${plan.dailyPrice}</div>`} ${plan.yearlyPrice > 0 && renderTemplate`<div class="yearly-savings yearly-price" style="display: none;" data-astro-cid-lmkygsfs>
年間¥${(plan.price * 12 - plan.yearlyPrice).toLocaleString()}お得
</div>`} <div class="plan-description" data-astro-cid-lmkygsfs>${plan.description}</div> </div> <ul class="plan-features" data-astro-cid-lmkygsfs> ${plan.features.map((feature) => renderTemplate`<li${addAttribute(feature.included ? "included" : "excluded", "class")} data-astro-cid-lmkygsfs> ${feature.included ? "\u2705" : "\u274C"} ${feature.text} </li>`)} </ul> <a${addAttribute(plan.ctaLink, "href")} class="btn btn-primary w-full" data-astro-cid-lmkygsfs> ${plan.cta} </a> </div>`)} </div> </div> </section>  <section class="ai-plus-plan" data-astro-cid-lmkygsfs> <div class="container" data-astro-cid-lmkygsfs> <h2 class="section-title text-center" data-astro-cid-lmkygsfs>超精密予想プラン</h2> <p class="section-subtitle text-center" data-astro-cid-lmkygsfs>
1鞍のみに集中した超精密AI予想。高配当狙いの上級者向け。
</p> <div class="ai-plus-card card" data-astro-cid-lmkygsfs> <div class="badge badge-info" data-astro-cid-lmkygsfs>単品プラン</div> <div class="plan-header" data-astro-cid-lmkygsfs> <div class="plan-name" data-astro-cid-lmkygsfs>${aiPlusPlan.name}</div> <div class="plan-price" data-astro-cid-lmkygsfs> <span class="price" data-astro-cid-lmkygsfs>¥${aiPlusPlan.price.toLocaleString()}</span> <span class="period" data-astro-cid-lmkygsfs>${aiPlusPlan.period}</span> </div> <div class="plan-description" data-astro-cid-lmkygsfs>${aiPlusPlan.description}</div> </div> <div class="ai-plus-content" data-astro-cid-lmkygsfs> <ul class="plan-features" data-astro-cid-lmkygsfs> ${aiPlusPlan.features.map((feature) => renderTemplate`<li class="included" data-astro-cid-lmkygsfs>
✅ ${feature.text} </li>`)} </ul> <div class="ai-plus-note" data-astro-cid-lmkygsfs> ${aiPlusPlan.note} </div> </div> <a${addAttribute(aiPlusPlan.ctaLink, "href")} class="btn btn-secondary w-full btn-lg" data-astro-cid-lmkygsfs> ${aiPlusPlan.cta} </a> </div> </div> </section>  <section class="plan-comparison" data-astro-cid-lmkygsfs> <div class="container" data-astro-cid-lmkygsfs> <h2 class="section-title text-center" data-astro-cid-lmkygsfs>プラン機能比較表</h2> <div class="comparison-table-wrapper" data-astro-cid-lmkygsfs> <table class="comparison-table" data-astro-cid-lmkygsfs> <thead data-astro-cid-lmkygsfs> <tr data-astro-cid-lmkygsfs> <th data-astro-cid-lmkygsfs>機能</th> <th data-astro-cid-lmkygsfs>フリー</th> <th data-astro-cid-lmkygsfs>ライト</th> <th class="highlighted" data-astro-cid-lmkygsfs>スタンダード</th> <th data-astro-cid-lmkygsfs>プレミアム</th> <th data-astro-cid-lmkygsfs>アルティメット</th> </tr> </thead> <tbody data-astro-cid-lmkygsfs> <tr data-astro-cid-lmkygsfs> <td data-astro-cid-lmkygsfs>予想閲覧</td> <td data-astro-cid-lmkygsfs>✅</td> <td data-astro-cid-lmkygsfs>✅</td> <td data-astro-cid-lmkygsfs>✅</td> <td data-astro-cid-lmkygsfs>✅</td> <td data-astro-cid-lmkygsfs>✅</td> </tr> <tr data-astro-cid-lmkygsfs> <td data-astro-cid-lmkygsfs>対象レース</td> <td data-astro-cid-lmkygsfs>-</td> <td data-astro-cid-lmkygsfs>後半3R</td> <td data-astro-cid-lmkygsfs>全レース</td> <td data-astro-cid-lmkygsfs>全レース</td> <td data-astro-cid-lmkygsfs>全レース</td> </tr> <tr data-astro-cid-lmkygsfs> <td data-astro-cid-lmkygsfs>馬単買い目</td> <td data-astro-cid-lmkygsfs>❌</td> <td data-astro-cid-lmkygsfs>✅</td> <td data-astro-cid-lmkygsfs>✅</td> <td data-astro-cid-lmkygsfs>❌</td> <td data-astro-cid-lmkygsfs>✅</td> </tr> <tr data-astro-cid-lmkygsfs> <td data-astro-cid-lmkygsfs>三連複買い目</td> <td data-astro-cid-lmkygsfs>❌</td> <td data-astro-cid-lmkygsfs>❌</td> <td data-astro-cid-lmkygsfs>❌</td> <td data-astro-cid-lmkygsfs>✅</td> <td data-astro-cid-lmkygsfs>✅</td> </tr> <tr data-astro-cid-lmkygsfs> <td data-astro-cid-lmkygsfs>穴馬情報</td> <td data-astro-cid-lmkygsfs>❌</td> <td data-astro-cid-lmkygsfs>❌</td> <td data-astro-cid-lmkygsfs>❌</td> <td data-astro-cid-lmkygsfs>✅</td> <td data-astro-cid-lmkygsfs>✅</td> </tr> <tr data-astro-cid-lmkygsfs> <td data-astro-cid-lmkygsfs>データ可視化</td> <td data-astro-cid-lmkygsfs>❌</td> <td data-astro-cid-lmkygsfs>✅</td> <td data-astro-cid-lmkygsfs>✅</td> <td data-astro-cid-lmkygsfs>✅</td> <td data-astro-cid-lmkygsfs>✅</td> </tr> <tr data-astro-cid-lmkygsfs> <td data-astro-cid-lmkygsfs>コース別攻略法</td> <td data-astro-cid-lmkygsfs>❌</td> <td data-astro-cid-lmkygsfs>❌</td> <td data-astro-cid-lmkygsfs>❌</td> <td data-astro-cid-lmkygsfs>❌</td> <td data-astro-cid-lmkygsfs>✅</td> </tr> <tr data-astro-cid-lmkygsfs> <td data-astro-cid-lmkygsfs>サポート</td> <td data-astro-cid-lmkygsfs>-</td> <td data-astro-cid-lmkygsfs>標準</td> <td data-astro-cid-lmkygsfs>標準</td> <td data-astro-cid-lmkygsfs>標準</td> <td data-astro-cid-lmkygsfs>優先</td> </tr> </tbody> </table> </div> </div> </section>  <section class="pricing-faq" data-astro-cid-lmkygsfs> <div class="container" data-astro-cid-lmkygsfs> <h2 class="section-title text-center" data-astro-cid-lmkygsfs>よくある質問</h2> <div class="faq-grid" data-astro-cid-lmkygsfs> <div class="faq-item card" data-astro-cid-lmkygsfs> <h3 data-astro-cid-lmkygsfs>🤔 プランの変更は可能ですか？</h3> <p data-astro-cid-lmkygsfs>
はい、いつでも可能です。アップグレード・ダウングレードともに可能で、日割り計算で調整されます。
</p> </div> <div class="faq-item card" data-astro-cid-lmkygsfs> <h3 data-astro-cid-lmkygsfs>💳 支払い方法は？</h3> <p data-astro-cid-lmkygsfs>
PayPal決済に対応しています。クレジットカード（Visa, Mastercard, JCB, Amex）またはPayPal残高からお支払いいただけます。
</p> </div> <div class="faq-item card" data-astro-cid-lmkygsfs> <h3 data-astro-cid-lmkygsfs>🔄 解約はいつでもできますか？</h3> <p data-astro-cid-lmkygsfs>
はい、いつでも可能です。解約後も契約期間満了まではサービスをご利用いただけます。
</p> </div> <div class="faq-item card" data-astro-cid-lmkygsfs> <h3 data-astro-cid-lmkygsfs>📊 的中率・回収率は？</h3> <p data-astro-cid-lmkygsfs>
過去360レースの実績で、的中率78.1%、回収率125.3%を記録しています。詳細は<a href="/results" data-astro-cid-lmkygsfs>的中実績ページ</a>をご確認ください。
</p> </div> <div class="faq-item card" data-astro-cid-lmkygsfs> <h3 data-astro-cid-lmkygsfs>🏇 対象競馬場は？</h3> <p data-astro-cid-lmkygsfs>
南関東4競馬場（大井・川崎・船橋・浦和）に対応しています。将来的にJRA対応も予定しています。
</p> </div> <div class="faq-item card" data-astro-cid-lmkygsfs> <h3 data-astro-cid-lmkygsfs>📱 スマホでも使えますか？</h3> <p data-astro-cid-lmkygsfs>
はい、完全レスポンシブ対応です。スマホ・タブレット・PCのいずれでも快適にご利用いただけます。
</p> </div> </div> </div> </section>  <section class="cta gradient-bg" data-astro-cid-lmkygsfs> <div class="container text-center" data-astro-cid-lmkygsfs> <h2 data-astro-cid-lmkygsfs>今すぐ始めて、勝ち馬を見つけよう</h2> <p class="mb-3" data-astro-cid-lmkygsfs>まずは無料プランで予想をチェック。納得したら有料プランで買い目をゲット。</p> <div class="cta-buttons" data-astro-cid-lmkygsfs> <a href="/free-prediction" class="btn btn-secondary btn-lg" data-astro-cid-lmkygsfs>無料で始める</a> <a href="#thrivecart-standard" class="btn btn-primary btn-lg" data-astro-cid-lmkygsfs>スタンダードプランを始める</a> </div> </div> </section>  ${renderScript($$result2, "/Users/apolon/Library/Mobile Documents/com~apple~CloudDocs/WorkSpace/keiba-intelligence/astro-site/src/pages/pricing.astro?astro&type=script&index=0&lang.ts")} ` })}`;
}, "/Users/apolon/Library/Mobile Documents/com~apple~CloudDocs/WorkSpace/keiba-intelligence/astro-site/src/pages/pricing.astro", void 0);

const $$file = "/Users/apolon/Library/Mobile Documents/com~apple~CloudDocs/WorkSpace/keiba-intelligence/astro-site/src/pages/pricing.astro";
const $$url = "/pricing";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Pricing,
  file: $$file,
  prerender,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
