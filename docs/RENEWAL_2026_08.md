# KI 大改修 2026-08 — 構想正本

> 本書は **2026-08-28 に着手した KEIBA Intelligence 大改修のスコープ・境界・完成条件の正本**である。
> 上位の正本関係は `docs/spec.md` 冒頭の表に従う。本書は `docs/spec.md` の下位にあり、
> 本改修が扱う範囲についてのみ正本となる。既存の領域別正本
> （`BET_POINT_LOGIC.md` / `docs/DATA_FORMAT.md` / `docs/RESULTS_SYSTEM_ARCHITECTURE.md` /
> `docs/INTELLIGENCE_DISPLAY_SPEC.md` / `docs/ui-cross-plan-regression-policy.md`）を**置き換えない**。
>
> 基準コミット: `cfe5fea2`（着手時点の `origin/main`）
> ブランチ: `feat/ki-renewal-2026-08`

---

## 1. 改修の目的（最重要項目）

**無料の段階で「これは価値がある」と実感させ、「これならお金を出してもいい」と思わせること。**

この 1 点を最上位の判断基準とする。個別の技術判断が競合した場合、
「無料訪問者が価値を実感できるか」を優先して決める。

派生する副目的:

1. 数値だけの機械的な見た目をやめ、**競馬新聞の情報密度**と**文章による解説**を両立させる。
2. 課金を**低価格帯の Stripe 月額**へ寄せ、銀行振込を控えめにする。
3. 無料会員・有料会員へ**ダイレクトレスポンスマーケティング（DRM）**でメルマガを自動配信する。
4. 暗いダッシュボード風のデザインを、**明るくポップ**な紙面らしいデザインへ変える。

---

## 2. ユーザー確定事項（2026-08-28）

本改修の前提として仕様所有者が確定した内容。**推測ではなく確定値である。**

| # | 論点 | 確定内容 |
|---|---|---|
| U-1 | 無料開放の深さ | **未登録: 印と買い目以外はすべて見せる** / **無料会員: 印を見せる** / **有料: 買い目を見せる** |
| U-2 | デザイン | **ライト基調 ＋ 競馬新聞の枠色でポップに** |
| U-3 | 価格 | **内容に伴うかどうかで再検討する**（＝改修完了後に決める。実装は価格を後から変更できる形にする） |
| U-4 | 既存有料会員 | **Stripe がメインになる。既存客は重要ではない**（＝既存経路の互換維持を最優先要件にしない） |

### U-1 の実装上の解釈（重要）

「印」は **◎○▲△ のマークだけを指すのではない**。KI では以下がすべて「印」と同じ情報を持つため、
**同一の tier で開閉する**。

- `role`（本命 / 対抗 / 単穴 / 連下最上位 / 連下 / 補欠）とそのマーク表示
- `pt`（AI 総合スコア）とその数値表示
- **馬の並び順**（PT 降順に並べると序列が読めてしまうため、未登録では**馬番順**に固定する）
- 「上位 5 頭」等の抽出表示

未登録に見せるもの（＝ 印・買い目以外すべて）:

- 出走全頭の馬柱（枠番・馬番・馬名・血統・騎手・厩舎・斤量・馬齢・馬体重）
- 過去走（着順・場・距離・タイム・上がり 3F・通過順・人気・馬体重）
- 特徴量 6 指標（Speed Index / Stamina / Form Trend / Track / Distance / Jockey）とその rank
- **AI 短評（1 頭ごとの文章）**
- **AI レース展望（レース単位の文章）**
- 展開予想（脚質・想定隊列・ペース）
- 的中実績・回収率アーカイブ（従来どおり全公開）

> **なぜ印を伏せて文章を全開放するのか**: 文章は「このサイトは分かっている」と伝える最も強い手段であり、
> 出し惜しみすると価値が伝わらない。一方で印と買い目は**結論**であり、
> 結論だけを段階的に開くことで登録・課金の動機を作る。U-1 はこの構造に一致している。

