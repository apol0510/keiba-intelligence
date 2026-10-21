/**
 * 有料化の導線が `data-ki-placement` を持ち、ki_pricing_link_click が "body" に潰れない（2026-10-21）。
 * RaceNewspaper / AIBettingSection は実績表示の固定（MK 最終決定 2026-10-19・trackRecordFreeze）の対象なので触らない。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../../components/${rel}`, import.meta.url)), 'utf8');
const VALUE_RE = /^[a-z0-9_-]{1,40}$/i; // funnelEvents.js と同じ

const CASES = [
  ['AIRaceComment.astro', 'ai_comment_mask'],
];

for (const [file, value] of CASES) {
  test(`${file}: the /pricing link carries data-ki-placement="${value}"`, () => {
    const links = read(file).match(/<a [^>]*href="\/pricing"[^>]*>/g) ?? [];
    assert.ok(links.length > 0);
    for (const l of links) assert.match(l, new RegExp(`data-ki-placement="${value}"`));
    assert.match(value, VALUE_RE);
  });
}

test('TierRibbon: the next-step link carries a placement per tone', () => {
  const src = read('newspaper/TierRibbon.astro');
  assert.match(src, /<a class="tr-cta" href=\{nextStep\.href\} data-ki-placement=\{`tier_ribbon_\$\{nextStep\.tone\}`\}>/);
  for (const tone of [...src.matchAll(/tone: '([a-z]+)'/g)].map((m) => m[1])) assert.match(`tier_ribbon_${tone}`, VALUE_RE);
});
