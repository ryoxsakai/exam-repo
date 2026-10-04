// Refresh tokens are opaque, hashed at rest, and expire 30 days after consent.
export const REFRESH_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const RETRY_MS = 5000;
type Env = { DB: D1Database; EXAM_API_KEY?: string; EXAM_SESSION_SECRET?: string };
type Family = { id: string; client_id: string; scope: string; expires_at: number; revoked_at: number | null; credential_version: string; issuer: string };
type Token = Family & { token_hash: string; used_at: number | null; successor_hash: string | null };
const bytes = (s: string) => new TextEncoder().encode(s);
const encoded = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function hash(value: string) { return encoded(await crypto.subtle.digest('SHA-256', bytes(value))); }
async function credentials(env: Env) { return hash(JSON.stringify([env.EXAM_API_KEY, env.EXAM_SESSION_SECRET])); }
async function successor(env: Env, raw: string, id: string) {
  const key = await crypto.subtle.importKey('raw', bytes(env.EXAM_SESSION_SECRET!), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return encoded(await crypto.subtle.sign('HMAC', key, bytes(JSON.stringify(['exam-refresh-v1', id, raw]))));
}
export async function refreshSchema(env: Env) {
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS mcp_oauth_families (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, scope TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER, credential_version TEXT NOT NULL, issuer TEXT NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS mcp_oauth_refresh (token_hash TEXT PRIMARY KEY, family_id TEXT NOT NULL, scope TEXT NOT NULL, used_at INTEGER, successor_hash TEXT)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_mcp_oauth_refresh_family ON mcp_oauth_refresh(family_id)'),
    env.DB.prepare('DELETE FROM mcp_oauth_refresh WHERE family_id IN (SELECT id FROM mcp_oauth_families WHERE expires_at <= ?)').bind(Date.now()),
    env.DB.prepare('DELETE FROM mcp_oauth_families WHERE expires_at <= ?').bind(Date.now()),
  ]);
}
export async function newFamily(env: Env, client: string, scope: string, issuer: string) {
  const id = crypto.randomUUID(), raw = encoded(crypto.getRandomValues(new Uint8Array(32)).buffer), expires = Date.now() + REFRESH_AGE_MS;
  return { id, raw, expires, statements: [
    env.DB.prepare('INSERT INTO mcp_oauth_families (id, client_id, scope, expires_at, credential_version, issuer) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1').bind(id, client, scope, expires, await credentials(env), issuer),
    env.DB.prepare('INSERT INTO mcp_oauth_refresh (token_hash, family_id, scope) SELECT ?, ?, ? WHERE changes() = 1').bind(await hash(raw), id, scope),
  ] };
}
export async function activeFamily(env: Env, id: string, client: string, issuer: string) {
  const f = await env.DB.prepare('SELECT * FROM mcp_oauth_families WHERE id = ?').bind(id).first<Family>();
  return !!f && f.client_id === client && f.issuer === issuer && !f.revoked_at && f.expires_at > Date.now() && f.credential_version === await credentials(env);
}
export async function rotate(env: Env, p: URLSearchParams, issuer: string) {
  const raw = p.get('refresh_token') || '', client = p.get('client_id') || '', now = Date.now();
  if (!env.EXAM_API_KEY || !env.EXAM_SESSION_SECRET || !/^[A-Za-z0-9_-]{43}$/.test(raw) || !client) return null;
  const old = await hash(raw);
  const row = await env.DB.prepare('SELECT f.*, r.scope AS scope, r.token_hash, r.used_at, r.successor_hash FROM mcp_oauth_refresh r JOIN mcp_oauth_families f ON f.id = r.family_id WHERE r.token_hash = ?').bind(old).first<Token>();
  if (!row || row.client_id !== client || row.issuer !== issuer || row.revoked_at || row.expires_at <= now || row.credential_version !== await credentials(env)) return null;
  const scopes = [...new Set((p.get('scope') ?? row.scope).split(' ').filter(Boolean))];
  if (!scopes.includes('exams:read') || scopes.some(s => !row.scope.split(' ').includes(s))) return null;
  const scope = scopes.join(' '), next = await successor(env, raw, row.id), nextHash = await hash(next);
  // Conditional update plus changes() in one D1 transaction elects exactly one winner.
  const result = await env.DB.batch([
    env.DB.prepare('UPDATE mcp_oauth_refresh SET used_at = ?, successor_hash = ? WHERE token_hash = ? AND used_at IS NULL AND EXISTS (SELECT 1 FROM mcp_oauth_families WHERE id = ? AND revoked_at IS NULL AND expires_at > ?)').bind(now, nextHash, old, row.id, now),
    env.DB.prepare('INSERT INTO mcp_oauth_refresh (token_hash, family_id, scope) SELECT ?, ?, ? WHERE changes() = 1').bind(nextHash, row.id, scope),
  ]);
  if (!result[0].meta.changes) {
    const used = await env.DB.prepare('SELECT used_at, successor_hash FROM mcp_oauth_refresh WHERE token_hash = ?').bind(old).first<{ used_at: number; successor_hash: string }>();
    const child = await env.DB.prepare('SELECT used_at, scope FROM mcp_oauth_refresh WHERE token_hash = ?').bind(nextHash).first<{ used_at: number | null; scope: string }>();
    if (!used || Date.now() - used.used_at < 0 || Date.now() - used.used_at > RETRY_MS || used.successor_hash !== nextHash || !child || child.used_at !== null || child.scope !== scope) {
      await env.DB.prepare('UPDATE mcp_oauth_families SET revoked_at = ? WHERE id = ?').bind(now, row.id).run();
      return null;
    }
  }
  const current = await env.DB.prepare('SELECT used_at FROM mcp_oauth_refresh WHERE token_hash = ?').bind(nextHash).first<{ used_at: number | null }>();
  if (!current || current.used_at !== null || !await activeFamily(env, row.id, client, issuer)) return null;
  return { id: row.id, client_id: client, scope, expires: row.expires_at, raw: next };
}
export async function revoke(env: Env, p: URLSearchParams) {
  const token = p.get('token') || '', client = p.get('client_id') || '';
  if (/^[A-Za-z0-9_-]{43}$/.test(token) && client) await env.DB.prepare('UPDATE mcp_oauth_families SET revoked_at = ? WHERE client_id = ? AND id IN (SELECT family_id FROM mcp_oauth_refresh WHERE token_hash = ?)').bind(Date.now(), client, await hash(token)).run();
}
