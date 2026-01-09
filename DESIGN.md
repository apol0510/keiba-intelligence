# KEIBA Intelligence - 詳細設計書

## プロジェクト概要

### プロジェクト名
**KEIBA Intelligence（ケイバ・インテリジェンス）**

### コンセプト
「AI-Powered Intelligence Dashboard for 南関競馬」

### 作成日
2026-01-09

---

## 1. システム概要

### 技術スタック

| カテゴリ | 技術 | 用途 |
|---------|------|------|
| フロントエンド | Astro 5.16+ | 静的サイトジェネレーター |
| スタイリング | Sass | ダークテーマ・グラデーション |
| ホスティング | Netlify Pro | SSG + Functions |
| 決済 | ThriveCart + PayPal | サブスクリプション決済 |
| 顧客管理 | Airtable Pro | データベース |
| 自動化 | Zapier Premium | ThriveCart → Airtable連携 |
| メール | SendGrid Essential 100 | 月100,000通無料 |
| バックエンド | Netlify Functions (Node.js 20) | サーバーレス |
| AI開発 | Claude Pro + ChatGPT Plus | 開発支援・予想生成 |

### 月額コスト

| サービス | プラン | 月額 |
|---------|--------|------|
| Netlify | Pro | $19 |
| Airtable | Pro | $20 |
| Zapier | Premium | $73.50 |
| SendGrid | Essential 100 | $0 |
| Claude | Pro | $20 |
| ChatGPT | Plus | $20 |
| **合計** | - | **$152.50（約¥22,800）** |

---

## 2. 価格設定

### プラン構成

| プラン | 月額 | 年額（2ヶ月無料） | 内容 | 1日あたり |
|--------|------|------------------|------|-----------|
| **フリー** | **¥0** | - | 予想閲覧のみ（買い目なし） | ¥0 |
| **ライト** | **¥2,980** | **¥29,800** | 後半3レース買い目 | ¥99 |
| **スタンダード** | **¥4,980** | **¥49,800** | 全レース馬単買い目 | ¥166 |
| **プレミアム** | **¥6,980** | **¥69,800** | 全レース三連複買い目 | ¥233 |
| **アルティメット** | **¥8,980** | **¥89,800** | 馬単+三連複+穴馬 | ¥299 |
| **AI Plus（単品）** | **¥19,800** | - | 1鞍超精密予想 | - |

### 退会しにくい価格設計

**心理的価格設定:**
- ¥2,980/月 = 1日¥99（缶コーヒー1本分）
- Netflix Standardと同価格帯
- 後半3レースで1回的中すれば元が取れる

**年額プランの強力な誘導:**
- 2ヶ月無料（16.7%割引）
- 月¥2,483相当（¥500/月節約）
- 1年契約で解約率大幅低下

---

## 3. データベース設計（Airtable）

### Customersテーブル（会員管理）

| フィールド名 | 型 | 説明 | 例 | 必須 |
|------------|---|-----|-----|-----|
| CustomerID | Auto Number | 自動連番 | 1234 | ✅ |
| Email | Email | メールアドレス | user@example.com | ✅ |
| Name | Single line text | 氏名 | 山田太郎 | ✅ |
| Plan | Single select | プラン | Light/Standard/Premium/Ultimate | ✅ |
| PaymentStatus | Single select | 支払い状態 | Active/Canceled/Expired | ✅ |
| 有効期限 | Date | サブスク有効期限 | 2025-12-31 | ✅ |
| ThriveCartCustomerID | Single line text | ThriveCart顧客ID | tc_abc123 | |
| ThriveCartOrderID | Single line text | 注文ID | order_xyz789 | |
| CreatedAt | Created time | 登録日時 | 2025-01-09 | ✅ |
| LastLoginAt | Date | 最終ログイン | 2025-01-09 | |
| MagicLinkToken | Single line text | ログイントークン | token_abc... | |
| TokenExpiry | Date | トークン有効期限 | 2025-01-10 | |
| WithdrawalRequested | Checkbox | 退会申請中 | ☐ | ✅ |
| WithdrawalDate | Date | 退会日 | - | |
| WithdrawalReason | Long text | 退会理由 | - | |
| Points | Number | ポイント残高 | 1500 | ✅ |

### ScheduledEmailsテーブル（メルマガ予約）

| フィールド名 | 型 | 説明 |
|------------|---|-----|
| EmailID | Auto Number | メールID |
| Subject | Single line text | 件名 |
| Body | Long text | 本文 |
| TargetPlan | Multiple select | 対象プラン |
| ScheduledDate | Date | 送信予定日時 |
| Status | Single select | PENDING/SENT/FAILED |
| SentCount | Number | 送信済み件数 |
| Recipients | Long text | LAZY_LOAD形式 |

---

