import PrintSettings from "../assets/js/print-settings.js";

// One layout per account/favorite folder. No mutations to favorites or source exams.
export async function handlePrintProfile(request: Request, db: any, uid: string | null, folder: string) {
  const fail = (error: string, status: number) => ({status, body: {error}});
  if (!uid) return fail("ログインが必要です。", 401);
  if (!/^(0|[1-9]\d*)$/.test(folder) || !Number.isSafeInteger(Number(folder))) return fail("フォルダが不正です。", 400);
  if (!["GET", "PUT"].includes(request.method)) return fail("対応していない操作です。", 405);
  if (folder !== "0") {
    const owned = await db.prepare("SELECT id FROM favorite_folders WHERE id=? AND uid=? AND kind!='section'").bind(Number(folder),uid).first();
    if (!owned) return fail("フォルダが見つかりません。", 404);
  }
  await db.prepare(`CREATE TABLE IF NOT EXISTS favorite_print_profiles (
    uid TEXT NOT NULL, folder_id INTEGER NOT NULL, settings TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(uid,folder_id))`).run();
  const read = () => db.prepare("SELECT settings,revision FROM favorite_print_profiles WHERE uid=? AND folder_id=?").bind(uid,Number(folder)).first();
  const output = (row: any) => ({settings: row ? JSON.parse(row.settings) : null, revision: row?.revision || 0});
  if (request.method === "GET") return {status:200, body:output(await read())};
  const reader = request.body?.getReader();
  let raw = "";
  if (reader) {
    const decoder = new TextDecoder();
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      raw += decoder.decode(value,{stream:true});
      if (raw.length > 20000) { await reader.cancel(); return fail("入力が大きすぎます。",413); }
    }
    raw += decoder.decode();
  }
  let body: any;
  try { body=JSON.parse(raw); } catch { return fail("入力形式が不正です。",400); }
  if (!body || Object.keys(body).some(k=>!["settings","revision"].includes(k)) || !PrintSettings.valid(body.settings) || !Number.isSafeInteger(body.revision) || body.revision<0) return fail("印刷設定が不正です。",400);
  const settings = JSON.stringify(body.settings);
  const row = body.revision === 0
    ? await db.prepare("INSERT INTO favorite_print_profiles(uid,folder_id,settings) VALUES (?,?,?) ON CONFLICT(uid,folder_id) DO NOTHING RETURNING settings,revision").bind(uid,Number(folder),settings).first()
    : await db.prepare("UPDATE favorite_print_profiles SET settings=?,revision=revision+1 WHERE uid=? AND folder_id=? AND revision=? RETURNING settings,revision").bind(settings,uid,Number(folder),body.revision).first();
  if (!row) return fail("別端末で更新されたか、保存結果が未確認です。フォルダを開き直してから再保存してください。",409);
  return {status:200,body:output(row)};
}
