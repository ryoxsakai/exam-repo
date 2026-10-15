// Print metadata is separate from exam/question edits and favorite user settings.
const schema = [
  `CREATE TABLE IF NOT EXISTS university_schedule_print_durations (
    university_id INTEGER NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
    schedule TEXT NOT NULL,
    minutes INTEGER NOT NULL CHECK (minutes BETWEEN 1 AND 1440),
    PRIMARY KEY (university_id, schedule))`,
  `CREATE TABLE IF NOT EXISTS university_print_time_labels (
    university_id INTEGER PRIMARY KEY REFERENCES universities(id) ON DELETE CASCADE,
    combined INTEGER NOT NULL CHECK (combined IN (0, 1)))`,
  `CREATE TABLE IF NOT EXISTS university_print_durations (
    university_id INTEGER PRIMARY KEY REFERENCES universities(id) ON DELETE CASCADE,
    minutes INTEGER NOT NULL CHECK (minutes BETWEEN 1 AND 1440))`,
  `CREATE TABLE IF NOT EXISTS exam_print_durations (
    exam_id INTEGER PRIMARY KEY REFERENCES exams(id) ON DELETE CASCADE,
    minutes INTEGER NOT NULL CHECK (minutes BETWEEN 1 AND 1440))`,
];

const schemaTasks = new WeakMap<object, Promise<void>>();
export function ensurePrintDurationSchema(db: any): Promise<void> {
  let task = schemaTasks.get(db);
  if (!task) {
    task = Promise.resolve().then(() => db.batch(schema.map(sql => db.prepare(sql)))).then(() => {}).catch(err => {
      schemaTasks.delete(db);
      throw err;
    });
    schemaTasks.set(db, task);
  }
  return task;
}

export function planUniversitySchedulePrintDurationMerge(db: any, sourceId: number, targetId: number) {
  return db.prepare(`INSERT INTO university_schedule_print_durations (university_id, schedule, minutes)
    SELECT ?, schedule, minutes FROM university_schedule_print_durations WHERE university_id = ?
    ON CONFLICT(university_id, schedule) DO UPDATE SET minutes =
      CASE WHEN university_schedule_print_durations.minutes = excluded.minutes THEN excluded.minutes ELSE 0 END`).bind(targetId, sourceId);
}

export function planUniversityPrintLabelMerge(db: any, sourceId: number, targetId: number) {
  return db.prepare(`INSERT INTO university_print_time_labels (university_id, combined)
    SELECT ?, combined FROM university_print_time_labels WHERE university_id = ?
    ON CONFLICT(university_id) DO NOTHING`).bind(targetId, sourceId);
}

async function readCombined(db: any, universityId: number) {
  const label = await db.prepare("SELECT combined FROM university_print_time_labels WHERE university_id = ?").bind(universityId).first();
  return label?.combined === 1;
}

// Plans are applied in the same D1 transaction as moves/deletes. A conflicting
// concurrent destination write deliberately violates CHECK rather than overwriting.
export async function planUniversityPrintDurationMerge(db: any, sourceId: number, targetId: number) {
  await ensurePrintDurationSchema(db);
  const source = await db.prepare("SELECT minutes FROM university_print_durations WHERE university_id = ?").bind(sourceId).first();
  const target = await db.prepare("SELECT minutes FROM university_print_durations WHERE university_id = ?").bind(targetId).first();
  if (source && target && source.minutes !== target.minutes) return null;
  const conflict = await db.prepare(`SELECT 1 FROM university_schedule_print_durations s
    JOIN university_schedule_print_durations t ON s.schedule = t.schedule
    WHERE s.university_id = ? AND t.university_id = ? AND s.minutes != t.minutes LIMIT 1`).bind(sourceId, targetId).first();
  if (conflict) return null;
  return db.prepare(`INSERT INTO university_print_durations (university_id, minutes)
    SELECT ?, minutes FROM university_print_durations WHERE university_id = ?
    ON CONFLICT(university_id) DO UPDATE SET minutes =
      CASE WHEN university_print_durations.minutes = excluded.minutes THEN excluded.minutes ELSE 0 END`).bind(targetId, sourceId);
}

