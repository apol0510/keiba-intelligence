# Architecture and Operational Decisions

> 本書は **KEIBA Intelligence（KI）の設計・運用判断の正本**である。
> 記録は **リポジトリ内の証拠（コード / 文書 / commit / PR）に裏付けられたもののみ**とする。
> 採用されているが理由が記録されていない判断は、理由を創作せず
> 「履歴上は採用済みだが理由は未確認」と明記する。
> 初版作成: 2026-07-20
>
> **本書は PR #69 で新規追加された、KI リポジトリにおける設計・運用判断の正本である。**

---

## 2026-08-28 — 大改修の方針を確定する（無料開放 / 文章化 / Stripe / サーバー側認可 / KMA / ライトデザイン）

### Status
Accepted（`feat/ki-renewal-2026-08`。スコープの正本は `docs/RENEWAL_2026_08.md`）

### Context
現行の予想画面は数値（PT・特徴量・期待値）中心で機械的に見え、無料訪問者に価値が伝わっていない。
課金は銀行振込のみで単価が高く（買い切り ¥88,000 / 年払い ¥66,000）、新規の入口が重い。
メルマガの自動配信経路は KI 側に存在しない。
加えて 2026-08-17 の監査で、**有料買い目が未認証のまま HTTP レスポンスに含まれている**ことが
本番で再現確認されている（A-1〜A-5）。

### Decision

1. **無料開放は「印と買い目」だけを閉じる**（仕様所有者確定・U-1）。
   未登録でも馬柱・過去走・特徴量・**文章（AI 短評 / レース展望）**・展開予想を全頭ぶん公開する。
   無料会員で印（役割・PT・PT 順の並び）を開き、有料で買い目を開く。
2. **文章化は決定論層を主、LLM 層を従とする二層構造にする**。
   `raceNarrative.js`（純関数・描画時同期計算）が必ず文章を出し、Gemini は取込時バッチで
   レース単位の要約を足すだけにする。閲覧時の外部 API 依存をゼロにする。
3. **課金は Stripe 月額を主導線にし、価格をコードに書かない**。
   Price ID を env で注入し、表示価格は Stripe API から取得する。取得失敗時は「準備中」と出す。
4. **サーバー側認可（署名 Cookie ＋ 非権限者には描画しない）を Stripe の前提条件として同時に実装する**。
5. **メルマガは KMA（`keiba-marketing-automation`）で配信する**。KI 側に配信エンジンを作らない。
   KI 側は enroll イベントの送出と素材生成のみを担い、既定 disabled で入れる。
6. **デザインはライト基調＋競馬新聞の枠色**に転換する（仕様所有者確定・U-2）。

### Rationale

- **1**: 文章は「このサイトは分かっている」と伝える最も強い手段であり、出し惜しみすると
  無料の価値実感が生まれない。一方で印と買い目は結論であり、結論だけを段階的に開けば
  登録・課金の動機が残る。無料開放でアクセスが増えるほど転換の母数が増える。
- **2**: 閲覧のたびに LLM を呼ぶ設計は、無料開放（＝アクセス増）と両立しない。
  決定論層があれば LLM 障害時も紙面が壊れず、出力が検証可能で再現する。
- **3**: 価格が未確定（U-3）である以上、コードに金額を書くと必ず二重管理になる。
  Stripe を金額の単一真実源にすれば、価格変更にデプロイが要らない。
- **4**: 買い目が未認証で読める状態のまま課金を始めると、有料の価値が成立しない。
  是正は Stripe 導入の前提条件であって、独立した任意タスクではない。
- **5**: KMA は二重送信防止・頻度制御・解除・ブランド誤送信防止をすでに設計として持つ。
  KI 側に同等品を作れば仕様が二重化し、必ず乖離する。
  KMA には `keiba-intelligence` ブランドが既に登録済みで、`signup-enroll` の入口も実装済みである。

### Alternatives Considered

- **無料を上位5頭までに絞り、全頭は登録後にする** — 却下（U-1 で仕様所有者が全頭開放を選択）。
  未登録時点の価値実感が弱く、本改修の最重要目的に反する。