## 4. データ保存設計（全レース的中記録）

### 目的

**過去予想の保存:**
- **目的**: SEO対策
- **保存内容**: レース名のみ

**結果の保存:**
- **目的**: 信頼性アピール
- **保存内容**: 全レース的中・外れ記録 + 的中率・回収率

### 予想データ構造（JSON）

**src/data/predictions/archive/YYYY-MM.json**

```json
{
  "2025-01": [
    {
      "date": "2025-01-09",
      "track": "大井競馬",
      "races": [
        { "raceNumber": 1, "raceName": "３歳(六)ダ1,300m" },
        { "raceNumber": 2, "raceName": "３歳(六)ダ1,500m" },
        // ... 12レース分
      ]
    }
  ]
}
```

**ファイルサイズ: 1日0.5KB、1ヶ月15KB、10年1.8MB**

### 結果データ構造（JSON）

**src/data/results/archive/YYYY-MM.json**

```json
{
  "2025-01": {
    "monthly_stats": {
      "total_races": 360,
      "hit_count": 281,
      "miss_count": 79,
      "hit_rate": 78.1,
      "recovery_rate": 125.3,
      "total_payout": 1253000,
      "total_bet": 1000000
    },
    "daily_results": [
      {
        "date": "2025-01-09",
        "track": "大井競馬",
        "daily_stats": {
          "hit_count": 9,
          "total_races": 12,
          "hit_rate": 75.0,
          "recovery_rate": 118.5
        },
        "races": [
          {
            "raceNumber": 1,
            "raceName": "３歳(六)ダ1,300m",
            "betType": "馬単",
            "predicted": {
              "main": { "number": 1, "name": "テレンティウス", "mark": "◎" },
              "sub": { "number": 7, "name": "ダイメイバタフライ", "mark": "○" },
              "hole": { "number": 3, "name": "エトランジュパワー", "mark": "▲" }
            },
            "result": {
              "winner": 1,
              "runnerup": 7,
              "third": 5,
              "hit": true,
              "payout": 850,
              "odds": 4.25,
              "betAmount": 200,
              "profit": 650
            }
          },
          // ... 全12レース保存
        ]
      }
    ]
  }
}
```

**ファイルサイズ: 1日3.6KB、1ヶ月108KB、10年13MB**

---

## 5. ThriveCart決済・Zapier自動化

### ThriveCart商品設定

#### 1. ライトプラン - ¥2,980/月
```
Product Name: ライト会員プラン
Monthly Price: ¥2,980
Annual Price: ¥29,800（2ヶ月無料）
Description: 後半3レース買い目提供
Access: 30日間
Upsell: スタンダードプラン（+¥2,000/月で全レース買い目）
```

#### 2. スタンダードプラン - ¥4,980/月
```
Product Name: スタンダード会員プラン
Monthly Price: ¥4,980
Annual Price: ¥49,800（2ヶ月無料）
Description: 全レース馬単買い目提供
Access: 30日間
Upsell: プレミアムプラン（+¥2,000/月で三連複追加）
```

#### 3. プレミアムプラン - ¥6,980/月
```
Product Name: プレミアム会員プラン
Monthly Price: ¥6,980
Annual Price: ¥69,800（2ヶ月無料）
Description: 全レース三連複買い目提供
Access: 30日間
Upsell: アルティメットプラン（+¥2,000/月で馬単+三連複）
```

#### 4. アルティメットプラン - ¥8,980/月
```
Product Name: アルティメット会員プラン
Monthly Price: ¥8,980
Annual Price: ¥89,800（2ヶ月無料）
Description: 馬単+三連複+穴馬情報
Access: 30日間
Upsell: AI Plus単品（¥19,800で1鞍超精密予想）
```

#### 5. AI Plus - ¥19,800（単品商品）
```
Product Name: AI Plus（1鞍超精密予想）
Price: ¥19,800（買い切り）
Description: 超高性能AI・最高確率1鞍
Access: プレミアム/アルティメット会員のみ購入可
Restriction: ThriveCart Membership連携
```

### Zapier自動化フロー

#### Zap 1: ThriveCart Purchase → Airtable + SendGrid

**Trigger: ThriveCart - New Purchase**

**Action 1: Airtable - Search Records**
```
Base: keiba-intelligence
Table: Customers
Field: Email
Value: {{customer_email}}
```

**Action 2: Conditional Logic**
```
If Record Exists:
  → Airtable - Update Record
    - Plan: {{product_name}}
    - PaymentStatus: Active
    - 有効期限: {{今日 + 30日}}
    - ThriveCartOrderID: {{order_id}}
    - WithdrawalRequested: false

Else:
  → Airtable - Create Record
    - Email: {{customer_email}}
    - Name: {{customer_name}}
    - Plan: {{product_name}}
    - PaymentStatus: Active
    - 有効期限: {{今日 + 30日}}
    - ThriveCartCustomerID: {{customer_id}}
    - ThriveCartOrderID: {{order_id}}
```

