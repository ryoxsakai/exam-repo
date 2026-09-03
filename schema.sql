-- Medical School Entrance Exam Database Schema
-- Cloudflare D1 (SQLite compatible)

-- Universities table
-- hidden: 表記ゆれ等で重複した大学を統合できない場合（統合先と年度・方式が競合する試験が
-- 残る場合）に、データは残したまま一覧表示から除外するためのフラグ（worker/index.ts の
-- mergeUniversityAliases 参照）。
CREATE TABLE IF NOT EXISTS universities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  reading TEXT NOT NULL DEFAULT '',
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Exams table
CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  university_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  schedule TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (university_id) REFERENCES universities(id) ON DELETE CASCADE,
  UNIQUE(university_id, year, schedule)
);

-- Questions table (大問 = major questions within an exam)
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL,
  question_number INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  problem_text TEXT NOT NULL DEFAULT '',
  answer_text TEXT NOT NULL DEFAULT '',
  commentary_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
  UNIQUE(exam_id, question_number)
);

-- Word lists table (ストップワード・レベル別語彙リストを Worker 側で共有保存)
--   type: 'stop' = ストップワード, 'level' = レベル別語彙リスト
--   data: JSON。stop は ["a","the",...]、level は { "word": "A1", ... }
CREATE TABLE IF NOT EXISTS word_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Favorite folders table (お気に入りのフォルダ分け。階層化可能)
--   uid: Firebase Auth の ID トークンの sub クレーム
--   parent_id: 自己参照（NULL = ルート直下）
--   sort_order: コンテナ（uid + parent_id）内での表示順（フォルダ・セクション・お気に入り共通の並び）
--   kind: 'folder' = 中に要素を入れられるフォルダ / 'section' = 中身を持たない見出し
--         （セクションはコンテナ内の1要素という点でフォルダと同じなので、並べ替え・改名・削除の
--           仕組みをこのテーブルで共有し、振る舞いの違いはこの列だけで分ける）
CREATE TABLE IF NOT EXISTS favorite_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_id INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'folder',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Favorites table (Googleログイン(Firebase Auth)したユーザーごとの大問お気に入り)
--   uid: Firebase Auth の ID トークンの sub クレーム
--   exam_id + question_number で大問を特定（questions.id ではなく他APIと同じ識別方式）
--   folder_id: 所属フォルダ（NULL = ルート直下）。sort_order はコンテナ内での表示順
CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL,
  exam_id INTEGER NOT NULL,
  question_number INTEGER NOT NULL,
  folder_id INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(uid, exam_id, question_number)
);

-- Favorite copies table (同じお気に入り大問を別フォルダにも配置する追加の表示行)
--   favorites は従来どおり「その大問がお気に入りか」を一意に管理し、このテーブルは2か所目以降の
--   フォルダ配置だけを保持する。元のお気に入りを外したときは関連コピーも削除する。
CREATE TABLE IF NOT EXISTS favorite_copies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL,
  favorite_id INTEGER NOT NULL,
  folder_id INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- NULL（ルート直下）も同じ配置先として一意判定できるよう、式インデックスで -1 に寄せる。
CREATE UNIQUE INDEX IF NOT EXISTS idx_favorite_copies_location
  ON favorite_copies(uid, favorite_id, IFNULL(folder_id, -1));