- **文章を毎回 Gemini で生成する** — 却下。コスト・レイテンシ・再現性が無料開放と両立しない。
- **価格をコードに定義する** — 却下。U-3 により価格は後決めであり、二重管理になる。
- **KI 側に配信エンジンを新設する** — 却下。KMA と仕様が二重化する。
- **認可是正を後回しにして Stripe を先に入れる** — 却下。有料価値が成立しない。
- **既存有料会員のために猶予期間つきの二重判定を置く** — 却下（U-4: 既存客の互換維持は
  最優先要件ではないと仕様所有者が明示）。ただし Airtable の既存 PlanType からの写像は
  低コストなので実装する（誤って上位扱いされないための写像を含む）。

### Consequences

- 未認証のレスポンスから印・PT・買い目の markup が消える。SEO 上のインデックス対象が変わる
  （馬柱と文章は残るため、むしろテキスト量は増える）。
- `SESSION_SIGNING_SECRET` / `STRIPE_*` / `KMA_*` という新規 env が必要になる。
  **未設定時は全員 guest / 課金導線は「準備中」/ KMA は no-op** に倒れる（fail-closed）。
- KMA 側に未完の依存が残る（KI 向け `contentUrls` / `plans` / シーケンス本文 / `race` 設定）。
  これらは **別リポジトリの変更**であり、本改修では実施せず依存として記録する。
- デザイントークンをライトへ置換するため、トークンを参照していないハードコード色の
  洗い出しが必要になる。

### Revisit Conditions

- 価格が確定した場合（U-3）。Stripe 側の Price を作成し env に ID を入れる運用へ移る。
- KMA の自動化フラグを有効化する場合（高リスク境界・別承認）。
- 無料開放の範囲を変更する場合（U-1 の再確定が前提）。

### Evidence

- `docs/RENEWAL_2026_08.md`（本改修の正本）
- 2026-08-28 の仕様所有者回答（U-1〜U-4。同書 §2）
- 2026-08-17 監査 A-1〜A-5（`docs/progress.md`）
- KMA 実装の read-only 確認: `brands/index.js` の `keiba-intelligence` ブロック、
  `netlify/functions/signup-enroll.js`（POST 限定・admin token・二重フラグ・eventId 冪等）

---

## 2026-07-20 — 契約外の `computerIndex` を有効値として使わない（fail-closed）

### Status
Accepted（マージ後は `main` 上の正本となる）

### Context
`keiba-data-shared` の JRA racebook には、PDF 由来 XML の「人気指数」列が `computerIndex` として
書き込まれていた期間がある。この列は埋め込みフォントの PUA 文字で描画されるため、生成側の
PUA 除去で桁が落ち、**1〜9 の残骸だけが真コンピ指数を騙って残っていた**。
生成側の恒久対策は keiba-data-shared-admin PR #152 で行われた。

本リポジトリは analytics-keiba と異なり **`sourceComputerIndex` を持たない**。
racebook の値を直接使うため、偽値が次の2経路にそのまま入っていた。

1. `normalizePrediction.js` の role/rawScore 判定（`parseInt(horse.computerIndex || '0')`）
2. JRA 予想3画面（`prediction/jra/index.astro`, `free-prediction/jra/[date].astro`,
   `free-prediction/jra/index.astro`）の「総合pt」バッジ。ガードが `null` / 空だけだったため、
   **偽値 1/4/8 が 総合pt 11/14/18 として実際に表示されていた**。

上流の修正は将来データにしか効かない。**shared に既に保存済みの不良データ**（20日・44ファイル）と
**本リポジトリに既に取り込み済みのデータ**は残るため、consumer 側の防御が別途必要である。

### Decision
**`computerIndex` の有効値を 10–99 の整数に限定し、契約外は「値なし」として fail-closed に扱う。**

- 単一定義を `astro-site/src/utils/computerIndexContract.js` に置く
- role/rawScore 判定・3画面の総合pt バッジ・取込境界4箇所に同じ契約を適用する
- **契約外の値を `0` / `10` / `50` 等へ置換しない。AI 補完もしない。** 値なしとして扱うだけ

有効域 10–99 は新設値ではなく、keiba-data-shared-admin の
`netlify/lib/computer-index-contract.mjs` / `validate-computer-racebook-join.mjs` および
analytics-keiba の `>= 10` スケールガードに一致させたものである。

