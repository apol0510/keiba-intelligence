import { renderers } from './renderers.mjs';
import { s as serverEntrypointModule } from './chunks/_@astrojs-ssr-adapter_CvSoi7hX.mjs';
import { manifest } from './manifest_a39J7495.mjs';
import { createExports } from '@astrojs/netlify/ssr-function.js';

const serverIslandMap = new Map();;

const _page0 = () => import('./pages/_image.astro.mjs');
const _page1 = () => import('./pages/admin/newsletter/new.astro.mjs');
const _page2 = () => import('./pages/admin/newsletter/_id_.astro.mjs');
const _page3 = () => import('./pages/admin/newsletter.astro.mjs');
const _page4 = () => import('./pages/admin/prediction-converter.astro.mjs');
const _page5 = () => import('./pages/auth/verify.astro.mjs');
const _page6 = () => import('./pages/free-prediction.astro.mjs');
const _page7 = () => import('./pages/login.astro.mjs');
const _page8 = () => import('./pages/pricing.astro.mjs');
const _page9 = () => import('./pages/index.astro.mjs');
const pageMap = new Map([
    ["node_modules/astro/dist/assets/endpoint/generic.js", _page0],
    ["src/pages/admin/newsletter/new.astro", _page1],
    ["src/pages/admin/newsletter/[id].astro", _page2],
    ["src/pages/admin/newsletter/index.astro", _page3],
    ["src/pages/admin/prediction-converter.astro", _page4],
    ["src/pages/auth/verify.astro", _page5],
    ["src/pages/free-prediction.astro", _page6],
    ["src/pages/login.astro", _page7],
    ["src/pages/pricing.astro", _page8],
    ["src/pages/index.astro", _page9]
]);

const _manifest = Object.assign(manifest, {
    pageMap,
    serverIslandMap,
    renderers,
    actions: () => import('./noop-entrypoint.mjs'),
    middleware: () => import('./_noop-middleware.mjs')
});
const _args = {
    "middlewareSecret": "1774ab57-d13f-4349-9a3a-50e6054b43ab"
};
const _exports = createExports(_manifest, _args);
const __astrojsSsrVirtualEntry = _exports.default;
const _start = 'start';
if (Object.prototype.hasOwnProperty.call(serverEntrypointModule, _start)) {
	serverEntrypointModule[_start](_manifest, _args);
}

export { __astrojsSsrVirtualEntry as default, pageMap };
