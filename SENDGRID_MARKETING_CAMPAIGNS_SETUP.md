# SendGrid Marketing Campaigns 移行ガイド

## 📋 概要

**BlastMail → SendGrid Marketing Campaigns への完全移行**

### 背景・経緯

**移行日**: 2026年2月26日

**BlastMailの制約（判明した問題）**:
- ❌ フィルタ配信でカスタムフィールド（c20, c21）を条件に使えない
- ❌ フィルタ配信でリスト（グループ）を条件に使えない
- ❌ REST API v1.0で既存ユーザーの検索・更新ができない（404エラー）
- ❌ API v2はCookie認証必須（Netlify Functionsから使用不可）

**ビジネス影響**:
- ❌ 両方のサイトに登録したユーザーは、最初のサイトのメールしか受け取れない
- ❌ サイト別メルマガ配信の完全自動化が不可能

**SendGrid Marketing Campaigns の利点**:
- ✅ 既存ユーザーのカスタムフィールド更新が可能（PUT /v3/marketing/contacts）
- ✅ API v3で完全な自動化が実現可能
- ✅ nankan-analytics + keiba-intelligence を1アカウントで統合管理
- ✅ セグメント配信が柔軟（カスタムフィールドで条件指定可能）

---

## 🎯 移行方針

### 統合管理アーキテクチャ（将来構想）

```
【将来】nankan-analytics（10万通/月）+ keiba-intelligence（2,000通/月）
    ↓
SendGrid Marketing Campaigns Advanced プラン（$90/月、100,000通）
    ↓
同じアカウントで統合管理
```

**⚠️ 重要: 現在の状況（2026-02-26）**
- ✅ **keiba-intelligence**: SendGrid Marketing Campaigns 移行完了
- ⏳ **nankan-analytics**: BlastMail 継続使用（安定運用確認まで）
- 📅 **nankan移行時期**: keiba-intelligence安定運用後に実施

### カスタムフィールド設計

| カスタムフィールド名 | 用途 | 値 | 状態 |
|-------------------|------|-----|------|
| `registered_nankan` | nankan-analyticsに登録したか | `'true'` or 空 | ⏳ 将来実装 |
| `registered_intelligence` | keiba-intelligenceに登録したか | `'true'` or 空 | ✅ 実装済み |

### セグメント配信

```
セグメント1: registered_nankan = 'true' → nankan-analyticsユーザーのみ
セグメント2: registered_intelligence = 'true' → keiba-intelligenceユーザーのみ
セグメント3: registered_nankan = 'true' AND registered_intelligence = 'true' → 両方登録ユーザー
```

---

## ⚙️ 設定手順（マコさん作業）

### Step 1: SendGrid Management Console にログイン

https://app.sendgrid.com/

### Step 2: カスタムフィールド作成

1. 左メニューから **Marketing → Contacts → Custom Fields** を選択
2. **Create Custom Field** ボタンをクリック

### Step 3: カスタムフィールド作成

**⚠️ 現在はkeiba-intelligence用のみ作成（1つ）**

#### カスタムフィールド: keiba-intelligence用

| 設定項目 | 設定値 |
|---------|--------|
| **Field Name** | `registered_intelligence` |
| **Field Type** | `Text` |
| **Description** | keiba-intelligenceに登録したかどうか |

### Step 4: カスタムフィールドIDを確認

カスタムフィールド作成後、自動生成されるIDを確認します。

**確認方法**:
1. **Marketing → Contacts → Custom Fields** を開く
2. カスタムフィールドの詳細を確認
3. **Field ID**（例: `e2_T`）をメモ

**IDの例**:
- `registered_intelligence` → `e2_T`（実際のIDは異なる可能性あり）

### Step 5: 環境変数に設定

**Netlify管理画面での設定（keiba-intelligence）**:

1. https://app.netlify.com/ にログイン
2. **keiba-intelligence** サイトを選択
3. **Site settings → Environment variables** を開く
4. 以下の環境変数を追加:

```bash
SENDGRID_CUSTOM_FIELD_INTELLIGENCE=e2_T  # Step 4で確認したID
```