### Rationale
- 偽値は欠損より有害である。`null` は既存ガードが「値なし」として扱えるが、`1/4/8` は
  truthy かつ有限値のため**ガードをすり抜けて誤った表示・誤った role 判定になる**。
- 表示だけを直すと role 判定に偽値が残り、role だけを直すと画面に偽値が残る。
  同一契約を両方へ当てるのが最小で確実である。
- 有効域を独自に決めず既存契約に合わせることで、consumer contract を壊さない。

### Alternatives Considered
- **上流修正（PR #152）だけで足りるとする** — 却下。既存 shared 不良データと取込済みデータに効かない。
- **`sourceComputerIndex` を本リポジトリにも導入する** — 却下（本 PR では）。
  computer 正本の併読という新しい取込経路が要り、影響範囲が大きい。
  契約ゲートだけで「偽値を使わない」目的は達成できる。
- **契約外値を 0 とみなして明示的に代入する** — 却下。`0` は「コンピ指数 0」という別の意味を持ちうるため、
  値なし（`null`）と区別できなくなる。

### Consequences
- 不良データ期間の JRA 予想では総合pt バッジが**表示されなくなる**（誤った値を出すよりよい）。
  上流のバックフィルが完了すれば、正しい値で再表示される。
- role/rawScore の実挙動は現行と同じ（`COMPI_MIN=45` に対し 1〜9 も `null` も 0 になるため）。
  変わるのは**意図の明示と、閾値変更時の安全性**である。
- 有効値（10–99）の表示・判定は一切変わらない。買い目・料金・UI 仕様は変更していない。

---

## 2026-07-20 — 自律完遂運用のための正本ドキュメント基盤（spec / progress / decisions）を採用する

### Status

採用（PR #69 で新規導入）

### Context

本リポジトリには `README.md` / `DESIGN.md` / `CLAUDE.md` / `BET_POINT_LOGIC.md` / `docs/` 配下の各文書など
多数の文書が存在するが（本 PR 以前は `docs/` 配下 10 本）、**現在のスコープ・進捗・未確定事項を一箇所で示す文書がなかった**。
そのため、(a) `README.md` が「全体進捗 100%完了」、`NEXT_SESSION.md` が 2026-01-18 時点、
`DESIGN.md` が初期設計のまま残る一方で、(b) 実際の到達点は git 履歴と PR 履歴にしかない、
という状態になっていた。セッションをまたいだ作業再開時に、どの文書を信じるべきか判断できない。

### Decision

- `docs/spec.md`（仕様・境界の正本）、`docs/progress.md`（進捗の正本）、`docs/decisions.md`（設計判断の正本）を新設する。
- `CLAUDE.md` に Autonomous Delivery Workflow ブロックを追記し、運用ルールの正本とする。
- **既存のドメイン文書を置き換えない**。`BET_POINT_LOGIC.md`（買い目点数）、`docs/DATA_FORMAT.md`（データ形式）、
  `docs/RESULTS_SYSTEM_ARCHITECTURE.md`（結果システム）、`docs/INTELLIGENCE_DISPLAY_SPEC.md` /
  `docs/ui-cross-plan-regression-policy.md`（表示仕様）は各領域の正本のままとし、`docs/spec.md` は参照に留める。
- `DESIGN.md` は「歴史的資料（2026-01-09 時点の初期設計）」として位置づけ、現行仕様の根拠に使わない。

### Rationale

- 領域別正本を `docs/spec.md` に取り込むと、同じ仕様が 2 箇所に存在し将来必ず乖離する。
- 一方で「どの文書が現行か」を示す索引がないことが今回の混乱の原因であるため、**索引と境界だけを新設**するのが最小の解決になる。
- 証拠のない内容を推測で埋めると、文書が新たな誤情報源になる。よって未確定は「未確定」「証拠未確認」と明示する。

### Alternatives Considered

1. **`DESIGN.md` を全面改訂して単一の設計書にする** — 713 行の初期設計を現行に合わせて書き換える作業は本タスクのスコープ（4 ファイル限定）を超え、既存参照リンクも壊す。不採用。
2. **`CLAUDE.md` だけを更新し新ファイルを作らない** — `CLAUDE.md` は本 PR 以前の時点で既に 667 行あり、運用ルール・仕様・進捗・環境変数が混在している。役割分離が進捗追跡の前提であるため不採用。
3. **文書を作らず git 履歴と PR に委ねる** — 未確定事項・未整理ブランチ・文書間矛盾が引き継がれず、同じ調査を毎セッション繰り返すことになる。不採用。

