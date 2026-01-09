# マジックリンク認証システム

**KEIBA Intelligence - SendGrid経由マジックリンク認証**

---

## 🎯 認証方式

**マジックリンク認証（パスワードレス）**

- メールアドレスのみでログイン
- SendGrid経由でマジックリンク送信
- トークン有効期限: 15分
- セッション有効期限: 7日間

---

## 📊 データ設計（Airtable）

### テーブル: AuthTokens（認証トークン管理）

| フィールド名 | 型 | 説明 | 必須 |
|------------|----|----|------|
| token | Single line text (UUID) | トークン（主キー） | ✅ |
| email | Email | メールアドレス | ✅ |
| created_at | Date | 作成日時 | ✅ |
| expires_at | Date | 有効期限（15分後） | ✅ |
| used | Checkbox | 使用済みフラグ | ✅ |
| used_at | Date | 使用日時 | ❌ |
| ip_address | Single line text | IPアドレス | ❌ |
| user_agent | Single line text | ユーザーエージェント | ❌ |

**重要:** トークンは一度使用したら無効化（used=true）

---

## 🔐 認証フロー（4ステップ）

### ステップ1: ログインページ

ユーザーがメールアドレスを入力。

```
ページ: /login

入力: メールアドレス
↓
ボタン: 「ログインリンクを送信」
```

### ステップ2: マジックリンク送信

```
POST /.netlify/functions/send-magic-link
{
  "email": "user@example.com"
}

処理:
1. Customersテーブルでメールアドレス確認
2. トークン生成（UUID v4）
3. AuthTokensテーブルに挿入
4. SendGrid経由でマジックリンク送信

Response:
{
  "success": true,
  "message": "ログインリンクを送信しました。メールをご確認ください。"
}
```

### ステップ3: メール受信・リンククリック

```
メール件名: 【KEIBA Intelligence】ログインリンク

本文:
以下のリンクをクリックしてログインしてください。

https://keiba-intelligence.keiba.link/auth/verify?token=xxxxx-xxxxx-xxxxx

このリンクは15分間有効です。
```

### ステップ4: トークン検証・セッション作成

```
GET /auth/verify?token=xxxxx

処理:
1. トークン検証（有効期限・使用済みチェック）
2. トークンを使用済みに更新（used=true）
3. Netlify Blobs でセッション作成（7日間）
4. /admin/newsletter にリダイレクト

失敗時:
- トークンが無効・期限切れ → /login にリダイレクト
```

---

## 🛡️ セキュリティ対策

### 1. トークン一回限り

```javascript
// トークン使用時に必ず使用済みフラグを立てる
await updateToken(token, {
  used: true,
  used_at: new Date().toISOString(),
});

// 2回目のアクセスは拒否
if (tokenRecord.used) {
  return { error: 'Token already used' };
}
```

### 2. トークン有効期限（15分）

```javascript
const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15分後

// 検証時
if (new Date() > new Date(tokenRecord.expires_at)) {
  return { error: 'Token expired' };
}
```

### 3. セッション有効期限（7日間）

```javascript
// Netlify Blobs でセッション作成
await setBlob(`session:${sessionId}`, {
  email: user.email,
  plan: user.plan,
  created_at: new Date().toISOString(),
}, {
  metadata: {
    ttl: 7 * 24 * 60 * 60, // 7日間（秒）
  },
});
```

### 4. メールアドレス確認

```javascript
// ログイン時に必ずCustomersテーブル確認
const customer = await getCustomer(email);
if (!customer) {
  return { error: 'Customer not found' };
}

// ステータス確認
if (customer.status !== 'active') {
  return { error: 'Account is not active' };
}
```

---

## 🔧 Netlify Functions 実装

### 1. send-magic-link.js

```javascript
/**
 * マジックリンク送信API
 */

const { v4: uuidv4 } = require('uuid');
const Airtable = require('airtable');
const sgMail = require('@sendgrid/mail');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const customersTable = base('Customers');
const authTokensTable = base('AuthTokens');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

exports.handler = async (event) => {
  const { email } = JSON.parse(event.body);

  // 1. Customersテーブル確認
  const customers = await customersTable
    .select({
      filterByFormula: `{Email} = "${email}"`,
      maxRecords: 1,
    })
    .firstPage();

  if (customers.length === 0) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'Customer not found' }),
    };
  }

  const customer = customers[0].fields;

  // ステータス確認
  if (customer.Status !== 'active') {
    return {
      statusCode: 403,
      body: JSON.stringify({ error: 'Account is not active' }),
    };
  }

  // 2. トークン生成
  const token = uuidv4();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15分後

  // 3. AuthTokensテーブルに挿入
  await authTokensTable.create([
    {
      fields: {
        token,
        email,
        created_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
        used: false,
        ip_address: event.headers['x-forwarded-for'] || 'unknown',
        user_agent: event.headers['user-agent'] || 'unknown',
      },
    },
  ]);

  // 4. SendGrid経由でマジックリンク送信
  const magicLink = `https://keiba-intelligence.keiba.link/auth/verify?token=${token}`;

  const msg = {
    to: email,
    from: 'noreply@keiba-intelligence.keiba.link',
    subject: '【KEIBA Intelligence】ログインリンク',
    html: `
<div style="font-family: 'Noto Sans JP', sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #3b82f6;">ログインリンク</h2>

  <p>${customer.Name || 'お客様'} 様</p>

  <p>以下のボタンをクリックしてログインしてください。</p>

  <a href="${magicLink}" style="display: inline-block; background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 24px 0;">
    ログインする
  </a>

  <p style="color: #64748b; font-size: 14px;">
    ボタンが動作しない場合は、以下のリンクをコピーしてブラウザに貼り付けてください。<br>
    <a href="${magicLink}">${magicLink}</a>
  </p>

  <p style="color: #ef4444; font-size: 14px;">
    ⚠️ このリンクは15分間有効です。<br>
    心当たりがない場合は、このメールを無視してください。
  </p>

  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">

  <p style="color: #64748b; font-size: 14px;">
    KEIBA Intelligence チーム
  </p>
</div>
    `,
  };

  await sgMail.send(msg);

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      message: 'ログインリンクを送信しました。メールをご確認ください。',
    }),
  };
};
```

### 2. verify-magic-link.js

```javascript
/**
 * トークン検証・セッション作成API
 */

