export interface Env {
  DB: D1Database;
}

function cors(origin?: string | null) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data: unknown, status = 200, origin?: string | null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    try {
      // ── GET /api/universities ──────────────────────────────────────
      if (path === "/api/universities" && request.method === "GET") {
        const { results } = await env.DB.prepare(
          "SELECT * FROM universities ORDER BY name ASC"
        ).all();
        return json({ universities: results }, 200, origin);
      }

      // ── GET /api/exams ─────────────────────────────────────────────
      if (path === "/api/exams" && request.method === "GET") {
        const uname = url.searchParams.get("universityName");
        const year = url.searchParams.get("year");
        const schedule = url.searchParams.get("schedule");

        let sql = `
          SELECT e.id, e.year, e.schedule, e.created_at,
                 u.name AS university_name
          FROM exams e
          JOIN universities u ON e.university_id = u.id
          WHERE 1=1`;
        const params: (string | number)[] = [];

        if (uname) { sql += " AND u.name LIKE ?"; params.push(`%${uname}%`); }
        if (year)  { sql += " AND e.year = ?";    params.push(Number(year)); }
        if (schedule) { sql += " AND e.schedule = ?"; params.push(schedule); }

        sql += " ORDER BY e.year DESC, u.name ASC";
        const { results } = await env.DB.prepare(sql).bind(...params).all();
        return json({ exams: results }, 200, origin);
      }

      // ── POST /api/exams ────────────────────────────────────────────
      if (path === "/api/exams" && request.method === "POST") {
        type QBody = { questionNumber: number; problemText: string; answerText: string; commentaryText: string };
        type Body = { universityName: string; year: number; schedule: string; questions?: QBody[] };
        const body = await request.json<Body>();
        const { universityName, year, schedule, questions = [] } = body;

        if (!universityName || !year || !schedule) {
          return json({ error: "Missing required fields: universityName, year, schedule" }, 400, origin);
        }

        let uni = await env.DB.prepare(
          "SELECT id, name FROM universities WHERE name = ?"
        ).bind(universityName).first<{ id: number; name: string }>();

        if (!uni) {
          uni = await env.DB.prepare(
            "INSERT INTO universities (name) VALUES (?) RETURNING id, name"
          ).bind(universityName).first<{ id: number; name: string }>();
        }
        if (!uni) return json({ error: "Failed to create university" }, 500, origin);

        const exam = await env.DB.prepare(
          "INSERT INTO exams (university_id, year, schedule) VALUES (?, ?, ?) RETURNING *"
        ).bind(uni.id, year, schedule).first<{ id: number }>();
        if (!exam) return json({ error: "Failed to create exam" }, 500, origin);

        const createdQuestions = [];
        for (const q of questions) {
          const created = await env.DB.prepare(`
            INSERT INTO questions (exam_id, question_number, problem_text, answer_text, commentary_text)
            VALUES (?, ?, ?, ?, ?) RETURNING *
          `).bind(exam.id, q.questionNumber, q.problemText || "", q.answerText || "", q.commentaryText || "").first();
          if (created) createdQuestions.push(created);
        }

        return json({ exam: { ...exam, university_name: universityName }, questions: createdQuestions }, 201, origin);
      }

      // ── GET /api/exams/:id ─────────────────────────────────────────
      const examById = path.match(/^\/api\/exams\/(\d+)$/);
      if (examById && request.method === "GET") {
        const examId = Number(examById[1]);

        const examRow = await env.DB.prepare(`
          SELECT e.id, e.year, e.schedule, e.created_at,
                 u.name AS university_name
          FROM exams e
          JOIN universities u ON e.university_id = u.id
          WHERE e.id = ?
        `).bind(examId).first();

        if (!examRow) return json({ error: "Exam not found" }, 404, origin);

        const { results: questions } = await env.DB.prepare(
          "SELECT * FROM questions WHERE exam_id = ? ORDER BY question_number ASC"
        ).bind(examId).all();

        return json({ exam: { ...examRow, questions } }, 200, origin);
      }

      // ── GET /api/search ────────────────────────────────────────────
      if (path === "/api/search" && request.method === "GET") {
        const word     = url.searchParams.get("word") || "";
        const uname    = url.searchParams.get("universityName") || "";
        const year     = url.searchParams.get("year") || "";
        const schedule = url.searchParams.get("schedule") || "";

        const hasFilter = word || uname || year || schedule;

        if (!hasFilter) {
          // Return all exams with question counts
          const { results } = await env.DB.prepare(`
            SELECT e.id AS exam_id, u.name AS university_name, e.year, e.schedule,
                   COUNT(q.id) AS question_count,
                   0 AS total_occurrences,
                   '' AS matching_questions
            FROM exams e
            JOIN universities u ON e.university_id = u.id
            LEFT JOIN questions q ON q.exam_id = e.id
            GROUP BY e.id
            ORDER BY e.year DESC, u.name ASC
          `).all();
          return json({ results }, 200, origin);
        }

        let sql = `
          SELECT e.id AS exam_id, u.name AS university_name, e.year, e.schedule,
                 COUNT(q.id) AS question_count,
                 GROUP_CONCAT(q.question_number) AS matching_questions
          FROM questions q
          JOIN exams e ON q.exam_id = e.id
          JOIN universities u ON e.university_id = u.id
          WHERE 1=1`;
        const params: (string | number)[] = [];

        if (word) {
          const p = `%${word}%`;
          sql += " AND (q.problem_text LIKE ? OR q.answer_text LIKE ? OR q.commentary_text LIKE ?)";
          params.push(p, p, p);
        }
        if (uname) { sql += " AND u.name LIKE ?"; params.push(`%${uname}%`); }
        if (year)  { sql += " AND e.year = ?";    params.push(Number(year)); }
        if (schedule) { sql += " AND e.schedule = ?"; params.push(schedule); }

        sql += " GROUP BY e.id ORDER BY question_count DESC, e.year DESC";

        const { results: rows } = await env.DB.prepare(sql).bind(...params).all();

        // Count exact word occurrences per result
        const enriched = await Promise.all(
          rows.map(async (row: Record<string, unknown>) => {
            if (!word) return { ...row, total_occurrences: row.question_count };

            const { results: qs } = await env.DB.prepare(
              "SELECT problem_text, answer_text, commentary_text FROM questions WHERE exam_id = ?"
            ).bind(row.exam_id).all<{ problem_text: string; answer_text: string; commentary_text: string }>();

            const combined = qs.map(q =>
              `${q.problem_text || ""} ${q.answer_text || ""} ${q.commentary_text || ""}`
            ).join(" ");

            const regex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
            const total_occurrences = (combined.match(regex) || []).length;
            return { ...row, total_occurrences };
          })
        );

        enriched.sort((a, b) => (b.total_occurrences as number) - (a.total_occurrences as number));

        return json({ results: enriched }, 200, origin);
      }

      return json({ error: "Not found" }, 404, origin);
    } catch (err) {
      console.error("Worker error:", err);
      return json({ error: "Internal server error", message: String(err) }, 500, origin);
    }
  },
};