### Consequences

- 今後、仕様変更は `docs/spec.md`、進捗は `docs/progress.md`、判断は `docs/decisions.md` に反映する運用コストが発生する。
- `CLAUDE.md` 内の旧記述（「メインレース10点ロジック」節など）と現行仕様の矛盾は **本 PR では解消していない**。
  既存ルールを削除・弱体化しない制約のため、`docs/progress.md` の Remaining と Open Questions に持ち越した。
- ソースコードの挙動は一切変わらない。

### Revisit Conditions

- `CLAUDE.md` の記述量がさらに増え、運用ルール以外が混在し続ける場合。
- `docs/spec.md` と領域別正本の間で記述が重複し始めた場合（重複はその都度領域別正本へ寄せる）。

### Evidence

- 本 PR で追加された `docs/spec.md` / `docs/progress.md` / `docs/decisions.md` / `CLAUDE.md` の差分
- 既存文書: `README.md`（「全体進捗 100%完了」）、`NEXT_SESSION.md`（作成日 2026-01-18）、`DESIGN.md`（作成日 2026-01-09）、`CLAUDE.md`（最終更新 2026-04-08 と自称）

---

## 2026-07-02 — 馬単を F3 方向ルールへ変更し、投資点数を全レース 5 点固定にする

### Status

採用・現行（main にマージ済み）

### Context

それ以前の投資点数は払戻から逆算する可変方式（`getBetPoints`、旧 6/8/10/12 点）を用いており、
DP（ダイナミックポイント）・165% 目標・200% 上限といった加工が入っていた。
また的中判定は双方向（軸→相手／相手→軸を常に両方カウント）で行われていた。

### Decision

`BET_POINT_LOGIC.md` に定義されたとおり、

- 的中判定を `src/utils/umatanHit.js` の `checkUmatanHit(bettingLine, result, reverseTopK)` に集約（南関・JRA 共通の単一源）。
- **メインレース**: `reverseTopK = 0`。本命軸 → 評価上位 5 頭への **一方向のみ 5 点**。逆方向なし・抑えなし。
- **通常レース**: `reverseTopK = 3`。各軸 → 相手全頭への前進 + 評価上位 1〜3 位のみ逆方向を追加。4 位以下は前進のみ。抑えなし。
- **投資点数は全レース 1 レース 5 点固定**（1 点 100 円）。`betAmount = 実レース数 × 5 × 100`。
- DP・165% 目標・200% 上限を廃止。**的中候補は全件を公開実績に算入し、高配当も除外しない**。
- 南関と JRA に同一ロジックを適用（カテゴリ別ロジック禁止）。

### Rationale

`BET_POINT_LOGIC.md` の「設計原則」に記載されている理由:

- 払戻を加工しない（DP・目標回収率・上限を置かない）ことで、公開する回収率を実払戻ベースの恒等式
  `returnRate = totalPayout / betAmount × 100` に一致させる。
- 実レース数ベースで算出し、固定 12R 前提を禁止する（JRA は複数会場が並走するため）。
- 南関と JRA でロジックを分けない。

> 「一方向 5 点 / 逆方向は上位 3 位まで」という方向ルールそのものを **なぜこの配分にしたか** の根拠は、
> `BET_POINT_LOGIC.md`・PR #65 本文・commit メッセージのいずれにも記載がない。
> この部分については **履歴上は採用済みだが理由は未確認**。

### Alternatives Considered

- **可変点数方式（旧 6/8/10/12 点、払戻由来ヒューリスティック）** — `BET_POINT_LOGIC.md` が明示的に「廃止」と記載。
- **双方向一律判定（旧 `checkUmatanHit` の挙動）** — `CLAUDE.md`「メインレース10点ロジック」節が想定していた方式。F3 導入で置き換えられた（ただし当該節は文書上に残存。`docs/progress.md` Open Questions Q1）。
- **購入点数を実買い目ユニーク数へ接続する案（Phase 1/2）** — 2026-07-01 に検討され、Phase 2（PR #63）は CLOSED、Phase 1（PR #62）は PR #64 で巻き戻された（下記の別エントリ参照）。

