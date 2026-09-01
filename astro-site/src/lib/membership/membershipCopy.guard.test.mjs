/**
 * membershipCopy.guard.test.mjs — 会員継続制度の「言ってはいけない・書いてはいけない」を静的に禁止する
 *
 * 正本: docs/MEMBERSHIP_REWARDS.md §3.3 / §7 / §9
 *
 * ここで守るのは 4 つ。
 *   1. リワードを **現金・預金と誤認させる表現**を出さない（§8 L-8 の前提）
 *   2. **未確定の数値**（ポイント数・必要月数・景品名）を UI へ出さない（§7）
 *   3. **ランクを認可に使わない**（entitlement 側が membership を参照しない）
 *   4. KAA 型の **育成・ゲーム機能**を KI へ持ち込まない（§1）
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(siteRoot, p), 'utf8');

const UI_FILES = ['src/pages/pricing.astro', 'src/pages/mypage.astro'];
const LIB_DIR = 'src/lib/membership';

/** コメント行を除いた実装行だけを返す（コメントで「〜しない」と書くのは許す）。 */
function codeLines(src) {
  return src.split('\n').filter((l) => {
    const t = l.trimStart();
    return t && !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
  });
}

/* ================================================================
   1. 現金・預金と誤認させる表現
   ================================================================ */

/**
 * 🔴 どこにも書いてはいけない語。
 *    「換金」「預金」は **打ち消し文**（〜できません / 〜ではなく）でのみ許すため、
 *    ここには入れず §1-2 で個別に検査する。
 */
const FORBIDDEN_WORDS = Object.freeze([
  '貯金',
  '積立金',
  'キャッシュバック',
  '出金',
  '送金',
  '円分',
  '円相当',
  '円換算',
  '残高照会',
]);

/** 🔴 リワードを金額へ換算する表示（例: 100pt = 100円）を禁止する。 */
const YEN_CONVERSION = /(pt|ポイント)\s*[=＝≒]\s*[¥￥]?\s*\d/;

