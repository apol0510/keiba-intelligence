import { d as createComponent, i as renderComponent, j as renderScript, r as renderTemplate, m as maybeRenderHead } from '../../chunks/astro/server_BKC9sGbb.mjs';
import 'piccolore';
import { $ as $$BaseLayout } from '../../chunks/BaseLayout_iUX2XXnr.mjs';
/* empty css                                     */
export { renderers } from '../../renderers.mjs';

const prerender = true;
const $$Verify = createComponent(async ($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "BaseLayout", $$BaseLayout, { "title": "\u8A8D\u8A3C\u4E2D... | KEIBA Intelligence", "description": "\u30ED\u30B0\u30A4\u30F3\u51E6\u7406\u4E2D", "data-astro-cid-wqdcumew": true }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<section class="verify-section" data-astro-cid-wqdcumew> <div class="container" data-astro-cid-wqdcumew> <div class="verify-card" data-astro-cid-wqdcumew> <div class="verify-content" data-astro-cid-wqdcumew> <div class="spinner" data-astro-cid-wqdcumew></div> <h1 id="status" data-astro-cid-wqdcumew>認証中...</h1> <p id="message" data-astro-cid-wqdcumew>トークンを確認しています。しばらくお待ちください。</p> </div> </div> </div> </section> ` })}  ${renderScript($$result, "/Users/apolon/Library/Mobile Documents/com~apple~CloudDocs/WorkSpace/keiba-intelligence/astro-site/src/pages/auth/verify.astro?astro&type=script&index=0&lang.ts")}`;
}, "/Users/apolon/Library/Mobile Documents/com~apple~CloudDocs/WorkSpace/keiba-intelligence/astro-site/src/pages/auth/verify.astro", void 0);

const $$file = "/Users/apolon/Library/Mobile Documents/com~apple~CloudDocs/WorkSpace/keiba-intelligence/astro-site/src/pages/auth/verify.astro";
const $$url = "/auth/verify";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Verify,
  file: $$file,
  prerender,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
