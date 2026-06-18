# 入試問題データベース — CLAUDE.md

英語入試問題を蓄積し、閲覧・全文検索・英語コーパス分析を行う静的サイト + Cloudflare Worker(D1) アプリ。

## 構成

- **フロントエンド**: 素の HTML/CSS/JS（ビルド不要の静的サイト）。GitHub Pages（`exam.lrnr.jp`）に **deploy from a branch** で配信。
  - `index.html` … 閲覧ページ（通常検索 / コーパス検索）
  - `setting/index.html` … 設定ページ（メイン設定 / 接続設定 / 入試問題一覧 / 問題登録 / コーパス検索設定）
  - `assets/css/main.css` … デザインシステム（Noto Sans JP / Source Serif 4、エメラルド+ブルー）
  - `assets/js/` … `store`(localStorage) / `api`(Worker) / `ui` / `markup` / `corpus` / `viewer` / `settings`
- **バックエンド**: `worker/index.ts`（Cloudflare Worker） + `schema.sql`（D1 / SQLite）。`wrangler.toml` で設定。
  - `.github/workflows/worker-deploy.yml` が `worker/**` 変更時に自動デプロイ。

> フロントは各 HTML の `<head>` にキャッシュ無効化メタ + アセットURLの `?v=` クエリでキャッシュをクリアする。

## 入試問題記法（`assets/js/markup.js`）

| 記法 | 意味 |
|------|------|
| `{{問1}}` | 大問見出しバッジ（行頭で見出し化） |
| `[[1]]` `[[A]]` | 空所バッジ |
| `##語::訳##` | 語注（脚注。本文に上付き番号、末尾に訳一覧） |
| `==語==` | 黄ハイライト |
| `==語==:色` | 色付きハイライト（色: yellow/blue/red/purple/pink/green/aqua） |
| `__語__` | 下線 |
| `~~x~~` | 下付き |
| `^^x^^` | 上付き |
| `((A)) 本文` | 選択肢（行頭。丸ラベル＋本文。長い選択肢は綺麗に折り返す） |
| `[1] 本文`（行頭） | 段落番号。本文・和訳セクションの段落先頭に置くと番号バッジ化（空所 `[[ ]]` とは別）。バッジの無い段落は字下げされる |
| `\| a \| b \|`＋`\| --- \| --- \|` | 表（Markdown記法。見出し行＋区切り行＋中身。`:--:`等で寄せ指定、`\|`でセル内パイプ） |
| `----` | 区切り線 |
| 空行 | 段落間隔 |

`Markup.render(text) → {html, footnotes}` で HTML 化、`Markup.strip(text)` で記法除去（コーパス分析の前処理）。

## Worker API（`worker/index.ts`）

ベースURLは設定ページ「接続設定」で登録（localStorage `cf_worker_url`）。

| メソッド / パス | 用途 |
|------|------|
| `GET /api/config` / `PUT /api/config` | サイト設定（`schedules`=方式, `year_presets`=年度, `site_title`, `markup_css`） |
| `GET /api/universities` / `DELETE /api/universities/:id` | 大学一覧 / 削除 |
| `GET /api/exams` `POST /api/exams` | 試験一覧（filter: universityName,year,schedule）/ 登録 |
| `GET/PUT/DELETE /api/exams/:id` | 試験詳細 / 更新 / 削除 |
| `GET /api/search` | 全文検索（word,universityName,year,schedule。出現回数つき） |
| `GET /api/corpus` | **全大問の英文テキスト一括取得**（クライアント側コーパス分析用） |

データモデル: `universities` 1—N `exams`(year, schedule) 1—N `questions`(question_number, problem_text, answer_text, commentary_text)。

## コーパス分析（`assets/js/corpus.js`）

`GET /api/corpus` の全英文を対象に、クライアント側で分析:

- **頻度リスト** + Chart.js 棒グラフ（ストップワード除外可）
- **KWIC コンコーダンス**（検索語の前後文脈）
- **n-gram（連語）** バイグラム / トライグラム
- **語彙レベルカバー率**（Target1900 等の語彙リスト基準。延べ/異なり語カバー率、リスト外語）+ ドーナツチャート
- **語数・難易度統計**（総語数 / 異なり語 / TTR / 文数 / 平均文長 / 平均語長）

ストップワードリスト・語彙リストは設定ページ「コーパス検索設定」で登録（localStorage）。

## 設定の保存先

- **Worker(D1) config**: サイトタイトル / 方式(schedules) / 年度(year_presets) … 全端末で共有
- **localStorage**: Worker URL / タブ順 / 最後に開いたタブ / ストップワード・語彙リスト / セクション種別候補
