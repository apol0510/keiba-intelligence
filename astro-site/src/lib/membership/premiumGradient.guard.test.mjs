/**
 * premiumGradient.guard.test.mjs — プレミアム表示の配色契約を固定する
 *
 * 正本: docs/progress.md 2026-09-12 / `src/styles/global.scss` の `--grad-premium`
 *
 * ── なぜ要るか ────────────────────────────────────────────────
 * プレミアムの配色は 4 回作り直している。
 *   `--secondary-gradient`（#f97316 → #fb923c）… 両端オレンジで単色に見えた
 *   `--grad-action`（#ec4899 → #f97316）      … 桃と橙で色差が弱かった
 *   暗色 3 色（#2563eb → #7c3aed → #c2410c）  … 終点が茶色く濁って見えた
 *   現行（#38bdf8 → #a78bfa → #f472b6）       … 明るい 3 色 ＋ 濃色文字
 *
 * そのたびに **3 箇所（カード枠・バッジ・進捗バー）のどれかが取り残された**。
 * 実際、バッジと進捗バーだけ直してカード枠が単色オレンジのまま残ったことがある。
 * ここで「3 箇所が同じトークンを使う」ことを機械で固定する。
 *
 * 🔴 もうひとつの要点は**バッジ文字のコントラスト**。
 *    明暗が逆方向へ振れる配色は、単一の文字色では AA を割りやすい。
 *    ランプ全体を刻んで最小コントラストを測り、濃色文字で AA を満たすことを固定する。
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
const PREMIUM_GRADIENT = 'linear-gradient(135deg, #38bdf8 0%, #a78bfa 50%, #f472b6 100%)';
const PREMIUM_STOPS = Object.freeze(['#38bdf8', '#a78bfa', '#f472b6']);
const AA = 4.5;

/**
 * 🔴 戻してはいけない配色。すべて実画面で差し戻している。
 *    値だけ差し替えられて同じ失敗を繰り返すのを防ぐ。
 */
const REJECTED = Object.freeze([
  { stops: ['#f97316', '#fb923c'], why: '両端オレンジで単色に見えた' },
  { stops: ['#ec4899', '#f97316'], why: '桃と橙で色差が弱かった' },
  { stops: ['#2563eb', '#8b5cf6', '#f97316'], why: 'どの文字色でも AA に届かない' },
  { stops: ['#2563eb', '#7c3aed', '#c2410c'], why: '終点が茶色く濁って見えた' },
]);

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

/** 停止点を等間隔とみなしてランプを刻む（CSS の既定と同じ sRGB 成分の線形補間）。 */
function sampleRamp(stops, steps) {
  const pts = stops.map(hexToRgb);
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * (pts.length - 1);
    const seg = Math.min(Math.floor(t), pts.length - 2);
    const k = t - seg;
    out.push([0, 1, 2].map((j) => pts[seg][j] + (pts[seg + 1][j] - pts[seg][j]) * k));
  }
  return out;
}

/** ランプ全体での、文字色に対する最小コントラスト。 */
export function minContrastOverRamp(stops, textHex, steps = 400) {
  const text = hexToRgb(textHex);
  return sampleRamp(stops, steps).reduce((min, c) => Math.min(min, contrast(c, text)), Infinity);
}

/**
 * ランプ全体での最小彩度（HSL の S）。
 * 🔴 「濁り」の指標。低いほどグレー寄りに見える。藤から暖色へ補間すると必ず落ちる。
 */
export function minSaturationOverRamp(stops, steps = 400) {
  const sat = ([r, g, b]) => {
    const [R, G, B] = [r / 255, g / 255, b / 255];
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B), l = (mx + mn) / 2;
    if (mx === mn) return 0;
    return l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn);
  };
  return sampleRamp(stops, steps).reduce((min, c) => Math.min(min, sat(c)), Infinity);
}

/**
 * 🔴 **global.scss に実際に書かれている**停止点を読む。
 *    コントラストと彩度はここから測る。定数だけを測ると、値を差し替えたときに
 *    「確定値が違う」としか落ちず、その配色が実際に AA を割るのか濁るのかを
 *    テストが検査できない。
 */
