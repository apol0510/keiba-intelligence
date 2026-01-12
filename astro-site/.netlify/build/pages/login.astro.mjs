import { d as createComponent, i as renderComponent, j as renderScript, r as renderTemplate, m as maybeRenderHead } from '../chunks/astro/server_BKC9sGbb.mjs';
import 'piccolore';
import { $ as $$BaseLayout } from '../chunks/BaseLayout_iUX2XXnr.mjs';
/* empty css                                 */
export { renderers } from '../renderers.mjs';

const prerender = true;
const $$Login = createComponent(async ($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "BaseLayout", $$BaseLayout, { "title": "\u30ED\u30B0\u30A4\u30F3 | KEIBA Intelligence", "description": "KEIBA Intelligence\u3078\u306E\u30ED\u30B0\u30A4\u30F3", "data-astro-cid-sgpqyurt": true }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<section class="login-section" data-astro-cid-sgpqyurt> <div class="container" data-astro-cid-sgpqyurt> <div class="login-card" data-astro-cid-sgpqyurt> <div class="login-header" data-astro-cid-sgpqyurt> <h1 data-astro-cid-sgpqyurt>ログイン</h1> <p data-astro-cid-sgpqyurt>メールアドレスを入力してください。ログインリンクをお送りします。</p> </div> <form id="loginForm" class="login-form" data-astro-cid-sgpqyurt> <div class="form-group" data-astro-cid-sgpqyurt> <label for="email" data-astro-cid-sgpqyurt>メールアドレス</label> <input type="email" id="email" name="email" placeholder="your@email.com" required autocomplete="email" data-astro-cid-sgpqyurt> </div> <button type="submit" class="btn-primary" id="submitBtn" data-astro-cid-sgpqyurt> <span class="btn-text" data-astro-cid-sgpqyurt>ログインリンクを送信</span> <span class="btn-loading" style="display: none;" data-astro-cid-sgpqyurt>送信中...</span> </button> <div id="message" class="message" style="display: none;" data-astro-cid-sgpqyurt></div> </form> <div class="login-footer" data-astro-cid-sgpqyurt> <p data-astro-cid-sgpqyurt>アカウントをお持ちでない方は、<a href="/pricing" data-astro-cid-sgpqyurt>料金プラン</a>からご登録ください。</p> </div> </div> </div> </section> ` })}  ${renderScript($$result, "/Users/apolon/Library/Mobile Documents/com~apple~CloudDocs/WorkSpace/keiba-intelligence/astro-site/src/pages/login.astro?astro&type=script&index=0&lang.ts")}`;
}, "/Users/apolon/Library/Mobile Documents/com~apple~CloudDocs/WorkSpace/keiba-intelligence/astro-site/src/pages/login.astro", void 0);

const $$file = "/Users/apolon/Library/Mobile Documents/com~apple~CloudDocs/WorkSpace/keiba-intelligence/astro-site/src/pages/login.astro";
const $$url = "/login";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Login,
  file: $$file,
  prerender,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
