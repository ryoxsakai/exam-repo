export interface McpEnv {
  DB: D1Database;
  EXAM_API_KEY?: string;
  EXAM_SESSION_SECRET?: string;
}

const MCP_SCOPE = "exams:read";
const TOKEN_AGE_MS = 60 * 60 * 1000;
const CODE_AGE_MS = 5 * 60 * 1000;

function baseUrl(url: URL) { return `${url.protocol}//${url.host}`; }
function response(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra } });
}
function rpc(id: unknown, result: unknown) { return response({ jsonrpc: "2.0", id, result }); }
function rpcError(id: unknown, code: number, message: string) { return response({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }); }
function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char] || char));
}
function html(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
function toBase64Url(bytes: Uint8Array) {
  let value = ""; for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(value: string) { return atob(value.replace(/-/g, "+").replace(/_/g, "/")); }
async function sign(env: McpEnv, value: string) {
  if (!env.EXAM_SESSION_SECRET) throw new Error("EXAM_SESSION_SECRET is not configured");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.EXAM_SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}
async function safeEqual(left: string, right: string) {
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([digest(left), digest(right)]); let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}
async function ensureSchema(env: McpEnv) {
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS mcp_oauth_clients (client_id TEXT PRIMARY KEY, redirect_uris TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS mcp_oauth_codes (code TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, code_challenge TEXT NOT NULL, scope TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')))"),
  ]);
}

async function registerClient(request: Request, env: McpEnv) {
  await ensureSchema(env); const body = await request.json<Record<string, unknown>>();
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!uris.length || uris.some((uri) => !uri.startsWith("https://"))) return response({ error: "invalid_client_metadata" }, 400);
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO mcp_oauth_clients (client_id, redirect_uris) VALUES (?, ?)").bind(id, JSON.stringify(uris)).run();
  return response({ client_id: id, token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code"] }, 201);
}
async function clientUris(env: McpEnv, id: string): Promise<string[]> {
  await ensureSchema(env); const row = await env.DB.prepare("SELECT redirect_uris FROM mcp_oauth_clients WHERE client_id = ?").bind(id).first<{ redirect_uris: string }>();
  try { return row ? JSON.parse(row.redirect_uris) : []; } catch { return []; }
}
function authError(message: string) {
  return html(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>入試データベース認証</title><body style="font-family:-apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif;max-width:560px;margin:48px auto;padding:0 20px"><h1>認証エラー</h1><p>${escapeHtml(message)}</p></body></html>`, 400);
}
function authForm(params: URLSearchParams) {
  const hidden = ["response_type", "client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "scope"].map((name) => `<input type="hidden" name="${name}" value="${escapeHtml(params.get(name))}">`).join("");
  return html(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>医学部入試DBを接続</title><body style="font-family:-apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif;max-width:560px;margin:48px auto;padding:0 20px"><h1>医学部入試DBをChatGPTに接続</h1><p>大学・試験・登録問題の読み取りを許可します。編集や削除は行いません。</p><form method="post"><label style="display:block;margin:24px 0 8px">EXAM APIキー</label><input name="api_key" type="password" required style="box-sizing:border-box;width:100%;padding:12px;font-size:16px">${hidden}<button type="submit" style="margin-top:24px;padding:12px 18px;font-size:16px">接続を許可</button></form></body></html>`);
}
async function authorize(request: Request, env: McpEnv, url: URL) {
  const p = request.method === "POST" ? new URLSearchParams(await request.text()) : url.searchParams;
  const cid = p.get("client_id") || "", redirect = p.get("redirect_uri") || "", challenge = p.get("code_challenge") || "", scope = p.get("scope") || MCP_SCOPE;
  const uris = await clientUris(env, cid);
  if (p.get("response_type") !== "code" || !uris.includes(redirect) || !challenge || p.get("code_challenge_method") !== "S256" || !scope.split(" ").includes(MCP_SCOPE)) return authError("認可リクエストが正しくありません。");
  if (request.method === "GET") return authForm(p);
  const supplied = p.get("api_key") || "";
  if (!env.EXAM_API_KEY || !supplied || !(await safeEqual(supplied, env.EXAM_API_KEY))) return authError("APIキーが正しくありません。");
  const code = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO mcp_oauth_codes (code, client_id, redirect_uri, code_challenge, scope, expires_at) VALUES (?, ?, ?, ?, ?, ?)").bind(code, cid, redirect, challenge, scope, Date.now() + CODE_AGE_MS).run();
  const dest = new URL(redirect); dest.searchParams.set("code", code); if (p.get("state")) dest.searchParams.set("state", p.get("state")!);
  return Response.redirect(dest.toString(), 302);
}
async function sha256(value: string) { return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))); }
async function token(request: Request, env: McpEnv) {
  await ensureSchema(env); const p = new URLSearchParams(await request.text()); const code = p.get("code") || "";
  const row = await env.DB.prepare("SELECT * FROM mcp_oauth_codes WHERE code = ?").bind(code).first<Record<string, any>>();
  const verifier = p.get("code_verifier") || "";
  if (!row || row.client_id !== p.get("client_id") || row.redirect_uri !== p.get("redirect_uri") || Number(row.expires_at) < Date.now() || !verifier || !(await safeEqual(await sha256(verifier), row.code_challenge))) return response({ error: "invalid_grant" }, 400);
  await env.DB.prepare("DELETE FROM mcp_oauth_codes WHERE code = ?").bind(code).run();
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify({ aud: "medical-exam-mcp", scope: row.scope, exp: Date.now() + TOKEN_AGE_MS })));
  return response({ access_token: `${payload}.${await sign(env, payload)}`, token_type: "Bearer", expires_in: TOKEN_AGE_MS / 1000, scope: row.scope });
}
async function verify(request: Request, env: McpEnv) {
  const match = (request.headers.get("Authorization") || "").match(/^Bearer (.+)$/); if (!match) return false;
  const [payload, sig] = match[1].split("."); if (!payload || !sig || sig !== await sign(env, payload)) return false;
  try { const data = JSON.parse(fromBase64Url(payload)); return data.aud === "medical-exam-mcp" && data.exp >= Date.now() && String(data.scope || "").split(" ").includes(MCP_SCOPE); } catch { return false; }
}
function limit(value: unknown, fallback = 50) { const n = Number(value); return Number.isFinite(n) ? Math.max(1, Math.min(100, Math.floor(n))) : fallback; }
function normalizeToolName(value: unknown) {
  const name = String(value ?? "");
  return name.split(".").pop() || name;
}