---

## 3. Tier 定義（正本）

本改修で扱う tier は次の 4 つ。**これ以外の tier を新設しない。**

| tier | 識別子 | 到達条件 | 見えるもの |
|---|---|---|---|
| 未登録 | `guest` | 誰でも | 馬柱・過去走・特徴量・**AI 短評**・**AI レース展望**・展開予想（馬番順）／印なし・買い目なし |
| 無料会員 | `free` | メール登録＋マジックリンク認証 | 上記 ＋ **印（役割マーク・PT・PT 順の並び）** ／買い目なし |
| 有料（ライト） | `light` | Stripe サブスク（下位） | 上記 ＋ **買い目**（対象会場・レース範囲は §6） |
| 有料（プレミアム） | `premium` | Stripe サブスク（上位） | 上記 ＋ **全会場・全レースの買い目** ＋ 穴馬レポート ＋ 優先メルマガ |

### 既存 PlanType との対応

Airtable `Customers.PlanType` の既存値は次のとおり写像する（U-4 により互換維持は必須要件ではないが、
写像を定義しておくことで既存レコードが誤って上位扱いされることを防ぐ）。

| 既存 PlanType | 新 tier |
|---|---|
| （未設定 / `free` / `free-registered`） | `free` |
| `light` | `light` |
| `pro` / `pro-plus` | `premium` |
| Stripe 由来 | webhook が `light` / `premium` を直接書く |

**fail-closed**:

- セッションが無い / 署名が不正 / 期限切れ / 署名鍵未設定 / 例外 → **`guest`**
- 認証は済んでいるが `PlanType` が未知の値 → **`free`**
  （メール所有は証明されているので `guest` へは落とさない。有料権限だけを与えない）
- 有料 tier で有効期限を過ぎている → **`free`**（日付が読めない値では権限を落とさない）

---

## 4. 予想の見せ方（新聞レイアウト）

### 4.1 構成（2026-08-29 更新: 基本 UI はシンプル版出馬表）

1 レース＝1 紙面。上から順に:

```
┌ レースヘッダー ─────────────────────────────┐
│ 11R 涼風特別 / 川崎 ダ1600m / 20:15 / 9頭          │
│ 【AIレース展望】 ← 文章 2〜4 文                     │
└──────────────────────────────────────┘
┌ 展開予想（ペースマップ） ───────────────────┐
│ 逃げ ▸ 先行 ▸ 差し ▸ 追込 の想定隊列を馬番で可視化   │
└──────────────────────────────────────┘
┌ 出馬表（シンプル版・一覧性最優先） ─────────┐
│ 枠 | 馬番 | 馬名 | 印 | 総合pt | コンピ | 性齢 | 斤量 | 騎手 | 厩舎 │
│  ↓ 行をクリック/タップすると **その馬の直下**に開く      │
│  ┌ 詳細アコーディオン ──────────────┐  │
│  │ AI短評 / AI指標6種 / 血統・プロフィール      │  │
│  │ 距離成績 / 持時計 / 騎手相性 / 馬場状態別     │  │
│  │ 近走5走（着順・場・距離・タイム・上3F・通過順・  │  │
│  │         人気・馬体重・騎手斤量・相手・着差）    │  │
│  └────────────────────────────┘  │
└──────────────────────────────────────┘
┌ 結論（買い目: light+ のみ） ────────────────┐
│ 【AI結論】← 文章 ／ 馬単買い目                       │
└──────────────────────────────────────┘
```

**実装**: `RaceEntryTable.astro`（一覧）＋ `HorseDetailPanel.astro`（詳細）。

#### 列の出し分け

- **1 頭も値が無い列は列ごと出さない**（空列を作らない）。
- **印・総合pt の列は `showMarks` が false なら列ごt出さない**（CSS で隠さない）。
- スマホでは厩舎 → 騎手 → 性齢 の順に落として一覧性を保つ（横スクロールさせない）。

