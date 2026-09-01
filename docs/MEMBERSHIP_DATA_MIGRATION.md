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

## 2.4 TBD-9 / TBD-10（**2026-09-01 確定**）

正本は `docs/MEMBERSHIP_REWARDS.md` §7.6 / §7.7。本節では**移行作業への影響**だけを書く。

| # | 確定した内容 |
|---|---|
| **TBD-9** | 継続月数の起点は **支払い成功日**（Stripe＝初回支払い成功／銀行振込＝入金確認日）。既存データは**根拠のあるものだけ** backfill し、**起点不明の 3 件は推測も 0 か月補完もしない** |
| **TBD-10** | 支払い失敗時も **認可の猶予挙動は現行のまま**。**継続月数と 100pt 付与だけを支払い成功まで保留**し、再決済成功時に該当期間ぶんを **1 回だけ**反映。未払いのまま終了した期間には付与しない |

### 移行作業への影響

1. **`MembershipStartedAt` に書く値は「支払い成功日」**である。
   - 🔴 `CreatedAt`（申込日）は**支払い成功日ではない**。
     銀行振込は `Status='pending'` / `AccessEnabled=false` で作られ、**入金確認は手作業**なので、
     申込日と入金日にずれがある。
   - 🔴 **`CreatedAt` を自動では書かない。**

### 🟢 入金確認日を復元できる（推測ではない）

`netlify/functions/send-payment-confirmation-auto.js` の `calculateExpirationDate(planType)` は
**入金確認の時点で** `ExpirationDate = その日 + 期間` を書き込んでいる。
したがって **`ExpirationDate − 期間 = 入金確認日`** が復元できる。

| plan_type | 期間 |
|---|---|
| `yearly` | 12 か月 |
| `light` / `monthly-nankan` / `monthly-jra` | 1 か月 |
| `lifetime` | 🔴 `2099-12-31` 固定のため逆算不可 |
| それ以外 / 未設定 | 🔴 期間を確定できないため逆算不可（既定へ丸めない）|

🔴 **逆算値を採用してよいのは次をすべて満たすときだけ**（`membershipMigration.mjs` が判定する）:

1. `ExpirationDate`（または `有効期限`）がある
2. `plan_type` から期間が確定できる
3. 逆算値が **未来でない**（未来 ＝ 手動延長などで書き換わっている）
4. 申込日（`CreatedAt`）があり、その **0〜60 日後**に収まる
   （大きく離れていれば更新後の日付であり、**初回**入金日ではない）

**実測結果（2026-09-01・read-only）**:

| 区分 | 件数 | 内容 |
|---|---|---|
| ✅ 逆算で根拠が取れた | **7** | 申込 +1〜+24 日に収まり、初回入金として整合 |
| 🔴 手動確認が必要 | **1** | `ExpirationDate` が無い |
| 🔴 起点不明（空のまま） | **3** | 逆算値が未来 1 件 / 申込日が無く突合できない 2 件 |

→ 手作業は **8 件 → 4 件**に減った。残り 4 件は **推測せず空のままにする**（画面は「準備中」）。
2. **今後の新規は自動で記録される**（`MEMBERSHIP_WRITE_ENABLED` 有効時）。
   - Stripe: `invoice.payment_succeeded` を受けて台帳へ 1 期ぶん積む（冪等キー＝invoice id）。
   - 銀行振込: **入金確認して `Status` を active にする手順に、`MembershipStartedAt` の記入を含める**。
3. **継続月数は台帳（支払い済み期間の累計）から数える**のが正。
   台帳が空で `MembershipStartedAt` だけがある既存会員は、**起点からの経過月数**で数える（後方互換）。
   どちらも無ければ **`pending`**。

### 参考: 検討した代替案（採用しなかったもの）

#### TBD-9 継続月数の起点（`MembershipStartedAt` に何を書くか）

| 案 | 内容 | メリット | デメリット |
|---|---|---|---|
| A | Stripe の初回課金成功日（`checkout.session.completed`）| 課金の事実と一致。自動で書ける | **銀行振込に使えない**（現状の有料会員は全員こちら）|
| B | Airtable の `CreatedAt` | 既存 8/11 を自動 backfill できる | 申込日であって入金日ではない（会員に有利側にずれる）|
| C | 入金確認日（`Status` を active にした日）| 実態に最も近い | **記録が残っていない**。過去分を復元できない |
| **D（採用）** | **新規は経路ごとに記録**（Stripe＝初回支払い成功 / 銀行振込＝入金確認日）、**既存は根拠のある分だけ** backfill、`CreatedAt` しか無い分は**入金日を確認**、不明な 3 件は**空のまま** | 新規は正確、既存も大半を救える | 手作業が残る |
| E | 移行日から全員 0 か月で開始 | 実装が最も簡単 | 🔴 **長く続けている会員を最低ランクで表示する**。制度の趣旨に反する |

🔴 **どの案でも「0 か月」で埋めないこと。** 起点が不明なら **空のまま**にする
（コードは `monthsKnown: false` → ランクを「準備中」と表示する）。

🔴 銀行振込は `bank-transfer-application.js` が `Status='pending'` / `AccessEnabled=false` で作り、
**有効化は手作業**である。案 D を採るなら、**有効化の手順に
`MembershipStartedAt` を入れる運用**が必要になる。

### TBD-10 支払い失敗（`invoice.payment_failed`）・停止中の扱い

| 案 | 継続月数 | ポイント | 整合性 |
|---|---|---|---|
| A | 止めない | 止めない | 認可と揃うが、**払っていない期間にポイントが付く** |
| **A'（採用）** | **保留**（支払い成功で反映） | **保留**（同左） | 🔴 **認可の猶予挙動は現行のまま**変えず、**付与だけ**を保留する。付与を `invoice.payment_succeeded` で駆動するので、未払い期間には構造的に付かない |
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
| 手順 3（動作確認）後 | 変更なし（読み取りはまだ有効化していない） |
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
  本番 env に追加が必要なのは段階的有効化のフラグ 2 つだけである
  （`MEMBERSHIP_READ_ENABLED` → `MEMBERSHIP_WRITE_ENABLED`）。