**Action 3: SendGrid - Send Email**
```
To: {{customer_email}}
Template ID: welcome_email
Variables:
  - name: {{customer_name}}
  - plan: {{product_name}}
  - login_url: https://keiba-intelligence.keiba.link/login
```

#### Zap 2: ThriveCart Refund/Cancel → Airtable

**Trigger: ThriveCart - Refund/Cancel**

**Action 1: Airtable - Find Record**
```
Field: ThriveCartOrderID
Value: {{order_id}}
```

**Action 2: Airtable - Update Record**
```
PaymentStatus: Canceled
有効期限: {{今日}}
WithdrawalRequested: true
WithdrawalDate: {{今日}}
WithdrawalReason: Refund/Cancel
```

---

## 6. 認証システム（マジックリンク）

### ログインフロー

```
1. ユーザーがメールアドレス入力
   ↓
2. Netlify Function: send-magic-link.js
   - 32文字ランダムトークン生成
   - トークン有効期限: 30分
   - Airtable Customersテーブルに保存
   - Brevoでメール送信
   ↓
3. ユーザーがメール内のリンクをクリック
   ↓
4. Netlify Function: verify-magic-link.js
   - トークン検証
   - 有効期限チェック
   - ローカルストレージに認証情報保存
   ↓
5. 会員ページにアクセス可能
```

### AccessControl.astro（プラン制御）

```javascript
const planHierarchy = {
  'Free': 0,
  'Light': 1,
  'Standard': 2,
  'Premium': 2,
  'Ultimate': 3
};

// 退会フラグチェック
if (isWithdrawalRequested === 'true') {
  effectivePlan = 'Free';
}

// 有効期限チェック
if (isExpired || new Date(validUntil) < new Date()) {
  effectivePlan = 'Free';
}
```

---

## 7. SEO戦略

### 生成されるSEOページ（10年後）

| ページ種別 | ページ数 | SEO価値 |
|-----------|---------|---------|
| 日別予想アーカイブ | 3,650 | ★★★☆☆ |
| 日別結果ページ | 3,650 | ★★★★★ |
| 月別実績ページ | 120 | ★★★★★ |
| 年別実績ページ | 10 | ★★★★★ |
| コース別統計ページ | 60 | ★★★★★ |
| **合計** | **7,490ページ** | - |

### SEOページ例

#### 日別結果ページ（/results/2025/01/09/）
```
タイトル: 2025年1月9日 大井競馬 結果・的中率75.0% - KEIBA Intelligence
H1: 2025年1月9日 大井競馬 結果
コンテンツ:
  - 本日の実績（的中率・回収率）
  - 全12レースの予想・結果・的中状況
  - グラフ・チャート表示
```

---

## 8. デザインシステム

### コンセプト
**AI-Powered Intelligence Dashboard**

### カラーパレット

```css
/* メインカラー: インテリジェントブルー */
--primary: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
--secondary: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%);

/* 背景: ダークネイビー（軽め） */
--bg-primary: #0f172a;
--bg-secondary: #1e293b;
--bg-card: rgba(30, 41, 59, 0.8);

/* アクセント: ネオングリーン（的中時） */
--success: #10b981;
--warning: #f59e0b;
--danger: #ef4444;

/* データ可視化 */
--chart-blue: #3b82f6;
--chart-purple: #a855f7;
--chart-green: #10b981;
--chart-yellow: #fbbf24;
```

### タイポグラフィ

```css
font-family: 'Segoe UI', 'Noto Sans JP', sans-serif;
```

### レイアウト