#### 詳細に出すもの（**上流に存在する情報だけ**）

| ブロック | 南関 | JRA | 出どころ |
|---|---|---|---|
| AI短評 | ✅ | ✅ | `raceNarrative.js` |
| AI指標6種 / 総合pt | ✅ | ✅ | `featureScores` ＋ `pt`（pt は free 以上） |
| 血統（父・母・母父）・毛色・生年月日・馬主・生産者 | ✅ | 父のみ | `horseStats.profile` / `sire` |
| 距離成績 | ✅ | ✅ | `finishStatsByDistance`、無ければ過去走から算出 |
| 持時計 | ✅ | ❌ | `horseStats.bestTimes` |
| 騎手相性 | ✅ | ❌ | `horseStats.jockeyStats` / `jockeyCourseStats` |
| 馬場状態別 | ✅ | ❌ | `horseStats.trackConditionStats` |
| 近走5走 | ✅ | 一部 | `recentRacesDetailed` / 過去走（JRA は上がり3F・通過順が無い） |

**欠けている項目はブロックごと描画しない。**「—」や 0 で埋めない。

#### 枠番

枠番は **馬番と出走頭数から一意に決まる規則**で算出する（`src/utils/frameNumber.js`）。

- 8 頭以下 … 枠番 = 馬番
- 9 頭以上 … 8 枠へ均等に割り、余りは枠番の大きい側へ 1 頭ずつ足す

南関 `horseStats` の実データ **5,039 件と照合し不一致 0**。
データに明示の枠番があるときはそちらを優先する（本規則は fallback）。
これにより枠番を持たない JRA でも枠色を出せる。

### 4.2 競馬新聞から取り入れる要素

参照した紙面（日刊スポーツ極ウマ・馬柱タテ）から採用する要素:

| 要素 | KI での実装 |
|---|---|
| 枠番の 8 色 | カードの識別色（白・黒・赤・青・黄・緑・橙・桃）。CSS 変数 `--waku-1`〜`--waku-8` |
| 印の列 | `role` からマーク生成。**無料会員以上のみ表示** |
| 血統（父・母・母父） | `sire` ＋ `horseStats.profile`（`dam` / `damsire`）から表示 |
| 騎手・斤量・厩舎 | `jockey` / `weight` / `trainer` |
| 持ち時計 | `horseStats.bestTimes`（南関のみ。無い場合は非表示） |
| 距離成績 | 過去走から同距離帯（±200m）の成績を集計して表示 |
| 過去走の縦積み | 行を開いた詳細の中に近走 5 走を表形式で表示 |
| 人気指数・コンピ指数 | `computerIndex` は `computerIndexContract.js` の契約（10–99）を通した値のみ表示 |

**採用しないもの**: 他紙の予想印そのもの（牛山・デスク・本紙等の第三者の印）は取り込まない。
KI の印は `adjustPrediction.js` の独自ロジックで生成したものだけを使う（著作権対応・既存方針の維持）。

### 4.3 モバイル優先

**一覧性を最優先する。** PC / スマホで同じ出馬表を出し、横スクロールはさせない。
狭い画面では厩舎 → 騎手 → 性齢 の順に列を落とす。
情報量は行を開いたときの詳細アコーディオンで担保する。

紙面の横方向マトリクス（馬柱ヨコ）は**再現しない**（スマートフォンで読めないため）。

---

## 5. 文章化エンジン（本改修の中核）

### 5.1 二層構造

| 層 | 実装 | 生成タイミング | 対象 | 失敗時 |
|---|---|---|---|---|
| **層1: 決定論ナラティブ** | `src/utils/raceNarrative.js` | **描画時に同期計算**（純関数・依存ゼロ） | 全頭の AI 短評 / 展開予想 / レース基礎展望 | データ不足の項目を落とすだけ。文が空にならない |
| **層2: AI 要約** | Gemini（既存 `gemini-race-analysis.js` を流用） | **取込時にバッチ生成し JSON へ保存** | レース単位の展望・結論の肉付け | 層1 の文章をそのまま使う（フォールバック） |

