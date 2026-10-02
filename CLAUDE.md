# 入試問題データベース — CLAUDE.md

英語入試問題を蓄積し、閲覧・全文検索・英語コーパス分析を行う静的サイト + Cloudflare Worker(D1) アプリ。

## 構成

- **フロントエンド**: 素の HTML/CSS/JS（ビルド不要の静的サイト）。GitHub Pages（`exam.lrnr.jp`）に **deploy from a branch** で配信。
  - `index.html` … 閲覧ページ（通常検索 / お気に入り / コーパス検索）
  - `setting/index.html` … 設定ページ（メイン設定 / 接続設定 / 入試問題一覧 / 問題登録 / コーパス検索設定）
  - `assets/css/main.css` … デザインシステム（配色はエメラルド+ブルー。フォントは Google Fonts で読み込み、`--sans`=ゴシック: ヒラギノ角ゴシック（ローカルにあれば）→ Noto Sans JP、`--serif`=問題文の明朝系: Century Schoolbook/ヒラギノ明朝（ローカルにあれば）→ 英字 Lora + 和文 Noto Serif JP の混植。font-family はグリフ単位でフォールバックするため、ローカル英字フォントは和文側の優先順位に影響しない）
  - `assets/js/` … `store`(localStorage) / `auth`(Firebase Auth) / `api`(Worker) / `ui` / `markup` / `corpus` / `onboarding`(使い方ガイド) / `viewer` / `settings`
- **バックエンド**: `worker/index.ts`（Cloudflare Worker） + `schema.sql`（D1 / SQLite）。`wrangler.toml` で設定。
  - `.github/workflows/worker-deploy.yml` が `worker/**` 変更時に自動デプロイ。
- **認証**: Firebase Authentication（Googleログイン）。Firestore 等のデータストアは使わず、ログイン識別のみに使用（`assets/js/auth.js`。config はコード内に直書き。値は公開情報のため秘匿不要）。閲覧ページ・設定ページの両方に組み込み済み（お気に入り、タブ並び順・お気に入りフォルダ印刷の表紙タイトルのアカウント同期に使用）。

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
| `[1]` | 段落番号。全セクションでバッジ化（行頭でも行中でも可。空所 `[[ ]]` とは別）。**中身が2文字以下のみ**バッジ化し、3文字以上の `[…]` はそのまま表示（`[グラフ]` 等）。字下げは本文・和訳セクションの**英字始まり**の段落のみ（バッジの無い英文段落を字下げ。日本語の指示文などは左寄せ）。**全訳セクションは段落番号付きの行と《…》で始まる段落を除いて字下げする**（`@@` でも抑制） |
| `\| a \| b \|`＋`\| --- \| --- \|` | 表（Markdown記法。見出し行＋区切り行＋中身。`:--:`等で寄せ指定、`\|`でセル内パイプ） |
| `![説明](URL)` | 画像（写真・グラフ）。相対 `/api/image/KEY` は Worker 基準で解決。登録/取り込み編集の「画像」ボタンでR2へアップロードし自動挿入 |
| `----` | 区切り線 |
| `@@` | 段落先頭に付けると、その段落だけ強制的に字下げなし（登録/取り込み編集の「詰め」ボタンで挿入） |
| `《タイトル》` | 全訳セクション冒頭に書く長文タイトル（字下げ対象外は zenyaku 指定で常に非字下げ）。問題種別「長文」の一覧表示で「長文：タイトル」として利用 |
| 空行 | 段落間隔 |

`Markup.render(text) → {html, footnotes}` で HTML 化、`Markup.strip(text)` で記法除去（コーパス分析の前処理）。

### セクション種別「リード文」（`Markup.mergeLeadSections`。`assets/js/markup.js`）

登録・取り込み編集でセクション種別を「リード文」にすると、保存時は `{{リード文}}` として独立したセクションを保持する。`settings.js` の `sectionsToStoredText` を通常編集（`collectReg`）とPDF取り込み編集（`ingSectionsToQuestion`）で共用し、再編集・再保存しても本文へ統合しない。途中の「問題」セクションも `{{問題}}` を必ず保存し、直前のリード文や本文へ吸収されないようにする（先頭の「問題」だけは従来どおり見出しを省略可能）。解答・解説の別カラムへの抽出は後方互換のため継続する。