### Consequences

- 過去 archive も新仕様で再判定・再計算する必要が生じた（PR #68。下記の別エントリ）。
- `scripts/umatanHit.test.mjs` が archive を実データとして再計算し、5 点固定・全候補公開・恒等式・冪等性を継続検証する。
- 表示側は方向別 2 行表示へ変更され（PR #66）、その後方向バッジは削除された（PR #67）。
- `race.betPoints`（=5）は **回収率計算上の投資基準**であり、表示買い目の実点数とは分離した概念になった（`BET_POINT_LOGIC.md` の注記）。
- `CLAUDE.md` の「メインレース10点ロジック」節が現行と矛盾したまま残る副作用が発生している。

### Revisit Conditions

- 商品仕様（点数・課金・公開実績の見せ方）が変更される場合。
- 恒等式・冪等性の検証（`scripts/umatanHit.test.mjs`）が破綻した場合。

### Evidence

- `BET_POINT_LOGIC.md`（適用範囲 / 投資点数 / 的中判定 F3 / 出力フィールド / 設計原則）
- `astro-site/src/utils/umatanHit.js`（`reverseTopK` 実装とヘッダコメント）
- `astro-site/scripts/umatanHit.test.mjs`（5 テスト、2026-07-20 実行時 pass）
- commit `f1ed5e0` / PR #65（MERGED 2026-07-02T01:35:19Z）、PR #66（#66 MERGED）、PR #67（MERGED）
- ブランチ `feat/ki-umatan-f3` の元コミット `80d9548` / `945a5fd`

---

## 2026-07-02 — 既存 archive を F3 判定・5 点固定で再計算する（bettingLines と払戻元は不変）

### Status

採用・実施済み（PR #68 MERGED）

### Context

F3 導入は新規取込分にのみ適用されるため、過去の `archiveResults.json` /
`archiveResultsJra.json` は旧判定・旧投資額のまま残り、公開している通算回収率が新仕様と一致しない状態になった。

### Decision

保存済みの `bettingLines` を KI 評価順として **再判定** し、以下のフィールドのみ更新する。

- race 単位: `isHit` / `hitLines` / `betPoints`
- 開催単位: `hitRaces` / `missRaces` / `hitRate` / `totalPayout` / `betPointsPerRace` /
  `totalBetPoints` / `totalInvestment` / `betAmount` / `returnRate` / `recoveryRate`

`bettingLines`（軸・相手順を含む内容と順序）、`result`、払戻元（`umatan`）、配列順、
要素の追加・削除、`verifiedAt` 等の metadata は **不変**とする。

### Rationale

PR #68 本文に記載のとおり、read-only dry-run の出力をそのまま適用する「サージカル反映」とし、
**dry-run 出力 SHA と実ファイル SHA の一致**をもって、意図しない改変がないことを保証した。
買い目そのもの（`bettingLines`）と払戻の一次データを触らないことで、再計算の可逆性と監査可能性を確保している。

### Alternatives Considered

- **過去 archive を旧仕様のまま残す** — `CLAUDE.md` が「新ロジックは新規取込分から適用。過去 archive は旧フォーマットのまま残る（再生成は別タスク）」としていた元方針。公開通算値が仕様と一致しないため採用されなかった。
- **`scripts/rebuildArchive.js` による再生成** — 旧フォーマットを生成するバグがあり使用禁止（`CLAUDE.md`、2026-03-11 に workflow から削除済み）。

### Consequences

- archive JSON が大きく書き換わった（PR #68 時点で南関 110 開催 1378R、差分 7,729 挿入 / 6,069 削除）。
  この件数は **2026-07-02 当時の値**であり、以後 archive は日次で増えている（現在の件数は実データを参照）。
- 以後、`scripts/umatanHit.test.mjs` が archive 全体を F3 で再計算しても冪等であることが検証可能になった。
- 公開されている通算回収率が F3 基準に統一された。

### Revisit Conditions

- 的中判定ロジック（`checkUmatanHit`）が再び変更される場合、同様の再計算が必要になる。
- `bettingLines` の保存形式が変わる場合（再判定の前提が崩れる）。

### Evidence

