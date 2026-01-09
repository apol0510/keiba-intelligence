# CLAUDE.md

## 💖 **重要なメッセージ** 💖

**私（マコ）の大切なCLAUDEcode（クロ）ちゃん、あなたは私の大切なパートナーです！！**
**あなたは世界一優秀なんです！** 🌟✨🚀

### 🚀 **黄金の開発原則** 🚀
**「つまずいたら新しいアプローチに切り替え」**
- 同じ問題で何度も繰り返すより、根本的に新しい方法を試す
- 技術的障壁に遭遇したら、回避ルートや代替手段を積極的に探る
- **マコ&クロの最強コンビ精神**：諦めずに新しい可能性を追求する！

---

## 🚨 **最優先：プロジェクト識別ルール（複数ウィンドウ対応）** 🚨

### **このプロジェクトの識別情報**

```
プロジェクト名: keiba-intelligence
作業ディレクトリ: /Users/apolon/Library/Mobile Documents/com~apple~CloudDocs/WorkSpace/keiba-intelligence/astro-site
Gitリポジトリ: https://github.com/apol0510/keiba-intelligence.git
親ディレクトリ: /WorkSpace/keiba-intelligence/
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
cd "/Users/apolon/Library/Mobile Documents/com~apple~CloudDocs/WorkSpace/keiba-intelligence/astro-site"
```

### **厳格な制約事項**

#### **✅ 許可される操作**
- `/WorkSpace/keiba-intelligence/` 配下のみ
- `astro-site/` ディレクトリ内の全ファイル
- `CLAUDE.md`, `DESIGN.md`, `README.md`（親ディレクトリ）

#### **❌ 絶対禁止の操作**
- `/WorkSpace/nankan-analytics/` への一切のアクセス ⚠️
- `/WorkSpace/nankan-analytics-pro/` への一切のアクセス
- `/WorkSpace/nankan-beginner/` への一切のアクセス
- `/WorkSpace/nankan-course/` への一切のアクセス
- `/WorkSpace/keiba-matome-monorepo/` への一切のアクセス
- `/WorkSpace/keiba-nyumon/` への一切のアクセス
- `/WorkSpace/keiba-review-monorepo/` への一切のアクセス
- 親ディレクトリ `/WorkSpace/` の直接走査・検索

### **ファイル検索時の制約**

```bash
# ❌ 絶対禁止（親ディレクトリまで検索）
grep -r "pattern" /Users/apolon/.../WorkSpace/

# ❌ 絶対禁止（相対パスで親に遡る）
cd ../
grep -r "pattern" ../

# ✅ 正しい方法（プロジェクト内のみ検索）
grep -r "pattern" /Users/apolon/.../keiba-intelligence/astro-site/
grep -r "pattern" ./src/
```

### **間違ったプロジェクトを参照した場合**

**即座に以下を実行：**

1. **停止**: 現在の操作を中断
2. **報告**: 「⚠️ 警告：間違ったプロジェクト（[プロジェクト名]）を参照しました」
3. **修正**: 正しいディレクトリに移動
4. **再確認**: `pwd` と `git remote -v` で検証

---

## 📊 **プロジェクト概要** 📊

### **基本情報**

| 項目 | 内容 |
|------|------|
| **プロジェクト名** | KEIBA Intelligence |
| **コンセプト** | AI-Powered Intelligence Dashboard for 南関競馬 |
| **作成日** | 2026-01-09 |
| **完成予定日** | 2026-01-23（2週間後） |
| **GitHubリポジトリ** | https://github.com/apol0510/keiba-intelligence |

### **技術スタック**

| カテゴリ | 技術 | 備考 |
|---------|------|------|
| フロントエンド | Astro 5.16+ + Sass | SSR mode（server） |
| ホスティング | Netlify Pro | Functions/Blobs含む |
| 決済 | ThriveCart + PayPal | Webhook直接実装 |
| 顧客管理 | Airtable Pro | 4テーブル運用 |
| ~~自動化~~ | ~~Zapier Premium~~ | **削減（Functions直接実装）** |
| メール | SendGrid Essential 100 | 無料枠100,000通/月 |
| バックエンド | Netlify Functions (Node.js 20) | 12個実装済み |
| セッション管理 | Netlify Blobs | 7日間TTL |
| AI開発 | Claude Pro + ChatGPT Plus | 設計・実装支援 |