**なぜこの構造か**:

- 閲覧のたびに LLM を呼ぶと、コスト・レイテンシ・再現性のすべてが悪化し、
  無料開放（＝アクセス数が増える）と両立しない。
- 決定論層があれば **どの馬にも必ず文章が付く**。LLM 障害時も紙面が壊れない。
- 層2 を取込時バッチにすることで、**閲覧時の外部 API 依存をゼロ**にできる。

### 5.2 層1 が算出する事実（すべて実データ由来・推測補完なし）

| 事実 | 算出元 | 例文 |
|---|---|---|
| 脚質 | `passingOrder` の 1 角位置 / 頭数 | 「逃げ」「先行」「差し」「追込」 |
| 上がり評価 | `last3f` を同レース内で相対比較 | 「上がり最速」「メンバー 3 位の脚」 |
| 距離適性 | 過去走の `distanceMeters` が今回 ±200m の成績 | 「同距離帯 3 戦 2 勝」 |
| コース適性 | 過去走 `venue` が今回と一致する成績 | 「川崎で〔2-1-0-1〕」 |
| near-miss | 着順 2〜3 着の連続 | 「2 戦続けて僅差の 2 着」 |
| 人気との乖離 | `popularity` と `rank` の差 | 「10 番人気で 3 着に食い込んだ」 |
| 馬体重 | 直近 2 走の `bodyWeight` 差 | 「前走から +12kg」 |
| ペース経験 | `paceType`（H/M/S）と着順 | 「ハイペースで粘った」 |
| 休養 | 過去走の日付間隔 | 「中 2 週」「3 か月ぶり」 |
| 特徴量の突出 | `featureScores.*.rank` が 1〜2 位 | 「スピード指数メンバー最上位」 |

**禁止**: 事実が取れない場合に一般論（「調子は良さそう」等）で埋めない。
取れた事実だけを並べ、1 つも取れなければ「データ不足」と明示する。

### 5.3 買い目の非開示（既存ルールの維持）

- 文章生成に `bettingLines` / `hitLines` を**渡さない**（`CLAUDE.md` の絶対厳守事項）。
- 層1・層2 のいずれも、馬番の組み合わせを出力しない。
- 「本命」等の役割語は tier 判定の後で差し込む（guest 向け文章には役割語を含めない）。

---

## 6. 課金（Stripe 月額）

### 6.1 設計原則

**価格は U-3 により未確定である。したがってコードに価格を書かない。**

- プラン定義は `src/lib/billing/plans.js` に集約し、**金額は Stripe 側の Price を正とする**。
- 環境変数で Price ID を注入する（`STRIPE_PRICE_LIGHT` / `STRIPE_PRICE_PREMIUM`）。
- 表示価格は Stripe API から取得した値を使い、取得失敗時は「準備中」と表示する（**推測価格を出さない**）。
- これにより、価格変更は **Stripe 管理画面の操作のみ**で完了し、コード変更・デプロイを要さない。

暫定案（未確定・参考値）: ライト ¥1,980/月・プレミアム ¥3,980/月。いずれも 5,000 円以下。

### 6.2 実装範囲

| 機能 | 実装 |
|---|---|
| チェックアウト開始 | `netlify/functions/stripe-create-checkout.js`（Checkout Session を作成） |
| Webhook | `netlify/functions/stripe-webhook.js`（署名検証 → Airtable の PlanType 更新） |
| 顧客ポータル | `netlify/functions/stripe-portal.js`（解約・カード変更） |
| 価格表示 | `netlify/functions/stripe-prices.js`（公開 Price を返す。金額のハードコード禁止） |

Webhook が扱うイベント:

- `checkout.session.completed` → PlanType を `light` / `premium` に設定、`Status=active`
- `customer.subscription.updated` → プラン変更・再開を反映
- `customer.subscription.deleted` → PlanType を `free`、`AccessEnabled=false`
- `invoice.payment_failed` → `Status=payment_failed`（アクセスは即時停止しない。猶予は Stripe 側設定に従う）

