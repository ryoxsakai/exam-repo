# 入試問題データベース — CLAUDE.md

英語入試問題を蓄積し、閲覧・全文検索・英語コーパス分析を行う静的サイト + Cloudflare Worker(D1) アプリ。

## 構成

- **フロントエンド**: 素の HTML/CSS/JS（ビルド不要の静的サイト）。GitHub Pages（`exam.lrnr.jp`）に **deploy from a branch** で配信。
  - `index.html` … 閲覧ページ（通常検索 / お気に入り / コーパス検索）
  - `setting/index.html` … 設定ページ（メイン設定 / 接続設定 / 入試問題一覧 / 問題登録 / コーパス検索設定）
  - `assets/css/main.css` … デザインシステム（Noto Sans JP / Source Serif 4、エメラルド+ブルー）
  - `assets/js/` … `store`(localStorage) / `auth`(Firebase Auth) / `api`(Worker) / `ui` / `markup` / `corpus` / `onboarding`(使い方ガイド) / `viewer` / `settings`
- **バックエンド**: `worker/index.ts`（Cloudflare Worker） + `schema.sql`（D1 / SQLite）。`wrangler.toml` で設定。
  - `.github/workflows/worker-deploy.yml` が `worker/**` 変更時に自動デプロイ。
- **認証**: Firebase Authentication（Googleログイン）。Firestore 等のデータストアは使わず、ログイン識別のみに使用（`assets/js/auth.js`。config はコード内に直書き。値は公開情報のため秘匿不要）。

> フロントは各 HTML の `<head>` にキャッシュ無効化メタ + アセットURLの `?v=` クエリでキャッシュをクリアする。

## 入試問題記法（`assets/js/markup.js`）

| 記法 | 意味 |
|------|------|
| `{{問1}}` | 大問見出しバッジ（行頭で見出し化） |
| `[[1]]` `[[A]]` | 空所バッジ |
| `[[-- --]]` `[[--A--]]` | 3倍幅の空欄（ダッシュで囲む。囲んだ中身はラベル表示。記述解答欄など） |
| `##語::訳##` | 語注（脚注。本文に上付き番号、末尾に訳一覧）。語中の `^` は注のみ直前文字を小文字化（`##M^isdiagnosis::誤診##` → 本文「Misdiagnosis」/注「misdiagnosis」） |
| `==語==` | 黄ハイライト |
| `==語==:色` | 色付きハイライト（色: yellow/blue/red/purple/pink/green/aqua） |
| `__語__` | 下線 |
| `**語**` | 太字 |
| `~~x~~` | 下付き |
| `^^x^^` | 上付き |
| `((A)) 本文` | 選択肢（行頭。丸ラベル＋本文。長い選択肢は綺麗に折り返す） |
| `[1]` | 段落番号。全セクションでバッジ化（行頭でも行中でも可。空所 `[[ ]]` とは別）。**中身が2文字以下のみ**バッジ化し、3文字以上の `[…]` はそのまま表示（`[グラフ]` 等）。字下げは本文・和訳セクションの**英字始まり**の段落のみ（バッジの無い英文段落を字下げ。日本語の指示文などは左寄せ）。**全訳セクションは常に字下げしない**（日本語の全訳で偶然英字始まりになる段落があっても字下げされない） |
| `\| a \| b \|`＋`\| --- \| --- \|` | 表（Markdown記法。見出し行＋区切り行＋中身。`:--:`等で寄せ指定、`\|`でセル内パイプ） |
| `![説明](URL)` | 画像（写真・グラフ）。相対 `/api/image/KEY` は Worker 基準で解決。登録/取り込み編集の「画像」ボタンでR2へアップロードし自動挿入 |
| `----` | 区切り線 |
| `@@` | 段落先頭に付けると、その段落だけ強制的に字下げなし（登録/取り込み編集の「詰め」ボタンで挿入） |
| `《タイトル》` | 全訳セクション冒頭に書く長文タイトル（字下げ対象外は zenyaku 指定で常に非字下げ）。問題種別「長文」の一覧表示で「長文：タイトル」として利用 |
| 空行 | 段落間隔 |