-- User settings table (Googleログイン(Firebase Auth)したユーザーごとに端末をまたいで同期する設定。
-- 現状はタブ並び順のみ)
--   uid: Firebase Auth の ID トークンの sub クレーム
--   tab_order_main / tab_order_setting: 並び順（タブid配列）のJSON文字列。未設定は空文字列
--   print_titles: お気に入りフォルダ印刷の表紙タイトル {"<favorite_folders.id>": "タイトル"} のJSON文字列
CREATE TABLE IF NOT EXISTS user_settings (
  uid TEXT PRIMARY KEY,
  tab_order_main TEXT NOT NULL DEFAULT '',
  tab_order_setting TEXT NOT NULL DEFAULT '',
  print_titles TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- MCP correction audits.  An audit freezes the exact question text before a correction,
-- expires after a short period, and can be consumed only once.  These records do not
-- change the questions table's storage structure.
CREATE TABLE IF NOT EXISTS mcp_question_audits (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  question_id INTEGER NOT NULL,
  exam_id INTEGER NOT NULL,
  question_number INTEGER NOT NULL,
  target_field TEXT NOT NULL,
  storage_field TEXT NOT NULL,
  reason TEXT NOT NULL,
  issue_codes TEXT NOT NULL,
  original_target_text TEXT NOT NULL,
  original_storage_text TEXT NOT NULL,
  original_storage_hash TEXT NOT NULL,
  proposed_target_text TEXT,
  proposed_storage_text TEXT,
  proposal_hash TEXT,
  status TEXT NOT NULL DEFAULT 'audited',
  expires_at INTEGER NOT NULL,
  prepared_at INTEGER,
  used_at INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

-- Applied MCP corrections.  Full before/after snapshots are retained so every write is
-- attributable and recoverable without altering the canonical question columns.
CREATE TABLE IF NOT EXISTS mcp_question_changes (
  id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  question_id INTEGER NOT NULL,
  exam_id INTEGER NOT NULL,
  question_number INTEGER NOT NULL,
  target_field TEXT NOT NULL,
  storage_field TEXT NOT NULL,
  reason TEXT NOT NULL,
  before_text TEXT NOT NULL,
  after_text TEXT NOT NULL,
  before_hash TEXT NOT NULL,
  after_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (audit_id) REFERENCES mcp_question_audits(id),
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

-- Indexes for performance
-- 注: questions.problem_text（本文全文が入る最大のカラム）には索引を張らない。
-- 検索（GET /api/search）は常に LIKE '%word%'（前後ワイルドカード）で問い合わせるため
-- 通常のB-tree索引は使われず全表走査になり、索引があっても検索は速くならない一方、
-- 索引自体が本文データをほぼ丸ごと複製して肥大化させ、登録・編集のたびの更新コストも
-- 増やすだけだった（実際に worker/index.ts の dropUnusedIndexes で撤去済み）。
CREATE INDEX IF NOT EXISTS idx_exams_university_id ON exams(university_id);
CREATE INDEX IF NOT EXISTS idx_exams_year ON exams(year);
CREATE INDEX IF NOT EXISTS idx_questions_exam_id ON questions(exam_id);
CREATE INDEX IF NOT EXISTS idx_favorites_uid ON favorites(uid);
CREATE INDEX IF NOT EXISTS idx_favorite_copies_uid ON favorite_copies(uid);
CREATE INDEX IF NOT EXISTS idx_favorite_copies_favorite ON favorite_copies(favorite_id);
CREATE INDEX IF NOT EXISTS idx_favorite_folders_uid ON favorite_folders(uid);
CREATE INDEX IF NOT EXISTS idx_mcp_question_audits_question ON mcp_question_audits(question_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mcp_question_changes_question ON mcp_question_changes(question_id, created_at);

-- Trigger to update updated_at on questions update
CREATE TRIGGER IF NOT EXISTS questions_updated_at
  AFTER UPDATE ON questions
  FOR EACH ROW
BEGIN
  UPDATE questions SET updated_at = datetime('now') WHERE id = OLD.id;
END;

-- Sample data for development
INSERT OR IGNORE INTO universities (name) VALUES
  ('東京大学'),
  ('京都大学'),
  ('大阪大学'),
  ('慶應義塾大学'),
  ('慈恵会医科大学'),
  ('順天堂大学'),
  ('日本医科大学');

INSERT OR IGNORE INTO exams (university_id, year, schedule) VALUES
  (1, 2024, '前期'),
  (1, 2023, '前期'),
  (2, 2024, '前期'),
  (2, 2024, '後期'),
  (3, 2024, '前期');

INSERT OR IGNORE INTO questions (exam_id, question_number, problem_text, answer_text, commentary_text) VALUES
  (1, 1, '{{問1}}
次の英文を読み、以下の設問に答えよ。

The immune system is a complex network of cells, tissues, and organs that work together to defend the body against __pathogens__. Among the key components are ==T lymphocytes==:blue and ==B lymphocytes==:green, which play distinct roles in adaptive immunity.

T cells mature in the ==thymus==:purple, while B cells develop in the ==bone marrow==:aqua. When a pathogen enters the body, ==antigen-presenting cells (APCs)==:yellow process and present antigens to naive T cells, initiating an adaptive immune response.

The complement system consists of proteins such as C##complement::補体##[[1]], C[[2]], and C[[3]], which form the ==membrane attack complex (MAC)==:red that lyses pathogens.

((A)) Helper T cells (Th) activate B cells and cytotoxic T cells
((B)) B cells differentiate into ==plasma cells==:yellow that secrete antibodies
((C)) Memory cells provide long-term immunity upon re-exposure to the same antigen
((D)) Natural killer (NK) cells provide innate immune responses without prior sensitization

----

__設問1__: 下線部の語句を日本語に訳せ。

__設問2__: 適応免疫応答における T 細胞と B 細胞の役割の違いについて、300字以内で説明せよ。

H~~2~~O は水の化学式であり、免疫細胞の培地に必須である。CO~~2~~ インキュベーター内での培養条件は 5% CO~~2~~、37°C が標準的である。

1^^st^^、2^^nd^^、3^^rd^^ の順序で分化が起こる。',
  '設問1: pathogens = 病原体、thymus = 胸腺、bone marrow = 骨髄、antigen-presenting cells = 抗原提示細胞

設問2: T細胞は胸腺で成熟し、主に細胞性免疫を担う。ヘルパーT細胞はサイトカインを分泌してB細胞や細胞傷害性T細胞を活性化し、細胞傷害性T細胞は感染細胞やがん細胞を直接破壊する。一方、B細胞は骨髄で発育し、活性化されると形質細胞に分化して抗体を産生する液性免疫を担う。両者はともに抗原特異的な記憶細胞を形成し、再感染時に迅速な二次応答を引き起こす。',
  'この問題は適応免疫の基本的なメカニズムを問うている。T細胞とB細胞の分化・成熟の場所（それぞれ胸腺と骨髄）、および機能の違いを正確に理解することが重要である。補体系はC1〜C9まで存在し、古典的経路・レクチン経路・副経路の3つの活性化経路がある。'),

  (1, 2, '{{問2}}
以下の遺伝に関する問題に答えよ。

ある遺伝疾患は常染色体劣性遺伝形式をとる。患者の両親はともに表現型は正常であるが、==保因者==:yellow（ヘテロ接合体）である。

((1)) この両親の間に生まれる子どもが罹患する確率はいくらか。
((2)) この両親の間に生まれる子どもが保因者である確率はいくらか。
((3)) 罹患した子ども同士が結婚した場合、その子どもが罹患する確率はいくらか。

----

[[A]] 分離の法則##Mendel''s law of segregation::分離の法則##に従い、各親の生殖細胞は対立遺伝子の一方のみを持つ。

[[B]] 独立の法則は異なる染色体上の遺伝子座に適用される。

遺伝子型を Aa（保因者）× Aa（保因者）とするとき：
- AA: 1/4（正常・非保因者）
- Aa: 2/4（正常・==保因者==:green）
- aa: 1/4（==罹患==:red）',
  '(1) 1/4（25%）
(2) 2/4 = 1/2（50%）
(3) aa × aa → すべて aa なので 1（100%）',
  'メンデルの分離の法則の基本問題。Aa × Aa の交配では、子の遺伝子型の比は AA:Aa:aa = 1:2:1 となる。罹患する確率は aa の頻度 = 1/4。保因者（Aa）の確率は 2/4 = 1/2。罹患者同士（aa × aa）の場合、すべての子が aa となるため罹患率は 100%。');