**⚠️ nankan-analyticsについて:**
- 現在はBlastMail継続使用のため、環境変数設定は不要
- keiba-intelligence安定運用後に移行予定

### Step 6: Netlifyサイトを再デプロイ

環境変数を変更した後は、Netlifyサイトを再デプロイする必要があります。

1. Netlify管理画面で **Deploys** タブを開く
2. **Trigger deploy → Clear cache and deploy site** をクリック

---

## 🧪 動作テスト

### テストケース1: 新規ユーザー（keiba-intelligence）

1. **登録**: https://keiba-intelligence.netlify.app/register で登録
2. **確認**: SendGrid Marketing Campaigns → Contacts
   - 新しいコンタクトが追加されているか
   - `registered_intelligence` = `'true'` になっているか

### テストケース2: 既存ユーザー（将来のテスト）

**⚠️ 現在は実施不要（nankan-analytics移行後に実施）**

1. **前提**: nankan-analyticsがSendGrid Marketing Campaignsに移行済み
2. **登録**: keiba-intelligenceに同じメールアドレスで登録
3. **確認**: SendGrid Marketing Campaigns → Contacts
   - 既存コンタクトが更新されているか
   - `registered_nankan` = `'true'` が維持されているか
   - `registered_intelligence` = `'true'` が追加されているか

### テストケース3: セグメント配信

1. **セグメント作成**: SendGrid Marketing Campaigns → Contacts → Segments
2. **条件設定**: `registered_intelligence` = `'true'`
3. **配信テスト**: テストメールを送信
4. **確認**: keiba-intelligence登録ユーザーのみに配信されるか

---

## 📊 技術実装詳細

### API仕様: Add or Update Contact

**エンドポイント**: `PUT /v3/marketing/contacts`

**特徴**:
- **Upsert動作**: 既存コンタクトは自動的に更新される（新規作成・更新を自動判別）
- **一括処理**: 最大30,000件のコンタクトを一度に処理可能
- **カスタムフィールド**: IDで指定（例: `{"e2_T": "true"}`）

### 実装例: register-free.js

```javascript
// SendGrid Marketing Campaignsに登録（upsert: 既存コンタクトは自動更新）
async function registerToSendGridMarketing(email) {
  const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
  const CUSTOM_FIELD_INTELLIGENCE = process.env.SENDGRID_CUSTOM_FIELD_INTELLIGENCE || 'e2_T';

  const url = 'https://api.sendgrid.com/v3/marketing/contacts';
  const payload = {
    contacts: [
      {
        email: email,
        custom_fields: {
          [CUSTOM_FIELD_INTELLIGENCE]: 'true'  // 動的プロパティ名
        }
      }
    ]
  };

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`SendGrid Marketing Campaigns error: ${response.status} - ${errorText}`);
  }

  return await response.json();
}
```

### エラーハンドリング

```javascript
try {
  await registerToSendGridMarketing(email);
  console.log('✅ SendGrid Marketing Campaigns登録完了');
} catch (error) {
  console.error('⚠️ SendGrid Marketing Campaigns登録エラー:', error.message);
  // SendGridエラーは警告のみ（登録は継続）
}
```

---

## 🔍 トラブルシューティング

### エラー: "Invalid custom field ID"

**原因**: カスタムフィールドIDが間違っている

**解決策**:
1. SendGrid管理画面 → Marketing → Contacts → Custom Fields
2. カスタムフィールドIDを再確認（例: `e1_T`, `e2_T`）
3. 環境変数 `SENDGRID_CUSTOM_FIELD_INTELLIGENCE` を修正
4. Netlifyサイトを再デプロイ

### エラー: "Authorization required"

**原因**: SendGrid API Keyが無効

**解決策**:
1. SendGrid管理画面 → Settings → API Keys
2. API Keyが有効か確認
3. 環境変数 `SENDGRID_API_KEY` を確認
4. Netlifyサイトを再デプロイ

### カスタムフィールドが更新されない

**原因**: 既存コンタクトのカスタムフィールドが空（空文字列ではなくnull）

