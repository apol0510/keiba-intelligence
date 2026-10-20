# 無料会員登録の「確認メールを送った後」の案内（2026-10）— 正本

作成: 2026-10-20 / 対象: `/register` の送信後・`/auth/verify` の GA4 計測

🔴 本書に個人を特定できる情報（氏名・email・顧客 ID・token）を書かない。数値は集計値だけ。
🔴 的中率・回収率・実績表示、価格・商品内容・会員権利・販売条件・確認リンクの有効期限（15 分）は扱わない（MK 2026-10-19 決定）。
🔴 新しい種類のメール・自動送信は作らない。再送は本人が押したときだけ、既存の `send-magic-link` を使う。
関連: `LOGIN_GUIDANCE_2026_10.md`（#163・メールアプリ内ブラウザの注意）・`LOGIN_RECOVERY_2026_10.md`（pending もログインリンクを受け取れる）・`FUNNEL_2026_10.md`（GA4 契約）。

---

## 1. 問題（2026-10-20 顧客集計・件数のみ）

- 顧客 186 件のうち **34 件が pending**（確認リンクを一度も開いていない）。10 月の登録の約 4 割。
- 登録画面の送信後は「✅ 登録完了メールを送信しました。メールをご確認ください。」の 1 行だけで、
  どのアドレスへ送ったか（誤入力に気づけない）・迷惑メールフォルダ・有効期限 15 分・メールアプリ内ブラウザの注意・
  届かないときの再送手段が無かった（再送するにはフォームに 2 回入力し直す必要があった）。
- GA4 の `ki_login_verify_result` は登録の確認とログインを区別できず、「登録した人のうち何人が確認まで進んだか」を数えられなかった。

## 2. 変更

- `/register`: 送信成功（新規・未確認の再送）でフォームを隠し、案内パネルを出す。
  - 送信先は一部を伏せて表示（`abc***@example.jp`。ドメインは誤入力に気づけるよう全部）。`textContent` のみ。
  - 件名・迷惑メール / プロモーションのフォルダ・「ボタンを押すと登録完了・有効期限 15 分」。
  - メールアプリ内ブラウザの注意（`/login` の `browserHint` と同じ文言。test で一致を固定）。
  - 「確認メールを再送する」: 本人が押したときだけ `send-magic-link`（既存のログインリンク・pending も送信可）を呼ぶ。
    送った直後と押した直後は 60 秒押せない（連打でメールが重ならない）。サーバー側の挙動・有効期限は不変。
  - 「入力し直す」でフォームへ戻れる。既に認証済み（`alreadyRegistered`）の案内は従来どおり。
- 確認リンクに固定の `&src=signup` を付ける（`register-free` は常に、`send-magic-link` は `source: 'signup'` のときだけ）。
  それ以外の値は無視。認証の意味・tier・戻り先は不変。GA4 の page_location は許可リストで `src` を落とす（従来どおり）。
- GA4: `ki_login_verify_result` に `source: signup|login` を追加。`ki_signup_resend_result{result: sent|error}` を追加。PII なし。

## 3. 検証

- `src/lib/auth/signupGuidance.test.mjs`（12 件・`test:auth`）: 伏せ字・列挙値・GA4 の許可キー・文言・ページ配線・ブラウザ注意の一致・自動再送なし。
- `src/lib/auth/returnTo.handlers.test.mjs`（send-magic-link 実ハンドラ）: `source=signup` で `src=signup` だけを足す・他の値は無視・メールの件名は不変。
- `funnelEvents.test.mjs`（配線）・`purchaseIntent.test.mjs`・`magicLinkBase.test.mjs`、`trackRecordFreeze` guard green。
- `loginGuidance.guard.test.mjs` が `test:auth` から外れていたため戻した（LOGIN_GUIDANCE_2026_10.md §3 の記載どおり）。

## 4. 実験として扱う

| 項目 | 内容 |
|---|---|
| 問題 | 登録者の約 4 割が確認リンクを開かず、無料会員（印の閲覧）→ 有料検討へ進めない |
| baseline | pending 34 / 186（2026-10-20）。`source=signup` の verify 結果は未計測（本変更から計測開始） |
| 仮説 | 送信先の表示で誤入力に気づき、迷惑メール・期限・再送の案内で確認完了が増える |
| 指標 | `ki_signup_result{sent}` に対する `ki_login_verify_result{source=signup,result=ok}` の比率、pending 件数の推移 |
| 評価期間 | 2026-10-21 〜 2026-11-17（28 日）。件数が少ないため短期の増減で仕様を変えない |
| rollback | 本 PR の revert（データ・設定の変更なし） |
