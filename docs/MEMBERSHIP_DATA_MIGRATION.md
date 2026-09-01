# 会員継続制度の永続化 — 移行案と rollback（**未実行**）

> 本書は `docs/MEMBERSHIP_REWARDS.md` の下位文書。
> 作成日: 2026-09-01 / 基準コミット `b5a88d27`
>
> 🔴 **本書に書かれた操作は一つも実行していない。**
> Airtable の本番スキーマ変更・本番 write は `CLAUDE.md`「High-risk approval boundary」に該当し、
> 仕様所有者の承認が必要である。本書は **承認境界の手前で停止した状態の設計書**である。

---

## 0. 本番の実データ（2026-09-01 read-only 監査）

`npm run membership:check`（読み取りのみ）で実測した現状。**書き込みは行っていない。**

| 項目 | 実測値 |
|---|---|
| `Customers` レコード総数 | **63** |
| 有料会員（`PlanType` ∈ pro / pro-plus / premium / light） | **11**（pro 7 / light 4）|
| うち支払い方法 | **全件が銀行振込**（Stripe 由来は **0 件**）|
| `PlanType='premium'`（Stripe webhook が書く値）| **0 件** |
| 追加が必要な列 | **6 列すべて未作成** |
| `RewardLedger` テーブル | **未作成**（403。§2.2 の注記参照）|
| backfill 可能な有料会員 | **8 / 11**（`CreatedAt` あり）|
| 🔴 起点が不明な有料会員 | **3 / 11**（`CreatedAt` なし・**手動確認が必要**）|

補足:

- 本番 env に `STRIPE_SECRET_KEY` / `STRIPE_PRICE_PREMIUM` / `STRIPE_WEBHOOK_SECRET` は **未設定**。
  したがって Stripe 経由の会員はまだ存在せず、**契約価格（M-1）の実データも無い**。
- `Customers` には `plan_type` / `Plan` / `ExpirationDate` / `有効期限` など
  **旧運用の列が併存**している。本移行では **一切触らない**。

🔴 **`RewardLedger` の 403 について**: Airtable は「テーブルが無い」と
「トークンにそのテーブルへのアクセス権が無い」を **どちらも 403 で返しうる**。
テーブルを作っただけでは足りず、**PAT のアクセス範囲の確認**まで行うこと。
作成後に `npm run membership:check` が ✅ を出すことを確認する。

---

## 1. 既存の会員データ契約（変更前の実態）

`Customers` テーブルに対し、本リポジトリのコードが **実際に読み書きしている**列は次のとおり。
（`git grep` による実測。Airtable 管理画面にはこれ以外の列も存在しうる）

| 列 | 読み | 書き | 書いている場所 |
|---|---|---|---|
| `Email` | ✅ | ✅ | `register-free.js` / `bank-transfer-application.js` |
| `Name` | — | ✅ | `register-free.js` / `bank-transfer-application.js` |
| `Plan` | — | ✅ | `bank-transfer-application.js` |
| `PlanType` | ✅ | ✅ | `stripe-webhook.js` / `register-free.js` / `bank-transfer-application.js` |
| `Status` | ✅ | ✅ | 同上 |
| `AccessEnabled` | ✅ | ✅ | `stripe-webhook.js` / `bank-transfer-application.js` |
| `PaymentMethod` | — | ✅ | `bank-transfer-application.js` |
| `PaymentEmailSent` | ✅ | ✅ | `send-payment-confirmation-auto.js` |
| `Source` | ✅ | ✅ | `register-free.js` |
| `CreatedAt` | — | ✅ | `register-free.js` / `send-magic-link.js` |
| `VenueAccess` | ❌ **読まない** | ❌ **書かない** | 2026-08-30 に廃止（列は残存） |

🔴 **Airtable は未知フィールドへの書き込みでリクエスト全体が失敗する。**
そのため「先にコードを出して、あとで列を追加する」順序を取ってはいけない。
**列の追加が先、コードの有効化が後**である（§4）。

