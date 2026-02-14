# KEIBA Intelligence

> AI-Powered Intelligence Dashboard for 南関競馬 + 中央競馬（JRA）

## 🎯 プロジェクト概要

**KEIBA Intelligence**は、南関東4競馬場（大井・川崎・船橋・浦和）と中央競馬（JRA）全10場の予想プラットフォームです。

### 主要機能

- 🔮 **AI予想システム**（馬単買い目、南関＋中央両対応）
- 📊 **データビジュアライゼーション**（Chart.js - 的中率・回収率グラフ）
- 🎯 **全レース的中・外れ記録の完全保存**
- 💰 **買い切りプラン**（¥88,000永久アクセス、追加料金なし）
- 🤖 **完全自動化**（GitHub Actions + Netlify Functions + SendGrid）
- 🏆 **買い目シミュレーター**（2段階買い目調整：8点 or 12点）
- 💬 **Gemini AIチャットボット**（全ページ右下ウィジェット）
- 🔒 **データ検証システム**（再発防止策）

### 技術スタック

| カテゴリ | 技術 |
|---------|------|
| **フロントエンド** | Astro 5.16+ (SSR), Sass |
| **ホスティング** | Netlify Pro |
| **決済** | 銀行振り込み自動化（PayPal停止対応） |
| **データベース** | Airtable Pro（5テーブル） |
| **バックエンド** | Netlify Functions (10個) |
| **メール** | SendGrid Essential 100 |
| **メルマガ** | BlastMail API連携 |
| **可視化** | Chart.js v4.4.0 |
| **AI** | Google Gemini 1.5 Flash |
| **自動化** | GitHub Actions（7ワークフロー） |

## 📁 ディレクトリ構造

```
keiba-intelligence/
├── astro-site/                  # Astroプロジェクト
│   ├── src/
│   │   ├── pages/              # ページ
│   │   │   ├── prediction.astro              # 南関予想（有料）
│   │   │   ├── prediction-jra.astro          # 中央予想（有料）
│   │   │   ├── free-prediction.astro         # 南関無料予想
│   │   │   ├── free-prediction-jra.astro     # 中央無料予想
│   │   │   ├── results.astro                 # 南関結果
│   │   │   └── archive/[year]/[month].astro  # 月別アーカイブ
│   │   ├── components/         # コンポーネント
│   │   ├── layouts/            # レイアウト
│   │   ├── data/               # 予想・結果データ（JSON）
│   │   │   ├── predictions/    # 南関予想（YYYY-MM-DD-venue.json）
│   │   │   └── predictions/jra/ # 中央予想（YYYY/MM/YYYY-MM-DD.json）
│   │   ├── utils/              # ユーティリティ
│   │   └── styles/             # スタイル
│   ├── public/                 # 静的アセット
│   ├── netlify/
│   │   └── functions/          # サーバーレス関数（10個）
│   └── scripts/                # 自動化スクリプト
│       ├── importPrediction.js         # 南関予想インポート
│       ├── importPredictionJra.js      # 中央予想インポート
│       ├── importResults.js            # 南関結果インポート
│       ├── importResultsJra.js         # 中央結果インポート
│       └── utils/
│           ├── validatePrediction.js      # データ検証
│           └── validatePrediction.test.js # 自動テスト
├── DESIGN.md                   # 詳細設計書
├── CLAUDE.md                   # 開発ログ・進捗管理
├── DATA_VALIDATION.md          # データ検証システム説明
└── README.md                   # このファイル
```

## 🚀 開発コマンド

```bash
# 作業ディレクトリに移動
cd "/Users/apolon/Projects/keiba-intelligence/astro-site"

# 開発サーバー起動
npm run dev

# ビルド
npm run build

# プレビュー
npm run preview

# データインポート
npm run import:prediction        # 南関予想インポート
npm run import:prediction:jra    # 中央予想インポート
npm run import:results           # 南関結果インポート
npm run import:results:jra       # 中央結果インポート

# テスト
npm run test:validation          # データ検証テスト
```

## 💰 料金プラン

| プラン | 価格 | 内容 |
|--------|------|------|
| **フリー** | ¥0 | 予想閲覧のみ（上位5頭、買い目なし） |
| **買い切り** | **¥88,000（永久）** | 南関＋中央、全レース馬単買い目、永久アクセス、追加料金なし |
| **年払い** | ¥66,000/年 | 南関＋中央、全レース馬単買い目（月額換算¥5,500） |
| 月払い南関 | ¥12,000/月 | 南関4場のみ（割高・非推奨） |
| 月払い中央 | ¥12,000/月 | JRA全10場のみ（割高・非推奨） |

**おすすめプラン**:
- **買い切りプラン（¥88,000）**: 50年利用で月額換算¥147、AIは毎日進化、追加料金なし
- **年払いプラン（¥66,000）**: 月額換算¥5,500、年間¥78,000お得

## 📊 プロジェクト進捗

**プロジェクトステータス**: 🚀 **運用中（本番環境）**

**本番URL**: https://keiba-intelligence.netlify.app/

**全体進捗**: **100%完了** ✅