async function readExamPrintDuration(db: any, id: number) {
  return db.prepare(`SELECT COALESCE(ed.minutes, sd.minutes, ud.minutes) AS minutes, ed.minutes AS override
    FROM exams e LEFT JOIN exam_print_durations ed ON ed.exam_id = e.id
    LEFT JOIN university_schedule_print_durations sd ON sd.university_id = e.university_id AND sd.schedule = e.schedule
    LEFT JOIN university_print_durations ud ON ud.university_id = e.university_id WHERE e.id = ?`).bind(id).first();
}

export async function planExamPrintDurationMerge(db: any, sourceId: number, targetId: number) {
  await ensurePrintDurationSchema(db);
  const source = await readExamPrintDuration(db, sourceId);
  const target = await readExamPrintDuration(db, targetId);
  if (source?.minutes != null && target?.minutes != null && source.minutes !== target.minutes) return null;
  return db.prepare(`WITH src AS (
      SELECT COALESCE(ed.minutes, sd.minutes, ud.minutes) AS minutes, ed.minutes AS override
      FROM exams e LEFT JOIN exam_print_durations ed ON ed.exam_id = e.id
      LEFT JOIN university_schedule_print_durations sd ON sd.university_id = e.university_id AND sd.schedule = e.schedule
    LEFT JOIN university_print_durations ud ON ud.university_id = e.university_id WHERE e.id = ?
    ), dst AS (
      SELECT COALESCE(ed.minutes, sd.minutes, ud.minutes) AS minutes
      FROM exams e LEFT JOIN exam_print_durations ed ON ed.exam_id = e.id
      LEFT JOIN university_schedule_print_durations sd ON sd.university_id = e.university_id AND sd.schedule = e.schedule
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
    SELECT e.id, COALESCE(ss.minutes, source.minutes) FROM exams e
    LEFT JOIN university_schedule_print_durations ss ON ss.university_id = e.university_id AND ss.schedule = e.schedule
    LEFT JOIN university_print_durations source ON source.university_id = e.university_id
    LEFT JOIN university_print_durations target ON target.university_id = ?
    LEFT JOIN university_schedule_print_durations ts ON ts.university_id = ? AND ts.schedule = e.schedule
    LEFT JOIN exam_print_durations ed ON ed.exam_id = e.id
    WHERE e.id = ? AND ed.minutes IS NULL AND COALESCE(ss.minutes, source.minutes) IS NOT NULL AND (COALESCE(ts.minutes, target.minutes) IS NULL OR COALESCE(ss.minutes, source.minutes) != COALESCE(ts.minutes, target.minutes))
    ON CONFLICT(exam_id) DO UPDATE SET minutes =
      CASE WHEN exam_print_durations.minutes = excluded.minutes THEN excluded.minutes ELSE 0 END`).bind(targetUniversityId, targetUniversityId, sourceId);
}

export async function handlePrintDuration(request: Request, db: any, examId: number) {
  if (!["GET", "PUT"].includes(request.method)) return { status: 405, body: { error: "Method not allowed" } };
  const exam = await db.prepare("SELECT id, university_id, schedule FROM exams WHERE id = ?").bind(examId).first();
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
  const schedule = await db.prepare("SELECT minutes FROM university_schedule_print_durations WHERE university_id = ? AND schedule = ?").bind(exam.university_id, exam.schedule).first();
  const override = await db.prepare("SELECT minutes FROM exam_print_durations WHERE exam_id = ?").bind(exam.id).first();
  return { status: 200, body: { exam_id: exam.id, university_id: exam.university_id,
    combined: await readCombined(db, exam.university_id),
    university_minutes: university?.minutes ?? null, exam_minutes: override?.minutes ?? null,
    schedule_minutes: schedule?.minutes ?? null,
    effective_minutes: override?.minutes ?? schedule?.minutes ?? university?.minutes ?? null,
    source: override ? "exam" : schedule ? "schedule" : university ? "university" : "unset" } };
}

