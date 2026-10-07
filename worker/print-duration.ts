// Print metadata is separate from exam/question edits and favorite user settings.
const schema = [
  `CREATE TABLE IF NOT EXISTS university_print_durations (
    university_id INTEGER PRIMARY KEY REFERENCES universities(id) ON DELETE CASCADE,
    minutes INTEGER NOT NULL CHECK (minutes BETWEEN 1 AND 1440))`,
  `CREATE TABLE IF NOT EXISTS exam_print_durations (
    exam_id INTEGER PRIMARY KEY REFERENCES exams(id) ON DELETE CASCADE,
    minutes INTEGER NOT NULL CHECK (minutes BETWEEN 1 AND 1440))`,
];

export async function ensurePrintDurationSchema(db: any) {
  await db.batch(schema.map(sql => db.prepare(sql)));
}

// Plans are applied in the same D1 transaction as moves/deletes. A conflicting
// concurrent destination write deliberately violates CHECK rather than overwriting.
export async function planUniversityPrintDurationMerge(db: any, sourceId: number, targetId: number) {
  await ensurePrintDurationSchema(db);
  const source = await db.prepare("SELECT minutes FROM university_print_durations WHERE university_id = ?").bind(sourceId).first();
  const target = await db.prepare("SELECT minutes FROM university_print_durations WHERE university_id = ?").bind(targetId).first();
  if (source && target && source.minutes !== target.minutes) return null;
  return db.prepare(`INSERT INTO university_print_durations (university_id, minutes)
    SELECT ?, minutes FROM university_print_durations WHERE university_id = ?
    ON CONFLICT(university_id) DO UPDATE SET minutes =
      CASE WHEN university_print_durations.minutes = excluded.minutes THEN excluded.minutes ELSE 0 END`).bind(targetId, sourceId);
}

async function readExamPrintDuration(db: any, id: number) {
  return db.prepare(`SELECT COALESCE(ed.minutes, ud.minutes) AS minutes, ed.minutes AS override
    FROM exams e LEFT JOIN exam_print_durations ed ON ed.exam_id = e.id
    LEFT JOIN university_print_durations ud ON ud.university_id = e.university_id WHERE e.id = ?`).bind(id).first();
}

export async function planExamPrintDurationMerge(db: any, sourceId: number, targetId: number) {
  await ensurePrintDurationSchema(db);
  const source = await readExamPrintDuration(db, sourceId);
  const target = await readExamPrintDuration(db, targetId);
  if (source?.minutes != null && target?.minutes != null && source.minutes !== target.minutes) return null;
  return db.prepare(`WITH src AS (
      SELECT COALESCE(ed.minutes, ud.minutes) AS minutes, ed.minutes AS override
      FROM exams e LEFT JOIN exam_print_durations ed ON ed.exam_id = e.id
      LEFT JOIN university_print_durations ud ON ud.university_id = e.university_id WHERE e.id = ?
    ), dst AS (
      SELECT COALESCE(ed.minutes, ud.minutes) AS minutes
      FROM exams e LEFT JOIN exam_print_durations ed ON ed.exam_id = e.id
      LEFT JOIN university_print_durations ud ON ud.university_id = e.university_id WHERE e.id = ?
    ) INSERT INTO exam_print_durations (exam_id, minutes)
    SELECT ?, CASE WHEN dst.minutes IS NOT NULL AND src.minutes != dst.minutes THEN 0 ELSE src.minutes END
    FROM src CROSS JOIN dst WHERE src.minutes IS NOT NULL
      AND (src.override IS NOT NULL OR dst.minutes IS NULL OR src.minutes != dst.minutes)
    ON CONFLICT(exam_id) DO UPDATE SET minutes =
      CASE WHEN exam_print_durations.minutes = excluded.minutes THEN excluded.minutes ELSE 0 END`).bind(sourceId, targetId, targetId);
}

