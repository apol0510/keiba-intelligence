/**
 * membershipCopy.guard.test.mjs — 会員継続制度の「言ってはいけない・書いてはいけない」を静的に禁止する
 *
 * 正本: docs/MEMBERSHIP_REWARDS.md §3.3 / §7 / §9
 *
 * ここで守るのは 4 つ。
 *   1. リワードを **現金・預金と誤認させる表現**を出さない（§8 L-8 の前提）
 *   2. UI に出る数値が **§7.1 の確定値と一致**していること（未確定の品目は出さない）
 *   2b. **正本（docs）とコードの定数が一致**していること
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

const UI_FILES = ['src/pages/pricing.astro', 'src/pages/mypage.astro', 'src/pages/terms.astro'];
const TERMS = 'src/pages/terms.astro';
const LIB_DIR = 'src/lib/membership';
const SPEC = '../docs/MEMBERSHIP_REWARDS.md';

/** §7.1 の確定値。UI に出してよい数値はこれだけ。 */
const CONFIRMED_POINTS = Object.freeze([100, 600, 1200]);
/**
 * 3 / 12 / 24 は昇格月数、1 は付与の単位（月額 1 期＝1 か月＝100pt・`PERIOD_MONTHS.MONTHLY`）。
 * いずれも確定値なので UI に出してよい。
 */
