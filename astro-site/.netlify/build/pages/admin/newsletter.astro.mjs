import { d as createComponent, i as renderComponent, r as renderTemplate, m as maybeRenderHead, j as renderScript } from '../../chunks/astro/server_BKC9sGbb.mjs';
import 'piccolore';
import { $ as $$BaseLayout } from '../../chunks/BaseLayout_ChDee_X0.mjs';
/* empty css                                    */
export { renderers } from '../../renderers.mjs';

const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "BaseLayout", $$BaseLayout, { "title": "\u30E1\u30EB\u30DE\u30AC\u914D\u4FE1\u7BA1\u7406", "description": "KEIBA Intelligence \u30E1\u30EB\u30DE\u30AC\u914D\u4FE1\u7BA1\u7406\u753B\u9762", "data-astro-cid-bm2b76h6": true }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<section class="admin-newsletter" data-astro-cid-bm2b76h6> <div class="container" data-astro-cid-bm2b76h6> <div class="header" data-astro-cid-bm2b76h6> <h1 data-astro-cid-bm2b76h6>メルマガ配信管理</h1> <a href="/admin/newsletter/new" class="btn btn-primary" data-astro-cid-bm2b76h6>+ 新規配信作成</a> </div> <div id="broadcasts-list" class="broadcasts-list" data-astro-cid-bm2b76h6> <p data-astro-cid-bm2b76h6>読み込み中...</p> </div> </div> </section>  ${renderScript($$result2, "/Users/apolon/Library/Mobile Documents/com~apple~CloudDocs/WorkSpace/keiba-intelligence/astro-site/src/pages/admin/newsletter/index.astro?astro&type=script&index=0&lang.ts")} ` })}`;
}, "/Users/apolon/Library/Mobile Documents/com~apple~CloudDocs/WorkSpace/keiba-intelligence/astro-site/src/pages/admin/newsletter/index.astro", void 0);

const $$file = "/Users/apolon/Library/Mobile Documents/com~apple~CloudDocs/WorkSpace/keiba-intelligence/astro-site/src/pages/admin/newsletter/index.astro";
const $$url = "/admin/newsletter";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Index,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