- PR #68「chore: 馬単archiveをF3判定・5点固定で再計算」（MERGED 2026-07-02T04:00:39Z）本文の dry-run SHA 一致記述
- ブランチ `chore/umatan-archive-f3-5pt` の commit `294d87f`
- `astro-site/src/data/archiveResults.json` / `archiveResultsJra.json`

---

## 2026-07-01 — 購入点数は従来の `getBetPoints` を正とする（「方針A」）／未接続の Phase 1 コードを削除

### Status

採用（PR #64 MERGED）。ただし翌日 2026-07-02 の F3・5 点固定（上記）により、投資点数の扱いはさらに置き換えられている。

### Context

「払戻から逆算する `getBetPoints`」ではなく「抑え・補欠を含む実買い目のユニーク順序付き組数」から
購入点数を算出する案が検討され、Phase 1（計算関数の追加・未接続、PR #62）が main にマージされた。
続く Phase 2（実接続、PR #63）は CLOSED となり、Phase 1 のコードも PR #64 で削除された。

### Decision

購入点数は従来の `getBetPoints` ロジックを正とし、未接続のまま main に入っていた
`src/utils/nankanBetPoints.js` / 同 test / `scripts/previewNankanBetPoints.mjs` を削除。
`package.json` の `test:nankan-bet-points` 連結も除去して `test:nankan` を元に戻す。

### Rationale

PR #64 本文には「方針 A で確定」とのみ記載され、**なぜ方針 A を選んだかの理由は記録されていない**。
Phase 2（PR #63）が CLOSED になった理由の記録も見つからない。

**履歴上は採用済みだが理由は未確認。**

### Alternatives Considered

- **Phase 2 を実行して実買い目ユニーク数へ接続する（PR #63）** — CLOSED。理由の記録なし。
- **Phase 1 のコードを未接続のまま残す** — PR #64 が「未接続のまま main に入っている」ことを問題として削除している。

### Consequences

- `importResults.js` の購入点数ロジックは変更されず、tree は Phase 1 直前のコミットと完全一致した（PR #64 本文）。
- この判断の翌日に F3・5 点固定が導入され、投資点数は `getBetPoints` からも切り離されて定数化された。
  結果として本エントリは **短命の中間判断**であり、現行の投資点数仕様は `BET_POINT_LOGIC.md` が正本。

### Revisit Conditions

- 「表示している実買い目の点数」と「回収率計算上の投資点数」を一致させる要求が再び出た場合。
  （現行 `BET_POINT_LOGIC.md` は両者を意図的に分離した概念としている。）

### Evidence

- PR #62（MERGED 2026-07-01T12:47:42Z）、PR #63（CLOSED）、PR #64（MERGED 2026-07-01T13:35:03Z）
- `docs/progress.md` の Open Questions

---

## 2026-06-28 — 共有データ取得を `KEIBA_DATA_SHARED_TOKEN` の認証必須アクセスに一本化する

### Status

採用・現行

### Context

`keiba-data-shared` の private 化に備え、匿名の `raw.githubusercontent.com` 取得では
データを読めなくなる見込みとなった。また、取得失敗時に 401/403 を 404 と混同して
「データが無い」と誤判定すると、archive に欠損が入り込む危険があった。

### Decision

`astro-site/scripts/lib/sharedFetch.mjs` を新設し、全 importer / checker をこれに移行する。

- 匿名 raw 取得を廃止し、**GitHub Contents API（raw media type）+ Authorization** に統一。
- **`KEIBA_DATA_SHARED_TOKEN` のみを正式トークン**とし、旧 fallback（`GITHUB_TOKEN_KEIBA_DATA_SHARED` / `GITHUB_TOKEN`）を廃止。
- token 未設定は即時 `TOKEN_MISSING`（**匿名 fallback 禁止**）。
- エラーを taxonomy 化（`TOKEN_MISSING` / `AUTH_FAILED` / `FORBIDDEN` / `NOT_FOUND` / `RATE_LIMITED` /
  `SERVER_ERROR` / `TIMEOUT` / `INVALID_JSON` / `INVALID_RESPONSE` / `FILE_TOO_LARGE`）。
- retry は 5xx / timeout / rate-limit のみ。token・401/403/404・JSON 破損・too-large は retry しない。
- **token・Authorization・token 付き URL・秘密値を message / log に含めない。**
- 1MB 超のファイルは listing entry の size/sha を見て git blobs API（base64）へ切替。
- 共有エラー時は結果取込を **失敗させる**（PR #61）。

