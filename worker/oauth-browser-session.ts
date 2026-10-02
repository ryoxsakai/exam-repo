// Browser-only login convenience. These cookies are never OAuth bearer tokens.
export interface BrowserSessionEnv {
  DB: D1Database;
  EXAM_API_KEY?: string;
  EXAM_SESSION_SECRET?: string;
}

export const REMEMBER_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const FORM_AGE_MS = 10 * 60 * 1000;
const SESSION_COOKIE = "__Host-exam_oauth_login";
const CSRF_COOKIE = "__Host-exam_oauth_csrf";
const RANDOM_VALUE = /^[A-Za-z0-9_-]{43}$/;

function encode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randomValue() { return encode(crypto.getRandomValues(new Uint8Array(32))); }
async function hash(value: string) {
  return encode(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
async function mac(env: BrowserSessionEnv, value: string) {
  if (!env.EXAM_SESSION_SECRET || !env.EXAM_API_KEY) throw new Error("OAuth login is not configured");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.EXAM_SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return encode(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}
async function equal(a: string, b: string) {
  const [left, right] = await Promise.all([hash(a), hash(b)]);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}
function readCookie(request: Request, name: string) {
  const values = (request.headers.get("Cookie") || "").split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (values.length !== 1) return "";
  const value = values[0].slice(name.length + 1);
  return RANDOM_VALUE.test(value) ? value : "";
}
function cookie(name: string, value: string, age: number) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
}
async function credentialTag(env: BrowserSessionEnv) {
  // Rotation of either existing secret invalidates every remembered browser.
  return mac(env, `exam-browser-login-credential:v1:${env.EXAM_API_KEY}`);
}

export async function ensureBrowserSessionSchema(env: BrowserSessionEnv) {
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS mcp_oauth_browser_sessions (token_hash TEXT PRIMARY KEY, credential_tag TEXT NOT NULL, expires_at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_mcp_oauth_browser_sessions_expiry ON mcp_oauth_browser_sessions(expires_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS mcp_oauth_browser_forms (token_hash TEXT PRIMARY KEY, binding_hash TEXT NOT NULL, expires_at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_mcp_oauth_browser_forms_expiry ON mcp_oauth_browser_forms(expires_at)"),
  ]);
  await env.DB.prepare("DELETE FROM mcp_oauth_browser_sessions WHERE expires_at <= ?").bind(Date.now()).run();
  await env.DB.prepare("DELETE FROM mcp_oauth_browser_forms WHERE expires_at <= ?").bind(Date.now()).run();
}

export async function rememberedLogin(request: Request, env: BrowserSessionEnv) {
  const value = readCookie(request, SESSION_COOKIE);
  if (!value || !env.EXAM_API_KEY || !env.EXAM_SESSION_SECRET) return null;
  const row = await env.DB.prepare("SELECT credential_tag, expires_at FROM mcp_oauth_browser_sessions WHERE token_hash = ?").bind(await hash(value)).first<{ credential_tag: string; expires_at: number }>();
  if (!row || !Number.isFinite(row.expires_at) || row.expires_at <= Date.now() || !(await equal(row.credential_tag, await credentialTag(env)))) return null;
  return { expiresAt: row.expires_at };
}

export async function forgetLogin(request: Request, env: BrowserSessionEnv) {
  const value = readCookie(request, SESSION_COOKIE);
  if (value) await env.DB.prepare("DELETE FROM mcp_oauth_browser_sessions WHERE token_hash = ?").bind(await hash(value)).run();
  return cookie(SESSION_COOKIE, "", 0);
}

export async function rememberLogin(request: Request, env: BrowserSessionEnv) {
  const value = randomValue();
  // Rotate an existing identifier after fresh password authentication.
  await forgetLogin(request, env);
  await env.DB.prepare("INSERT INTO mcp_oauth_browser_sessions (token_hash, credential_tag, expires_at) VALUES (?, ?, ?)").bind(await hash(value), await credentialTag(env), Date.now() + REMEMBER_AGE_MS).run();
  return cookie(SESSION_COOKIE, value, REMEMBER_AGE_MS / 1000);
}

async function formBinding(request: Request, env: BrowserSessionEnv, action: string, context: string, nonce: string) {
  return hash(JSON.stringify([new URL(request.url).origin, action, context, nonce, readCookie(request, SESSION_COOKIE), await credentialTag(env)]));
}

export async function loginFormToken(request: Request, env: BrowserSessionEnv, action: string, context: string, existingNonce?: string) {
  const nonce = existingNonce || readCookie(request, CSRF_COOKIE) || randomValue();
  const token = randomValue();
  await env.DB.prepare("INSERT INTO mcp_oauth_browser_forms (token_hash, binding_hash, expires_at) VALUES (?, ?, ?)").bind(await hash(token), await formBinding(request, env, action, context, nonce), Date.now() + FORM_AGE_MS).run();
  return { token, nonce, cookie: cookie(CSRF_COOKIE, nonce, FORM_AGE_MS / 1000) };
}

export async function validLoginForm(request: Request, env: BrowserSessionEnv, action: string, context: string, token: string) {
  const origin = new URL(request.url).origin;
  // Both checks are intentional: same-site sibling origins are not trusted.
  if (request.headers.get("Origin") !== origin || request.headers.get("Sec-Fetch-Site") === "cross-site") return false;
  const nonce = readCookie(request, CSRF_COOKIE);
  if (!nonce || !RANDOM_VALUE.test(token)) return false;
  // Atomic consumption: repeated/concurrent submissions cannot mint extra codes.
  const row = await env.DB.prepare("DELETE FROM mcp_oauth_browser_forms WHERE token_hash = ? AND binding_hash = ? AND expires_at > ? RETURNING token_hash").bind(await hash(token), await formBinding(request, env, action, context, nonce), Date.now()).first<{ token_hash: string }>();
  return Boolean(row);
}
