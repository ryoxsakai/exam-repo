export interface McpEnv {
  DB: D1Database;
  EXAM_API_KEY?: string;
  EXAM_SESSION_SECRET?: string;
}

const MCP_SCOPE = "exams:read";
const MCP_WRITE_SCOPE = "exams:write";
const MCP_DEFAULT_SCOPE = `${MCP_SCOPE} ${MCP_WRITE_SCOPE}`;
const MCP_SUPPORTED_SCOPES = [MCP_SCOPE, MCP_WRITE_SCOPE];
const TOKEN_AGE_MS = 60 * 60 * 1000;
const CODE_AGE_MS = 5 * 60 * 1000;
const AUDIT_AGE_MS = 30 * 60 * 1000;

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
    env.DB.prepare("CREATE TABLE IF NOT EXISTS mcp_question_audits (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, question_id INTEGER NOT NULL, exam_id INTEGER NOT NULL, question_number INTEGER NOT NULL, target_field TEXT NOT NULL, storage_field TEXT NOT NULL, reason TEXT NOT NULL, issue_codes TEXT NOT NULL, original_target_text TEXT NOT NULL, original_storage_text TEXT NOT NULL, original_storage_hash TEXT NOT NULL, proposed_target_text TEXT, proposed_storage_text TEXT, proposal_hash TEXT, status TEXT NOT NULL DEFAULT 'audited', expires_at INTEGER NOT NULL, prepared_at INTEGER, used_at INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')))"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS mcp_question_changes (id TEXT PRIMARY KEY, audit_id TEXT NOT NULL UNIQUE, client_id TEXT NOT NULL, question_id INTEGER NOT NULL, exam_id INTEGER NOT NULL, question_number INTEGER NOT NULL, target_field TEXT NOT NULL, storage_field TEXT NOT NULL, reason TEXT NOT NULL, before_text TEXT NOT NULL, after_text TEXT NOT NULL, before_hash TEXT NOT NULL, after_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_mcp_question_audits_question ON mcp_question_audits(question_id, created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_mcp_question_changes_question ON mcp_question_changes(question_id, created_at)"),
  ]);
  await env.DB.prepare("DELETE FROM mcp_question_audits WHERE status != 'applied' AND expires_at < ?").bind(Date.now() - 7 * 24 * 60 * 60 * 1000).run();
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
  const writeRequested = String(params.get("scope") || MCP_DEFAULT_SCOPE).split(" ").includes(MCP_WRITE_SCOPE);
  const permissionText = writeRequested
    ? "大学・試験・登録問題の読み取りと、監査・差分確認を完了した問題だけの修正を許可します。削除は行いません。"
    : "大学・試験・登録問題の読み取りを許可します。編集や削除は行いません。";
  return html(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>医学部入試DBを接続</title><body style="font-family:-apple-system,BlinkMacSystemFont,'Noto Sans JP',sans-serif;max-width:560px;margin:48px auto;padding:0 20px"><h1>医学部入試DBをChatGPTに接続</h1><p>${permissionText}</p><form method="post"><label style="display:block;margin:24px 0 8px">EXAM APIキー</label><input name="api_key" type="password" required style="box-sizing:border-box;width:100%;padding:12px;font-size:16px">${hidden}<button type="submit" style="margin-top:24px;padding:12px 18px;font-size:16px">接続を許可</button></form></body></html>`);
}
async function authorize(request: Request, env: McpEnv, url: URL) {
  const p = request.method === "POST" ? new URLSearchParams(await request.text()) : url.searchParams;
  const cid = p.get("client_id") || "", redirect = p.get("redirect_uri") || "", challenge = p.get("code_challenge") || "", scope = p.get("scope") || MCP_DEFAULT_SCOPE;
  const requestedScopes = Array.from(new Set(scope.split(" ").filter(Boolean)));
  const uris = await clientUris(env, cid);
  if (p.get("response_type") !== "code" || !uris.includes(redirect) || !challenge || p.get("code_challenge_method") !== "S256" || !requestedScopes.includes(MCP_SCOPE) || requestedScopes.some((item) => !MCP_SUPPORTED_SCOPES.includes(item))) return authError("認可リクエストが正しくありません。");
  if (request.method === "GET") return authForm(p);
  const supplied = p.get("api_key") || "";
  if (!env.EXAM_API_KEY || !supplied || !(await safeEqual(supplied, env.EXAM_API_KEY))) return authError("APIキーが正しくありません。");
  const code = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO mcp_oauth_codes (code, client_id, redirect_uri, code_challenge, scope, expires_at) VALUES (?, ?, ?, ?, ?, ?)").bind(code, cid, redirect, challenge, requestedScopes.join(" "), Date.now() + CODE_AGE_MS).run();
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
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify({ aud: "medical-exam-mcp", client_id: row.client_id, scope: row.scope, exp: Date.now() + TOKEN_AGE_MS })));
  return response({ access_token: `${payload}.${await sign(env, payload)}`, token_type: "Bearer", expires_in: TOKEN_AGE_MS / 1000, scope: row.scope });
}
type McpAuth = { client_id: string; scope: string; exp: number };
async function verify(request: Request, env: McpEnv): Promise<McpAuth | null> {
  const match = (request.headers.get("Authorization") || "").match(/^Bearer (.+)$/); if (!match) return null;
  const [payload, sig] = match[1].split("."); if (!payload || !sig || sig !== await sign(env, payload)) return null;
  try {
    const data = JSON.parse(fromBase64Url(payload));
    if (data.aud !== "medical-exam-mcp" || data.exp < Date.now() || !String(data.scope || "").split(" ").includes(MCP_SCOPE)) return null;
    return { client_id: String(data.client_id || ""), scope: String(data.scope || ""), exp: Number(data.exp) };
  } catch { return null; }
}
function hasScope(auth: McpAuth | null, scope: string) { return Boolean(auth && auth.scope.split(" ").includes(scope)); }
function limit(value: unknown, fallback = 50) { const n = Number(value); return Number.isFinite(n) ? Math.max(1, Math.min(100, Math.floor(n))) : fallback; }
function normalizeToolName(value: unknown) {
  let candidate = value;
  if (candidate && typeof candidate === "object" && "name" in candidate) {
    candidate = (candidate as { name?: unknown }).name;
  } else if (typeof candidate === "string" && candidate.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && "name" in parsed) candidate = parsed.name;
    } catch {
      // Keep a non-JSON string unchanged so the normal unknown-tool error remains useful.
    }
  }
  const name = String(candidate ?? "");
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

function extractDelimitedSections(value: unknown, delimiter: string) {
  const text = String(value ?? "");
  const sections: string[] = [];
  let position = 0;

  while (position < text.length) {
    const start = text.indexOf(delimiter, position);
    if (start < 0) break;
    const end = text.indexOf(delimiter, start + delimiter.length);
    if (end < 0) break;

    const section = text.slice(start + delimiter.length, end).trim();
    if (section) sections.push(section);
    position = end + delimiter.length;
  }

  return sections;
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

function englishWords(value: unknown) {
  return cleanPassageText(value).match(/\p{Script=Latin}+(?:[’'-]\p{Script=Latin}+)*/gu) || [];
}

function countEnglishWords(value: unknown) {
  return englishWords(value).length;
}

function countEnglishSentences(value: unknown) {
  const text = cleanPassageText(value).replace(/\s+/g, " ").trim();
  if (!text) return 0;
  const segments = text.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) || [];
  return segments.filter((segment) => countEnglishWords(segment) > 0).length;
}

function countEnglishParagraphs(value: unknown) {
  return cleanPassageText(value)
    .split(/\n\s*\n+/)
    .filter((paragraph) => countEnglishWords(paragraph) > 0)
    .length;
}

function countWordSyllables(value: string) {
  return value.split(/[’'-]+/).reduce((total, part) => {
    const word = part.toLocaleLowerCase("en").replace(/[^a-z]/g, "");
    if (!word) return total;
    if (word.length <= 3) return total + 1;

    let syllables = (word.match(/[aeiouy]+/g) || []).length;
    if (word.endsWith("e") && !/[aeiouy]le$/.test(word)) syllables -= 1;
    if (/(?:es|ed)$/.test(word) && !/(?:ted|ded|ses|zes|ches|shes)$/.test(word)) syllables -= 1;
    return total + Math.max(1, syllables);
  }, 0);
}

function roundMetric(value: number) {
  return Math.round(value * 10) / 10;
}

function analyzePassageText(value: unknown) {
  const words = englishWords(value);
  const wordCount = words.length;
  const sentenceCount = countEnglishSentences(value);
  const paragraphCount = countEnglishParagraphs(value);
  const syllableCount = words.reduce((total, word) => total + countWordSyllables(word), 0);
  const wordsPerSentence = sentenceCount ? wordCount / sentenceCount : 0;
  const syllablesPerWord = wordCount ? syllableCount / wordCount : 0;

  return {
    word_count: wordCount,
    sentence_count: sentenceCount,
    paragraph_count: paragraphCount,
    average_sentence_length: roundMetric(wordsPerSentence),
    flesch_reading_ease: wordCount && sentenceCount
      ? roundMetric(206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord)
      : null,
    flesch_kincaid_grade: wordCount && sentenceCount
      ? roundMetric(0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59)
      : null,
    readability_note: "可読性指標は英語の音節数をヒューリスティックに推定した参考値であり、入試問題の難易度そのものを示すものではありません。",
  };
}

function sampleRandom<T>(values: T[], count: number, random = Math.random) {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled.slice(0, count);
}

const QUESTION_FORMAT_DEFINITIONS = {
  long_passage: "長文読解",
  blank_fill: "空所補充",
  multiple_choice: "選択式",
  japanese_translation: "和訳",
  english_composition: "英作文・英訳",
  word_order: "語句整序",
  content_matching: "内容一致",
  summary: "要約",
  explanation: "説明・理由記述",
  title_selection: "題名選択",
} as const;

type QuestionFormatCode = keyof typeof QUESTION_FORMAT_DEFINITIONS;

function countPattern(value: string, pattern: RegExp) {
  return Array.from(value.matchAll(pattern)).length;
}

function analyzeQuestionFormatRecord(row: Record<string, unknown>) {
  const problemText = String(row.problem_text ?? "");
  const trailingSection = problemText.search(/\{\{(?:全訳|解答|解説)\}\}/);
  const taskText = trailingSection >= 0 ? problemText.slice(0, trailingSection) : problemText;
  const questionSection = extractMarkedSection(taskText, "設問");
  const instructionText = questionSection || taskText;
  const markerCounts = {
    blank: countPattern(taskText, /\[\[[\s\S]*?\]\]/g),
    choice: countPattern(taskText, /\(\([\s\S]*?\)\)/g),
    underline: countPattern(taskText, /__([\s\S]*?)__/g),
    highlight: countPattern(taskText, /==([\s\S]*?)==(?::[A-Za-z]+)?/g),
  };

  const formats: QuestionFormatCode[] = [];
  const add = (code: QuestionFormatCode, matched: boolean) => {
    if (matched) formats.push(code);
  };

  add("long_passage", Boolean(extractMarkedSection(taskText, "本文")));
  add("blank_fill", markerCounts.blank > 0 || /(?:空所|空欄)[^。\n]{0,30}(?:補|入|選)/.test(instructionText));
  add("multiple_choice", markerCounts.choice > 0 || /(?:選択肢|選びなさい|選べ)/.test(instructionText));
  add("japanese_translation", /(?:和訳|日本語に訳|日本語訳|訳しなさい)/.test(instructionText));
  add("english_composition", /(?:英作文|英訳|英語に訳|英語で(?:書|答))/.test(instructionText));
  add("word_order", /(?:並べ替|並べかえ|並び替|語順|正しい順序)/.test(instructionText));
  add("content_matching", /(?:内容と一致|内容に一致|本文の内容|内容に合う|内容に最も)/.test(instructionText));
  add("summary", /(?:要約|要旨)/.test(instructionText));
  add("explanation", /(?:理由を|説明しなさい|説明せよ|具体的に説明)/.test(instructionText));
  add("title_selection", /(?:題名|タイトル|表題)/.test(instructionText));

  return { formats, marker_counts: markerCounts };
}

function buildQuestionFormatGroups(rows: Record<string, unknown>[]) {
  type FormatGroup = {
    university_name: string;
    year: number;
    schedule: string;
    exam_ids: Set<number>;
    question_count: number;
    category_counts: Record<string, number>;
    format_question_counts: Record<string, number>;
    marker_counts: { blank: number; choice: number; underline: number; highlight: number };
  };

  const groups = new Map<string, FormatGroup>();
  for (const row of rows) {
    const universityName = String(row.university_name ?? "");
    const year = Number(row.year);
    const schedule = String(row.schedule ?? "");
    const key = JSON.stringify([universityName, year, schedule]);
    let group = groups.get(key);
    if (!group) {
      group = {
        university_name: universityName,
        year,
        schedule,
        exam_ids: new Set<number>(),
        question_count: 0,
        category_counts: {},
        format_question_counts: {},
        marker_counts: { blank: 0, choice: 0, underline: 0, highlight: 0 },
      };
      groups.set(key, group);
    }

    const analysis = analyzeQuestionFormatRecord(row);
    group.exam_ids.add(Number(row.exam_id));
    group.question_count += 1;
    const category = String(row.category || "未分類");
    group.category_counts[category] = (group.category_counts[category] || 0) + 1;
    for (const format of analysis.formats) {
      group.format_question_counts[format] = (group.format_question_counts[format] || 0) + 1;
    }
    for (const marker of Object.keys(group.marker_counts) as Array<keyof typeof group.marker_counts>) {
      group.marker_counts[marker] += analysis.marker_counts[marker];
    }
  }

  return Array.from(groups.values()).map((group) => ({
    university_name: group.university_name,
    year: group.year,
    schedule: group.schedule,
    exam_count: group.exam_ids.size,
    question_count: group.question_count,
    category_counts: group.category_counts,
    format_question_counts: group.format_question_counts,
    marker_counts: group.marker_counts,
  })).sort((a, b) =>
    a.university_name.localeCompare(b.university_name, "ja")
    || b.year - a.year
    || a.schedule.localeCompare(b.schedule, "ja")
  );
}

type TrendComparisonCriteria = {
  label: string;
  university_name?: string;
  year_from: number | null;
  year_to: number | null;
  schedule?: string;
  category?: string;
  passage_only: boolean;
};

function parseTrendComparisonCriteria(value: unknown, defaultLabel: string): TrendComparisonCriteria {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${defaultLabel} comparison criteria are required`);
  const input = value as Record<string, unknown>;
  const yearFrom = optionalNonNegativeInteger(input.year_from, `${defaultLabel}.year_from`);
  const yearTo = optionalNonNegativeInteger(input.year_to, `${defaultLabel}.year_to`);
  if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) throw new Error(`${defaultLabel}.year_from must not exceed ${defaultLabel}.year_to`);

  return {
    label: String(input.label || defaultLabel),
    university_name: input.university_name ? String(input.university_name) : undefined,
    year_from: yearFrom,
    year_to: yearTo,
    schedule: input.schedule ? String(input.schedule) : undefined,
    category: input.category ? String(input.category) : undefined,
    passage_only: input.passage_only === true,
  };
}