`PlanType` → tier の写像は `src/lib/auth/tiers.js` の `planTypeToTier` が単一源。
本移行は **この写像を変更しない**。

## 2. 追加が必要な列（案）

### 2.1 `Customers` への追加（会員 1 人につき 1 行のまま）

| 列名（案） | 型 | 用途 | 未設定時の扱い |
|---|---|---|---|
| `MembershipStartedAt` | Date (ISO) | 継続月数の起点（TBD-9 で定義が確定するまで**書かない**） | 継続月数を `pending` |
| `ContractPriceYen` | Number | M-1 契約時の請求額（円） | 契約価格を「準備中」 |
| `ContractPriceId` | Single line text | 契約時の Stripe Price ID（監査用） | 同上 |
| `ContractCurrency` | Single line text | 通貨（`jpy`） | 同上 |
| `ContractStartedAt` | Date (ISO) | 契約価格を記録した時刻 | 同上 |
| `MemberRank` | Single select | 表示用の写し（`bronze`/`silver`/`gold`/`platinum`） | ランクを `pending`。**Bronze へ倒さない** |
| `RewardBalance` | Number | リワード残高の写し（正本は台帳） | 残高を `pending` |
| `CancelledAt` | Date (ISO) | 解約日。**解約後 90 日の失効・価格ロック復活の起点**（§7.1） | 失効させない（誤って残高を消さない） |

🔴 `MemberRank` / `RewardBalance` は **表示・監査のための写し**であり、正本ではない。
正本は §2.2 の台帳。写しと台帳が食い違ったら **台帳が正**。

### 2.2 リワード台帳（新規テーブル `RewardLedger` 案）

**残高を単独の数値で持たない。** 加算・交換・調整・失効をすべて 1 行として積み、残高は合計で求める。
（二重付与・二重交換の検出と、あとからの監査を可能にするため）

| 列名（案） | 型 | 用途 |
|---|---|---|
| `EntryId` | Single line text（primary） | 冪等キー。同じ `EntryId` を二度書かない |
| `Email` | Single line text | 会員の識別（`Customers.Email` と一致） |
| `Type` | Single select | `accrual` / `redemption` / `adjustment` / `expiry` |
| `Points` | Number | 加算は正、交換・失効は負 |
| `OccurredAt` | Date (ISO) | 発生時刻 |
| `SourceRef` | Single line text | 由来（Stripe `invoice.id` / 交換 ID など） |
| `Note` | Long text | 監査用のメモ（**金額換算を書かない**） |

冪等キーの作り方（案・実装は `src/lib/membership/rewards.js` の `buildEntryId`）:

```
accrual    : accrual:<email>:<課金期間の識別子>
redemption : redemption:<email>:<交換ID>
```

### 2.3 交換・発送（新規テーブル `RewardRedemptions` 案）

| 列名（案） | 型 | 用途 |
|---|---|---|
| `RedemptionId` | Single line text（primary） | 冪等キー |
| `Email` | Single line text | 会員 |
| `ItemId` | Single line text | 景品カタログの item id |
| `CostPoints` | Number | 交換時に引いたポイント（台帳の `redemption` と一致） |
| `Status` | Single select | `requested` / `approved` / `shipped` / `cancelled` |
| `RequestedAt` / `ShippedAt` | Date | 履歴 |

🔴 **発送先住所を本テーブルへ持つかは未確定（TBD-12 / L-9）。**
個人情報の取得経路・保管期間が決まるまで、住所列を作らない。

## 2.4 TBD-9 / TBD-10 の確定候補（**未確定。仕様所有者が決める**）

本移行と同時に決める必要がある 2 件。実データ（§0）を踏まえた候補。

### TBD-9 継続月数の起点（`MembershipStartedAt` に何を書くか）