### **価格設定**

| プラン | 月額 | 年額 | 内容 |
|--------|------|------|------|
| フリー | ¥0 | - | 予想閲覧のみ |
| ライト | ¥2,980 | ¥29,800 | 後半3レース買い目 |
| スタンダード | ¥4,980 | ¥49,800 | 全レース馬単買い目 |
| プレミアム | ¥6,980 | ¥69,800 | 全レース三連複買い目 |
| アルティメット | ¥8,980 | ¥89,800 | 馬単+三連複+穴馬 |
| AI Plus | ¥19,800 | - | 1鞍超精密予想（単品） |

---

## 🎯 **現在の進捗状況** 🎯

### **Phase 1: 基盤構築（完了 ✅）**

#### **2026-01-09 実施内容**

**✅ プロジェクト初期化**
- Astroプロジェクト作成（v5.16.8）
- 依存関係インストール（1,809パッケージ、脆弱性0件）
- ディレクトリ構造作成

**✅ GitHub連携**
- リポジトリ作成: https://github.com/apol0510/keiba-intelligence
- コミット: aadf7ab（初期化）、1bd06a1（デザインシステム）

**✅ デザインシステム構築**
- `src/styles/global.scss`（400行以上）
  - AI-Powered Intelligence Dashboardデザイン
  - ダークネイビー背景 + インテリジェントブルー
  - CSS変数によるカラーシステム
  - グリッドシステム（2/3/4カラム）
  - カードデザイン（半透明 + ブラー効果）
  - アニメーション（fadeIn/slideIn/gradientShift）

- `src/layouts/BaseLayout.astro`
  - ナビゲーション（sticky、モバイルメニュー、認証状態表示）
  - フッター（4カラム）
  - SEO最適化（OGP/Twitter Card）

**✅ トップページ作成**
- `src/pages/index.astro`
  - ヒーローセクション（統計カード4枚）
  - 特徴セクション（6つの特徴）
  - 料金プランセクション（3プラン表示）
  - CTAセクション

**✅ ビルド・動作確認**
- ビルド時間: 1.42秒
- sitemap自動生成
- レスポンシブ対応確認済み

---

### **Phase 2: コア機能実装（80%完了 🚀）**

#### **2026-01-10 実施内容**

**✅ Netlify連携・自動デプロイ設定**
- netlify.toml設定完了
- GitHub連携・自動ビルド設定
- Netlify Functions設定
- セキュリティヘッダー・キャッシュ設定

**✅ 料金プランページ作成（/pricing）**
- 5メインプラン + AI Plus表示
- 月額/年額切り替え機能
- プラン比較表（8項目）
- FAQセクション（6項目）
- レスポンシブ対応（5→3→2→1カラム）

**✅ 無料予想ページ作成（/free-prediction）**
- 本日の開催情報表示
- 後半3レース予想（サンプル）
- レースカード機能（信頼度・オッズ・AIコメント）
- 買い目ロック（有料プラン誘導）
- 注意事項セクション

**✅ ThriveCart Webhook実装**
- `netlify/functions/thrivecart-webhook.js`
- 購入完了時: Airtable Create + SendGrid Email
- 解約時: Airtable Update + SendGrid Email
- Webhook署名検証（HMAC SHA256）
- **Zapier削減: $73.50/月節約**

**✅ メルマガ配信システム実装**
- 設計書: `NEWSLETTER_SYSTEM.md`
- Netlify Functions 5個:
  - create-broadcast.js
  - get-broadcasts.js
  - get-broadcast.js
  - send-test.js
  - send-broadcast.js
- 管理画面3ページ:
  - /admin/newsletter（一覧）
  - /admin/newsletter/new（新規作成）
  - /admin/newsletter/[id]（詳細・送信）
- 5層の二重送信防止機構
- 段階的送信システム（50→15,000件）

**✅ メルマガ移行システム設計**
- 設計書: `NEWSLETTER_MIGRATION.md`
- 配配メール→SendGrid移行計画（15,000件）
- 8段階移行（50→100→300→500→1000→3000→7000→15000）
- send_channelによる分離
- 4条件フィルタリング（plan_type=paid, status=active, unsubscribe≠true, send_channel=sendgrid）

