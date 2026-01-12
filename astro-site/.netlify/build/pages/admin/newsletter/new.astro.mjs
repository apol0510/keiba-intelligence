import { d as createComponent, i as renderComponent, r as renderTemplate, m as maybeRenderHead, j as renderScript } from '../../../chunks/astro/server_BKC9sGbb.mjs';
import 'piccolore';
import { $ as $$BaseLayout } from '../../../chunks/BaseLayout_iUX2XXnr.mjs';
import { $ as $$AuthCheck } from '../../../chunks/AuthCheck_CVoZmkLj.mjs';
/* empty css                                     */
export { renderers } from '../../../renderers.mjs';

const $$New = createComponent(async ($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "BaseLayout", $$BaseLayout, { "title": "\u65B0\u898F\u914D\u4FE1\u4F5C\u6210", "description": "\u30E1\u30EB\u30DE\u30AC\u914D\u4FE1\u3092\u4F5C\u6210", "data-astro-cid-ytwpffl3": true }, { "default": async ($$result2) => renderTemplate` ${renderComponent($$result2, "AuthCheck", $$AuthCheck, { "data-astro-cid-ytwpffl3": true })} ${maybeRenderHead()}<section class="admin-newsletter-new" data-astro-cid-ytwpffl3> <div class="container" data-astro-cid-ytwpffl3> <div class="header" data-astro-cid-ytwpffl3> <h1 data-astro-cid-ytwpffl3>新規配信作成</h1> <a href="/admin/newsletter" class="btn btn-secondary" data-astro-cid-ytwpffl3>← 一覧に戻る</a> </div> <form id="create-form" class="create-form card" data-astro-cid-ytwpffl3> <div class="form-group" data-astro-cid-ytwpffl3> <label for="subject" data-astro-cid-ytwpffl3>件名 *</label> <input type="text" id="subject" name="subject" required placeholder="【KEIBA Intelligence】本日の予想配信" class="form-control" data-astro-cid-ytwpffl3> </div> <div class="form-group" data-astro-cid-ytwpffl3> <label for="body_html" data-astro-cid-ytwpffl3>本文（HTML） *</label> <textarea id="body_html" name="body_html" required rows="15" placeholder="<h2>本日の予想</h2>
<p>KEIBA Intelligence会員の皆様</p>
..." class="form-control" data-astro-cid-ytwpffl3></textarea> </div> <div class="form-actions" data-astro-cid-ytwpffl3> <button type="button" id="preview-btn" class="btn btn-secondary" data-astro-cid-ytwpffl3>プレビュー</button> <button type="submit" class="btn btn-primary" data-astro-cid-ytwpffl3>下書き保存</button> </div> </form> <div id="preview-area" class="preview-area card" style="display: none;" data-astro-cid-ytwpffl3> <h3 data-astro-cid-ytwpffl3>プレビュー</h3> <div id="preview-content" data-astro-cid-ytwpffl3></div> </div> <div id="message" class="message" data-astro-cid-ytwpffl3></div> </div> </section>  ${renderScript($$result2, "/Users/apolon/Library/Mobile Documents/com~apple~CloudDocs/WorkSpace/keiba-intelligence/astro-site/src/pages/admin/newsletter/new.astro?astro&type=script&index=0&lang.ts")} ` })}`;
}, "/Users/apolon/Library/Mobile Documents/com~apple~CloudDocs/WorkSpace/keiba-intelligence/astro-site/src/pages/admin/newsletter/new.astro", void 0);

const $$file = "/Users/apolon/Library/Mobile Documents/com~apple~CloudDocs/WorkSpace/keiba-intelligence/astro-site/src/pages/admin/newsletter/new.astro";
const $$url = "/admin/newsletter/new";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$New,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
