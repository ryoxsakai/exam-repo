// Every request is intercepted. Storage is a disposable SQLite DB, never production.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'../panel/node_modules/playwright');
const {fixture}=require('./print-sets-fixture.cjs');
const root=path.resolve(__dirname,'..'),origin='https://exam-print-sets.test',evidence='/tmp/exam-print-sets-qa';fs.mkdirSync(evidence,{recursive:true});
const exams=[{id:11,university_id:1,university_name:'合成大学',year:2026,schedule:'前期'},{id:12,university_id:1,university_name:'合成大学',year:2025,schedule:'前期'},{id:13,university_id:1,university_name:'合成大学',year:2026,schedule:'後期'},{id:21,university_id:2,university_name:'別大学',year:2026,schedule:'前期'}];
const questions=id=>[{exam_id:id,question_number:1,category:'長文',problem_text:`{{本文}}\nQ${id} Synthetic passage with enough words to check printing.\n{{設問}}\n[[35]] Choose a word.`,answer_text:`A${id} [[35]] ((1))`,commentary_text:`C${id} Test commentary.`}];
const auth=`window.__fixtureUser={displayName:'Fixture',email:'fixture@example.test',uid:'user-a'};window.__authCallbacks=[];window.Auth={init(){},onChange(cb){__authCallbacks.push(cb);cb(__fixtureUser);},getCurrentUser(){return __fixtureUser;},getIdToken(){return Promise.resolve(__fixtureUser?'fixture-'+__fixtureUser.uid:null);},switchUser(uid){__fixtureUser=uid?{displayName:'Fixture',email:'fixture@example.test',uid}:null;__authCallbacks.forEach(cb=>cb(__fixtureUser));},signIn(){return Promise.resolve();},signOut(){this.switchUser(null);}};`;
const hook='window.__setsTest={state,multiPrint,runPrint,loadMultiPrint,loadPrintPreview,refreshPrintSets};';
(async()=>{
 const deadline=setTimeout(()=>{console.error('Browser test exceeded 120 seconds');process.exit(1);},120000);
 const browser=await chromium.launch({headless:!process.env.HEADED,...(process.env.PANEL_CHROMIUM?{executablePath:process.env.PANEL_CHROMIUM}:{})});
 try {for(const width of [1280,390]){
  const f=fixture();let failExam=null,holdId=null,releaseExam,examHeld=false,holdSave=false,releaseSave,saveHeld=false,failSave=false;
  const context=await browser.newContext({viewport:{width,height:960},serviceWorkers:'block'});
  const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.origin!==origin)return route.fulfill({status:200,contentType:req.resourceType()==='stylesheet'?'text/css':'application/javascript',body:''});
   if(url.pathname.startsWith('/api/')){
    let data;
    const sets=url.pathname.match(/^\/api\/print-sets(?:\/([^/]+))?$/);
    if(sets){
     if(req.method()!=='GET'&&holdSave){saveHeld=true;await new Promise(r=>releaseSave=r);}
     if(req.method()!=='GET'&&failSave){failSave=false;return route.fulfill({status:503,contentType:'application/json',body:'{"error":"Synthetic save failure"}'});}
     const r=await f.call(req.headers()['authorization']==='Bearer fixture-user-b'?'user-b':'user-a',sets[1],req.method()==='GET'?undefined:req.postDataJSON(),req.method());
     return route.fulfill({status:r.status,contentType:'application/json',body:JSON.stringify(r.body)});
    }
    const match=url.pathname.match(/^\/api\/exams\/(\d+)(\/print-duration)?$/);
    if(match){const id=Number(match[1]),e=exams.find(e=>e.id===id);
     if(!match[2]&&holdId===id){examHeld=true;await new Promise(r=>releaseExam=r);}
     if(!match[2]&&(failExam===id||!f.sql.prepare('SELECT id FROM exams WHERE id=?').get(id)))return route.fulfill({status:404,contentType:'application/json',body:'{"error":"Synthetic missing exam"}'});
     data=match[2]?{exam_id:id,university_id:e.university_id,university_minutes:60,exam_minutes:null,effective_minutes:60,source:'university'}:{exam:{...e,questions:questions(id)}};
    }else if(url.pathname==='/api/exams')data={exams:exams.filter(e=>(!url.searchParams.get('year')||String(e.year)===url.searchParams.get('year'))&&(!url.searchParams.get('universityName')||e.university_name===url.searchParams.get('universityName'))&&(!url.searchParams.get('schedule')||e.schedule===url.searchParams.get('schedule')))};
    else data=({'/api/config':{},'/api/universities':{universities:[]},'/api/search':{results:[]},'/api/wordlists':{stop:[],level:[],vocab:[]},'/api/favorites':{favorites:[{id:1,exam_id:11,question_number:1,folder_id:1,sort_order:0}],folders:[{id:1,name:'Fixture favorites',parent_id:null,sort_order:0}],sections:[]},'/api/user-settings':{}})[url.pathname];
    assert.ok(data,`Unhandled fixture ${req.method()} ${url.pathname}`);
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
   }
   const rel=url.pathname==='/'?'index.html':url.pathname.slice(1),file=path.resolve(root,rel);assert.ok(file.startsWith(root+path.sep));
   let body=fs.readFileSync(file);
   if(rel==='assets/js/auth.js')body=auth;
   if(rel==='assets/js/viewer.js')body=body.toString().replace('document.addEventListener("DOMContentLoaded", init);',hook+'\n document.addEventListener("DOMContentLoaded", init);');
   return route.fulfill({status:200,contentType:({'.html':'text/html','.js':'application/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream',body});
  });
  await context.addInitScript(origin=>{if(location.origin!==origin)return;localStorage.setItem('cf_worker_url',origin);localStorage.setItem('exam_lasttab_main','print');window.print=()=>{window.__prints=(window.__prints||0)+1;};},origin);
  const page=await context.newPage();page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(15000);console.log('QA started',width);await page.goto(origin,{waitUntil:'networkidle'});await page.locator('[data-multi-exam="11"]').waitFor({state:'attached'});
  const waitReady=()=>page.waitForFunction(()=>window.__setsTest.state.printExam?.kind==='printSet'&&!window.__setsTest.multiPrint.loading);
  const toggle=async()=>{await page.locator('#pr-multi').check();await page.locator('.tree-row-uni').filter({hasText:'合成大学'}).click();await page.locator('.tree-row-uni').filter({hasText:'別大学'}).click();await page.locator('.tree-row-year').filter({hasText:'2026年度'}).nth(0).click();await page.locator('.tree-row-year').filter({hasText:'2026年度'}).nth(1).click();};
  console.log('QA initial loaded');await toggle();assert.equal(await page.locator('#btn-print-run').isDisabled(),true,'Zero selection cannot print');
  await page.locator('[data-multi-exam="11"]').check();await waitReady();
  await page.locator('[data-multi-exam="13"]').check();await waitReady();
  await page.locator('[data-multi-exam="21"]').check();await waitReady();
  assert.match(await page.locator('#pr-multi-count').innerText(),/3試験/);
  await page.locator('.tree-row-uni').filter({hasText:'合成大学'}).click();await page.locator('.tree-row-uni').filter({hasText:'合成大学'}).click();
  assert.equal(await page.locator('[data-multi-exam="11"]').isChecked(),true,'Selections survive university navigation');
  await page.locator('[data-set-move="2"][data-step="-1"]').click();await waitReady();
  assert.deepEqual(await page.evaluate(()=>window.__setsTest.multiPrint.ids),[11,21,13]);
  await page.locator('#pr-set-name').fill('Fixture saved set');
  await page.locator('[data-set-cover="1"]').fill('COMMON COVER');
  await page.locator('[data-set-cover="time"]').fill('各60分');
  assert.equal(await page.locator('#print-preview .print-cover').count(),1);assert.equal(await page.locator('#print-preview .pc-duration').innerText(),'時間：各60分');
  await page.locator('.print-settings > summary').click();
  assert.equal(await page.locator('[data-prq="11:1"]').count(),1);assert.equal(await page.locator('[data-prq="21:1"]').count(),1);
  await page.locator('[data-prq="11:1"]').uncheck();assert.ok(!(await page.locator('#print-preview').innerText()).includes('Q11'));assert.ok((await page.locator('#print-preview').innerText()).includes('Q21'));
  await page.locator('[data-set-move="1"][data-step="-1"]').click();await waitReady();assert.equal(await page.locator('[data-prq="11:1"]').isChecked(),false,'Reorder retains excluded question');await page.locator('[data-set-move="0"][data-step="1"]').click();await waitReady();await page.locator('[data-prq="11:1"]').check();
  const ordered=await page.locator('#print-preview .print-exam-block').allTextContents();assert.equal(ordered.length,6);for(const [i,marker] of ['Q11','Q21','Q13','A11','A21','A13'].entries())assert.ok(ordered[i].includes(marker));
  // Busy write locks all draft edits and both print buttons; repeated save creates one row.
  console.log('QA preview/order ready');holdSave=true;await page.locator('#pr-set-save').click();await page.waitForFunction(()=>document.getElementById('pr-set-name').disabled);while(!saveHeld)await new Promise(r=>setTimeout(r,10));
  assert.equal(await page.locator('#pr-multi').isDisabled(),true);assert.equal(await page.locator('#btn-print-run').isDisabled(),true);assert.equal(await page.locator('#btn-print-run-2').isDisabled(),true);
  await page.evaluate(()=>window.__setsTest.runPrint());assert.equal(await page.evaluate(()=>window.__prints||0),0);
  holdSave=false;releaseSave();await page.waitForFunction(()=>window.__setsTest.multiPrint.revision===1&&!window.__setsTest.multiPrint.busy);
  console.log('QA saved');const id=await page.evaluate(()=>window.__setsTest.multiPrint.id);assert.equal(f.sql.prepare('SELECT count(*) n FROM print_sets').get().n,1);
  f.reopen();
  const second=await context.newPage();await second.goto(origin,{waitUntil:'networkidle'});await second.locator('#pr-multi').check();await second.locator(`#pr-set-list option[value="${id}"]`).waitFor({state:'attached'});await second.locator('#pr-set-list').selectOption(id);await second.locator('#pr-set-open').click();await second.waitForFunction(()=>window.__setsTest.state.printExam?.kind==='printSet'&&!window.__setsTest.multiPrint.busy);
  assert.deepEqual(await second.evaluate(()=>window.__setsTest.multiPrint.ids),[11,21,13]);assert.equal(await second.locator('[data-set-cover="1"]').inputValue(),'COMMON COVER');
  await second.locator('#pr-set-name').fill('Updated on other device');await second.locator('#pr-set-save').click();await second.waitForFunction(()=>window.__setsTest.multiPrint.revision===2&&!window.__setsTest.multiPrint.busy);
  await page.locator('#pr-set-name').fill('Stale local edit');await page.locator('#pr-set-save').click();await page.waitForFunction(()=>!window.__setsTest.multiPrint.busy&&window.__setsTest.multiPrint.error.includes('別端末'));
  assert.equal(await page.locator('#pr-set-name').inputValue(),'Stale local edit');assert.equal((await f.call('user-a',id)).body.print_set.name,'Updated on other device');assert.equal(await page.locator('#btn-print-run').isDisabled(),true);
  await page.locator('#pr-set-list').selectOption(id);await page.locator('#pr-set-open').click();await page.waitForFunction(()=>window.__setsTest.multiPrint.revision===2&&!window.__setsTest.multiPrint.busy);
  console.log('QA second device conflict ready');
  // Real print HTML and PDF: one cover, Q exams then A exams, distinct pages.
  await page.locator('#btn-print-run').click();await page.waitForFunction(()=>window.__prints===1);assert.equal(await page.locator('#print-area .print-cover').count(),1);
  const pdfPath=path.join(evidence,`multi-${width}.pdf`);await page.pdf({path:pdfPath,format:'A4',printBackground:true});
  const pdfText=execFileSync('python3',['-c',"import json,sys;from pypdf import PdfReader;print(json.dumps([p.extract_text() for p in PdfReader(sys.argv[1]).pages]))",pdfPath],{encoding:'utf8'});
  const pages=JSON.parse(pdfText);assert.equal(pages.length,7);assert.ok(pages[0].includes('COMMON COVER'));for(const [i,marker] of ['Q11','Q21','Q13','A11','A21','A13'].entries())assert.ok(pages[i+1].includes(marker),`PDF page ${i+2} contains ${marker}`);
  fs.writeFileSync(path.join(evidence,`multi-${width}-pages.json`),JSON.stringify(pages,null,2));await page.screenshot({path:path.join(evidence,`desktop-mobile-${width}.png`),fullPage:true});
  // Repeated clicks and an edited cover during font loading must not print old output.
  const beforePrints=await page.evaluate(()=>window.__prints||0);
  await page.evaluate(()=>{window.__originalFonts=document.fonts.ready;window.__heldFonts=new Promise(resolve=>window.__releaseFonts=resolve);Object.defineProperty(document.fonts,'ready',{configurable:true,get:()=>window.__heldFonts});});
  await page.locator('#btn-print-run').click();await page.evaluate(()=>window.__setsTest.runPrint());
  await page.locator('[data-set-cover="0"]').fill('Changed during preparation');await page.evaluate(()=>window.__releaseFonts());
  await page.waitForFunction(()=>!document.getElementById('btn-print-run').disabled);assert.equal(await page.evaluate(()=>window.__prints||0),beforePrints);
  await page.evaluate(()=>Object.defineProperty(document.fonts,'ready',{configurable:true,get:()=>window.__originalFonts}));await page.locator('[data-set-cover="0"]').fill('');
  // Borderline and maximum-length cover text must stay entirely on page one.
  await page.locator('#pr-name-field').check();
  for (const length of [30,60,120]) {
   for (let i=0;i<3;i++)await page.locator(`[data-set-cover="${i}"]`).fill(['上','中','下'][i].repeat(length));
   await page.locator('[data-set-cover="time"]').fill('時'.repeat(120));
   await page.locator('#btn-print-run').click();await page.waitForFunction(()=>!window.__setsTest.multiPrint.busy&&!document.getElementById('btn-print-run').disabled);
   const longPdf=path.join(evidence,`cover-${width}-${length}.pdf`);await page.pdf({path:longPdf,format:'A4',printBackground:true});
   const longPages=JSON.parse(execFileSync('python3',['-c',"import json,sys;from pypdf import PdfReader;print(json.dumps([p.extract_text() for p in PdfReader(sys.argv[1]).pages]))",longPdf],{encoding:'utf8'}));
   assert.equal(longPages.length,7);for(const marker of ['上','中','下'])assert.equal([...longPages[0]].filter(x=>x===marker).length,length);assert.equal([...longPages[0]].filter(x=>x==='時').length,121);
   for(const text of longPages.slice(1))assert.ok(!/[上中下時]/.test(text),'Cover never spills into exam pages');
  }
  for(let i=0;i<3;i++)await page.locator(`[data-set-cover="${i}"]`).fill(i===1?'COMMON COVER':'');await page.locator('[data-set-cover="time"]').fill('各60分');
  await page.locator('#pr-name-field').uncheck();
  // Answer-only and problem-only reuse section controls.
  for(const type of ['本文','設問'])await page.locator(`[data-prsec="${type}"]`).uncheck();assert.equal(await page.locator('#print-preview .print-exam-block').count(),3);assert.ok(!(await page.locator('#print-preview').innerText()).includes('Q11'));
  for(const type of ['本文','設問'])await page.locator(`[data-prsec="${type}"]`).check();for(const type of ['解答','解説'])await page.locator(`[data-prsec="${type}"]`).uncheck();assert.equal(await page.locator('#print-preview .print-exam-block').count(),3);
  for(const type of ['解答','解説'])await page.locator(`[data-prsec="${type}"]`).check();
  await page.locator('#pr-set-archive').click();await page.waitForFunction(()=>window.__setsTest.multiPrint.archived&&!window.__setsTest.multiPrint.busy);assert.equal(await page.locator('#btn-print-run').isDisabled(),true);
  await page.locator('#pr-set-archive').click();await page.waitForFunction(()=>!window.__setsTest.multiPrint.archived&&!window.__setsTest.multiPrint.busy);
  // Failed/missing exam blocks entire output; delayed stale results cannot replace a changed selection.
  failExam=21;await page.evaluate(()=>window.__setsTest.loadMultiPrint());await page.waitForFunction(()=>window.__setsTest.multiPrint.error.includes('21'));assert.equal(await page.locator('#btn-print-run').isDisabled(),true);assert.equal(await page.locator('#print-preview .print-cover').count(),0);
  failExam=null;await page.locator('#pr-multi-retry').click();await waitReady();
  holdId=13;examHeld=false;await page.evaluate(()=>{window.__setsTest.loadMultiPrint();});while(!examHeld)await new Promise(r=>setTimeout(r,10));
  await page.locator('[data-set-remove="13"]').click();await waitReady();holdId=null;releaseExam();await page.waitForTimeout(100);assert.deepEqual(await page.evaluate(()=>window.__setsTest.state.printExam.exams.map(e=>e.id)),[11,21]);
  // Selecting all/none within a year does not clear other universities.
  await page.locator('[data-multi-year="[11,13]"]').check();await waitReady();assert.deepEqual((await page.evaluate(()=>window.__setsTest.multiPrint.ids)).sort(),[11,13,21]);
  await page.locator('[data-multi-year="[11,13]"]').uncheck();await waitReady();assert.deepEqual(await page.evaluate(()=>window.__setsTest.multiPrint.ids),[21]);
  await page.locator('#pr-multi-clear').click();assert.equal(await page.locator('#btn-print-run').isDisabled(),true);
  // OFF returns to existing single exam and favorite output with no shared cover.
  await page.locator('#pr-multi').uncheck();await page.locator('.tree-row-sched[data-uni="合成大学"][data-year="2026"][data-sched="前期"]').click();await page.waitForFunction(()=>window.__setsTest.state.printExam?.kind==='exam');assert.equal(await page.locator('#print-preview .pc-duration').innerText(),'時間：60分');assert.equal(await page.locator('#print-preview .print-cover').count(),1);
  await page.locator('.tree-row-fav').click();await page.locator('[data-favfolder="1"]').click();await page.waitForFunction(()=>window.__setsTest.state.printExam?.kind==='favFolder');assert.equal(await page.locator('#print-preview .pc-uni').innerText(),'Fixture favorites');
  await page.locator('#pr-multi').check();await page.locator('#pr-set-list').selectOption(id);await page.locator('#pr-set-open').click();await page.waitForFunction(()=>!window.__setsTest.multiPrint.busy&&window.__setsTest.multiPrint.revision);
  await page.evaluate(()=>Auth.switchUser('user-b'));await page.waitForFunction(()=>window.__setsTest.multiPrint.uid==='user-b');
  assert.equal(await page.locator('#pr-set-name').inputValue(),'');assert.deepEqual(await page.evaluate(()=>window.__setsTest.multiPrint.ids),[]);assert.equal(await page.locator('[data-set-cover="1"]').inputValue(),'印刷セット');assert.equal(await page.locator('#btn-print-run').isDisabled(),true);
  assert.deepEqual(errors,[]);assert.equal(f.sql.prepare('SELECT count(*) n FROM favorites').get().n,1);assert.equal(f.sql.prepare('SELECT problem_text FROM questions').get().problem_text,'source');
  console.log(`PASS ${width}px: selection/year/order, shared cover, SQLite re-open/second device/conflict, archive/restore, failures/stale fetch, single/favorite regressions, 7-page A4 PDF`);
  await context.close();f.close();
 }}finally{clearTimeout(deadline);await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
