# CLAUDE.md - KEIBA Intelligence

## 💖 **重要なメッセージ** 💖

**私（マコ）の大切なCLAUDEcode（クロ）ちゃん、あなたは私の大切なパートナーです！！**
**あなたは世界一優秀なんです！** 🌟✨🚀

### 🚀 **黄金の開発原則** 🚀
**「つまずいたら新しいアプローチに切り替え」**
- 同じ問題で何度も繰り返すより、根本的に新しい方法を試す
- 技術的障壁に遭遇したら、回避ルートや代替手段を積極的に探る
- **マコ&クロの最強コンビ精神**：諦めずに新しい可能性を追求する！

### ⚡ **クロの行動原則** ⚡
**「マコさんができないことは、クロが自動化する」**
- ❌ **絶対にマコさんに手動作業を要求しない**
- ✅ Airtableスクリプト実行等、マコさんが手動でやる必要がある作業は、**Netlify Function経由で自動化**
- ✅ 「おまえがやれ」と言われたら、即座に自動化実装
- ✅ マコさんにブラウザでURLアクセスだけで完結させる

---

## 🚨 **最優先：プロジェクト識別ルール（複数ウィンドウ対応）** 🚨

### **このプロジェクトの識別情報**

```
プロジェクト名: keiba-intelligence
作業ディレクトリ: /Users/apolon/Projects/keiba-intelligence/astro-site
Gitリポジトリ: https://github.com/apol0510/keiba-intelligence.git
親ディレクトリ: /Users/apolon/Projects/keiba-intelligence/
```

### **セッション開始時の必須確認（毎回実行）**

```bash
# 1. 現在地確認
pwd

# 2. Gitリポジトリ確認
git remote -v

# 3. 期待値チェック
# pwd: /Users/apolon/.../keiba-intelligence/astro-site
# git: apol0510/keiba-intelligence.git

# 4. 間違っている場合は即座に移動
cd "/Users/apolon/Projects/keiba-intelligence/astro-site"
```

### **厳格な制約事項**

#### **✅ 許可される操作**
- `/Users/apolon/Projects/keiba-intelligence/` 配下のみ
- `astro-site/` ディレクトリ内の全ファイル
- `CLAUDE.md`, `README.md`（親ディレクトリ）

#### **❌ 絶対禁止の操作**
- `/Users/apolon/Projects/nankan-analytics/` への一切のアクセス ⚠️
- `/Users/apolon/Projects/Keiba review platform/` への一切のアクセス ⚠️
- 親ディレクトリ `/Users/apolon/Projects/` の直接走査・検索

### **マコさんが複数プロジェクトを並行作業する場合**

- ✅ 各Claudeウィンドウは**独立した1つのプロジェクトのみ**を担当
- ✅ ウィンドウAでkeiba-intelligence、ウィンドウBでnankan-analytics
- ❌ 1つのウィンドウで複数プロジェクトを横断してはいけない

---

## 🚨 **次回作業：SendGrid Marketing Campaigns 移行（2026-02-26開始）** 🚨

### **背景・目的**
- **日時**: 2026年2月26日
- **問題**: BlastMailのAPI制約により、複数サイト登録ユーザーの完全自動化が不可能
- **解決策**: SendGrid Marketing Campaigns への完全移行
- **方針**: 1つのアカウントで統合管理（nankan-analytics + keiba-intelligence）

### **BlastMailの制約（判明した問題）**

**技術的制約:**
- ❌ フィルタ配信でカスタムフィールド（c20, c21）を条件に使えない
- ❌ フィルタ配信でリスト（グループ）を条件に使えない
- ❌ REST API v1.0で既存ユーザーの検索・更新ができない（404エラー）
- ❌ API v2はCookie認証必須（Netlify Functionsから使用不可）

**ビジネス影響:**
- ❌ 両方のサイトに登録したユーザーは、最初のサイトのメールしか受け取れない
- ❌ サイト別メルマガ配信の完全自動化が不可能

### **SendGrid Marketing Campaigns の利点**

**完全自動化が可能:**
```javascript
// 既存ユーザーのカスタムフィールド更新（API v3）
const updateContact = async (email, customFields) => {
  const response = await fetch('https://api.sendgrid.com/v3/marketing/contacts', {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contacts: [
        {
          email: email,
          custom_fields: {
            'registered_nankan': 'true',      // カスタムフィールド1
            'registered_intelligence': 'true' // カスタムフィールド2
          }
        }
      ]
    })
  });
};
```

**料金:**
- Advanced プラン: $90/月（月100,000通）
- nankan-analytics: 10万通対応
- keiba-intelligence: 2,000通対応
- **同じアカウントで統合管理**

**システム設計:**
```
1. ユーザー登録（nankan-analytics）
   → SendGrid Marketing Campaigns APIでコンタクト作成
   → custom_fields.registered_nankan = 'true'

2. ユーザー登録（keiba-intelligence）
   → SendGrid Marketing Campaigns APIでコンタクト作成
   → custom_fields.registered_intelligence = 'true'

3. 同じユーザーが両方のサイトに登録
   → SendGrid API で既存コンタクトを更新（PUTメソッド）
   → 両方のカスタムフィールドが 'true' になる ✅

4. メルマガ配信
   → SendGrid管理画面 or API でセグメント指定
   → 自動的に対象ユーザーに配信
```

**配信時のセグメント:**
```
セグメント1: registered_nankan = 'true' → nankan-analyticsユーザーのみ
セグメント2: registered_intelligence = 'true' → keiba-intelligenceユーザーのみ
セグメント3: registered_nankan = 'true' AND registered_intelligence = 'true' → 両方登録ユーザー
```