**冪等性**: `event.id` を Airtable（または Blobs）へ記録し、重複配信を無視する。

### 6.3 銀行振込の扱い

- 既存の `bank-transfer-application.js` と `/apply` は**残す**（削除しない）。
- `/pricing` の主導線は Stripe 月額とし、銀行振込は「年払い・買い切りをご希望の方」として
  ページ下部の控えめな導線に移す。

### 6.4 前提（必須）

Stripe 課金の開始には **サーバー側認可が前提**である（§7）。
未認証で買い目が読める状態のまま課金を始めると、有料価値が成立しない。

---

## 7. 認可の是正（Stripe の前提条件）

2026-08-17 の監査（`docs/progress.md`）で確定した A-1〜A-5 を是正する。

### 7.1 現状の問題

- 有料買い目を**サーバーで HTML に描画**し、クライアント JS が CSS で隠しているだけ。
  未認証の `curl` で全レースの買い目が読める（本番で再現確認済み）。
- entitlement の判定源が `sessionStorage` / `localStorage` のみ。ブラウザ側で任意の plan を自称できる。
- `verify-magic-link.js` が Cookie を発行しないため、**サーバーが検証できるセッションが存在しない**。
- 予想ページのサーバー側チェックが `isAuthenticated = true` でハードコード無効化されている。

### 7.2 是正の設計

```
[1] 署名付きセッション Cookie の新設
    verify-magic-link → HttpOnly / Secure / SameSite=Lax / HMAC-SHA256 署名
    ペイロード: { email, tier, venueAccess, exp }
    署名鍵: 新規 secret SESSION_SIGNING_SECRET（未設定なら全員 guest = fail-closed）

[2] サーバー側 tier 解決
    src/lib/auth/session.js    … Cookie の署名検証・復号（純関数・テスト可能）
    src/lib/auth/entitlement.js … tier → 何を描画してよいかの単一判定

[3] 描画そのものの出し分け
    印・PT・並び順   … tier >= free   でなければ **描画しない**
    買い目           … tier >= light  でなければ **描画しない**
    ＝ CSS で隠すのをやめ、HTML に含めない

[4] AccessControl.astro のクライアント自己申告を判定根拠から外す
    表示補助に降格。判定はサーバーが返した結果に従う

[5] 不変条件をテストで固定
    - 未認証レスポンスに買い目 markup が含まれない
    - 偽 plan を自称しても印・買い目が出ない
    - 署名鍵未設定・Cookie 破損・期限切れは guest に倒れる
```

**順序**: [1] → [2] → [4] → [3] → [5]。
[3] を [1] より先に入れると、サーバーが権限を判定できず全員が guest 表示に落ちる。

### 7.3 適用範囲

`docs/ui-cross-plan-regression-policy.md` に従い、**6 経路すべて**に適用する。

- `/prediction/nankan` / `/prediction/jra`
- `/free-prediction/nankan` / `/free-prediction/jra`
- `/free-prediction/nankan/[slug]` / `/free-prediction/jra/[date]`

### 7.4 本改修で扱わないもの

監査 A-6 / A-7（管理配信 API の認可）は**別タスク**とする。
本改修のスコープ（顧客向けの無料/有料境界と課金）に含まれず、
`CLAUDE.md`「Out-of-scope defects」に従い `docs/progress.md` に記録済みのまま残す。

---

## 8. メルマガ / DRM（KMA 連携）

### 8.1 調査結果

`keiba-marketing-automation`（KMA）は **マルチブランド・マルチチャネルの共通 MA 基盤の正本**であり、
`keiba-intelligence` ブランドが**既に登録済み**である。

確認できた事実:

- ブランド設定に `keiba-intelligence` が存在（From: `newsletter@em8410.keiba-intelligence.jp`、
  解除フィールド `UnsubscribedKeibaIntelligence`、シーケンス `keiba-intelligence:signup-onboarding`）
