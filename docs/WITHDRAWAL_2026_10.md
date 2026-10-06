# 退会（即時のみ）— 正本

確定: **2026-10-06 MK 確定仕様** / 対象: Stripe 月額プレミアム
本書は Stripe 月額会員の **退会・解約** についての正本である（`docs/spec.md` の下位正本）。
経緯（解約監査・旧「解約予約の取り消し」導線）は `docs/RETENTION_2026_10.md`。

🔴 本書に個人を特定できる情報（氏名・email・顧客 ID・サブスク ID）を書かない。

---

## 1. 確定仕様（MK）

| # | 仕様 |
|---|---|
| 1 | 「期間末解約」「予約停止」「次回更新から停止」を **新規には提供しない** |
| 2 | マイページの「アカウント管理」に **「退会する」** ボタンを置く |
| 3 | 退会は **即時退会のみ** |
| 4 | 退会確定時点で Stripe 月額契約を **即時終了**し、KI の有料権限も **即時に利用不可** にする |
| 5 | 契約上の利用期限・請求期間が残っていても、退会後は **残期間を利用できない** |
| 6 | 確認画面で「退会すると残り期間があっても即時利用できなくなる」ことを明確に示す（下記 §3.2 の文言） |
| 7 | 「退会する」を押しただけでは確定しない。**確認画面 → 退会確定** の 2 段階 |
| 8 | 予約停止の取消機能は作らない。再利用は KI の現行の申し込み（再契約）フローに従う |
| 9 | **Stripe Customer Portal からは解約できない**。Portal はカード変更・請求履歴だけに使う |
| 10 | Stripe 側から「解約できます」「契約管理はこちら」等の能動的な顧客メールを送らない。顧客向け Billing メールの設定は **変えない** |
| 11 | 退会完了通知は **新設しない**（今回は画面上の完了表示のみ）。新設する場合は webhook 起点・冪等で、Stripe のメールを ON にしない |
| 12 | **既存の予約停止契約は勝手に即時退会へ変えない**。予約は終了日までそのまま |

理由: 予約停止を早期に入れさせるのではなく、利用を続ける間は契約を維持し、本人が本当に退会すると決めた時点で即時に退会する設計にする。
退会操作は隠さず・複雑にせず、マイページから本人が明確に操作できるようにする。

🔴 料金・プラン構造は本件で変えない。日割りの返金・精算は行わない（利用規約 第4条「入金後の返品・返金には応じかねます」と同じ扱い）。

---

## 2. 状態遷移

```
マイページ「退会する」
  → 確認画面（§3.2）            … ここまでは何も送らない
  → 「退会を確定する」
  → stripe-subscription { action: "withdraw", confirm: true }
       1. 本人確認: セッション Cookie の email だけで Stripe 顧客を検索
                    ＋ サブスク metadata.ki_email がセッション email と一致
       2. Stripe: subscriptions.cancel（即時・prorate=false・idempotency key）
          🔴 ここが成功しなければ何も変えない（502）
       3. 退会記録（Netlify Blobs）を書く → 全端末の有料セッションを即時 free 扱い（§4）
       4. この端末の Cookie を free で出し直す（降格のみ）
  → webhook: customer.subscription.deleted
       → Airtable: PlanType=free / Status=inactive / AccessEnabled=false（従来どおり webhook が会員状態の正）
       → 退会記録を「反映済み」にする
       → KMA へ subscription-cancelled（従来どおり）
  → マイページ ?withdrawn=1 で完了表示
```

| 起きうる不整合 | 扱い |
|---|---|
| Stripe の終了に失敗 | 502。退会記録・Cookie・Airtable は何も変えない。利用者は再試行できる |
| Stripe は終了・退会記録の書き込みに失敗 | 成功を返す（この端末は free）。webhook が同じ記録を書くので補完される |
| Stripe は終了・webhook 未着（Airtable がまだ premium） | 退会記録（未反映）がログイン・refresh-session での有料発行を止める（fail-closed） |
| webhook で退会記録が書けない | 500 を返し processed にしない → Stripe の再送で書き直す（Airtable は先に free 済み） |
| 有効な契約が 2 件以上・持ち主不一致 | 409。**何も終了しない**（問い合わせ案内） |

---

## 3. マイページ

### 3.1 配置

- 「アカウント管理」節（お支払い節の下・ログアウトの上）。**Stripe の契約がある有料会員にだけ**表示する（status で確認できたとき）。
  銀行振込の年払い・契約なしには出さない。
- お支払い節の文言は「お支払い方法の変更・請求履歴の確認は、お支払い管理ページから行えます。」（「解約」を含めない）。

### 3.2 確認画面（MK 指定文言を含む）

> **退会すると、現在の利用期限を待たずにすぐ利用できなくなります。**
> **残り期間の利用を希望する場合は、退会手続きを行わずそのままご利用ください。**

続けて、残り期間があっても確定時点で使えなくなる機能（AI指数の数値 / AI結論 / 馬単の買い目）、
残り期間分の返金・日割り精算がないこと、退会後も無料会員として印まで見られること、再利用は改めて申し込むこと。
ボタンは「退会しない（戻る）」「退会を確定する」。

🔴 値引き・期限煽り・罪悪感・成績（回収率・的中率）による引き止めを入れない（テストで固定）。

### 3.3 既存の解約予約の表示

予約中の契約は「ご契約の終了日が決まっています / ◯月◯日にご契約が終了します。それまではこれまでどおりご利用いただけます」だけを出す。
🔴 取り消しボタンは無い。本人が「退会する」を確定した場合だけ即時終了する。