async function loadTrendComparisonRows(criteria: TrendComparisonCriteria, env: McpEnv) {
  let sql = "SELECT q.id AS question_id, q.category, q.problem_text, e.id AS exam_id, e.year, e.schedule, u.name AS university_name FROM questions q JOIN exams e ON q.exam_id = e.id JOIN universities u ON e.university_id = u.id WHERE u.hidden = 0"; const values: (string | number)[] = [];
  if (criteria.university_name) { sql += " AND u.name LIKE ?"; values.push(`%${criteria.university_name}%`); }
  if (criteria.year_from !== null) { sql += " AND e.year >= ?"; values.push(criteria.year_from); }
  if (criteria.year_to !== null) { sql += " AND e.year <= ?"; values.push(criteria.year_to); }
  if (criteria.schedule) { sql += " AND e.schedule = ?"; values.push(criteria.schedule); }
  if (criteria.category) { sql += " AND q.category = ?"; values.push(criteria.category); }
  sql += " ORDER BY u.name ASC, e.year DESC, e.schedule ASC, q.question_number";

  const rows = (await env.DB.prepare(sql).bind(...values).all<Record<string, unknown>>()).results;
  return criteria.passage_only
    ? rows.filter((row) => Boolean(extractMarkedSection(row.problem_text, "本文")))
    : rows;
}

function percentageRecord(counts: Record<string, number>, total: number) {
  return Object.fromEntries(Object.entries(counts).map(([key, count]) => [key, total ? roundMetric(count / total * 100) : 0]));
}

function buildTrendComparisonSnapshot(rows: Record<string, unknown>[]) {
  const examIds = new Set<number>();
  const categoryCounts: Record<string, number> = {};
  const formatQuestionCounts: Record<string, number> = {};
  const passageWordCounts: number[] = [];

  for (const row of rows) {
    examIds.add(Number(row.exam_id));
    const category = String(row.category || "未分類");
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;

    const analysis = analyzeQuestionFormatRecord(row);
    for (const format of analysis.formats) {
      formatQuestionCounts[format] = (formatQuestionCounts[format] || 0) + 1;
    }

    const passageText = extractMarkedSection(row.problem_text, "本文");
    if (passageText) passageWordCounts.push(countEnglishWords(passageText));
  }

  const examCount = examIds.size;
  const questionCount = rows.length;
  const passageCount = passageWordCounts.length;
  const totalPassageWords = passageWordCounts.reduce((total, count) => total + count, 0);
  return {
    exam_count: examCount,
    question_count: questionCount,
    questions_per_exam: examCount ? roundMetric(questionCount / examCount) : null,
    category_counts: categoryCounts,
    category_rate_percent: percentageRecord(categoryCounts, questionCount),
    format_question_counts: formatQuestionCounts,
    format_question_rate_percent: percentageRecord(formatQuestionCounts, questionCount),
    passage_count: passageCount,
    passage_rate_percent: questionCount ? roundMetric(passageCount / questionCount * 100) : null,
    passage_word_count: passageCount ? {
      total: totalPassageWords,
      average: roundMetric(totalPassageWords / passageCount),
      minimum: Math.min(...passageWordCounts),
      maximum: Math.max(...passageWordCounts),
    } : null,
  };
}

function numericRecordDifference(left: Record<string, number>, right: Record<string, number>) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return Object.fromEntries(Array.from(keys).sort().map((key) => [key, roundMetric((right[key] || 0) - (left[key] || 0))]));
}

function nullableDifference(left: number | null, right: number | null) {
  return left === null || right === null ? null : roundMetric(right - left);
}

function buildTrendComparisonDifference(
  left: ReturnType<typeof buildTrendComparisonSnapshot>,
  right: ReturnType<typeof buildTrendComparisonSnapshot>,
) {
  return {
    direction: "right_minus_left",
    exam_count: right.exam_count - left.exam_count,
    question_count: right.question_count - left.question_count,
    questions_per_exam: nullableDifference(left.questions_per_exam, right.questions_per_exam),
    passage_count: right.passage_count - left.passage_count,
    passage_rate_percentage_points: nullableDifference(left.passage_rate_percent, right.passage_rate_percent),
    average_passage_word_count: nullableDifference(left.passage_word_count?.average ?? null, right.passage_word_count?.average ?? null),
    category_counts: numericRecordDifference(left.category_counts, right.category_counts),
    category_rate_percentage_points: numericRecordDifference(left.category_rate_percent, right.category_rate_percent),
    format_question_counts: numericRecordDifference(left.format_question_counts, right.format_question_counts),
    format_question_rate_percentage_points: numericRecordDifference(left.format_question_rate_percent, right.format_question_rate_percent),
  };
}

function buildExamTrends(rows: Record<string, unknown>[], passageOnly = false) {
  type TrendAccumulator = {
    university_name: string;
    year: number;
    schedule: string;
    exam_ids: Set<number>;
    question_count: number;
    category_counts: Record<string, number>;
    passage_word_counts: number[];
  };

  const groups = new Map<string, TrendAccumulator>();
  for (const row of rows) {
    const passageText = extractMarkedSection(row.problem_text, "本文");
    if (passageOnly && !passageText) continue;

    const universityName = String(row.university_name ?? "");
    const year = Number(row.year);
    const schedule = String(row.schedule ?? "");
    const key = JSON.stringify([universityName, year, schedule]);
    let group = groups.get(key);
    if (!group) {
      group = {
        university_name: universityName,
        year,
        schedule,
        exam_ids: new Set<number>(),
        question_count: 0,
        category_counts: {},
        passage_word_counts: [],
      };
      groups.set(key, group);
    }

    group.exam_ids.add(Number(row.exam_id));
    group.question_count += 1;
    const category = String(row.category || "未分類");
    group.category_counts[category] = (group.category_counts[category] || 0) + 1;
    if (passageText) group.passage_word_counts.push(countEnglishWords(passageText));
  }

  return Array.from(groups.values()).map((group) => {
    const totalWordCount = group.passage_word_counts.reduce((total, count) => total + count, 0);
    const passageCount = group.passage_word_counts.length;
    return {
      university_name: group.university_name,
      year: group.year,
      schedule: group.schedule,
      exam_count: group.exam_ids.size,
      question_count: group.question_count,
      category_counts: group.category_counts,
      passage_count: passageCount,
      passage_word_count: passageCount ? {
        total: totalWordCount,
        average: roundMetric(totalWordCount / passageCount),
        minimum: Math.min(...group.passage_word_counts),
        maximum: Math.max(...group.passage_word_counts),
      } : null,
    };
  }).sort((a, b) =>
    a.university_name.localeCompare(b.university_name, "ja")
    || b.year - a.year
    || a.schedule.localeCompare(b.schedule, "ja")
  );
}

const ENGLISH_FUNCTION_WORDS = new Set(`
a about above after again against all am an and any are as at
be because been before being below between both but by
can could did do does doing down during each few for from further
had has have having he her here hers herself him himself his how
i if in into is it its itself just me more most my myself
no nor not now of off on once only or other our ours ourselves out over own
same she should so some such than that the their theirs them themselves then
there these they this those through to too under until up very
was we were what when where which while who whom why will with would
you your yours yourself yourselves
`.trim().split(/\s+/));

function normalizeVocabularyToken(value: string) {
  return value.toLocaleLowerCase("en").replace(/’/g, "'");
}

function movingAverageTypeTokenRatio(tokens: string[], requestedWindowSize = 50) {
  if (!tokens.length) return { value_percent: null, window_size: 0 };
  const windowSize = Math.min(requestedWindowSize, tokens.length);
  if (tokens.length === windowSize) {
    return { value_percent: roundMetric(new Set(tokens).size / tokens.length * 100), window_size: windowSize };
  }

  let total = 0;
  let windowCount = 0;
  for (let start = 0; start <= tokens.length - windowSize; start += 1) {
    total += new Set(tokens.slice(start, start + windowSize)).size / windowSize;
    windowCount += 1;
  }
  return { value_percent: roundMetric(total / windowCount * 100), window_size: windowSize };
}

