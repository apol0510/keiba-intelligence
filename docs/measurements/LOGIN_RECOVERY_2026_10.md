# ログインの行き止まり解消（2026-10）— 正本

作成: 2026-10-19 / 対象: 無料登録の確認リンク → ログイン → マイページ・再契約（`/login`・`/auth/verify`・`send-magic-link`・`verify-magic-link`・`register-free`）

🔴 本書に個人を特定できる情報（氏名・email・顧客 ID・token）を書かない。数値は集計値だけ。
🔴 的中率・回収率・実績表示、価格・商品内容・会員権利・販売条件は扱わない（MK 2026-10-19 決定）。

---

## 1. 本番の導線監査（2026-10-19・実ブラウザ 375px / 1280px）

Playwright（Chromium）で本番 `keiba-intelligence.jp` を開き、アクセス解析の通信は遮断した。
登録・ログイン・申し込みの関数は **応答を差し替えて** 画面の挙動だけを確かめた（実登録・実メール・Stripe セッションは作っていない）。
会員ページ（マイページ・買い目）は localhost でテスト用の署名鍵とセッションを作って確認した。

### 1.1 行き止まり（コードと画面で確認した事実）

| # | 誰が | 何が起きる | 原因 |
|---|---|---|---|
| A | 無料登録したが確認リンク（15 分）を期限後に開いた人 | `/auth/verify`「トークンの有効期限が切れています。もう一度ログインしてください」→ `/login` で送信 →「アカウントが無効です。サポートまでお問い合わせください。」 | `send-magic-link` が `Status !== 'active'` を 403 にする。未確認の登録者は `pending` |
| B | 有料契約が終わった・退会した人 | ログインできない（同上の 403）。料金ページから申し込むと `start-purchase` が 502「送信に失敗」 | 契約終了で `stripe-webhook` が `Status: inactive` を書く。正本（WITHDRAWAL_2026_10.md）は「退会後も無料会員として印まで見られる・再利用は改めて申し込む」 |
| C | カード決済に失敗した会員 | セッション（7 日）が切れると再ログインできず、カードを直す「お支払い管理ページ」にも入れない | `Status: payment_failed`。webhook のコメントは「アクセスは即時停止しない」 |
| D | 同じログインリンクを 2 回開いた人（メールアプリ内で開いた後に「Safari で開く」等） | 2 回目は「このリンクは既に使用されています。もう一度ログインしてください。」— **すでにログインできている端末でも**失敗表示で止まる | リンクは 1 回だけ有効（仕様）。画面がログイン済みかを確かめていなかった |

- B は 2026-10-07 時点の解約予約 4 件（終了日 10/15・10/19・10/27・10/28）と、それ以前に終了した 1 件が順に該当する。
  RETENTION_2026_10.md §1.3 の「B は短時間に連続発行」「D は 7 日ごとに再ログイン」も、D の型（アプリ内ブラウザと通常ブラウザでログイン状態が共有されない）と整合する。
- 確認メールのリンクに `&email=` が載っていた（`register-free`）。`/auth/verify` も `verify-magic-link` も email を読んでいない（認証は token だけ）。
  ログイン用リンク（`send-magic-link`）は既に token だけだった。登録用 token が `Math.random` である件は PR #161（registry 7a7522ac）が扱う。

### 1.2 そのほかの観察（本 PR の範囲外・KAO registry に登録）

- 無料予想ページの HTML: 南関 約 1.4MB / 中央 約 3.5MB（375px の初回表示で最大 8 秒）。
- `/free-prediction/nankan` の 375px 横スクロール: 2026-10-19 は **再現しない**（scrollWidth = 375）。
- robots.txt の Sitemap が旧ホスト（`*.netlify.app`）。
- ゲスト表示の帯（無料予想ページ）に「登録済みの方はログイン」が無く、セッション切れの有料会員には「無料会員に登録して印を見る」しか出ない。
- `/login` で未登録のアドレスを入れると「料金プランからご登録ください」（無料登録 `/register` ではなく有料プランへ案内）。

## 2. 変更（本 PR）