`Markup.render(text) → {html, footnotes}` で HTML 化、`Markup.strip(text)` で記法除去（コーパス分析の前処理）。

### セクション種別「リード文」（`Markup.mergeLeadSections`。`assets/js/markup.js`）

登録・取り込み編集でセクション種別を「リード文」にすると、**独立したセクションにはせず、直後のセクションへ自動統合**する（`@@**文**` を先頭に付け、空行を1つ挟んで元のセクション内容を続ける）。結果として太字・字下げなしの1〜数行として表示され、直後の内容は通常どおりのセクション種別（本文なら英字始まり段落を字下げ、等）で描画される。連続する「リード文」はまとめて統合し、直後にセクションが無いまま終わる場合はデータを失わないよう「リード文」のまま残す。

統合ロジックは `markup.js` の `Markup.mergeLeadSections(sections)` に一本化されており、`settings.js`（登録フォーム・AI取り込み編集の**保存時**）と `viewer.js`（閲覧モーダル・印刷・コーパス分析の**表示時**、`examSections()` 経由）の両方から呼ばれる。保存時に統合済みの `problem_text` が大半だが、一括アップロード等で未統合の「リード文」セクションが残っていても、表示側で必ず統合されるため「リード文」という区分がそのまま表示されることはない（登録フォームへの**編集用**読み込み時のみ、生セクションのまま扱い「リード文」を独立した行として編集できる）。

### 問題種別「長文」の一覧表示（全訳タイトル）

「全訳」セクション冒頭に `《タイトル》` と書いておくと、問題種別が「長文」の大問は一覧ツリー（設定ページ「入試問題一覧」／閲覧ページ「ツリー検索」）で「長文：タイトル」のように表示される。抽出は `Markup.extractZenyakuTitle(problemText)`（フロント、`Markup.parseSections` と同じ `{{セクション名}}` 区切りルール）と `worker/index.ts` の `extractZenyakuTitle`（`GET /api/search` が `zenyaku_title` を付与。`problem_text` 本体はレスポンスに含めない）に同じロジックを実装している。《》が無ければ従来どおり「長文」とだけ表示。

## Worker API（`worker/index.ts`）

ベースURLは設定ページ「接続設定」で登録（localStorage `cf_worker_url`）。

| メソッド / パス | 用途 |
|------|------|
| `GET /api/config` / `PUT /api/config` | サイト設定（`schedules`=方式, `year_presets`=年度, `site_title`, `markup_css`, `ingest_prompt`=取り込み追加プロンプト, `university_notes`=大学ごとの注意点 `{大学名:注意点}`）。方式の並びはツリー表示時に基本 `schedules` の登録順に従うが、「前期/中期/後期」「N日目」は `schedules` の並び順に関わらず常にこの自然順（前期<中期<後期、日目は昇順）で表示される（`schedNaturalRank`/`schedCompare`、閲覧ページ・設定ページの両方に実装） |
| `GET /api/ingest-prompt?universityName=` | 外部LLM取り込み用プロンプト（`universityName` 指定でその大学の注意点を追記） |
| `GET /api/universities` / `PUT /api/universities/:id` / `DELETE /api/universities/:id` | 大学一覧 / 名前・`reading`(よみがな)・`abbreviation`(略称) 更新 / 削除 |
| `GET /api/exams` `POST /api/exams` | 試験一覧（filter: universityName,year,schedule）/ 登録 |
| `GET/PUT/DELETE /api/exams/:id` | 試験詳細 / 更新 / 削除 |
| `GET /api/search` | 全文検索（word,universityName,year,schedule。出現回数つき） |
| `GET /api/corpus` | **全大問の英文テキスト一括取得**（クライアント側コーパス分析用） |
| `POST /api/upload` / `GET /api/image/:key` | 問題画像を R2 へ保存 / 配信（`wrangler.toml` の `[[r2_buckets]] binding=IMAGES`） |
| `GET/POST /api/favorites` `DELETE /api/favorites/:examId/:questionNumber` | ログインユーザーの大問お気に入り（要 `Authorization: Bearer <Firebase IDトークン>`）。GET は `favorites` に加え `folders`（フォルダ一覧）も返す |
| `POST /api/favorite-folders` `PUT/DELETE /api/favorite-folders/:id` `POST /api/favorite-folders/reorder` | お気に入りフォルダの作成・改名・削除・並べ替え（要ログイン） |