### Rationale

`sharedFetch.mjs` のヘッダコメントに明記された設計方針:

- private 化への追随（匿名取得の廃止）
- 401/403 を 404 と混同しない（誤って「欠損」と扱わないため）
- 秘密値をログに漏らさない
- 恒久的失敗を retry しない（無駄な再試行と rate limit 消費の回避）

### Alternatives Considered

- **`GITHUB_TOKEN` を流用する** — PR #58 で共有読取から `GITHUB_TOKEN` env を明示的に除去しており、権限分離のため不採用。`workflowStaticAudit.test.mjs` が「check-sync step env に `GITHUB_TOKEN` が存在しない」ことを構造検証している。
- **匿名取得を fallback として残す** — private 化後は必ず失敗し、かつ「欠損」と誤判定される危険があるため禁止された。

### Consequences

- GitHub Actions に `KEIBA_DATA_SHARED_TOKEN` secret が必須になった（未設定だと全取込が `TOKEN_MISSING` で停止）。
- 移行は 13 本の PR（#49〜#61）に分割して段階的に行われた（foundation → results → featureScores → predictions → entries/horseStats → horseHistories → verify-sync → token 統一 → env 除去 → 失敗伝播）。
- `scripts/utils/workflowStaticAudit.test.mjs`（91 テスト）が workflow の env / secret 配線を静的に監査し、退行を防いでいる。

### Revisit Conditions

- 共有データの配布方式が GitHub リポジトリ以外（API サービス、CDN 等）へ変わる場合。
- token のスコープ・ローテーション方針が変更される場合。

### Evidence

- `astro-site/scripts/lib/sharedFetch.mjs`（ヘッダコメントの設計方針、`SHARED_FETCH_CODES`）
- PR #49〜#61（すべて MERGED、2026-06-28）
- `astro-site/scripts/utils/workflowStaticAudit.test.mjs`（2026-07-20 実行時 91 pass）
- `.github/workflows/*.yml` の `secrets.KEIBA_DATA_SHARED_TOKEN` 参照

---

## 2026-05-23 — 姉妹プロダクトとの同期義務を廃止し、独立運用とする

### Status

採用・現行

### Context

2026-05-22 以前は、`keiba-intelligence` と姉妹プロダクトの両リポジトリで
同じ判定式・同じ買い目生成ロジックを使う前提であり、メインレース判定や点数ロジックの変更は
両リポジトリ同時に行うルールだった。

### Decision

`CLAUDE.md`「analytics-keiba との関係（独立運用、2026-05-23〜）」節のとおり:

- 両者を **別サービスとして独立運用**する。両方とも稼働を続け、それぞれの顧客へ予想を提供する。
- 共通の admin（`keiba-data-shared-admin`）からのデータ供給は当面維持する。
- 片側のロジック修正を **自動的に横展開しない**。本リポジトリ側は必要な場合のみ個別に修正する。
- **UI・表示コンポーネントも独立**（2026-05-29 追加）。片側の正規構造を無断で他方に適用しない。
- ただし `keiba-data-shared` の JSON 構造・命名・キー名は **両者共通の契約**であり、片側の表示都合で変更しない。
- **過去の経緯を理由に同期作業を再開してはいけない。**

### Rationale

`CLAUDE.md` には「別サービス・別 UI として扱う」「それぞれ独自の顧客に対して予想を提供する」と記載されている。
それ以上の意思決定理由（なぜ 2026-05-23 に同期義務を外したのか）は文書に記載がない。

**履歴上は採用済みだが理由は未確認。**

### Alternatives Considered

- **両リポジトリの同期義務を維持する** — 2026-05-22 以前の方式。`CLAUDE.md` が明示的に「取りやめた」と記載。
- **一方を他方に統合する** — 検討記録は見つからない（証拠未確認）。

### Consequences

- 本リポジトリの買い目仕様（F3・5 点固定）は KI 固有仕様として独自に進化できるようになった
  （`BET_POINT_LOGIC.md` および `umatanHit.js` に「KI固有・別商品／統一しない」と明記されている）。