表示用の統合ロジックは `markup.js` の `Markup.mergeLeadSections(sections)` に一本化されている。`settings.js` の登録フォーム全体プレビューと `viewer.js` の閲覧モーダル・印刷・コーパス分析では `examSections()` 経由で呼び、リード文を直後のセクションへ `@@**文**` として付ける。太字・字下げなしの表示と、直後の本文の字下げなどを従来どおり保つ。連続するリード文は表示時だけまとめ、末尾のリード文も失わない。既に本文へ統合されている旧データは推測で分離せず、そのまま保存・表示する。登録フォームへの編集用読み込みは `Markup.parseSections` で生セクションを読み、独立した行として編集できる。

回帰テスト: `node scripts/test-section-saving.cjs`（通常編集/PDF取り込みの保存、反復保存、複数本文、途中の問題、旧データ、プレビュー・印刷の互換性）。

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
| `GET/POST /api/favorites` `DELETE /api/favorites/:examId/:questionNumber` | ログインユーザーの大問お気に入り（要 `Authorization: Bearer <Firebase IDトークン>`）。GET は `favorites` に加え `folders`（フォルダ一覧）・`sections`（セクション見出し一覧）も返す |
| `POST /api/favorite-copies` `DELETE /api/favorite-copies/:id` | 同じお気に入り大問を別フォルダにも配置／そのコピーだけを削除（要ログイン）。元のお気に入りを外すと関連コピーもすべて削除する |
| `POST /api/favorite-folders` `PUT/DELETE /api/favorite-folders/:id` `POST /api/favorite-folders/reorder` | お気に入りフォルダ／セクションの作成・改名・削除・並べ替え（要ログイン）。POST の `kind`（`"folder"`/`"section"`）で種別を指定し、改名・削除・並べ替えは両者で共通 |
| `GET/PUT /api/user-settings` | ログインユーザーごとの端末をまたぐ設定（要ログイン。`tab_order_main`/`tab_order_setting`=タブ並び順、`print_titles`=お気に入りフォルダ印刷の表紙タイトル `{フォルダid:{top,mid,bottom}}`）。PUT は渡されたキーだけを部分更新する |

データモデル: `universities`(name, reading=よみがな, abbreviation=略称表示用) 1—N `exams`(year, schedule) 1—N `questions`(question_number, label, problem_text, answer_text, commentary_text)。`label` は大問の表示ラベル（任意。例「1A」。空なら「大問」+`question_number` を表示する表示専用の上書き。並び順・識別は常に整数 `question_number` を使用）。`favorites`(uid, exam_id, question_number) は `questions.id` ではなく他APIと同じ `(exam_id, question_number)` で大問を識別し、星のON/OFFを1大問1行で管理する。`favorite_copies`(uid, favorite_id, folder_id, sort_order) は同じ大問を2か所目以降のフォルダにも置く追加の配置行で、元の `favorites` が消えれば関連コピーも削除する。`favorite_folders`(uid, name, parent_id, sort_order, kind) は自己参照の `parent_id`（NULL=ルート直下）で階層化し、`favorites` / `favorite_copies` にも同じ意味の `folder_id`/`sort_order` を持たせて、フォルダとお気に入りをまとめて1つの表示順（コンテナ=uid+parent_id/folder_id 内の `sort_order`）で並べる。`kind` は `'folder'`（中に要素を入れられる）と `'section'`（中身を持たない見出し）の別で、セクションも「コンテナ内の名前つき1要素」という点はフォルダと同じなのでテーブル・並べ替え・改名・削除の仕組みを共有し、この列だけで振る舞いを分ける（既存行はすべて `'folder'`）。`user_settings`(uid PRIMARY KEY, tab_order_main, tab_order_setting, print_titles) はログインユーザー1人につき1行で、`tab_order_*` はタブid配列、`print_titles` は `{フォルダid:{top,mid,bottom}}` のJSON文字列（値が文字列なら中央行のみの旧形式）（いずれも未設定は空文字列）。

