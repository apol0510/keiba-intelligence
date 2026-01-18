# KEIBA Intelligence

> AI-Powered Intelligence Dashboard for 南関競馬

## プロジェクト概要

**KEIBA Intelligence**は、南関東4競馬場（大井・川崎・船橋・浦和）の地方競馬予想プラットフォームです。

### 主要機能

- 🔮 AI予想システム（馬単買い目）
- 📊 データビジュアライゼーション（Chart.js - 的中率・回収率グラフ）
- 🎯 全レース的中・外れ記録の完全保存
- 💰 低価格帯プラン（¥4,980〜）
- 🤖 完全自動化（PayPal Direct + Netlify Functions + SendGrid）
- 🏆 買い目シミュレーター（馬単2点×100円）

### 技術スタック

- **フロントエンド**: Astro 5.16+ (SSR), Sass
- **ホスティング**: Netlify Pro
- **決済**: PayPal Direct（Webhook実装）
- **データベース**: Airtable Pro
- **バックエンド**: Netlify Functions (14個)
- **メール**: SendGrid Essential 100
- **可視化**: Chart.js v4.4.0

## ディレクトリ構造

```
keiba-intelligence/
├── astro-site/              # Astroプロジェクト
│   ├── src/
│   │   ├── pages/          # ページ
│   │   ├── components/     # コンポーネント
│   │   ├── layouts/        # レイアウト
│   │   ├── data/           # 予想・結果データ（JSON）
│   │   └── styles/         # スタイル
│   ├── public/             # 静的アセット
│   ├── netlify/
│   │   └── functions/      # サーバーレス関数
│   └── scripts/            # 自動化スクリプト
├── DESIGN.md               # 詳細設計書
└── README.md               # このファイル
```

## 開発コマンド

```bash
# 作業ディレクトリに移動
cd "/Users/apolon/Library/Mobile Documents/com~apple~CloudDocs/WorkSpace/keiba-intelligence/astro-site"

# 開発サーバー起動
npm run dev

# ビルド
npm run build

# プレビュー
npm run preview
```

## プラン構成

| プラン | 月額 | 年額 | 内容 |
|--------|------|------|------|
| フリー | ¥0 | - | 予想閲覧のみ |
| ライト | ¥2,980 | ¥29,800 | 後半3レース買い目 |
| スタンダード | ¥4,980 | ¥49,800 | 全レース馬単買い目 |
| プレミアム | ¥6,980 | ¥69,800 | 全レース三連複買い目 |
| アルティメット | ¥8,980 | ¥89,800 | 馬単+三連複+穴馬 |
| AI Plus | ¥19,800 | - | 1鞍超精密予想 |

## 📊 プロジェクト進捗

**全体進捗**: 73%完了 🚀

### Phase 1: 基盤構築（100%完了 ✅）
- [x] プロジェクト初期化・ディレクトリ構造作成
- [x] GitHub連携・自動デプロイ設定
- [x] Netlify連携（Functions/Blobs）
- [x] デザインシステム構築（AI-Powered Intelligence Dashboard）
- [x] BaseLayout.astro作成
- [x] トップページ作成

### Phase 2: コア機能実装（80%完了 🚀）
- [x] 料金プランページ（/pricing）
- [x] 無料予想ページ（/free-prediction）
- [x] PayPal Webhook実装（ハイブリッドアプローチ・重複排除機構）
- [x] メルマガ配信システム実装（5 Functions）
- [x] 会員認証システム実装（マジックリンク）
- [ ] Airtableテーブルセットアップ
- [ ] Netlify環境変数設定
- [ ] PayPal商品登録

### Phase 3: 管理機能実装（50%完了 🚀）
- [x] 予想管理画面（/admin/prediction-converter）
- [x] **結果管理画面（/admin/results-manager）**
- [x] **買い目シミュレーター（/results + Chart.js）**
- [ ] Gemini AI統合（次のタスク）
- [ ] LINE通知実装
- [ ] 有料予想ページ作成
- [ ] SEOページ自動生成
- [ ] 本番デプロイ

## 参考プロジェクト

**nankan-analytics** - 既存の競馬予想サイト
- 管理画面の予想データ変換システムを参考
- 月別ファイル分割設計を流用
- マジックリンク認証システムを流用

## ライセンス

Private Project

---

**作成日**: 2026-01-09
**最終更新**: 2026-01-18
**作成者**: Claude Code
**プロジェクトステータス**: Phase 3実装中（73%完了）
**Next Priority**: Gemini AI統合 → LINE通知実装