| 対象 | 変更 |
|---|---|
| `src/lib/auth/loginEligibility.js`（新規） | ログインリンクを送る Status を **active / pending / inactive / payment_failed** に固定。`suspended` / `cancelled` / 未知 / 空は従来どおり 403（fail-closed） |
| `send-magic-link.js` | 上の判定を使う（有効期限 15 分・token の作り方・応答形は不変） |
| `verify-magic-link.js` | 認証で書くのは本人確認の完了だけ（空 / pending / active → `Status: active`・`AccessEnabled: true`、従来どおり）。**inactive・payment_failed の記録は書き換えない**。tier は従来どおり PlanType・有効期限・退会記録で決まる |
| `register-free.js` | 確認リンクから `&email=` を外し、ログインと同じ `buildMagicLinkUrl` に統一（token の作り方は PR #161 が扱うため本 PR では変えない） |
| `/auth/verify` | リンクが使えなかったら get-session（署名付き Cookie をサーバーが検証）で確認し、**ログイン済みならそのままマイページ（購入導線なら申し込みの続き）へ**。未ログインなら「使用済み / 期限切れ（15 分）/ 確認できない」を言い分け、「新しいログインリンクを受け取る」ボタンと、メールアプリ内ブラウザの補足を出す |
| GA4 | `ki_verify_fallback{result: signed_in \| relogin}` を追加（FUNNEL_2026_10.md と同じ契約。PII なし） |

🔴 権限は広げていない: inactive（PlanType=free）で認証しても free のセッション。退会記録が未反映なら有料は出ない（`tierForNewSession`）。
🔴 認証の意味（1 回だけ・15 分）は変えていない。送り先は本人のアドレスだけで、`register-free` の再送と同じ。

## 3. 検証

- `src/lib/auth/loginEligibility.test.mjs`（14 件。`npm run test:login-eligibility` → `npm run build`）:
  Status の許可・拒否、認証時の書き込み、**verify-magic-link の実ハンドラ**で pending → active / inactive は free のまま書き換えない /
  退会記録が未反映なら有料を出さない / payment_failed は PlanType どおり / 使用済み・期限切れは従来どおり 403。
- `src/lib/auth/verifyRecovery.test.mjs`（5 件・`test:auth`）: 文言・ログイン済み判定・verify.astro の配線・認証判定の不変。
- `src/lib/auth/magicLinkBase.test.mjs`: 確認リンクに email が無い。
- ブラウザ（Playwright・localhost・関数応答と GA 通信は差し替え）375px / 1280px で 38 項目:
  使用済み / 期限切れ / 見つからない × 未ログイン → 再取得ボタン・横スクロールなし・`/login` へ遷移、
  使用済み × ログイン済み → `/mypage` へ、`ki_verify_fallback` の発火、イベントに email・token なし。

## 4. 実験として扱う

| 項目 | 内容 |
|---|---|
| 問題 | 確認リンクの期限切れ・契約終了・決済失敗の人がログインできず、自力で戻れない。2 回目に開いたリンクはログイン済みでも失敗表示 |
| baseline | `send-magic-link` の 403 件数・`/auth/verify` の失敗件数は **未計測**（2026-10-19 以前はイベントなし）。構造上の該当: 契約終了者は 10-28 までに最大 5 件、未確認の登録者は Airtable の pending 件数（API 読み取り権限なしで未取得） |
| 仮説 | 行き止まりを外すと、(1) 期限切れから無料会員になる人、(2) 退会者の無料利用と再契約、(3) 決済失敗者のカード更新 が自力で完了する |
| 介入 | §2（ログイン可能な Status の拡張・認証時の記録保持・verify 失敗時の分岐と案内）。価格・権利・実績表示は不変 |
| 期待結果 | `ki_login_verify_result{result:expired\|used}` の後に `ki_verify_fallback{relogin}` → 同一セッションでの `ki_login_verify_result{ok}` が出る。`ki_verify_fallback{signed_in}` の件数 = 以前は失敗表示で止まっていた件数。Netlify の `send-magic-link` 403 ログが 0 件近くになる（suspended のみ） |
| 評価期間 | 2026-10-20 〜 2026-11-16（FUNNEL_2026_10.md と同じ 28 日）。最初の 7 日でイベントの発火を確認 |
| 判断 | 有害（誤ログイン・権限の誤付与・苦情）が無ければ維持。suspended 等で 403 が増える・契約状態の記録が崩れる兆候があれば差し戻す |

🔴 母数が小さい（ログイン失敗は月数件〜数十件の見込み）ため統計的な判断はできない。件数と経路を記録して定性的に判断する。

### 4.1 評価に必要な運用（範囲外）

- GA4 の探索で `ki_login_verify_result` → `ki_verify_fallback` → `ki_login_verify_result{ok}` の経路を作る（FUNNEL_2026_10.md §3.1 の GA4 読み取り権限が前提）。
- Airtable の Status 別件数（pending / inactive / payment_failed）を月初に集計する（read-only・件数のみ）。