### 認証（Firebase Auth / Googleログイン）

- クライアント: `assets/js/auth.js`（`window.Auth`）が Firebase の compat SDK（CDN）を初期化し、`signIn`/`signOut`/`getIdToken`/`onChange` を提供。Firestore は使わず、ログイン識別のみ。
- サーバー: `worker/index.ts` が Firebase ID トークン（JWT/RS256）を **npm依存なし・Web Crypto API のみ**で検証する（`verifyFirebaseIdToken`）。署名鍵は Google の JWKS（`securetoken@system.gserviceaccount.com`）を Workers の Cache API でエッジキャッシュして取得。`getAuthUid(request)` が `Authorization: Bearer <idToken>` から検証済み `uid`（Firebaseの`sub`クレーム）を返す。
- 認可が必要なのは `/api/favorites` `/api/favorite-folders` `/api/user-settings` 系のみ。閲覧・検索など既存APIは引き続き無認証。

### MCP接続画面のログイン保持（Googleログインとは別）

- `worker/mcp.ts` の `/oauth/authorize` は `EXAM_API_KEY` で本人確認し、要求された接続先・権限を毎回表示して明示的な許可を求める。初回は「ログイン状態を30日間保持する」が未選択。保持しても OAuth の許可を自動化しない。
- `worker/oauth-browser-session.ts` は32バイトの暗号学的乱数を `__Host-exam_oauth_login` Cookie（`Secure; HttpOnly; SameSite=Lax; Path=/`、Domainなし）に保存。D1 の `mcp_oauth_browser_sessions` にはそのSHA-256ハッシュ・認証設定のHMACタグ・固定30日の期限だけを保存する。APIキー・OAuthトークンを localStorage/sessionStorage に保存しない。繰り返し許可しても期限を延長せず、APIキーまたは `EXAM_SESSION_SECRET` の変更でも無効になる。
- CookieはMCP接続画面専用。既存のOAuthスコープ・5分の認可コード・24時間のアクセストークン、Firebase認証には流用しない。
- 認可・解除のPOSTは完全一致のOriginと、D1の10分・一回限りのフォームトークンで保護。トークンはブラウザ専用HttpOnly nonce、保持Cookie、認可パラメータ、操作に結びつけ、`DELETE … RETURNING` で原子的に消費する。Cookieのnonceは有効な間再利用して複数タブを許容する。
- 保持中にチェックを外して許可すると保持を解除。画面内の解除ボタン、または `/oauth/logout` の確認画面からも解除でき、D1のセッション行を削除してCookieを失効する。すでに接続済みのアプリのアクセストークンは期限まで有効。
- ログイン画面はHTTPS必須。`Referrer-Policy: same-origin` により同一オリジンのフォームOriginを維持し、外部コールバックへのReferer送信を防ぐ。CSPの `form-action` は自オリジンと検証済みコールバックのオリジンのみ（OAuthリダイレクトをブラウザが拒否しないため）。新たなSecretや外部ライブラリは不要。D1テーブル・索引は対象ルートで冪等に作成し、期限切れ行を削除する。
- 回帰テスト（Node.js 24+）: `npm ci --prefix panel && npm run build --prefix panel && node scripts/test-oauth-browser-session.cjs`。実際のin-memory SQLiteとダミー認証情報で、ON/OFF、反復、並列・再送、期限、解除、失敗、Origin/CSRF/redirect/PKCEを検証する。任意のブラウザテストはPlaywrightとChromiumを用意し、`PLAYWRIGHT_MODULE=/path/to/playwright PANEL_CHROMIUM=/path/to/chromium node scripts/test-oauth-browser-session.cjs --browser`（外部通信はテスト用URLでインターセプト）で実行する。

### お気に入りのフォルダ分け・並べ替え（`assets/js/viewer.js`）