| 案 | 内容 | メリット | デメリット |
|---|---|---|---|
| A | Stripe の初回課金成功日（`checkout.session.completed`）| 課金の事実と一致。自動で書ける | **銀行振込に使えない**（現状の有料会員は全員こちら）|
| B | Airtable の `CreatedAt` | 既存 8/11 を自動 backfill できる | 申込日であって入金日ではない（会員に有利側にずれる）|
| C | 入金確認日（`Status` を active にした日）| 実態に最も近い | **記録が残っていない**。過去分を復元できない |
| **D（推奨）** | **新規は経路ごとに記録**（Stripe＝初回課金日 / 銀行振込＝入金確認して active にした日）、**既存は B で backfill**、`CreatedAt` が無い 3 件は**手動確認** | 新規は正確、既存も大半を救える | 3 件だけ手作業が要る |
| E | 移行日から全員 0 か月で開始 | 実装が最も簡単 | 🔴 **長く続けている会員を最低ランクで表示する**。制度の趣旨に反する |

🔴 **どの案でも「0 か月」で埋めないこと。** 起点が不明なら **空のまま**にする
（コードは `monthsKnown: false` → ランクを「準備中」と表示する）。

🔴 銀行振込は `bank-transfer-application.js` が `Status='pending'` / `AccessEnabled=false` で作り、
**有効化は手作業**である。案 D を採るなら、**有効化の手順に
`MembershipStartedAt` を入れる運用**が必要になる。

### TBD-10 支払い失敗（`invoice.payment_failed`）・停止中の扱い

| 案 | 継続月数 | ポイント | 整合性 |
|---|---|---|---|
| **A（推奨）** | **止めない** | **止めない** | 現行の「支払い失敗でアクセスを即時停止しない」（§6.2）と一致。猶予は Stripe の dunning に任せ、最終的に解約になれば `CancelledAt` が入って 90 日ルールに乗る |
| B | 止める | 止める | 実装が増える。復旧時に月数を戻す処理が要る |
| C | 止める | 失効させる | 一時的なカード期限切れで残高を失う。苦情の元 |

**推奨 A の理由**: 新しい分岐を増やさずに済み、既に確定している
「解約 → `CancelledAt` → 90 日」の一本道に合流する。

---

## 3. 実行しない理由（承認境界）

| 操作 | 区分 | 状態 |
|---|---|---|
| Airtable 本番の列追加（6 列） | production schema migration | **未実行**（承認必要） |
| 新規テーブル作成 | production schema migration | **未実行**（承認必要） |
| 既存会員レコードへの backfill | 本番 write | **未実行**（承認必要） |
| `MEMBERSHIP_WRITE_ENABLED` の有効化 | 本番 env 変更 | **未実行**（承認必要） |

🔴 **2026-09-01 更新**: TBD-1〜TBD-8 は **確定した**（`MEMBERSHIP_REWARDS.md` §7.1）。
制度の数値はコードの定数として実装済みで、**環境変数の設定も不要**である。
したがって残る前提条件は次の 2 つだけになった。

1. **列・テーブルの作成**（本書。承認必要）
2. **継続月数の起点（TBD-9）と支払い失敗時の扱い（TBD-10）の確定**
   — どちらも「`MembershipStartedAt` に何を書くか」「いつ月数を止めるか」という
   **保存の話**なので、本移行と同時に決めるのが自然である。

景品の品目（TBD-3b / TBD-4b）と発送先住所（TBD-12）は、**交換の実運用を始めるとき**に必要になる。
台帳の作成そのものはそれを待たずに進められる。

## 4. 移行手順（承認後に実施する順序）

**順序を入れ替えないこと。** 列が無い状態でコードを有効化すると、Airtable の update が
リクエストごと失敗し、**Stripe webhook のプラン付与まで巻き添えで落ちる**。

1. **列を追加する**（§2.1）。既存列は触らない。既存レコードは空のままでよい。
2. **新規テーブルを作る**（§2.2 / §2.3）。
3. **読み取りだけを有効化**して、既存会員の表示が壊れないことを本番で確認する
   （この時点では `pending` 表示のまま）。
