// ----------------------------------------------------------------
// Cloudflare D1 database client helper
// Supports both:
//   1. Direct D1 binding (when running as a Cloudflare Worker)
//   2. Cloudflare REST API (when running as a Next.js app on Pages/Node)
// ----------------------------------------------------------------

export interface D1Config {
  accountId: string;
  databaseId: string;
  apiToken: string;
}

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta?: {
    duration: number;
    rows_read: number;
    rows_written: number;
  };
}

// ----------------------------------------------------------------
// Get D1 config from environment variables
// ----------------------------------------------------------------
export function getD1Config(): D1Config | null {
  const accountId =
    process.env.CLOUDFLARE_ACCOUNT_ID ||
    (typeof globalThis !== "undefined" &&
      (globalThis as Record<string, unknown>).CLOUDFLARE_ACCOUNT_ID as string);
  const databaseId =
    process.env.CLOUDFLARE_D1_DATABASE_ID ||
    (typeof globalThis !== "undefined" &&
      (globalThis as Record<string, unknown>).CLOUDFLARE_D1_DATABASE_ID as string);
  const apiToken =
    process.env.CLOUDFLARE_API_TOKEN ||
    (typeof globalThis !== "undefined" &&
      (globalThis as Record<string, unknown>).CLOUDFLARE_API_TOKEN as string);

  if (!accountId || !databaseId || !apiToken) {
    return null;
  }

  return {
    accountId: String(accountId),
    databaseId: String(databaseId),
    apiToken: String(apiToken),
  };
}

