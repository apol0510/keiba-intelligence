# 無料会員登録テスト手順

## テスト手順

### 1. 新規メールアドレスで登録
- 別のメールアドレスを使用（例: test+001@example.com）
- または、Airtableで既存レコードを削除してから再登録

### 2. Netlify Function Logs確認
https://app.netlify.com/sites/keiba-intelligence/functions

以下のログを確認:
- `register-free`: 登録処理
- `verify-magic-link`: トークン検証処理

### 3. verify-magic-link.js のログで確認すべき項目

```
🔐 Verifying token: ...
✅ Token marked as used: ...
✅ Customer status updated to active: ...
✅ Session created: ... for: ...
```

エラーが出る場合:
```
❌ Token not found: ...
❌ Token already used: ...
❌ Token expired: ...
❌ Customer not found
```

### 4. Airtable確認

**AuthTokensテーブル**:
- Token: マジックリンクのトークンと一致
- Email: 登録したメールアドレス
- ExpiresAt: 現在時刻より未来
- Used: false (初回) → true (認証後)

**Customersテーブル**:
- Email: 登録したメールアドレス
- PlanType: free-registered (登録時) → free (認証後)
- Status: pending (登録時) → active (認証後)
- AccessEnabled: false (登録時) → true (認証後)

### 5. ブラウザコンソール確認

F12 → Console タブで以下を確認:
- ネットワークエラー
- CORS エラー
- verify-magic-link API レスポンス

### 6. トラブルシューティング

#### ケース1: Token not found
→ AuthTokensテーブルにトークンが保存されていない
→ register-free.js の AuthToken保存エラーを確認

#### ケース2: Token already used
→ 同じマジックリンクを2回クリックした
→ 新しく登録して新しいマジックリンクを取得

#### ケース3: Token expired
→ 15分以上経過
→ 新しく登録して新しいマジックリンクを取得

#### ケース4: Customer not found
→ Customersテーブルにメールアドレスが存在しない
→ register-free.js の Airtable登録エラーを確認

#### ケース5: Airtable field error
→ フィールド名の大文字小文字が不一致
→ Airtableテーブルのフィールド名を確認
