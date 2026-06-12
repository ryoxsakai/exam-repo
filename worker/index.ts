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

// questions テーブルに category 列が無い既存DBへの後方互換マイグレーション
async function ensureCategoryColumn(env: Env) {
  try {
    await env.DB.exec("ALTER TABLE questions ADD COLUMN category TEXT NOT NULL DEFAULT ''");
  } catch {
    // 既に列が存在する場合は無視
  }
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

      // ── GET /api/config ───────────────────────────────────────────
      if (path === "/api/config" && request.method === "GET") {
        await env.DB.exec(
          "CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
        );
        const schedRow = await env.DB.prepare(
          "SELECT value FROM config WHERE key = 'schedules'"
        ).first<{ value: string }>();
        const yearRow = await env.DB.prepare(
          "SELECT value FROM config WHERE key = 'year_presets'"
        ).first<{ value: string }>();
        const titleRow = await env.DB.prepare(
          "SELECT value FROM config WHERE key = 'site_title'"
        ).first<{ value: string }>();
        const cssRow = await env.DB.prepare(
          "SELECT value FROM config WHERE key = 'markup_css'"
        ).first<{ value: string }>();
        const domainRow = await env.DB.prepare(
          "SELECT value FROM config WHERE key = 'custom_domain'"
        ).first<{ value: string }>();
        const subtitleRow = await env.DB.prepare(
          "SELECT value FROM config WHERE key = 'site_subtitle'"
        ).first<{ value: string }>();
        const categoryRow = await env.DB.prepare(
          "SELECT value FROM config WHERE key = 'question_categories'"
        ).first<{ value: string }>();
        const sectionTypesRow = await env.DB.prepare(
          "SELECT value FROM config WHERE key = 'section_types'"
        ).first<{ value: string }>();
        const curYear = new Date().getFullYear();
        const defaultSchedules = ["前期","後期","一般前期","一般後期","推薦","AO","その他"];
        const defaultYears = Array.from({ length: 8 }, (_, i) => String(curYear - i));
        const defaultCategories = ["長文","文法","語彙","英作文","会話","リスニング","その他"];
        const defaultSectionTypes = ["問題", "解答", "解説"];
        return json({
          schedules:    schedRow ? JSON.parse(schedRow.value)  : defaultSchedules,
          year_presets: yearRow  ? JSON.parse(yearRow.value)   : defaultYears,
          site_title:   titleRow ? JSON.parse(titleRow.value)  : undefined,
          markup_css:   cssRow   ? JSON.parse(cssRow.value)    : undefined,
          custom_domain: domainRow ? JSON.parse(domainRow.value) : undefined,
          site_subtitle: subtitleRow ? JSON.parse(subtitleRow.value) : undefined,
          question_categories: categoryRow ? JSON.parse(categoryRow.value) : defaultCategories,
          section_types: sectionTypesRow ? JSON.parse(sectionTypesRow.value) : defaultSectionTypes,
        }, 200, origin);
      }

      // ── PUT /api/config ────────────────────────────────────────────
      if (path === "/api/config" && request.method === "PUT") {
        await env.DB.exec(
          "CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
        );
        type ConfigBody = { schedules?: string[]; year_presets?: string[]; site_title?: string; markup_css?: string; custom_domain?: string; site_subtitle?: string; question_categories?: string[]; section_types?: string[] };
        const body = await request.json<ConfigBody>();
        const upsert = async (key: string, val: unknown) => {
          await env.DB.prepare(
            "INSERT INTO config (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
          ).bind(key, JSON.stringify(val)).run();
        };
        if (body.schedules     !== undefined) await upsert("schedules",     body.schedules);
        if (body.year_presets  !== undefined) await upsert("year_presets",  body.year_presets);
        if (body.site_title    !== undefined) await upsert("site_title",    body.site_title);
        if (body.markup_css    !== undefined) await upsert("markup_css",    body.markup_css);
        if (body.custom_domain !== undefined) await upsert("custom_domain", body.custom_domain);
        if (body.site_subtitle !== undefined) await upsert("site_subtitle", body.site_subtitle);
        if (body.question_categories !== undefined) await upsert("question_categories", body.question_categories);
        if (body.section_types !== undefined) await upsert("section_types", body.section_types);
        return json({ success: true }, 200, origin);
      }

      // ── DELETE /api/universities/:id ───────────────────────────────
      const delUniMatch = path.match(/^\/api\/universities\/(\d+)$/);
      if (delUniMatch && request.method === "DELETE") {
        const uniId = Number(delUniMatch[1]);
        const row = await env.DB.prepare(
          "SELECT COUNT(*) AS cnt FROM exams WHERE university_id = ?"
        ).bind(uniId).first<{ cnt: number }>();
        if (row && row.cnt > 0) {
          return json(
            { error: `試験が ${row.cnt} 件登録されています。先に試験を削除してください。` },
            400, origin
          );
        }
        await env.DB.prepare("DELETE FROM universities WHERE id = ?").bind(uniId).run();
        return json({ success: true }, 200, origin);
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
        await ensureCategoryColumn(env);
        type QBody = { questionNumber: number; category?: string; problemText: string; answerText: string; commentaryText: string };
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

        // 既存の試験を探す（大学・年度・方式が同じ）
        let exam = await env.DB.prepare(
          "SELECT id FROM exams WHERE university_id = ? AND year = ? AND schedule = ?"
        ).bind(uni.id, year, schedule).first<{ id: number }>();

        // 見つからなければ新規作成
        if (!exam) {
          exam = await env.DB.prepare(
            "INSERT INTO exams (university_id, year, schedule) VALUES (?, ?, ?) RETURNING *"
          ).bind(uni.id, year, schedule).first<{ id: number }>();
        }
        if (!exam) return json({ error: "Failed to create exam" }, 500, origin);

        const createdQuestions = [];
        for (const q of questions) {
          const created = await env.DB.prepare(`
            INSERT INTO questions (exam_id, question_number, category, problem_text, answer_text, commentary_text)
            VALUES (?, ?, ?, ?, ?, ?) RETURNING *
          `).bind(exam.id, q.questionNumber, q.category || "", q.problemText || "", q.answerText || "", q.commentaryText || "").first();
          if (created) createdQuestions.push(created);
        }

        return json({ exam: { ...exam, university_name: universityName }, questions: createdQuestions }, 201, origin);
      }

      // ── DELETE /api/questions/:examId/:questionNumber ──────────────
      const delQMatch = path.match(/^\/api\/questions\/(\d+)\/(\d+)$/);
      if (delQMatch && request.method === "DELETE") {
        const examId = Number(delQMatch[1]);
        const questionNumber = Number(delQMatch[2]);
        await env.DB.prepare("DELETE FROM questions WHERE exam_id = ? AND question_number = ?")
          .bind(examId, questionNumber).run();
        // 試験に大問が0件になったら試験ごと削除
        const remaining = await env.DB.prepare("SELECT COUNT(*) AS cnt FROM questions WHERE exam_id = ?")
          .bind(examId).first<{ cnt: number }>();
        if (remaining && remaining.cnt === 0) {
          await env.DB.prepare("DELETE FROM exams WHERE id = ?").bind(examId).run();
        }
        return json({ success: true }, 200, origin);
      }

      // ── DELETE /api/exams/:id ─────────────────────────────────────
      const examIdMatch = path.match(/^\/api\/exams\/(\d+)$/);
      if (examIdMatch && request.method === "DELETE") {
        const examId = Number(examIdMatch[1]);
        await env.DB.prepare("DELETE FROM questions WHERE exam_id = ?").bind(examId).run();
        await env.DB.prepare("DELETE FROM exams WHERE id = ?").bind(examId).run();
        return json({ success: true }, 200, origin);
      }

      // ── PUT /api/exams/:id ────────────────────────────────────────
      const putExamMatch = examIdMatch;
      if (putExamMatch && request.method === "PUT") {
        await ensureCategoryColumn(env);
        const examId = Number(putExamMatch[1]);
        type QBody = { questionNumber: number; category?: string; problemText: string; answerText: string; commentaryText: string };
        type PutBody = { universityName?: string; year?: number; schedule?: string; questions?: QBody[] };
        const body = await request.json<PutBody>();

        const existing = await env.DB.prepare("SELECT university_id FROM exams WHERE id = ?")
          .bind(examId).first<{ university_id: number }>();
        if (!existing) return json({ error: "Exam not found" }, 404, origin);

        if (body.universityName) {
          let uni = await env.DB.prepare("SELECT id FROM universities WHERE name = ?")
            .bind(body.universityName).first<{ id: number }>();
          if (!uni) uni = await env.DB.prepare(
            "INSERT INTO universities (name) VALUES (?) RETURNING id"
          ).bind(body.universityName).first<{ id: number }>();
          if (uni) await env.DB.prepare("UPDATE exams SET university_id = ? WHERE id = ?")
            .bind(uni.id, examId).run();
        }
        if (body.year !== undefined)
          await env.DB.prepare("UPDATE exams SET year = ? WHERE id = ?").bind(body.year, examId).run();
        if (body.schedule !== undefined)
          await env.DB.prepare("UPDATE exams SET schedule = ? WHERE id = ?").bind(body.schedule, examId).run();

        if (body.questions !== undefined) {
          await env.DB.prepare("DELETE FROM questions WHERE exam_id = ?").bind(examId).run();
          for (const q of body.questions) {
            await env.DB.prepare(
              "INSERT INTO questions (exam_id, question_number, category, problem_text, answer_text, commentary_text) VALUES (?, ?, ?, ?, ?, ?)"
            ).bind(examId, q.questionNumber, q.category || "", q.problemText || "", q.answerText || "", q.commentaryText || "").run();
          }
        }

        const updated = await env.DB.prepare(
          "SELECT e.id, e.year, e.schedule, u.name AS university_name FROM exams e JOIN universities u ON e.university_id = u.id WHERE e.id = ?"
        ).bind(examId).first();
        return json({ exam: updated }, 200, origin);
      }

      // ── GET /api/exams/:id ─────────────────────────────────────────
      if (examIdMatch && request.method === "GET") {
        await ensureCategoryColumn(env);
        const examId = Number(examIdMatch[1]);

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

      // ── GET /api/corpus ────────────────────────────────────────────
      // 全入試問題の英文テキストを一括返却（クライアント側コーパス分析用）
      if (path === "/api/corpus" && request.method === "GET") {
        const { results } = await env.DB.prepare(`
          SELECT q.id AS question_id, q.question_number,
                 q.problem_text, q.answer_text, q.commentary_text,
                 e.id AS exam_id, e.year, e.schedule,
                 u.name AS university_name
          FROM questions q
          JOIN exams e ON q.exam_id = e.id
          JOIN universities u ON e.university_id = u.id
          ORDER BY e.year DESC, u.name ASC, q.question_number ASC
        `).all();
        return json({ questions: results }, 200, origin);
      }

      // ── GET /api/search ────────────────────────────────────────────
      if (path === "/api/search" && request.method === "GET") {
        const word     = url.searchParams.get("word") || "";
        const uname    = url.searchParams.get("universityName") || "";
        const year     = url.searchParams.get("year") || "";
        const schedule = url.searchParams.get("schedule") || "";

        // 大問ごとに1行返す（exam_id + question_number で一意）
        let sql = `
          SELECT q.id AS question_id, q.question_number,
                 e.id AS exam_id, u.name AS university_name, e.year, e.schedule,
                 0 AS total_occurrences
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
        if (uname)    { sql += " AND u.name LIKE ?";    params.push(`%${uname}%`); }
        if (year)     { sql += " AND e.year = ?";       params.push(Number(year)); }
        if (schedule) { sql += " AND e.schedule = ?";   params.push(schedule); }

        sql += " ORDER BY e.year DESC, u.name ASC, q.question_number ASC";

        const { results: rows } = await env.DB.prepare(sql).bind(...params).all<Record<string, unknown>>();

        // キーワード検索時のみ大問ごとの出現回数を計算
        let enriched: Record<string, unknown>[] = rows;
        if (word) {
          const regex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
          enriched = await Promise.all(
            rows.map(async (row) => {
              const q = await env.DB.prepare(
                "SELECT problem_text, answer_text, commentary_text FROM questions WHERE id = ?"
              ).bind(row.question_id).first<{ problem_text: string; answer_text: string; commentary_text: string }>();
              const combined = q
                ? `${q.problem_text || ""} ${q.answer_text || ""} ${q.commentary_text || ""}`
                : "";
              const total_occurrences = (combined.match(regex) || []).length;
              return { ...row, total_occurrences };
            })
          );
          enriched.sort((a, b) => (b.total_occurrences as number) - (a.total_occurrences as number));
        }

        return json({ results: enriched }, 200, origin);
      }

      return json({ error: "Not found" }, 404, origin);
    } catch (err) {
      console.error("Worker error:", err);
      return json({ error: "Internal server error", message: String(err) }, 500, origin);
    }
  },
};