const CONFIRMED_MONTHS = Object.freeze([1, 3, 12, 24]);
/** 猶予日数（「90日」は月数ではなく日数として出る） */
const CONFIRMED_DAYS = Object.freeze([90]);

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
  test('🔴 UI に出るポイント数は確定値（100 / 600 / 1,200）だけ', () => {
    for (const file of UI_FILES) {
      for (const line of codeLines(read(file))) {
        for (const m of line.matchAll(/([\d,]+)\s*(pt|ポイント)(?![）\w])/g)) {
          const n = Number(m[1].replace(/,/g, ''));
          assert.ok(CONFIRMED_POINTS.includes(n),
            `${file}: 確定値でないポイント数 → ${m[0]} / ${line.trim()}`);
        }
      }
    }
  });

  test('🔴 UI に出る月数・日数は確定値（3 / 12 / 24 か月・90 日）だけ', () => {
    for (const file of UI_FILES) {
      for (const line of codeLines(read(file))) {
        for (const m of line.matchAll(/(\d+)\s*か月/g)) {
          assert.ok(CONFIRMED_MONTHS.includes(Number(m[1])),
            `${file}: 確定値でない月数 → ${m[0]} / ${line.trim()}`);
        }
        for (const m of line.matchAll(/(\d+)\s*日以内/g)) {
          assert.ok(CONFIRMED_DAYS.includes(Number(m[1])),
            `${file}: 確定値でない日数 → ${m[0]} / ${line.trim()}`);
        }
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

  test('🔴 正本（docs §7.1）とコードの定数が一致している', () => {
    const spec = read(SPEC);
    // 正本側にこの表記が残っていること（片方だけ変えたら落ちる）
    for (const needed of [
      '**100 pt / 月**',
      '**Bronze 0 / Silver 3 / Gold 12 / Platinum 24 か月**',
      '**2 段階: 小 600 pt / 大 1,200 pt**',
      '**1 点あたり ¥796 以内**',
      '**12 か月・24 か月**',
      '**解約後 90 日で失効**',
    ]) {
      assert.ok(spec.includes(needed), `正本 §7.1 から「${needed}」が消えている`);
    }

    const ranks = read(join(LIB_DIR, 'ranks.js'));
    const rewards = read(join(LIB_DIR, 'rewards.js'));
    const catalog = read(join(LIB_DIR, 'catalog.js'));
    const priceLock = read(join(LIB_DIR, 'priceLock.js'));

    assert.match(rewards, /export const MONTHLY_POINTS = 100;/);
    assert.match(rewards, /export const GRACE_DAYS = 90;/);
    assert.match(rewards, /export const ANNUAL_TERM_MONTHS = 12;/);
    assert.match(ranks, /\[RANK\.BRONZE\]:\s*0,[\s\S]*\[RANK\.SILVER\]:\s*3,[\s\S]*\[RANK\.GOLD\]:\s*12,[\s\S]*\[RANK\.PLATINUM\]:\s*24,/);
    assert.match(catalog, /costPoints:\s*600[\s\S]*costPoints:\s*1200/);
    assert.match(catalog, /export const MAX_ITEM_VALUE_YEN = 796;/);
    assert.match(catalog, /MILESTONE_MONTHS = Object\.freeze\(\[12, 24\]\)/);
    assert.match(priceLock, /export const REENTRY_GRACE_DAYS = 90;/);
  });

  test('🔴 ランク倍率を復活させていない（待遇差は景品側で付ける）', () => {
    const rewards = read(join(LIB_DIR, 'rewards.js'));
    assert.match(rewards, /rankBonusPoints:\s*null,/, 'ACCRUAL にランク倍率を入れてはいけない（TBD-1b）');
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
   2.7 保守ライン S-1〜S-3（景表法の総付景品の枠内に留める）
   ================================================================ */

describe('保守ラインを崩さない', () => {
  test('🔴 S-1: 景品の上限は月額の 10 分の 2（¥796）に固定されている', () => {
    const catalog = read(join(LIB_DIR, 'catalog.js'));
    assert.match(catalog, /export const MAX_ITEM_VALUE_YEN = 796;/);
    // 月額 ¥3,980 が変われば上限も変わる。両方を同時に見直させるための結び付け
    const plans = read('src/lib/billing/plans.js');
    assert.match(plans, /MONTHLY_PRICE_YEN = 3980;/,
      '月額を変えたら MAX_ITEM_VALUE_YEN（= 月額の10分の2）も見直すこと');
  });

  test('🔴 S-2: 記念品の月は通常交換を止める分岐がある', () => {
    const catalog = read(join(LIB_DIR, 'catalog.js'));
    assert.match(catalog, /isMilestoneMonth\(months\)/);
    assert.match(catalog, /blockedByMilestone/);
  });

  test('🔴 S-3: 抽選・くじ・先着を入れていない（全員同一条件＝総付を維持）', () => {
    const targets = [...UI_FILES];
    for (const f of readdirSync(join(siteRoot, LIB_DIR))) {
      if (f.endsWith('.js')) targets.push(join(LIB_DIR, f));
    }
    // 「抽選はありません」のような打ち消し文は許す（§8.1 S-3 を明示する文言）
    const isDenial = (l) => /(ありません|しません|入れない|行いません)/.test(l);
    for (const file of targets) {
      for (const line of codeLines(read(file))) {
        for (const w of ['抽選', 'くじ', '先着', 'ランダム', 'Math.random']) {
          if (!line.includes(w)) continue;
          assert.ok(isDenial(line),
            `${file}: 「${w}」は総付景品の前提を崩す → ${line.trim()}`);
        }
      }
    }
  });
});

/* ================================================================
   2.8 利用規約（/terms）と正本の一致
   ================================================================ */

describe('/terms が確定仕様と一致している', () => {
  test('🔴 確定した 5 項目がすべて条文にある', () => {
    const t = read(TERMS);
    assert.match(t, /KI会員継続制度・KIリワード/, '会員継続制度の条が無い');

    // §3.3 / §8.1 S-4: 現金・預金ではない／換金不可
    assert.match(t, /現金・預金ではなく/);
    assert.match(t, /換金・払い戻し・第三者への譲渡はできません/);

    // §7.1 / §7.7: 支払い成功期間に 100pt/月
    assert.match(t, /1か月あたり100pt/);
    assert.match(t, /お支払いが成功した期間/);
    assert.match(t, /お支払いが確認できない期間には付与しません/);

    // §7.1 TBD-6: 契約中は失効しない
    assert.match(t, /ご契約が続いている間、ポイントは失効しません/);

    // §7.1 TBD-6 / TBD-7: 解約後 90 日で失効
    assert.match(t, /解約日から90日/);

    // §7.1 TBD-7 / TBD-8: 90 日以内の再加入で復活
    assert.match(t, /90日以内に再度お申し込み/);
    assert.match(t, /継続価格ロック/);
  });

  test('🔴 /terms に未確定事項・新しい条件を書かない', () => {
    for (const line of codeLines(read(TERMS))) {
      // 景品の品目・必要ポイントは未確定（§7.5）
      for (const w of ['コーヒー', 'お米', 'お菓子', 'ギフトカード', '600pt', '1,200pt', '記念品']) {
        assert.equal(line.includes(w), false, `未確定/別条件を規約に書いている: ${w} → ${line.trim()}`);
      }
      // ランク条件も規約には持ち込まない（待遇であって契約条件ではない）
      for (const w of ['Bronze', 'Silver', 'Gold', 'Platinum']) {
        assert.equal(line.includes(w), false, `規約にランクを書いている: ${w}`);
      }
    }
  });

  test('🔴 規約の数値は確定値と一致する（正本を変えたら落ちる）', () => {
    const t = read(TERMS);
    const rewards = read(join(LIB_DIR, 'rewards.js'));
    // 100 pt / 月
    assert.match(rewards, /export const MONTHLY_POINTS = 100;/);
    assert.ok(t.includes('100pt'), '規約の付与ポイントが確定値と違う');
    // 90 日
    assert.match(rewards, /export const GRACE_DAYS = 90;/);
    assert.ok(t.includes('90日'), '規約の猶予日数が確定値と違う');
  });

  test('最終更新日が更新されている', () => {
    assert.match(read(TERMS), /最終更新日: 2026年9月1日/);
  });
});

/* ================================================================
   2.9 テストが ambient な env に依存しない
   ================================================================ */

describe('ビルド時テストが本番 env フラグに依存しない', () => {
  /** テスト対象のテストファイル群。 */
  const TEST_FILES = [
    'src/lib/billing/stripeWebhook.test.mjs',
    'src/lib/billing/stripeCheckout.test.mjs',
    'src/lib/billing/billing.test.mjs',
    'src/lib/auth/auth.test.mjs',
    'src/lib/auth/entitlementRoutes.test.mjs',
    ...readdirSync(join(siteRoot, LIB_DIR)).filter((f) => f.endsWith('.test.mjs')).map((f) => join(LIB_DIR, f)),
  ];

  /** 本番 env に存在しうる、挙動を変えるフラグ。 */
  const RUNTIME_FLAGS = ['MEMBERSHIP_WRITE_ENABLED', 'MEMBERSHIP_READ_ENABLED', 'KI_RANK_THRESHOLDS', 'KI_REWARD_ACCRUAL'];

  test('🔴 「フラグが未設定であること」を ambient の前提にしない', () => {
    // 🔴 これをやると、本番でフラグを有効にした瞬間に `npm run build` が落ちる
    //    （2026-09-01 に実際に発生し、WRITE 有効化が 2 回失敗した）
    for (const file of TEST_FILES) {
      for (const line of codeLines(read(file))) {
        for (const flag of RUNTIME_FLAGS) {
          const asserts = line.includes('assert.') && line.includes(`process.env.${flag}`);
          if (!asserts) continue;
          // テスト内で値を作ってから検証しているものは可。
          // ambient をそのまま前提にする書き方（前提: ...）を禁止する
          assert.equal(line.includes('前提'), false,
            `${file}: ambient env を前提にしている → ${line.trim()}`);
        }
      }
    }
  });

  test('🔴 env を書き換えるテストは元の値を復元する（単純 delete で終わらない）', () => {
    for (const file of TEST_FILES) {
      const src = read(file);
      for (const flag of RUNTIME_FLAGS) {
        const mutates = codeLines(src).some((l) =>
          l.includes(`process.env.${flag} =`) || l.includes(`delete process.env.${flag}`));
        if (!mutates) continue;
        // 保存 → 復元の形跡があること
        assert.match(src, new RegExp(`(saved|AMBIENT)[\\w]*\\s*=\\s*process\\.env\\.${flag}`),
          `${file}: ${flag} を書き換える前に元の値を保存していない`);
        assert.match(src, new RegExp(`process\\.env\\.${flag}\\s*=\\s*(saved|AMBIENT)`),
          `${file}: ${flag} を元の値へ復元していない（単純 delete で終わっている）`);
      }
    }
  });

  test('🔴 stripeWebhook.test.mjs は各テスト開始時にフラグを既定へ揃える', () => {
    const src = read('src/lib/billing/stripeWebhook.test.mjs');
    const hook = src.slice(src.indexOf('beforeEach('), src.indexOf('after('));
    assert.match(hook, /delete process\.env\.MEMBERSHIP_WRITE_ENABLED;/,
      'beforeEach で既定（未設定）へ揃えていない');
    assert.match(src, /after\(\(\) => \{[\s\S]*?MEMBERSHIP_WRITE_ENABLED = AMBIENT_WRITE_FLAG/,
      'after で ambient の値を復元していない');
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

  test('🔴 Stripe webhook のプラン付与が書く列を増やしていない', () => {
    const src = read('netlify/functions/stripe-webhook.js');
    // applyPlan が組み立てる fields は従来どおり 3 列だけ
    const assigned = [...src.matchAll(/fields\.(\w+)\s*=/g)].map((m) => m[1]).sort();
    assert.deepEqual(assigned, ['AccessEnabled', 'PlanType', 'Status'],
      'Airtable の列が無い状態でプラン付与の書き込みを増やすと、付与ごと失敗する');
  });

  test('🔴 認可とリワードを混同しない（TBD-10・§7.7）', () => {
    // 1. リワード側は認可を読まない
    const rewards = read(join(LIB_DIR, 'rewards.js'));
    for (const forbidden of ['entitlement', 'canSeeBetting', 'canSeeMarks', 'AccessEnabled', 'PlanType']) {
      assert.equal(codeLines(rewards).some((l) => l.includes(forbidden)), false,
        `rewards.js が認可の概念（${forbidden}）を参照している`);
    }

    // 2. 認可側は台帳・付与を読まない
    for (const f of ['entitlement.js', 'tiers.js', 'session.js']) {
      const src = read(join('src/lib/auth', f));
      for (const forbidden of ['ledger', 'accrual', 'Reward', 'tenure', 'payment_succeeded']) {
        assert.equal(codeLines(src).some((l) => l.includes(forbidden)), false,
          `auth/${f} がリワードの概念（${forbidden}）を参照している`);
      }
    }

    // 3. webhook: payment_failed は認可（Status）だけを触り、付与を呼ばない
    const wh = read('netlify/functions/stripe-webhook.js');
    /** switch の 1 ケースだけを切り出す（ファイル内の別の switch に引きずられないように）。 */
    const caseBody = (label) => {
      const start = wh.indexOf(`case '${label}'`);
      assert.ok(start > 0, `case '${label}' が見つからない`);
      const rest = wh.slice(start + 1);
      const nextCase = rest.indexOf("      case '");
      const nextDefault = rest.indexOf('      default:');
      const ends = [nextCase, nextDefault].filter((i) => i >= 0);
      return ends.length ? rest.slice(0, Math.min(...ends)) : rest;
    };
    const failedCase = caseBody('invoice.payment_failed');
    assert.match(failedCase, /applyPlan\(email, \{ status: 'payment_failed' \}\)/,
      'payment_failed が Status 以外を触っている');
    assert.equal(failedCase.includes('recordPaidPeriod'), false,
      '🔴 支払い失敗で付与している（保留にならない）');
    for (const forbidden of ['planType', 'accessEnabled']) {
      assert.equal(failedCase.includes(forbidden), false,
        `payment_failed が ${forbidden} を触っている（認可の挙動を変えてはいけない）`);
    }

    // 4. 付与は支払い成功でだけ駆動する
    const okCase = caseBody('invoice.payment_succeeded');
    // stripe は Price を引くためだけに渡す（認可には使わない）
    assert.match(okCase, /recordPaidPeriod\(email, invoice, stripe\)/);
    assert.equal(okCase.includes('applyPlan'), false,
      '🔴 支払い成功で認可を書き換えている（付与だけを行うこと）');
  });

  /**
   * 実在しそうな Stripe id の形。
   *
   * 🔴 Netlify の secrets scanning は **env の値をリポジトリ内から探す**。
   *    `STRIPE_PRICE_PREMIUM` の実値を貼るとビルドが
   *    `Build script returned non-zero exit code: 2` で落ちる（2026-09-02）。
   *
   * 🔴 `SECRETS_SCAN_OMIT_*` で検査を無効化しない。**実値を書かない方**を守る。
   *
   * 判定は「接頭辞 + `_` + 英数 14 文字以上」。
   * 短縮表記（`price_1UAsLM…`）や fixture 名（`price_FIXTURE_not_a_real_id`）は
   * 14 文字連続の英数にならないので当たらない。
   */
  const REALISH_STRIPE_ID = /\b(price|prod|cus|sub|in|cs|acct|evt|pi|pm|whsec|il|si|txr|clock|we|seti|ch|re|tok)_[A-Za-z0-9]{14,}\b/;

  test('🔴 テスト・ドキュメントに実在の Stripe id を書かない', () => {
    // 🔴 docs も対象。2026-09-06 まで検査から漏れており、
    //    docs/progress.md に実 id が 19 箇所残っていた。
    const files = [
      'src/lib/billing/stripeWebhook.test.mjs',
      'src/lib/billing/stripeCheckout.test.mjs',
      'src/lib/membership/membershipE2E.test.mjs',
    ];
    const docs = ['docs/progress.md', 'docs/decisions.md', 'docs/STRIPE_TESTMODE_E2E.md',
                  'docs/MEMBERSHIP_REWARDS.md', 'docs/spec.md', 'CLAUDE.md'];

    for (const f of [...files, ...docs.map((d) => `../${d}`)]) {
      const src = read(f);
      const hit = src.match(REALISH_STRIPE_ID);
      assert.equal(hit, null, `🔴 ${f} に実在の Stripe id らしき値がある: ${hit && hit[0]}`);
    }
  });

  test('🔴 短縮表記・fixture 名を誤検知しない（監査の可読性を保つ）', () => {
    // 実 id を消すときは短縮表記に置き換える。これが弾かれると記録が書けなくなる
    const allowed = [
      'price_1UAsLM…', 'cus_VCar1z…', 'sub_1UCCk8…', 'evt_1UCCvp…', 'in_1UCCqt…',
      'clock_1UCBAR…', 'we_1UAsSe…', 'acct_1U9EyP…', 'pm_1UBRwf…',
      'price_FIXTURE_not_a_real_id', 'prod_x', 'cus_test_1', 'sub_test_1', 'in_test_1',
      'price_test_premium', 'cs_test_1',
    ];
    for (const v of allowed) {
      assert.equal(REALISH_STRIPE_ID.test(v), false, `🔴 短縮表記/fixture を誤検知した: ${v}`);
    }

    // 逆に、実 id の形は必ず捕まえる（ガードが緩んでいないこと）
    const caught = [
      'price_1UAsLMLbPC6OVRqMoZ3VSfRR', 'cus_VCar1zVD6J9chN', 'sub_1UCCk8LbPC6OVRqMDVO7qhOv',
      'evt_1UCCvpLbPC6OVRqMLSTIZm7Z', 'we_1UAgTiLbPC6OVRqMcfol1yoP', 'clock_1UCBARLbPC6OVRqME93sxVzj',
    ];
    for (const v of caught) {
      assert.equal(REALISH_STRIPE_ID.test(v), true, `🔴 実 id を見逃した: ${v}`);
    }
  });

  test('🔴 テストの fixture に production env の値を書かない', () => {
    // 🔴 Netlify の Secret Scanning は「production env の値」と
    //    「リポジトリ内の文字列」の一致を検出する。値が秘密かどうかは問わない。
    //    2026-09-06 に STRIPE_PORTAL_RETURN_URL の本番 URL がテスト 3 か所と
    //    一致し、production ビルドが exit code 2 で 3 回落ちた。
    //    🔴 SECRETS_SCAN_OMIT_* で回避しない。非本番の fixture を使う方を守る。
    const files = [
      'src/lib/billing/purchaseIntent.test.mjs',
      'src/lib/billing/stripeCheckout.test.mjs',
      'src/lib/billing/stripeWebhook.test.mjs',
      'src/lib/membership/membershipE2E.test.mjs',
    ];
    // 🔴 検査したい文字列は STRIPE_PORTAL_RETURN_URL の値そのもの。
    //    **このガード自身にベタ書きすると、それ自体が Secret Scanning に
    //    検出される**（2026-09-06 に実際に気づいた）。組み立てて持つ。
    //    素の origin（CORS の許可元）は実装の定数で env ではないため対象にしない。
    const PROD_ORIGIN = ['https://keiba', 'intelligence.jp'].join('-');
    const PROD_ENV_VALUES = [`${PROD_ORIGIN}/mypage`];
    for (const f of files) {
      const src = read(f);
      for (const v of PROD_ENV_VALUES) {
        assert.equal(src.includes(v), false,
          `🔴 ${f} に production env の値がある: ${v}（.invalid 等の非本番 fixture を使う）`);
      }
    }
  });

  test('🔴 secrets scanning を無効化していない', () => {
    // 🔴 正本（2026-09-02）: SECRETS_SCAN_OMIT_* で検査を回避しない。
    //    実値を書かない方を守る。
    const toml = read('netlify.toml');
    for (const bad of ['SECRETS_SCAN_ENABLED', 'SECRETS_SCAN_OMIT_KEYS', 'SECRETS_SCAN_OMIT_PATHS']) {
      assert.equal(toml.includes(bad), false, `🔴 netlify.toml で ${bad} を使って検査を回避している`);
    }
  });

  test('🔴 webhook の応答に個人情報・秘密値を載せない', () => {
    const wh = read('netlify/functions/stripe-webhook.js');
    // 失敗理由は内部の状態名だけ
    const noteFn = wh.slice(wh.indexOf('function note(label, status, reason)'), wh.indexOf('function membershipResultFromStore'));
    assert.equal(/email/i.test(noteFn), false, '🔴 応答に載る文字列へ email を入れている');
    assert.equal(/token|secret|key/i.test(noteFn), false);
    // 呼び出しごとに空にする（コンテナ再利用で前回分が漏れない）
    assert.match(wh, /membershipNotes\.length = 0;/);
  });

  /**
   * 関数本体を「次のトップレベル宣言まで」切り出す。
   * 🔴 固定幅の slice(0, N) にしない。関数に行が増えると検査対象から外れ、
   *    ガードが黙って効かなくなる（2026-09-05 に実際に起きた）。
   */
  const fnBody = (src, name) => {
    const i = src.indexOf(name);
    if (i < 0) return '';
    const rest = src.slice(i + name.length);
    const end = rest.search(/\n(?:export )?(?:async )?function |\n\/\* -{3,}/);
    return rest.slice(0, end < 0 ? rest.length : end);
  };

  test('🔴 付与の前提が欠けたら付与しない（月額へ丸めない・受信時刻で代用しない）', () => {
    const wh = read('netlify/functions/stripe-webhook.js');

    // 請求間隔: 判定できなければ null（月額へ fallback しない）
    const interval = wh.slice(wh.indexOf('export function periodMonthsFromRecurring('));
    assert.match(interval.slice(0, 900), /default: return null;/,
      '未知の interval を月額へ丸めている');
    assert.match(interval.slice(0, 900), /interval_count/,
      'interval_count を無視している（四半期払いが月額になる）');
    // 🔴 欠落時に 1 で補完しない
    assert.doesNotMatch(interval.slice(0, 900), /interval_count\s*(==|===)\s*null\s*\?\s*1/,
      'interval_count 欠落を 1 で補っている');
    // 🔴 請求期間の日数から月数を推測しない（28〜31 日の揺れがあり四半期と区別できない）
    assert.equal(wh.includes('period.end - '), false, '請求期間の差から月数を推測している');
    assert.equal(/periodMonths\s*=\s*Math\.round/.test(wh), false, '月数を丸めて推測している');
    assert.doesNotMatch(interval.slice(0, 900), /interval_count\s*\?\?\s*1/,
      'interval_count 欠落を 1 で補っている');

    // 支払い時刻: Stripe の paid_at を使い、無ければ null
    const paidAt = wh.slice(wh.indexOf('export function paidAtMsFromInvoice('));
    assert.match(paidAt.slice(0, 500), /status_transitions\?\.paid_at/);
    assert.equal(paidAt.slice(0, 500).includes('Date.now()'), false,
      '🔴 受信時刻で支払い時刻を代用している');

    // 付与本体: 前提が欠けたら保留（SKIPPED を返して付与しない）
    const record = fnBody(wh, 'async function recordPaidPeriod(');
    assert.match(record, /periodMonths == null[\s\S]*?return MEMBERSHIP_RESULT\.SKIPPED;/);
    assert.match(record, /occurredAtMs == null[\s\S]*?return MEMBERSHIP_RESULT\.SKIPPED;/);
    // 🔴 ¥0 の請求（トライアル・全額割引）では付与しない
    assert.match(record, /amountPaid == null[\s\S]*?return MEMBERSHIP_RESULT\.SKIPPED;/,
      '🔴 amount_paid が読めないのに付与しようとしている');
    assert.match(record, /amountPaid <= 0[\s\S]*?return MEMBERSHIP_RESULT\.SKIPPED;/,
      '🔴 ¥0 の請求で付与している（1 円も払っていない期間に 100pt が付く）');
    assert.equal(record.includes('Date.now()'), false,
      '🔴 付与日時に受信時刻を使っている');

    // 🔴 total / amount_due で代用しない
    const amount = fnBody(wh, 'export function amountPaidFromInvoice(');
    assert.match(amount, /invoice\?\.amount_paid/);
    assert.equal(/total|amount_due/.test(amount), false,
      '🔴 total / amount_due で支払い額を代用している');
  });

  test('🔴 継続月数は支払い済み期間から数える（TBD-9 / TBD-10）', () => {
    const rewards = read(join(LIB_DIR, 'rewards.js'));
    assert.match(rewards, /export function resolveTenureMonths\(/);
    assert.match(rewards, /export function tenureMonthsFromLedger\(/);
    // 起点も台帳も無ければ pending（0 か月へ倒さない）
    assert.match(rewards, /status: 'pending', months: null, source: null/);
  });

  test('🔴 会員継続制度の書き込みはフラグ付き・別リクエスト・失敗を報告する', () => {
    const src = read('netlify/functions/stripe-webhook.js');
    // フラグ無しでは実行されない
    for (const fn of ['recordContractPrice', 'recordCancellation', 'recordPaidPeriod']) {
      const body = fnBody(src, `async function ${fn}(`);
      // フラグが無ければ何もしない
      // フラグ無しは SKIPPED（理由を残してから返す形も許す）
      assert.match(body.slice(0, 400), /if \(!isWriteEnabled\(process\.env\)\)[\s\S]{0,120}?return MEMBERSHIP_RESULT\.SKIPPED;/,
        `${fn} の先頭でフラグを確認していない`);
      // 🔴 例外でハンドラを巻き添えにしないが、**成功扱いにもしない**
      assert.match(body, /catch \{[\s\S]*?return MEMBERSHIP_RESULT\.FAILED;/,
        `${fn} が失敗を FAILED として報告していない（握りつぶすと再送で復旧できない）`);
    }

    // 🔴 失敗したイベントを processed にしない（再送で復旧できる契約）
    const tail = src.slice(src.indexOf('membershipResults.includes'));
    assert.match(tail.slice(0, 600), /statusCode: 500/,
      '🔴 membership 失敗時に 500 を返していない');
    // 🔴 シグネチャに依存しない（v1 Lambda 対応で `markProcessed(event, id)` になった）。
    //    検査したいのは「失敗判定より後に記録すること」であって引数の形ではない。
    const markIdx = src.indexOf('await markProcessed(');
    const failIdx = src.indexOf('membershipResults.includes(MEMBERSHIP_RESULT.FAILED)');
    assert.ok(failIdx > 0 && failIdx < markIdx,
      '🔴 失敗判定より前に markProcessed している（再送が duplicate で無視される）');
    // 🔴 プラン付与の update に membership の列を混ぜていない
    const applyPlan = src.slice(src.indexOf('async function applyPlan('), src.indexOf('/* ---'));
    for (const col of ['MembershipStartedAt', 'CancelledAt', 'ContractPrice', 'CUSTOMER_FIELDS']) {
      assert.equal(applyPlan.includes(col), false,
        `applyPlan に ${col} を混ぜている（列が無いとプラン付与ごと 422 で落ちる）`);
    }
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
