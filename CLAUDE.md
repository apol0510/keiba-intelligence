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
作業ディレクトリ: /Users/apolon/Projects/keiba-intelligence/astro-site
Gitリポジトリ: https://github.com/apol0510/keiba-intelligence.git
親ディレクトリ: /Users/apolon/Projects/keiba-intelligence/
```

**⚠️ 重要**: 2026-01-23より `/Users/apolon/Projects/` に移動しました

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
- `CLAUDE.md`, `DESIGN.md`, `README.md`（親ディレクトリ）

#### **❌ 絶対禁止の操作**
- `/Users/apolon/Projects/nankan-analytics/` への一切のアクセス ⚠️
- `/Users/apolon/Projects/nankan-analytics-pro/` への一切のアクセス
- `/Users/apolon/Projects/nankan-beginner/` への一切のアクセス
- `/Users/apolon/Projects/nankan-course/` への一切のアクセス
- `/Users/apolon/Projects/keiba-matome-monorepo/` への一切のアクセス
- `/Users/apolon/Projects/keiba-nyumon/` への一切のアクセス
- `/Users/apolon/Projects/keiba-review-monorepo/` への一切のアクセス
- 親ディレクトリ `/Users/apolon/Projects/` の直接走査・検索

### **ファイル検索時の制約**

```bash
# ❌ 絶対禁止（親ディレクトリまで検索）
grep -r "pattern" /Users/apolon/Projects/

# ❌ 絶対禁止（相対パスで親に遡る）
cd ../
grep -r "pattern" ../

# ✅ 正しい方法（プロジェクト内のみ検索）
grep -r "pattern" /Users/apolon/Projects/keiba-intelligence/astro-site/
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
| 決済 | PayPal Direct | Webhook直接実装（円決済） |
| 顧客管理 | Airtable Pro | 4テーブル運用 |
| ~~自動化~~ | ~~Zapier Premium~~ | **削減（Functions直接実装）** |
| メール | SendGrid Essential 100 | 無料枠100,000通/月 |
| バックエンド | Netlify Functions (Node.js 20) | 12個実装済み |
| セッション管理 | Netlify Blobs | 7日間TTL |
| AI開発 | Claude Pro + ChatGPT Plus | 設計・実装支援 |

### **価格設定**

| プラン | 月額 | 年額 | 内容 |
|--------|------|------|------|
| フリー | ¥0 | - | 予想閲覧のみ（買い目なし） |
| プロ | ¥4,980 | ¥49,800 | 全レース馬単買い目 |

**将来追加予定:**
- **プロプラス**: ¥10,000/月 - 馬単+三連複（プロ会員のみ購入可能）

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

### **Phase 2: コア機能実装（85%完了 🚀）**

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

**✅ PayPal Webhook実装**
- `netlify/functions/paypal-webhook.js`
- ハイブリッドアプローチ（4段階処理）
  - CREATED → 仮登録（Status: pending）
  - ACTIVATED → 本登録（AccessEnabled: true、ウェルカムメール送信）
  - PAYMENT.SALE.COMPLETED → PaidAt更新 or AI Plus本登録
  - CANCELLED/SUSPENDED/EXPIRED → 権限剥奪
- 重複排除機構（ProcessedWebhookEventsテーブル）
- マジックリンク付きウェルカムメール
- **ThriveCart削除・初期費用$0**

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

**❌ PayPal商品登録（未実施）**
- PayPal Business管理画面で4サブスクプラン作成（ライト/スタンダード/プレミアム/アルティメット）
- AI Plus単品商品作成
- Webhook URL設定（https://keiba-intelligence.keiba.link/.netlify/functions/paypal-webhook）
- plan_id取得 → paypal-webhook.jsのplanMapping更新
- Test Mode動作確認

---

## 📋 **次のステップ** 📋

### **【優先度高】Phase 2完了タスク**