- お気に入りタブはフォルダ・セクション・大問を1本の木構造（`#favorites-area` 内 `.fav-tree`）として描画する。並び順・所属フォルダは `favorites` / `favorite_copies` の `sort_order`/`folder_id` と `favorite_folders.sort_order`/`parent_id` で管理し、3種をまとめて1つの表示順にする（`favChildrenOf`）。
- 各大問行のコピーボタンから、同じ問題をまだ置いていない別フォルダを選んで追加配置できる。コピー行も通常の大問と同様に並べ替え・印刷でき、「コピー」表示とゴミ箱ボタンでその配置だけを削除する。元行の星を外した場合はコピーもすべて削除する。
- 並べ替え・フォルダ間移動・階層化（フォルダをフォルダへドロップ）は PC はネイティブ Drag and Drop API、スマホはタップ長押し（`touchstart`から一定時間後にドラッグ開始、閾値以上動いたらスクロールとみなし中止）で行い、いずれも `POST /api/favorite-folders/reorder` で確定する（ドロップ先コンテナの子要素を渡した順序で `sort_order`/`folder_id`(`parent_id`) に一括反映。移動元に残る要素の番号は詰め直さない）。
- スマホの長押しドラッグ中だけ `body.fav-dragging-touch` を付与し、CSS側でその間だけテキスト選択・長押しコールアウトを禁止する（常時ではなく JS がドラッグ中と判定した時だけ適用）。
- フォルダ削除時、配下のフォルダ・お気に入りは削除せず削除フォルダの親へ繰り上げる（`fixOrphanedRecords` でも念のため参照切れの `folder_id`/`parent_id` をルートへ戻す）。
- お気に入り登録済みの大問を含む試験は `Store.getCachedExam`/`setCachedExam`（localStorage `exam_fav_cache`。examId単位）にキャッシュし、`openExam` で表示時に stale-while-revalidate（キャッシュがあれば即座に表示しつつ裏で `Api.getExam` を取得し直して差し替え）で体感速度を上げる。お気に入りから外れた試験は `ensureFavoritesLoaded` が `Store.pruneCachedExams` でその都度キャッシュから削除し、際限なく増えないようにする。
- フォルダの折りたたみ状態（`state.favCollapsed`。フォルダid→真偽）は `Store.getFavCollapsed`/`setFavCollapsed`（localStorage `exam_fav_collapsed`。この端末のみ）に保存し、再読み込みやログインし直しても復元される。トグル時（`data-toggle` クリック）に即保存し、削除済みフォルダのキーは `ensureFavoritesLoaded` が `Store.pruneFavCollapsed` でその都度削除する。

#### セクション（印刷時の見出し）

- お気に入りタブのツールバーの「セクションを挿入」（`#btn-favorites-new-section`）で、**中身を持たない見出し**をツリーに挿入できる。大問・フォルダと同じ1要素として扱われ、**同じドラッグ＆ドロップ（スマホは長押し）で並べ替え・フォルダ間移動**ができ、鉛筆ボタンで改名、ゴミ箱ボタンで削除する（削除しても大問は消えない）。
- サーバー側は `favorite_folders` の `kind='section'` 行。作成・改名・削除・並べ替えのエンドポイントはフォルダと共通で、違いは「親になれない」ことだけ（`isFavoriteFolder` が親指定を `kind='folder'` に限り、`fixOrphanedRecords` もセクションを指す `folder_id`/`parent_id` をルートへ戻す）。クライアントでは扱いが別なので `GET /api/favorites` のレスポンスで `folders` と `sections` に分けて返す。
- ドロップ判定（`computeFavDropTarget`）では、行の中央50%への「中へ入れる」判定はフォルダ行だけに適用し、セクションは大問と同じく前後への挿入のみを受け付ける。
- 印刷では、お気に入りフォルダを印刷対象にしたときにセクションが**見出し（`.print-section-head`）として同じ順序で挟まる**（下記「お気に入りフォルダの一括印刷」参照）。

### タブの並べ替え（`UI.makeSortableList`。`assets/js/ui.js`）