- **グリッドシステム**: CSS Grid（2カラム・3カラム）
- **カードデザイン**: 半透明背景 + ブラー効果
- **グラデーション**: linear-gradient(135deg, #3b82f6, #8b5cf6)
- **ボタン**: ホバー時に上昇アニメーション

---

## 9. 自動化フロー

### 予想データ更新（Phase 1: 手動）

```
マコさん → 管理画面（prediction-converter）
  → 特徴量データ入力
  → JSON変換
  → Gitコミット（手動）
  → Netlify自動ビルド（1-2分）
  → サイト更新完了
```

### 決済処理（完全自動）

```
顧客 → ThriveCartチェックアウト
  → PayPal決済完了
  → ThriveCart Webhook → Zapier
  → Airtable Customers更新
  → SendGridウェルカムメール
  → マジックリンク自動送信
  → 顧客がログイン
```

### 結果更新（Phase 1: 手動）

```
マコさん → 管理画面（results-manager）
  → 結果データ入力
  → archiveResults.json生成
  → Gitコミット（手動）
  → Netlify自動ビルド
```

---

## 10. プロジェクト実装計画（2週間）

### Week 1: 基盤構築

#### Day 1-2: プロジェクト初期化
- [x] Astroプロジェクト作成
- [x] GitHub連携
- [ ] Netlify連携
- [ ] デザインシステム構築

#### Day 3-4: 認証システム
- [ ] マジックリンク実装
- [ ] AccessControl.astro実装
- [ ] ThriveCart + Zapier設定

#### Day 5-7: コアページ
- [ ] トップページ
- [ ] 無料予想ページ
- [ ] 有料予想ページ（4プラン）
- [ ] 料金プランページ

### Week 2: 管理画面・SEO・デプロイ

#### Day 8-10: 管理画面
- [ ] prediction-converter.astro
- [ ] results-manager.astro
- [ ] メルマガ管理（SendGrid統合）

#### Day 11-12: SEOページ自動生成
- [ ] 日別予想アーカイブページ
- [ ] 月別実績ページ
- [ ] レース名別SEOページ

#### Day 13-14: テスト・デプロイ
- [ ] ThriveCart Test Mode決済テスト
- [ ] Zapier動作確認
- [ ] SendGrid送信テスト
- [ ] 本番デプロイ

---

## 11. 長期運用設計

### スケーラビリティ

| 項目 | 現在 | 10年後 | 上限 | 余裕度 |
|------|------|--------|------|--------|
| Airtable Customers | 100人 | 1,000人 | 250,000件 | 99.6% |
| Airtable Predictions | 0件 | 43,800件 | 250,000件 | 82.5% |
| Airtable Results | 0件 | 43,800件 | 250,000件 | 82.5% |
| Netlify ビルド時間 | 1分 | 5分 | 25時間/月 | 99.7% |
| SendGrid 送信数 | 300通/月 | 3,000通/月 | 100,000通/月 | 97% |

### 10年運用シミュレーション

**前提条件:**
- 会員数: 100人（平均単価¥2,000/月）
- 月間売上: ¥200,000
- 月間コスト: ¥22,800
- 月間利益: ¥177,200

**10年間:**
- 総売上: ¥24,000,000
- 総コスト: ¥2,736,000
- **総利益: ¥21,264,000**

---

## 12. 参考プロジェクト

### nankan-analytics

**参考にする点:**
- 管理画面の予想データ変換システム
- 結果管理システム
- マジックリンク認証システム
- AccessControl.astroのプラン制御ロジック
- 月別ファイル分割設計

**差別化する点:**
- ThriveCart + PayPal決済（Stripeの代わり）
- 低価格帯（¥2,980〜）
- AI-Powered Dashboardデザイン
- 全レース的中・外れ記録の完全保存
- コース別統計ページの自動生成

---

## 13. 環境変数（.envファイル）

```bash
# Airtable
AIRTABLE_API_KEY=patxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AIRTABLE_BASE_ID=appxxxxxxxxxxxxxxx
AIRTABLE_TABLE_NAME=Customers

# SendGrid
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Brevo (マジックリンク認証用)
BREVO_API_KEY=xkeysib-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# GitHub (自動コミット用・Phase 2)
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# ThriveCart
THRIVECART_WEBHOOK_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## 14. デプロイ設定（netlify.toml）

```toml
[build]
  command = "npm run build"
  publish = "dist"
  functions = "netlify/functions"

[build.environment]
  NODE_VERSION = "20"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    X-XSS-Protection = "1; mode=block"
    Referrer-Policy = "no-referrer-when-downgrade"
```

---

## 15. 次のステップ

### Phase 1（今すぐ実装）

1. ✅ プロジェクト作成・初期化
2. ✅ ディレクトリ構造作成
3. ✅ package.json・astro.config.mjs設定
4. ✅ 依存関係インストール
5. [ ] GitHub連携・リポジトリ作成
6. [ ] Netlify連携・自動デプロイ設定
7. [ ] デザインシステム構築
8. [ ] BaseLayout.astro作成
9. [ ] トップページ作成

### Phase 2（今週実装）

1. [ ] マジックリンク認証実装
2. [ ] AccessControl.astro実装
3. [ ] ThriveCart商品登録
4. [ ] Zapier Zap作成（2本）
5. [ ] SendGridテンプレート作成
6. [ ] Airtableテーブル作成
7. [ ] 無料予想ページ作成
8. [ ] 有料予想ページ作成（4プラン）

### Phase 3（来週実装）

1. [ ] 管理画面（prediction-converter）
2. [ ] 管理画面（results-manager）
3. [ ] SEOページ自動生成
4. [ ] テスト決済
5. [ ] 本番デプロイ

---

## 完成予定日
**2026-01-23（2週間後）**

---

**作成者: Claude Code（クロちゃん）**
**最終更新: 2026-01-09**