function extractMarkedSection(value: unknown, marker: string) {
  const text = String(value ?? "");
  const heading = `{{${marker}}}`;
  const start = text.indexOf(heading);
  if (start < 0) return "";

  const remainder = text.slice(start + heading.length);
  const nextHeading = remainder.search(/\n\s*\{\{[^{}\n]+\}\}\s*(?:\n|$)/);
  return (nextHeading >= 0 ? remainder.slice(0, nextHeading) : remainder).trim();
}

function optionalNonNegativeInteger(value: unknown, name: string) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${name} must be a non-negative integer`);
  return number;
}

function cleanPassageText(value: unknown) {
  return String(value ?? "")
    .replace(/##([\s\S]*?)::[\s\S]*?##/g, "$1")
    .replace(/!!!![\s\S]*?!!!!/g, " ")
    .replace(/~~[\s\S]*?~~/g, " ")
    .replace(/__([\s\S]*?)__/g, "$1")
    .replace(/==([\s\S]*?)==(?::[A-Za-z]+)?/g, "$1")
    .replace(/\[\[[\s\S]*?\]\]/g, " ")
    .replace(/\(\([\s\S]*?\)\)/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\^\^/g, "");
}

function countEnglishWords(value: unknown) {
  const words = cleanPassageText(value).match(/\p{Script=Latin}+(?:[’'-]\p{Script=Latin}+)*/gu);
  return words?.length || 0;
}

async function callTool(name: string, args: Record<string, unknown>, env: McpEnv) {
  if (name === "list_universities") {
    const q = String(args.query || ""); const rows = q
      ? await env.DB.prepare("SELECT id, name, reading, abbreviation FROM universities WHERE hidden = 0 AND (name LIKE ? OR reading LIKE ? OR abbreviation LIKE ?) ORDER BY name LIMIT ?").bind(`%${q}%`, `%${q}%`, `%${q}%`, limit(args.limit)).all()
      : await env.DB.prepare("SELECT id, name, reading, abbreviation FROM universities WHERE hidden = 0 ORDER BY name LIMIT ?").bind(limit(args.limit)).all();
    return { universities: rows.results };
  }
  if (name === "list_exams") {
    let sql = "SELECT e.id, e.year, e.schedule, u.name AS university_name FROM exams e JOIN universities u ON e.university_id = u.id WHERE u.hidden = 0"; const values: (string | number)[] = [];
    if (args.university_name) { sql += " AND u.name LIKE ?"; values.push(`%${String(args.university_name)}%`); }
    if (args.year) { sql += " AND e.year = ?"; values.push(Number(args.year)); }
    if (args.schedule) { sql += " AND e.schedule = ?"; values.push(String(args.schedule)); }
    sql += " ORDER BY e.year DESC, u.name ASC LIMIT ?"; values.push(limit(args.limit));
    return { exams: (await env.DB.prepare(sql).bind(...values).all()).results };
  }
  if (name === "get_exam") {
    const examId = Number(args.exam_id); if (!examId) throw new Error("exam_id is required");
    const exam = await env.DB.prepare("SELECT e.id, e.year, e.schedule, u.name AS university_name FROM exams e JOIN universities u ON e.university_id = u.id WHERE e.id = ?").bind(examId).first<Record<string, unknown>>();
    if (!exam) throw new Error("Exam not found");
    const questions = await env.DB.prepare("SELECT question_number, label, category, problem_text, answer_text, commentary_text FROM questions WHERE exam_id = ? ORDER BY question_number").bind(examId).all<Record<string, unknown>>();
    const enrichedQuestions = questions.results.map((question) => ({
      ...question,
      translation_text: extractMarkedSection(question.problem_text, "全訳"),
    }));
    return { exam: { ...exam, questions: enrichedQuestions } };
  }
  if (name === "get_question") {
    const examId = Number(args.exam_id), questionNumber = Number(args.question_number); if (!examId || !questionNumber) throw new Error("exam_id and question_number are required");
    const question = await env.DB.prepare("SELECT q.question_number, q.label, q.category, q.problem_text, q.answer_text, q.commentary_text, e.year, e.schedule, u.name AS university_name FROM questions q JOIN exams e ON q.exam_id = e.id JOIN universities u ON e.university_id = u.id WHERE q.exam_id = ? AND q.question_number = ?").bind(examId, questionNumber).first<Record<string, unknown>>();
    if (!question) throw new Error("Question not found");
    return {
      question: {
        ...question,
        translation_text: extractMarkedSection(question.problem_text, "全訳"),
      },
    };
  }
  if (name === "search_questions") {
    let sql = "SELECT q.id AS question_id, q.question_number, q.label, q.category, e.id AS exam_id, e.year, e.schedule, u.name AS university_name FROM questions q JOIN exams e ON q.exam_id = e.id JOIN universities u ON e.university_id = u.id WHERE u.hidden = 0"; const values: (string | number)[] = [];
    if (args.word) { const p = `%${String(args.word)}%`; sql += " AND (q.problem_text LIKE ? OR q.answer_text LIKE ? OR q.commentary_text LIKE ?)"; values.push(p, p, p); }
    if (args.university_name) { sql += " AND u.name LIKE ?"; values.push(`%${String(args.university_name)}%`); }
    if (args.year) { sql += " AND e.year = ?"; values.push(Number(args.year)); }
    if (args.schedule) { sql += " AND e.schedule = ?"; values.push(String(args.schedule)); }
    if (args.category) { sql += " AND q.category = ?"; values.push(String(args.category)); }
    sql += " ORDER BY e.year DESC, u.name ASC, q.question_number LIMIT ?"; values.push(limit(args.limit, 30));
    return { results: (await env.DB.prepare(sql).bind(...values).all()).results };
  }
  if (name === "search_passages") {
    const minWordCount = optionalNonNegativeInteger(args.min_word_count, "min_word_count") ?? 0;
    const maxWordCount = optionalNonNegativeInteger(args.max_word_count, "max_word_count");
    const yearFrom = optionalNonNegativeInteger(args.year_from, "year_from");
    const yearTo = optionalNonNegativeInteger(args.year_to, "year_to");
    if (maxWordCount !== null && minWordCount > maxWordCount) throw new Error("min_word_count must not exceed max_word_count");
    if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) throw new Error("year_from must not exceed year_to");

    const sort = String(args.sort || "year_desc");
    if (!["year_desc", "word_count_desc", "word_count_asc"].includes(sort)) throw new Error("sort is invalid");

    let sql = "SELECT q.id AS question_id, q.question_number, q.label, q.category, q.problem_text, e.id AS exam_id, e.year, e.schedule, u.name AS university_name FROM questions q JOIN exams e ON q.exam_id = e.id JOIN universities u ON e.university_id = u.id WHERE u.hidden = 0 AND q.category LIKE ?"; const values: (string | number)[] = ["%長文%"];
    if (args.university_name) { sql += " AND u.name LIKE ?"; values.push(`%${String(args.university_name)}%`); }
    if (yearFrom !== null) { sql += " AND e.year >= ?"; values.push(yearFrom); }
    if (yearTo !== null) { sql += " AND e.year <= ?"; values.push(yearTo); }
    if (args.schedule) { sql += " AND e.schedule = ?"; values.push(String(args.schedule)); }
    sql += " ORDER BY e.year DESC, u.name ASC, q.question_number";

    const keyword = String(args.keyword || "").trim().toLocaleLowerCase("en");
    const rows = await env.DB.prepare(sql).bind(...values).all<Record<string, unknown>>();
    const matches = rows.results.flatMap((row) => {
      const passageText = extractMarkedSection(row.problem_text, "本文");
      if (!passageText) return [];
      const searchableText = cleanPassageText(passageText);
      if (keyword && !searchableText.toLocaleLowerCase("en").includes(keyword)) return [];
      const wordCount = countEnglishWords(passageText);
      if (wordCount < minWordCount || (maxWordCount !== null && wordCount > maxWordCount)) return [];
      const { problem_text: _problemText, ...metadata } = row;
      return [{ ...metadata, word_count: wordCount }];
    });

    if (sort === "word_count_desc") matches.sort((a, b) => Number(b.word_count) - Number(a.word_count));
    if (sort === "word_count_asc") matches.sort((a, b) => Number(a.word_count) - Number(b.word_count));
    return { results: matches.slice(0, limit(args.limit, 30)), matched_count: matches.length };
  }
  throw new Error("Unknown tool");
}

const TOOLS = [
  { name: "list_universities", title: "大学一覧", description: "登録されている大学を検索・一覧取得します。", inputSchema: { type: "object", properties: { query: { type: "string", description: "大学名・よみ・略称の部分一致" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false } },
  { name: "list_exams", title: "試験一覧", description: "大学名・年度・方式で登録済み試験を絞り込みます。", inputSchema: { type: "object", properties: { university_name: { type: "string" }, year: { type: "integer" }, schedule: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false } },
  { name: "search_questions", title: "問題検索", description: "問題・解答・解説のキーワードと大学・年度・方式・カテゴリで大問を検索します。結果の本文が必要ならget_questionを続けて使います。", inputSchema: { type: "object", properties: { word: { type: "string" }, university_name: { type: "string" }, year: { type: "integer" }, schedule: { type: "string" }, category: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false } },
  { name: "search_passages", title: "長文語数検索", description: "長文問題を本文の英語語数で検索します。{{本文}}セクションのみを対象にし、設問・選択肢・解答・全訳・解説・語注の日本語部分・マークアップは語数から除外します。大学名・年度範囲・方式・本文キーワードでも絞り込めます。", inputSchema: { type: "object", properties: { min_word_count: { type: "integer", minimum: 0, description: "本文の最低語数" }, max_word_count: { type: "integer", minimum: 0, description: "本文の最大語数" }, university_name: { type: "string" }, year_from: { type: "integer", minimum: 0 }, year_to: { type: "integer", minimum: 0 }, schedule: { type: "string" }, keyword: { type: "string", description: "英語本文内の部分一致キーワード" }, sort: { type: "string", enum: ["year_desc", "word_count_desc", "word_count_asc"], default: "year_desc" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false } },
  { name: "get_exam", title: "試験詳細", description: "exam_idを指定し、試験内の全大問・解答・全訳・解説を取得します。返却テキストはデータベース原文です。原文を求められた場合は要約や言い換えをせず、そのまま表示してください。", inputSchema: { type: "object", properties: { exam_id: { type: "integer" } }, required: ["exam_id"], additionalProperties: false } },
  { name: "get_question", title: "大問詳細", description: "exam_idと大問番号を指定し、問題・解答・全訳・解説を取得します。返却テキストはデータベース原文です。原文を求められた場合は要約や言い換えをせず、そのまま表示してください。", inputSchema: { type: "object", properties: { exam_id: { type: "integer" }, question_number: { type: "integer" } }, required: ["exam_id", "question_number"], additionalProperties: false } },
].map((tool) => ({ ...tool, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }));

async function mcp(request: Request, env: McpEnv, url: URL) {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  let msg: any; try { msg = await request.json(); } catch { return rpcError(null, -32700, "Parse error"); }
  if (msg.method === "initialize") return rpc(msg.id, {
    protocolVersion: msg.params?.protocolVersion || "2025-06-18",
    capabilities: { tools: {} },
    serverInfo: { name: "medical-exam", version: "1.0.0" },
    instructions: [
      "Use these read-only tools to search and retrieve the user's Japanese medical school entrance-exam database.",
      "The problem_text, answer_text, translation_text, and commentary_text fields contain canonical database text.",
      "When the user requests database content, reproduce only the requested fields verbatim.",
      "Do not summarize, rewrite, correct, translate, or omit database text unless the user explicitly requests it.",
      "Preserve all custom markup exactly as stored.",
    ].join(" "),
  });
  if (msg.method === "notifications/initialized") return new Response(null, { status: 202 });
  if (msg.method === "tools/list") return rpc(msg.id, { tools: TOOLS });
  if (msg.method !== "tools/call") return rpcError(msg.id, -32601, "Method not found");
  if (!(await verify(request, env))) return response({ error: "unauthorized" }, 401, { "WWW-Authenticate": `Bearer resource_metadata="${baseUrl(url)}/.well-known/oauth-protected-resource", scope="${MCP_SCOPE}"` });
  try { const result = await callTool(normalizeToolName(msg.params?.name), msg.params?.arguments || {}, env); return rpc(msg.id, { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, isError: false }); }
  catch (error) { return rpc(msg.id, { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true }); }
}

export async function handleMcpRoute(request: Request, env: McpEnv): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname, root = baseUrl(url);
  if (path === "/.well-known/oauth-protected-resource" && request.method === "GET") return response({ resource: `${root}/mcp`, authorization_servers: [root], scopes_supported: [MCP_SCOPE] });
  if (path === "/.well-known/oauth-authorization-server" && request.method === "GET") return response({ issuer: root, authorization_endpoint: `${root}/oauth/authorize`, token_endpoint: `${root}/oauth/token`, registration_endpoint: `${root}/oauth/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code"], token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"], scopes_supported: [MCP_SCOPE] });
  if (path === "/oauth/register" && request.method === "POST") return registerClient(request, env);
  if (path === "/oauth/authorize" && (request.method === "GET" || request.method === "POST")) return authorize(request, env, url);
  if (path === "/oauth/token" && request.method === "POST") return token(request, env);
  if (path === "/mcp") return mcp(request, env, url);
  return null;
}
