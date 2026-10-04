// Print metadata is separate from exam/question edits and favorite user settings.
const schema = [
  `CREATE TABLE IF NOT EXISTS university_print_durations (
    university_id INTEGER PRIMARY KEY REFERENCES universities(id) ON DELETE CASCADE,
    minutes INTEGER NOT NULL CHECK (minutes BETWEEN 1 AND 1440))`,
  `CREATE TABLE IF NOT EXISTS exam_print_durations (
    exam_id INTEGER PRIMARY KEY REFERENCES exams(id) ON DELETE CASCADE,
    minutes INTEGER NOT NULL CHECK (minutes BETWEEN 1 AND 1440))`,
];

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
  await db.batch(schema.map(sql => db.prepare(sql)));
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
