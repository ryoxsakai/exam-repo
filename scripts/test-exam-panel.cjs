const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { build } = require('../panel/node_modules/esbuild');
const root = path.resolve(__dirname, '..');
const row = { exam_id:42, question_number:5, university_name:'獨協医科大学', year:2015, schedule:'前期', category:'長文', label:'文挿入' };
const question = { ...row, problem_text:'{{リード文}}\nRead the article.\n\n{{本文}}\n[1] A **doctor** studied __memory__ and ##sleep::睡眠##.  [[1]]\n\n[2] People need rest.\n\n{{設問}}\n{{問1}} Choose an answer.\n((1)) The first choice.\n((2)) The second choice.\n\n{{全訳}}\n人は休息を必要とする。', answer_text:'問1：②', commentary_text:'本文の第二段落を参照。', translation_text:'人は休息を必要とする。' };
async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'exam-panel-test-'));
  await build({ entryPoints:[path.join(root,'worker/mcp.ts')], bundle:true, platform:'node', format:'esm', outfile:path.join(tmp,'mcp.mjs') });
  const { handleMcpRoute } = await import(pathToFileURL(path.join(tmp,'mcp.mjs')));
  let reads = 0;
  const env = { EXAM_SESSION_SECRET:'test-only-secret', DB:{ prepare(sql) { return { bind(...values) { this.values=values; return this; }, async all() { reads++; return { results:[row] }; }, async first() { reads++; return question; }, run() { throw new Error('Panel must not mutate the database'); } }; }, batch() { throw new Error('Panel must not mutate the database'); } } };
  const payload = Buffer.from(JSON.stringify({ aud:'medical-exam-mcp', client_id:'panel-test', scope:'exams:read', exp:Date.now()+60000 })).toString('base64url');
  const signature = require('node:crypto').createHmac('sha256',env.EXAM_SESSION_SECRET).update(payload).digest('base64url');
  const token = `${payload}.${signature}`;
  async function rpc(method,params={},authorized=true) { const response = await handleMcpRoute(new Request('https://medical-exam-worker.ryoxsakai.workers.dev/mcp',{method:'POST',headers:{'Content-Type':'application/json',...(authorized?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),env); return { status:response.status, body:await response.json() }; }
  const tools = (await rpc('tools/list')).body.result.tools;
  const opener = tools.filter(t=>t.name==='open_question_browser'); assert.equal(opener.length,1);
  const { OpenAIUiToolMetadataSchema, OpenAIUiResourceMetadataSchema } = await import(pathToFileURL(path.join(root,'panel/node_modules/@openai/mcp-extensions/dist/server/ui.js')));
  OpenAIUiToolMetadataSchema.parse(opener[0]._meta['openai/ui']);
  assert.deepEqual(opener[0]._meta['openai/ui'].entrypoints,[{type:'thread'}]);
  assert.equal(opener[0].annotations.readOnlyHint,true);
  assert.equal((await rpc('initialize')).body.result.capabilities.resources instanceof Object,true);
  const uri = opener[0]._meta.ui.resourceUri;
  assert.equal((await rpc('resources/read',{uri},false)).status,401);
  const resource = (await rpc('resources/read',{uri})).body.result.contents[0];
  assert.equal(resource.mimeType,'text/html;profile=mcp-app');
  OpenAIUiResourceMetadataSchema.parse(resource._meta['openai/ui']);
  assert.deepEqual(resource._meta['openai/ui'].availableDisplayModes,['fullscreen']);
  assert.deepEqual(resource._meta.ui.csp.connectDomains,[]);
  assert.ok(resource.text.includes('選択箇所をチャットに共有'));
  assert.ok((await rpc('resources/read',{uri:'ui://wrong'})).body.error);
  const initial = (await rpc('tools/call',{name:'open_question_browser',arguments:{}})).body.result.structuredContent;
  assert.equal(initial.results[0].exam_id,42); assert.equal(initial.image_base,'https://medical-exam-worker.ryoxsakai.workers.dev');
  const direct = (await rpc('tools/call',{name:'open_question_browser',arguments:{exam_id:42,question_number:5}})).body.result;
  assert.equal(direct.structuredContent.question.question_number,5);
  assert.equal((await rpc('tools/call',{name:'open_question_browser',arguments:{exam_id:42}})).body.result.isError,true);
  assert.equal((await rpc('tools/call',{name:'open_question_browser',arguments:{}},false)).status,401);
  assert.equal(reads,2);
  console.log('PASS: entrypoint, authenticated resource, empty/direct launch, read-only database');
  if (process.argv.includes('--browser')) await browserTest(resource.text,initial);
}
async function browserTest(html, initial) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.PANEL_CHROMIUM ? {executablePath:process.env.PANEL_CHROMIUM} : {})});
  try {
    const page = await browser.newPage({viewport:{width:520,height:1000}});
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.setContent('<!doctype html><html><body style="margin:0"><iframe id="panel" style="width:100%;height:100vh;border:0"></iframe></body></html>');
    await page.evaluate(({html,initial,question})=>{
      window.calls=[]; window.contexts=[];
      const frame=document.getElementById('panel');
      window.addEventListener('message',event=>{
        if(event.source!==frame.contentWindow)return;
        const msg=event.data; const reply=result=>event.source.postMessage({jsonrpc:'2.0',id:msg.id,result},'*');
        if(msg.method==='ui/initialize') reply({protocolVersion:msg.params.protocolVersion,hostInfo:{name:'Exam-test-host',version:'1.0'},hostCapabilities:{serverTools:{},updateModelContext:{text:{},structuredContent:{}},experimental:{'openai/modelContext':{}}},hostContext:{theme:'light',displayMode:'fullscreen',availableDisplayModes:['fullscreen']}});
        else if(msg.method==='ui/notifications/initialized') event.source.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{content:[{type:'text',text:JSON.stringify(initial)}],structuredContent:initial}},'*');
        else if(msg.method==='tools/call') { window.calls.push(msg.params); const data=msg.params.name==='get_question'?{question}: {results:[{...question,exam_id:42}]}; reply({content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data}); }
        else if(msg.method==='ui/update-model-context'){window.contexts.push(msg.params);reply({_meta:{'openai/modelContext':{updateId:'test-update'}}});}
        else if(msg.id!==undefined)reply({});
      });
      frame.srcdoc=html;
    },{html,initial,question});
    const frame=page.frameLocator('#panel');
    await frame.locator('.result').first().waitFor();
    assert.equal((await page.evaluate(()=>window.calls)).length,0,'Initial render must reuse launch result');
    await frame.locator('input[name=university_name]').fill('獨協医科');
    await frame.locator('input[name=year]').fill('2015');
    await frame.locator('#search').click();
    await page.waitForFunction(()=>window.calls.some(c=>c.name==='search_questions'));
    const search=(await page.evaluate(()=>window.calls))[0]; assert.equal(search.arguments.year,2015); assert.equal(search.arguments.university_name,'獨協医科');
    await frame.locator('.result').first().click();
    await frame.locator('#detail').waitFor({state:'visible'});
    assert.match(await frame.locator('#document').innerText(),/doctor/);
    assert.doesNotMatch(await frame.locator('#document').innerText(),/人は休息/);
    assert.equal(await frame.locator('#document u').innerText(),'memory');
    assert.equal(await frame.locator('.blank-badge').count(),1);
    assert.equal(await frame.locator('.footnote-section').count(),1,'Notes must not be duplicated');
    await frame.locator('#document').evaluate(el=>{const node=el.querySelector('u').firstChild;const range=document.createRange();range.selectNodeContents(node);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);});
    await frame.locator('#share:not([disabled])').waitFor();
    await frame.locator('#share').click();
    await page.waitForFunction(()=>window.contexts.length===1);
    const shared=(await page.evaluate(()=>window.contexts))[0]; assert.equal(shared.structuredContent.exam_selection.selected_text,'memory'); assert.equal(shared.structuredContent.exam_selection.exam_id,42); assert.equal(shared.structuredContent.exam_selection.question_number,5);
    assert.match(await frame.locator('#status').innerText(),/添付しました/);
    await frame.locator('#clear-share').click(); await page.waitForFunction(()=>window.contexts.length===2); assert.deepEqual((await page.evaluate(()=>window.contexts))[1].content,[]);
    await frame.getByRole('tab',{name:'全訳',exact:true}).click(); assert.match(await frame.locator('#document').innerText(),/人は休息/);
    await frame.getByRole('tab',{name:'問題',exact:true}).click();
    await page.screenshot({path:process.env.PANEL_SCREENSHOT || path.join(os.tmpdir(),'exam-panel.png'),fullPage:true});
    await page.setViewportSize({width:360,height:1000});
    assert.ok(await frame.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth),'Narrow panel must not overflow');
    await page.evaluate(()=>{const f=document.getElementById('panel');f.contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/host-context-changed',params:{theme:'dark'}},'*');});
    await page.screenshot({path:path.join(os.tmpdir(),'exam-panel-dark.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('PASS: host handshake, reused launch data, filtered search, markup, text sharing/clear, tabs, 360px layout, theme');
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
