# 会員継続制度の永続化 — 移行案と rollback（**未実行**）

> 本書は `docs/MEMBERSHIP_REWARDS.md` の下位文書。
> 作成日: 2026-09-01 / 基準コミット `b5a88d27`
>
> 🔴 **本書に書かれた操作は一つも実行していない。**
> Airtable の本番スキーマ変更・本番 write は `CLAUDE.md`「High-risk approval boundary」に該当し、
> 仕様所有者の承認が必要である。本書は **承認境界の手前で停止した状態の設計書**である。

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

## 3. 実行しない理由（承認境界）

| 操作 | 区分 | 状態 |
|---|---|---|
| Airtable 本番の列追加 | production schema migration | **未実行**（承認必要） |
| 新規テーブル作成 | production schema migration | **未実行**（承認必要） |
| 既存会員レコードへの backfill | 本番 write | **未実行**（承認必要） |
| `MEMBERSHIP_WRITE_ENABLED` の有効化 | 本番 env 変更 | **未実行**（承認必要） |

加えて、**TBD-1〜TBD-8（`MEMBERSHIP_REWARDS.md` §7）が未確定のまま列を作っても、
入れる値が決まらない**。スキーマ移行は数値確定のあとに行うのが正しい順序である。

## 4. 移行手順（承認後に実施する順序）

**順序を入れ替えないこと。** 列が無い状態でコードを有効化すると、Airtable の update が
リクエストごと失敗し、**Stripe webhook のプラン付与まで巻き添えで落ちる**。

1. **列を追加する**（§2.1）。既存列は触らない。既存レコードは空のままでよい。
2. **新規テーブルを作る**（§2.2 / §2.3）。
3. **読み取りだけを有効化**して、既存会員の表示が壊れないことを本番で確認する
   （この時点では `pending` 表示のまま）。
4. **backfill**（任意）。`MembershipStartedAt` を過去の初回課金日で埋める。
   🔴 起点の定義（TBD-9）が確定していること。確定前に埋めない。
5. **`MEMBERSHIP_WRITE_ENABLED=true`** を設定し、再デプロイする
   （Netlify の env はデプロイ時に注入されるため、設定だけでは反映されない）。
6. Stripe のテストイベントで 1 件だけ流し、台帳が 1 行だけ増えることを確認する。

## 5. rollback

| 段階 | rollback |
|---|---|
| 手順 1〜2（列・テーブル追加）後 | **何もしなくてよい。** コードは列を読まない（`MEMBERSHIP_WRITE_ENABLED` 未設定なら書かない）。列を残したままでも既存動作に影響しない |
| 手順 3（読み取り有効化）後 | 環境変数を戻して再デプロイ。表示が `pending` に戻るだけ |
| 手順 4（backfill）後 | backfill した列を空に戻す。**既存列（`PlanType` / `Status` / `AccessEnabled`）は触っていない**ので会員の権限には影響しない |
| 手順 5（write 有効化）後 | `MEMBERSHIP_WRITE_ENABLED` を削除して再デプロイ。台帳に入った行は**消さずに残す**（監査のため）。残高の写し（`RewardBalance`）は台帳から再計算できる |

🔴 **どの段階の rollback でも、`PlanType` / `Status` / `AccessEnabled` を書き換えない。**
これらは有料会員の閲覧権限そのものであり、触ると**有料会員が買い目を見られなくなる**。

## 6. 本 PR の実装が満たしている前提

- `MEMBERSHIP_WRITE_ENABLED` が未設定のとき、**Airtable への書き込みは 1 件も発生しない**
  （`src/lib/membership/store.js` が `unavailable` を返す）。
- 🔴 **`stripe-webhook.js` は本 PR で一切変更していない。**
  書くフィールドは従来どおり `PlanType` / `Status` / `AccessEnabled` の 3 つだけである。
  契約価格の記録（M-1）を webhook へ配線するのは **手順 1〜2（列の追加）が済んだあと**、
  すなわち §4 手順 5 と同時に行う。列が無い状態で配線すると、Airtable の update が
  リクエストごと失敗し、**プラン付与まで巻き添えで落ちる**ため。
  配線に使う純関数は実装済みで、テストも通っている
  （`priceLock.contractPriceFromCheckoutSession` / `contractPriceFromSubscription`）。
  この不変条件（webhook が書く列が 3 つのままであること）は
  `src/lib/membership/membershipCopy.guard.test.mjs` が静的に固定している。
- Airtable アダプタは **実装していない**（列が無いため）。`store.js` は注入可能な抽象のみを持つ。
