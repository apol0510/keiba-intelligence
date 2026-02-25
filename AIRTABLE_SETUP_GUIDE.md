# Airtable Setup Guide - AuthTokens Table

## 必要なテーブル: AuthTokens

マジックリンク認証システムで使用するトークン管理テーブルです。

### テーブル作成手順

1. **Airtable管理画面にログイン**
   - https://airtable.com/
   - keiba-intelligence Base を開く

2. **新しいテーブルを作成**
   - 左上の「+」ボタンをクリック
   - テーブル名: `AuthTokens`

3. **フィールドを作成**

| フィールド名 | タイプ | 説明 | 設定 |
|------------|--------|------|------|
| `Token` | Single line text | 認証トークン（UUID） | Primary field |
| `Email` | Email | ユーザーのメールアドレス | - |
| `CreatedAt` | Date | トークン作成日時 | Include time: Yes, Time zone: GMT+9 (Tokyo) |
| `ExpiresAt` | Date | トークン有効期限 | Include time: Yes, Time zone: GMT+9 (Tokyo) |
| `Used` | Checkbox | 使用済みフラグ | Default: unchecked |
| `Ip_Address` | Single line text | リクエスト元IPアドレス | - |
| `User_Agent` | Long text | ブラウザ情報 | - |

### フィールド作成の詳細手順

#### 1. Token（Primary Field）
- デフォルトの「Name」フィールドを右クリック → 「Customize field type」
- Field name: `Token`
- Field type: Single line text
- 保存

#### 2. Email
- 「+ Add field」をクリック
- Field name: `Email`
- Field type: Email
- 保存

#### 3. CreatedAt
- 「+ Add field」をクリック
- Field name: `CreatedAt`
- Field type: Date
- 設定:
  - Date format: ISO (例: 2026-02-25)
  - Include a time field: ✅ Yes
  - Time format: 24 hour (例: 14:30)
  - Time zone: GMT+9 (Tokyo)
- 保存

#### 4. ExpiresAt
- 「+ Add field」をクリック
- Field name: `ExpiresAt`
- Field type: Date
- 設定:
  - Date format: ISO (例: 2026-02-25)
  - Include a time field: ✅ Yes
  - Time format: 24 hour (例: 14:30)
  - Time zone: GMT+9 (Tokyo)
- 保存

#### 5. Used
- 「+ Add field」をクリック
- Field name: `Used`
- Field type: Checkbox
- Default: unchecked
- 保存

#### 6. Ip_Address
- 「+ Add field」をクリック
- Field name: `Ip_Address`
- Field type: Single line text
- 保存

#### 7. User_Agent
- 「+ Add field」をクリック
- Field name: `User_Agent`
- Field type: Long text
- 保存

### 完成後の確認事項

テーブルが正しく作成されたか確認してください：

- ✅ テーブル名が `AuthTokens` である
- ✅ 7つのフィールドがすべて作成されている
- ✅ フィールド名が完全に一致している（大文字小文字含む）
- ✅ 日付フィールドに時刻が含まれている
- ✅ タイムゾーンが GMT+9 (Tokyo) に設定されている

### View設定（オプション）

管理しやすくするために、以下のViewを作成することをおすすめします：

#### Active Tokens View
- Filter: `Used` is unchecked AND `ExpiresAt` is after now
- Sort: `CreatedAt` (newest first)

#### Used Tokens View
- Filter: `Used` is checked
- Sort: `CreatedAt` (newest first)

#### Expired Tokens View
- Filter: `ExpiresAt` is before now
- Sort: `ExpiresAt` (newest first)

### データ例

テーブルが正しく動作しているか確認するため、手動でテストレコードを作成してみてください：

| Token | Email | CreatedAt | ExpiresAt | Used | Ip_Address | User_Agent |
|-------|-------|------------|------------|------|------------|------------|
| test-token-123 | test@example.com | 2026-02-25 12:00 | 2026-02-25 12:15 | ❌ | 192.168.1.1 | Mozilla/5.0... |

### トラブルシューティング

#### エラー: "UNKNOWN_FIELD_NAME"
- フィールド名のスペルを確認してください
- 大文字小文字が完全に一致している必要があります
- アンダースコア（`_`）の位置を確認してください

#### エラー: "INVALID_VALUE_FOR_COLUMN"
- Date フィールドに時刻が含まれているか確認
- ISO 8601形式（`2026-02-25T12:00:00.000Z`）で保存されているか確認

### 次のステップ

AuthTokens テーブルを作成したら：

1. ✅ Netlify Functions の SendGrid import を修正
2. ✅ 無料会員登録をテスト
3. ✅ マジックリンクメールが届くか確認
4. ✅ ログインが成功するか確認

---

**作成日**: 2026-02-25
**関連ファイル**: `netlify/functions/send-magic-link.js`