function stopsFromCss() {
  const m = read(GLOBAL_SCSS).match(/--grad-premium:\s*([^;]+);/);
  assert.ok(m, '`--grad-premium` が global.scss に無い');
  const stops = m[1].match(/#[0-9a-f]{6}/g);
  assert.ok(stops && stops.length >= 2, `--grad-premium の停止点を読めない: ${m[1]}`);
  return stops;
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

  test('停止点は 空 → 藤 → 桃 の 3 つ', () => {
    assert.deepEqual(PREMIUM_GRADIENT.match(/#[0-9a-f]{6}/g), [...PREMIUM_STOPS]);
  });

  /*
   * 🔴 3 色とも既存の設計システムの色。新しい色を足していない。
   *    #38bdf8 → #a78bfa は `--grad-nav-bright` そのもの、#f472b6 は
   *    `--grad-conclusion-btn` / `--grad-action-btn` の桃。
   */
  test('3 色とも既存トークンに登場する色である（新色を足していない）', () => {
    const css = stripComments(read(GLOBAL_SCSS));
    for (const stop of PREMIUM_STOPS) {
      const uses = [...css.matchAll(new RegExp(stop, 'g'))].length;
      assert.ok(uses >= 2, `${stop} が --grad-premium 以外に登場しない（既存の色から選ぶこと）`);
    }
  });

  test('空→藤は --grad-nav-bright と同じ 2 色である', () => {
    const css = read(GLOBAL_SCSS);
    const bright = css.match(/--grad-nav-bright:\s*([^;]+);/)[1];
    assert.deepEqual(bright.match(/#[0-9a-f]{6}/g), [PREMIUM_STOPS[0], PREMIUM_STOPS[1]]);
  });

  test('🔴 差し戻された配色へ戻っていない', () => {
    const actual = (read(GLOBAL_SCSS).match(/--grad-premium:\s*([^;]+);/)[1].match(/#[0-9a-f]{6}/g) || []).join(',');
    for (const { stops, why } of REJECTED) {
      assert.notEqual(actual, stops.join(','), `差し戻し済みの配色に戻っている（${why}）: ${stops.join(' → ')}`);
    }
  });

  /*
   * 🔴 「濁り」の下限。藤から橙・琥珀へ補間すると彩度が大きく落ちる
   *    （橙終点なら 30%、琥珀終点なら 22%）。桃で終わる現行は 50%。
   */
  test('ランプ全体で彩度が落ちすぎない（濁って見えない）', () => {
    const minSat = minSaturationOverRamp(stopsFromCss());
    assert.ok(minSat >= 0.40, `最小彩度が ${(minSat * 100).toFixed(0)}% しかない（40% 以上を保つこと）`);
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
  test('濃色文字（--btn-ink）なら AA を満たす', () => {
    const min = minContrastOverRamp(stopsFromCss(), '#0b1020');
    assert.ok(min >= AA, `濃色文字の最小コントラストが ${min.toFixed(2)} で AA(${AA}) 未満`);
  });

  test('白文字では AA を満たさない＝濃色文字が必須である理由', () => {
    const min = minContrastOverRamp(stopsFromCss(), '#ffffff');
    assert.ok(min < AA, `白文字が AA を満たすなら、この配色前提は見直しが要る（実測 ${min.toFixed(2)}）`);
  });

  test('バッジは濃色文字（--btn-ink）を指定している', () => {
    const body = ruleBody(read(MYPAGE), '.mp-badge.tier-premium');
    assert.match(body, /color:\s*var\(--btn-ink\)/);
    assert.doesNotMatch(body, /var\(--text-inverse\)/);
  });

  test('--btn-ink は #0b1020 である（実測の前提）', () => {
    const css = read(GLOBAL_SCSS);
    assert.equal(css.match(/--btn-ink:\s*([^;]+);/)[1].trim(), '#0b1020');
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
   * `--text-inverse`（白文字）が出てよいのは `.mp-badge` の基底だけ。
   * 無料は緑地、ライトは青地なので基底の白を使い、プレミアムだけ濃色へ上書きする。
   * これ以上増えていたら、押せる UI が白文字化した疑いがある。
   */
  test('白文字（--text-inverse）はバッジ基底の 1 箇所だけ', () => {
    const code = stripComments(read(MYPAGE));
    const uses = [...code.matchAll(/var\(--text-inverse\)/g)].length;
    assert.equal(uses, 1, `mypage.astro で --text-inverse が ${uses} 件（期待 1 件＝バッジ基底のみ）`);
    assert.match(ruleBody(read(MYPAGE), '.mp-badge {'), /color:\s*var\(--text-inverse\)/);
  });
});