- [ ] **Netlify環境変数設定**
  - GITHUB_TOKEN（新規トークン設定済み：2026-01-23）
  - AIRTABLE_API_KEY
  - AIRTABLE_BASE_ID
  - SENDGRID_API_KEY

- [ ] **Airtableテーブルセットアップ**
  - Customersテーブル拡張（Email, 氏名, プラン, Status, PayPalSubscriptionID, 有効期限, AccessEnabled, PaidAt, WelcomeSentAt, CancelledAt, WithdrawalRequested）
  - ProcessedWebhookEventsテーブル作成（EventId, EventType, ProcessedAt, Status, CustomerEmail, UserPlan）
  - Broadcastsテーブル作成（broadcast_id, subject, body_html, status, stage, etc.）
  - BroadcastRecipientsテーブル作成（broadcast_id, email, status, sent_at, etc.）
  - AuthTokensテーブル作成（token, email, created_at, expires_at, used, etc.）

- [ ] **認証システムテスト**
  - SendGridドメイン認証
  - マジックリンクメール送信テスト
  - ログイン→管理画面アクセステスト
  - ログアウトテスト

### **Phase 3: 管理機能実装（開始・部分完了）**

- [x] **予想管理画面作成（完了）**
  - prediction-converter.astro（特徴量データ→JSON変換）✅
  - 全12レース一括生成機能 ✅
  - Git自動コミット・自動デプロイ機能 ✅
  - GitHub API連携（save-and-deploy-prediction.js）✅

- [x] **結果管理画面作成（完了）**
  - results-manager.astro（結果入力→全12R集計）✅
  - リアルタイム的中率・回収率自動計算 ✅
  - save-results.js（Git自動コミット・デプロイ）✅
  - /results（買い目シミュレーター・Chart.js統合）✅

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
cd "/Users/apolon/Projects/keiba-intelligence/astro-site"

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

### **⚠️ 予想データと結果データの同期（重要）**

**keiba-data-sharedとkeiba-intelligenceの役割分担:**

#### **keiba-data-sharedの役割**

**目的**: 競馬データの共有リポジトリ（SEO対策・データアーカイブ）

- **結果データを自由に保存できる**（予想データの有無に関わらず）
- 過去の結果データを大量に保存してSEO対策
- 中央競馬・南関競馬の両対応
- 全プロジェクトで共有可能

**ディレクトリ構造**:
```
nankan/
  predictions/2026/01/2026-01-26.json  # 予想データ（任意）
  results/2026/01/2026-01-26.json      # 結果データ（必須・SEO対策）
```

#### **keiba-intelligenceの役割**

**目的**: AI予想サイト（予想＋的中実績の表示）

- **予想データがある日付のみ的中判定を実行**
- 予想データがない結果データは自動的にスキップ（エラーにならない）
- 的中実績のみをarchiveResults.jsonに保存

#### **自動連携フロー**

```
keiba-data-shared（結果データPush）
  ↓
GitHub Actions: dispatch-results-intelligence.yml 起動
  ↓
【チェック1】12レース揃っているか確認
  ↓
✅ 12レース揃っている場合のみ
  ↓
repository_dispatch イベント送信（results-updated）
  ↓
keiba-intelligence の GitHub Actions 起動
  ↓
importResults.js 実行
  ↓
【チェック2】予想データが存在するか確認
  ├─ ✅ 予想データあり → 的中判定実行 → archiveResults.json更新
  └─ ⏭️  予想データなし → スキップ（正常終了）
```

#### **✅ スキップされるケース（正常動作）**

**importResults.jsは予想データが存在しない場合、スキップして正常終了します。**

```javascript
// importResults.js: Line 272-283（修正後）
try {
  prediction = loadPrediction(date);
} catch (error) {
  // 予想データがない場合はスキップ
  console.log(`⏭️  予想データが見つかりません: ${date}`);
  console.log(`   keiba-intelligenceでは的中判定をスキップします`);
  process.exit(0); // 正常終了（エラーではない）
}
```

**例: 1/26の結果をkeiba-data-sharedにPushした場合**