// ----------------------------------------------------------------
// Execute a D1 query via the Cloudflare REST API
// ----------------------------------------------------------------
export async function queryD1<T = Record<string, unknown>>(
  sql: string,
  params: (string | number | null)[] = [],
  config?: D1Config
): Promise<D1Result<T>> {
  const cfg = config || getD1Config();

  if (!cfg) {
    throw new Error(
      "Cloudflare D1 is not configured. Please set CLOUDFLARE_ACCOUNT_ID, " +
        "CLOUDFLARE_D1_DATABASE_ID, and CLOUDFLARE_API_TOKEN environment variables."
    );
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/d1/database/${cfg.databaseId}/query`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `D1 API error ${response.status}: ${errorText}`
    );
  }

  const data = await response.json() as {
    success: boolean;
    result?: Array<{ results: T[]; meta: D1Result["meta"] }>;
    errors?: Array<{ message: string }>;
  };

  if (!data.success) {
    const errorMsg = data.errors?.map((e) => e.message).join(", ") || "Unknown D1 error";
    throw new Error(`D1 query failed: ${errorMsg}`);
  }

  // The REST API wraps results in an array (one entry per statement)
  const firstResult = data.result?.[0];
  return {
    results: firstResult?.results || [],
    success: true,
    meta: firstResult?.meta,
  };
}

// ----------------------------------------------------------------
// Typed query helpers
// ----------------------------------------------------------------

export interface University {
  id: number;
  name: string;
  created_at: string;
}

export interface Exam {
  id: number;
  university_id: number;
  year: number;
  schedule: string;
  created_at: string;
  // Joined fields
  university_name?: string;
}

export interface Question {
  id: number;
  exam_id: number;
  question_number: number;
  problem_text: string;
  answer_text: string;
  commentary_text: string;
  created_at: string;
  updated_at: string;
}

export interface ExamWithQuestions extends Exam {
  questions: Question[];
}

// ----------------------------------------------------------------
// University queries
// ----------------------------------------------------------------
export async function getUniversities(config?: D1Config): Promise<University[]> {
  const result = await queryD1<University>(
    "SELECT * FROM universities ORDER BY name ASC",
    [],
    config
  );
  return result.results;
}

export async function createUniversity(
  name: string,
  config?: D1Config
): Promise<University> {
  const result = await queryD1<University>(
    "INSERT INTO universities (name) VALUES (?) RETURNING *",
    [name],
    config
  );
  if (!result.results[0]) throw new Error("Failed to create university");
  return result.results[0];
}

// ----------------------------------------------------------------
// Exam queries
// ----------------------------------------------------------------
export async function getExams(
  filters?: {
    universityName?: string;
    year?: number;
    schedule?: string;
  },
  config?: D1Config
): Promise<Exam[]> {
  let sql = `
    SELECT e.*, u.name as university_name
    FROM exams e
    JOIN universities u ON e.university_id = u.id
    WHERE 1=1
  `;
  const params: (string | number | null)[] = [];

  if (filters?.universityName) {
    sql += " AND u.name LIKE ?";
    params.push(`%${filters.universityName}%`);
  }
  if (filters?.year) {
    sql += " AND e.year = ?";
    params.push(filters.year);
  }
  if (filters?.schedule) {
    sql += " AND e.schedule = ?";
    params.push(filters.schedule);
  }

  sql += " ORDER BY e.year DESC, u.name ASC";

  const result = await queryD1<Exam>(sql, params, config);
  return result.results;
}

export async function getExamById(
  id: number,
  config?: D1Config
): Promise<ExamWithQuestions | null> {
  const examResult = await queryD1<Exam>(
    `SELECT e.*, u.name as university_name
     FROM exams e
     JOIN universities u ON e.university_id = u.id
     WHERE e.id = ?`,
    [id],
    config
  );

  if (!examResult.results[0]) return null;

  const exam = examResult.results[0];

  const questionsResult = await queryD1<Question>(
    "SELECT * FROM questions WHERE exam_id = ? ORDER BY question_number ASC",
    [id],
    config
  );

  return {
    ...exam,
    questions: questionsResult.results,
  };
}

export async function createExam(
  data: {
    universityId: number;
    year: number;
    schedule: string;
  },
  config?: D1Config
): Promise<Exam> {
  const result = await queryD1<Exam>(
    "INSERT INTO exams (university_id, year, schedule) VALUES (?, ?, ?) RETURNING *",
    [data.universityId, data.year, data.schedule],
    config
  );
  if (!result.results[0]) throw new Error("Failed to create exam");
  return result.results[0];
}

// ----------------------------------------------------------------
// Question queries
// ----------------------------------------------------------------
export async function createQuestion(
  data: {
    examId: number;
    questionNumber: number;
    problemText: string;
    answerText: string;
    commentaryText: string;
  },
  config?: D1Config
): Promise<Question> {
  const result = await queryD1<Question>(
    `INSERT INTO questions (exam_id, question_number, problem_text, answer_text, commentary_text)
     VALUES (?, ?, ?, ?, ?) RETURNING *`,
    [
      data.examId,
      data.questionNumber,
      data.problemText,
      data.answerText,
      data.commentaryText,
    ],
    config
  );
  if (!result.results[0]) throw new Error("Failed to create question");
  return result.results[0];
}

export async function updateQuestion(
  id: number,
  data: Partial<{
    problemText: string;
    answerText: string;
    commentaryText: string;
  }>,
  config?: D1Config
): Promise<Question> {
  const fields: string[] = [];
  const params: (string | number | null)[] = [];

  if (data.problemText !== undefined) {
    fields.push("problem_text = ?");
    params.push(data.problemText);
  }
  if (data.answerText !== undefined) {
    fields.push("answer_text = ?");
    params.push(data.answerText);
  }
  if (data.commentaryText !== undefined) {
    fields.push("commentary_text = ?");
    params.push(data.commentaryText);
  }

  if (fields.length === 0) throw new Error("No fields to update");

  params.push(id);
  const result = await queryD1<Question>(
    `UPDATE questions SET ${fields.join(", ")} WHERE id = ? RETURNING *`,
    params,
    config
  );
  if (!result.results[0]) throw new Error("Failed to update question");
  return result.results[0];
}

// ----------------------------------------------------------------
// Word search query
// ----------------------------------------------------------------
export interface SearchResult {
  exam_id: number;
  university_name: string;
  year: number;
  schedule: string;
  question_count: number;
  total_occurrences: number;
  matching_questions: string; // JSON array of question numbers
}

export async function searchByWord(
  word: string,
  config?: D1Config
): Promise<SearchResult[]> {
  const likePattern = `%${word}%`;
  const result = await queryD1<SearchResult>(
    `SELECT
       e.id as exam_id,
       u.name as university_name,
       e.year,
       e.schedule,
       COUNT(q.id) as question_count,
       GROUP_CONCAT(q.question_number) as matching_questions
     FROM questions q
     JOIN exams e ON q.exam_id = e.id
     JOIN universities u ON e.university_id = u.id
     WHERE q.problem_text LIKE ?
        OR q.answer_text LIKE ?
        OR q.commentary_text LIKE ?
     GROUP BY e.id
     ORDER BY question_count DESC, e.year DESC`,
    [likePattern, likePattern, likePattern],
    config
  );

  // Count actual occurrences per row
  return result.results.map((row) => ({
    ...row,
    total_occurrences: row.question_count,
  }));
}