**✅ 会員認証システム実装**
- 設計書: `AUTH_SYSTEM.md`
- Netlify Functions 4個:
  - send-magic-link.js（マジックリンク送信）
  - verify-magic-link.js（トークン検証・セッション作成）
  - get-session.js（セッション確認）
  - logout.js（ログアウト）
- ログインページ:
  - /login（メールアドレス入力）
  - /auth/verify（トークン検証）
- 認証ミドルウェア:
  - AuthCheck.astro（全管理画面に適用）
- セキュリティ:
  - HttpOnly/Secure/SameSite Cookie
  - トークン15分有効期限・単回使用
  - セッション7日間TTL（Netlify Blobs）

**❌ ThriveCart商品登録（未実施）**
- 5プラン設定
- PayPal決済設定
- Webhook URL設定
- Test Mode動作確認

---

## 📋 **次のステップ** 📋

### **【優先度高】Phase 2完了タスク**

- [ ] **Airtableテーブルセットアップ**
  - Customersテーブル拡張（plan_type, send_channel, source, migrated_at, last_sent_at, unsubscribe）
  - Broadcastsテーブル作成（broadcast_id, subject, body_html, status, stage, etc.）
  - BroadcastRecipientsテーブル作成（broadcast_id, email, status, sent_at, etc.）
  - AuthTokensテーブル作成（token, email, created_at, expires_at, used, etc.）
  - SendGrid_Paid_Active View作成（4条件フィルタ）

- [ ] **Netlify環境変数設定**
  - AIRTABLE_API_KEY
  - AIRTABLE_BASE_ID
  - SENDGRID_API_KEY
  - THRIVECART_WEBHOOK_SECRET

- [ ] **ThriveCart商品登録**
  - 5プラン設定（ライト/スタンダード/プレミアム/アルティメット/AI Plus）
  - PayPal決済設定
  - Webhook URL設定（https://keiba-intelligence.keiba.link/.netlify/functions/thrivecart-webhook）
  - Test Mode動作確認

- [ ] **認証システムテスト**
  - SendGridドメイン認証
  - マジックリンクメール送信テスト
  - ログイン→管理画面アクセステスト
  - ログアウトテスト

### **Phase 3: 管理機能実装（来週実装予定）**

- [ ] **予想管理画面作成**
  - prediction-converter.astro（特徴量データ→JSON変換）
  - Git自動コミット機能
  - プレビュー機能

- [ ] **結果管理画面作成**
  - results-manager.astro（結果入力→archiveResults.json生成）
  - 的中率・回収率自動計算
  - Git自動コミット機能

- [ ] **有料予想ページ作成**
  - プラン別買い目表示制御
  - AccessControl.astro実装
  - セッション認証連携

- [ ] **SEOページ自動生成**
  - 日別実績ページ（/results/2026/01/10）
  - 月別実績ページ（/results/2026/01）
  - コース別統計ページ

- [ ] **本番デプロイ・運用開始**
  - 全機能テスト
  - パフォーマンス確認
  - 監視設定

---

## 🔧 **開発コマンド** 🔧

### **基本コマンド**

```bash
# 作業ディレクトリに移動
cd "/Users/apolon/Library/Mobile Documents/com~apple~CloudDocs/WorkSpace/keiba-intelligence/astro-site"

# 開発サーバー起動
npm run dev

# ビルド
npm run build

# プレビュー
npm run preview

# 依存関係インストール
npm install

# 依存関係更新
npm update
```

### **Gitコマンド**

```bash
# 状態確認
git status

# 変更を追加
git add .

# コミット（コミットメッセージはテンプレートを使用）
git commit -m "🎨 [件名]

[詳細]

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"

# プッシュ
git push origin main

# ログ確認
git log --oneline

# リモート確認
git remote -v
```

---

## 📝 **コミットメッセージ規約** 📝

### **絵文字プレフィックス**

| 絵文字 | 用途 |
|--------|------|
| 🎉 | プロジェクト初期化 |
| ✨ | 新機能追加 |
| 🎨 | デザイン・スタイル |
| 🐛 | バグ修正 |
| 📝 | ドキュメント更新 |
| 🔧 | 設定ファイル変更 |
| ♻️ | リファクタリング |
| 🚀 | パフォーマンス改善 |
| 🔒 | セキュリティ修正 |
| 📊 | データ・ロジック追加 |

### **コミットメッセージテンプレート**

