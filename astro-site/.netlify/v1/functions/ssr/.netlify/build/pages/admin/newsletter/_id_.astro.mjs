import { d as createComponent, i as renderComponent, r as renderTemplate, m as maybeRenderHead, j as renderScript } from '../../../chunks/astro/server_BKC9sGbb.mjs';
import 'piccolore';
import { $ as $$BaseLayout } from '../../../chunks/BaseLayout_ChDee_X0.mjs';
/* empty css                                      */
export { renderers } from '../../../renderers.mjs';

const prerender = false;
const $$id = createComponent(async ($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "BaseLayout", $$BaseLayout, { "title": "\u914D\u4FE1\u8A73\u7D30", "description": "\u30E1\u30EB\u30DE\u30AC\u914D\u4FE1\u8A73\u7D30\u30FB\u9001\u4FE1", "data-astro-cid-xoipydew": true }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<section class="admin-newsletter-detail" data-astro-cid-xoipydew> <div class="container" data-astro-cid-xoipydew> <div class="header" data-astro-cid-xoipydew> <h1 data-astro-cid-xoipydew>配信詳細</h1> <a href="/admin/newsletter" class="btn btn-secondary" data-astro-cid-xoipydew>← 一覧に戻る</a> </div> <div id="detail-content" class="detail-content" data-astro-cid-xoipydew> <p data-astro-cid-xoipydew>読み込み中...</p> </div> <div id="message" class="message" data-astro-cid-xoipydew></div> </div> </section>  ${renderScript($$result2, "/Users/apolon/Library/Mobile Documents/com~apple~CloudDocs/WorkSpace/keiba-intelligence/astro-site/src/pages/admin/newsletter/[id].astro?astro&type=script&index=0&lang.ts")} ` })}`;
}, "/Users/apolon/Library/Mobile Documents/com~apple~CloudDocs/WorkSpace/keiba-intelligence/astro-site/src/pages/admin/newsletter/[id].astro", void 0);

const $$file = "/Users/apolon/Library/Mobile Documents/com~apple~CloudDocs/WorkSpace/keiba-intelligence/astro-site/src/pages/admin/newsletter/[id].astro";
const $$url = "/admin/newsletter/[id]";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$id,
  file: $$file,
  prerender,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