並べ替えの実体は `UI.makeSortableList(container, opts)` に一本化されている（PC はネイティブ Drag and Drop API、スマホはタップ長押し。お気に入りフォルダのドラッグ＆ドロップと同じ操作方式だが、階層移動が無い1階層のリスト専用）。`opts` で `handleSelector`（掴み手。`null` で要素全体）・`horizontal`（true で左右方向）・`ghostHtml` を切り替え、縦リストと横タブバーの両方に使い回している。並べ替え確定時は `onReorder(ids)` を呼ぶだけで、保存・再描画は呼び出し側が行う。ドラッグ直後 350ms のクリックは抑止する（タブのように要素自体がクリック可能な場合に、並べ替えただけでタブが切り替わるのを防ぐ）。この記録はドロップ時点で行う必要がある — `onReorder` で呼び出し側が要素を作り直すと、ドラッグ元がDOMから外れて直後の `dragend` が container まで伝播しなくなるため。

**閲覧ページ: タブバー上で直接並べ替え**（`wireMainTabsDrag`。`assets/js/viewer.js`）

- 閲覧ページのタブは、タブバー（`#main-tabs`）上でタブ自体をドラッグ（スマホはタップ長押し）して左右に並べ替えられる。掴み手を置く余地が無いため `handleSelector: null` でタブ全体を掴み手にし、`UI.buildTabs` の `draggable: true` で各タブに `draggable` 属性を付ける（タブは再描画のたびに作り直されるので属性付与は buildTabs 側で行う）。
- 長押し確定（450ms）までは通常どおりタブバーの横スクロール・タップでのタブ切り替えができる（指が10px以上動いたらスクロールとみなしドラッグを中止する）。ドラッグ確定後は `touchmove` の `preventDefault` と `body.tabs-dragging-touch` の `touch-action: none` でスクロールへ奪われないようにする。
- 並べ替え後は `Store.setTabOrder("main", …)` に保存し、アクティブタブを保ったまま `buildMainTabs` で再描画、さらに `Store.pushTabOrderToAccount` でログイン中ならアカウントにも保存する。

**設定ページ「メイン設定」のリスト**（`assets/js/settings.js`）

- 閲覧ページのタブ（`order-main`）・設定ページのタブ（`order-setting`）は、設定ページの「メイン設定」タブにある2つの縦リストでも並べ替えできる（タブ名の変更も同じ場所で行うため残している）。各項目は `.grip` ハンドルから同じ `UI.makeSortableList` で並べ替える。並べ替えるとその場で `Store.setTabOrder` に保存し、`page === "setting"` なら設定ページ自身のタブバーへ即時反映する。
- 並べ替えのたびに `Store.pushTabOrderToAccount(page, order)` でログイン中なら Worker（`PUT /api/user-settings`）へも保存し、他端末でも同じ並び順になるようにする（未ログイン時は今までどおり localStorage のみ）。設定ページにも `assets/js/auth.js` を組み込み済み（Firebase Auth はブラウザに永続化されるため、閲覧ページで一度ログインしていれば設定ページでも自動的にログイン状態として扱われる。設定ページのトップバーにもログイン/ログアウトボタンを追加済み）。
- ページ初期化時（`init()`）は常にまず localStorage の並び順で即座にタブを構築し、その後ログイン中であれば `Store.pullUserSettingsFromAccount()` で Worker から取得した値を stale-while-revalidate 方式で上書き・再描画する（`viewer.js` の `syncTabOrderFromAccount`／`settings.js` の同名関数。閲覧ページの `main` タブ順・設定ページの `main`/`setting` 両方のタブ順を対象）。

### 問題印刷タブ（`assets/js/viewer.js`）

ツリーで大学→年度→方式を選ぶと、その方式の全大問を「表紙 → 問題面 → 解答・解説面」の順に印刷する。セクションは `isAnswerSide`（`/解答|解説|和訳|訳|答|講評/`）で問題面／解答面に振り分ける。プレビュー（`.print-doc`）と実際の印刷（`#print-area.print-out`）は同じ HTML・同じルートクラス（`printDocClasses`）を使うため見た目が一致する。印刷オプションはいずれもこの端末（localStorage）に保存され、次回以降も復元される。

