# KEIBA Intelligence

> AI-Powered Intelligence Dashboard for 南関競馬

## プロジェクト概要

**KEIBA Intelligence**は、南関東4競馬場（大井・川崎・船橋・浦和）の地方競馬予想プラットフォームです。

### 主要機能

- 🔮 AI予想システム（馬単・三連複）
- 📊 データビジュアライゼーション（的中率・回収率グラフ）
- 🎯 全レース的中・外れ記録の完全保存
- 💰 低価格帯プラン（¥2,980〜）
- 🤖 完全自動化（ThriveCart + Zapier + SendGrid）

### 技術スタック

- **フロントエンド**: Astro 5.16+, Sass
- **ホスティング**: Netlify Pro
- **決済**: ThriveCart + PayPal
- **データベース**: Airtable Pro
- **自動化**: Zapier Premium
- **メール**: SendGrid Essential 100

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

## 実装計画

### Phase 1（Week 1）
- [x] プロジェクト初期化
- [x] ディレクトリ構造作成
- [ ] GitHub連携
- [ ] Netlify連携
- [ ] デザインシステム構築
- [ ] 認証システム実装
- [ ] コアページ作成

### Phase 2（Week 2）
- [ ] 管理画面作成
- [ ] SEOページ自動生成
- [ ] テスト・デプロイ

## 参考プロジェクト

**nankan-analytics** - 既存の競馬予想サイト
- 管理画面の予想データ変換システムを参考
- 月別ファイル分割設計を流用
- マジックリンク認証システムを流用

## ライセンス

Private Project

---

**作成日**: 2026-01-09
**作成者**: Claude Code
**プロジェクトステータス**: 初期開発中