- 無料登録 → シーケンス投入の入口 `netlify/functions/signup-enroll.js` が実装済み
  （POST 限定・admin token 必須・`SIGNUP_ENROLL_ENABLED` / `SIGNUP_ENROLL_WRITE_ENABLED` の二重フラグ・
  `eventId` による冪等性）
- ただし **全自動化フラグは false**、KI 向けの `contentUrls` は `null`、`race` 設定も `null`
  （＝ KI のレース配信・本文組み立ては現時点では不可能）

### 8.2 方針

**メルマガの自動配信は KMA で行う。KI 側に配信エンジンを新設しない。**

理由: KMA は二重送信防止・頻度制御・解除・ブランド誤送信防止をすでに設計として持っており、
KI 側に同等品を作ると仕様が二重化して必ず乖離する。

### 8.3 本改修で KI 側が実装する範囲

| # | 実装 | 状態 |
|---|---|---|
| K-1 | `src/lib/kma/client.js` — KMA `signup-enroll` を呼ぶクライアント。**既定 disabled**（`KMA_ENROLL_ENABLED` 未設定なら何もしない） | 本改修で実装 |
| K-2 | `register-free.js` / `stripe-webhook.js` から K-1 を呼ぶ（無料登録・課金開始・解約の 3 イベント） | 本改修で実装 |
| K-3 | 日次ダイジェスト素材の生成（注目馬・穴馬・メインレース詳細を JSON 化） | 本改修で実装 |
| K-4 | 解除 endpoint の URL 確定（KMA の `contentUrls.unsubscribeUrlBase` が必要とする値） | 本改修で確定・記録 |

### 8.4 KMA 側に必要な変更（**本改修では実施しない・依存として記録**）

`CLAUDE.md`「Repository isolation」に従い、KMA リポジトリは本改修で変更しない。
以下は依存事項として記録し、別途 KMA 側のタスクとして扱う。

- `brands/index.js` の KI `contentUrls` を確定値で埋める（`loginUrl` / `unsubscribeUrlBase`。§8.3 K-4 の値）
- KI の `plans` を本書 §3 の tier（`free` / `light` / `premium`）へ更新する
  （現状は analytics-keiba 由来の `premium-combo` / `premium-tan` を含む）
- `keiba-intelligence:signup-onboarding` の本文コンテンツ作成
- `race` 設定（レース配信）の定義
- 各自動化フラグの有効化（**高リスク境界。承認必須**）

### 8.5 DRM シーケンス設計（KI が KMA へ渡す想定・コンテンツは KMA 側で作成）

| 対象 | タイミング | 内容 |
|---|---|---|
| 無料会員 | 登録直後 | 印の見方・当日の注目レース |
| 無料会員 | D+1〜D+5 | 的中実績の根拠 → 買い目の考え方 → 有料の価値 → オファー |
| 無料会員 | 開催日 | **注目馬 1 頭・穴馬 1 頭・メインレース展望**（＝ 報酬コンテンツ） |
| 有料会員 | 開催日 | メインレース詳細＋買い目の狙い |
| 有料会員 | 月次 | 回収率レポート |

**買い目の馬番組み合わせをメール本文に載せるかは KMA 側のコンテンツ判断**であり、本書では決めない。
ただし `CLAUDE.md` の「AI 振り返りに買い目を含めない」ルールは KI 側の生成物すべてに適用される。

---

## 9. デザイン（U-2: ライト基調 ＋ 新聞の枠色）

### 9.1 転換方針

| | 現行 | 改修後 |
|---|---|---|
| 背景 | `#0f172a`（ダークネイビー） | `#f7f8fb`（オフホワイト）／カードは白 |
| 文字 | `#e2e8f0` | `#1a202c` |
| 主色 | `#1e40af`→`#3b82f6` グラデ | `#2563eb`（ビビッドブルー） |
| 差し色 | パープル | `#f97316`（オレンジ）／`#facc15`（イエロー） |
| 識別色 | なし | **枠番 8 色**（新聞の枠色） |
| 見出し | ゴシック | 見出しに明朝を混ぜ、紙面感を出す |