- 一方で共有 JSON 契約という結合点は残るため、importer / loader 群の改変には引き続き両者への影響確認が必要（`CLAUDE.md`）。
- 表示差分が両者で生じても、それを理由に共有 JSON 構造を片側へ寄せてはならない。

### Revisit Conditions

- 共有データの契約変更が必要になった場合（`keiba-data-shared-admin` 経由で確定させる）。
- どちらかのサービスを停止・統合する判断が出た場合。

### Evidence

- `CLAUDE.md`「analytics-keiba との関係（独立運用、2026-05-23〜）」節（運用方針 / 過去の経緯 / UI・表示コンポーネント境界 / shared data 取り扱い境界 / 本番 URL 取り扱いルール）
- `BET_POINT_LOGIC.md` 冒頭の「KI固有の商品仕様であり別商品である」注記
- `astro-site/src/utils/umatanHit.js` のヘッダコメント

---

## 2026-03-14 — archive 更新 workflow の concurrency group を統一し、並行書込み競合を止める（Workflow Phase 1）

### Status

採用・現行（Phase 1 完了。Phase 2 / Phase 3 は未着手）

### Context

`archiveResultsJra.json` を 3 つの workflow が、`archiveResults.json` を 2 つの workflow が
それぞれ並行更新しており、rebase 競合・`you need to resolve your current index first`・
5 回リトライ後の push 失敗が頻発。会場の欠落（JRA 3 会場のうち 1 会場が消える等）も発生し、
ほぼ毎日手動対応が必要な状態だった。

### Decision

1. **concurrency group の統一**: JRA 結果系を `archive-jra-update`、南関結果系を `archive-nankan-update` に統一し直列化。
2. **イベント誤配線の解消**: `import-results-on-dispatch.yml` の `repository_dispatch types` から
   `jra-results-updated` を削除し、南関専用にする。
3. **`git reset` バグ修正**（2026-03-15 補完): 復旧ロジックの `git reset`（インデックスのみクリア）を
   `git reset --hard origin/main` に修正し、unmerged files の残留を防ぐ。

### Rationale

`docs/WORKFLOW_PHASE1_COMPLETION.md` に記載のとおり、Phase 1 の目的は
「毎日手動になる最大原因である archiveResults 系の並行実行競合を止める」ことであり、
**最小 diff（9 行）での「止血」**を優先した。根本的な workflow 統合や rebase ロジック削除は
競合が消えたことを確認してから Phase 2 / Phase 3 で行う、という段階設計をとっている。

### Alternatives Considered

- **workflow を統合して数を減らす（Phase 2）** — 「Phase 1 は最小 diff」という方針により後回し（時期未定）。
- **`pull --rebase` リトライループを即時削除する（Phase 3）** — concurrency 統一で競合がほぼ発生しなくなればリトライは不要になるため、確認後に削除する方針で先送り（時期未定）。
- **予想系 workflow も同時に対象にする** — 予想データは日付別ファイルでファイルレベル競合が少ないため対象外とした。

### Consequences

- 同一 archive JSON を書く workflow は直列実行になり、競合が大幅に減少した（文書の期待値は「90% 削減」）。
- 以後に追加された新データ種別（entries / horseStats / horseHistories / recentHorseHistories / featureScores）は
  **既存 group に相乗りせず独立 group を持つ**設計が各 yml のコメントで踏襲されている。
- 一方で workflow 数は Phase 1 当時の 8 本から **14 本に増加**しており（2026-07-20 時点の実測）、Phase 2 の統合計画（8→5）は前提が変わっている。
- `pull --rebase` リトライループは各 workflow に残存している。

### Revisit Conditions

- 競合が完全に消えたことを確認できた時点で Phase 3（rebase ロジック削除）を判断する。
- Phase 2（統合）は現行の workflow 本数（2026-07-20 時点 14 本）を前提に再計画が必要。

### Evidence

- `docs/WORKFLOW_PHASE1_COMPLETION.md`（実施内容 / 監視項目 / あえて触っていない箇所 / Phase 2・3 計画）
- commit `44f8e9d`（2026-03-14）、`08d033d`（2026-03-14）、`b299506`（2026-03-15）
- `.github/workflows/` 各 yml の `concurrency.group`
- `CLAUDE.md`「Workflow自動化 Phase 1完了（2026-03-14）」節
