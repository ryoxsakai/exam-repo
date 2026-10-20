// Every request is intercepted. Storage is a disposable SQLite DB, never production.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'../panel/node_modules/playwright');
const {fixture}=require('./print-sets-fixture.cjs');
const root=path.resolve(__dirname,'..'),origin='https://exam-print-sets.test',evidence='/tmp/exam-print-sets-qa';fs.mkdirSync(evidence,{recursive:true});
const exams=[{id:11,university_id:1,university_name:'合成大学',year:2026,schedule:'前期'},{id:12,university_id:1,university_name:'合成大学',year:2025,schedule:'前期'},{id:13,university_id:1,university_name:'合成大学',year:2026,schedule:'後期'},{id:21,university_id:2,university_name:'別大学',year:2026,schedule:'前期'}];
const questions=id=>Array.from({length:id===11?4:id===21?5:1},(_,i)=>({exam_id:id,question_number:i+1,category:'長文',problem_text:`{{本文}}\nQ${id}-${i+1} Synthetic passage with enough words to check printing.\n{{設問}}\n[[35]] Choose a word.`,answer_text:`A${id}-${i+1} [[35]] ((1))`,commentary_text:`C${id}-${i+1} Test commentary.`}));
const auth=`window.__fixtureUser={displayName:'Fixture',email:'fixture@example.test',uid:'user-a'};window.__authCallbacks=[];window.Auth={init(){},onChange(cb){__authCallbacks.push(cb);cb(__fixtureUser);},getCurrentUser(){return __fixtureUser;},getIdToken(){return Promise.resolve(__fixtureUser?'fixture-'+__fixtureUser.uid:null);},switchUser(uid){__fixtureUser=uid?{displayName:'Fixture',email:'fixture@example.test',uid}:null;__authCallbacks.forEach(cb=>cb(__fixtureUser));},signIn(){return Promise.resolve();},signOut(){this.switchUser(null);}};`;
const hook='window.__setsTest={state,multiPrint,runPrint,loadMultiPrint,loadPrintPreview,refreshPrintSets,buildPrintHtml};';
(async()=>{
 const deadline=setTimeout(()=>{console.error('Browser test exceeded 360 seconds');process.exit(1);},360000);
 const waitFlag=async(fn,name)=>{for(let i=0;i<1000;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw new Error('Timed out waiting for '+name);};
 const browser=await chromium.launch({headless:!process.env.HEADED,...(process.env.PANEL_CHROMIUM?{executablePath:process.env.PANEL_CHROMIUM}:{})});
 try {for(const width of [1280,390]){
  const f=fixture();let userSettings={},failUserSettings=false;let failExam=null,holdId=null,releaseExam,examHeld=false,holdSave=false,releaseSave,saveHeld=false,failSave=false,holdSetRead=false,setReadHeld=false,releaseSetRead,holdList=false,listHeld=false,releaseList;
  const context=await browser.newContext({viewport:{width,height:960},isMobile:width<640,hasTouch:width<640,serviceWorkers:'block'});
  const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.origin!==origin)return route.fulfill({status:200,contentType:req.resourceType()==='stylesheet'?'text/css':'application/javascript',body:''});
   if(url.pathname.startsWith('/api/')){
    let data;
    if(['/api/favorites','/api/config','/api/universities','/api/exams'].includes(url.pathname))assert.equal(req.method(),'GET','No source/favorite/settings test writes');
    if(url.pathname==='/api/user-settings'&&req.method()==='PUT') { if(failUserSettings){failUserSettings=false;return route.fulfill({status:503,json:{error:'Synthetic cover save failure'}});} userSettings={...userSettings,...req.postDataJSON()};return route.fulfill({status:200,contentType:'application/json',body:'{}'}); }
    const sets=url.pathname.match(/^\/api\/print-sets(?:\/([^/]+))?$/);
    if(sets){
     let staleList=false;
     if(req.method()==='GET'&&sets[1]&&holdSetRead){setReadHeld=true;await new Promise(r=>releaseSetRead=r);}
     if(req.method()==='GET'&&!sets[1]&&holdList){listHeld=true;await new Promise(r=>releaseList=r);staleList=true;}
     if(req.method()!=='GET'&&holdSave){saveHeld=true;await new Promise(r=>releaseSave=r);}
     if(req.method()!=='GET'&&failSave){failSave=false;return route.fulfill({status:503,contentType:'application/json',body:'{"error":"Synthetic save failure"}'});}
     const r=await f.call(req.headers()['authorization']==='Bearer fixture-user-b'?'user-b':'user-a',sets[1],req.method()==='GET'?undefined:req.postDataJSON(),req.method());
     if(staleList&&r.body.print_sets?.length)r.body.print_sets[0].name='Stale list response';
     return route.fulfill({status:r.status,contentType:'application/json',body:JSON.stringify(r.body)});
    }
    const match=url.pathname.match(/^\/api\/exams\/(\d+)(\/print-duration)?$/);
    if(match){const id=Number(match[1]),e=exams.find(e=>e.id===id);
     if(!match[2]&&holdId===id){examHeld=true;await new Promise(r=>releaseExam=r);}
     if(!match[2]&&(failExam===id||!f.sql.prepare('SELECT id FROM exams WHERE id=?').get(id)))return route.fulfill({status:404,contentType:'application/json',body:'{"error":"Synthetic missing exam"}'});
     data=match[2]?{exam_id:id,university_id:e.university_id,university_minutes:60,exam_minutes:null,effective_minutes:60,source:'university'}:{exam:{...e,questions:questions(id)}};
    }else if(url.pathname==='/api/exams')data={exams:exams.filter(e=>(!url.searchParams.get('year')||String(e.year)===url.searchParams.get('year'))&&(!url.searchParams.get('universityName')||e.university_name===url.searchParams.get('universityName'))&&(!url.searchParams.get('schedule')||e.schedule===url.searchParams.get('schedule')))};
    else data=({'/api/config':{},'/api/universities':{universities:[]},'/api/search':{results:[]},'/api/wordlists':{stop:[],level:[],vocab:[]},'/api/favorites':{favorites:[{id:1,exam_id:11,question_number:1,folder_id:1,sort_order:0}],folders:[{id:1,name:'Fixture favorites',parent_id:null,sort_order:0}],sections:[]},'/api/user-settings':userSettings})[url.pathname];
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
  const page=await context.newPage();page.on('dialog', d=>d.accept());page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(15000);console.log('QA started',width);await page.goto(origin,{waitUntil:'networkidle'});await page.locator('[data-multi-exam="11"]').waitFor({state:'attached'});
  const waitReady=()=>page.waitForFunction(()=>window.__setsTest.state.printExam?.kind==='printSet'&&!window.__setsTest.multiPrint.loading);
  const toggle=async()=>{await page.locator('#pr-multi').check();await page.locator('.tree-row-uni').filter({hasText:'合成大学'}).click();await page.locator('.tree-row-uni').filter({hasText:'別大学'}).click();await page.locator('.tree-row-year').filter({hasText:'2026年度'}).nth(0).click();await page.locator('.tree-row-year').filter({hasText:'2026年度'}).nth(1).click();};
  const closeAny=async(p=page)=>{await p.bringToFront();const close=p.locator('.print-modal.open [data-print-close], .print-modal.open [data-set-close]').first();if(await close.count()){await close.click();await p.waitForFunction(()=>!document.querySelector('.print-modal.open'));await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}};
  const openDialog=async(id,p=page)=>{await p.bringToFront();if(!await p.locator('#'+id).isVisible()){await closeAny(p);await p.locator(id==='pr-set-modal'?'#pr-set-manage':id==='pr-settings-modal'?'#pr-settings-open':'#pr-questions-open').click();await p.locator('#'+id).waitFor({state:'visible'});}};
  const openModal=async(p=page)=>openDialog('pr-set-modal',p);
  const closeModal=closeAny;
  await toggle();
  await page.locator('[data-multi-exam="11"]').check(); await waitReady();
  await page.locator('[data-multi-exam="21"]').check(); await waitReady();
  await openModal(); await page.locator('#pr-set-name').fill('Local unsaved draft'); await closeModal();
  const coverNode=page.locator('[data-set-cover="1"]');await coverNode.dblclick();await coverNode.fill('Resume cover');await coverNode.press('Enter');
  await openDialog('pr-questions-modal');
  assert.equal(await page.locator('#pr-question-label').innerText(),'印刷する大学');
  assert.equal(await page.locator('#pr-questions-heading').innerText(),'印刷する大学');
  assert.equal(await page.locator('[data-prexam]').count(),2,'Nine questions collapse into two university rows');
  assert.equal(await page.locator('[data-prq]').count(),0,'Multi mode has no individual question checkboxes');
  assert.deepEqual(await page.locator('[data-prexam]').evaluateAll(ns=>ns.map(n=>n.parentElement.textContent.trim())),['2026 合成大学 前期','2026 別大学 前期']);
  // Older partial selections remain unchanged until the university is toggled.
  await page.evaluate(()=>{__setsTest.state.printQSel={'11:2':false};__setsTest.multiPrint.questionSelection={'11:2':false};return __setsTest.loadMultiPrint();});
  assert.equal(await page.locator('[data-prexam="11"]').evaluate(n=>n.indeterminate),true);
  assert.equal(await page.locator('#print-preview').innerText().then(t=>t.includes('Q11-2')),false);
  assert.equal(await page.locator('#print-preview').innerText().then(t=>t.includes('Q11-1')),true);
  await page.locator('[data-prexam="11"]').check();
  assert.equal(await page.locator('[data-prexam="11"]').evaluate(n=>n.indeterminate),false);
  assert.equal(await page.locator('#print-preview').innerText().then(t=>t.includes('Q11-2')),true);
  await page.locator('#pr-questions-modal .modal').screenshot({path:path.join(evidence,`university-selection-${width}.png`)});
  await page.locator('[data-prexam="11"]').uncheck();
  assert.deepEqual(await page.evaluate(()=>[1,2,3,4].map(n=>__setsTest.state.printQSel['11:'+n])),[false,false,false,false]);
  assert.equal(await page.locator('#pr-question-summary').innerText(),'1 / 2校');
  const preview=await page.locator('#print-preview').innerText();
  for(const marker of ['Q11-','A11-','C11-'])assert.ok(!preview.includes(marker),'Excluded university leaves neither questions nor answers');
  for(let n=1;n<=5;n++)assert.ok(preview.includes('Q21-'+n)&&preview.includes('A21-'+n),'Other university keeps every question and answer');
  await closeAny();
  await page.locator('#btn-print-run').click();await page.waitForFunction(()=>window.__prints===1);
  const printed=await page.locator('#print-area').innerText();assert.ok(!printed.includes('Q11-')&&!printed.includes('A11-'));assert.ok(printed.includes('Q21-5')&&printed.includes('A21-5'));

  await page.reload({waitUntil:'networkidle'});await waitReady();
  assert.deepEqual(await page.evaluate(()=>window.__setsTest.multiPrint.ids),[11,21]);
  assert.equal(await page.evaluate(()=>window.__setsTest.multiPrint.name),'Local unsaved draft');
  assert.equal(await page.evaluate(()=>window.__setsTest.multiPrint.cover.lines[1]),'Resume cover');
  assert.deepEqual(await page.evaluate(()=>[1,2,3,4].map(n=>__setsTest.state.printQSel['11:'+n])),[false,false,false,false]);
  const second=await context.newPage();await page.close();await second.goto(origin,{waitUntil:'networkidle'});
  await second.waitForFunction(()=>window.__setsTest.state.printExam?.kind==='printSet'&&!window.__setsTest.multiPrint.loading);
  assert.deepEqual(await second.evaluate(()=>window.__setsTest.multiPrint.ids),[11,21]);
  assert.equal(await second.evaluate(()=>window.__setsTest.state.printQSel['11:1']),false);
  await second.evaluate(()=>Auth.switchUser('user-b'));
  await second.waitForFunction(()=>window.__setsTest.multiPrint.uid==='user-b');
  assert.deepEqual(await second.evaluate(()=>window.__setsTest.multiPrint.ids),[]);
  await second.evaluate(()=>Auth.switchUser('user-a'));
  await second.waitForFunction(()=>window.__setsTest.state.printExam?.kind==='printSet'&&!window.__setsTest.multiPrint.loading);
  assert.deepEqual(await second.evaluate(()=>window.__setsTest.multiPrint.ids),[11,21]);
  // Single-exam checkboxes must survive a fresh load too.
  await second.locator('#pr-multi').uncheck();
  assert.equal(await second.locator('#pr-question-label').innerText(),'印刷する大問');
  assert.equal(await second.locator('#pr-questions-heading').innerText(),'印刷する大問');
  await second.evaluate(()=>{window.__setsTest.state.printSel={kind:'exam',uni:'合成大学',year:'2026',sched:'前期',folderId:null};window.__setsTest.loadPrintPreview();});
  await second.waitForFunction(()=>window.__setsTest.state.printExam?.kind==='exam');
  await second.locator('#pr-questions-open').click();await second.locator('[data-prq="11:1"]').uncheck();
  await second.reload({waitUntil:'networkidle'});await second.waitForFunction(()=>window.__setsTest.state.printExam?.kind==='exam');
  assert.equal(await second.evaluate(()=>window.__setsTest.state.printQSel['11:1']),false);
  await second.locator('#pr-multi').check();
  await second.waitForFunction(()=>window.__setsTest.state.printExam?.kind==='printSet'&&!window.__setsTest.multiPrint.loading);
  await second.locator('#pr-set-manage').click();
  const reset=second.locator('#pr-set-reset'),save=second.locator('#pr-set-save');
  assert.ok((await reset.boundingBox()).x < (await save.boundingBox()).x,'Reset is left of Save');
  await reset.click();
  assert.deepEqual(await second.evaluate(()=>window.__setsTest.multiPrint.ids),[]);
  assert.equal(await second.locator('#pr-set-name').inputValue(),'');
  assert.deepEqual(await second.evaluate(()=>window.__setsTest.multiPrint.cover),{lines:['','印刷セット',''],time:''});
  assert.equal(await second.evaluate(()=>window.__setsTest.multiPrint.id),null);
  assert.deepEqual(await second.evaluate(()=>window.__setsTest.state.printQSel),{});
  assert.equal(await save.isDisabled(),true);
  await second.reload({waitUntil:'networkidle'});
  assert.deepEqual(await second.evaluate(()=>window.__setsTest.multiPrint.ids),[],'Reset persists after reload');
  assert.equal(await second.evaluate(()=>window.__setsTest.multiPrint.name),'');
  assert.equal(f.sql.prepare('SELECT count(*) n FROM print_sets').get().n,0,'Reset does not write server sets');
  assert.deepEqual(errors,[]);
  console.log('PASS local resume',width,'reload, close/reopen, unsaved cover/name, question checks, account isolation, single exam');
  await context.close();f.close();
 }}catch(e){console.error('QA failed before cleanup:',e);throw e;}finally{clearTimeout(deadline);await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
