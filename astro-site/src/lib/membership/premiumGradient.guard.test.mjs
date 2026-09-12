/**
 * premiumGradient.guard.test.mjs — プレミアム表示の配色契約を固定する
 *
 * 正本: docs/progress.md 2026-09-12 / `src/styles/global.scss` の `--grad-premium`
 *
 * ── なぜ要るか ────────────────────────────────────────────────
 * プレミアムの配色は 3 回作り直している。
 *   `--secondary-gradient`（#f97316 → #fb923c）… 両端オレンジで単色に見えた
 *   `--grad-action`（#ec4899 → #f97316）      … 桃と橙で色差が弱かった
 *   `--grad-premium`（#2563eb → #7c3aed → #c2410c）… 現行
 *
 * そのたびに **3 箇所（カード枠・バッジ・進捗バー）のどれかが取り残された**。
 * 実際、バッジと進捗バーだけ直してカード枠が単色オレンジのまま残ったことがある。
 * ここで「3 箇所が同じトークンを使う」ことを機械で固定する。
 *
 * 🔴 もうひとつの要点は**バッジ文字のコントラスト**。
 *    青→橙のように明暗が逆方向へ振れる配色は、単一の文字色では AA を割りやすい。
 *    ランプ全体を刻んで最小コントラストを測り、白文字で AA を満たすことを固定する。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(siteRoot, p), 'utf8');

const GLOBAL_SCSS = 'src/styles/global.scss';
const MYPAGE = 'src/pages/mypage.astro';

/** 🔴 確定値。変えるときは実画面とコントラストを測り直すこと。 */
const PREMIUM_GRADIENT = 'linear-gradient(135deg, #2563eb 0%, #7c3aed 50%, #c2410c 100%)';
const PREMIUM_STOPS = Object.freeze(['#2563eb', '#7c3aed', '#c2410c']);
const AA = 4.5;

/* ------------------------------------------------------------------
   WCAG 2.1 のコントラスト（sRGB 成分で線形補間するのは CSS の既定と同じ）
   ------------------------------------------------------------------ */
const toLinear = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = ([r, g, b]) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** 停止点を等間隔とみなしてランプを刻み、文字色に対する最小コントラストを返す。 */
export function minContrastOverRamp(stops, textHex, steps = 200) {
  const pts = stops.map(hexToRgb);
  const text = hexToRgb(textHex);
  let min = Infinity;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * (pts.length - 1);
    const seg = Math.min(Math.floor(t), pts.length - 2);
    const k = t - seg;
    const c = [0, 1, 2].map((j) => pts[seg][j] + (pts[seg + 1][j] - pts[seg][j]) * k);
    min = Math.min(min, contrast(c, text));
  }
  return min;
}

/** コメントを除いた実装部分だけを返す（コメントに旧トークン名が出るのは許す）。 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** セレクタのブロック本文を取り出す。 */
function ruleBody(src, selector) {
  const i = stripComments(src).indexOf(selector);
  assert.notEqual(i, -1, `セレクタが見つからない: ${selector}`);
  const code = stripComments(src);
  const open = code.indexOf('{', i);
  const close = code.indexOf('}', open);
  return code.slice(open + 1, close);
}

