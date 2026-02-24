# BlastMail登録フォーム設定手順書

## 📋 概要

無料会員登録時にBlastMailへ自動登録する際、`registration_source`（登録元）を追跡するための設定手順です。

---

## 🎯 目的

複数サイトからの登録を区別するため、BlastMailの隠しパラメータを使用して登録元（keiba-intelligence）を記録します。

---

## ⚙️ 設定手順

### 1. BlastMail管理画面にログイン

https://blastmail.jp/ にアクセスしてログイン

### 2. 項目設定画面を開く

1. 左メニューから「設定」→「項目設定」を選択
2. 登録フォームのカスタム項目設定画面を開く

### 3. 新規項目「registration_source」を追加

#### 項目の設定値：

| 設定項目 | 設定値 |
|---------|--------|
| **項目名** | `registration_source` |
| **表示名** | 登録元サイト |
| **項目タイプ** | テキスト（1行） |
| **必須項目** | いいえ（任意） |
| **隠しフィールド** | **はい（重要）** |
| **デフォルト値** | `keiba-intelligence` |

#### 重要ポイント：
- ✅ **隠しフィールドを「はい」に設定** - ユーザーには見えない
- ✅ **デフォルト値を設定** - 空の場合の初期値
- ✅ **項目名は英数字のみ** - API連携時に使用

### 4. 設定の保存

「保存」ボタンをクリックして設定を確定

### 5. API連携の確認

#### 登録API呼び出し時のパラメータ：

```javascript
const params = new URLSearchParams({
  username: BLASTMAIL_USERNAME,
  password: BLASTMAIL_PASSWORD,
  apikey: BLASTMAIL_API_KEY,
  email: email,
  registration_source: 'keiba-intelligence' // ← 隠しパラメータ
});
```

#### BlastMailに保存されるデータ例：

| メールアドレス | 登録元サイト | 登録日時 |
|---------------|------------|---------|
| user1@example.com | keiba-intelligence | 2026-02-24 10:30 |
| user2@example.com | keiba-intelligence | 2026-02-24 11:15 |

---

## 📊 活用方法

### 1. グループ分け（セグメント配信）

BlastMail管理画面で登録元ごとにフィルタリング：
- `registration_source = keiba-intelligence` → KEIBA Intelligence登録者のみ
- 特定サイト向けのキャンペーンメール配信が可能

### 2. 統計分析

登録元別の統計を確認：
- どのサイトからの登録が多いか
- サイト別の開封率・クリック率

### 3. 将来の拡張

他のサイトを追加する際も同じ仕組みで管理：
- `registration_source = site-a`
- `registration_source = site-b`

---

## ✅ 確認方法

### テスト登録で確認：

1. 無料登録ページ（/register）からテスト登録
2. BlastMail管理画面で読者一覧を確認
3. 「登録元サイト」列に `keiba-intelligence` が表示されているか確認

---

## 🔧 トラブルシューティング

### Q1. 「registration_source」フィールドが見つからない

**回答**: 
- BlastMail管理画面で項目設定を再確認
- 項目名のスペルミスがないか確認
- API権限が有効か確認

### Q2. 登録は成功するが値が空

**回答**:
- デフォルト値が設定されているか確認
- API呼び出し時にパラメータが含まれているか確認
- Netlify Functionsのログを確認（`netlify dev` で確認可能）

### Q3. BlastMail APIエラー

**回答**:
- `register-free.js`では**エラーを警告のみ**で処理（登録は継続）
- BlastMail失敗してもマジックリンクメールは送信される
- エラー内容はNetlify Functionsログで確認

---

## 📝 関連ファイル

- **Netlify Function**: `netlify/functions/register-free.js`
- **登録ページ**: `src/pages/register.astro`
- **環境変数**: Netlify管理画面で設定
  - `BLASTMAIL_USERNAME`
  - `BLASTMAIL_PASSWORD`
  - `BLASTMAIL_API_KEY`

---

## 📅 作成日: 2026-02-24
## 👤 作成者: Claude Code（クロちゃん）