印刷対象は `state.printSel.kind` で切り替える（`"exam"`=大学/年度/方式、`"favFolder"`=お気に入りフォルダ）。大問の識別は `printQKey(q)`（`exam_id:question_number`）に統一されており、お気に入りフォルダのように複数の試験の大問が混ざって `question_number` が衝突しても正しく扱える。

- **表紙をつける**（`pr-cover`）
- **「問題」「本文」「設問」のラベルを外す**（`pr-hide-labels` / `Store.getPrintHideLabels`）: `printField` がこの3種（`LABEL_HIDABLE`）のセクション名見出しを出力しなくなり、中身だけが印刷される。解答・解説・全訳などはどのセクションか分からなくなると困るため対象外で、常にラベルを出す。
- **大問ごとに改ページ（問題面／解答・解説面で別々）**（`pr-qbreak-q` / `pr-qbreak-a` / `Store.getPrintQPageBreak(side)`）: ルート要素に `qbreak-q` / `qbreak-a` クラスを付け、`@media print` の `#print-area.print-out.qbreak-q .print-part-q .print-q ~ .print-q { page-break-before: always }`（解答面は `qbreak-a` / `.print-part-a`）で2つ目以降の大問を新しいページから始める（各パート先頭の大問は `.print-part + .print-part` の改ページで既に新ページ）。面の区別のため `part()` が `.print-part-q` / `.print-part-a` を付けている。画面のプレビューでは破線で改ページ位置を示す。面別に分ける前の設定（`exam_print_qbreak`）が残っている場合はその値を両面に引き継ぐ。**隣接（`+`）ではなく一般兄弟（`~`）を使う**のは、大問と大問の間にセクション見出しが挟まっても「2つ目以降の大問」と判定できるようにするため。
- **セクションごとに改ページ（問題面／解答・解説面で別々）**（`pr-sbreak-q` / `pr-sbreak-a` / `Store.getPrintSectionPageBreak(side)`）: ルート要素に `sbreak-q` / `sbreak-a` クラスを付け、`.print-q ~ .print-section-head` で2つ目以降のセクション見出しの前を改ページする（パート先頭の見出しは対象外）。お気に入りフォルダの印刷でのみ意味を持つ。
  - **大問ごとの改ページONのときも、セクション見出しの前で改ページする**。そうしないと見出しだけが前ページの末尾に取り残される（改ページ位置が見出しの「後ろ」＝次の大問の前になってしまう）ため。
  - 上と対で、**セクション見出しの直後の大問は改ページしない**（`.print-section-head + .print-q { page-break-before: auto }`）。これが無いと「見出しだけのページ→中身のページ」と白紙同然のページができる。上のルールと詳細度を揃え、**後に書くことで打ち消している**。
