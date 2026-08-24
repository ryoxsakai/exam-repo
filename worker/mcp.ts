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
  { name: "get_database_coverage", title: "データ登録率", description: "大学・年度・方式別に、問題・解答・解説・長文本文・設問・全訳・出典の期待件数、登録件数、不足件数、登録率を集計します。長文関連項目はカテゴリ名に「長文」を含む問題だけを分母にします。特定項目が不足しているグループだけを抽出できます。読み取り専用でデータは変更しません。", inputSchema: { type: "object", properties: { university_name: { type: "string" }, year_from: { type: "integer", minimum: 0 }, year_to: { type: "integer", minimum: 0 }, schedule: { type: "string" }, category: { type: "string" }, missing_field: { type: "string", enum: ["problem", "answer", "commentary", "body", "questions", "translation", "source", "strict_complete"], description: "この項目に不足があるグループだけを返す" }, only_incomplete: { type: "boolean", description: "必要項目がすべて揃っていないグループだけを返す" }, sort: { type: "string", enum: ["coverage_asc", "year_desc", "university_asc"], default: "coverage_asc" }, limit: { type: "integer", minimum: 1, maximum: 100, default: 100 } }, additionalProperties: false } },
  { name: "validate_questions", title: "問題データ検査", description: "登録済み問題を読み取り専用で検査し、問題・解答・全訳・解説・出典の欠落、マークアップの閉じ忘れ、選択肢番号や解答番号の不整合を一覧化します。データは変更しません。", inputSchema: { type: "object", properties: { university_name: { type: "string" }, year_from: { type: "integer", minimum: 0 }, year_to: { type: "integer", minimum: 0 }, schedule: { type: "string" }, category: { type: "string" }, issue_code: { type: "string", enum: ["missing_problem_text", "missing_body", "missing_questions", "missing_answer", "missing_translation", "missing_commentary", "missing_source", "unclosed_glossary", "unclosed_source", "unbalanced_blank", "unbalanced_choice", "non_contiguous_choices", "answer_out_of_range"] }, severity: { type: "string", enum: ["error", "warning"] }, limit: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false } },
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