### Phase 1: 基盤構築（100%完了 ✅）
- [x] プロジェクト初期化・ディレクトリ構造作成
- [x] GitHub連携・自動デプロイ設定
- [x] Netlify連携（Functions/Blobs）
- [x] デザインシステム構築（AI-Powered Intelligence Dashboard）
- [x] BaseLayout.astro作成
- [x] トップページ作成

### Phase 2: コア機能実装（100%完了 ✅）
- [x] 料金プランページ（/pricing）
- [x] 無料予想ページ（/free-prediction, /free-prediction-jra）
- [x] 有料予想ページ（/prediction, /prediction-jra）
- [x] ~~PayPal Webhook実装~~ → 銀行振り込み自動化に変更
- [x] ~~Zapier連携~~ → Netlify Functions直接実装（コスト削減$73.50/月）
- [x] メルマガ配信システム（BlastMail API連携）
- [x] 会員認証システム（マジックリンク）
- [x] Gemini AIチャットボット（全ページ右下ウィジェット）
- [x] Netlify環境変数設定完了
- [x] Airtableテーブルセットアップ完了

### Phase 3: 自動化システム実装（100%完了 ✅）
- [x] ~~予想管理画面~~ → keiba-data-shared完全自動化
- [x] ~~結果管理画面~~ → GitHub Actions自動連携
- [x] 買い目シミュレーター（/results + Chart.js）
- [x] 月別アーカイブページ（/archive/YYYY/MM, /archive-jra/YYYY/MM）
- [x] 自動的中判定システム（2段階買い目調整：8点 or 12点）
- [x] GitHub Actions自動連携（予想・結果、南関・中央両対応）
- [x] 本番デプロイ完了

### Phase 4: 品質保証・再発防止（100%完了 ✅）
- [x] データ検証システム実装（validatePrediction.js）
- [x] 自動テスト追加（validatePrediction.test.js、6テストケース）
- [x] 中央競馬（JRA）role保持修正
- [x] 南関予想にも検証追加
- [x] ドキュメント整備（DATA_VALIDATION.md）

## 🔄 自動化フロー

### 予想データ自動更新（南関・中央）

```
keiba-data-shared（予想データPush）
  ↓
GitHub Actions（自動実行）
  ↓
【中央のみ】会場別ファイル検出 → merge-jra-predictions.js実行 → 統合ファイル生成
  ↓
repository_dispatch イベント送信
  ↓
keiba-intelligence の GitHub Actions 起動
  ↓
importPrediction.js / importPredictionJra.js 実行
  ↓
データ検証（validatePrediction）
  ├─ ✅ 検証成功 → 保存
  └─ ❌ 検証失敗 → エラー中断（保存しない）
  ↓
Git自動コミット・自動デプロイ
  ↓
サイト更新完了（1-2分）
```

### 結果データ自動更新（南関・中央）

```
keiba-data-shared（結果データPush）
  ↓
GitHub Actions（12レース揃ったか確認）
  ├─ ✅ 12レース揃っている → repository_dispatch送信
  └─ ⏭️  未完 → スキップ
  ↓
keiba-intelligence の GitHub Actions 起動
  ↓
importResults.js / importResultsJra.js 実行
  ├─ 予想データ存在チェック
  ├─ ✅ 予想あり → 的中判定実行 → archiveResults.json更新
  └─ ⏭️  予想なし → スキップ（正常終了）
  ↓
Git自動コミット・自動デプロイ
  ↓
サイト更新完了
```

## 🛡️ データ検証システム（再発防止策）

**実装日**: 2026-02-14

**目的**: role（役割）誤変換問題の再発防止

**検証項目**:
- 本命: 1頭のみ
- 対抗: 1頭のみ
- 単穴: 0〜1頭
- 連下最上位: 0〜1頭
- 役割名: 許可リストチェック
- PT値: 整合性チェック（警告のみ）

**詳細**: `DATA_VALIDATION.md` 参照

## 💵 月額コスト

| サービス | プラン | 月額 |
|---------|--------|------|
| Netlify | Pro | $19 |
| Airtable | Pro | $20 |
| SendGrid | Essential 100 | $0（無料枠） |
| Claude | Pro | $20 |
| ChatGPT | Plus | $20 |
| **合計** | - | **$79（約¥11,850）** |

**コスト削減**:
- Zapier削減: $73.50/月 → Netlify Functions直接実装
- 10年間削減額: $8,820（約¥1,323,000）

## 📚 関連ドキュメント

- **DESIGN.md**: 詳細設計書（657行）
- **CLAUDE.md**: 開発ログ・進捗管理（最新状態）
- **DATA_VALIDATION.md**: データ検証システム説明
- **BET_POINT_LOGIC.md**: 買い目点数ロジック仕様書

## 🔗 リンク

- **本番サイト**: https://keiba-intelligence.netlify.app/
- **GitHubリポジトリ**: https://github.com/apol0510/keiba-intelligence
- **keiba-data-shared**: https://github.com/apol0510/keiba-data-shared

## 📝 ライセンス

Private Project

---

**作成日**: 2026-01-09
**プロジェクト完成日**: 2026-02-14
**最終更新**: 2026-02-14
**作成者**: Claude Code（クロちゃん）
**プロジェクトステータス**: 🚀 **運用中（100%完了）**
