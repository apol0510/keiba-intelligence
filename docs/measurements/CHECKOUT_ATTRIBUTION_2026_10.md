# Checkout の申込元の分類 `ki_entry`（2026-10）— 正本

作成: 2026-10-20 / 対象: `stripe-create-checkout`（Stripe Checkout Session の metadata）

🔴 本書に個人を特定できる情報（氏名・email・顧客 ID）を書かない。数値は集計値だけ。
🔴 価格・商品内容・会員権利・権限の判定・実績表示は扱わない（MK 2026-10-19 決定）。新しい secret・定期 workflow は作らない。

---

## 1. 問題（2026-10-20）

- KI の 9 月売上 ¥31,840（月 100 万円目標）。GA4 は読めず、Checkout の metadata は `ki_plan` / `ki_email` / `ki_price_id` だけで、
  購入が「登録直後の新規・無料会員・期限切れの元会員・退会者」のどこから来たかを Stripe 側で集計できなかった。
- 顧客集計: 186 件・pending 34・有料の閲覧権あり 8・期限切れの元会員 7・inactive 5。

## 2. 変更

- `src/lib/billing/checkoutEntry.js`: 顧客レコード（PlanType / Status / ExpirationDate（有効期限）/ CancelledAt / CreatedAt）から固定の列挙値
  | 値 | 条件 |
  |---|---|
  | `new` | 無料会員（Status active）で CreatedAt から 24 時間以内 |
  | `free` | 無料会員（上記以外・CreatedAt 不明を含む） |
  | `pending` | Status=pending（銀行振込の入金確認前など） |
  | `lapsed` | 有料 PlanType・Status active / payment_failed のまま有効期限が過去 |
  | `withdrawn` | Status=inactive または CancelledAt あり |
  有料の閲覧権がある人（`customerSessionTier` が light 以上＝プラン変更）・未知の Status・読めないときは **付けない**。
- `stripe-create-checkout`: 署名付きセッションの email で Customers を 1 件読み（読み取りのみ・2 秒で打ち切り）、
  Checkout Session と subscription の metadata に `ki_entry` を足す。失敗しても Checkout は止めない。本文の申告は使わない。
- `start-purchase` は Checkout を作らない（未ログインの購入意図をマジックリンクへ持ち越すだけ）。
  認証後の自動再開は同じ `stripe-create-checkout` を通るので、購入導線の申込はすべて分類される。

## 3. 集計方法（新しい secret・workflow なし）

Stripe ダッシュボード（Checkout Sessions / Subscriptions の metadata）で `ki_entry` ごとの件数・金額を月次で数える
（`scripts/revenueMonthly.mjs` への集計追加は別 task。本 PR では行わない）。値は列挙値だけなので、集計結果に個人情報は含まれない。

## 4. 検証

- `src/lib/billing/checkoutEntry.test.mjs`（`test:billing`）: 列挙値 5 つ・全組合せ 1,764 組で列挙値か null・有料の閲覧権がある人は必ず null・読み取り。
- `src/lib/billing/stripeCheckout.test.mjs`（`test:stripe`・実ハンドラ・plain node）: 5 状態の値・session / subscription の両方・
  他の顧客値が metadata に入らない・本文の申告を使わない・失敗 / 有料 / 未知で付けず Checkout は 200。
- `npm run build` green。

## 5. rollback

本 PR の revert（データ・設定の変更なし。既存の metadata キーは不変）。