### 9.2 実装方法

- `src/styles/global.scss` の `:root` トークンを**ライト値に置換**する。
  トークン名は変えない（各ページの scoped style がトークン参照で追随するため）。
- トークンを参照せずハードコードされている色は、影響範囲の大きい順に置換する。
- 枠色は新規トークン `--waku-1`〜`--waku-8` として追加する。

### 9.3 退行防止

`docs/ui-cross-plan-regression-policy.md` に従い、6 経路すべてで確認する。

---

## 10. 完成条件

- [x] `src/utils/raceNarrative.js` が全頭に文章を生成し、テストが通る（26件）
- [x] 新聞レイアウトコンポーネントが **7 経路**で描画される（`/prediction/[slug]` を追加）
- [x] 未登録レスポンスに **印・PT・買い目の markup が含まれない**ことを実測＋静的テストで固定
- [x] 無料会員で印が出て、買い目が出ないことを実測＋静的テストで固定
- [x] Stripe の checkout / webhook / portal / prices が実装され、価格がコードにハードコードされていない
- [x] KMA 連携が既定 disabled で実装され、有効化しなくても既存挙動が壊れない
- [x] ライト基調のデザインが 7 経路 ＋ トップ・料金・マイページ・アーカイブ・ログインに適用されている
- [x] `npm run build`（validate:archive / narrative / auth / billing / digest / nankan /
      prune-function-data / archive-sync / shared-checkers / workflow-transient ＋ astro build）が通る
- [x] Draft PR 作成（[PR #80](https://github.com/apol0510/keiba-intelligence/pull/80)。**merge・本番デプロイ・Stripe 本番キー設定・メール実送信は未実施**）

### 実施した検証の要約

| 検証 | 結果 |
|---|---|
| tier 別の実描画（dev server・7経路） | guest: 買い目0/印0、free: 印あり買い目0、light+: 買い目あり |
| guest レスポンス中の買い目パターン | **0 件**（`\d+-\d+(\.\d+)+`） |
| `npm run build` | 通過 |
| `node scripts/umatanHit.test.mjs` | 5/5 通過（南関 215.1% / JRA 212.1%。archive 依存の時点値） |
| `node --test scripts/utils/workflowStaticAudit.test.mjs` | 84/91（**失敗 7 件は本改修前から既存**。Open Questions Q10） |

---

## 11. 本改修で実施しないこと（高リスク境界）

`CLAUDE.md`「High-risk approval boundary」に該当するため、承認なしに実施しない。

- 本番デプロイ / 本番環境変数・secret の設定（`SESSION_SIGNING_SECRET` / `STRIPE_*` / `KMA_*` を含む）
- Stripe 本番アカウントの Product / Price 作成、live キーでの通信
- メール・メルマガの実送信、KMA の自動化フラグ有効化
- Airtable 本番スキーマの変更（新フィールドが必要な場合は**記録のみ**）
- KMA リポジトリの変更
- PR merge / main への直接 push

---

## 12. 契約（破ってはいけないもの）

本改修は次を**変更しない**。

1. `keiba-data-shared` の JSON 構造・命名・キー名
2. `archiveResults` の `races` / `isHit` / `hitLines` フォーマット
3. `checkUmatanHit` の判定ロジックと単一源であること
4. 馬単 F3・投資 5 点固定（`BET_POINT_LOGIC.md`）
5. `netlify.toml` の 301 リダイレクト群
6. `computerIndexContract.js` の 10–99 契約
7. AI 生成物に買い目（馬番組み合わせ）を含めないこと
8. `KEIBA_DATA_SHARED_TOKEN` による認証取得（匿名 fallback 禁止）
9. analytics-keiba との UI・ロジックの相互移植禁止
