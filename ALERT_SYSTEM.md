# 自動アラートシステム設計書

## 📋 概要

**目的**: keiba-intelligenceのアーカイブ反映状況を自動監視し、異常時にメール通知

**問題**:
- dispatch失敗時に結果が自動インポートされない
- 目視確認が必要で完全自動化ではない
- 手動実行が必要になる

**解決策**:
- 毎日0時（JST）に自動チェック
- 反映されていない日付を検出したら即座にアラートメール送信
- 定期チェックワークフロー失敗時にもアラート送信

---

## 🔧 実装内容

### **1. アーカイブ同期確認ワークフロー（verify-archive-sync.yml）**

**実行タイミング**: 毎日 0:00 JST（15:00 UTC 前日）

**処理フロー**:
```
1. 過去7日間の日付をループ
   ↓
2. keiba-data-sharedに結果データがあるかチェック
   ↓
3. アーカイブに反映されているかチェック
   ↓
4. 不一致があればアラートメール送信
```

**チェック対象**:
- JRA: 10レース以上の結果データ
- 南関: 12レース以上の結果データ

**アラート条件**:
- keiba-data-sharedに結果データが存在
- keiba-intelligenceのアーカイブに未反映

### **2. 定期チェックワークフロー失敗時アラート**

**対象ワークフロー**:
- `import-results-jra-daily.yml`
- `import-results-nankan-daily.yml`

**アラート条件**:
- ワークフローの任意のステップが失敗

---

## 📧 アラートメール仕様

### **件名**

| 種別 | 件名 |
|------|------|
| JRA未反映 | 🚨 JRA結果アーカイブ未反映検出 - keiba-intelligence |
| 南関未反映 | 🚨 南関結果アーカイブ未反映検出 - keiba-intelligence |
| JRA失敗 | 🚨 JRA結果自動インポート失敗 - keiba-intelligence |
| 南関失敗 | 🚨 南関結果自動インポート失敗 - keiba-intelligence |

### **本文（JRA未反映の例）**

```
マコさん、

JRA結果データがkeiba-intelligenceのアーカイブに反映されていません。

【未反映の日付】
2026-02-21 (36R), 2026-02-22 (36R)

【確認事項】
1. keiba-data-sharedには結果データが存在します
2. しかし、keiba-intelligenceのアーカイブに反映されていません

【手動実行コマンド】
cd /Users/apolon/Projects/keiba-intelligence
gh workflow run import-results-jra.yml -f date=YYYY-MM-DD

または、以下のURLから手動実行：
https://github.com/apol0510/keiba-intelligence/actions/workflows/import-results-jra.yml

【GitHub Actionsログ】
https://github.com/apol0510/keiba-intelligence/actions

---
このメールは自動送信されています。
ワークフロー: verify-archive-sync.yml
```

---

## ⚙️ 設定方法

### **1. GitHub Secrets設定**

**keiba-intelligenceリポジトリ**:

1. Settings → Secrets and variables → Actions
2. New repository secret
3. 以下のシークレットを追加:

| Name | Value | 用途 |
|------|-------|------|
| `ALERT_EMAIL` | マコさんのメールアドレス | アラート送信先 |
| `SENDGRID_API_KEY` | SendGrid APIキー | メール送信 |

### **2. SendGrid設定**

**既存のSendGrid APIキーを使用**（auth-system用と同じ）

**送信元アドレス**: `noreply@keiba-intelligence.netlify.app`

**Verified Sender設定**:
1. SendGrid管理画面 → Settings → Sender Authentication
2. Single Sender Verification
3. `noreply@keiba-intelligence.netlify.app` を追加

---

## 📊 監視範囲

### **過去7日間の日付をチェック**

**理由**:
- 週末の結果データが月曜日に反映されるケースに対応
- dispatch失敗が連続して発生した場合に検出
- 取りこぼしを確実に検出

**例**（2026-02-21 0時実行の場合）:
- 2026-02-20
- 2026-02-19
- 2026-02-18
- 2026-02-17
- 2026-02-16
- 2026-02-15
- 2026-02-14

---

## 🎯 期待効果

| 項目 | 修正前 | 修正後 |
|------|--------|--------|
| **異常検知** | 目視確認が必要 | **自動検知** |
| **通知** | なし | **即座にメール通知** |
| **確認頻度** | 不定期 | **毎日0時** |
| **対応** | 手動実行 | **手順をメールで案内** |

---

## 🔄 運用フロー

### **通常時（正常）**

```
毎日0時（JST）
  ↓
verify-archive-sync.yml 実行
  ↓
過去7日間チェック
  ↓
✅ All dates synchronized
  ↓
（メール送信なし）
```

### **異常時（未反映検出）**

```
毎日0時（JST）
  ↓
verify-archive-sync.yml 実行
  ↓
過去7日間チェック
  ↓
❌ 2026-02-21 未反映検出
  ↓
📧 アラートメール送信
  ↓
マコさんが手動実行
  ↓
gh workflow run import-results-jra.yml -f date=2026-02-21
  ↓
✅ アーカイブ反映
```

### **定期チェック失敗時**

```
毎日23:30（JST）
  ↓
import-results-jra-daily.yml 実行
  ↓
❌ ワークフロー失敗
  ↓
📧 アラートメール送信
  ↓
マコさんが原因調査・手動実行
```

---

## 📝 テスト方法

### **1. アーカイブ同期確認ワークフローのテスト**

```bash
cd /Users/apolon/Projects/keiba-intelligence
gh workflow run verify-archive-sync.yml
```

**確認**:
- GitHub Actions実行ログ
- アラートメール受信（未反映がある場合）

### **2. 定期チェックワークフローのテスト**

```bash
# JRA
gh workflow run import-results-jra-daily.yml

# 南関
gh workflow run import-results-nankan-daily.yml
```

**確認**:
- ワークフロー成功
- 未処理データがあれば自動インポート

---

## 🚨 トラブルシューティング

### **アラートメールが届かない**

**原因1**: `ALERT_EMAIL`が設定されていない
- Settings → Secrets → Actions → `ALERT_EMAIL`を確認

**原因2**: SendGrid APIキーが無効
- Settings → Secrets → Actions → `SENDGRID_API_KEY`を確認
- SendGrid管理画面でAPIキーが有効か確認

**原因3**: Verified Senderが未設定
- SendGrid管理画面 → Sender Authentication
- `noreply@keiba-intelligence.netlify.app` が認証済みか確認

### **アラートが多すぎる**

**原因**: keiba-data-sharedに結果データがあるのにアーカイブに反映されていない
- GitHub Actionsログを確認
- dispatch失敗の原因を調査
- 手動実行で未反映データを解消

---

## 📅 実装日

2026-02-21

---

**作成者**: Claude Code（クロちゃん）
**協力者**: マコさん