4. **backfill**（任意）。`MembershipStartedAt` を過去の初回課金日で埋める。
   🔴 起点の定義（TBD-9）が確定していること。確定前に埋めない。
   backfill しない場合、既存会員の継続月数は「準備中」のままになる（`monthsKnown: false`）。
   🔴 **0 か月（＝ Bronze）として埋めない。** 長く続けている会員を最低ランクで表示することになる。
5. **`MEMBERSHIP_READ_ENABLED=true`** を設定して再デプロイし、本番のマイページで
   既存表示が壊れないことを確認する（この段階では**書き込みは拒否される**）。
6. **`MEMBERSHIP_WRITE_ENABLED=true`** を設定し、再デプロイする
   （Netlify の env はデプロイ時に注入されるため、設定だけでは反映されない）。
7. Stripe のテストイベントで 1 件だけ流し、台帳が 1 行だけ増えることを確認する。

## 5. rollback

| 段階 | rollback |
|---|---|
| 手順 1〜2（列・テーブル追加）後 | **何もしなくてよい。** コードは列を読まない（`MEMBERSHIP_WRITE_ENABLED` 未設定なら書かない）。列を残したままでも既存動作に影響しない |
| 手順 3（読み取り有効化）後 | 環境変数を戻して再デプロイ。表示が `pending` に戻るだけ |
| 手順 4（backfill）後 | backfill した列を空に戻す。**既存列（`PlanType` / `Status` / `AccessEnabled`）は触っていない**ので会員の権限には影響しない |
| 手順 5（読み取り有効化）後 | `MEMBERSHIP_READ_ENABLED` を削除して再デプロイ。表示が `pending` に戻るだけ |
| 手順 6（write 有効化）後 | `MEMBERSHIP_WRITE_ENABLED` を削除して再デプロイ。台帳に入った行は**消さずに残す**（監査のため）。残高の写し（`RewardBalance`）は台帳から再計算できる |

🔴 **どの段階の rollback でも、`PlanType` / `Status` / `AccessEnabled` を書き換えない。**
これらは有料会員の閲覧権限そのものであり、触ると**有料会員が買い目を見られなくなる**。

## 6. 本 PR の実装が満たしている前提

- `MEMBERSHIP_WRITE_ENABLED` が未設定のとき、**Airtable への書き込みは 1 件も発生しない**
  （`src/lib/membership/store.js` が `unavailable` を返す）。
- 🔴 **`stripe-webhook.js` のプラン付与は従来どおり `PlanType` / `Status` / `AccessEnabled`
  の 3 列だけを書く。** 会員継続制度の列（`ContractPrice*` / `CancelledAt`）は
  **`MEMBERSHIP_WRITE_ENABLED=true` のときだけ、別リクエストで**書く。
  - プラン付与の update に**混ぜていない**。混ぜると列が無い環境で
    Airtable が **リクエストごと 422** を返し、**プラン付与まで巻き添えで落ちる**。
  - membership 側の書き込みが失敗しても **握りつぶす**（プラン付与の成否に影響させない）。
  - この 2 点は静的ガードと `stripeWebhook.test.mjs` の
    「フラグを立てても列が無ければプラン付与は成功する」で固定してある。
- **Airtable アダプタは実装済み**（`src/lib/membership/airtableStore.js`）。
  未知フィールド（422）・テーブル無し（404/403）を検出したら
  **以後書きに行かない**（`schema_missing`）。読み取りも `null` を返し、
  **空配列を返して「0 件」と誤認させない**。
- **制度の数値は環境変数を必要としない**（`MEMBERSHIP_REWARDS.md` §7.1 の確定値がコードの定数）。
  本番 env に追加が必要なのは、write を有効化するときの `MEMBERSHIP_WRITE_ENABLED` だけである。
- Airtable アダプタは **実装していない**（列が無いため）。`store.js` は注入可能な抽象のみを持つ。