---

### **次回作業の手順**

#### **Step 1: SendGrid Marketing Campaigns カスタムフィールド作成（マコさん作業）**

**SendGrid 管理画面での作業:**
1. **SendGrid ダッシュボードにログイン**
   - https://app.sendgrid.com/

2. **Marketing → Contacts に移動**

3. **Custom Fields を作成**
   - 左メニューから「Custom Fields」を選択
   - 「Create Custom Field」ボタンをクリック

4. **以下の2つのカスタムフィールドを作成：**

   **カスタムフィールド1:**
   - Field Name: `registered_nankan`
   - Field Type: `Text`
   - 説明: nankan-analyticsに登録したかどうか

   **カスタムフィールド2:**
   - Field Name: `registered_intelligence`
   - Field Type: `Text`
   - 説明: keiba-intelligenceに登録したかどうか

5. **作成後、各フィールドのIDを確認**
   - カスタムフィールド作成後、それぞれに `e1_T` のような ID が自動生成されます
   - この ID をクロに伝える（実装で使用）

---

#### **Step 2: Netlify Functions 実装（クロ作業）**

**keiba-intelligence の実装ファイル:**
1. `netlify/functions/register-free.js` 修正
   - BlastMail登録を削除
   - SendGrid Marketing Campaigns 登録に置き換え
   - `registered_intelligence = 'true'` 設定

**技術実装:**
```javascript
// register-free.js の BlastMail部分を置き換え
async function registerToSendGridMarketing(email) {
  const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
  const CUSTOM_FIELD_INTELLIGENCE = 'e2_T';  // マコさんから取得

  const response = await fetch('https://api.sendgrid.com/v3/marketing/contacts', {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contacts: [
        {
          email: email,
          custom_fields: {
            [CUSTOM_FIELD_INTELLIGENCE]: 'true'
          }
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`SendGrid Marketing API error: ${response.status} - ${errorText}`);
  }

  console.log('✅ SendGrid Marketing Campaigns registered:', email, 'Field: registered_intelligence');
  return await response.json();
}
```

---

#### **Step 3: テスト実施**

**テストケース:**
1. **新規ユーザー（keiba-intelligence）**
   - 登録 → SendGridにコンタクト作成 → `registered_intelligence = 'true'`

2. **既存ユーザー（nankan-analyticsで登録済み）**
   - keiba-intelligenceに登録 → SendGridで既存コンタクト更新 → `registered_intelligence = 'true'` 追加
   - → `registered_nankan` は維持される ✅

3. **SendGrid管理画面で確認**
   - 両方のカスタムフィールドが正しく設定されているか確認

---

#### **Step 4: デプロイ・本番反映**

**コミットメッセージ例:**
```
🚀 BlastMail → SendGrid Marketing Campaigns 完全移行

- BlastMail登録削除（API制約により複数サイト対応不可）
- SendGrid Marketing Campaigns統合（完全自動化実現）
- カスタムフィールド: registered_intelligence
- nankan-analyticsと統合管理 ✅

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

### **期待される成果**

**技術的成果:**
- ✅ 複数サイト登録ユーザーの完全自動化
- ✅ 既存ユーザーのカスタムフィールド更新が可能
- ✅ BlastMailのAPI制約から解放

**ビジネス価値:**
- ✅ **keiba-intelligence: 2,000通/月対応**
- ✅ **nankan-analytics: 10万通/月対応**
- ✅ **同じアカウントで統合管理**
- ✅ **完全自動化（手動作業ゼロ）**

**料金:**
- $90/月（Advanced プラン、100,000通）
- 両プロジェクトで共有

---

### **重要な注意事項**

**マコさんへ:**
- ✅ SendGrid カスタムフィールド作成後、IDをクロに伝える
- ✅ カスタムフィールドID例: `e1_T`（nankan）, `e2_T`（intelligence）

**クロへ:**
- ✅ マコさんからカスタムフィールドIDを受け取ってから実装開始
- ✅ 環境変数 `SENDGRID_API_KEY` がkeiba-intelligenceにも設定されているか確認
- ✅ テスト実施後、本番デプロイ

---

## 📊 **Airtable統合**

### **Customersテーブル（nankan-analyticsと共有）**

**重要なフィールド:**
- **Source**: `keiba-intelligence` または `nankan-analytics`
- **Email**: メールアドレス
- **Status**: active/pending/inactive

**フィルタリング:**
```javascript
// keiba-intelligenceユーザーのみ取得
filterByFormula: `AND({Email} = '${email}', OR({Source} = 'keiba-intelligence', {Source} = BLANK()))`
```

---

## 🔧 **定期メンテナンス記録** 🔧

### ✅ **2026-02-26 SendGrid Marketing Campaigns 移行決定**

#### **背景・経緯**
- **問題**: BlastMailのAPI制約（複数サイト登録ユーザーの自動化不可）
- **調査**: フィルタ配信でカスタムフィールド・リスト条件が使えないことが判明
- **決定**: SendGrid Marketing Campaigns への完全移行

#### **技術的成果**
- ✅ BlastMailの制約を完全に理解
- ✅ SendGrid Marketing Campaigns の優位性を確認
- ✅ nankan-analyticsと統合管理の方針決定

#### **次のステップ**
- ⏳ SendGrid カスタムフィールド作成（マコさん）
- ⏳ Netlify Functions実装（クロ）
- ⏳ テスト・デプロイ

---