export async function handleUniversityPrintDuration(request: Request, db: D1Database, universityId: number) {
  if (!["GET", "PUT"].includes(request.method)) return { status: 405, body: { error: "Method not allowed" } };
  const university = await db.prepare("SELECT id FROM universities WHERE id = ?").bind(universityId).first();
  if (!university) return { status: 404, body: { error: "University not found" } };
  let minutes: number | null | undefined;
  let combined: boolean | undefined;
  let schedules: Record<string, number | null> | undefined;
  if (request.method === "PUT") {
    const body = await request.json().catch(() => null) as { university_minutes?: unknown; combined?: unknown; schedules?: unknown } | null;
    const value = body?.university_minutes;
    if (!body || Array.isArray(body) || !Object.keys(body).length || Object.keys(body).some(key => !["university_minutes", "combined", "schedules"].includes(key)) ||
        (body.combined !== undefined && typeof body.combined !== "boolean") ||
        (value !== undefined && value !== null && (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 1440))) {
      return { status: 400, body: { error: "時間は1〜1440の整数（分）、解除はnullで指定してください。" } };
    }
    if (body.schedules !== undefined && (!body.schedules || typeof body.schedules !== "object" || Array.isArray(body.schedules) || Object.entries(body.schedules).some(([key, val]) => !key || key.length > 120 || (val !== null && (typeof val !== "number" || !Number.isInteger(val) || val < 1 || val > 1440))))) {
      return { status: 400, body: { error: "方式別の時間は1〜1440の整数（分）、解除はnullで指定してください。" } };
    }
    schedules = body.schedules as Record<string, number | null> | undefined;
    minutes = value as number | null | undefined;
    combined = body.combined as boolean | undefined;
  }
  await ensurePrintDurationSchema(db);
  const writes = [];
  if (minutes !== undefined) {
    writes.push(minutes === null
      ? db.prepare("DELETE FROM university_print_durations WHERE university_id = ?").bind(universityId)
      : db.prepare("INSERT INTO university_print_durations (university_id, minutes) VALUES (?, ?) ON CONFLICT(university_id) DO UPDATE SET minutes = excluded.minutes").bind(universityId, minutes));
  }
  if (combined !== undefined) writes.push(db.prepare("INSERT INTO university_print_time_labels (university_id, combined) VALUES (?, ?) ON CONFLICT(university_id) DO UPDATE SET combined = excluded.combined").bind(universityId, combined ? 1 : 0));
  if (schedules) for (const [schedule, value] of Object.entries(schedules)) {
    writes.push(value === null
      ? db.prepare("DELETE FROM university_schedule_print_durations WHERE university_id = ? AND schedule = ?").bind(universityId, schedule)
      : db.prepare("INSERT INTO university_schedule_print_durations (university_id, schedule, minutes) VALUES (?, ?, ?) ON CONFLICT(university_id, schedule) DO UPDATE SET minutes = excluded.minutes").bind(universityId, schedule, value));
  }
  if (writes.length) await db.batch(writes);
  const duration = await db.prepare("SELECT minutes FROM university_print_durations WHERE university_id = ?").bind(universityId).first<{minutes: number}>();
  const { results: scheduleRows } = await db.prepare(`SELECT schedule, minutes FROM university_schedule_print_durations WHERE university_id = ?
    UNION ALL SELECT DISTINCT e.schedule, NULL AS minutes FROM exams e WHERE e.university_id = ?
    AND NOT EXISTS (SELECT 1 FROM university_schedule_print_durations d WHERE d.university_id = e.university_id AND d.schedule = e.schedule)
    ORDER BY schedule`).bind(universityId, universityId).all();
  return { status: 200, body: { schedules: scheduleRows, university_id: universityId, university_minutes: duration?.minutes ?? null, combined: await readCombined(db, universityId) } };
}