### 3.4 計測（GA4・PII なし）

`ki_withdraw_open` / `ki_withdraw_back` / `ki_withdraw_confirm` / `ki_withdraw_result{result}` / `ki_portal_open` / `ki_subscription_state{state}`。
`ki_resume_click` / `ki_resume_result` は廃止。

---

## 4. 全端末の有料権限を即時に止める（退会記録）

`ki_session` は発行時の tier を署名して最長 7 日固定する。Airtable を free にしても、別端末の Cookie は premium のまま残る。
そのため退会時刻を Netlify Blobs（store `ki-entitlement-revocations`、key = email の SHA-256。email は保存しない）に記録する。

| 記録 | 意味 |
|---|---|
| `revokedAtMs` | これ以前に発行された有料セッションは free として扱う |
| `confirmed` | webhook が Airtable を反映済みか。false の間はログイン・refresh-session でも有料を発行しない |
| `subscriptionId` | どの契約の終了か |

- 認可側（`checkedEntitlementFromAstro` / `applyRevocation`）: 予想ページ（有料・無料）・マイページ・料金ページ・ナビ・`get-session`・`gemini-race-analysis`。
  有料 tier のときだけ Blobs を読む（guest / free に I/O を足さない）。
- 発行側（`tierForNewSession`）: `verify-magic-link` / `refresh-session`。
- webhook: 契約終了（deleted / updated canceled）で `confirmed=true`。マイページ以外の終了（既存予約の期間末など）も全端末で止まる。
  新規契約（checkout 完了）で `confirmed=true`（再契約者を free に閉じ込めない）。
- 🔴 降格しかしない。この記録から有料が生まれることはない。
- 🟡 Blobs が **読めない** 場合は Cookie / Airtable の tier をそのまま使う（ログを残す）。退会した端末は退会応答で free に差し替わるので影響しない。

---

## 5. Customer Portal

- `stripe-portal.js` は **KI 管理の構成**（metadata `ki_portal=no-cancel-v1`）でだけセッションを作る（`src/lib/billing/portalConfig.js`）。
  - 有効: お支払い方法の変更 / 請求履歴 / 氏名・住所の変更
  - 無効: 解約 / プラン変更 / メールアドレス変更（KI は email で会員と Stripe 顧客を結ぶため）/ ログインページ
- 構成が無ければ作り、解約可能に変えられていれば開く前に戻す。安全な構成を用意できなければ **ポータルを開かない**（502）。
- 🟡 **アカウント既定の構成**（Stripe ダッシュボードの「カスタマーポータル」設定。ノーコードのログインリンクが使う）は KI のコードからは使わない。
  既定構成でも解約を無効にする（§8 の運用手順）。

---

## 6. 既存の予約停止契約（2026-10-06 時点）

- 2026-10-06 の監査（`RETENTION_2026_10.md` §1）では有効 8 件中 **5 件が解約予約中**（ポータルの期間末キャンセル、flexible 請求で `cancel_at=期間末`）。
- 🔴 これらは **変更しない**。終了日（期間末）に Stripe が終了し、webhook が free へ戻す（従来どおり）。
  期間末の終了でも退会記録が書かれ、全端末で止まる。
- 本件で予約を移行・取り消し・即時終了へ変換する処理は **無い**（`status` は書き込まない。テストで固定）。

---

## 7. 実装・テスト

| ファイル | 役割 |
|---|---|
| `netlify/functions/stripe-subscription.js` | `status` / `withdraw`（`resume` は廃止 → 400） |
| `src/lib/billing/subscriptionState.js` | 表示用の要約・退会対象の決定・即時終了のパラメータ |
| `src/lib/auth/revocation.js` | 退会記録 |
| `src/lib/auth/entitlement.js` | `applyRevocation` / `checkedEntitlementFromAstro` |
| `src/lib/billing/portalConfig.js` | 解約できないポータル構成 |
| `netlify/functions/stripe-webhook.js` | 契約終了・新規契約で退会記録を更新 |
| `src/pages/mypage.astro` | 退会導線・確認画面・既存予約の表示 |
| `src/pages/pricing.astro` / `terms.astro` / `tokushoho.astro` | 公開文言 |

テスト（`npm run test:stripe` / `test:refresh-session` / `test:auth`、`npm run build` に組み込み済み）:
本人の契約だけ / 他会員を操作できない / 二重クリック・同時送信 / 同一 event 再送 / 退会 → 有料即時停止 /
未来の期限が残っていても利用不可 / URL 直打ちで有料ページへ入れない / 期間末キャンセルを作らない /
予約停止・取り消し CTA が無い / ポータルで解約できない / 既存予約を勝手に変えない / 再契約で有料に戻る / 不整合の fail-closed。

---

## 8. 運用（本番）

| 項目 | 方法 |
|---|---|
| 本番反映後の外形確認 | `.github/workflows/post-deploy-billing-smoke.yml`（main への push で自動。`resume` が 400 になることで新版の反映を判定） |
| KI 管理のポータル構成 | 最初のポータル起動時に関数が作る（以後は再利用・自己修復） |
| アカウント既定のポータル構成 | 解約（`subscription_cancel`）を無効にする。カード変更・請求履歴は変えない |
| 顧客向け Billing メール | 変更しない（現状維持） |
| rollback | 本 PR を revert すれば旧導線（ポータル解約）に戻る。退会記録は降格専用なので残っても有料会員を誤って止めない（記録があるのは実際に契約が終わった人だけ） |