export async function planExamPrintDurationMove(db: any, sourceId: number, targetUniversityId: number) {
  await ensurePrintDurationSchema(db);
  return db.prepare(`INSERT INTO exam_print_durations (exam_id, minutes)
    SELECT e.id, source.minutes FROM exams e
    JOIN university_print_durations source ON source.university_id = e.university_id
    LEFT JOIN university_print_durations target ON target.university_id = ?
    LEFT JOIN exam_print_durations ed ON ed.exam_id = e.id
    WHERE e.id = ? AND ed.minutes IS NULL AND (target.minutes IS NULL OR source.minutes != target.minutes)
    ON CONFLICT(exam_id) DO UPDATE SET minutes =
      CASE WHEN exam_print_durations.minutes = excluded.minutes THEN excluded.minutes ELSE 0 END`).bind(targetUniversityId, sourceId);
}

export async function handlePrintDuration(request: Request, db: any, examId: number) {
  if (!["GET", "PUT"].includes(request.method)) return { status: 405, body: { error: "Method not allowed" } };
  const exam = await db.prepare("SELECT id, university_id FROM exams WHERE id = ?").bind(examId).first();
  if (!exam) return { status: 404, body: { error: "Exam not found" } };
  let body: any;
  if (request.method === "PUT") {
    try { body = await request.json(); } catch { return { status: 400, body: { error: "Invalid JSON" } }; }
    const keys = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : [];
    if (!keys.length || keys.some(key => !["university_minutes", "exam_minutes"].includes(key)) ||
        keys.some(key => body[key] !== null && (!Number.isInteger(body[key]) || body[key] < 1 || body[key] > 1440))) {
      return { status: 400, body: { error: "時間は1〜1440の整数（分）、解除はnullで指定してください。" } };
    }
  }
  // Additive, idempotent migration; no existing canonical or favorite columns change.
  await ensurePrintDurationSchema(db);
  if (body) {
    const writes = [];
    for (const [key, table, column, id] of [
      ["university_minutes", "university_print_durations", "university_id", exam.university_id],
      ["exam_minutes", "exam_print_durations", "exam_id", exam.id],
    ] as const) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
      writes.push(body[key] === null
        ? db.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).bind(id)
        : db.prepare(`INSERT INTO ${table} (${column}, minutes) VALUES (?, ?) ON CONFLICT(${column}) DO UPDATE SET minutes = excluded.minutes`).bind(id, body[key]));
    }
    await db.batch(writes);
  }
  const university = await db.prepare("SELECT minutes FROM university_print_durations WHERE university_id = ?").bind(exam.university_id).first();
  const override = await db.prepare("SELECT minutes FROM exam_print_durations WHERE exam_id = ?").bind(exam.id).first();
  return { status: 200, body: { exam_id: exam.id, university_id: exam.university_id,
    university_minutes: university?.minutes ?? null, exam_minutes: override?.minutes ?? null,
    effective_minutes: override?.minutes ?? university?.minutes ?? null,
    source: override ? "exam" : university ? "university" : "unset" } };
}

export async function handleUniversityPrintDuration(request: Request, db: D1Database, universityId: number) {
  if (!["GET", "PUT"].includes(request.method)) return { status: 405, body: { error: "Method not allowed" } };
  const university = await db.prepare("SELECT id FROM universities WHERE id = ?").bind(universityId).first();
  if (!university) return { status: 404, body: { error: "University not found" } };
  let minutes: number | null | undefined;
  if (request.method === "PUT") {
    const body = await request.json().catch(() => null) as { university_minutes?: unknown } | null;
    const value = body?.university_minutes;
    if (!body || Array.isArray(body) || Object.keys(body).length !== 1 ||
        (value !== null && (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 1440))) {
      return { status: 400, body: { error: "時間は1〜1440の整数（分）、解除はnullで指定してください。" } };
    }
    minutes = value as number | null;
  }
  await ensurePrintDurationSchema(db);
  if (minutes !== undefined) {
    await (minutes === null
      ? db.prepare("DELETE FROM university_print_durations WHERE university_id = ?").bind(universityId)
      : db.prepare("INSERT INTO university_print_durations (university_id, minutes) VALUES (?, ?) ON CONFLICT(university_id) DO UPDATE SET minutes = excluded.minutes").bind(universityId, minutes)).run();
  }
  const duration = await db.prepare("SELECT minutes FROM university_print_durations WHERE university_id = ?").bind(universityId).first<{minutes: number}>();
  return { status: 200, body: { university_id: universityId, university_minutes: duration?.minutes ?? null } };
}
