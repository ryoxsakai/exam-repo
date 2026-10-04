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
    const s = { values: [], bind(...values) { this.values = values; return this; }, async first() { return db.prepare(sql).get(...this.values) || null; }, async all() { return { results: db.prepare(sql).all(...this.values) }; }, async run() { const result = db.prepare(sql).run(...this.values); return { ...result, meta: { changes: Number(result.changes) } }; } };
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
async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'exam-login-test-'));
  await build({ entryPoints: [path.resolve(__dirname, '../worker/mcp.ts')], bundle: true, platform: 'node', format: 'esm', outfile: path.join(tmp, 'mcp.mjs') });
  ({ handleMcpRoute } = await import(pathToFileURL(path.join(tmp, 'mcp.mjs'))));
  await check('default off, escaped destination, no storage, secure page and cookies', async f => {
    const { res, html } = await f.authorize({ state: '\"><script>alert(1)</script>' });
    assert.equal(res.status, 200); assert.match(html, /type="password"[^>]*required/); assert.doesNotMatch(html, /name="remember_login"[^>]*checked/); assert.doesNotMatch(html, /localStorage|sessionStorage|<script/); assert.match(html, /&lt;script&gt;/); assert.match(html, /https:\/\/client.test\/callback/);
    assert.equal(res.headers.get('Cache-Control'), 'no-store'); assert.equal(res.headers.get('Referrer-Policy'), 'same-origin'); assert.equal(res.headers.get('X-Frame-Options'), 'DENY'); assert.match(res.headers.get('Content-Security-Policy'), /form-action 'self'/);
    assert.match(res.headers.get('Set-Cookie'), /^__Host-exam_oauth_csrf=.*; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=600$/); assert.equal(f.count('mcp_oauth_browser_sessions'), 0); assert.equal(f.count('mcp_oauth_codes'), 0);
  });
  await check('unchecked successful login does not retain identity and PKCE/access TTL unchanged', async f => {
    const { html } = await f.authorize(); const r = await f.submit(html); assert.equal(r.status, 302); assert.equal(f.jar.has(SESSION), false); assert.equal(f.count('mcp_oauth_browser_sessions'), 0); assert.match((await f.authorize()).html, /type="password"/);
    const dest = new URL(r.headers.get('Location')); assert.equal(dest.origin, 'https://client.test'); assert.equal(dest.searchParams.get('state'), FIELDS.state);
    const code = dest.searchParams.get('code'); const p = new URLSearchParams({ grant_type: 'authorization_code', code, client_id: FIELDS.client_id, redirect_uri: FIELDS.redirect_uri, code_verifier: VERIFIER });
    const bad = new URLSearchParams(p); bad.set('code_verifier', 'wrong'); assert.equal((await f.request('/oauth/token', { method: 'POST', body: bad })).status, 400);
    const token = await f.request('/oauth/token', { method: 'POST', body: p }); const data = await token.json(); assert.equal(token.status, 200); assert.ok(data.expires_in >= 86399 && data.expires_in <= 86400); assert.equal(data.scope, FIELDS.scope); assert.equal((await f.request('/oauth/token', { method: 'POST', body: p })).status, 400);
  });
  await check('remember on, random hashed session, repeated consent without sliding expiry', async f => {
    const r = await f.remembered(); assert.match(r.headers.get('Set-Cookie'), /^__Host-exam_oauth_login=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000$/); assert.doesNotMatch(r.headers.get('Set-Cookie'), /Domain=|test-only/);
    const rows = f.db.prepare('SELECT * FROM mcp_oauth_browser_sessions').all(); assert.equal(rows.length, 1); assert.notEqual(rows[0].token_hash, f.jar.get(SESSION)); assert.doesNotMatch(JSON.stringify(rows), /test-only-api-key|test-only-signing-secret/);
    const before = f.count('mcp_oauth_codes'); const a = await f.authorize(); assert.equal(a.res.status, 200); assert.doesNotMatch(a.html, /type="password"/); assert.match(a.html, /name="remember_login"[^>]*checked/); assert.match(a.html, /接続を許可/); assert.equal(f.count('mcp_oauth_codes'), before);
    const repeated = await f.submit(a.html, { remember: true, key: null }); assert.equal(repeated.status, 302); assert.equal(repeated.headers.get('Set-Cookie'), null); assert.equal(f.db.prepare('SELECT expires_at FROM mcp_oauth_browser_sessions').get().expires_at, rows[0].expires_at);
  });
  await check('unchecked remembered consent revokes session, replay cannot return it', async f => {
    await f.remembered(); const old = f.jar.get(SESSION); const a = await f.authorize(); assert.equal((await f.submit(a.html, { key: null })).status, 302); assert.equal(f.count('mcp_oauth_browser_sessions'), 0); assert.equal(f.jar.has(SESSION), false); f.jar.set(SESSION, old); assert.match((await f.authorize()).html, /type="password"/);
  });
  await check('wrong key and missing password fail without echo/storage; retry succeeds', async f => {
    const missing = await f.authorize(); assert.equal((await f.submit(missing.html, { key: null })).status, 401); const a = await f.authorize(); const bad = await f.submit(a.html, { remember: true, key: 'never-echo-this' }); assert.equal(bad.status, 401); const html = await bad.text(); assert.doesNotMatch(html, /never-echo-this/); assert.match(html, /name="remember_login"[^>]*checked/); assert.equal(f.count('mcp_oauth_codes'), 0); assert.equal(f.count('mcp_oauth_browser_sessions'), 0); assert.equal((await f.submit(html, { remember: true })).status, 302);
  });
  await check('one-use form rejects repeated and concurrent submissions', async f => {
    const a = await f.authorize(); const responses = await Promise.all([f.submit(a.html), f.submit(a.html)]); assert.deepEqual(responses.map(r => r.status).sort(), [302, 403]); assert.equal(f.count('mcp_oauth_codes'), 1);
  });
  await check('origin, browser binding and CSRF token validation', async f => {
    for (const opts of [{ origin: null }, { origin: 'https://evil.test' }, { origin: 'https://sibling.exam-auth.test' }, { headers: { 'Sec-Fetch-Site': 'cross-site' } }, { cookies: false }]) { const a = await f.authorize(); assert.equal((await f.submit(a.html, opts)).status, 403); }
    const a = await f.authorize(); const p = inputs(a.html); p.set('api_key', KEY); p.set('csrf_token', 'x'.repeat(43)); assert.equal((await f.request('/oauth/authorize', { method:'POST', body:p })).status, 403); assert.equal(f.count('mcp_oauth_codes'), 0);
  });
  await check('CSRF tied to OAuth params and action; bad redirect, scope, PKCE and duplicates rejected', async f => {
    for (const [k,v] of [['state','changed'], ['scope','exams:read'], ['code_challenge','b'.repeat(43)]]) { const a = await f.authorize(); const p = inputs(a.html); p.set('api_key', KEY); p.set(k,v); assert.equal((await f.request('/oauth/authorize', { method:'POST', body:p })).status,403); }
    for (const changes of [{ redirect_uri:'https://evil.test/callback' }, { code_challenge:'bad' }, { scope:'exams:admin' }, { response_type:'token' }, { redirect_uri:'javascript:alert(1)' }]) assert.equal((await f.authorize(changes)).res.status,400);
    const a = await f.authorize(); const p = inputs(a.html); p.set('api_key',KEY); p.append('state','duplicate'); assert.equal((await f.request('/oauth/authorize',{method:'POST',body:p})).status,400);
    await f.remembered(); const b=await f.authorize(); const q=inputs(b.html); assert.equal((await f.request('/oauth/logout',{method:'POST',body:q})).status,403); assert.equal(f.count('mcp_oauth_browser_sessions'),1);
  });
  await check('parallel pages and stale-then-restored page work once per form', async f => {
    await f.authorize(); const a=await f.authorize(); const b=await f.authorize(); assert.equal((await f.submit(b.html)).status,302); assert.equal((await f.submit(a.html)).status,302); assert.equal((await f.submit(a.html)).status,403);
  });
  await check('fixed session and form expiry enforced at exact deadline', async f => {
    await f.remembered(); const a=await f.authorize(); f.db.prepare('UPDATE mcp_oauth_browser_forms SET expires_at = ?').run(Date.now()); assert.equal((await f.submit(a.html,{remember:true,key:null})).status,403);
    const b=await f.authorize(); f.db.prepare('UPDATE mcp_oauth_browser_sessions SET expires_at = ?').run(Date.now()); const expired=await f.submit(b.html,{remember:true,key:null}); assert.equal(expired.status,401); assert.match(await expired.text(),/type="password"/); assert.match((await f.authorize()).html,/type="password"/);
  });
  await check('API-key and signing-secret rotation invalidate browser sessions', async f => {
    await f.remembered(); f.env.EXAM_API_KEY='rotated-key'; assert.match((await f.authorize()).html,/type="password"/); f.env.EXAM_API_KEY=KEY; f.env.EXAM_SESSION_SECRET='rotated-secret'; assert.match((await f.authorize()).html,/type="password"/);
  });
  await check('logout GET confirms, POST revokes server-side, replayed cookie no longer works', async f => {
    await f.remembered(); const old=f.jar.get(SESSION); const r=await f.request('/oauth/logout'); assert.equal(r.status,200); assert.equal(f.count('mcp_oauth_browser_sessions'),1); const html=await r.text(); const p=inputs(html,'/oauth/logout'); assert.equal((await f.request('/oauth/logout',{method:'POST',body:p,origin:'https://evil.test'})).status,403); assert.equal(f.count('mcp_oauth_browser_sessions'),1); assert.equal((await f.request('/oauth/logout',{method:'POST',body:p})).status,200); assert.equal(f.count('mcp_oauth_browser_sessions'),0); assert.equal(f.jar.has(SESSION),false); f.jar.set(SESSION,old); assert.match((await f.authorize()).html,/type="password"/);
  });
  await check('inline logout works after CSRF cookie expiry and returns to fixed authorize route', async f => {
    await f.remembered(); f.jar.delete(CSRF); const a=await f.authorize(); const p=inputs(a.html,'/oauth/logout'); const r=await f.request('/oauth/logout',{method:'POST',body:p}); assert.equal(r.status,303); const dest=new URL(r.headers.get('Location')); assert.equal(dest.origin,ROOT); assert.equal(dest.pathname,'/oauth/authorize'); assert.equal(f.count('mcp_oauth_browser_sessions'),0);
  });
  await check('malformed cookies and configuration fail closed, HTTP rejected', async f => {
    await f.remembered(); const original=f.jar.get(SESSION); f.jar.set(SESSION,'bad'); assert.match((await f.authorize()).html,/type="password"/); f.jar.set(SESSION, original); const duplicate=await f.request('/oauth/authorize?'+new URLSearchParams(FIELDS),{headers:{Cookie:`${SESSION}=${original}; ${SESSION}=${original}`}}); assert.match(await duplicate.text(),/type="password"/);
    f.env.EXAM_SESSION_SECRET=''; assert.equal((await f.authorize()).res.status,503); assert.equal((await handleMcpRoute(new Request('http://exam-auth.test/oauth/authorize?'+new URLSearchParams(FIELDS)),f.env)).status,400);
  });
  await check('session persistence failure cannot issue an authorization code', async f => {
    const a=await f.authorize(); const original=f.env.DB.prepare; f.env.DB.prepare=sql=>{if(sql.startsWith('INSERT INTO mcp_oauth_browser_sessions'))throw new Error('Injected persistence failure');return original(sql);}; await assert.rejects(()=>f.submit(a.html,{remember:true}),/Injected persistence failure/); assert.equal(f.count('mcp_oauth_codes'),0);
  });
  await check('browser cookie is never an MCP bearer token and other-browser forms cannot be substituted', async f => {
    await f.remembered(); const result=await f.request('/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'search_exams',arguments:{}}}),headers:{'Content-Type':'application/json'}}); assert.equal(result.status,401);
    const a=await f.authorize(); const original=f.jar.get(SESSION); f.jar.set(SESSION,'z'.repeat(43)); assert.equal((await f.submit(a.html,{key:null,remember:true})).status,403); f.jar.set(SESSION,original);
  });
  await check('client registration rejects unsafe or malformed redirect URIs', async f => {
    for (const uri of ['https://', 'https://u:p@client.test/cb', 'https://client.test/cb#fragment', 'https://client.test/cb#', 'https://client.test\\@evil.test/cb', 'http://client.test/cb']) { const r=await f.request('/oauth/register',{method:'POST',body:JSON.stringify({redirect_uris:[uri]}),headers:{'Content-Type':'application/json'}}); assert.equal(r.status,400,uri); }
  });
  console.log(`PASS: ${groups} OAuth browser-login regression groups (real in-memory SQLite, local fake credentials only)`);
  if(process.argv.includes('--browser')) await browserTest();
}
async function browserTest() {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../panel/node_modules/playwright');
  const browser=await chromium.launch({headless:true,...(process.env.PANEL_CHROMIUM?{executablePath:process.env.PANEL_CHROMIUM}:{})});
  const f=fixture(); await f.ready();
  try {
    const context=await browser.newContext({viewport:{width:390,height:844}}); const page=await context.newPage();
    // Playwright route() skips redirected requests. Fetch interception handles
    // every hop while retaining actual browser redirects, CSP, Origin and cookies.
    const session=await context.newCDPSession(page);
    const interceptionErrors=[];
    page.on('console',message=>{if(message.type()==='error') console.error('Browser:',message.text());});
    page.on('requestfailed',request=>console.error('Browser request failed:',request.method(),request.url(),request.failure()?.errorText));
    session.on('Fetch.requestPaused',async ({requestId,request})=>{
      try {
        const target=new URL(request.url); let result;
        if(target.origin==='https://client.test') {
          assert.equal(new Headers(request.headers).get('Referer'),null);
          assert.equal(new Headers(request.headers).get('Cookie'),null);
          result=new Response(`<p>OAuth callback received</p><a href="${ROOT}/oauth/authorize?${new URLSearchParams(FIELDS)}">認証画面を開く</a>`,{headers:{'Content-Type':'text/html; charset=utf-8'}});
        } else if(target.origin===ROOT) {
          result=await handleMcpRoute(new Request(request.url,{method:request.method,headers:request.headers,...(request.postData?{body:request.postData}:{})}),f.env);
        } else { await session.send('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'}); return; }
        assert.ok(result,'The synthetic route must be handled');
        console.log('Browser mock:',request.method,target.pathname,'→',result.status);
        await session.send('Fetch.fulfillRequest',{requestId,responseCode:result.status,responseHeaders:[...result.headers].map(([name,value])=>({name,value})),body:Buffer.from(await result.text()).toString('base64')});
      } catch(error) { interceptionErrors.push(error); console.error('Synthetic intercept failed:',error); await session.send('Fetch.failRequest',{requestId,errorReason:'Failed'}); }
    });
    await session.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
    const url=ROOT+'/oauth/authorize?'+new URLSearchParams(FIELDS);
    await page.goto(url); await page.getByLabel('EXAM APIキー',{exact:true}).fill(KEY); assert.equal(await page.getByRole('checkbox').isChecked(),false); await page.getByRole('checkbox').check();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:path.join(os.tmpdir(),'exam-oauth-login-mobile.png'),fullPage:true});
    await page.getByRole('button',{name:'接続を許可',exact:true}).click(); await page.waitForURL('https://client.test/**');
    const cookies=await context.cookies(ROOT); const c=cookies.find(c=>c.name===SESSION); assert.ok(c); assert.equal(c.httpOnly,true);assert.equal(c.secure,true);assert.equal(c.sameSite,'Lax');
    await page.getByRole('link',{name:'認証画面を開く',exact:true}).click(); await page.waitForURL(ROOT+'/oauth/authorize?**'); assert.equal(await page.locator('input[type=password]').count(),0); assert.doesNotMatch(await page.evaluate(()=>document.cookie),/exam_oauth/); assert.equal(await page.evaluate(()=>localStorage.length),0);assert.equal(await page.evaluate(()=>sessionStorage.length),0);
    await page.screenshot({path:path.join(os.tmpdir(),'exam-oauth-remembered-mobile.png'),fullPage:true});
    await page.getByRole('button',{name:'接続を許可',exact:true}).click();await page.waitForURL('https://client.test/**');
    assert.equal((await context.cookies(ROOT)).find(c=>c.name===SESSION).expires,c.expires,'Repeated consent must not extend browser expiry');
    f.db.prepare('UPDATE mcp_oauth_browser_sessions SET expires_at = ?').run(Date.now()); await page.goto(url); assert.equal(await page.locator('input[type=password]').count(),1); await page.getByLabel('EXAM APIキー',{exact:true}).fill(KEY); await page.getByRole('checkbox').check(); await page.getByRole('button',{name:'接続を許可',exact:true}).click(); await page.waitForURL('https://client.test/**');
    await page.goto(url); await page.getByRole('checkbox').uncheck(); await page.getByRole('button',{name:'接続を許可',exact:true}).click(); await page.waitForURL('https://client.test/**'); assert.equal((await context.cookies(ROOT)).some(c=>c.name===SESSION),false,'Unchecking remembered consent must remove cookie');
    await page.goto(url); await page.getByLabel('EXAM APIキー',{exact:true}).fill(KEY); await page.getByRole('checkbox').check(); await page.getByRole('button',{name:'接続を許可',exact:true}).click(); await page.waitForURL('https://client.test/**');
    await page.goto(ROOT+'/oauth/logout');await page.getByRole('button',{name:'ログイン保持を解除する',exact:true}).click();await page.getByRole('heading',{name:'ログイン保持を解除しました',exact:true}).waitFor();await page.goto(url);assert.equal(await page.locator('input[type=password]').count(),1);
    await page.getByLabel('EXAM APIキー',{exact:true}).fill('incorrect');await page.getByRole('button',{name:'接続を許可',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByLabel('EXAM APIキー',{exact:true}).inputValue(),'');
    await page.getByLabel('EXAM APIキー',{exact:true}).fill(KEY);await page.getByRole('button',{name:'接続を許可',exact:true}).click();await page.waitForURL('https://client.test/**');assert.equal((await context.cookies(ROOT)).some(c=>c.name===SESSION),false);
    assert.deepEqual(interceptionErrors,[]); await context.close();console.log('PASS: Chromium mobile layout, checkbox, HttpOnly visibility, cross-site remembered repeat consent, fixed expiry, expiry re-login, unchecking revocation, logout, failed retry, unchecked login');
  } finally { f.db.close();await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
