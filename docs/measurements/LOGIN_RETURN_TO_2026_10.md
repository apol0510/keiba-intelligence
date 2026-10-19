# ログイン後に元のページへ戻す（2026-10）— 正本

作成: 2026-10-19 / 対象: `/login`・予想ページの帯（`TierRibbon`）・`send-magic-link`・`/auth/verify`・`verify-magic-link` / KAO registry `e52a3c07`

🔴 本書に個人を特定できる情報（氏名・email・顧客 ID・token）を書かない。数値は集計値だけ。
🔴 的中率・回収率・実績表示、価格・商品内容・会員権利・販売条件は扱わない（MK 2026-10-19 決定）。
関連: `LOGIN_RECOVERY_2026_10.md`・`LOGIN_GUIDANCE_2026_10.md`・`FUNNEL_2026_10.md`。

---

## 1. 問題

ログイン後の戻り先は購入導線（`intent`）を除いて常に `/mypage` だった。
セッション（7 日）が切れた有料会員が `/prediction/*` を開くと無料版が表示され、帯の「登録済みの方はログイン」からログインしても
**マイページへ飛ばされ、元の予想ページへ戻るにはもう一度探す必要があった**。有料会員の継続利用（MK 優先: ログイン・購入・再契約・継続）を損なう。

## 2. 変更

| 対象 | 変更 |
|---|---|
| `src/lib/auth/returnTo.js`（新規） | 戻り先の検査。**許可リスト**（`/mypage`・`/prediction/*`・`/free-prediction/*`・`/results`・`/results-jra`・`/results/*`）に一致する同一サイトの相対パスだけ。文字は英数字・`-`・`_`・`/` のみ、200 文字まで。`//`・`\`・`%`・`.`・空白・クエリ・スキームは拒否 → null（＝従来の `/mypage`） |
| 帯 `TierRibbon.astro` | 「登録済みの方はログイン」を `/login?next=<今のページ>`（許可リスト外なら従来の `/login`） |
| `/login` | `?next=` を最優先、無ければ直前のページ（同一オリジンの referrer・パスだけ）。どちらも同じ検査。有効なときだけ「ログイン後、元のページへ戻ります。」の 1 行 |
| `send-magic-link` | `intentQuery(intent) \|\| returnToQuery(next)` をマジックリンクへ付ける（購入意図が優先・email は載せない） |
| `/auth/verify` | `next` を検査して verify-magic-link へ渡す。成功時「元のページへ戻ります…」。リンク切れでログイン済みなら同じ戻り先、未ログインなら「新しいログインリンクを受け取る」へ戻り先を引き継ぐ |
| `verify-magic-link` | `resumePathFor(intent, normalizeReturnTo(next) \|\| '/mypage')`。**購入意図 > 戻り先 > /mypage** |
| GA4 | `ki_login_link_result` / `ki_login_verify_result` に `return_to: prediction \| free_prediction \| results \| mypage \| none`（分類名だけ。パス・PII は送らない） |

🔴 権限は変えていない: tier は従来どおり署名付き Cookie だけで決まり、戻り先は認可に使わない。
🔴 frozen ファイル（`BaseLayout.astro`・`RaceNewspaper.astro` 等）には触れていない。ヘッダー・フッター・新聞面の「ログイン」は `/login` の referrer 補助で同じ戻り先になる。

## 3. 検証

- `src/lib/auth/returnTo.test.mjs`（`test:auth`）: 許可パス・open redirect / エンコード / トラバーサル / 改行 / 長さ / 許可外パス・referrer の別オリジン・静的ガード。
- `src/lib/auth/returnTo.handlers.test.mjs`（`test:login-eligibility`・`--test` なしで直接実行）: send-magic-link と verify-magic-link の実ハンドラ（Airtable・SendGrid・Blobs は差し替え）で
  リンクの `next`・不正値の除外・購入意図の優先・戻り先・tier 不変・使用済み token は 403。
- `npm run build` green（trackRecordFreeze guard を含む）。

## 4. 実験として扱う

| 項目 | 内容 |
|---|---|
| 問題 | セッション切れの会員がログイン後に元の予想ページへ戻れない（§1） |
| baseline | 戻り先は未計測（2026-10-19 以前は全員 `/mypage`）。`ki_login_verify_result` は 2026-10-19 導入で前期比較の母数が無い。評価は `return_to` の分布と、ログイン後の予想ページ閲覧で行う |
| 仮説 | `ki_login_verify_result{result: ok}` のうち `return_to ∈ {prediction, free_prediction}` が一定割合を占め、ログイン直後のマイページ経由の再探索が減る。有料会員の予想ページ閲覧（ログイン後セッション）と継続が維持・改善する |
| 介入 | §2 |
| 期待 | `return_to=prediction` の verify 成功がゼロでない・ログイン後に予想ページへ着地する割合の増加。購入導線（`intent: purchase`）の件数・遷移は不変 |
| 評価期間 | **2026-10-20 〜 2026-11-16**（28 日） |
| 判定 | 不正な戻り先・open redirect の報告ゼロ、購入導線の不変を必須条件として維持。母数が少ない場合は短期ノイズで仕様を変えない |
| rollback | 本 PR の revert のみ（データ・schema・env の変更なし）。revert 後は従来どおり全員 `/mypage` |