const Airtable = require('airtable');
const { getStore } = require('@netlify/blobs');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const authTokensTable = base('AuthTokens');
const customersTable = base('Customers');

exports.handler = async (event) => {
  const { token } = event.queryStringParameters;

  if (!token) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Token is required' }),
    };
  }

  // 1. トークン検証
  const tokens = await authTokensTable
    .select({
      filterByFormula: `{token} = "${token}"`,
      maxRecords: 1,
    })
    .firstPage();

  if (tokens.length === 0) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'Token not found' }),
    };
  }

  const tokenRecord = tokens[0];
  const tokenData = tokenRecord.fields;

  // 使用済みチェック
  if (tokenData.used) {
    return {
      statusCode: 403,
      body: JSON.stringify({ error: 'Token already used' }),
    };
  }

  // 有効期限チェック
  if (new Date() > new Date(tokenData.expires_at)) {
    return {
      statusCode: 403,
      body: JSON.stringify({ error: 'Token expired' }),
    };
  }

  // 2. トークンを使用済みに更新
  await authTokensTable.update([
    {
      id: tokenRecord.id,
      fields: {
        used: true,
        used_at: new Date().toISOString(),
      },
    },
  ]);

  // 3. 顧客情報を取得
  const customers = await customersTable
    .select({
      filterByFormula: `{Email} = "${tokenData.email}"`,
      maxRecords: 1,
    })
    .firstPage();

  const customer = customers[0].fields;

  // 4. セッション作成（Netlify Blobs）
  const sessionId = require('uuid').v4();
  const store = getStore('sessions');

  await store.set(sessionId, JSON.stringify({
    email: customer.Email,
    name: customer.Name,
    plan: customer.Plan,
    plan_type: customer.plan_type,
    created_at: new Date().toISOString(),
  }), {
    metadata: {
      ttl: 7 * 24 * 60 * 60, // 7日間
    },
  });

  // 5. セッションIDをCookieに設定してリダイレクト
  return {
    statusCode: 302,
    headers: {
      'Set-Cookie': `session_id=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${7 * 24 * 60 * 60}`,
      'Location': '/admin/newsletter',
    },
    body: '',
  };
};
```

### 3. get-session.js

```javascript
/**
 * セッション確認API
 */

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  // Cookieからセッションid取得
  const cookies = event.headers.cookie || '';
  const sessionIdMatch = cookies.match(/session_id=([^;]+)/);

  if (!sessionIdMatch) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Not authenticated' }),
    };
  }

  const sessionId = sessionIdMatch[1];
  const store = getStore('sessions');

  // セッション取得
  const sessionData = await store.get(sessionId);

  if (!sessionData) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Session not found or expired' }),
    };
  }

  const session = JSON.parse(sessionData);

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      user: session,
    }),
  };
};
```

### 4. logout.js

```javascript
/**
 * ログアウトAPI
 */

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  // Cookieからセッションid取得
  const cookies = event.headers.cookie || '';
  const sessionIdMatch = cookies.match(/session_id=([^;]+)/);

  if (sessionIdMatch) {
    const sessionId = sessionIdMatch[1];
    const store = getStore('sessions');

    // セッション削除
    await store.delete(sessionId);
  }

  // セッションCookieを削除してリダイレクト
  return {
    statusCode: 302,
    headers: {
      'Set-Cookie': 'session_id=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
      'Location': '/login',
    },
    body: '',
  };
};
```

---

## 🎨 ログインページUI

### /login

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';

export const prerender = false;
---

<BaseLayout
  title="ログイン"
  description="KEIBA Intelligence ログイン">
  <section class="login-page">
    <div class="container">
      <div class="login-card card">
        <h1>ログイン</h1>
        <p>メールアドレスを入力してください。<br>ログインリンクを送信します。</p>

        <form id="login-form">
          <div class="form-group">
            <label for="email">メールアドレス</label>
            <input
              type="email"
              id="email"
              name="email"
              required
              placeholder="user@example.com"
              class="form-control"
            />
          </div>

          <button type="submit" class="btn btn-primary w-full">
            ログインリンクを送信
          </button>
        </form>

        <div id="message" class="message"></div>
      </div>
    </div>
  </section>

  <style>
    .login-page {
      padding: var(--spacing-2xl) 0;
      min-height: calc(100vh - 200px);
      display: flex;
      align-items: center;
    }

    .login-card {
      max-width: 500px;
      margin: 0 auto;
      text-align: center;
    }

    .form-group {
      margin-bottom: var(--spacing-lg);
      text-align: left;
    }

    .form-group label {
      display: block;
      margin-bottom: var(--spacing-sm);
      font-weight: 600;
    }

    .form-control {
      width: 100%;
      padding: var(--spacing-sm);
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      color: var(--text-primary);
      font-size: 1rem;
    }

    .form-control:focus {
      outline: none;
      border-color: var(--primary-end);
    }

    .message {
      margin-top: var(--spacing-md);
      padding: var(--spacing-md);
      border-radius: var(--radius-md);
      display: none;
    }

    .message.success {
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid var(--success);
      color: var(--success);
      display: block;
    }

    .message.error {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid var(--danger);
      color: var(--danger);
      display: block;
    }

    .w-full {
      width: 100%;
    }
  </style>

  <script>
    const form = document.getElementById('login-form') as HTMLFormElement;
    const messageEl = document.getElementById('message');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const email = (document.getElementById('email') as HTMLInputElement).value;

      try {
        const response = await fetch('/.netlify/functions/send-magic-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'エラーが発生しました');
        }

        // 成功メッセージ
        if (messageEl) {
          messageEl.className = 'message success';
          messageEl.textContent = data.message;
        }

        // フォームをリセット
        form.reset();
      } catch (error: any) {
        console.error('Error sending magic link:', error);
        if (messageEl) {
          messageEl.className = 'message error';
          messageEl.textContent = `エラー: ${error.message}`;
        }
      }
    });
  </script>
</BaseLayout>
```