```
1. keiba-data-sharedに1/26結果をPush（予想データなし）
   ↓
2. keiba-intelligence の GitHub Actions 自動起動
   ↓
3. importResults.js 実行
   ↓
4. ⏭️  予想データが見つかりません: 2026-01-26
   ↓
5. スキップ（正常終了）
   ↓
6. ✅ GitHub Actions 成功（archiveResults.jsonは更新されない）
```

**つまり:**
- ✅ keiba-data-sharedには**結果のみ**を自由に保存できる（SEO対策）
- ✅ keiba-intelligenceは**予想がある日付のみ**的中判定を実行
- ✅ GitHub Actionsはエラーにならず正常終了

#### **📋 運用方法**

**1. SEO対策用の結果データ保存（予想なし）**

```bash
# keiba-data-sharedに過去の結果を保存
# → keiba-intelligenceには影響なし（スキップされる）
```

**2. 予想＋結果の的中判定（通常運用）**

```bash
# Step 1: 予想データをkeiba-data-sharedにPush
# → keiba-intelligenceに自動インポート

# Step 2: 結果データをkeiba-data-sharedにPush
# → keiba-intelligenceで自動的中判定 → archiveResults.json更新
```

#### **🎯 まとめ**

| 項目 | keiba-data-shared | keiba-intelligence |
|------|-------------------|-------------------|
| **役割** | データアーカイブ・SEO対策 | AI予想サイト・的中実績表示 |
| **予想データ** | 任意（あってもなくてもOK） | ある日付のみ処理 |
| **結果データ** | 必須（SEO対策で量産） | 予想がある日付のみ処理 |
| **自動連携** | 12レース揃ったらdispatch | 予想がない場合はスキップ |
| **エラー** | なし | なし（スキップで正常終了） |

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
# 用途: マジックリンク、ウェルカムメール、メルマガ配信
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Gemini AI（必須 - Priority 2で実装済み）
# 用途: AIチャットボット（全ページ右下ウィジェット）
# 取得方法: Google AI Studio (https://aistudio.google.com/app/apikey)
GEMINI_API_KEY=AIzaSyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# GitHub（Phase 3で必須 - prediction-converter.astro, results-manager.astro実装済み）
# 用途: 管理画面からのGit自動コミット・自動デプロイ
# 権限: repo（Contents: Read and Write）
# 取得方法: GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GITHUB_REPO_OWNER=apol0510
GITHUB_REPO_NAME=keiba-intelligence
GITHUB_BRANCH=main

# GitHub（keiba-data-shared用）- オプション
# 用途: results-manager.astroからkeiba-data-sharedリポジトリへの自動保存
# 権限: repo（Contents: Read and Write）
# 注意: GITHUB_TOKENが既にkeiba-data-sharedへのアクセス権を持つ場合は不要
# 専用トークンを使用する場合のみ設定
GITHUB_TOKEN_KEIBA_DATA_SHARED=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**重要な注意事項:**
- ❌ **BREVOは使用不可**（ギャンブル系サービスNG）→ SendGridのみ使用
- ✅ **SendGrid無料枠**: 100,000通/月（メルマガ15,000件 × 6回配信可能）
- ✅ **Netlify Blobs**: Pro版で自動有効化（セッション保存用）

**Airtable必須テーブル:**
1. Customers（顧客管理）
2. ProcessedWebhookEvents（Webhook重複排除）
3. Broadcasts（メルマガ配信管理）
4. BroadcastRecipients（配信履歴）
5. AuthTokens（認証トークン）

---

## 🎊 **チェックリスト** 🎊

### **Phase 1: 基盤構築（100%完了 ✅）**
- [x] プロジェクト初期化
- [x] GitHub連携
- [x] デザインシステム構築
- [x] BaseLayout.astro作成
- [x] トップページ作成
- [x] ビルド・動作確認