- **パート見出しを外す（問題面／解答・解説面で別々）**（`pr-hide-head-q` / `pr-hide-head-a` / `Store.getPrintHidePartHead(side)`）: `part()` が `.print-part-head`（「問題」「解答・解説」）を出力しなくなる。
- **文字サイズ / 行間**（`pr-fontsize` / `pr-lineheight`。表紙以外に適用）
- **大問見出しに通し番号・試験情報を入れる**（`pr-qsubtitle` / `Store.getPrintQSubtitle`）: `printQHeading` が「大問3」の代わりに「1. 2018 関西医科 前期 大問3」形式で出力する。通し番号は印刷順（`printQuestions` の並び）での位置に固定するため、問題面と解答面で同じ大問が同じ番号になる。試験情報は各大問に添えた `q._ctx`（`{year, university_name, schedule}`）から作る。
- **小問番号を1から振り直す**（`pr-renumber` / `Store.getPrintRenumber`）: `renumberPrintSections` が大問ごとに問題面の実際の小問見出し・空所の出現順で対応表を作り、リード文・解答・解説の参照にも共有する。採番前にはリード文を本文へ結合せず、リード文・行中の小問参照・`[[49]]〜[[71]]` 等の範囲参照は番号を消費しない。対応表が完成した後に参照を書き換え、表示用にリード文を結合する。`{{56-61}}` 等の範囲見出しも両端を変換し、未知の番号は補完せず維持する。`{{66}}` 等は同じ番号の小問定義が無ければ空所 `[[66]]` の対応表を使う（他の小問番号が存在していても番号ごとに解決する）。変換済みバッジは再変換せず、選択肢 `((N))`・数値の解答・段落番号・出典等は維持する。印刷セクションの選択前に変換するため解答面だけの印刷でも同じ番号となり、元データを変更しない。回帰テスト: `node scripts/test-print-renumber.cjs`。
- **印刷する大問 / セクションの選択**（`renderPrintSectionControls`。セクションの取捨は閲覧モーダルと共通の `Store.isPrintSection`）
- **空所のフォント**: `[[1]]` `[[A]]` 等の空所バッジ（`.blank-badge`）は、印刷（プレビュー `.print-doc` / 実際の印刷 `#print-area` とも）では Arial に固定する（閲覧モーダルの既定 `--sans` には影響しない）。
- **本文に5行ごとの行番号をつける**（`pr-linenum` / `Store.getPrintLineNumbers`）: `Range.getClientRects()`で折り返し後の視覚行を数え、本文セクションごとに5行おきの番号を付ける。
  - 本文へ左余白を追加しない。番号は幅・高さ0のベースラインアンカー（`.print-linenum`）から左の既存余白へSVGで描くため、ON/OFFで本文の幅・位置・折り返しを保つ。SVGの`text y=0`を各行のベースラインに合わせ、最初の段落による共通の縦補正はしない。
  - アンカーは行頭の最初の単語の末尾へ差し込む。アンカーはfont-size:0の通常インラインとし、折り返し位置や行の高さを変えない。番号のSVGには本文の文字サイズを明示する。横位置は本文の左端から0.45em外側に統一する。
  - 矩形はテキストノード単位で取得し、同じ行の太字・下線等を重複して数えない。語注・語数・出典・リード文・上付き/下付き・各種バッジの小さいラベルを除外する。
  - 印刷本文幅はON/OFF共通の174mm（`#print-area.print-out`と`PRINT_BODY_WIDTH`）。画面外の計測コンテナは`.print-doc`を付け、印刷用のArial空所バッジ・文字サイズ・行間・元の字下げ指定を再現する。番号を各行へ付けるため、改ページしてもその行と一緒に移動する。
  - プレビューは実際の表示幅で計測し、ResizeObserverとフォント読み込み後に再計測する。印刷はフォントと画像の読み込み完了後に計測してから印刷ダイアログを開く。

#### お気に入りフォルダの一括印刷