データモデル: `universities`(name, reading=よみがな, abbreviation=略称表示用) 1—N `exams`(year, schedule) 1—N `questions`(question_number, label, problem_text, answer_text, commentary_text)。`label` は大問の表示ラベル（任意。例「1A」。空なら「大問」+`question_number` を表示する表示専用の上書き。並び順・識別は常に整数 `question_number` を使用）。`favorites`(uid, exam_id, question_number) は `questions.id` ではなく他APIと同じ `(exam_id, question_number)` で大問を識別する。`favorite_folders`(uid, name, parent_id, sort_order) は自己参照の `parent_id`（NULL=ルート直下）で階層化し、`favorites` にも同じ意味の `folder_id`/`sort_order` を持たせて、フォルダとお気に入りをまとめて1つの表示順（コンテナ=uid+parent_id/folder_id 内の `sort_order`）で並べる。

### 認証（Firebase Auth / Googleログイン）

- クライアント: `assets/js/auth.js`（`window.Auth`）が Firebase の compat SDK（CDN）を初期化し、`signIn`/`signOut`/`getIdToken`/`onChange` を提供。Firestore は使わず、ログイン識別のみ。
- サーバー: `worker/index.ts` が Firebase ID トークン（JWT/RS256）を **npm依存なし・Web Crypto API のみ**で検証する（`verifyFirebaseIdToken`）。署名鍵は Google の JWKS（`securetoken@system.gserviceaccount.com`）を Workers の Cache API でエッジキャッシュして取得。`getAuthUid(request)` が `Authorization: Bearer <idToken>` から検証済み `uid`（Firebaseの`sub`クレーム）を返す。
- 認可が必要なのは `/api/favorites` `/api/favorite-folders` 系のみ。閲覧・検索など既存APIは引き続き無認証。

### お気に入りのフォルダ分け・並べ替え（`assets/js/viewer.js`）

- お気に入りタブはフォルダ・大問を1本の木構造（`#favorites-area` 内 `.fav-tree`）として描画する。並び順・所属フォルダは `favorites.sort_order`/`folder_id` と `favorite_folders.sort_order`/`parent_id` で管理し、フォルダ・お気に入りをまとめて1つの表示順にする。
- 並べ替え・フォルダ間移動・階層化（フォルダをフォルダへドロップ）は PC はネイティブ Drag and Drop API、スマホはタップ長押し（`touchstart`から一定時間後にドラッグ開始、閾値以上動いたらスクロールとみなし中止）で行い、いずれも `POST /api/favorite-folders/reorder` で確定する（ドロップ先コンテナの子要素を渡した順序で `sort_order`/`folder_id`(`parent_id`) に一括反映。移動元に残る要素の番号は詰め直さない）。
- スマホの長押しドラッグ中だけ `body.fav-dragging-touch` を付与し、CSS側でその間だけテキスト選択・長押しコールアウトを禁止する（常時ではなく JS がドラッグ中と判定した時だけ適用）。
- フォルダ削除時、配下のフォルダ・お気に入りは削除せず削除フォルダの親へ繰り上げる（`fixOrphanedRecords` でも念のため参照切れの `folder_id`/`parent_id` をルートへ戻す）。
- お気に入り登録済みの大問を含む試験は `Store.getCachedExam`/`setCachedExam`（localStorage `exam_fav_cache`。examId単位）にキャッシュし、`openExam` で表示時に stale-while-revalidate（キャッシュがあれば即座に表示しつつ裏で `Api.getExam` を取得し直して差し替え）で体感速度を上げる。お気に入りから外れた試験は `ensureFavoritesLoaded` が `Store.pruneCachedExams` でその都度キャッシュから削除し、際限なく増えないようにする。

### 使い方ガイド（オンボーディング。`assets/js/onboarding.js` / `viewer.js`）

