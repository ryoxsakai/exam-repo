// Every request is intercepted. Storage is a disposable SQLite DB, never production.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'../panel/node_modules/playwright');
const {fixture}=require('./print-sets-fixture.cjs');
const root=path.resolve(__dirname,'..'),origin='https://exam-print-sets.test',evidence='/tmp/exam-print-sets-qa';fs.mkdirSync(evidence,{recursive:true});
const exams=[{id:11,university_id:1,university_name:'合成大学',year:2026,schedule:'前期'},{id:12,university_id:1,university_name:'合成大学',year:2025,schedule:'前期'},{id:13,university_id:1,university_name:'合成大学',year:2026,schedule:'後期'},{id:21,university_id:2,university_name:'別大学',year:2026,schedule:'前期'}];
const questions=id=>[{exam_id:id,question_number:1,category:'長文',problem_text:`{{本文}}\nQ${id} Synthetic passage with enough words to check printing.\n{{設問}}\n[[35]] Choose a word.`,answer_text:`A${id} [[35]] ((1))`,commentary_text:`C${id} Test commentary.`}];
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
  const setName=async(text,p=page)=>{await openModal(p);await p.locator('#pr-set-name').fill(text);};
  const cover=async(index,text,p=page)=>{await closeAny(p);const n=p.locator(`[data-set-cover="${index}"]`);await n.dblclick();await n.fill(text);await n.press('Enter');};
  const move=async(selector)=>{await openModal();await page.locator(selector).click();await waitReady();await closeModal();};
  const checkPrint=async(selector,checked=true)=>{await openDialog(selector.startsWith('[data-pr')?'pr-questions-modal':'pr-settings-modal');await page.locator(selector).setChecked(checked);await closeAny();};
  const checkOtherHistory=async()=>{
   await page.evaluate(()=>{const spacer=document.createElement('div');spacer.id='fixture-history-space';spacer.style.height='1600px';document.body.appendChild(spacer);window.scrollTo(0,150);history.pushState(Object.assign({},history.state,{fixtureHistory:true}),"");window.scrollTo(0,400);});
   await page.goBack();await page.waitForFunction(()=>window.scrollY===150);assert.equal(await page.evaluate(()=>history.scrollRestoration),'auto','Unrelated history keeps native restoration');
   await page.goForward();await page.waitForFunction(()=>window.scrollY===400);await page.evaluate(()=>document.getElementById('fixture-history-space').remove());
  };
  console.log('QA initial loaded');
  assert.equal(await page.locator('#pr-multi-panel').count(),0,'No permanent added panel');
  assert.equal(await page.locator('#pr-set-modal').isVisible(),false);
  assert.equal(await page.locator('#pr-set-manage').isVisible(),false,'OFF keeps original toolbar');
  await toggle();
  assert.equal(await page.locator('#pr-set-modal').isVisible(),false,'ON only changes tree selection');
  assert.equal(await page.locator('[data-multi-exam="11"]').isVisible(),true);
  assert.equal(await page.locator('.tree-row-sched[data-uni="合成大学"][data-year="2026"][data-sched="前期"]').isVisible(),false);
  await checkOtherHistory();
  await openModal();assert.equal(await page.locator('#pr-set-archive').isVisible(),false);
  assert.equal(await page.locator('#pr-set-modal [data-set-cover]').count(),0,'Cover has no duplicate inputs');
  const input=await page.locator('#pr-set-name').evaluate(e=>({width:e.getBoundingClientRect().width,parent:e.parentElement.getBoundingClientRect().width}));assert.ok(input.width>250&&input.width<=input.parent+1);
  await closeModal();
  // Closing never writes or loses the modal draft; existing overlay styling and focus are reused.
  for(const way of ['close','cancel','escape','background']) {
    await setName('Unsaved '+way);
    if(way==='close')await page.locator('[data-set-close]').first().click();
    if(way==='cancel')await page.getByRole('button',{name:'キャンセル',exact:true}).click();
    if(way==='escape')await page.locator('#pr-set-name').press('Escape');
    if(way==='background')await page.locator('#pr-set-modal').click({position:{x:2,y:2}});
    assert.equal(await page.locator('#pr-set-modal').isVisible(),false);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'pr-set-manage');
    await openModal();assert.equal(await page.locator('#pr-set-name').inputValue(),'Unsaved '+way);await closeModal();
  }
  assert.equal(f.sql.prepare("SELECT count(*) n FROM sqlite_master WHERE name='print_sets'").get().n,1);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM print_sets').get().n,0,'Closing does not save');
  const initialRestoration=await page.evaluate(()=>history.scrollRestoration);assert.equal(initialRestoration,"auto");
  // Each dialog isolates background focus/scroll and keeps a single history entry.
  for(const [id,trigger] of [['pr-settings-modal','pr-settings-open'],['pr-questions-modal','pr-questions-open'],['pr-set-modal','pr-set-manage']]) {
   for(const way of ['close','escape','background','back']) {
    await page.locator('#'+trigger).evaluate(n=>{n.click();n.click();n.click();});
    await page.locator('#'+id).waitFor({state:'visible'});
    assert.equal(await page.locator('.print-modal.open').count(),1);
    assert.equal(await page.locator('.shell').evaluate(n=>n.inert),true);
    const nodes=page.locator('#'+id+' button:visible:not(:disabled), #'+id+' input:visible:not(:disabled), #'+id+' select:visible:not(:disabled)');
    await nodes.last().focus();await page.keyboard.press('Tab');assert.equal(await nodes.first().evaluate(n=>n===document.activeElement),true);
    await page.keyboard.press('Shift+Tab');assert.equal(await nodes.last().evaluate(n=>n===document.activeElement),true);
    if(way==='close')await closeAny();
    if(way==='escape')await page.keyboard.press('Escape');
    if(way==='background')await page.locator('#'+id).click({position:{x:2,y:2}});
    if(way==='back')await page.goBack();
    await page.locator('#'+id).waitFor({state:'hidden'});
    assert.equal(await page.locator('.shell').evaluate(n=>n.inert),false);
    assert.equal(await page.evaluate(()=>document.activeElement.id),trigger);
    await page.goForward();await page.locator('#'+id).waitFor({state:'visible'});await closeAny();assert.equal(await page.evaluate(()=>history.scrollRestoration),initialRestoration,'Forward close restores the original history mode');
   }
  }
  await page.locator('#pr-multi').uncheck();await page.goForward();await page.waitForFunction(mode=>history.scrollRestoration===mode,initialRestoration);assert.equal(await page.locator('.print-modal.open').count(),0,'OFF rejects set-history reopening');await page.locator('#pr-multi').check();
  await checkOtherHistory();
  await openDialog('pr-settings-modal');
  await page.locator('#pr-fontsize').selectOption('sm');await closeAny();await openDialog('pr-settings-modal');assert.equal(await page.locator('#pr-fontsize').inputValue(),'sm');await page.locator('#pr-fontsize').selectOption('md');await closeAny();
  await openModal();await page.locator('#pr-set-name').fill('Caret');await page.locator('#pr-set-name').press('ArrowLeft');await page.keyboard.insertText('X');assert.equal(await page.locator('#pr-set-name').inputValue(),'CareXt','Input rerenders retain caret');
  // Simulated visual viewport shrink/pan: validates geometry, not a real iOS keyboard.
  await page.evaluate(()=>{window.__savedViewport=Object.getOwnPropertyDescriptor(window,'visualViewport');Object.defineProperty(window,'visualViewport',{configurable:true,value:{height:360,offsetTop:90}});window.dispatchEvent(new Event('resize'));});
  const geometry=await page.locator('#pr-set-modal').evaluate(n=>({top:parseFloat(getComputedStyle(n).top),height:n.getBoundingClientRect().height,foot:n.querySelector('.modal-foot').getBoundingClientRect().bottom,scroll:n.querySelector('.modal-body').scrollHeight>n.querySelector('.modal-body').clientHeight}));
  assert.equal(geometry.top,90);assert.equal(geometry.height,360);assert.ok(geometry.foot<=450);assert.equal(geometry.scroll,true);
  await page.evaluate(()=>{Object.defineProperty(window,'visualViewport',window.__savedViewport);window.dispatchEvent(new Event('resize'));});
  const fonts=await page.locator('.print-modal input:not([type="checkbox"]), .print-modal select, .print-modal textarea').evaluateAll(nodes=>nodes.map(n=>parseFloat(getComputedStyle(n).fontSize)));assert.ok(fonts.every(size=>size>=16));
  assert.ok(!(await page.locator('meta[name="viewport"]').getAttribute('content')).match(/user-scalable\s*=\s*no|maximum-scale/));
  await closeAny();
  assert.equal(await page.locator('#btn-print-run').isDisabled(),true,'Zero selection cannot print');
  await page.locator('[data-multi-exam="11"]').check();await waitReady();
  await page.locator('[data-multi-exam="13"]').check();await waitReady();
  await page.locator('[data-multi-exam="21"]').check();await waitReady();
  assert.match(await page.locator('#pr-multi-count').innerText(),/3試験/);
  await page.locator('.tree-row-uni').filter({hasText:'合成大学'}).click();await page.locator('.tree-row-uni').filter({hasText:'合成大学'}).click();
  assert.equal(await page.locator('[data-multi-exam="11"]').isChecked(),true,'Selections survive university navigation');
  for(const [id,trigger] of [['pr-settings-modal','pr-settings-open'],['pr-questions-modal','pr-questions-open'],['pr-set-modal','pr-set-manage']]) {
   await page.evaluate(()=>window.scrollTo(0,150));const scroll=await page.evaluate(()=>window.scrollY);const restoration=await page.evaluate(()=>history.scrollRestoration);
   await page.locator('#'+trigger).evaluate(n=>n.click());assert.equal(await page.evaluate(()=>document.body.style.top),-scroll+'px');
   await closeAny();assert.equal(await page.evaluate(()=>window.scrollY),scroll,'Close restores background scroll');assert.equal(await page.evaluate(()=>history.scrollRestoration),restoration);
   await page.goForward();await page.locator('#'+id).waitFor({state:'visible'});await closeAny();assert.equal(await page.evaluate(()=>window.scrollY),scroll,'Forward retains the original background position');
  }
  await move('[data-set-move="2"][data-step="-1"]');
  assert.deepEqual(await page.evaluate(()=>window.__setsTest.multiPrint.ids),[11,21,13]);
  assert.deepEqual(await page.locator('#pr-multi-selection li > span').allTextContents(),['2026 合成大学 前期','2026 別大学 前期','2026 合成大学 後期']);
  await page.evaluate(()=>{window.__setsTest.multiPrint.catalog[11].schedule='  ';window.__setsTest.multiPrint.catalog[11].university_name='  大阪医科薬科  ';});
  await openModal();assert.equal(await page.locator('#pr-multi-selection li > span').first().textContent(),'2026 大阪医科薬科');await closeModal();
  await page.evaluate(()=>{window.__setsTest.multiPrint.catalog[11].schedule='前期';window.__setsTest.multiPrint.catalog[11].university_name='合成大学';});
  await setName('Fixture saved set');
  await cover('1','COMMON COVER');
  await cover('time','各60分');
  assert.equal(await page.locator('#print-preview .print-cover').count(),1);assert.equal(await page.locator('#print-preview .pc-duration').textContent(),'時間：各60分');
  // The existing cover editor keeps text across tree/mode changes and cancels one edit with Escape.
  await cover('0','Set-only draft');
  const editable=page.locator('[data-set-cover="0"]');await editable.dblclick();await editable.fill('Discard this');await editable.press('Escape');assert.equal(await page.locator('[data-set-cover="0"]').textContent(),'Set-only draft');
  const ime=page.locator('[data-set-cover="0"]');await ime.dblclick();await ime.fill('IME draft');await ime.dispatchEvent('keydown',{key:'Enter',isComposing:true,keyCode:229});assert.equal(await ime.getAttribute('contenteditable'),'true');await ime.dispatchEvent('compositionend');await ime.press('Enter');
  await page.locator('[data-multi-exam="13"]').uncheck();await waitReady();assert.equal(await page.locator('[data-set-cover="0"]').textContent(),'IME draft');await page.locator('[data-multi-exam="13"]').check();await waitReady();
  await page.locator('#pr-multi').uncheck();await page.locator('.tree-row-sched[data-uni="合成大学"][data-year="2026"][data-sched="前期"]').click();await page.waitForFunction(()=>window.__setsTest.state.printExam?.kind==='exam');assert.ok(!(await page.locator('#print-preview .print-cover').innerText()).includes('IME draft'));
  await page.locator('#pr-multi').check();await waitReady();assert.equal(await page.locator('[data-set-cover="0"]').textContent(),'IME draft');
  await cover('0','超'.repeat(125));assert.equal((await page.locator('[data-set-cover="0"]').textContent()).length,120);
  await cover('0','字'+'😀'.repeat(70));assert.equal((await page.locator('[data-set-cover="0"]').textContent()).length,119,'Limit preserves a complete Unicode character');
  await cover('0','');
  assert.deepEqual(await page.evaluate(()=>window.__setsTest.multiPrint.ids),[11,21,13]);
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(evidence,`normal-modal-ui-${width}.png`)});
  await openModal();await page.locator('#pr-set-modal .modal').screenshot({path:path.join(evidence,`set-modal-${width}.png`)});await closeModal();
  await openDialog('pr-settings-modal');await page.locator('#pr-settings-modal .modal').screenshot({path:path.join(evidence,`settings-modal-${width}.png`)});await closeAny();
  await openDialog('pr-questions-modal');await page.locator('#pr-questions-modal .modal').screenshot({path:path.join(evidence,`questions-modal-${width}.png`)});
  assert.equal(await page.locator('[data-prq="11:1"]').count(),1);assert.equal(await page.locator('[data-prq="21:1"]').count(),1);
  await page.locator('[data-prq="11:1"]').uncheck();assert.ok(!(await page.locator('#print-preview').innerText()).includes('Q11'));assert.ok((await page.locator('#print-preview').innerText()).includes('Q21'));
  await move('[data-set-move="1"][data-step="-1"]');assert.equal(await page.locator('[data-prq="11:1"]').isChecked(),false,'Reorder retains excluded question');await move('[data-set-move="0"][data-step="1"]');await checkPrint('[data-prq="11:1"]');
  await closeAny();
  const ordered=await page.locator('#print-preview .print-exam-block').allTextContents();assert.equal(ordered.length,6);for(const [i,marker] of ['Q11','Q21','Q13','A11','A21','A13'].entries())assert.ok(ordered[i].includes(marker));
  assert.equal(await page.locator('#print-preview .print-exam-time').count(),6);
  assert.deepEqual(await page.locator('#print-preview .print-exam-time').allTextContents(),Array(6).fill('60分'));
  const expectedHeads=['2026 合成大学 前期','2026 別大学 前期','2026 合成大学 後期'];
  assert.deepEqual(await page.locator('#print-preview .print-exam-label').allTextContents(),expectedHeads.concat(expectedHeads));
  const assertHeadingColor=async(root)=>{
   const colors=await page.locator(root+' .print-exam-block').evaluateAll(blocks=>blocks.map(b=>({head:getComputedStyle(b.querySelector('.print-exam-head')).color,line:getComputedStyle(b.querySelector('.print-exam-head')).borderBottomColor,question:getComputedStyle(b.querySelector('.print-q-head')).color})));
   assert.equal(colors.length,6);for(const c of colors){assert.equal(c.head,c.question);assert.equal(c.line,c.question);}return colors;
  };
  const originalColors=await assertHeadingColor('#print-preview');
  await page.evaluate(()=>document.documentElement.style.setProperty('--emerald-dark','#8a2d3b'));
  const themedColors=await assertHeadingColor('#print-preview');assert.notEqual(themedColors[0].head,originalColors[0].head,'Heading follows the existing question color token');
  await page.evaluate(()=>document.documentElement.style.removeProperty('--emerald-dark'));
  // Missing schedule values and whitespace preserve display names and never alter exam data.
  for(const schedule of ['',null,undefined,'  ']){
   const result=await page.evaluate(schedule=>{
    const ex=JSON.parse(JSON.stringify(window.__setsTest.state.printExam));ex.exams=[ex.exams[0]];ex.exams[0].schedule=schedule;ex.exams[0].university_name='表示名 <大学> & 名称';const before=JSON.stringify(ex);
    const html=window.__setsTest.buildPrintHtml(ex,{cover:false,side:'both'},false),doc=new DOMParser().parseFromString(html,'text/html');
    return {heads:Array.from(doc.querySelectorAll('.print-exam-head'),n=>n.textContent),unchanged:JSON.stringify(ex)===before};
   },schedule);
   assert.deepEqual(result.heads,['2026 表示名 <大学> & 名称','2026 表示名 <大学> & 名称']);assert.equal(result.unchanged,true);
  }
  // Busy write locks all draft edits and both print buttons; repeated save creates one row.
  await checkPrint('[data-prq="11:1"]',false);
  console.log('QA preview/order ready');holdSave=true;await openModal();await page.locator('#pr-set-save').click();await page.waitForFunction(()=>document.getElementById('pr-set-name').disabled);await waitFlag(()=>saveHeld,'saveHeld');
  assert.equal(await page.locator('#pr-multi').isDisabled(),true);assert.equal(await page.locator('#btn-print-run').isDisabled(),true);assert.equal(await page.locator('#btn-print-run-2').isDisabled(),true);
  assert.equal(await page.locator('#pr-set-modal').evaluate(n=>n.contains(document.activeElement)),true,'Disabling save keeps focus inside dialog');
  await page.keyboard.press('Tab');assert.equal(await page.locator('#pr-set-modal').evaluate(n=>n.contains(document.activeElement)),true,'Busy Tab stays inside dialog');
  await page.keyboard.press('Escape');
  await page.locator('#pr-set-modal').click({position:{x:2,y:2}});assert.equal(await page.locator('#pr-set-modal').isVisible(),true,'Busy cannot close');
  await page.goBack();assert.equal(await page.locator('#pr-set-modal').isVisible(),true,'Busy back cannot leave');
  await page.locator('[data-set-cover="1"]').evaluate(n=>n.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})));assert.notEqual(await page.locator('[data-set-cover="1"]').getAttribute('contenteditable'),'true','Busy locks cover editor');
  await page.evaluate(()=>window.__setsTest.runPrint());assert.equal(await page.evaluate(()=>window.__prints||0),0);
  holdSave=false;releaseSave();await page.waitForFunction(()=>window.__setsTest.multiPrint.revision===1&&!window.__setsTest.multiPrint.busy);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'pr-set-manage','Successful save restores enabled trigger focus');
  console.log('QA saved');await openModal();assert.equal(await page.locator('#pr-set-archive').isVisible(),true,'Saved set exposes archive');await closeModal();const id=await page.evaluate(()=>window.__setsTest.multiPrint.id);assert.equal(f.sql.prepare('SELECT count(*) n FROM print_sets').get().n,1);
  holdList=true;listHeld=false;await openModal();await waitFlag(()=>listHeld,'listHeld');
  await page.locator('#pr-set-list').selectOption(id);await closeModal();holdList=false;
  const freshList=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/print-sets'&&r.request().method()==='GET');await openModal();await freshList;releaseList();
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  assert.equal(await page.locator('#pr-set-list').inputValue(),id,'Refresh retains the chosen set');assert.ok(!(await page.locator('#pr-set-list').textContent()).includes('Stale list response'),'Closed modal invalidates the old list result');await closeModal();
  f.reopen();
  const second=await context.newPage();await second.goto(origin,{waitUntil:'networkidle'});await second.locator('#pr-multi').check();await second.locator(`#pr-set-list option[value="${id}"]`).waitFor({state:'attached'});await openModal(second);await second.locator('#pr-set-list').selectOption(id);await second.locator('#pr-set-open').click();await second.waitForFunction(()=>window.__setsTest.state.printExam?.kind==='printSet'&&!window.__setsTest.multiPrint.busy);await closeModal(second);
  assert.deepEqual(await second.evaluate(()=>window.__setsTest.multiPrint.ids),[11,21,13]);assert.equal(await second.locator('[data-set-cover="1"]').textContent(),'COMMON COVER');
  await openModal(second);assert.deepEqual(await second.locator('#pr-multi-selection li > span').allTextContents(),['2026 合成大学 前期','2026 別大学 前期','2026 合成大学 後期']);await closeModal(second);
  assert.equal(await second.locator('[data-prq="11:1"]').isChecked(),false,'Saved exclusions restore on another device');
  await openDialog('pr-questions-modal',second);await second.locator('[data-prq="11:1"]').check();await closeAny(second);
  await setName('Updated on other device',second);await openModal(second);await second.locator('#pr-set-save').click();await second.waitForFunction(()=>window.__setsTest.multiPrint.revision===2&&!window.__setsTest.multiPrint.busy);
  await setName('Stale local edit');await openModal();await page.locator('#pr-set-save').click();await page.waitForFunction(()=>!window.__setsTest.multiPrint.busy&&window.__setsTest.multiPrint.error.includes('別端末'));
  assert.equal(await page.locator('#pr-set-name').inputValue(),'Stale local edit');assert.equal((await f.call('user-a',id)).body.print_set.name,'Updated on other device');assert.equal(await page.locator('#btn-print-run').isDisabled(),true);
  await openModal();await page.locator('#pr-set-list').selectOption(id);await page.locator('#pr-set-open').click();await page.waitForFunction(()=>window.__setsTest.multiPrint.revision===2&&!window.__setsTest.multiPrint.busy);await closeModal();
  holdSetRead=true;setReadHeld=false;await openModal();await page.locator('#pr-set-list').selectOption(id);await page.locator('#pr-set-open').click();await waitFlag(()=>setReadHeld,'setReadHeld');assert.equal(await page.locator('#pr-set-modal').evaluate(n=>n.contains(document.activeElement)),true,'Pending load retains dialog focus');
  await page.locator('#pr-set-modal [role="dialog"]').press('Escape');assert.equal(await page.locator('#pr-set-modal').isVisible(),true,'Pending read cannot close or change drafts');assert.equal(await page.locator('#pr-multi').isDisabled(),true);
  holdSetRead=false;releaseSetRead();await page.waitForFunction(()=>!window.__setsTest.multiPrint.busy);await closeModal();
  console.log('QA second device conflict ready');
  // Existing saved sets contain no new option: default remains OFF in this device.
  assert.equal(await page.locator('#pr-answer-exam-break').isChecked(),false);
  const readPages=pdf=>JSON.parse(execFileSync('python3',['-c',"import json,sys;from pypdf import PdfReader;print(json.dumps([p.extract_text() for p in PdfReader(sys.argv[1]).pages]))",pdf],{encoding:'utf8'}));
  assert.equal(await page.locator('#pr-question-exam-break').isChecked(),false);
  // Same university, different years, plus a different university.
  await page.evaluate(()=>window.__setsTest.state.printExam.exams[2].year=2025);
  for(const questionBreaks of [false,true])for(const breaks of [false,true]) {
    await checkPrint('#pr-question-exam-break',questionBreaks);
    await checkPrint('#pr-answer-exam-break',breaks);
    await page.evaluate(()=>window.__setsTest.runPrint());await page.waitForFunction(()=>!document.getElementById('btn-print-run').disabled);
    const pdf=path.join(evidence,`exam-break-${width}-${questionBreaks}-${breaks}.pdf`);await page.pdf({path:pdf,format:'A4',printBackground:true});
    const texts=readPages(pdf);assert.equal(texts.length,1+(questionBreaks?3:1)+(breaks?3:1));
    for(const [i,m] of ['Q11','Q21','Q13'].entries())assert.ok(texts[questionBreaks?i+1:1].includes(m),'Question boundary follows its option');
    for(const [i,m] of ['A11','A21','A13'].entries())assert.ok(texts[(questionBreaks?4:2)+(breaks?i:0)].includes(m),'Answer boundary follows its independent option');
    assert.ok(texts.every(t=>t.trim()),'No empty PDF page');
  }
  await page.evaluate(()=>window.__setsTest.state.printExam.exams[2].year=2026);
  // Long question bodies must flow naturally while keeping exam headings with content.
  const originalProblems=await page.evaluate(()=>window.__setsTest.state.printExam.exams.map(e=>e.questions[0].problem_text));
  for(const questionBreaks of [false,true]) {
    await checkPrint('#pr-question-exam-break',questionBreaks);
    await page.evaluate(()=>window.__setsTest.state.printExam.exams.forEach(e=>{e.questions[0].problem_text+='\n'+Array.from({length:75},(_,i)=>'Long passage line '+i+' flows across A4 sheets.').join('\n');}));
    await page.evaluate(()=>window.__setsTest.runPrint());await page.waitForFunction(()=>!document.getElementById('btn-print-run').disabled);
    const pdf=path.join(evidence,`question-long-${width}-${questionBreaks}.pdf`);await page.pdf({path:pdf,format:'A4',printBackground:true});
    const texts=readPages(pdf);assert.ok(texts.length>7);assert.ok(texts.every(t=>t.trim()));
    for(const [i,m] of ['Q11','Q21','Q13'].entries())assert.ok(texts.find(t=>t.includes(m)).normalize('NFKC').replace(/\s+/g,' ').includes(expectedHeads[i]));
    await page.evaluate(values=>window.__setsTest.state.printExam.exams.forEach((e,i)=>e.questions[0].problem_text=values[i]),originalProblems);
  }
  await checkPrint('#pr-question-exam-break',true);
  await checkPrint('#pr-optimize-answers',false);
  // Long answers cross A4 pages; each exam heading must stay with its first answer.
  const originalCommentary=await page.evaluate(()=>window.__setsTest.state.printExam.exams.map(e=>e.questions[0].commentary_text));
  for(const optimized of [false,true])for(const breaks of [false,true]) {
   await checkPrint('#pr-optimize-answers',optimized);await checkPrint('#pr-answer-exam-break',breaks);
   await page.evaluate(()=>{window.__setsTest.state.printExam.exams.forEach(e=>{e.questions[0].commentary_text=Array.from({length:75},(_,i)=>'Long explanation line '+i+' keeps flowing across pages without blank sheets.').join('\n');});});
   await page.evaluate(()=>window.__setsTest.runPrint());await page.waitForFunction(()=>!document.getElementById('btn-print-run').disabled);
   const pdf=path.join(evidence,`answer-long-${width}-${optimized}-${breaks}.pdf`);await page.pdf({path:pdf,format:'A4',printBackground:true});
   const texts=readPages(pdf);assert.ok(texts.length>7);assert.ok(texts.every(t=>t.trim()),'Long answer has no blank page');
   for(const [i,m] of ['A11','A21','A13'].entries()) {
    const answerPage=texts.find(t=>t.includes(m));assert.ok(answerPage.normalize('NFKC').replace(/\s+/g,' ').includes(expectedHeads[i]),'Exam heading stays with its first answer');
   }
  }
  await page.evaluate(values=>window.__setsTest.state.printExam.exams.forEach((e,i)=>e.questions[0].commentary_text=values[i]),originalCommentary);
  await checkPrint('#pr-optimize-answers',false);await checkPrint('#pr-answer-exam-break',true);
  // Test reload through Store without disturbing the existing modal/history scenario.
  assert.equal(await page.evaluate(()=>Store.getPrintAnswerExamPageBreak()),true);
  const storagePage=await context.newPage();await storagePage.goto(origin,{waitUntil:'networkidle'});
  assert.equal(await storagePage.locator('#pr-question-exam-break').isChecked(),true);assert.equal(await storagePage.locator('#pr-answer-exam-break').isChecked(),true);await storagePage.close();await page.bringToFront();
  await page.evaluate(()=>window.__prints=0);
  // Real print HTML and PDF: one cover, Q exams then A exams, distinct pages.
  await page.locator('#btn-print-run').click();await page.waitForFunction(()=>window.__prints===1);assert.equal(await page.locator('#print-area .print-cover').count(),1);assert.equal(await page.locator('#print-area .print-modal, #print-area input, #print-area button').count(),0,'Print output contains no dialogs/controls');
  assert.deepEqual(await page.locator('#print-area .print-exam-label').allTextContents(),expectedHeads.concat(expectedHeads));
  await page.emulateMedia({media:'print'});await assertHeadingColor('#print-area');await page.emulateMedia({media:null});
  const pdfPath=path.join(evidence,`multi-${width}.pdf`);await page.pdf({path:pdfPath,format:'A4',printBackground:true});
  const pdfText=execFileSync('python3',['-c',"import json,sys;from pypdf import PdfReader;print(json.dumps([p.extract_text() for p in PdfReader(sys.argv[1]).pages]))",pdfPath],{encoding:'utf8'});
  const pages=JSON.parse(pdfText);assert.equal(pages.length,7);assert.ok(pages[0].includes('COMMON COVER'));for(const [i,marker] of ['Q11','Q21','Q13','A11','A21','A13'].entries()){assert.ok(pages[i+1].includes(marker),`PDF page ${i+2} contains ${marker}`);assert.ok(pages[i+1].normalize('NFKC').replace(/\s+/g,' ').includes(expectedHeads[i%3]),`PDF page ${i+2} keeps year/university/schedule heading`);}
  fs.writeFileSync(path.join(evidence,`multi-${width}-pages.json`),JSON.stringify(pages,null,2));await page.screenshot({path:path.join(evidence,`desktop-mobile-${width}.png`),fullPage:true});
  // Repeated clicks and an edited cover during font loading must not print old output.
  const beforePrints=await page.evaluate(()=>window.__prints||0);
  await page.evaluate(()=>{window.__originalFonts=document.fonts.ready;window.__heldFonts=new Promise(resolve=>window.__releaseFonts=resolve);Object.defineProperty(document.fonts,'ready',{configurable:true,get:()=>window.__heldFonts});});
  await page.locator('#btn-print-run').click();await page.evaluate(()=>window.__setsTest.runPrint());
  await cover('0','Changed during preparation');await page.evaluate(()=>window.__releaseFonts());
  await page.waitForFunction(()=>!document.getElementById('btn-print-run').disabled);assert.equal(await page.evaluate(()=>window.__prints||0),beforePrints);
  await page.evaluate(()=>Object.defineProperty(document.fonts,'ready',{configurable:true,get:()=>window.__originalFonts}));await cover('0','');
  // Borderline and maximum-length cover text must stay entirely on page one.
  await checkPrint('#pr-name-field');
  for (const length of [30,60,120]) {
   for (let i=0;i<3;i++)await cover(i,['上','中','下'][i].repeat(length));
   await cover('time','時'.repeat(120));
   await page.locator('#btn-print-run').click();await page.waitForFunction(()=>!window.__setsTest.multiPrint.busy&&!document.getElementById('btn-print-run').disabled);
   const longPdf=path.join(evidence,`cover-${width}-${length}.pdf`);await page.pdf({path:longPdf,format:'A4',printBackground:true});
   const longPages=JSON.parse(execFileSync('python3',['-c',"import json,sys;from pypdf import PdfReader;print(json.dumps([p.extract_text() for p in PdfReader(sys.argv[1]).pages]))",longPdf],{encoding:'utf8'}));
   assert.equal(longPages.length,7);for(const marker of ['上','中','下'])assert.equal([...longPages[0]].filter(x=>x===marker).length,length);assert.equal([...longPages[0]].filter(x=>x==='時').length,121);
   for(const text of longPages.slice(1))assert.ok(!/[上中下時]/.test(text),'Cover never spills into exam pages');
  }
  for(let i=0;i<3;i++)await cover(i,i===1?'COMMON COVER':'');await cover('time','各60分');
  await checkPrint('#pr-name-field',false);
  console.log('QA cover lengths ready');
  // Answer-only and problem-only reuse section controls.
  for(const type of ['本文','設問'])await checkPrint(`[data-prsec="${type}"]`,false);assert.equal(await page.locator('#print-preview .print-exam-block').count(),3);assert.ok(!(await page.locator('#print-preview').innerText()).includes('Q11'));
  await checkPrint('#pr-cover',false);
  for(const breaks of [false,true]) {
   await checkPrint('#pr-answer-exam-break',breaks);await page.evaluate(()=>window.__setsTest.runPrint());await page.waitForFunction(()=>!document.getElementById('btn-print-run').disabled);
   const pdf=path.join(evidence,`answer-only-${width}-${breaks}.pdf`);await page.pdf({path:pdf,format:'A4',printBackground:true});
   const texts=readPages(pdf);assert.equal(texts.length,breaks?3:1);for(const [i,m] of ['A11','A21','A13'].entries())assert.ok(texts[breaks?i:0].includes(m));
  }
  await checkPrint('#pr-cover',true);
  for(const type of ['本文','設問'])await checkPrint(`[data-prsec="${type}"]`);for(const type of ['解答','解説'])await checkPrint(`[data-prsec="${type}"]`,false);assert.equal(await page.locator('#print-preview .print-exam-block').count(),3);
  for(const type of ['解答','解説'])await checkPrint(`[data-prsec="${type}"]`);
  await setName('Retry save draft');failSave=true;await page.locator('#pr-set-save').click();await page.waitForFunction(()=>!window.__setsTest.multiPrint.busy&&window.__setsTest.multiPrint.error);assert.equal(await page.locator('#pr-set-name').inputValue(),'Retry save draft');assert.equal(await page.locator('#pr-set-modal').isVisible(),true);await page.locator('#pr-set-save').click();await page.waitForFunction(()=>!window.__setsTest.multiPrint.busy&&!window.__setsTest.multiPrint.error);await closeAny();
  console.log('QA sections ready');
  console.log('QA archive operation');await openModal();await page.locator('#pr-set-archive').click();await page.waitForFunction(()=>window.__setsTest.multiPrint.archived&&!window.__setsTest.multiPrint.busy);assert.equal(await page.locator('#btn-print-run').isDisabled(),true);
  console.log('QA archive operation');await openModal();await page.locator('#pr-set-archive').click();await page.waitForFunction(()=>!window.__setsTest.multiPrint.archived&&!window.__setsTest.multiPrint.busy);
  // Failed/missing exam blocks entire output; delayed stale results cannot replace a changed selection.
  failExam=21;await page.evaluate(()=>window.__setsTest.loadMultiPrint());await page.waitForFunction(()=>window.__setsTest.multiPrint.error.includes('21'));assert.equal(await page.locator('#btn-print-run').isDisabled(),true);assert.equal(await page.locator('#print-preview .print-cover').count(),0);
  failExam=null;await page.locator('#pr-multi-retry').click();await waitReady();
  holdId=13;examHeld=false;await page.evaluate(()=>{window.__setsTest.loadMultiPrint();});await waitFlag(()=>examHeld,'examHeld');
  await move('[data-set-remove="13"]');holdId=null;releaseExam();await page.waitForTimeout(100);assert.deepEqual(await page.evaluate(()=>window.__setsTest.state.printExam.exams.map(e=>e.id)),[11,21]);
  // Selecting all/none within a year does not clear other universities.
  await page.locator('[data-multi-year="[11,13]"]').check();await waitReady();assert.deepEqual((await page.evaluate(()=>window.__setsTest.multiPrint.ids)).sort(),[11,13,21]);
  await page.locator('[data-multi-year="[11,13]"]').uncheck();await waitReady();assert.deepEqual(await page.evaluate(()=>window.__setsTest.multiPrint.ids),[21]);
  await openModal();await page.locator('#pr-multi-clear').click();await closeModal();assert.equal(await page.locator('#btn-print-run').isDisabled(),true);
  // Set favorites reuse the existing print node and preserve unsaved selections on cancel.
  const anotherId='00000000-0000-4000-8000-000000000099';
  const savedSet=(await f.call('user-a',id)).body.print_set;
  await f.call('user-a',undefined,{id:anotherId,name:'Favorite second set',exam_ids:[12],cover:{lines:['','SECOND',''],time:''}});
  await page.evaluate(()=>window.__setsTest.refreshPrintSets());
  const star=page.locator('.print-multi-only .tree-row-fav');
  await star.click();assert.equal(await page.locator('#pr-set-favorites [data-open-set]').count(),2);
  await setName('Protected draft');await closeModal();
  page.removeAllListeners('dialog');page.once('dialog',d=>d.dismiss());
  await page.locator(`#pr-set-favorites [data-open-set="${anotherId}"]`).click();
  assert.equal(await page.evaluate(()=>window.__setsTest.multiPrint.name),'Protected draft');
  page.on('dialog',d=>d.accept());
  await page.locator(`#pr-set-favorites [data-open-set="${anotherId}"]`).click();await waitReady();
  assert.deepEqual(await page.evaluate(()=>window.__setsTest.multiPrint.ids),[12],'Sets replace selection, never merge');
  await page.locator('.tab[data-tab="favorites"]').click();await page.locator('#favorites-sets-toggle').check();
  await page.locator('#favorites-sets [data-open-set]').first().waitFor();
  const names=()=>page.locator('#favorites-sets [data-open-set]').allTextContents();
  const originalNames=await names();
  await page.locator('#favorites-sets [data-order-set]').filter({hasText:'↓'}).first().click();
  assert.deepEqual(await names(),originalNames.slice().reverse());
  await page.locator('#set-order-cancel').click();assert.deepEqual(await names(),originalNames);
  await page.locator('#favorites-sets [data-order-set]').filter({hasText:'↓'}).first().click();
  failSave=true;await page.locator('#set-order-save').click();await page.waitForFunction(()=>!document.getElementById('set-order-cancel').disabled);
  assert.deepEqual(await names(),originalNames.slice().reverse(),'Failed order preserves draft');
  await page.locator('#set-order-save').click();await page.waitForFunction(()=>document.getElementById('set-order-save').disabled&&!document.getElementById('set-order-cancel').disabled);
  f.reopen();assert.deepEqual((await f.call('user-a')).body.print_sets.map(s=>s.name),originalNames.slice().reverse());
  assert.deepEqual((await f.call('user-a',id)).body.print_set,savedSet,'Reordering preserves all set metadata');
  await page.reload({waitUntil:'networkidle'});await page.locator('.tab[data-tab="favorites"]').click();await page.locator('#favorites-sets-toggle').check();
  await page.waitForFunction(()=>document.querySelectorAll('#favorites-sets [data-open-set]').length===2);
  assert.deepEqual(await names(),originalNames.slice().reverse(),'Saved order survives reload');
  await page.locator('#favorites-sets-toggle').uncheck();assert.equal(await page.locator('#favorites-area').isVisible(),true);
  await page.locator('#favorites-sets-toggle').check();await page.locator(`#favorites-sets [data-open-set="${id}"]`).click();await waitReady();
  assert.equal(await page.locator('.tab[data-tab="print"]').getAttribute('class').then(c=>c.includes('active')),true);
  // The existing favorite cover editor is also available for saved/unsaved sets.
  await page.locator('[data-print-title-add="print-set"]').click();
  assert.equal(await page.locator('[data-set-cover="3"]').textContent(),'','Added blank row keeps its position');
  await cover(3,'EXTRA COVER');
  await page.locator('[data-print-title-size-toggle="print-set"][data-line="3"]').click();
  await page.locator('[data-print-title-size="print-set"][data-line="3"][data-size="2"]').click();
  await page.locator('[data-print-title-color="print-set"][data-line="3"][data-color="4"]').click();
  assert.ok((await page.locator('[data-set-cover="3"]').getAttribute('class')).includes('pc-title-size-2'));
  await page.locator('#pr-multi').uncheck();await page.locator('#pr-multi').check();await waitReady();
  assert.equal(await page.locator('[data-set-cover="3"]').textContent(),'EXTRA COVER','Mode switching retains set draft');
  await openModal();await page.locator('#pr-set-save').click();await page.waitForFunction(()=>!window.__setsTest.multiPrint.busy);await closeModal();
  assert.deepEqual((await f.call('user-a',id)).body.print_set.cover.lines.slice(3),['EXTRA COVER']);
  assert.equal((await f.call('user-a',id)).body.print_set.cover.sizes[3],2);
  await page.evaluate(()=>window.__setsTest.runPrint());await page.waitForFunction(()=>!document.getElementById('btn-print-run').disabled);
  assert.equal(await page.locator('#print-area .pc-title-size-2.pc-title-color-4').textContent(),'EXTRA COVER');
  assert.equal(await page.locator('#print-area button').count(),0);
  await page.locator('[data-print-title-remove="print-set"]').click();assert.equal(await page.locator('[data-set-cover="3"]').count(),0);
  await page.evaluate(()=>document.querySelectorAll("#pr-tree .tree-children").forEach(n=>n.hidden=false));
  // OFF returns to existing single exam and favorite output with no shared cover.
  await closeModal();await page.locator('#pr-multi').uncheck();assert.equal(await page.locator('#pr-set-manage').isVisible(),false);assert.equal(await page.locator('[data-multi-exam="11"]').isVisible(),false,'OFF hides multi checkboxes');await page.locator('.tree-row-sched[data-uni="合成大学"][data-year="2026"][data-sched="前期"]').click();await page.waitForFunction(()=>window.__setsTest.state.printExam?.kind==='exam');assert.equal(await page.locator('#print-preview .pc-duration').innerText(),'時間：60分');assert.equal(await page.locator('#print-preview .print-cover').count(),1);
  await page.locator('[data-print-title="exam-11"][data-line="1"]').dblclick();
  await page.locator('[data-print-title="exam-11"][data-line="1"]').fill('EDITED SINGLE');
  await page.locator('[data-print-title="exam-11"][data-line="1"]').press('Enter');
  await page.locator('[data-print-title-add="exam-11"]').click();
  await page.locator('[data-print-title-size-toggle="exam-11"][data-line="1"]').click();
  await page.locator('[data-print-title-size="exam-11"][data-line="1"][data-size="2"]').click();
  failUserSettings=true;
  await page.locator('[data-print-title-save="exam-11"]').click();
  await page.waitForFunction(()=>!document.querySelector('[data-print-title-save="exam-11"]').disabled);
  assert.equal(await page.locator('[data-print-title="exam-11"][data-line="1"]').textContent(),'EDITED SINGLE');
  assert.ok(await page.evaluate(()=>window.__setsTest.state.printTitleDrafts['exam-11']),'Failed cover save retains draft');
  await page.locator('[data-print-title-save="exam-11"]').click();
  await page.waitForFunction(()=>!window.__setsTest.state.printTitleDrafts['exam-11']);
  assert.deepEqual(userSettings.print_titles['exam-11'].lines,['2026年度','EDITED SINGLE','前期','']);
  await page.evaluate(()=>window.__setsTest.runPrint());await page.waitForFunction(()=>!document.getElementById('btn-print-run').disabled);
  assert.equal(await page.locator('#print-area .pc-uni').textContent(),'EDITED SINGLE');
  assert.equal(await page.locator('#print-area .pc-extra').textContent(),'');
  assert.ok((await page.locator('#print-area .pc-uni').getAttribute('class')).includes('pc-title-size-2'));
  if (!await page.locator('[data-favfolder="1"]').isVisible()) await page.locator('.print-single-only .tree-row-fav').click();await page.locator('[data-favfolder="1"]').click();await page.waitForFunction(()=>window.__setsTest.state.printExam?.kind==='favFolder');assert.equal(await page.locator('#print-preview .pc-uni').innerText(),'Fixture favorites');
  await page.locator('#pr-multi').check();await openModal();await page.locator('#pr-set-list').selectOption(id);await page.locator('#pr-set-open').click();await page.waitForFunction(()=>!window.__setsTest.multiPrint.busy&&window.__setsTest.multiPrint.revision);await closeModal();
  assert.equal(await page.locator('[data-set-cover="3"]').textContent(),'EXTRA COVER','Stored set cover rows restore after load');
  assert.ok((await page.locator('[data-set-cover="3"]').getAttribute('class')).includes('pc-title-size-2'));
  await openModal();await page.evaluate(()=>Auth.switchUser('user-b'));await page.waitForFunction(()=>window.__setsTest.multiPrint.uid==='user-b');
  assert.equal(await page.locator('.print-modal.open').count(),0);assert.equal(await page.locator('.shell').evaluate(n=>n.inert),false);
  await page.goBack();await page.waitForFunction(mode=>history.scrollRestoration===mode,initialRestoration);await page.goForward();await page.waitForFunction(mode=>history.scrollRestoration===mode,initialRestoration);assert.equal(await page.locator('.print-modal.open').count(),0,'Old account modal cannot reopen');
  assert.equal(await page.locator('#pr-set-name').inputValue(),'');assert.deepEqual(await page.evaluate(()=>window.__setsTest.multiPrint.ids),[]);assert.equal(await page.locator('[data-set-cover="1"]').count(),0);assert.equal(await page.evaluate(()=>window.__setsTest.multiPrint.cover.lines[1]),'印刷セット');assert.equal(await page.locator('#btn-print-run').isDisabled(),true);
  assert.deepEqual(errors,[]);assert.equal(f.sql.prepare('SELECT count(*) n FROM favorites').get().n,1);assert.equal(f.sql.prepare('SELECT problem_text FROM questions').get().problem_text,'source');
  console.log(`PASS ${width}px: selection/year/order, shared cover, SQLite re-open/second device/conflict, archive/restore, failures/stale fetch, single/favorite regressions, 7-page A4 PDF`);
  await context.close();f.close();
 }}catch(e){console.error('QA failed before cleanup:',e);throw e;}finally{clearTimeout(deadline);await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
