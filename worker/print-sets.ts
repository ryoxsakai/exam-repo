// User-owned print metadata only. Exam references deliberately have no cascading
// FK: a removed exam must remain visible as a broken reference, never disappear.
export const printSetSchema = `CREATE TABLE IF NOT EXISTS print_sets (
  uid TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL,
  exam_ids TEXT NOT NULL, cover TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL, PRIMARY KEY (uid, id))`;

function output(row: any) {
  return { id: row.id, name: row.name, exam_ids: JSON.parse(row.exam_ids),
    cover: JSON.parse(row.cover), revision: row.revision,
    archived: !!row.archived, updated_at: row.updated_at };
}
const validId = (id: unknown): id is string => typeof id === "string" && /^[a-zA-Z0-9-]{16,64}$/.test(id);

export async function handlePrintSets(request: Request, db: any, uid: string | null, id?: string) {
  const error = (message: string, status: number) => ({ status, body: { error: message } });
  if (!uid) return error("ログインが必要です。", 401);
  if (id !== undefined && !validId(id)) return error("印刷セットIDが不正です。", 400);
  if (!["GET", "POST", "PUT"].includes(request.method) ||
      (request.method === "POST" && id) || (request.method === "PUT" && !id)) return error("対応していない操作です。", 405);
  await db.prepare(printSetSchema).run();
  const read = () => db.prepare("SELECT * FROM print_sets WHERE uid = ? AND id = ?").bind(uid, id).first();
  if (request.method === "GET") {
    if (id) {
      const row = await read();
      return row ? { status: 200, body: { print_set: output(row) } } : error("印刷セットが見つかりません。", 404);
    }
    const rows = await db.prepare("SELECT * FROM print_sets WHERE uid = ? ORDER BY updated_at DESC, id").bind(uid).all();
    return { status: 200, body: { print_sets: rows.results.map(output) } };
  }
  let b: any;
  try {
    const raw = await request.text();
    if (raw.length > 40000) return error("印刷セットが大きすぎます。", 400);
    b = JSON.parse(raw);
  } catch { return error("入力形式が不正です。", 400); }
  if (!b || Array.isArray(b) || typeof b !== "object" ||
      Object.keys(b).some(k => !["id", "name", "exam_ids", "cover", "revision", "archived"].includes(k)) ||
      typeof b.name !== "string" || !b.name.trim() || b.name.length > 120 ||
      !Array.isArray(b.exam_ids) || !b.exam_ids.length || b.exam_ids.length > 100 ||
      b.exam_ids.some((v: unknown) => !Number.isSafeInteger(v) || Number(v) < 1) ||
      new Set(b.exam_ids).size !== b.exam_ids.length ||
      !b.cover || typeof b.cover !== "object" || Array.isArray(b.cover) ||
      Object.keys(b.cover).some(k => !["lines", "time"].includes(k)) ||
      !Array.isArray(b.cover.lines) || b.cover.lines.length !== 3 ||
      b.cover.lines.some((v: unknown) => typeof v !== "string" || v.length > 120) ||
      typeof b.cover.time !== "string" || b.cover.time.length > 120 ||
      (b.archived !== undefined && typeof b.archived !== "boolean")) return error("名前・試験選択・表紙の入力を確認してください（最大100試験）。", 400);
  if (request.method === "POST") {
    if (!validId(b.id) || (b.revision !== undefined && b.revision !== 1) || b.archived) return error("新規印刷セットの入力が不正です。", 400);
    id = b.id;
  } else if (!Number.isSafeInteger(b.revision) || b.revision < 1 || (b.id !== undefined && b.id !== id)) {
    return error("版番号が不正です。", 400);
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
    await db.prepare(`INSERT INTO print_sets (uid,id,name,exam_ids,cover,updated_at)
      VALUES (?,?,?,?,?,?) ON CONFLICT(uid,id) DO NOTHING`).bind(uid,id,name,ids,cover,new Date().toISOString()).run();
    row = await read();
    if (row.name !== name || row.exam_ids !== ids || row.cover !== cover || row.revision !== 1 || row.archived) return error("同じIDの保存内容が変わっています。保存一覧から読み直してください。", 409);
  } else {
    // UPDATE ... RETURNING is the atomic compare-and-swap, including archive/restore.
    row = await db.prepare(`UPDATE print_sets SET name=?,exam_ids=?,cover=?,archived=?,revision=revision+1,updated_at=?
      WHERE uid=? AND id=? AND revision=? RETURNING *`)
      .bind(name,ids,cover,b.archived ? 1 : 0,new Date().toISOString(),uid,id,b.revision).first();
    if (!row) return error("別端末で更新されたか保存結果が未確認です。入力を保持しています。保存一覧から読み直すか、新しいセットとして保存してください。", 409);
  }
  return { status: 200, body: { print_set: output(row) } };
}