- 印刷ツリーの冒頭に「お気に入り」ノード（`printFavTreeHtml`）を出し、フォルダを選ぶとそのフォルダのお気に入り大問をまとめて印刷できる（要ログイン。未ログイン時・フォルダが無い場合は案内文を出し、大学ツリーは通常どおり使える）。
- 対象は `favEntriesInFolder(folderId)` が**サブフォルダも再帰的に**辿って集めたセクション見出し＋大問で、順序はユーザーがお気に入りタブで並べた表示順（`sort_order`）をそのまま使う（`printQuestions` は `kind === "favFolder"` のとき大問番号でのソートをしない）。`favoritesInFolder` はそのうち大問だけを返す薄いラッパ。
- **セクション見出しは印刷順に挟まれ、問題面・解答・解説面の両方に出る**（`state.printExam.items` = `{kind:"section"|"question"}` の列。`printItems` が「印刷する大問」で外した大問を除いて返す）。`part()` は見出しを**保留（`pendingSection`）してから、その面に実際に中身が出る大問が来た時点で初めて出力する**。こうすると「その面には中身が無いセクション」（解答が未登録の大問だけのセクション、大問を全部チェックから外したセクション）の見出しだけが紙に残らない。
- 大問見出しの通し番号は `printQuestions` の並びでの位置に固定する（`seqOf`）ため、**セクション見出しは番号を消費せず**、問題面と解答面で同じ大問が同じ番号になる。
- フォルダ行は階層をインデントで示しつつ**すべて選択可能**にしている（選択と開閉が競合しないよう、フォルダ側は常に展開表示）。各行に配下の問数を表示する。
- 表紙は試験単位と同じ3行構成（上=`.pc-year` / 中央=`.pc-uni` / 下=`.pc-sched`）。**中央は既定でフォルダ名、上下は空**で、3行いずれも**ダブルタップ（ダブルクリック）で `contenteditable` 編集**できる（`wirePrintTitleEdit`。スマホで `dblclick` が出ない場合に備えタップ2回も自前で判定）。Enter/フォーカス外れで確定、Escで取り消し。中央を空にすると既定のフォルダ名へ戻り、上下は空のまま。
- 空の行は中身が無いとクリック領域が潰れてダブルタップできないため、`.pc-title-edit` に `min-height`/`min-width` と**薄いグレーの背景（`--line-soft`）＋破線枠**を与えてタップ範囲を可視化する。この装飾は `@media print` 側で `background: transparent` / `border: 0` / `min-height: 0` / `padding: 0` に打ち消すため、**紙の上では白紙のまま**入力した行の文字だけが出る。
- タイトルは `Store.getPrintFolderTitleParts`/`setPrintFolderTitlePart`（localStorage `exam_print_folder_titles`）に保存し、ログイン中は `PUT /api/user-settings` の `print_titles`（`{フォルダid: {top, mid, bottom}}`）で**Googleアカウントにも保存**して他端末でも復元される（`Store.pullUserSettingsFromAccount`）。値が**文字列の場合は中央行だけを保存した旧形式**として読む（後方互換）。空になった行はキーから外し、3行すべて空ならフォルダのキー自体を削除する。

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
- `mergeUniversityAliases`: `normalizeUniversityName` の一般ルールでは拾えない特定の大学名ペア（`UNIVERSITY_ALIAS_MERGES`。現在「昭和」→「昭和医科」「聖マリアンナ」→「聖マリアンナ医科」「大阪医科」→「大阪医科薬科」）を統合先へ寄せる。統合先に同じ `(year, schedule)` の `exams` が既にある試験だけは移動せず残し、1件でも移動できず残れば統合元は削除せず `universities.hidden = 1` にして一覧（`GET /api/universities`・`/api/exams`・`/api/search`・`/api/corpus`。いずれも `hidden = 0` でフィルタ）から除外する（データは保持したまま手動解消に委ねる）。全試験を移動できれば統合元を削除する。

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
- **Worker(D1) user_settings**: タブ順 / お気に入りフォルダ印刷の表紙タイトル（Googleログイン時のみ。`GET/PUT /api/user-settings`）… ログインアカウントに紐づけて端末をまたいで共有
- **localStorage**: Worker URL / タブ順（未ログイン時、またはログイン時もこの端末用のフォールバックとして常に保存） / 最後に開いたタブ / ストップワード・語彙リスト / セクション種別候補 / 長文難易度の語彙:文長の重み(`difficulty_vocab_weight`, 0〜1既定0.5) / お気に入り試験のキャッシュ(`exam_fav_cache`) / お気に入りフォルダの折りたたみ状態(`exam_fav_collapsed`) / 印刷オプション（文字サイズ・行間・対象セクション、ラベルを外す(`exam_print_hide_labels`)・大問ごとに改ページ(`exam_print_qbreak_q`/`exam_print_qbreak_a`)・セクションごとに改ページ(`exam_print_sbreak_q`/`exam_print_sbreak_a`)・パート見出しを外す(`exam_print_hide_head_q`/`exam_print_hide_head_a`)・通し番号つき見出し(`exam_print_qsubtitle`)・5行ごとの行番号(`exam_print_linenum`)） / お気に入りフォルダ印刷の表紙タイトル(`exam_print_folder_titles`。ログイン時はアカウントにも保存)