describe('🔴 プレミアム専用トークン `--grad-premium`', () => {
  test('global.scss に確定値で定義されている', () => {
    const css = read(GLOBAL_SCSS);
    const m = css.match(/--grad-premium:\s*([^;]+);/);
    assert.ok(m, '`--grad-premium` が global.scss に無い');
    assert.equal(m[1].trim(), PREMIUM_GRADIENT);
  });

  test('停止点は 青 → 紫 → 橙 の 3 つ', () => {
    assert.deepEqual(PREMIUM_GRADIENT.match(/#[0-9a-f]{6}/g), [...PREMIUM_STOPS]);
  });

  test('ロゴの青（--primary-start）から始まる＝ブランドの起点を保つ', () => {
    const css = read(GLOBAL_SCSS);
    const primary = css.match(/--primary-start:\s*([^;]+);/)[1].trim();
    assert.equal(PREMIUM_STOPS[0], primary);
  });
});

describe('🔴 3 箇所すべてが同じ `--grad-premium` を使う', () => {
  const TARGETS = [
    ['.mp-status.is-paid', 'プレミアムカード枠'],
    ['.mp-badge.tier-premium', 'プレミアムバッジ'],
    ['.mp-prog-bar span', '進捗バー'],
  ];

  for (const [selector, label] of TARGETS) {
    test(`${label}（${selector}）が var(--grad-premium) を使う`, () => {
      const body = ruleBody(read(MYPAGE), selector);
      assert.match(body, /var\(--grad-premium\)/, `${label} が --grad-premium を使っていない`);
    });

    test(`${label} に古いトークンが残っていない`, () => {
      const body = ruleBody(read(MYPAGE), selector);
      for (const stale of ['--grad-action', '--secondary-gradient', '--secondary-start']) {
        assert.doesNotMatch(body, new RegExp(`var\\(${stale}[\\),]`), `${label} に ${stale} が残っている`);
      }
    });
  }

  test('3 箇所が同一の値を参照している（片方だけ直す事故を防ぐ）', () => {
    const used = TARGETS.map(([sel]) => {
      const body = ruleBody(read(MYPAGE), sel);
      return [...body.matchAll(/var\((--grad-[a-z-]+)\)/g)].map((m) => m[1]);
    });
    for (const tokens of used) assert.deepEqual(tokens, ['--grad-premium']);
  });
});

describe('🔴 バッジ文字のコントラスト（AA 4.5:1）', () => {
  test('白文字なら AA を満たす', () => {
    const min = minContrastOverRamp(PREMIUM_STOPS, '#ffffff');
    assert.ok(min >= AA, `白文字の最小コントラストが ${min.toFixed(2)} で AA(${AA}) 未満`);
  });

  test('濃色文字（--btn-ink）では AA を満たさない＝白文字が必須である理由', () => {
    const min = minContrastOverRamp(PREMIUM_STOPS, '#0b1020');
    assert.ok(min < AA, `濃色文字が AA を満たすなら、この配色前提は見直しが要る（実測 ${min.toFixed(2)}）`);
  });

  test('バッジは白文字（--text-inverse）を指定している', () => {
    const body = ruleBody(read(MYPAGE), '.mp-badge.tier-premium');
    assert.match(body, /color:\s*var\(--text-inverse\)/);
    assert.doesNotMatch(body, /var\(--btn-ink\)/);
  });

  test('--text-inverse は白である', () => {
    const css = read(GLOBAL_SCSS);
    assert.equal(css.match(/--text-inverse:\s*([^;]+);/)[1].trim(), '#ffffff');
  });
});

describe('🔴 巻き込み禁止（プレミアム以外へ影響させない）', () => {
  test('無料会員バッジは --success のまま', () => {
    assert.match(stripComments(read(MYPAGE)), /\.mp-badge\.tier-free\s*\{\s*background:\s*var\(--success\)/);
  });

  test('ライトのバッジは --primary-gradient のまま', () => {
    assert.match(stripComments(read(MYPAGE)), /\.mp-badge\.tier-light\s*\{\s*background:\s*var\(--primary-gradient\)/);
  });

  test('既存の gradient トークンを書き換えていない', () => {
    const css = read(GLOBAL_SCSS);
    const unchanged = {
      '--grad-action': 'linear-gradient(135deg, #ec4899 0%, #f97316 100%)',
      '--grad-conclusion': 'linear-gradient(135deg, #7c3aed 0%, #ec4899 100%)',
      '--grad-nav': 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
    };
    for (const [name, value] of Object.entries(unchanged)) {
      const m = css.match(new RegExp(`${name}:\\s*([^;]+);`));
      assert.ok(m, `${name} が無い`);
      assert.equal(m[1].trim(), value, `${name} が書き換わっている`);
    }
  });

  test('ボタン用トークン（--grad-*-btn）に --grad-premium を使っていない', () => {
    const css = stripComments(read(GLOBAL_SCSS));
    for (const line of css.split('\n')) {
      if (/--grad-[a-z-]+-btn:/.test(line)) {
        assert.doesNotMatch(line, /--grad-premium/, `ボタン用トークンが --grad-premium を参照している: ${line.trim()}`);
      }
    }
  });

  test('--grad-premium を使うのは mypage の 3 箇所だけ（CTA 等へ広げない）', () => {
    const uses = [...stripComments(read(MYPAGE)).matchAll(/var\(--grad-premium\)/g)];
    assert.equal(uses.length, 3, `mypage.astro での --grad-premium の使用箇所が ${uses.length} 件（期待 3 件）`);
  });

  /*
   * 🔴 白文字にするのは**このバッジだけ**。
   *    実際に 2026-09-12 の作業中、一括置換で mypage のボタン（`.mp-btn-*`）の
   *    `--btn-ink` まで `--text-inverse` に変えてしまった。押せる UI は
   *    「明るい 2 色 ＋ 濃色文字」が正本（global.scss）なので、白にすると契約が壊れる。
   */
  test('mypage のボタンは濃色文字（--btn-ink）のまま', () => {
    const code = stripComments(read(MYPAGE));
    const inkUses = [...code.matchAll(/color:\s*var\(--btn-ink\)/g)].length;
    assert.ok(inkUses >= 6, `mypage のボタンの --btn-ink が ${inkUses} 件しかない（押せる UI が白文字化していないか確認）`);

    for (const m of code.matchAll(/\.mp-btn-[a-z]+[^{]*\{([^}]*)\}/g)) {
      assert.doesNotMatch(m[1], /var\(--text-inverse\)/, `ボタンが白文字になっている: ${m[0].slice(0, 60)}`);
    }
  });

  /*
   * `--text-inverse` が出てよいのは 2 箇所だけ。
   *   1. `.mp-badge` の基底（バッジの既定は白文字。tier ごとに上書きする）
   *   2. `.mp-badge.tier-premium`（`--grad-premium` に載せるので白のまま）
   * これ以上増えていたら、押せる UI が白文字化した疑いがある。
   */
  test('白文字（--text-inverse）はバッジ基底とプレミアムバッジの 2 箇所だけ', () => {
    const code = stripComments(read(MYPAGE));
    const uses = [...code.matchAll(/var\(--text-inverse\)/g)].length;
    assert.equal(uses, 2, `mypage.astro で --text-inverse が ${uses} 件（期待 2 件＝バッジ基底とプレミアムバッジ）`);
    assert.match(ruleBody(read(MYPAGE), '.mp-badge {'), /color:\s*var\(--text-inverse\)/);
    assert.match(ruleBody(read(MYPAGE), '.mp-badge.tier-premium'), /color:\s*var\(--text-inverse\)/);
  });
});