function buildVocabularyProfile(
  passages: Array<{ passage_text: string }>,
  topN: number,
  minFrequency: number,
  includeStopwords: boolean,
) {
  const frequencies = new Map<string, number>();
  const documentFrequencies = new Map<string, number>();
  const tokens: string[] = [];

  for (const passage of passages) {
    const documentTokens = englishWords(passage.passage_text).map(normalizeVocabularyToken);
    tokens.push(...documentTokens);
    const documentTypes = new Set(documentTokens);
    for (const token of documentTokens) frequencies.set(token, (frequencies.get(token) || 0) + 1);
    for (const type of documentTypes) documentFrequencies.set(type, (documentFrequencies.get(type) || 0) + 1);
  }

  const tokenCount = tokens.length;
  const typeCount = frequencies.size;
  const hapaxCount = Array.from(frequencies.values()).filter((count) => count === 1).length;
  const contentTokenCount = tokens.filter((token) => !ENGLISH_FUNCTION_WORDS.has(token)).length;
  const totalLetters = tokens.reduce((total, token) => total + token.replace(/[^\p{Script=Latin}]/gu, "").length, 0);
  const mattr = movingAverageTypeTokenRatio(tokens);

  const frequentWords = Array.from(frequencies.entries())
    .filter(([word, count]) => count >= minFrequency && (includeStopwords || !ENGLISH_FUNCTION_WORDS.has(word)))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en"))
    .slice(0, topN)
    .map(([word, count]) => ({
      word,
      count,
      rate_percent: tokenCount ? roundMetric(count / tokenCount * 100) : 0,
      document_frequency: documentFrequencies.get(word) || 0,
      document_rate_percent: passages.length ? roundMetric((documentFrequencies.get(word) || 0) / passages.length * 100) : 0,
    }));

  return {
    document_count: passages.length,
    token_count: tokenCount,
    type_count: typeCount,
    type_token_ratio_percent: tokenCount ? roundMetric(typeCount / tokenCount * 100) : null,
    root_type_token_ratio: tokenCount ? roundMetric(typeCount / Math.sqrt(tokenCount)) : null,
    moving_average_type_token_ratio: mattr,
    hapax_legomena_count: hapaxCount,
    hapax_type_rate_percent: typeCount ? roundMetric(hapaxCount / typeCount * 100) : null,
    average_word_length: tokenCount ? roundMetric(totalLetters / tokenCount) : null,
    estimated_lexical_density_percent: tokenCount ? roundMetric(contentTokenCount / tokenCount * 100) : null,
    frequent_words: frequentWords,
  };
}

type CorpusCriteria = {
  label: string;
  university_name?: string;
  year_from: number | null;
  year_to: number | null;
  schedule?: string;
  category?: string;
  exam_id: number | null;
  question_number: number | null;
};

type CorpusPassage = {
  question_id: number;
  passage_text: string;
};