### **Phase 2: コア機能実装（85%完了 🚀）**
- [x] Netlify連携・自動デプロイ設定
- [x] 料金プランページ作成（/pricing）
- [x] 無料予想ページ作成（/free-prediction）
- [x] PayPal Webhook実装（ハイブリッドアプローチ・重複排除機構）
- [x] メルマガ配信システム実装
- [x] メルマガ移行システム設計
- [x] 会員認証システム実装（マジックリンク）
- [x] Gemini AIチャットボット実装（全ページ右下ウィジェット）
- [ ] Airtableテーブルセットアップ
- [ ] Netlify環境変数設定
- [ ] PayPal商品登録
- [ ] 認証システムテスト

### **Phase 3: 管理機能実装（85%）**
- [x] 予想管理画面作成（prediction-converter）
- [x] 結果管理画面作成（results-manager + 買い目シミュレーター）
- [x] keiba-data-shared（競馬データ共有リポジトリ）作成 ✅
- [x] 南関公式コピペ自動パース機能実装 ✅
- [x] GitHub自動Push機能実装 ✅
- [x] 有料予想ページ作成 ✅
- [x] 月別アーカイブページ実装 ✅
- [x] 自動的中判定システム実装（importResults.js）✅
- [x] GitHub Actions自動連携（予想・結果）✅
- [ ] SEOページ自動生成
- [ ] 本番デプロイ

---

**📅 最終更新日**: 2026-02-01
**🏁 Project Phase**: Phase 3管理機能実装 🚀（Phase 3: 85%完了）
**🎯 Next Priority**: Airtableテーブルセットアップ → SEOページ自動生成 → 本番デプロイ
**📊 進捗率**: 90%完了（Phase 1: 100%、Phase 2: 85%、Phase 3: 85%）
**🌐 本番URL**: https://keiba-intelligence.netlify.app/
**🔧 管理画面URL**: https://keiba-intelligence.netlify.app/admin/results-manager

**✨ 本日の成果（2026-02-01）**:
  - **importResults.js修正（予想データなしスキップ対応）** ✅
    - 予想データがない結果でもエラーにならず正常終了
    - keiba-data-sharedにSEO対策用の結果を自由に保存可能
    - GitHub Actions成功（archiveResults.jsonは更新されない）

  - **CLAUDE.md更新（予想・結果データ同期の詳細説明）** ✅
    - 「予想データと結果データの同期（重要）」セクション追加
    - keiba-data-sharedとkeiba-intelligenceの役割分担を明記
    - 自動連携フロー・スキップケースを詳細図解
    - 運用方法（SEO対策用・通常運用）を整理

**✨ 過去の成果（2026-01-31）**:
  - **adjustPrediction.js修正（対抗枠保持ロジック）** ✅
    - 本命15点以下の場合、本命と対抗をスワップ
    - 対抗枠を必ず保持する設計に変更
    - 2段買い目が崩れない安定化

  - **importResults.js修正（払戻金10倍バグ修正）** ✅
    - `* 10` を削除（的中は1点のみ）
    - 正しい払戻金・回収率計算
    - 例: ¥153,300 → ¥15,330、1277.5% → 127.8%

  - **月別アーカイブページ完成** ✅
    - /archive/YYYY/MM/ 構造実装
    - 月間サマリー統計表示（的中率・回収率・配当）
    - 日別・レース別的中実績表示
    - 買い目表示削除（シンプル1行表示）
    - 長期運用対応（10年で120ページ）

  - **的中実績リンク自動対応** ✅
    - archiveResults.json から最新データの年月を取得
    - 常に最新データがある月にリンク
    - 2月になっても1月データ表示（データ追加まで）

  - **GitHub Actions手動実行対応** ✅
    - workflow_dispatch に inputs.date 追加
    - 手動実行時の日付指定可能
    - デフォルト: 今日の日付（JST）

  - **デザイン調整** ✅
    - ヒーローセクションタイトル色変更
    - 極薄ブルー→ブルーグラデーション