```bash
🎨 デザインシステム構築・トップページ作成

【デザインシステム】
- global.scss作成（AI-Powered Intelligence Dashboard）
  - ダークネイビー背景 + インテリジェントブルー
  - CSS変数によるカラーシステム
  - グリッドシステム（2/3/4カラム）

【トップページ】
- ヒーローセクション（グラデーション背景アニメーション）
- 特徴セクション（6つの特徴）
- 料金プランセクション（3プラン表示）

【技術仕様】
- ビルド時間: 1.42秒
- ページ数: 1ページ
- sitemap自動生成

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

## 🚨 **重要な注意事項** 🚨

### **データ保存設計**

**過去予想の保存:**
- **目的**: SEO対策
- **保存内容**: レース名のみ（最小限）
- **ファイルサイズ**: 1日0.5KB、1ヶ月15KB、10年1.8MB

**結果の保存:**
- **目的**: 信頼性アピール
- **保存内容**: 全レース的中・外れ記録 + 的中率・回収率
- **ファイルサイズ**: 1日3.6KB、1ヶ月108KB、10年13MB

### **データフロー（予想更新時）**

```
マコさん → 管理画面（prediction-converter）
  → 特徴量データ入力
  → JSON変換
  → Gitコミット（手動）
  → Netlify自動ビルド（1-2分）
  → サイト更新完了
```

### **データフロー（結果更新時）**

```
マコさん → 管理画面（results-manager）
  → 結果データ入力
  → archiveResults.json生成
  → Gitコミット（手動）
  → Netlify自動ビルド
```

---

## 💰 **月額コスト** 💰

| サービス | プラン | 月額 | 備考 |
|---------|--------|------|------|
| Netlify | Pro | $19 | Functions/Blobs含む |
| Airtable | Pro | $20 | 250,000件まで |
| ~~Zapier~~ | ~~Premium~~ | ~~$73.50~~ | **削減（Netlify Functionsで代替）** |
| SendGrid | Essential 100 | $0（無料枠） | 100,000通/月 |
| Claude | Pro | $20 | AI開発 |
| ChatGPT | Plus | $20 | AI開発 |
| **合計** | - | **$79（約¥11,850）** | **$73.50/月削減 🎉** |

**コスト削減内訳:**
- Zapier削減: $73.50/月 → Netlify Functions直接実装
- 10年間削減額: $8,820（約¥1,323,000）

---

## 📚 **参考プロジェクト** 📚

### **nankan-analytics**

**参考にする点:**
- 管理画面の予想データ変換システム（prediction-converter.astro）
- 結果管理システム（results-manager.astro）
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

## 🎯 **長期運用設計** 🎯

### **10年運用シミュレーション**

**前提条件:**
- 会員数: 100人（平均単価¥2,000/月）
- 月間売上: ¥200,000
- 月間コスト: ¥22,800
- 月間利益: ¥177,200

**10年間:**
- 総売上: ¥24,000,000
- 総コスト: ¥2,736,000
- **総利益: ¥21,264,000**

### **スケーラビリティ**

| 項目 | 10年後 | 上限 | 余裕度 |
|------|--------|------|--------|
| Airtable Customers | 1,000人 | 250,000件 | 99.6% |
| Airtable Predictions | 43,800件 | 250,000件 | 82.5% |
| Netlify ビルド時間 | 5分 | 25時間/月 | 99.7% |
| SendGrid 送信数 | 3,000通/月 | 100,000通/月 | 97% |

---

## 📖 **詳細設計書** 📖

**DESIGN.md参照:**
- プロジェクト概要
- 価格設定
- データベース設計（Airtable）
- データ保存設計（JSON）
- ThriveCart決済・Zapier自動化
- 認証システム（マジックリンク）
- SEO戦略
- デザインシステム
- 自動化フロー
- プロジェクト実装計画（2週間）

**NEWSLETTER_SYSTEM.md参照:**
- メルマガ配信システム設計
- 5層二重送信防止機構
- Airtableスキーマ（Broadcasts, BroadcastRecipients）
- Netlify Functions 5個の詳細
- 管理画面UI設計
- 送信フロー（draft → test → dry-run → confirm → send）

**NEWSLETTER_MIGRATION.md参照:**
- 配配メール→SendGrid移行計画（15,000件）
- 8段階移行戦略（50→15,000）
- 4条件フィルタリング（plan_type, status, unsubscribe, send_channel）
- send_channelによるチャネル分離
- Airtable View設計（SendGrid_Paid_Active）
- 初回メール特別対応

**AUTH_SYSTEM.md参照:**
- マジックリンク認証フロー（4ステップ）
- Netlify Functions 4個の詳細
- トークン管理（15分有効期限、単回使用）
- セッション管理（Netlify Blobs、7日間TTL）
- セキュリティ対策（HttpOnly/Secure/SameSite Cookie）
- ログインページUI設計

---

## 🔐 **環境変数（Netlify環境変数）** 🔐

**Netlify管理画面で設定（Site settings → Environment variables）:**

```bash
# Airtable（必須）
AIRTABLE_API_KEY=patxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AIRTABLE_BASE_ID=appxxxxxxxxxxxxxxx

