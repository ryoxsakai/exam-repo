-- Medical School Entrance Exam Database Schema
-- Cloudflare D1 (SQLite compatible)

-- Universities table
CREATE TABLE IF NOT EXISTS universities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Exams table
CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  university_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  schedule TEXT NOT NULL CHECK(schedule IN ('前期', '後期', '推薦', 'AO', 'その他')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (university_id) REFERENCES universities(id) ON DELETE CASCADE,
  UNIQUE(university_id, year, schedule)
);

-- Questions table (大問 = major questions within an exam)
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL,
  question_number INTEGER NOT NULL,
  problem_text TEXT NOT NULL DEFAULT '',
  answer_text TEXT NOT NULL DEFAULT '',
  commentary_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
  UNIQUE(exam_id, question_number)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_exams_university_id ON exams(university_id);
CREATE INDEX IF NOT EXISTS idx_exams_year ON exams(year);
CREATE INDEX IF NOT EXISTS idx_questions_exam_id ON questions(exam_id);
CREATE INDEX IF NOT EXISTS idx_questions_problem_text ON questions(problem_text);

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