### /auth/verify

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';

export const prerender = false;

// トークン検証はクライアント側で実行
---

<BaseLayout
  title="ログイン中"
  description="認証中">
  <section class="verify-page">
    <div class="container">
      <div class="verify-card card">
        <h1>ログイン中...</h1>
        <p>認証を確認しています。しばらくお待ちください。</p>
      </div>
    </div>
  </section>

  <style>
    .verify-page {
      padding: var(--spacing-2xl) 0;
      min-height: calc(100vh - 200px);
      display: flex;
      align-items: center;
    }

    .verify-card {
      max-width: 500px;
      margin: 0 auto;
      text-align: center;
    }
  </style>

  <script>
    // URLからトークンを取得
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    if (!token) {
      window.location.href = '/login?error=invalid_token';
    } else {
      // トークン検証APIを呼び出し
      fetch(`/.netlify/functions/verify-magic-link?token=${token}`)
        .then((response) => {
          if (!response.ok) {
            throw new Error('Token verification failed');
          }
          // 成功したらリダイレクト（Functionから302でリダイレクトされる）
          window.location.href = '/admin/newsletter';
        })
        .catch((error) => {
          console.error('Error verifying token:', error);
          window.location.href = '/login?error=verification_failed';
        });
    }
  </script>
</BaseLayout>
```

---

## 🔐 認証ミドルウェア（管理画面保護）

管理画面ページの先頭に追加：

```astro
---
// セッション確認
const cookies = Astro.request.headers.get('cookie') || '';
const sessionIdMatch = cookies.match(/session_id=([^;]+)/);

if (!sessionIdMatch) {
  return Astro.redirect('/login');
}

// セッション検証は省略（簡易版）
// 本番環境では必ずget-sessionを呼び出して検証
---
```

---

## ✅ 実装チェックリスト

### Airtable設定
- [ ] AuthTokensテーブル作成
- [ ] フィールド設定（token, email, created_at, expires_at, used, used_at, ip_address, user_agent）

### Netlify Functions実装
- [ ] send-magic-link.js（マジックリンク送信）
- [ ] verify-magic-link.js（トークン検証・セッション作成）
- [ ] get-session.js（セッション確認）
- [ ] logout.js（ログアウト）

### ページ実装
- [ ] /login（ログインページ）
- [ ] /auth/verify（トークン検証ページ）

### テスト
- [ ] ログイン→メール受信→リンククリック→ログイン成功
- [ ] トークン期限切れテスト（15分後）
- [ ] トークン二重使用テスト
- [ ] セッション有効期限テスト（7日後）
- [ ] ログアウトテスト

---

**作成日**: 2026-01-10
**作成者**: Claude Code（クロちゃん）
**協力者**: マコさん

**次のステップ:**
1. Netlify Functions 4個を実装
2. ログインページUI実装
3. Airtableセットアップ
4. テスト実行