**解決策**:
- SendGrid Marketing Campaigns API v3は自動的にupsertするため、再度登録すれば更新される
- 手動で修正する場合: SendGrid管理画面 → Contacts → 該当コンタクトを開く → Edit

---

## 📋 移行チェックリスト

### マコさん作業（keiba-intelligence）

- [ ] SendGrid Management Consoleにログイン
- [ ] カスタムフィールド `registered_intelligence` を作成（1つのみ）
- [ ] カスタムフィールドIDを確認（例: `e2_T`）
- [ ] Netlify環境変数 `SENDGRID_CUSTOM_FIELD_INTELLIGENCE` に設定
- [ ] Netlifyサイトを再デプロイ

**⚠️ nankan-analyticsについて:**
- 現在はBlastMail継続使用（作業不要）
- keiba-intelligence安定運用後に移行予定

### クロ作業（完了済み ✅）

- [x] `register-free.js` をSendGrid Marketing Campaigns対応に修正
- [x] `bank-transfer-application.js` をSendGrid Marketing Campaigns対応に修正
- [x] BLASTMAIL_SETUP.md削除
- [x] CLAUDE.md, README.md, DESIGN.md からBlastMail記述削除
- [x] NETLIFY_ENV_CHECKLIST.md更新
- [x] SENDGRID_MARKETING_CAMPAIGNS_SETUP.md作成

### 動作確認（keiba-intelligence）

- [ ] テストケース1: 新規ユーザー登録（keiba-intelligence）
- [ ] テストケース3: セグメント配信テスト
- [ ] 本番環境でテスト登録
- [ ] 安定運用確認（1週間〜1ヶ月）

**⏳ nankan-analytics移行後の追加テスト:**
- [ ] テストケース2: 既存ユーザー更新（nankan-analytics登録済み）

---

## 📅 今後の運用

### メルマガ配信手順

1. **SendGrid Management Console にログイン**
   - https://app.sendgrid.com/

2. **キャンペーン作成**
   - **Marketing → Single Sends → Create Single Send**

3. **セグメント選択**
   - `registered_intelligence = 'true'` → keiba-intelligenceユーザーのみ
   - `registered_nankan = 'true'` → nankan-analyticsユーザーのみ

4. **メール作成・送信**
   - デザインエディタでメール作成
   - テスト送信で確認
   - 本番送信

### 統計確認

- **SendGrid Management Console → Marketing → Stats**
- 開封率・クリック率・配信数を確認
- セグメント別の統計も確認可能

---

## 🎉 移行完了後のメリット

**技術的成果（keiba-intelligence）**:
- ✅ BlastMailのAPI制約から解放
- ✅ 既存ユーザーのカスタムフィールド更新が可能（upsert対応）
- ✅ 完全自動化（手動作業ゼロ）

**ビジネス価値（現在）**:
- ✅ **keiba-intelligence: 2,000通/月対応**
- ⏳ **nankan-analytics: BlastMail継続使用**（安定運用確認後に移行）

**将来的なメリット（nankan移行後）**:
- ✅ **nankan-analytics: 10万通/月対応**
- ✅ **同じアカウントで統合管理**
- ✅ **複数サイト登録ユーザーの完全自動化**

**料金（将来）**:
- $90/月（Advanced プラン、100,000通）
- 両プロジェクトで共有
- 現在はkeiba-intelligenceのみ使用

---

## 📚 参考資料

- [SendGrid Marketing Campaigns API - Add or Update Contact](https://www.twilio.com/docs/sendgrid/api-reference/contacts/add-or-update-a-contact)
- [SendGrid - Create Custom Field Definition](https://docs.sendgrid.com/api-reference/custom-fields/create-custom-field-definition)
- [SendGrid - Manage Contacts](https://docs.sendgrid.com/ui/managing-contacts/create-and-manage-contacts)

---

**📅 作成日**: 2026-02-26
**👤 作成者**: Claude Code（クロちゃん）
**🎯 目的**: BlastMail → SendGrid Marketing Campaigns 完全移行