- 閲覧ページのトップバー右側は右から「Googleログイン」「検索」「？（使い方ガイド）」の順。「？」は `.icon-btn.subtle` で他のアイコンより控えめな配色にしている。
- `？` クリックで `startOnboarding()`（`viewer.js`）が画面の主要要素（ロゴ・検索ボタン・各タブ・ログインボタン）を順にステップ定義した配列を組み立て、`Onboarding.start(steps)`（`onboarding.js`。ページに依存しない汎用のスポットライト式ツアーエンジン）に渡す。存在しない対象（タブ並び替えで非表示にしたタブ等）は自動的にスキップする。
- ツアー表示中は対象要素を `box-shadow` によるスポットライトでハイライトしつつ、近くにタイトル・説明・戻る/次へ/スキップボタン付きの吹き出しを表示する。背景クリック・✕ボタン・Escキーのいずれでも終了できる。
- 各ステップの `scrollIntoView({block:"nearest"})` はブラウザからは `position: sticky` なトップバーの占有領域を認識できないため、ページを下にスクロールした状態でツアーを開始すると対象要素がスクロール後もトップバーの真下に隠れることがある。`scrollClearOfStickyHeader`（`onboarding.js`）で追加のウィンドウスクロールを行い、上部に一定のマージン（既定96px）を確保して補正する。

### 自動修復（`worker/index.ts`）

カラム追加等の `ensureXColumn`/`ensureXTable` 系マイグレーションと、以下の自動修復はすべて「毎回チェックして冪等に直す」パターン。曖昧な判断を伴わない安全なケースのみ自動修正し、判断が割れるケースは統合せずスキップする。

- `fixZeroQuestionNumbers`: `question_number <= 0` を大問内で採番し直す。
- `fixOrphanedRecords`: 親が存在しない `questions`（無効な `exam_id`）・`exams`（無効な `university_id`）を削除。D1 は既定で外部キー制約を強制しないため、削除時に `ON DELETE CASCADE` が効かず子レコードが孤児化する場合がある。
- `fixLongReadingCategory`: 問題種別が完全一致で「長文読解」になっている `questions.category` を「長文」へ統一する。「長文」は一覧表示で全訳タイトルを付与する特別扱いの種別（`extractZenyakuTitle`）のため表記を統一する必要がある。AI取り込みプロンプトが以前 category の例として「長文読解」を挙げていた名残で、取り込み結果がこの表記になることがあった（プロンプト自体も「長文」に修正済み）。
- `mergeDuplicateUniversities`（`GET/PUT /api/universities`）: `normalizeUniversityName`（取り込み・登録時の表記統一と同じルール。末尾の「大学」「大」・括弧注記を除去）で同じ名前になる大学を統合し、`exams` を統合先へ付け替える。統合先に同じ `(year, schedule)` の `exams` が既にある組は自動判断できないためスキップする。

**パフォーマンス**: `ensureXColumn`/`ensureXTable`（`ensureMigrations` に集約）と `fixZeroQuestionNumbers`/`fixOrphanedRecords`（`ensureRepairs` に集約）は、`fetch()` 冒頭で1回だけ呼び、モジュールスコープの `migrationsDone`/`repairsDone` フラグで同じ isolate 内では2回目以降スキップする（Cloudflare Workers は同じ isolate が複数リクエストにまたがって再利用されるため）。以前は各ルートが個別に `await ensureXColumn(env)` 等を毎回呼んでおり、`/api/exams/:id`・`/api/corpus`・`/api/search` など問題文の読み込み系エンドポイントも含め、全APIで無駄な D1 往復が発生していた。`mergeDuplicateUniversities` は都度発生しうる大学名の重複を拾う必要があるためキャッシュ対象外。また `questions.problem_text`（本文全文）に張っていた索引 `idx_questions_problem_text` は、検索が常に `LIKE '%word%'`（前後ワイルドカード）で行われ索引が使われないまま本文データを複製して肥大化させるだけだったため `dropUnusedIndexes` で撤去済み（`schema.sql` も追随済み）。

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
- **localStorage**: Worker URL / タブ順 / 最後に開いたタブ / ストップワード・語彙リスト / セクション種別候補 / 長文難易度の語彙:文長の重み(`difficulty_vocab_weight`, 0〜1既定0.5) / お気に入り試験のキャッシュ(`exam_fav_cache`)