function parseCorpusCriteria(value: unknown, name: string): CorpusCriteria {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} criteria are required`);
  const input = value as Record<string, unknown>;
  const yearFrom = optionalNonNegativeInteger(input.year_from, `${name}.year_from`);
  const yearTo = optionalNonNegativeInteger(input.year_to, `${name}.year_to`);
  const examId = optionalNonNegativeInteger(input.exam_id, `${name}.exam_id`);
  const questionNumber = optionalNonNegativeInteger(input.question_number, `${name}.question_number`);
  if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) throw new Error(`${name}.year_from must not exceed ${name}.year_to`);
  if (examId === 0 || questionNumber === 0) throw new Error(`${name}.exam_id and ${name}.question_number must be positive integers`);
  if (questionNumber !== null && examId === null) throw new Error(`${name}.exam_id is required when ${name}.question_number is specified`);

  return {
    label: String(input.label || name),
    university_name: input.university_name ? String(input.university_name) : undefined,
    year_from: yearFrom,
    year_to: yearTo,
    schedule: input.schedule ? String(input.schedule) : undefined,
    category: input.category ? String(input.category) : undefined,
    exam_id: examId,
    question_number: questionNumber,
  };
}

async function loadCorpusPassages(criteria: CorpusCriteria, env: McpEnv): Promise<CorpusPassage[]> {
  let sql = "SELECT q.id AS question_id, q.problem_text FROM questions q JOIN exams e ON q.exam_id = e.id JOIN universities u ON e.university_id = u.id WHERE u.hidden = 0 AND q.problem_text LIKE ?"; const values: (string | number)[] = ["%{{本文}}%"];
  if (criteria.university_name) { sql += " AND u.name LIKE ?"; values.push(`%${criteria.university_name}%`); }
  if (criteria.year_from !== null) { sql += " AND e.year >= ?"; values.push(criteria.year_from); }
  if (criteria.year_to !== null) { sql += " AND e.year <= ?"; values.push(criteria.year_to); }
  if (criteria.schedule) { sql += " AND e.schedule = ?"; values.push(criteria.schedule); }
  if (criteria.category) { sql += " AND q.category = ?"; values.push(criteria.category); }
  if (criteria.exam_id !== null) { sql += " AND e.id = ?"; values.push(criteria.exam_id); }
  if (criteria.question_number !== null) { sql += " AND q.question_number = ?"; values.push(criteria.question_number); }
  sql += " ORDER BY q.id";

  const rows = (await env.DB.prepare(sql).bind(...values).all<Record<string, unknown>>()).results;
  return rows.flatMap((row) => {
    const passageText = extractMarkedSection(row.problem_text, "本文");
    return passageText ? [{ question_id: Number(row.question_id), passage_text: passageText }] : [];
  });
}

function buildCorpusTokenStats(passages: CorpusPassage[]) {
  const documents = passages.map((passage) => englishWords(passage.passage_text).map(normalizeVocabularyToken));
  const frequencies = new Map<string, number>();
  const documentFrequencies = new Map<string, number>();
  for (const tokens of documents) {
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) || 0) + 1);
    for (const token of new Set(tokens)) documentFrequencies.set(token, (documentFrequencies.get(token) || 0) + 1);
  }
  return {
    documents,
    document_count: documents.length,
    token_count: documents.reduce((total, tokens) => total + tokens.length, 0),
    frequencies,
    document_frequencies: documentFrequencies,
  };
}

function buildNgramProfile(
  corpus: ReturnType<typeof buildCorpusTokenStats>,
  ngramMin: number,
  ngramMax: number,
  topN: number,
  minFrequency: number,
  includeFunctionOnlyNgrams: boolean,
) {
  const result: Record<string, Array<Record<string, unknown>>> = {};
  for (let size = ngramMin; size <= ngramMax; size += 1) {
    const frequencies = new Map<string, number>();
    const documentFrequencies = new Map<string, number>();
    let ngramTokenCount = 0;
    for (const tokens of corpus.documents) {
      const documentNgrams = new Set<string>();
      for (let start = 0; start <= tokens.length - size; start += 1) {
        const parts = tokens.slice(start, start + size);
        if (!includeFunctionOnlyNgrams && parts.every((token) => ENGLISH_FUNCTION_WORDS.has(token))) continue;
        const ngram = parts.join(" ");
        frequencies.set(ngram, (frequencies.get(ngram) || 0) + 1);
        documentNgrams.add(ngram);
        ngramTokenCount += 1;
      }
      for (const ngram of documentNgrams) documentFrequencies.set(ngram, (documentFrequencies.get(ngram) || 0) + 1);
    }
    result[String(size)] = Array.from(frequencies.entries())
      .filter(([, count]) => count >= minFrequency)
      .sort((a, b) => b[1] - a[1] || (documentFrequencies.get(b[0]) || 0) - (documentFrequencies.get(a[0]) || 0) || a[0].localeCompare(b[0], "en"))
      .slice(0, topN)
      .map(([ngram, count]) => ({
        ngram,
        count,
        rate_per_million: ngramTokenCount ? roundMetric(count / ngramTokenCount * 1_000_000) : 0,
        document_frequency: documentFrequencies.get(ngram) || 0,
        document_rate_percent: corpus.document_count ? roundMetric((documentFrequencies.get(ngram) || 0) / corpus.document_count * 100) : 0,
      }));
  }
  return result;
}

function buildDistinctiveKeywords(
  target: ReturnType<typeof buildCorpusTokenStats>,
  reference: ReturnType<typeof buildCorpusTokenStats>,
  topN: number,
  minFrequency: number,
  includeStopwords: boolean,
) {
  if (!target.token_count || !reference.token_count) return [];
  const vocabulary = new Set([...target.frequencies.keys(), ...reference.frequencies.keys()]);
  const smoothing = 0.5;
  const vocabularySize = Math.max(1, vocabulary.size);

  return Array.from(target.frequencies.entries())
    .filter(([word, count]) => count >= minFrequency && (includeStopwords || !ENGLISH_FUNCTION_WORDS.has(word)))
    .map(([word, targetCount]) => {
      const referenceCount = reference.frequencies.get(word) || 0;
      const targetRate = (targetCount + smoothing) / (target.token_count + smoothing * vocabularySize);
      const referenceRate = (referenceCount + smoothing) / (reference.token_count + smoothing * vocabularySize);
      return {
        word,
        target_count: targetCount,
        target_rate_per_million: roundMetric(targetCount / target.token_count * 1_000_000),
        target_document_frequency: target.document_frequencies.get(word) || 0,
        target_document_rate_percent: roundMetric((target.document_frequencies.get(word) || 0) / target.document_count * 100),
        reference_count: referenceCount,
        reference_rate_per_million: roundMetric(referenceCount / reference.token_count * 1_000_000),
        reference_document_frequency: reference.document_frequencies.get(word) || 0,
        reference_document_rate_percent: roundMetric((reference.document_frequencies.get(word) || 0) / reference.document_count * 100),
        log2_ratio: roundMetric(Math.log2(targetRate / referenceRate)),
      };
    })
    .filter((entry) => entry.log2_ratio > 0)
    .sort((a, b) => b.log2_ratio - a.log2_ratio || b.target_count - a.target_count || a.word.localeCompare(b.word, "en"))
    .slice(0, topN);
}

const COVERAGE_FIELD_DEFINITIONS = {
  problem: "問題本文",
  answer: "解答",
  commentary: "解説",
  body: "長文本文",
  questions: "長文の設問",
  translation: "全訳",
  source: "出典",
  strict_complete: "必要項目がすべて登録済み",
} as const;

type CoverageFieldCode = keyof typeof COVERAGE_FIELD_DEFINITIONS;

function coverageMetric(presentCount: number, expectedCount: number) {
  return {
    expected_count: expectedCount,
    present_count: presentCount,
    missing_count: expectedCount - presentCount,
    rate_percent: expectedCount ? roundMetric(presentCount / expectedCount * 100) : null,
  };
}

function buildCoverageMetrics(rows: Record<string, unknown>[]) {
  const passageRows = rows.filter((row) => String(row.category ?? "").includes("長文"));
  const present = (candidates: Record<string, unknown>[], predicate: (row: Record<string, unknown>) => boolean) =>
    candidates.filter(predicate).length;

  const problemCount = present(rows, (row) => Boolean(String(row.problem_text ?? "").trim()));
  const answerCount = present(rows, (row) => Boolean(String(row.answer_text ?? "").trim()));
  const commentaryCount = present(rows, (row) => Boolean(String(row.commentary_text ?? "").trim()));
  const bodyCount = present(passageRows, (row) => Boolean(extractMarkedSection(row.problem_text, "本文")));
  const questionsCount = present(passageRows, (row) => Boolean(extractMarkedSection(row.problem_text, "設問")));
  const translationCount = present(passageRows, (row) => Boolean(extractMarkedSection(row.problem_text, "全訳")));
  const sourceCount = present(passageRows, (row) => extractDelimitedSections(row.problem_text, "!!!!").length > 0);
  const strictCompleteCount = present(rows, (row) => {
    const problemText = String(row.problem_text ?? "");
    const baseComplete = Boolean(problemText.trim() && String(row.answer_text ?? "").trim() && String(row.commentary_text ?? "").trim());
    if (!baseComplete) return false;
    if (!String(row.category ?? "").includes("長文")) return true;
    return Boolean(
      extractMarkedSection(problemText, "本文")
      && extractMarkedSection(problemText, "設問")
      && extractMarkedSection(problemText, "全訳")
      && extractDelimitedSections(problemText, "!!!!").length
    );
  });

  const examIds = new Set(rows.map((row) => Number(row.exam_id)));
  return {
    exam_count: examIds.size,
    question_count: rows.length,
    passage_question_count: passageRows.length,
    coverage: {
      problem: coverageMetric(problemCount, rows.length),
      answer: coverageMetric(answerCount, rows.length),
      commentary: coverageMetric(commentaryCount, rows.length),
      body: coverageMetric(bodyCount, passageRows.length),
      questions: coverageMetric(questionsCount, passageRows.length),
      translation: coverageMetric(translationCount, passageRows.length),
      source: coverageMetric(sourceCount, passageRows.length),
      strict_complete: coverageMetric(strictCompleteCount, rows.length),
    },
  };
}

function buildDatabaseCoverageGroups(rows: Record<string, unknown>[]) {
  const groups = new Map<string, { university_name: string; year: number; schedule: string; rows: Record<string, unknown>[] }>();
  for (const row of rows) {
    const universityName = String(row.university_name ?? "");
    const year = Number(row.year);
    const schedule = String(row.schedule ?? "");
    const key = JSON.stringify([universityName, year, schedule]);
    let group = groups.get(key);
    if (!group) {
      group = { university_name: universityName, year, schedule, rows: [] };
      groups.set(key, group);
    }
    group.rows.push(row);
  }

  return Array.from(groups.values()).map((group) => ({
    university_name: group.university_name,
    year: group.year,
    schedule: group.schedule,
    ...buildCoverageMetrics(group.rows),
  }));
}

type ValidationIssue = {
  code: string;
  severity: "error" | "warning";
  message: string;
};

function markerCount(text: string, marker: string) {
  return text.split(marker).length - 1;
}

function validateQuestionRecord(row: Record<string, unknown>) {
  const problemText = String(row.problem_text ?? "");
  const answerText = String(row.answer_text ?? "");
  const commentaryText = String(row.commentary_text ?? "");
  const category = String(row.category ?? "");
  const isPassage = category.includes("長文");
  const issues: ValidationIssue[] = [];
  const add = (code: string, severity: ValidationIssue["severity"], message: string) => {
    issues.push({ code, severity, message });
  };

  if (!problemText.trim()) add("missing_problem_text", "error", "問題本文が空です。");
  if (!answerText.trim()) add("missing_answer", "error", "解答が登録されていません。");
  if (!commentaryText.trim()) add("missing_commentary", "warning", "解説が登録されていません。");

  if (isPassage) {
    if (!problemText.includes("{{本文}}")) add("missing_body", "error", "長文問題ですが{{本文}}セクションがありません。");
    if (!problemText.includes("{{設問}}")) add("missing_questions", "warning", "長文問題ですが{{設問}}セクションがありません。");
    if (!extractMarkedSection(problemText, "全訳")) add("missing_translation", "warning", "全訳が登録されていません。");
    if (!problemText.includes("!!!!")) add("missing_source", "warning", "出典が登録されていません。");
  }

  if (markerCount(problemText, "##") % 2 !== 0) add("unclosed_glossary", "error", "語注マーカー##が閉じていません。");
  if (markerCount(problemText, "!!!!") % 2 !== 0) add("unclosed_source", "error", "出典マーカー!!!!が閉じていません。");
  if (markerCount(problemText, "[[") !== markerCount(problemText, "]]")) add("unbalanced_blank", "error", "空所マーカー[[ ]]の左右が一致しません。");
  if (markerCount(problemText, "((") !== markerCount(problemText, "))")) add("unbalanced_choice", "error", "選択肢マーカー(( ))の左右が一致しません。");

  const problemOnly = problemText.split(/\n\s*\{\{解答\}\}/)[0];
  const choiceNumbers = Array.from(problemOnly.matchAll(/^\s*\(\((\d+)\)\)/gm), (match) => Number(match[1]));
  if (choiceNumbers.length) {
    let expected = 1;
    let discontinuous = false;
    for (const number of choiceNumbers) {
      if (number === 1) {
        expected = 2;
      } else if (number !== expected) {
        discontinuous = true;
        break;
      } else {
        expected += 1;
      }
    }
    if (discontinuous) add("non_contiguous_choices", "warning", "数字の選択肢番号に欠落または不自然な並びがあります。");

    const maxChoice = Math.max(...choiceNumbers);
    const answerNumbers = Array.from(answerText.matchAll(/\(\((\d+)\)\)/g), (match) => Number(match[1]));
    if (answerNumbers.some((number) => number > maxChoice)) add("answer_out_of_range", "error", "解答番号が問題内の選択肢番号の範囲を超えています。");
  }

  return issues;
}

const CORRECTION_TARGET_FIELDS = ["problem_text", "answer_text", "translation_text", "commentary_text"] as const;
type CorrectionTargetField = typeof CORRECTION_TARGET_FIELDS[number];

function parseCorrectionTargetField(value: unknown): CorrectionTargetField {
  const field = String(value || "");
  if (!CORRECTION_TARGET_FIELDS.includes(field as CorrectionTargetField)) throw new Error("target_field is invalid");
  return field as CorrectionTargetField;
}

function correctionStorageField(targetField: CorrectionTargetField) {
  return targetField === "translation_text" ? "problem_text" : targetField;
}

function correctionTargetText(row: Record<string, unknown>, targetField: CorrectionTargetField) {
  return targetField === "translation_text"
    ? extractMarkedSection(row.problem_text, "全訳")
    : String(row[targetField] ?? "");
}

function replaceMarkedSection(value: unknown, marker: string, replacement: string) {
  const text = String(value ?? "");
  const heading = `{{${marker}}}`;
  const headingStart = text.indexOf(heading);
  if (headingStart < 0) return `${text.trimEnd()}${text.trim() ? "\n\n" : ""}${heading}\n${replacement.trim()}`;

  const contentStart = headingStart + heading.length;
  const remainder = text.slice(contentStart);
  const nextHeading = remainder.search(/\n\s*\{\{[^{}\n]+\}\}\s*(?:\n|$)/);
  const contentEnd = nextHeading >= 0 ? contentStart + nextHeading : text.length;
  const currentSection = text.slice(contentStart, contentEnd);
  const leadingWhitespace = currentSection.match(/^\s*/)?.[0] || "";
  const trailingWhitespace = currentSection.match(/\s*$/)?.[0] || "";
  return text.slice(0, contentStart) + leadingWhitespace + replacement.trim() + trailingWhitespace + text.slice(contentEnd);
}

function detectCorrectionAuditIssues(text: string, targetField: CorrectionTargetField): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (code: string, severity: ValidationIssue["severity"], message: string) => issues.push({ code, severity, message });
  if (/�|Ã|Â|â€™|â€œ|â€|ï¬/u.test(text)) add("ocr_mojibake", "error", "文字化けの可能性がある文字列を検出しました。");
  if (/[ﬁﬂﬀﬃﬄ]/u.test(text)) add("ocr_ligature", "warning", "OCR由来の可能性がある合字を検出しました。");
  if (/[A-Za-z]{2,}-\s*\n\s*[a-z]{2,}/u.test(text)) add("ocr_split_hyphenated_word", "warning", "改行をまたいで分断されたハイフン語を検出しました。");
  if (/\b(?:[A-Za-z]\s+){5,}[A-Za-z]\b/u.test(text)) add("ocr_split_letters", "warning", "文字単位に不自然に分離された英語を検出しました。");
  if (markerCount(text, "[[") !== markerCount(text, "]]")) add("unbalanced_blank", "error", "空所マーカー[[ ]]の左右が一致しません。");
  if (markerCount(text, "((") !== markerCount(text, "))")) add("unbalanced_choice", "error", "選択肢マーカー(( ))の左右が一致しません。");
  if (markerCount(text, "##") % 2 !== 0) add("unclosed_glossary", "error", "語注マーカー##が閉じていません。");
  if (markerCount(text, "!!!!") % 2 !== 0) add("unclosed_source", "error", "出典マーカー!!!!が閉じていません。");
  if (!text.trim()) add(`empty_${targetField}`, "warning", "監査対象のテキストが空です。");
  return issues;
}

function buildCorrectionDiff(original: string, replacement: string) {
  let prefixLength = 0;
  while (prefixLength < original.length && prefixLength < replacement.length && original[prefixLength] === replacement[prefixLength]) prefixLength += 1;
  let suffixLength = 0;
  while (
    suffixLength < original.length - prefixLength
    && suffixLength < replacement.length - prefixLength
    && original[original.length - 1 - suffixLength] === replacement[replacement.length - 1 - suffixLength]
  ) suffixLength += 1;
  const contextSize = 120;
  return {
    original_length: original.length,
    replacement_length: replacement.length,
    common_prefix_length: prefixLength,
    common_suffix_length: suffixLength,
    before_context: original.slice(Math.max(0, prefixLength - contextSize), prefixLength),
    removed_text: original.slice(prefixLength, original.length - suffixLength),
    added_text: replacement.slice(prefixLength, replacement.length - suffixLength),
    after_context: original.slice(original.length - suffixLength, Math.min(original.length, original.length - suffixLength + contextSize)),
  };
}

function d1Changes(result: unknown) {
  const row = result as { meta?: { changes?: number }; changes?: number };
  return Number(row?.meta?.changes ?? row?.changes ?? 0);
}

async function callTool(name: string, args: Record<string, unknown>, env: McpEnv, auth: McpAuth | null = null) {
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
  if (name === "analyze_passage") {
    const examId = Number(args.exam_id);
    const questionNumber = Number(args.question_number);
    if (!examId || !questionNumber) throw new Error("exam_id and question_number are required");

    const row = await env.DB.prepare("SELECT q.id AS question_id, q.question_number, q.label, q.category, q.problem_text, e.id AS exam_id, e.year, e.schedule, u.name AS university_name FROM questions q JOIN exams e ON q.exam_id = e.id JOIN universities u ON e.university_id = u.id WHERE u.hidden = 0 AND q.exam_id = ? AND q.question_number = ?").bind(examId, questionNumber).first<Record<string, unknown>>();
    if (!row) throw new Error("Question not found");

    const passageText = extractMarkedSection(row.problem_text, "本文");
    if (!passageText) throw new Error("Passage section {{本文}} not found");

    const { problem_text: _problemText, ...metadata } = row;
    return {
      ...metadata,
      analysis: analyzePassageText(passageText),
    };
  }
  if (name === "search_sources") {
    const yearFrom = optionalNonNegativeInteger(args.year_from, "year_from");
    const yearTo = optionalNonNegativeInteger(args.year_to, "year_to");
    if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) throw new Error("year_from must not exceed year_to");

    const sort = String(args.sort || "year_desc");
    if (!["year_desc", "year_asc", "source_asc"].includes(sort)) throw new Error("sort is invalid");

    let sql = "SELECT q.id AS question_id, q.question_number, q.label, q.category, q.problem_text, e.id AS exam_id, e.year, e.schedule, u.name AS university_name FROM questions q JOIN exams e ON q.exam_id = e.id JOIN universities u ON e.university_id = u.id WHERE u.hidden = 0 AND q.problem_text LIKE ?"; const values: (string | number)[] = ["%!!!!%"];
    if (args.university_name) { sql += " AND u.name LIKE ?"; values.push(`%${String(args.university_name)}%`); }
    if (yearFrom !== null) { sql += " AND e.year >= ?"; values.push(yearFrom); }
    if (yearTo !== null) { sql += " AND e.year <= ?"; values.push(yearTo); }
    if (args.schedule) { sql += " AND e.schedule = ?"; values.push(String(args.schedule)); }
    if (args.category) { sql += " AND q.category = ?"; values.push(String(args.category)); }
    sql += sort === "year_asc"
      ? " ORDER BY e.year ASC, u.name ASC, q.question_number"
      : " ORDER BY e.year DESC, u.name ASC, q.question_number";

    const keyword = String(args.keyword || "").trim().toLocaleLowerCase("en");
    const rows = await env.DB.prepare(sql).bind(...values).all<Record<string, unknown>>();
    const matches = rows.results.flatMap((row) => {
      const sources = extractDelimitedSections(row.problem_text, "!!!!");
      const { problem_text: _problemText, ...metadata } = row;
      return sources.flatMap((sourceText, index) => {
        if (keyword && !sourceText.toLocaleLowerCase("en").includes(keyword)) return [];
        return [{ ...metadata, source_index: index + 1, source_text: sourceText }];
      });
    });

    if (sort === "source_asc") {
      matches.sort((a, b) => String(a.source_text).localeCompare(String(b.source_text), "en", { sensitivity: "base" }));
    }

    const results = matches.slice(0, limit(args.limit, 50));
    return {
      results,
      summary: {
        scanned_question_count: rows.results.length,
        matched_question_count: new Set(matches.map((item) => item.question_id)).size,
        matched_source_count: matches.length,
        returned_count: results.length,
      },
    };
  }
  if (name === "get_random_questions") {
    const yearFrom = optionalNonNegativeInteger(args.year_from, "year_from");
    const yearTo = optionalNonNegativeInteger(args.year_to, "year_to");
    const minWordCount = optionalNonNegativeInteger(args.min_word_count, "min_word_count");
    const maxWordCount = optionalNonNegativeInteger(args.max_word_count, "max_word_count");
    if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) throw new Error("year_from must not exceed year_to");
    if (minWordCount !== null && maxWordCount !== null && minWordCount > maxWordCount) throw new Error("min_word_count must not exceed max_word_count");

    let sql = "SELECT q.id AS question_id, q.question_number, q.label, q.category, q.problem_text, e.id AS exam_id, e.year, e.schedule, u.name AS university_name FROM questions q JOIN exams e ON q.exam_id = e.id JOIN universities u ON e.university_id = u.id WHERE u.hidden = 0"; const values: (string | number)[] = [];
    if (args.university_name) { sql += " AND u.name LIKE ?"; values.push(`%${String(args.university_name)}%`); }
    if (yearFrom !== null) { sql += " AND e.year >= ?"; values.push(yearFrom); }
    if (yearTo !== null) { sql += " AND e.year <= ?"; values.push(yearTo); }
    if (args.schedule) { sql += " AND e.schedule = ?"; values.push(String(args.schedule)); }
    if (args.category) { sql += " AND q.category = ?"; values.push(String(args.category)); }
    sql += " ORDER BY e.year DESC, u.name ASC, q.question_number";

    const passageOnly = args.passage_only === true || minWordCount !== null || maxWordCount !== null;
    const rows = await env.DB.prepare(sql).bind(...values).all<Record<string, unknown>>();
    const candidates = rows.results.flatMap((row) => {
      const passageText = extractMarkedSection(row.problem_text, "本文");
      if (passageOnly && !passageText) return [];
      const wordCount = passageText ? countEnglishWords(passageText) : null;
      if (minWordCount !== null && (wordCount === null || wordCount < minWordCount)) return [];
      if (maxWordCount !== null && (wordCount === null || wordCount > maxWordCount)) return [];

      const { problem_text: _problemText, ...metadata } = row;
      return [{ ...metadata, word_count: wordCount }];
    });

    const requestedCount = Math.min(20, limit(args.count, 5));
    const results = sampleRandom(candidates, requestedCount);
    return {
      results,
      summary: {
        candidate_count: candidates.length,
        requested_count: requestedCount,
        returned_count: results.length,
      },
    };
  }
  if (name === "compare_exam_trends") {
    const leftCriteria = parseTrendComparisonCriteria(args.left, "left");
    const rightCriteria = parseTrendComparisonCriteria(args.right, "right");
    const [leftRows, rightRows] = await Promise.all([
      loadTrendComparisonRows(leftCriteria, env),
      loadTrendComparisonRows(rightCriteria, env),
    ]);
    const left = buildTrendComparisonSnapshot(leftRows);
    const right = buildTrendComparisonSnapshot(rightRows);

    return {
      format_definitions: QUESTION_FORMAT_DEFINITIONS,
      detection_note: "設問形式は設問文のキーワードと既存マークアップによる規則ベースの推定です。",
      left: { criteria: leftCriteria, metrics: left },
      right: { criteria: rightCriteria, metrics: right },
      difference: buildTrendComparisonDifference(left, right),
    };
  }
  if (name === "analyze_question_formats") {
    const yearFrom = optionalNonNegativeInteger(args.year_from, "year_from");
    const yearTo = optionalNonNegativeInteger(args.year_to, "year_to");
    if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) throw new Error("year_from must not exceed year_to");

    const formatCode = String(args.format_code || "");
    if (formatCode && !(formatCode in QUESTION_FORMAT_DEFINITIONS)) throw new Error("format_code is invalid");

    let sql = "SELECT q.id AS question_id, q.category, q.problem_text, e.id AS exam_id, e.year, e.schedule, u.name AS university_name FROM questions q JOIN exams e ON q.exam_id = e.id JOIN universities u ON e.university_id = u.id WHERE u.hidden = 0"; const values: (string | number)[] = [];
    if (args.university_name) { sql += " AND u.name LIKE ?"; values.push(`%${String(args.university_name)}%`); }
    if (yearFrom !== null) { sql += " AND e.year >= ?"; values.push(yearFrom); }
    if (yearTo !== null) { sql += " AND e.year <= ?"; values.push(yearTo); }
    if (args.schedule) { sql += " AND e.schedule = ?"; values.push(String(args.schedule)); }
    if (args.category) { sql += " AND q.category = ?"; values.push(String(args.category)); }
    sql += " ORDER BY u.name ASC, e.year DESC, e.schedule ASC, q.question_number";

    const rows = await env.DB.prepare(sql).bind(...values).all<Record<string, unknown>>();
    const matchedRows = formatCode
      ? rows.results.filter((row) => analyzeQuestionFormatRecord(row).formats.includes(formatCode as QuestionFormatCode))
      : rows.results;
    const groups = buildQuestionFormatGroups(matchedRows);
    const results = groups.slice(0, limit(args.limit, 100));
    const scannedExamIds = new Set(rows.results.map((row) => Number(row.exam_id)));
    const matchedExamIds = new Set(matchedRows.map((row) => Number(row.exam_id)));
    return {
      format_definitions: QUESTION_FORMAT_DEFINITIONS,
      detection_note: "設問文のキーワードと既存マークアップによる規則ベースの推定です。厳密な形式集計には専用タグの登録が必要です。",
      results,
      summary: {
        scanned_exam_count: scannedExamIds.size,
        scanned_question_count: rows.results.length,
        matched_exam_count: matchedExamIds.size,
        matched_question_count: matchedRows.length,
        matched_group_count: groups.length,
        returned_group_count: results.length,
      },
    };
  }
  if (name === "get_exam_trends") {
    const yearFrom = optionalNonNegativeInteger(args.year_from, "year_from");
    const yearTo = optionalNonNegativeInteger(args.year_to, "year_to");
    if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) throw new Error("year_from must not exceed year_to");

    let sql = "SELECT q.id AS question_id, q.category, q.problem_text, e.id AS exam_id, e.year, e.schedule, u.name AS university_name FROM questions q JOIN exams e ON q.exam_id = e.id JOIN universities u ON e.university_id = u.id WHERE u.hidden = 0"; const values: (string | number)[] = [];
    if (args.university_name) { sql += " AND u.name LIKE ?"; values.push(`%${String(args.university_name)}%`); }
    if (yearFrom !== null) { sql += " AND e.year >= ?"; values.push(yearFrom); }
    if (yearTo !== null) { sql += " AND e.year <= ?"; values.push(yearTo); }
    if (args.schedule) { sql += " AND e.schedule = ?"; values.push(String(args.schedule)); }
    if (args.category) { sql += " AND q.category = ?"; values.push(String(args.category)); }
    sql += " ORDER BY u.name ASC, e.year DESC, e.schedule ASC, q.question_number";

    const rows = await env.DB.prepare(sql).bind(...values).all<Record<string, unknown>>();
    const eligibleRows = args.passage_only === true
      ? rows.results.filter((row) => Boolean(extractMarkedSection(row.problem_text, "本文")))
      : rows.results;
    const trends = buildExamTrends(eligibleRows);
    const results = trends.slice(0, limit(args.limit, 100));
    const scannedExamIds = new Set(rows.results.map((row) => Number(row.exam_id)));
    const matchedExamIds = new Set(eligibleRows.map((row) => Number(row.exam_id)));
    return {
      results,
      summary: {
        scanned_exam_count: scannedExamIds.size,
        scanned_question_count: rows.results.length,
        matched_exam_count: matchedExamIds.size,
        matched_question_count: eligibleRows.length,
        matched_group_count: trends.length,
        returned_group_count: results.length,
      },
    };
  }
  if (name === "analyze_corpus_keywords") {
    const targetCriteria = parseCorpusCriteria(args.target, "target");
    const hasExplicitReference = args.reference !== undefined && args.reference !== null;
    const referenceCriteria = hasExplicitReference ? parseCorpusCriteria(args.reference, "reference") : null;
    const ngramMin = optionalNonNegativeInteger(args.ngram_min, "ngram_min") ?? 2;
    const ngramMax = optionalNonNegativeInteger(args.ngram_max, "ngram_max") ?? 3;
    const minNgramFrequency = optionalNonNegativeInteger(args.min_ngram_frequency, "min_ngram_frequency") ?? 2;
    const minKeywordFrequency = optionalNonNegativeInteger(args.min_keyword_frequency, "min_keyword_frequency") ?? 2;
    if (ngramMin < 2 || ngramMin > 5 || ngramMax < 2 || ngramMax > 5) throw new Error("ngram_min and ngram_max must be between 2 and 5");
    if (ngramMin > ngramMax) throw new Error("ngram_min must not exceed ngram_max");
    if (minNgramFrequency < 1 || minKeywordFrequency < 1) throw new Error("minimum frequencies must be at least 1");

    const targetPassages = await loadCorpusPassages(targetCriteria, env);
    let referencePassages: CorpusPassage[];
    if (referenceCriteria) {
      referencePassages = await loadCorpusPassages(referenceCriteria, env);
    } else {
      const allCriteria = parseCorpusCriteria({}, "all_database_passages");
      const targetQuestionIds = new Set(targetPassages.map((passage) => passage.question_id));
      referencePassages = (await loadCorpusPassages(allCriteria, env)).filter((passage) => !targetQuestionIds.has(passage.question_id));
    }

    const targetCorpus = buildCorpusTokenStats(targetPassages);
    const referenceCorpus = buildCorpusTokenStats(referencePassages);
    const ngramTopN = Math.min(100, limit(args.ngram_top_n, 30));
    const keywordTopN = Math.min(100, limit(args.keyword_top_n, 30));
    const includeStopwords = args.include_stopwords === true;
    const includeFunctionOnlyNgrams = args.include_function_only_ngrams === true;

    return {
      target: {
        criteria: targetCriteria,
        document_count: targetCorpus.document_count,
        token_count: targetCorpus.token_count,
      },
      reference: {
        mode: referenceCriteria ? "explicit_criteria" : "all_other_passages",
        criteria: referenceCriteria,
        document_count: referenceCorpus.document_count,
        token_count: referenceCorpus.token_count,
      },
      options: {
        ngram_min: ngramMin,
        ngram_max: ngramMax,
        ngram_top_n: ngramTopN,
        keyword_top_n: keywordTopN,
        min_ngram_frequency: minNgramFrequency,
        min_keyword_frequency: minKeywordFrequency,
        include_stopwords: includeStopwords,
        include_function_only_ngrams: includeFunctionOnlyNgrams,
      },
      ngrams: buildNgramProfile(targetCorpus, ngramMin, ngramMax, ngramTopN, minNgramFrequency, includeFunctionOnlyNgrams),
      keywords: buildDistinctiveKeywords(targetCorpus, referenceCorpus, keywordTopN, minKeywordFrequency, includeStopwords),
      methodology_note: "{{本文}}内の英語を小文字化した表層形で集計し、見出し語化は行いません。n-gramは各本文内だけで生成し、本文境界をまたぎません。特徴語のlog2_ratioは対象・参照コーパスの相対頻度を0.5加算平滑化して比較した効果量で、統計的有意性を示す値ではありません。参照条件を省略した場合は、対象に含まれないデータベース内の全長文を参照コーパスにします。参照コーパスが空の場合、特徴語は空配列になります。",
    };
  }
  if (name === "analyze_vocabulary_profile") {
    const yearFrom = optionalNonNegativeInteger(args.year_from, "year_from");
    const yearTo = optionalNonNegativeInteger(args.year_to, "year_to");
    const examId = optionalNonNegativeInteger(args.exam_id, "exam_id");
    const questionNumber = optionalNonNegativeInteger(args.question_number, "question_number");
    const minFrequency = optionalNonNegativeInteger(args.min_frequency, "min_frequency") ?? 2;
    if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) throw new Error("year_from must not exceed year_to");
    if (examId === 0 || questionNumber === 0) throw new Error("exam_id and question_number must be positive integers");
    if (questionNumber !== null && examId === null) throw new Error("exam_id is required when question_number is specified");
    if (minFrequency < 1) throw new Error("min_frequency must be at least 1");

    let sql = "SELECT q.id AS question_id, q.question_number, q.category, q.problem_text, e.id AS exam_id, e.year, e.schedule, u.name AS university_name FROM questions q JOIN exams e ON q.exam_id = e.id JOIN universities u ON e.university_id = u.id WHERE u.hidden = 0 AND q.problem_text LIKE ?"; const values: (string | number)[] = ["%{{本文}}%"];
    if (args.university_name) { sql += " AND u.name LIKE ?"; values.push(`%${String(args.university_name)}%`); }
    if (yearFrom !== null) { sql += " AND e.year >= ?"; values.push(yearFrom); }
    if (yearTo !== null) { sql += " AND e.year <= ?"; values.push(yearTo); }
    if (args.schedule) { sql += " AND e.schedule = ?"; values.push(String(args.schedule)); }
    if (args.category) { sql += " AND q.category = ?"; values.push(String(args.category)); }
    if (examId !== null) { sql += " AND e.id = ?"; values.push(examId); }
    if (questionNumber !== null) { sql += " AND q.question_number = ?"; values.push(questionNumber); }
    sql += " ORDER BY u.name ASC, e.year DESC, e.schedule ASC, q.question_number";

    const rows = await env.DB.prepare(sql).bind(...values).all<Record<string, unknown>>();
    const passages = rows.results.flatMap((row) => {
      const passageText = extractMarkedSection(row.problem_text, "本文");
      return passageText ? [{ passage_text: passageText }] : [];
    });
    const topN = Math.min(100, limit(args.top_n, 30));
    const profile = buildVocabularyProfile(passages, topN, minFrequency, args.include_stopwords === true);

    return {
      scope: {
        university_name: args.university_name ? String(args.university_name) : null,
        year_from: yearFrom,
        year_to: yearTo,
        schedule: args.schedule ? String(args.schedule) : null,
        category: args.category ? String(args.category) : null,
        exam_id: examId,
        question_number: questionNumber,
      },
      methodology_note: "語は小文字化した表層形で集計し、活用形・派生形の見出し語化は行いません。語彙密度は内蔵の英語機能語リストに含まれない語の割合による推定値です。CEFR・AWL判定は語彙リスト未登録のため含みません。",
      options: {
        top_n: topN,
        min_frequency: minFrequency,
        include_stopwords: args.include_stopwords === true,
      },
      profile,
    };
  }
  if (name === "get_database_coverage") {
    const yearFrom = optionalNonNegativeInteger(args.year_from, "year_from");
    const yearTo = optionalNonNegativeInteger(args.year_to, "year_to");
    if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) throw new Error("year_from must not exceed year_to");

    const missingField = String(args.missing_field || "");
    if (missingField && !(missingField in COVERAGE_FIELD_DEFINITIONS)) throw new Error("missing_field is invalid");
    const sort = String(args.sort || "coverage_asc");
    if (!["coverage_asc", "year_desc", "university_asc"].includes(sort)) throw new Error("sort is invalid");

    let sql = "SELECT q.id AS question_id, q.category, q.problem_text, q.answer_text, q.commentary_text, e.id AS exam_id, e.year, e.schedule, u.name AS university_name FROM questions q JOIN exams e ON q.exam_id = e.id JOIN universities u ON e.university_id = u.id WHERE u.hidden = 0"; const values: (string | number)[] = [];
    if (args.university_name) { sql += " AND u.name LIKE ?"; values.push(`%${String(args.university_name)}%`); }
    if (yearFrom !== null) { sql += " AND e.year >= ?"; values.push(yearFrom); }
    if (yearTo !== null) { sql += " AND e.year <= ?"; values.push(yearTo); }
    if (args.schedule) { sql += " AND e.schedule = ?"; values.push(String(args.schedule)); }
    if (args.category) { sql += " AND q.category = ?"; values.push(String(args.category)); }
    sql += " ORDER BY u.name ASC, e.year DESC, e.schedule ASC, q.question_number";

    const rows = await env.DB.prepare(sql).bind(...values).all<Record<string, unknown>>();
    const allGroups = buildDatabaseCoverageGroups(rows.results);
    let groups = allGroups;
    if (missingField) {
      groups = groups.filter((group) => group.coverage[missingField as CoverageFieldCode].missing_count > 0);
    }
    if (args.only_incomplete === true) {
      groups = groups.filter((group) => group.coverage.strict_complete.missing_count > 0);
    }

    if (sort === "coverage_asc") {
      groups.sort((a, b) =>
        Number(a.coverage.strict_complete.rate_percent ?? -1) - Number(b.coverage.strict_complete.rate_percent ?? -1)
        || a.university_name.localeCompare(b.university_name, "ja")
        || b.year - a.year
      );
    } else if (sort === "year_desc") {
      groups.sort((a, b) => b.year - a.year || a.university_name.localeCompare(b.university_name, "ja"));
    } else {
      groups.sort((a, b) => a.university_name.localeCompare(b.university_name, "ja") || b.year - a.year);
    }

    const results = groups.slice(0, limit(args.limit, 100));
    return {
      field_definitions: COVERAGE_FIELD_DEFINITIONS,
      denominator_note: "問題・解答・解説・完全登録率は全大問、本文・設問・全訳・出典はカテゴリ名に「長文」を含む大問を分母にしています。",
      overall: buildCoverageMetrics(rows.results),
      results,
      summary: {
        scanned_question_count: rows.results.length,
        scanned_group_count: allGroups.length,
        matched_group_count: groups.length,
        returned_group_count: results.length,
      },
    };
  }
  if (name === "audit_question_for_correction") {
    if (!auth?.client_id) throw new Error("Reconnect the MCP connection before creating a correction audit");
    const examId = optionalNonNegativeInteger(args.exam_id, "exam_id");
    const questionNumber = optionalNonNegativeInteger(args.question_number, "question_number");
    if (!examId || !questionNumber) throw new Error("exam_id and question_number must be positive integers");
    const targetField = parseCorrectionTargetField(args.target_field);
    const reason = String(args.reason || "").trim();
    if (reason.length < 5 || reason.length > 500) throw new Error("reason must be between 5 and 500 characters");
    await ensureSchema(env);

    const row = await env.DB.prepare("SELECT q.id AS question_id, q.question_number, q.label, q.category, q.problem_text, q.answer_text, q.commentary_text, e.id AS exam_id, e.year, e.schedule, u.name AS university_name FROM questions q JOIN exams e ON q.exam_id = e.id JOIN universities u ON e.university_id = u.id WHERE u.hidden = 0 AND e.id = ? AND q.question_number = ?")
      .bind(examId, questionNumber).first<Record<string, unknown>>();
    if (!row) throw new Error("Question not found");

    const storageField = correctionStorageField(targetField);
    const originalStorageText = String(row[storageField] ?? "");
    const originalTargetText = correctionTargetText(row, targetField);
    const originalStorageHash = await sha256(originalStorageText);
    const allIssues = [...validateQuestionRecord(row), ...detectCorrectionAuditIssues(originalTargetText, targetField)];
    const issues = Array.from(new Map(allIssues.map((issue) => [`${issue.code}:${issue.message}`, issue])).values());
    const auditId = crypto.randomUUID();
    const expiresAt = Date.now() + AUDIT_AGE_MS;
    await env.DB.prepare("INSERT INTO mcp_question_audits (id, client_id, question_id, exam_id, question_number, target_field, storage_field, reason, issue_codes, original_target_text, original_storage_text, original_storage_hash, status, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'audited', ?)")
      .bind(auditId, auth.client_id, Number(row.question_id), examId, questionNumber, targetField, storageField, reason, JSON.stringify(issues.map((issue) => issue.code)), originalTargetText, originalStorageText, originalStorageHash, expiresAt).run();

    return {
      audit_id: auditId,
      status: "audited",
      expires_at: new Date(expiresAt).toISOString(),
      question: {
        question_id: Number(row.question_id),
        exam_id: examId,
        question_number: questionNumber,
        university_name: row.university_name,
        year: row.year,
        schedule: row.schedule,
        label: row.label,
        category: row.category,
      },
      target_field: targetField,
      original_text: originalTargetText,
      original_text_hash: await sha256(originalTargetText),
      detected_issues: issues,
      next_step: "修正内容を確定したら、同じ接続からprepare_question_correctionを呼び出して差分を確認してください。",
    };
  }
  if (name === "prepare_question_correction") {
    if (!auth?.client_id) throw new Error("Reconnect the MCP connection before preparing a correction");
    const auditId = String(args.audit_id || "");
    if (!auditId) throw new Error("audit_id is required");
    if (!("replacement_text" in args)) throw new Error("replacement_text is required");
    const replacementText = String(args.replacement_text ?? "");
    if (!replacementText.trim()) throw new Error("replacement_text must not be empty");
    if (replacementText.length > 500_000) throw new Error("replacement_text is too large");
    await ensureSchema(env);

    const audit = await env.DB.prepare("SELECT * FROM mcp_question_audits WHERE id = ? AND client_id = ?")
      .bind(auditId, auth.client_id).first<Record<string, any>>();
    if (!audit) throw new Error("Audit not found for this connection");
    if (Number(audit.expires_at) < Date.now()) throw new Error("Audit has expired; run audit_question_for_correction again");
    if (audit.used_at || audit.status === "applied") throw new Error("Audit has already been used");

    const targetField = parseCorrectionTargetField(audit.target_field);
    const originalTargetText = String(audit.original_target_text ?? "");
    if (replacementText === originalTargetText) throw new Error("replacement_text is identical to the audited text");
    const proposedStorageText = targetField === "translation_text"
      ? replaceMarkedSection(audit.original_storage_text, "全訳", replacementText)
      : replacementText;
    const proposalHash = await sha256(proposedStorageText);
    const preparedAt = Date.now();
    const updated = await env.DB.prepare("UPDATE mcp_question_audits SET proposed_target_text = ?, proposed_storage_text = ?, proposal_hash = ?, status = 'prepared', prepared_at = ? WHERE id = ? AND client_id = ? AND used_at IS NULL AND expires_at >= ?")
      .bind(replacementText, proposedStorageText, proposalHash, preparedAt, auditId, auth.client_id, preparedAt).run();
    if (d1Changes(updated) !== 1) throw new Error("Audit could not be prepared");

    return {
      audit_id: auditId,
      status: "prepared",
      target_field: targetField,
      proposal_hash: proposalHash,
      expires_at: new Date(Number(audit.expires_at)).toISOString(),
      diff: buildCorrectionDiff(originalTargetText, replacementText),
      confirmation_required: true,
      next_step: "差分が正しい場合だけ、audit_idとproposal_hashをapply_audited_correctionへ渡してください。",
    };
  }
  if (name === "apply_audited_correction") {
    if (!auth?.client_id) throw new Error("Reconnect the MCP connection before applying a correction");
    const auditId = String(args.audit_id || "");
    const proposalHash = String(args.proposal_hash || "");
    if (!auditId || !proposalHash) throw new Error("audit_id and proposal_hash are required");
    if (args.confirm !== true) throw new Error("confirm must be true after reviewing the prepared diff");
    await ensureSchema(env);

    const audit = await env.DB.prepare("SELECT * FROM mcp_question_audits WHERE id = ? AND client_id = ?")
      .bind(auditId, auth.client_id).first<Record<string, any>>();
    if (!audit) throw new Error("Audit not found for this connection");
    if (audit.used_at) throw new Error("Audit has already been used");
    if (audit.status !== "prepared" || !audit.proposed_storage_text) throw new Error("Correction has not been prepared");
    if (Number(audit.expires_at) < Date.now()) throw new Error("Audit has expired; run audit_question_for_correction again");
    if (!(await safeEqual(String(audit.proposal_hash || ""), proposalHash))) throw new Error("proposal_hash does not match the prepared correction");

    const storageField = String(audit.storage_field || "");
    if (!["problem_text", "answer_text", "commentary_text"].includes(storageField)) throw new Error("Stored correction field is invalid");
    const current = await env.DB.prepare(`SELECT ${storageField} AS storage_text FROM questions WHERE id = ?`).bind(Number(audit.question_id)).first<{ storage_text: string }>();
    if (!current) throw new Error("Question no longer exists");
    const currentHash = await sha256(String(current.storage_text ?? ""));
    if (!(await safeEqual(currentHash, String(audit.original_storage_hash)))) throw new Error("Question changed after the audit; run the audit again");

    const changeId = crypto.randomUUID();
    const now = Date.now();
    const statements = [
      env.DB.prepare(`UPDATE questions SET ${storageField} = ? WHERE id = ? AND ${storageField} = ?`).bind(String(audit.proposed_storage_text), Number(audit.question_id), String(audit.original_storage_text)),
      env.DB.prepare("INSERT INTO mcp_question_changes (id, audit_id, client_id, question_id, exam_id, question_number, target_field, storage_field, reason, before_text, after_text, before_hash, after_hash) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1")
        .bind(changeId, auditId, auth.client_id, Number(audit.question_id), Number(audit.exam_id), Number(audit.question_number), String(audit.target_field), storageField, String(audit.reason), String(audit.original_storage_text), String(audit.proposed_storage_text), String(audit.original_storage_hash), proposalHash),
      env.DB.prepare("UPDATE mcp_question_audits SET status = 'applied', used_at = ? WHERE id = ? AND client_id = ? AND status = 'prepared' AND used_at IS NULL AND EXISTS (SELECT 1 FROM mcp_question_changes WHERE audit_id = ?)")
        .bind(now, auditId, auth.client_id, auditId),
    ];
    const results = await env.DB.batch(statements);
    if (d1Changes(results[0]) !== 1 || d1Changes(results[1]) !== 1 || d1Changes(results[2]) !== 1) throw new Error("Correction was not applied because the audited state no longer matched");

    return {
      success: true,
      change_id: changeId,
      audit_id: auditId,
      exam_id: Number(audit.exam_id),
      question_number: Number(audit.question_number),
      target_field: audit.target_field,
      before_hash: audit.original_storage_hash,
      after_hash: proposalHash,
      applied_at: new Date(now).toISOString(),
      audit_consumed: true,
    };
  }
  if (name === "get_question_correction_history") {
    const examId = optionalNonNegativeInteger(args.exam_id, "exam_id");
    const questionNumber = optionalNonNegativeInteger(args.question_number, "question_number");
    if (!examId || !questionNumber) throw new Error("exam_id and question_number must be positive integers");
    await ensureSchema(env);
    const rows = await env.DB.prepare("SELECT id AS change_id, audit_id, client_id AS actor_client_id, target_field, reason, before_hash, after_hash, created_at FROM mcp_question_changes WHERE exam_id = ? AND question_number = ? ORDER BY created_at DESC LIMIT ?")
      .bind(examId, questionNumber, limit(args.limit, 20)).all<Record<string, unknown>>();
    return { exam_id: examId, question_number: questionNumber, changes: rows.results };
  }
  if (name === "validate_questions") {
    const yearFrom = optionalNonNegativeInteger(args.year_from, "year_from");
    const yearTo = optionalNonNegativeInteger(args.year_to, "year_to");
    if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) throw new Error("year_from must not exceed year_to");

    let sql = "SELECT q.id AS question_id, q.question_number, q.label, q.category, q.problem_text, q.answer_text, q.commentary_text, e.id AS exam_id, e.year, e.schedule, u.name AS university_name FROM questions q JOIN exams e ON q.exam_id = e.id JOIN universities u ON e.university_id = u.id WHERE u.hidden = 0"; const values: (string | number)[] = [];
    if (args.university_name) { sql += " AND u.name LIKE ?"; values.push(`%${String(args.university_name)}%`); }
    if (yearFrom !== null) { sql += " AND e.year >= ?"; values.push(yearFrom); }
    if (yearTo !== null) { sql += " AND e.year <= ?"; values.push(yearTo); }
    if (args.schedule) { sql += " AND e.schedule = ?"; values.push(String(args.schedule)); }
    if (args.category) { sql += " AND q.category = ?"; values.push(String(args.category)); }
    sql += " ORDER BY e.year DESC, u.name ASC, q.question_number";

    const issueCode = String(args.issue_code || "");
    const severity = String(args.severity || "");
    const rows = await env.DB.prepare(sql).bind(...values).all<Record<string, unknown>>();
    const issueCounts: Record<string, number> = {};
    const matches = rows.results.flatMap((row) => {
      const issues = validateQuestionRecord(row).filter((issue) =>
        (!issueCode || issue.code === issueCode) && (!severity || issue.severity === severity)
      );
      if (!issues.length) return [];
      for (const issue of issues) issueCounts[issue.code] = (issueCounts[issue.code] || 0) + 1;
      const { problem_text: _problemText, answer_text: _answerText, commentary_text: _commentaryText, ...metadata } = row;
      return [{ ...metadata, issues, issue_count: issues.length }];
    });

    const results = matches.slice(0, limit(args.limit, 50));
    return {
      results,
      summary: {
        scanned_count: rows.results.length,
        matched_count: matches.length,
        returned_count: results.length,
        issue_counts: issueCounts,
      },
    };
  }
  throw new Error("Unknown tool");
}

const TOOLS = [
  { name: "list_universities", title: "大学一覧", description: "登録されている大学を検索・一覧取得します。", inputSchema: { type: "object", properties: { query: { type: "string", description: "大学名・よみ・略称の部分一致" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false } },
  { name: "list_exams", title: "試験一覧", description: "大学名・年度・方式で登録済み試験を絞り込みます。", inputSchema: { type: "object", properties: { university_name: { type: "string" }, year: { type: "integer" }, schedule: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false } },
  { name: "search_questions", title: "問題検索", description: "問題・解答・解説のキーワードと大学・年度・方式・カテゴリで大問を検索します。結果の本文が必要ならget_questionを続けて使います。", inputSchema: { type: "object", properties: { word: { type: "string" }, university_name: { type: "string" }, year: { type: "integer" }, schedule: { type: "string" }, category: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false } },
  { name: "search_passages", title: "長文語数検索", description: "長文問題を本文の英語語数で検索します。{{本文}}セクションのみを対象にし、設問・選択肢・解答・全訳・解説・語注の日本語部分・マークアップは語数から除外します。大学名・年度範囲・方式・本文キーワードでも絞り込めます。", inputSchema: { type: "object", properties: { min_word_count: { type: "integer", minimum: 0, description: "本文の最低語数" }, max_word_count: { type: "integer", minimum: 0, description: "本文の最大語数" }, university_name: { type: "string" }, year_from: { type: "integer", minimum: 0 }, year_to: { type: "integer", minimum: 0 }, schedule: { type: "string" }, keyword: { type: "string", description: "英語本文内の部分一致キーワード" }, sort: { type: "string", enum: ["year_desc", "word_count_desc", "word_count_asc"], default: "year_desc" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false } },
  { name: "analyze_passage", title: "長文分析", description: "exam_idと大問番号を指定し、{{本文}}セクションの語数・文数・段落数・平均文長・Flesch Reading Ease・Flesch-Kincaid Gradeを算出します。可読性指標は英語の音節数を推定した参考値で、入試問題の難易度そのものではありません。", inputSchema: { type: "object", properties: { exam_id: { type: "integer" }, question_number: { type: "integer" } }, required: ["exam_id", "question_number"], additionalProperties: false } },
  { name: "search_sources", title: "出典検索", description: "問題本文の!!!!...!!!!マーカー内に登録された出典を検索します。著者名・書名・媒体名などの部分一致に加え、大学名・年度範囲・方式・カテゴリで絞り込めます。出典文字列はデータベース内の表記のまま返します。", inputSchema: { type: "object", properties: { keyword: { type: "string", description: "出典文字列内の部分一致キーワード" }, university_name: { type: "string" }, year_from: { type: "integer", minimum: 0 }, year_to: { type: "integer", minimum: 0 }, schedule: { type: "string" }, category: { type: "string" }, sort: { type: "string", enum: ["year_desc", "year_asc", "source_asc"], default: "year_desc" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false } },
  { name: "get_random_questions", title: "条件付きランダム出題", description: "大学・年度範囲・方式・カテゴリ・長文語数などの条件に合う大問をランダムに抽出します。本文は返さず、選定結果のexam_idと大問番号などを返すため、必要な問題だけget_questionで取得できます。読み取り専用でデータは変更しません。", inputSchema: { type: "object", properties: { university_name: { type: "string" }, year_from: { type: "integer", minimum: 0 }, year_to: { type: "integer", minimum: 0 }, schedule: { type: "string" }, category: { type: "string" }, passage_only: { type: "boolean", description: "{{本文}}セクションがある問題だけを対象にする" }, min_word_count: { type: "integer", minimum: 0, description: "長文本文の最低語数。指定すると長文のみが対象" }, max_word_count: { type: "integer", minimum: 0, description: "長文本文の最大語数。指定すると長文のみが対象" }, count: { type: "integer", minimum: 1, maximum: 20, default: 5, description: "抽出件数" } }, additionalProperties: false } },
  { name: "compare_exam_trends", title: "大学・期間別傾向比較", description: "2つの大学・期間・方式などを直接比較し、試験数・大問数・1試験当たり大問数・カテゴリ別件数・設問形式別件数・長文比率・平均語数と、その差分を返します。差分はrightからleftを引いた値です。読み取り専用でデータは変更しません。", inputSchema: { type: "object", properties: { left: { type: "object", properties: { label: { type: "string", description: "比較結果に表示する任意の名称" }, university_name: { type: "string" }, year_from: { type: "integer", minimum: 0 }, year_to: { type: "integer", minimum: 0 }, schedule: { type: "string" }, category: { type: "string" }, passage_only: { type: "boolean", description: "{{本文}}セクションがある問題だけを対象にする" } }, additionalProperties: false }, right: { type: "object", properties: { label: { type: "string", description: "比較結果に表示する任意の名称" }, university_name: { type: "string" }, year_from: { type: "integer", minimum: 0 }, year_to: { type: "integer", minimum: 0 }, schedule: { type: "string" }, category: { type: "string" }, passage_only: { type: "boolean", description: "{{本文}}セクションがある問題だけを対象にする" } }, additionalProperties: false } }, required: ["left", "right"], additionalProperties: false } },
  { name: "analyze_question_formats", title: "設問形式分析", description: "既存マークアップと設問文のキーワードから、長文読解・空所補充・選択式・和訳・英作文／英訳・語句整序・内容一致・要約・説明記述・題名選択を規則ベースで判定し、大学・年度・方式別に集計します。全訳は判定対象から除外します。読み取り専用でデータは変更しません。", inputSchema: { type: "object", properties: { university_name: { type: "string" }, year_from: { type: "integer", minimum: 0 }, year_to: { type: "integer", minimum: 0 }, schedule: { type: "string" }, category: { type: "string" }, format_code: { type: "string", enum: ["long_passage", "blank_fill", "multiple_choice", "japanese_translation", "english_composition", "word_order", "content_matching", "summary", "explanation", "title_selection"], description: "この形式を含む問題だけを集計" }, limit: { type: "integer", minimum: 1, maximum: 100, default: 100, description: "返却する大学・年度・方式グループ数" } }, additionalProperties: false } },
  { name: "get_exam_trends", title: "大学別・年度別傾向分析", description: "大学名・年度・方式ごとに、試験数・大問数・カテゴリ別件数・長文数・本文語数の合計／平均／最小／最大を集計します。大学名・年度範囲・方式・カテゴリ・長文限定で対象を絞り込めます。読み取り専用でデータは変更しません。", inputSchema: { type: "object", properties: { university_name: { type: "string" }, year_from: { type: "integer", minimum: 0 }, year_to: { type: "integer", minimum: 0 }, schedule: { type: "string" }, category: { type: "string" }, passage_only: { type: "boolean", description: "{{本文}}セクションがある問題だけを集計する" }, limit: { type: "integer", minimum: 1, maximum: 100, default: 100, description: "返却する大学・年度・方式グループ数" } }, additionalProperties: false } },
  { name: "analyze_corpus_keywords", title: "コーパス特徴語・n-gram分析", description: "対象となる長文群の2〜5語n-gram、出現回数、文書頻度を集計し、参照コーパスとの相対頻度から特徴語を抽出します。参照条件を省略すると対象以外の全長文と比較します。表層語ベースの読み取り専用分析です。", inputSchema: { type: "object", properties: { target: { type: "object", description: "分析対象の長文条件", properties: { label: { type: "string" }, university_name: { type: "string" }, year_from: { type: "integer", minimum: 0 }, year_to: { type: "integer", minimum: 0 }, schedule: { type: "string" }, category: { type: "string" }, exam_id: { type: "integer", minimum: 1 }, question_number: { type: "integer", minimum: 1 } }, additionalProperties: false }, reference: { type: "object", description: "任意の参照コーパス条件。省略時は対象以外の全長文", properties: { label: { type: "string" }, university_name: { type: "string" }, year_from: { type: "integer", minimum: 0 }, year_to: { type: "integer", minimum: 0 }, schedule: { type: "string" }, category: { type: "string" }, exam_id: { type: "integer", minimum: 1 }, question_number: { type: "integer", minimum: 1 } }, additionalProperties: false }, ngram_min: { type: "integer", minimum: 2, maximum: 5, default: 2 }, ngram_max: { type: "integer", minimum: 2, maximum: 5, default: 3 }, ngram_top_n: { type: "integer", minimum: 1, maximum: 100, default: 30 }, keyword_top_n: { type: "integer", minimum: 1, maximum: 100, default: 30 }, min_ngram_frequency: { type: "integer", minimum: 1, default: 2 }, min_keyword_frequency: { type: "integer", minimum: 1, default: 2 }, include_stopwords: { type: "boolean", default: false, description: "特徴語に機能語を含める" }, include_function_only_ngrams: { type: "boolean", default: false, description: "機能語だけで構成されるn-gramを含める" } }, required: ["target"], additionalProperties: false } },
  { name: "analyze_vocabulary_profile", title: "長文語彙プロファイル", description: "{{本文}}セクションを対象に、総語数・異語数・TTR・MATTR・平均語長・1回だけ現れる語・推定語彙密度・頻出語・文書頻度を算出します。大学・年度範囲・方式・カテゴリ・試験・大問で対象を絞り込めます。表層語ベースで、CEFR・AWL判定は含みません。", inputSchema: { type: "object", properties: { university_name: { type: "string" }, year_from: { type: "integer", minimum: 0 }, year_to: { type: "integer", minimum: 0 }, schedule: { type: "string" }, category: { type: "string" }, exam_id: { type: "integer", minimum: 1 }, question_number: { type: "integer", minimum: 1 }, top_n: { type: "integer", minimum: 1, maximum: 100, default: 30, description: "返却する頻出語数" }, min_frequency: { type: "integer", minimum: 1, default: 2, description: "頻出語一覧に含める最低出現回数" }, include_stopwords: { type: "boolean", default: false, description: "頻出語一覧に機能語を含める" } }, additionalProperties: false } },
  { name: "get_database_coverage", title: "データ登録率", description: "大学・年度・方式別に、問題・解答・解説・長文本文・設問・全訳・出典の期待件数、登録件数、不足件数、登録率を集計します。長文関連項目はカテゴリ名に「長文」を含む問題だけを分母にします。特定項目が不足しているグループだけを抽出できます。読み取り専用でデータは変更しません。", inputSchema: { type: "object", properties: { university_name: { type: "string" }, year_from: { type: "integer", minimum: 0 }, year_to: { type: "integer", minimum: 0 }, schedule: { type: "string" }, category: { type: "string" }, missing_field: { type: "string", enum: ["problem", "answer", "commentary", "body", "questions", "translation", "source", "strict_complete"], description: "この項目に不足があるグループだけを返す" }, only_incomplete: { type: "boolean", description: "必要項目がすべて揃っていないグループだけを返す" }, sort: { type: "string", enum: ["coverage_asc", "year_desc", "university_asc"], default: "coverage_asc" }, limit: { type: "integer", minimum: 1, maximum: 100, default: 100 } }, additionalProperties: false } },
  { name: "audit_question_for_correction", title: "修正前監査", description: "指定した大問・フィールドを監査し、現在の原文・ハッシュ・検出事項を固定した30分有効の一回限り監査IDを発行します。問題データ自体は変更しません。修正にはこの監査を先に実行する必要があります。", inputSchema: { type: "object", properties: { exam_id: { type: "integer", minimum: 1 }, question_number: { type: "integer", minimum: 1 }, target_field: { type: "string", enum: ["problem_text", "answer_text", "translation_text", "commentary_text"] }, reason: { type: "string", minLength: 5, maxLength: 500, description: "監査・修正が必要な理由" } }, required: ["exam_id", "question_number", "target_field", "reason"], additionalProperties: false } },
  { name: "prepare_question_correction", title: "修正差分準備", description: "有効な監査IDと修正後テキストから差分を作成し、確認用proposal_hashを発行します。この段階では問題データを変更しません。", inputSchema: { type: "object", properties: { audit_id: { type: "string" }, replacement_text: { type: "string", maxLength: 500000, description: "監査対象フィールド全体の修正後テキスト" } }, required: ["audit_id", "replacement_text"], additionalProperties: false } },
  { name: "apply_audited_correction", title: "監査済み修正適用", description: "監査と差分確認が完了し、原文が監査時点から変わっていない場合だけ修正を一度適用します。audit_id、proposal_hash、明示的なconfirm=trueが必要で、変更履歴を保存します。", inputSchema: { type: "object", properties: { audit_id: { type: "string" }, proposal_hash: { type: "string" }, confirm: { type: "boolean", description: "準備された差分を確認して修正を実行する場合のみtrue" } }, required: ["audit_id", "proposal_hash", "confirm"], additionalProperties: false } },
  { name: "get_question_correction_history", title: "問題修正履歴", description: "指定した大問について、監査済み修正の変更ID・対象フィールド・理由・修正前後ハッシュ・実行日時を取得します。原文の過去版は返しません。", inputSchema: { type: "object", properties: { exam_id: { type: "integer", minimum: 1 }, question_number: { type: "integer", minimum: 1 }, limit: { type: "integer", minimum: 1, maximum: 100, default: 20 } }, required: ["exam_id", "question_number"], additionalProperties: false } },
  { name: "validate_questions", title: "問題データ検査", description: "登録済み問題を読み取り専用で検査し、問題・解答・全訳・解説・出典の欠落、マークアップの閉じ忘れ、選択肢番号や解答番号の不整合を一覧化します。データは変更しません。", inputSchema: { type: "object", properties: { university_name: { type: "string" }, year_from: { type: "integer", minimum: 0 }, year_to: { type: "integer", minimum: 0 }, schedule: { type: "string" }, category: { type: "string" }, issue_code: { type: "string", enum: ["missing_problem_text", "missing_body", "missing_questions", "missing_answer", "missing_translation", "missing_commentary", "missing_source", "unclosed_glossary", "unclosed_source", "unbalanced_blank", "unbalanced_choice", "non_contiguous_choices", "answer_out_of_range"] }, severity: { type: "string", enum: ["error", "warning"] }, limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false } },
  { name: "get_exam", title: "試験詳細", description: "exam_idを指定し、試験内の全大問・解答・全訳・解説を取得します。返却テキストはデータベース原文です。原文を求められた場合は要約や言い換えをせず、そのまま表示してください。", inputSchema: { type: "object", properties: { exam_id: { type: "integer" } }, required: ["exam_id"], additionalProperties: false } },
  { name: "get_question", title: "大問詳細", description: "exam_idと大問番号を指定し、問題・解答・全訳・解説を取得します。返却テキストはデータベース原文です。原文を求められた場合は要約や言い換えをせず、そのまま表示してください。", inputSchema: { type: "object", properties: { exam_id: { type: "integer" }, question_number: { type: "integer" } }, required: ["exam_id", "question_number"], additionalProperties: false } },
];

const MCP_WRITE_TOOL_NAMES = new Set(["audit_question_for_correction", "prepare_question_correction", "apply_audited_correction"]);
const ANNOTATED_TOOLS = TOOLS.map((tool) => ({
  ...tool,
  annotations: {
    readOnlyHint: !MCP_WRITE_TOOL_NAMES.has(tool.name),
    destructiveHint: false,
    openWorldHint: false,
  },
}));

// Keep the canonical bare names for direct MCP clients while also advertising
// the namespaced aliases cached by ChatGPT custom connectors.
const DISCOVERABLE_TOOLS = ANNOTATED_TOOLS.flatMap((tool) => [
  tool,
  { ...tool, name: `exam.${tool.name}` },
]);

async function mcp(request: Request, env: McpEnv, url: URL) {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  let msg: any; try { msg = await request.json(); } catch { return rpcError(null, -32700, "Parse error"); }
  if (msg.method === "initialize") return rpc(msg.id, {
    protocolVersion: msg.params?.protocolVersion || "2025-06-18",
    capabilities: { tools: {} },
    serverInfo: { name: "medical-exam", version: "1.0.0" },
    instructions: [
      "Use these tools to search, retrieve, audit, and—only after an explicit audit and diff confirmation—correct the user's Japanese medical school entrance-exam database.",
      "The problem_text, answer_text, translation_text, and commentary_text fields contain canonical database text.",
      "When the user requests database content, reproduce only the requested fields verbatim.",
      "Do not summarize, rewrite, correct, translate, or omit database text unless the user explicitly requests it.",
      "Preserve all custom markup exactly as stored.",
      "Never call apply_audited_correction unless the user explicitly approves the exact prepared diff. A correction requires a fresh audit_id, matching proposal_hash, unchanged audited source, and confirm=true.",
    ].join(" "),
  });
  if (msg.method === "notifications/initialized") return new Response(null, { status: 202 });
  if (msg.method === "tools/list") return rpc(msg.id, { tools: DISCOVERABLE_TOOLS });
  if (msg.method !== "tools/call") return rpcError(msg.id, -32601, "Method not found");
  const auth = await verify(request, env);
  if (!auth) return response({ error: "unauthorized" }, 401, { "WWW-Authenticate": `Bearer resource_metadata="${baseUrl(url)}/.well-known/oauth-protected-resource", scope="${MCP_DEFAULT_SCOPE}"` });
  const toolName = normalizeToolName(msg.params?.name);
  if (MCP_WRITE_TOOL_NAMES.has(toolName) && !hasScope(auth, MCP_WRITE_SCOPE)) {
    return rpc(msg.id, { content: [{ type: "text", text: "exams:write scope is required; reconnect the MCP connection and approve audited corrections" }], isError: true });
  }
  try { const result = await callTool(toolName, msg.params?.arguments || {}, env, auth); return rpc(msg.id, { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, isError: false }); }
  catch (error) { return rpc(msg.id, { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true }); }
}

export async function handleMcpRoute(request: Request, env: McpEnv): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname, root = baseUrl(url);
  if (path === "/.well-known/oauth-protected-resource" && request.method === "GET") return response({ resource: `${root}/mcp`, authorization_servers: [root], scopes_supported: MCP_SUPPORTED_SCOPES });
  if (path === "/.well-known/oauth-authorization-server" && request.method === "GET") return response({ issuer: root, authorization_endpoint: `${root}/oauth/authorize`, token_endpoint: `${root}/oauth/token`, registration_endpoint: `${root}/oauth/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code"], token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"], scopes_supported: MCP_SUPPORTED_SCOPES });
  if (path === "/oauth/register" && request.method === "POST") return registerClient(request, env);
  if (path === "/oauth/authorize" && (request.method === "GET" || request.method === "POST")) return authorize(request, env, url);
  if (path === "/oauth/token" && request.method === "POST") return token(request, env);
  if (path === "/mcp") return mcp(request, env, url);
  return null;
}
