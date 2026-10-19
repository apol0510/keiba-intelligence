# マイページで契約終了を示す（2026-10）— 正本

作成: 2026-10-20 / 対象: `/mypage`（ログイン中・有料の閲覧権がない人）

🔴 本書に個人を特定できる情報（氏名・email・顧客 ID）を書かない。数値は集計値だけ。
🔴 的中率・回収率・実績表示、価格・商品内容・会員権利・販売条件・権限の判定（`paidEntitlement.js`）は扱わない（MK 2026-10-19 決定）。
🔴 値引き・期限煽り・新しい CTA・自動メールは作らない。導線は既存の「プランを見る」（/pricing）1 つ。

---

## 1. 問題（2026-10-20 顧客集計・件数のみ）

- 有料の閲覧権がある 8 件に対し、契約期間が過ぎた元会員が **7 件**（Status は active のまま・有効期限が過去）、契約終了（inactive）が **5 件**。
- マイページはこの人たちにも無料会員と同じ表示で、契約が終わったこと・いつ終わったかが分からなかった
  （「買い目が見えなくなった＝不具合」と受け取られる・再契約の判断材料がない）。

## 2. 変更

- `src/lib/billing/contractState.js`（純関数）: Customers の PlanType / Status / ExpirationDate（有効期限）/ CancelledAt から
  `{state: active|lapsed|ended|none, endedOn}`。active は `customerSessionTier` を呼んで決める（条件を複製しない）。
  - lapsed: 有料 PlanType・Status active / payment_failed のまま有効期限が過去 → 終了日 = 有効期限（JST）
  - ended: Status inactive または CancelledAt あり → 終了日 = CancelledAt、無ければ過去の有効期限、無ければ null
  - none: 無料登録・未確認・入金確認前（pending）・読めない期限
- `src/lib/billing/contractFields.js`: 署名付きセッションの email で Customers を 1 件読む（読み取りのみ・2.5 秒で打ち切り・失敗は null・契約列だけ返す）。
- `/mypage`: ログイン中・有料でない・退会直後でない人だけ読み、お支払い欄の既存文言の上に
  「ご契約期間はYYYY年M月D日に終了しました。」（日付不明なら「有料プランのご契約期間は終了しました。」）。権限・tier は不変。

## 3. 検証

- `src/lib/billing/contractState.test.mjs`（`test:billing`）: 状態・JST・文言、active と `customerSessionTier` の一致（490 組）、
  読み取り（本人 1 件・契約列のみ・式インジェクション・失敗 / タイムアウトで null）、mypage の配線（CTA 1 つのまま）。
- `trackRecordFreeze` guard green（mypage.astro の実績行は未変更）。`npm run build` green。

## 4. 実験として扱う

| 項目 | 内容 |
|---|---|
| 問題 | 元会員 12 件がマイページで契約終了を把握できない |
| baseline | 2026-10-20: lapsed 7・inactive 5・有料 8 |
| 仮説 | 終了日を示すことで、再契約を考える人が既存の「プランを見る」から料金ページへ進む |
| 指標 | `ki_pricing_link_click`（mypage 起点）・`ki_checkout_click` の推移、元会員の再契約件数（Stripe） |
| 評価期間 | 2026-10-21 〜 2026-11-17（件数が少ないため短期の増減で仕様を変えない） |
| rollback | 本 PR の revert（データ・設定の変更なし） |