**✨ 過去の成果（2026-01-23）**:
  - **keiba-data-shared（競馬データ共有リポジトリ）作成** ✅
    - GitHub公開リポジトリ: https://github.com/apol0510/keiba-data-shared
    - README.md、schema.json、CLAUDE.md、パーサー実装
    - 南関・中央競馬対応の統一フォーマット
    - 全プロジェクト共有の基盤完成
    - ディレクトリ構造: nankan/predictions/, nankan/results/
    - parser/parse-nankan-results.js（南関公式フォーマット自動パーサー）

  - **results-manager.astro更新（南関公式コピペ自動パース対応）** ✅
    - 南関公式サイト結果の自動解析機能
    - コピペ→自動パース→プレビュー→JSON出力
    - 対応競馬場: 船橋・大井・川崎・浦和
    - 非エンジニアスタッフ向けの超シンプルUI
    - エラーハンドリング・詳細ヒント表示
    - keiba-data-shared標準フォーマット対応

  - **GitHub自動Push機能実装（keiba-data-shared連携）** ✅ **NEW**
    - Netlify Function作成（save-to-keiba-data-shared.js）
    - 「🚀 保存してGit Push」ボタン実装
    - ワンクリックで全プロジェクト共有完了
    - リアルタイムステータス表示（保存中/成功/エラー）
    - GitHub API連携（contents API使用）
    - 完全自動化達成：南関公式コピペ → 解析 → ボタン1クリック → 全プロジェクト共有 🎉

  - **プロジェクト構成の整理** ✅
    - /Users/apolon/Projects/ に移動（iCloud Drive同期問題解消）
    - Gitリポジトリ再クローン・正常化

**✨ 過去の成果（2026-01-18）**:
  - Priority 1: 結果管理システム完全実装 ✅
    - results-manager.astro（全12R結果入力・的中判定）
    - save-results.js（GitHub自動コミット・デプロイ）
    - /results（買い目シミュレーター・Chart.js統合）
    - リアルタイム的中率・回収率計算機能
    - 全期間統計集計機能（的中率・回収率・払戻額）
    - パフォーマンス推移グラフ（Chart.js v4.4.0）

  - Priority 2: Gemini AIチャットボット完全実装 ✅
    - gemini-chat.js（Netlify Function、Gemini 1.5 Flash統合）
    - AIChat.astro（全ページ右下固定ウィジェット）
    - 最新予想・結果データ自動参照機能
    - 会話履歴保持機能
    - レスポンシブデザイン（モバイル対応）

**🎉 累積成果**:
  - **共有リポジトリ**: keiba-data-shared（全プロジェクト共有・南関中央対応・GitHub自動Push対応）
  - **Netlify Functions**: 14個実装（PayPal Webhook, Newsletter 5個, Auth 4個, Save-and-Deploy, Save-Results, Save-to-keiba-data-shared, Gemini-Chat）
  - **設計書**: 3個作成（NEWSLETTER_SYSTEM.md, NEWSLETTER_MIGRATION.md, AUTH_SYSTEM.md）
  - **管理画面**: 5ページ実装（/admin/newsletter/*, /admin/prediction-converter, /admin/results-manager）
  - **公開ページ**: 7ページ実装（トップ, 無料予想, 有料予想, 料金, 月別アーカイブ, ログイン, サイト概要）
  - **自動化システム**:
    - GitHub Actions自動連携（予想・結果インポート）
    - 自動的中判定システム（importResults.js）
    - 月別アーカイブ自動生成
  - **Chart.js統合**: パフォーマンス可視化完了 ✅
  - **データ共有基盤**: keiba-data-shared（競馬データ共有リポジトリ）完成 ✅
  - **完全自動化**: 南関公式コピペ → 解析 → ボタン1クリック → 全プロジェクト共有 → 自動的中判定 🎉
  - **コスト削減**: ThriveCart $690削減（買い切り費用）+ Zapier $73.50/月削減

---

**作成者: Claude Code（クロちゃん）**
**協力者: マコさん**
