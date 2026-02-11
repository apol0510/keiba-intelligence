# Netlify & GitHub Secrets セットアップ手順

## 1. Netlify Build Hook URL取得

### 手順（Netlify Web UI）
1. https://app.netlify.com/ にログイン
2. keiba-intelligenceサイトを選択
3. Site settings → Build & deploy → Build hooks
4. "Add build hook" をクリック
5. 以下を入力：
   - Build hook name: `GitHub-Actions-Auto-Deploy`
   - Branch to build: `main`
6. "Save" をクリック
7. 表示されたURLをコピー（例：`https://api.netlify.com/build_hooks/xxxxx`）

## 2. GitHub Secretsに追加

### 方法A: GitHub CLI（ターミナル）
```bash
# コピーしたBuild Hook URLを設定
echo "https://api.netlify.com/build_hooks/xxxxx" | gh secret set NETLIFY_BUILD_HOOK_URL --repo apol0510/keiba-intelligence
```

### 方法B: GitHub Web UI
1. https://github.com/apol0510/keiba-intelligence/settings/secrets/actions にアクセス
2. "New repository secret" をクリック
3. 以下を入力：
   - Name: `NETLIFY_BUILD_HOOK_URL`
   - Value: コピーしたBuild Hook URL
4. "Add secret" をクリック

## 3. Netlify環境変数に ALERT_EMAIL 追加

### 手順（Netlify Web UI）
1. https://app.netlify.com/ にログイン
2. keiba-intelligenceサイトを選択
3. Site settings → Environment variables
4. "Add a variable" をクリック
5. 以下を入力：
   - Key: `ALERT_EMAIL`
   - Value: `your-email@example.com`（マコさんのメールアドレス）
   - Scopes: All contexts（すべてチェック）
6. "Create variable" をクリック

## 4. 設定確認

### GitHub Secretsの確認
```bash
gh secret list --repo apol0510/keiba-intelligence
```

出力に `NETLIFY_BUILD_HOOK_URL` が含まれていればOK

### Netlify環境変数の確認
Netlify管理画面で Environment variables に `ALERT_EMAIL` が表示されていればOK

## 5. 動作テスト

次回の結果データ追加時に：
1. GitHub Actionsが自動実行
2. 成功時にメール通知が届く
3. Netlifyが自動デプロイされる

## 必要な設定一覧

| 種類 | 名前 | 設定場所 | 用途 |
|------|------|---------|------|
| GitHub Secret | `NETLIFY_BUILD_HOOK_URL` | GitHub Secrets | 自動デプロイトリガー |
| Netlify Env Var | `ALERT_EMAIL` | Netlify環境変数 | メール通知先 |
| Netlify Env Var | `SENDGRID_API_KEY` | Netlify環境変数 | メール送信（既存） |
| Netlify Env Var | `SENDGRID_FROM_EMAIL` | Netlify環境変数 | 送信元アドレス（既存） |

## トラブルシューティング

### GitHub Actionsが失敗する場合
1. GitHub Actionsログを確認: https://github.com/apol0510/keiba-intelligence/actions
2. `NETLIFY_BUILD_HOOK_URL` が正しく設定されているか確認
3. Netlify Build Hook URLが有効か確認（Netlify管理画面）

### メール通知が届かない場合
1. `ALERT_EMAIL` が正しく設定されているか確認
2. `SENDGRID_API_KEY` が有効か確認
3. SendGridのメール送信ログを確認

### Netlifyデプロイが実行されない場合
1. Build Hook URLが正しいか確認
2. GitHub ActionsログでcURLコマンドの出力を確認
3. Netlifyデプロイログを確認: https://app.netlify.com/sites/YOUR_SITE/deploys
