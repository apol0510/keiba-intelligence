/**
 * purchaseEmailCopy.js — 購入導線から届くメールの文面
 *
 * 正本: docs/RENEWAL_2026_08.md §6（課金）
 *
 * 背景（2026-09-02）:
 *   有料の申し込みから届くメールが「無料会員登録ありがとうございます！」だった。
 *   受け取った人は **いま自分が何をしているのか** が分からない。
 *   知りたいのは 1 つだけ ——「このリンクを開けばお支払いに進む」。
 *
 * 🔴 ここで決めるのは **文面だけ**。認証の仕組み・有効期限・認可は変えない。
 * 🔴 金額は書かない。請求額の正本は Stripe の Price であり、
 *    メールに焼き付けると価格変更時に食い違う。
 * 🔴 「まだ課金されていない」ことを必ず書く。
 *    確認メールの時点で引き落とされたと誤解されないため。
 */

/** 購入導線ではないときの文面（従来どおり）。 */
export const FREE_SIGNUP_COPY = Object.freeze({
  subject: '【KEIBA Intelligence】無料会員登録ありがとうございます！',
  heading: '無料会員登録ありがとうございます！',
  lead: '以下のボタンをクリックして、登録を完了してください。',
  cta: '登録を完了する',
  /** 特典の紹介などを載せてよいか。 */
  showBenefits: true,
});

/** ログイン（既存会員）のときの文面（従来どおり）。 */
export const LOGIN_COPY = Object.freeze({
  subject: '【KEIBA Intelligence】ログインリンク',
  heading: 'ログインリンク',
  lead: '以下のボタンをクリックしてログインしてください。',
  cta: 'ログインする',
  showBenefits: false,
});

/**
 * 購入導線のときの文面。
 *
 * 「次に何が起きるか」だけを、迷いようのない言葉で書く。
 */
export const PURCHASE_COPY = Object.freeze({
  subject: '【KEIBA Intelligence】お支払い手続きへお進みください',
  heading: 'あと1ステップでお申し込み完了です',
  lead: 'ご本人確認のためのメールです。下のボタンを開くと、そのまま<b>お支払い画面</b>へ進みます。',
  cta: 'お支払いへ進む',
  showBenefits: false,
  /** ボタンの下に置く注意書き。 */
  note: 'このメールだけでは課金されません。お支払い画面で最終金額をご確認いただけます。',
});

/**
 * 購入意図の有無で文面を選ぶ。
 *
 * @param {string|null|undefined} intent  `purchaseIntent.normalizeIntent` を通した値
 * @param {'register'|'login'} kind       購入意図が無いときにどちらを使うか
 */
export function emailCopyFor(intent, kind = 'register') {
  if (typeof intent === 'string' && intent.trim()) return PURCHASE_COPY;
  return kind === 'login' ? LOGIN_COPY : FREE_SIGNUP_COPY;
}
