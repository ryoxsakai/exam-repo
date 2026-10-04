const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { build } = require('../panel/node_modules/esbuild');

const ROOT = 'https://exam-auth.test';
const SESSION = '__Host-exam_oauth_login';
const CSRF = '__Host-exam_oauth_csrf';
const KEY = 'test-only-api-key';
const VERIFIER = 'a'.repeat(64);
const CHALLENGE = crypto.createHash('sha256').update(VERIFIER).digest('base64url');
const FIELDS = { response_type: 'code', client_id: 'client-a', redirect_uri: 'https://client.test/callback', state: 'test-state', code_challenge: CHALLENGE, code_challenge_method: 'S256', scope: 'exams:read exams:write' };
const decode = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const inputs = (html, action = '/oauth/authorize') => {
  const form = [...html.matchAll(/<form[^>]*action="([^"]+)"[^>]*>([\s\S]*?)<\/form>/g)].find(m => m[1] === action);
  assert.ok(form, `Missing ${action} form`);
  const result = new URLSearchParams();
  for (const input of form[2].matchAll(/<input\b[^>]*>/g)) {
    const attrs = Object.fromEntries([...input[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], decode(m[2])]));
    if (attrs.type === 'hidden' || (attrs.type === 'checkbox' && /\bchecked\b/.test(input[0]))) result.set(attrs.name, attrs.value || '');
  }
  return result;
};
let handleMcpRoute;
function fixture() {
  const db = new DatabaseSync(':memory:');
  const env = { EXAM_API_KEY: KEY, EXAM_SESSION_SECRET: 'test-only-signing-secret', DB: { prepare(sql) {
    const s = { values: [], bind(...values) { this.values = values; return this; }, async first() { return db.prepare(sql).get(...this.values) || null; }, async all() { return { results: db.prepare(sql).all(...this.values) }; }, run() { const result = db.prepare(sql).run(...this.values); return { ...result, meta: { changes: Number(result.changes) } }; } };
    return s;
  }, async batch(statements) { db.exec('BEGIN'); try { const result = statements.map(statement => statement.run()); db.exec('COMMIT'); return Promise.all(result); } catch (error) { db.exec('ROLLBACK'); throw error; } } } };
  const jar = new Map();
  const request = async (pathname, { method = 'GET', body, origin = ROOT, cookies = true, headers = {} } = {}) => {
    const res = await handleMcpRoute(new Request(ROOT + pathname, { method, headers: { ...(cookies && jar.size ? { Cookie: [...jar].map(([k,v]) => `${k}=${v}`).join('; ') } : {}), ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded', ...(origin ? { Origin: origin } : {}) } : {}), ...headers }, ...(body !== undefined ? { body: String(body) } : {}) }), env);
    if (res) for (const c of res.headers.getSetCookie()) { const [pair] = c.split(';'); const i = pair.indexOf('='); if (/Max-Age=0(?:;|$)/.test(c)) jar.delete(pair.slice(0,i)); else jar.set(pair.slice(0,i), pair.slice(i+1)); }
    return res;
  };
  const authorize = async (changes = {}) => { const p = new URLSearchParams({ ...FIELDS, ...changes }); const res = await request('/oauth/authorize?' + p); return { res, html: await res.text() }; };
  const submit = async (html, { remember = false, key = KEY, action = '/oauth/authorize', ...opts } = {}) => { const p = inputs(html, action); if (remember) p.set('remember_login', '1'); else p.delete('remember_login'); if (key !== null) p.set('api_key', key); return request(action, { method: 'POST', body: p, ...opts }); };
  const count = table => Number(db.prepare(`SELECT count(*) n FROM ${table}`).get().n);
  const ready = async () => { const r = await request('/oauth/register', { method: 'POST', body: JSON.stringify({ redirect_uris: [FIELDS.redirect_uri] }), headers: { 'Content-Type': 'application/json' } }); assert.equal(r.status, 201); db.prepare('UPDATE mcp_oauth_clients SET client_id = ?').run(FIELDS.client_id); };
  const remembered = async () => { const a = await authorize(); const res = await submit(a.html, { remember: true }); assert.equal(res.status, 302); return res; };
  return { db, env, jar, request, authorize, submit, count, ready, remembered };
}
let groups = 0;
async function check(name, run) { const f = fixture(); await f.ready(); try { await run(f); groups++; console.log(`PASS: ${name}`); } finally { f.db.close(); } }
async function codeRequest(f, scope = FIELDS.scope) {
  const a = await f.authorize({ scope }); const r = await f.submit(a.html);
  const p = new URLSearchParams({ grant_type: 'authorization_code', code: new URL(r.headers.get('Location')).searchParams.get('code'), client_id: FIELDS.client_id, redirect_uri: FIELDS.redirect_uri, code_verifier: VERIFIER });
  return p;
}
async function issue(f, scope = FIELDS.scope) {
  const res = await f.request('/oauth/token', { method: 'POST', body: await codeRequest(f, scope) }); assert.equal(res.status,200); return res.json();
}
async function refresh(f, raw, extra = {}) { return f.request('/oauth/token', { method:'POST', body:new URLSearchParams({ grant_type:'refresh_token', client_id:FIELDS.client_id, refresh_token:raw, ...extra }) }); }
async function access(f, raw) { return f.request('/mcp', { method:'POST', body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'list_universities',arguments:{}} }),headers:{Authorization:'Bearer '+raw,'Content-Type':'application/json'} }); }
async function main() {
 const tmp = await fs.mkdtemp(path.join(os.tmpdir(),'exam-refresh-test-'));
 try {
 await build({entryPoints:[path.resolve(__dirname,'../worker/mcp.ts')],bundle:true,platform:'node',format:'esm',outfile:path.join(tmp,'mcp.mjs')});
 ({ handleMcpRoute } = await import(pathToFileURL(path.join(tmp,'mcp.mjs'))));
 await check('issuance failure rolls code back and retry succeeds without affecting live grants',async f=>{
  const live=await issue(f); const p=await codeRequest(f); const families=f.count('mcp_oauth_families'), refreshes=f.count('mcp_oauth_refresh');
  f.db.exec("CREATE TRIGGER fail_refresh_insert BEFORE INSERT ON mcp_oauth_refresh BEGIN SELECT RAISE(ABORT, 'Injected refresh persistence failure'); END");
  await assert.rejects(()=>f.request('/oauth/token',{method:'POST',body:p}),/Injected refresh persistence failure/);
  assert.equal(f.count('mcp_oauth_codes'),1,'Failed issuance must preserve authorization code');
  assert.equal(f.count('mcp_oauth_families'),families);assert.equal(f.count('mcp_oauth_refresh'),refreshes);
  assert.equal((await access(f,live.access_token)).status,200);
  f.db.exec('DROP TRIGGER fail_refresh_insert');
  const retry=await f.request('/oauth/token',{method:'POST',body:p});assert.equal(retry.status,200);assert.ok((await retry.json()).refresh_token);assert.equal(f.count('mcp_oauth_codes'),0);
  assert.equal((await refresh(f,live.refresh_token)).status,200);
 });
 await check('parallel authorization code exchange issues exactly one family',async f=>{
  const p=await codeRequest(f);const results=await Promise.all([f.request('/oauth/token',{method:'POST',body:p}),f.request('/oauth/token',{method:'POST',body:p})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);assert.equal(f.count('mcp_oauth_codes'),0);assert.equal(f.count('mcp_oauth_families'),1);assert.equal(f.count('mcp_oauth_refresh'),1);
 });
 await check('opaque hashed refresh, fixed 30 days, short access, anonymous rejection',async f=>{
  const t = await issue(f);assert.match(t.refresh_token,/^[A-Za-z0-9_-]{43}$/);assert.ok(t.refresh_token_expires_in<=2592000);assert.ok(t.expires_in<=86400);assert.equal((await access(f,t.access_token)).status,200);assert.equal((await access(f,'invalid')).status,401);
  const stored=f.db.prepare('SELECT * FROM mcp_oauth_refresh').get();assert.notEqual(stored.token_hash,t.refresh_token);assert.equal(stored.token_hash,crypto.createHash('sha256').update(t.refresh_token).digest('base64url'));
  const expiry=f.db.prepare('SELECT expires_at FROM mcp_oauth_families').get().expires_at;
  const r=await refresh(f,t.refresh_token);assert.equal(r.status,200);const n=await r.json();assert.notEqual(n.refresh_token,t.refresh_token);assert.equal(f.db.prepare('SELECT expires_at FROM mcp_oauth_families').get().expires_at,expiry);
 });
 await check('parallel refresh retry is identical and old replay revokes access and refresh',async f=>{
  const t=await issue(f);const rr=await Promise.all([refresh(f,t.refresh_token),refresh(f,t.refresh_token)]);assert.deepEqual(rr.map(r=>r.status),[200,200]);const [a,b]=await Promise.all(rr.map(r=>r.json()));assert.equal(a.refresh_token,b.refresh_token);assert.equal(f.count('mcp_oauth_refresh'),2);
  f.db.prepare('UPDATE mcp_oauth_refresh SET used_at = ? WHERE used_at IS NOT NULL').run(Date.now()-6000);
  assert.equal((await refresh(f,t.refresh_token)).status,400);assert.equal((await access(f,a.access_token)).status,401);assert.equal((await refresh(f,a.refresh_token)).status,400);
 });
 await check('used successor makes old replay revoke; client mismatch cannot revoke',async f=>{
  const t=await issue(f);assert.equal((await refresh(f,t.refresh_token,{client_id:'wrong'})).status,400);const a=await (await refresh(f,t.refresh_token)).json();const b=await (await refresh(f,a.refresh_token)).json();assert.ok(b.refresh_token);assert.equal((await refresh(f,t.refresh_token)).status,400);assert.equal((await refresh(f,b.refresh_token)).status,400);
 });
 await check('scope escalation rejected and reduced scope remains reduced',async f=>{
  const t=await issue(f);assert.equal((await refresh(f,t.refresh_token,{scope:'exams:read admin'})).status,400);const a=await (await refresh(f,t.refresh_token,{scope:'exams:read'})).json();assert.equal(a.scope,'exams:read');const b=await (await refresh(f,a.refresh_token)).json();assert.equal(b.scope,'exams:read');assert.equal((await refresh(f,b.refresh_token,{scope:FIELDS.scope})).status,400);
 });
 await check('expiry cap, credential rotation, explicit revocation',async f=>{
  const t=await issue(f);f.db.prepare('UPDATE mcp_oauth_families SET expires_at = ?').run(Date.now()+5000);const a=await (await refresh(f,t.refresh_token)).json();assert.ok(a.expires_in<=5);f.db.prepare('UPDATE mcp_oauth_families SET expires_at = ?').run(Date.now()-1);assert.equal((await refresh(f,a.refresh_token)).status,400);assert.equal((await access(f,a.access_token)).status,401);
  const u=await issue(f);f.env.EXAM_API_KEY='rotated-test-key';assert.equal((await refresh(f,u.refresh_token)).status,400);assert.equal((await access(f,u.access_token)).status,401);f.env.EXAM_API_KEY=KEY;
  const v=await issue(f);assert.equal((await f.request('/oauth/revoke',{method:'POST',body:new URLSearchParams({token:v.refresh_token,client_id:FIELDS.client_id})})).status,200);assert.equal((await access(f,v.access_token)).status,401);assert.equal((await refresh(f,v.refresh_token)).status,400);
 });
 await check('protocol duplicate/unknown grant rejection, advertised refresh',async f=>{
  assert.equal((await f.request('/oauth/token',{method:'POST',body:'grant_type=client_credentials'})).status,400);assert.equal((await f.request('/oauth/token',{method:'POST',body:'grant_type=refresh_token&grant_type=authorization_code'})).status,400);
  const m=await (await f.request('/.well-known/oauth-authorization-server')).json();assert.ok(m.grant_types_supported.includes('refresh_token'));assert.equal(m.revocation_endpoint,ROOT+'/oauth/revoke');
 });
 console.log('PASS: '+groups+' refresh security regression groups (synthetic credentials, in-memory SQLite)');
 } finally { await fs.rm(tmp,{recursive:true,force:true}); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
