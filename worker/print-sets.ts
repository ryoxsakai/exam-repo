// User-owned print metadata only. Exam references deliberately have no cascading
// FK: a removed exam must remain visible as a broken reference, never disappear.
export const printSetSchema = `CREATE TABLE IF NOT EXISTS print_sets (
  uid TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL,
  exam_ids TEXT NOT NULL, cover TEXT NOT NULL, question_selection TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL, PRIMARY KEY (uid, id))`;

function output(row: any) {
  return { id: row.id, name: row.name, exam_ids: JSON.parse(row.exam_ids),
    cover: JSON.parse(row.cover), question_selection: JSON.parse(row.question_selection || "{}"), revision: row.revision,
    archived: !!row.archived, updated_at: row.updated_at };
}
const validId = (id: unknown): id is string => typeof id === "string" && /^[a-zA-Z0-9-]{16,64}$/.test(id);

export async function handlePrintSets(request: Request, db: any, uid: string | null, id?: string) {
  const error = (message: string, status: number) => ({ status, body: { error: message } });
  if (!uid) return error("ログインが必要です。", 401);
  if (id !== undefined && id !== "reorder" && !validId(id)) return error("印刷セットIDが不正です。", 400);
  if (!["GET", "POST", "PUT"].includes(request.method) ||
      (request.method === "POST" && id && id !== "reorder") || (request.method === "PUT" && !id)) return error("対応していない操作です。", 405);
  await db.prepare(printSetSchema).run();
  // Additive migration for sets saved before question selections were included.
  const columns = await db.prepare("PRAGMA table_info(print_sets)").all();
  if (!columns.results.some((column: any) => column.name === "question_selection")) {
    try { await db.prepare("ALTER TABLE print_sets ADD COLUMN question_selection TEXT NOT NULL DEFAULT '{}'").run(); }
    catch (e) {
      const current = await db.prepare("PRAGMA table_info(print_sets)").all();
      if (!current.results.some((column: any) => column.name === "question_selection")) throw e;
    }
  }
  await db.prepare("CREATE TABLE IF NOT EXISTS print_set_order (uid TEXT PRIMARY KEY, ids TEXT NOT NULL DEFAULT '[]', revision INTEGER NOT NULL DEFAULT 0)").run();
  await db.prepare("INSERT INTO print_set_order(uid) VALUES (?) ON CONFLICT(uid) DO NOTHING").bind(uid).run();
  if (id === "reorder") {
    if (request.method !== "POST") return error("対応していない操作です。", 405);
    let body: any;
    try { const raw = await request.text(); if (raw.length > 40000) return error("入力が大きすぎます。", 400); body = JSON.parse(raw); }
    catch { return error("入力形式が不正です。", 400); }
    if (!body || !Array.isArray(body.ids) || body.ids.some((v: any) => !validId(v)) ||
        new Set(body.ids).size !== body.ids.length || !Number.isSafeInteger(body.revision) || body.revision < 0 ||
        Object.keys(body).some(k => !["ids", "revision"].includes(k))) return error("並び順の入力が不正です。", 400);
    // One atomic metadata write. Also guard against sets added on another device.
    const row = await db.prepare(`UPDATE print_set_order SET ids=?, revision=revision+1 WHERE uid=? AND revision=?
      AND (SELECT COUNT(*) FROM print_sets WHERE uid=?) = ?
      AND NOT EXISTS (SELECT 1 FROM json_each(?) j WHERE NOT EXISTS (SELECT 1 FROM print_sets s WHERE s.uid=? AND s.id=j.value)) RETURNING *`)
      .bind(JSON.stringify(body.ids), uid, body.revision, uid, body.ids.length, JSON.stringify(body.ids), uid).first();
    return row ? {status: 200, body: {order_revision: row.revision}} : error("別端末で一覧や並び順が更新されました。並び順を保持しています。「キャンセル」で並べ替えを取り消し、一覧を再読込してから再試行してください。", 409);
  }
  const read = () => db.prepare("SELECT * FROM print_sets WHERE uid = ? AND id = ?").bind(uid, id).first();
  if (request.method === "GET") {
    if (id) {
      const row = await read();
      return row ? { status: 200, body: { print_set: output(row) } } : error("印刷セットが見つかりません。", 404);
    }
    const rows = await db.prepare("SELECT * FROM print_sets WHERE uid = ? ORDER BY updated_at DESC, id").bind(uid).all();
    const order = await db.prepare("SELECT * FROM print_set_order WHERE uid=?").bind(uid).first();
    const ids: string[] = JSON.parse(order.ids);
    const rank = (id: string) => { const i = ids.indexOf(id); return i < 0 ? ids.length : i; };
    rows.results.sort((a: any, b: any) => rank(a.id) - rank(b.id));
    return { status: 200, body: { print_sets: rows.results.map(output), order_revision: order.revision } };
  }
  let b: any;
  try {
    const raw = await request.text();
    if (raw.length > 40000) return error("印刷セットが大きすぎます。", 400);
    b = JSON.parse(raw);
  } catch { return error("入力形式が不正です。", 400); }
  if (!b || Array.isArray(b) || typeof b !== "object" ||
      Object.keys(b).some(k => !["id", "name", "exam_ids", "cover", "revision", "archived", "question_selection"].includes(k)) ||
      typeof b.name !== "string" || !b.name.trim() || b.name.length > 120 ||
      !Array.isArray(b.exam_ids) || !b.exam_ids.length || b.exam_ids.length > 100 ||
      b.exam_ids.some((v: unknown) => !Number.isSafeInteger(v) || Number(v) < 1) ||
      new Set(b.exam_ids).size !== b.exam_ids.length ||
      !b.cover || typeof b.cover !== "object" || Array.isArray(b.cover) ||
      Object.keys(b.cover).some(k => !["lines", "time", "sizes", "colors"].includes(k)) ||
      !Array.isArray(b.cover.lines) || (b.cover.lines.length < 3 || b.cover.lines.length > 20) ||
      ["sizes", "colors"].some(k => b.cover[k] !== undefined && (!Array.isArray(b.cover[k]) || b.cover[k].length > b.cover.lines.length || b.cover[k].some((v: any) => v !== null && (!Number.isInteger(v) || v < 1 || v > 5)))) ||
      b.cover.lines.some((v: unknown) => typeof v !== "string" || v.length > 120) ||
      typeof b.cover.time !== "string" || b.cover.time.length > 120 ||
      (b.archived !== undefined && typeof b.archived !== "boolean")) return error("名前・試験選択・表紙の入力を確認してください（最大100試験）。", 400);
  if (b.question_selection !== undefined && (!b.question_selection || typeof b.question_selection !== "object" ||
      Array.isArray(b.question_selection) || Object.keys(b.question_selection).length > 2000 ||
      Object.entries(b.question_selection).some(([key, value]) => {
        const parts = key.split(":");
        return !/^[1-9]\d*:[1-9]\d*$/.test(key) || !Number.isSafeInteger(Number(parts[1])) ||
          !b.exam_ids.includes(Number(parts[0])) || typeof value !== "boolean";
      }))) return error("大問選択の入力を確認してください。", 400);
  if (request.method === "POST") {
    if (!validId(b.id) || (b.revision !== undefined && b.revision !== 1) || b.archived) return error("新規印刷セットの入力が不正です。", 400);
    id = b.id;
  } else if (!Number.isSafeInteger(b.revision) || b.revision < 1 || (b.id !== undefined && b.id !== id)) {
    return error("版番号が不正です。", 400);
  }
  const previous = request.method === "PUT" ? await read() : null;
  // Old clients omit this optional field; keep existing selections on their updates.
  const selections = b.question_selection === undefined ? JSON.parse(previous?.question_selection || "{}") : b.question_selection;
  const questions = JSON.stringify(Object.fromEntries(Object.keys(selections).sort()
    .filter(key => b.exam_ids.includes(Number(key.split(":")[0]))).map(key => [key, selections[key]])));
  const previousCover = JSON.parse(previous?.cover || "{}");
  for (const key of ["sizes", "colors"]) {
    if (b.cover[key] === undefined && Array.isArray(previousCover[key])) b.cover[key] = previousCover[key].slice(0, b.cover.lines.length);
  }
  const ids = JSON.stringify(b.exam_ids), cover = JSON.stringify(b.cover), name = b.name.trim();
  // Archiving broken references is allowed. Saving/restoring an active set must
  // identify every exam; the client also verifies the complete fetched content.
  if (!b.archived) {
    const found = await db.prepare(`SELECT id FROM exams WHERE id IN (${b.exam_ids.map(() => "?").join(",")})`).bind(...b.exam_ids).all();
    const present = new Set(found.results.map((r: any) => r.id));
    const missing = b.exam_ids.filter((v: number) => !present.has(v));
    if (missing.length) return error("取得できない試験があります：" + missing.join(", "), 409);
  }
  let row: any;
  if (request.method === "POST") {
    // Stable client ID makes a repeated create safe after a lost response.
    await db.prepare(`INSERT INTO print_sets (uid,id,name,exam_ids,cover,question_selection,updated_at)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(uid,id) DO NOTHING`).bind(uid,id,name,ids,cover,questions,new Date().toISOString()).run();
    row = await read();
    if (row.name !== name || row.exam_ids !== ids || row.cover !== cover || row.question_selection !== questions || row.revision !== 1 || row.archived) return error("同じIDの保存内容が変わっています。保存一覧から読み直してください。", 409);
  } else {
    // UPDATE ... RETURNING is the atomic compare-and-swap, including archive/restore.
    row = await db.prepare(`UPDATE print_sets SET name=?,exam_ids=?,cover=?,question_selection=?,archived=?,revision=revision+1,updated_at=?
      WHERE uid=? AND id=? AND revision=? RETURNING *`)
      .bind(name,ids,cover,questions,b.archived ? 1 : 0,new Date().toISOString(),uid,id,b.revision).first();
    if (!row) return error("別端末で更新されたか保存結果が未確認です。入力を保持しています。保存一覧から読み直すか、新しいセットとして保存してください。", 409);
  }
  return { status: 200, body: { print_set: output(row) } };
}