describe('リワードを現金・預金と誤認させない', () => {
  for (const file of UI_FILES) {
    test(`${file}: 禁止語を含まない`, () => {
      for (const line of codeLines(read(file))) {
        for (const w of FORBIDDEN_WORDS) {
          assert.equal(line.includes(w), false, `「${w}」は使えない（現金・預金との誤認を招く） → ${line.trim()}`);
        }
        assert.doesNotMatch(line, YEN_CONVERSION, `リワードを金額へ換算して表示してはいけない → ${line.trim()}`);
      }
    });

    test(`${file}: 「換金」「預金」は打ち消し文でのみ使う`, () => {
      for (const line of codeLines(read(file))) {
        if (!line.includes('換金') && !line.includes('預金')) continue;
        assert.ok(
          line.includes('できません') || line.includes('ではなく'),
          `打ち消し以外の文脈で使っている: ${line.trim()}`,
        );
      }
    });
  }

  test('membership モジュールに円換算の関数を作らない', () => {
    for (const f of readdirSync(join(siteRoot, LIB_DIR))) {
      if (!f.endsWith('.js')) continue;
      const src = read(join(LIB_DIR, f));
      assert.doesNotMatch(src, /function\s+\w*(toYen|Yen|Cash|Withdraw)\w*\s*\(/i, `${f}: 円換算・出金の関数を作らない`);
    }
  });

  test('両ページに「現金・預金ではない」旨の注記がある', () => {
    for (const file of UI_FILES) {
      assert.match(read(file), /現金・預金ではなく/, `${file}: 注記が無い`);
    }
  });
});

/* ================================================================
   2. 未確定の数値を UI へ出さない
   ================================================================ */

describe('未確定の数値を出さない（TBD-1〜TBD-8）', () => {
  test('UI に固定のポイント数を書かない', () => {
    // `500 pt` `1000ポイント` のような固定値。テンプレート（`} pt`）は対象外
    const re = /\d+\s*(pt|ポイント)(?![）\w])/;
    for (const file of UI_FILES) {
      for (const line of codeLines(read(file))) {
        assert.doesNotMatch(line, re, `${file}: 固定のポイント数を書いている → ${line.trim()}`);
      }
    }
  });

  test('UI に固定の「◯か月で昇格」を書かない', () => {
    const re = /\d+\s*か月(継続|目|で)/;
    for (const file of UI_FILES) {
      for (const line of codeLines(read(file))) {
        assert.doesNotMatch(line, re, `${file}: 固定の必要月数を書いている → ${line.trim()}`);
      }
    }
  });

  test('UI に景品の品目を固定で書かない', () => {
    for (const file of UI_FILES) {
      for (const line of codeLines(read(file))) {
        for (const w of ['コーヒー', 'お米', 'お菓子', 'ギフトカード', 'Amazonギフト']) {
          assert.equal(line.includes(w), false, `${file}: 「${w}」を固定で書いている（カタログはデータ駆動） → ${line.trim()}`);
        }
      }
    }
  });

  test('membership モジュールが昇格月数・付与ポイントの既定値を持たない', () => {
    const ranks = read(join(LIB_DIR, 'ranks.js'));
    const rewards = read(join(LIB_DIR, 'rewards.js'));
    assert.match(ranks, /RANK_THRESHOLDS_UNSET/);
    assert.doesNotMatch(
      ranks,
      /\[RANK\.(SILVER|GOLD|PLATINUM)\]:\s*\d/,
      'ranks.js に昇格月数の既定値を書いてはいけない（TBD-2）',
    );
    assert.doesNotMatch(
      rewards,
      /monthlyPoints:\s*\d/,
      'rewards.js に付与ポイントの既定値を書いてはいけない（TBD-1）',
    );
  });

  test('同梱の景品カタログは draft のまま（架空の景品を配らない）', () => {
    const raw = JSON.parse(read('src/data/membership/rewardCatalog.json'));
    assert.equal(raw.status, 'draft');
    assert.deepEqual(raw.items, []);
  });
});

/* ================================================================
   2.5 廃止済みの訴求を復活させない / 未取得を「0 件」と言い切らない
   ================================================================ */

describe('正本で廃止された訴求を出さない', () => {
  test('🔴 実装が無いプレミアム限定コンテンツを訴求しない（RENEWAL_2026_08.md §6.1）', () => {
    for (const file of UI_FILES) {
      for (const line of codeLines(read(file))) {
        for (const w of ['穴馬レポート', '優先メルマガ', '詳細レポート', 'canSeePremiumExtras']) {
          assert.equal(line.includes(w), false, `${file}: 「${w}」は廃止済み → ${line.trim()}`);
        }
      }
    }
  });

  test('🔴 廃止済みの価格・会場別アクセスを UI に書かない', () => {
    for (const file of UI_FILES) {
      for (const line of codeLines(read(file))) {
        for (const w of ['88,000', '66,000', '12,000', '6,600', 'venueAccess']) {
          assert.equal(line.includes(w), false, `${file}: 廃止済みの「${w}」を書いている → ${line.trim()}`);
        }
      }
    }
  });

  test('🔴 特典履歴は pending と「0 件」を同じ文言にしない', () => {
    const src = read('src/pages/mypage.astro');
    const marker = 'まだ受け取られた特典はありません';
    assert.ok(src.includes(marker), '「まだありません」の分岐が消えている');
    // pending を先に判定してから 0 件の文言へ落ちること
    const pendingBranch = src.indexOf("club.history.status !== 'ready'");
    assert.ok(pendingBranch > 0, 'pending を先に判定していない（未取得を 0 件と言い切ってしまう）');
    assert.ok(pendingBranch < src.indexOf(marker), 'pending の判定が「まだありません」より後ろにある');
  });
});

/* ================================================================
   3. ランクを認可に使わない
   ================================================================ */

describe('ランク・リワードを認可に使わない', () => {
  test('auth 層が membership を参照しない', () => {
    for (const f of ['tiers.js', 'entitlement.js', 'session.js', 'previewMode.js']) {
      const src = read(join('src/lib/auth', f));
      for (const forbidden of ['membership', 'MemberRank', 'KIリワード', 'rewardBalance', 'contractPrice']) {
        assert.equal(src.includes(forbidden), false, `auth/${f} が ${forbidden} を参照している`);
      }
    }
  });

  test('membership 層が認可関数を呼ばない', () => {
    for (const f of readdirSync(join(siteRoot, LIB_DIR))) {
      if (!f.endsWith('.js')) continue;
      for (const line of codeLines(read(join(LIB_DIR, f)))) {
        for (const forbidden of ['canSeeBetting', 'canSeeMarks', 'resolveEntitlement', 'verifySession', 'signSession']) {
          assert.equal(line.includes(forbidden), false, `${f}: ${forbidden} を呼んではいけない → ${line.trim()}`);
        }
      }
    }
  });

  test('セッション Cookie の署名材料を変更していない（全員ログアウトを起こさない）', () => {
    const src = read('src/lib/auth/session.js');
    const material = src.match(/export function canonicalizeSession\(c\) \{[\s\S]*?\n\}/);
    assert.ok(material, 'canonicalizeSession が見つからない');
    for (const key of ['c.email', 'c.tier', 'c.venueAccess', 'c.issuedAtMs', 'c.expiresAtMs']) {
      assert.ok(material[0].includes(key), `署名材料から ${key} が消えている`);
    }
    assert.doesNotMatch(material[0], /rank|reward|contract/i, '署名材料へ会員クラブの値を足してはいけない');
  });

  test('Stripe webhook が書くフィールドを増やしていない', () => {
    const src = read('netlify/functions/stripe-webhook.js');
    const assigned = [...src.matchAll(/fields\.(\w+)\s*=/g)].map((m) => m[1]).sort();
    assert.deepEqual(assigned, ['AccessEnabled', 'PlanType', 'Status'],
      'Airtable の列が無い状態で書き込みを増やすと、プラン付与ごと失敗する');
    assert.equal(src.includes('membership'), false, 'スキーマ移行の承認前に membership を配線しない');
  });
});

/* ================================================================
   4. KAA 型の育成・ゲーム機能を持ち込まない
   ================================================================ */

describe('KI は馬育成アプリを作らない', () => {
  test('membership 層に育成・ゲームの語彙が無い', () => {
    for (const f of readdirSync(join(siteRoot, LIB_DIR))) {
      if (!f.endsWith('.js')) continue;
      const src = read(join(LIB_DIR, f));
      for (const w of ['育成', 'ガチャ', 'ミッション', 'ログインボーナス', 'デイリー報酬']) {
        // コメントで「作らない」と書くのは可。実装語として現れないことを見る
        const inCode = codeLines(src).filter((l) => l.includes(w));
        assert.deepEqual(inCode, [], `${f}: 「${w}」が実装側に現れている`);
      }
    }
  });

  test('UI に育成・ゲームの訴求が無い', () => {
    for (const file of UI_FILES) {
      for (const line of codeLines(read(file))) {
        for (const w of ['育成', 'ガチャ', 'ログインボーナス', 'デイリーミッション']) {
          assert.equal(line.includes(w), false, `${file}: 「${w}」を訴求してはいけない → ${line.trim()}`);
        }
      }
    }
  });
});
