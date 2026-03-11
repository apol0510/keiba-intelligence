# ⚠️ この workflows ディレクトリは使用されていません

## 実際に動作している workflows の場所

**親ディレクトリ**: `../../.github/workflows/`

すべての GitHub Actions workflows は親ディレクトリで管理されています。
このディレクトリ (`astro-site/.github/workflows/`) 内のファイルは**実行されません**。

## 本命 Workflows

| Workflow | ファイル | 説明 |
|---------|---------|------|
| **PRIMARY** | `import-results-on-dispatch.yml` | admin保存後の自動結果インポート |
| **SECONDARY** | `import-results-nankan-daily.yml` | 日次監視・バックアップ |

詳細は親ディレクトリの workflows を参照してください。

## 理由

monorepo 構造で、親ディレクトリの workflows が `working-directory: astro-site` を指定して実行しています。

---

**最終更新**: 2026-03-11
**作成者**: Claude Code