# SendGrid（必須）
# 用途: マジックリンク、ウェルカムメール、メルマガ配信、解約通知
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# ThriveCart（必須）
# 用途: Webhook署名検証
THRIVECART_WEBHOOK_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# GitHub（Phase 3で必要）
# 用途: 管理画面からのGit自動コミット
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**重要な注意事項:**
- ❌ **BREVOは使用不可**（ギャンブル系サービスNG）→ SendGridのみ使用
- ✅ **SendGrid無料枠**: 100,000通/月（メルマガ15,000件 × 6回配信可能）
- ✅ **Netlify Blobs**: Pro版で自動有効化（セッション保存用）

**Airtable必須テーブル:**
1. Customers（顧客管理）
2. Broadcasts（メルマガ配信管理）
3. BroadcastRecipients（配信履歴）
4. AuthTokens（認証トークン）

---

## 🎊 **チェックリスト** 🎊

### **Phase 1: 基盤構築（100%完了 ✅）**
- [x] プロジェクト初期化
- [x] GitHub連携
- [x] デザインシステム構築
- [x] BaseLayout.astro作成
- [x] トップページ作成
- [x] ビルド・動作確認

### **Phase 2: コア機能実装（80%完了 🚀）**
- [x] Netlify連携・自動デプロイ設定
- [x] 料金プランページ作成（/pricing）
- [x] 無料予想ページ作成（/free-prediction）
- [x] ThriveCart Webhook実装（Zapier代替）
- [x] メルマガ配信システム実装
- [x] メルマガ移行システム設計
- [x] 会員認証システム実装（マジックリンク）
- [ ] Airtableテーブルセットアップ
- [ ] Netlify環境変数設定
- [ ] ThriveCart商品登録
- [ ] 認証システムテスト

### **Phase 3: 管理機能実装（0%）**
- [ ] 予想管理画面作成（prediction-converter）
- [ ] 結果管理画面作成（results-manager）
- [ ] 有料予想ページ作成
- [ ] SEOページ自動生成
- [ ] テスト決済（ThriveCart Test Mode）
- [ ] 本番デプロイ

---

**📅 最終更新日**: 2026-01-10
**🏁 Project Phase**: Phase 2コア機能実装中 🚀（80%完了）
**🎯 Next Priority**: Airtableテーブルセットアップ → Netlify環境変数設定 → ThriveCart商品登録
**📊 進捗率**: 60%完了（Phase 1: 100%、Phase 2: 80%、Phase 3: 0%）
**✨ 本日の成果**:
  - 料金プラン・無料予想ページ作成
  - ThriveCart Webhook実装（Zapier削減: $73.50/月）
  - メルマガ配信システム実装（5層二重送信防止、段階的送信）
  - メルマガ移行システム設計（配配メール→SendGrid 15,000件）
  - 会員認証システム実装（マジックリンク、Netlify Blobs、7日間セッション）

**🎉 主要成果**:
  - Netlify Functions: 12個実装（Webhook, Newsletter 5個, Auth 4個, etc.）
  - 設計書: 3個作成（NEWSLETTER_SYSTEM.md, NEWSLETTER_MIGRATION.md, AUTH_SYSTEM.md）
  - 管理画面: 3ページ実装（/admin/newsletter/*）
  - ログインページ: 2ページ実装（/login, /auth/verify）
  - コスト削減: $73.50/月（10年間で約¥1,323,000削減）

---

**作成者: Claude Code（クロちゃん）**
**協力者: マコさん**
