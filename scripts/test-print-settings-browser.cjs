// Every request is intercepted. Storage is a disposable SQLite DB, never production.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'../panel/node_modules/playwright');
const {fixture,tmp}=require('./print-sets-fixture.cjs');
const {buildSync}=require('../panel/node_modules/esbuild');
const profileModule=path.join(tmp,'browser-profiles.cjs');
buildSync({entryPoints:[path.resolve(__dirname,'../worker/print-profiles.ts')],bundle:true,platform:'node',format:'cjs',outfile:profileModule});
const {handlePrintProfile}=require(profileModule);
const root=path.resolve(__dirname,'..'),origin='https://exam-print-sets.test',evidence='/tmp/exam-print-sets-qa';fs.mkdirSync(evidence,{recursive:true});
const exams=[{id:11,university_id:1,university_name:'合成大学',year:2026,schedule:'前期'},{id:12,university_id:1,university_name:'合成大学',year:2025,schedule:'前期'},{id:13,university_id:1,university_name:'合成大学',year:2026,schedule:'後期'},{id:21,university_id:2,university_name:'別大学',year:2026,schedule:'前期'}];
const questions=id=>[{exam_id:id,question_number:1,category:'長文',problem_text:`{{本文}}\nQ${id} Synthetic passage with enough words to check printing.\n{{設問}}\n[[35]] Choose a word.`,answer_text:`A${id} [[35]] ((1))`,commentary_text:`C${id} Test commentary.`}];
const auth=`window.__fixtureUser={displayName:'Fixture',email:'fixture@example.test',uid:'user-a'};window.__authCallbacks=[];window.Auth={init(){},onChange(cb){__authCallbacks.push(cb);cb(__fixtureUser);},getCurrentUser(){return __fixtureUser;},getIdToken(){return Promise.resolve(__fixtureUser?'fixture-'+__fixtureUser.uid:null);},switchUser(uid){__fixtureUser=uid?{displayName:'Fixture',email:'fixture@example.test',uid}:null;__authCallbacks.forEach(cb=>cb(__fixtureUser));},signIn(){return Promise.resolve();},signOut(){this.switchUser(null);}};`;
const hook='window.__setsTest={state,multiPrint,runPrint,loadMultiPrint,loadPrintPreview,refreshPrintSets,buildPrintHtml,openPrintSet,savePrintSet,openFavoritePrintProfile,saveFavoritePrintProfile};';
(async()=>{
 const deadline=setTimeout(()=>{console.error('Browser test exceeded 360 seconds');process.exit(1);},360000);
 const waitFlag=async(fn,name)=>{for(let i=0;i<1000;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw new Error('Timed out waiting for '+name);};
 const browser=await chromium.launch({headless:!process.env.HEADED,...(process.env.PANEL_CHROMIUM?{executablePath:process.env.PANEL_CHROMIUM}:{})});
 try {for(const width of [1280,390]){
  const f=fixture();f.sql.exec("INSERT INTO favorite_folders(id,uid,name,kind) VALUES (1,'user-a','Fixture favorites','folder')");let userSettings={},failUserSettings=false;let failExam=null,holdId=null,releaseExam,examHeld=false,holdSave=false,releaseSave,saveHeld=false,failSave=false,holdSetRead=false,setReadHeld=false,releaseSetRead,holdList=false,listHeld=false,releaseList;
  const context=await browser.newContext({viewport:{width,height:960},isMobile:width<640,hasTouch:width<640,serviceWorkers:'block'});
  const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.origin!==origin)return route.fulfill({status:200,contentType:req.resourceType()==='stylesheet'?'text/css':'application/javascript',body:''});
   if(url.pathname.startsWith('/api/')){
    let data;
    if(['/api/favorites','/api/config','/api/universities','/api/exams'].includes(url.pathname))assert.equal(req.method(),'GET','No source/favorite/settings test writes');
    if(url.pathname==='/api/user-settings'&&req.method()==='PUT') { if(failUserSettings){failUserSettings=false;return route.fulfill({status:503,json:{error:'Synthetic cover save failure'}});} userSettings={...userSettings,...req.postDataJSON()};return route.fulfill({status:200,contentType:'application/json',body:'{}'}); }
    const profile=url.pathname.match(/^\/api\/favorite-print-profiles\/(\d+)$/);
    if(profile){
      const r=await handlePrintProfile(new Request(req.url(),{method:req.method(),...(req.method()==='PUT'?{body:req.postData()}:{})}),f.db,req.headers()['authorization']==='Bearer fixture-user-b'?'user-b':'user-a',profile[1]);
      return route.fulfill({status:r.status,json:r.body});
    }
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

  await page.evaluate(async()=>{
    const t=__setsTest;
    localStorage.setItem('anthropic_api_key','sentinel-key');
    t.multiPrint.enabled=true;document.getElementById('pr-multi').checked=true;
    t.multiPrint.ids=[11,12];t.multiPrint.name='Saved layout';
    await t.loadMultiPrint();
    for(const [id,value] of Object.entries({'pr-cover':false,'pr-renumber':true,'pr-grayscale':true,'pr-page-numbers':true,'pr-line-refs':true})){
      const n=document.getElementById(id);n.checked=value;n.dispatchEvent(new Event('change',{bubbles:true}));
    }
    const font=document.getElementById('pr-fontsize');font.value='lg';font.dispatchEvent(new Event('change',{bubbles:true}));
    Store.setPrintSection('解説',false);
    await t.savePrintSet();window.savedId=t.multiPrint.id;
  });
  const saved=(await f.call('user-a',await page.evaluate(()=>savedId))).body.print_set;
  assert.equal(saved.print_settings.controls.cover,false);
  assert.equal(saved.print_settings.controls.fontsize,'lg');
  assert.equal(saved.print_settings.sections['解説'],false);
  await page.evaluate(async()=>{
    document.getElementById('pr-cover').checked=true;
    document.getElementById('pr-fontsize').value='xs';Store.setPrintFontSize('xs');
    __setsTest.multiPrint.baseline=null;__setsTest.multiPrint.ids=[];__setsTest.multiPrint.name='';
    await __setsTest.openPrintSet(savedId);
  });
  assert.equal(await page.locator('#pr-cover').isChecked(),false);
  assert.equal(await page.locator('#pr-fontsize').inputValue(),'lg');
  assert.equal(await page.evaluate(()=>Store.isPrintSection('解説')),false);
  assert.equal(await page.evaluate(()=>localStorage.getItem('anthropic_api_key')),'sentinel-key');
  // Full settings survive fresh browser state and SQLite reopen.
  f.reopen();
  await page.reload({waitUntil:'networkidle'});
  await page.waitForFunction(()=>!!window.__setsTest);
  await page.evaluate(async id=>{
    __setsTest.multiPrint.enabled=true;document.getElementById('pr-multi').checked=true;
    await __setsTest.openPrintSet(id);
  },saved.id);
  assert.equal(await page.locator('#pr-fontsize').inputValue(),'lg');
  // Favorite settings save uses the rendered button, with no favorite/source writes.
  await page.evaluate(async()=>{
    const t=__setsTest;t.multiPrint.enabled=false;document.getElementById('pr-multi').checked=false;
    t.state.printSel={kind:'favFolder',folderId:1,uni:'',year:'',sched:''};
    await t.openFavoritePrintProfile(t.state.printSel);
  });
  await page.waitForFunction(()=>__setsTest.state.printExam?.kind==='favFolder');
  assert.match(await page.locator('#pr-favorite-settings-status').textContent(),/未保存/);
  await page.evaluate(()=>{
    const n=document.getElementById('pr-lineheight');n.value='5';n.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.locator('#pr-favorite-settings-save').click();
  await page.waitForFunction(()=>document.getElementById('pr-favorite-settings-status').textContent==='印刷設定を保存しました');
  f.reopen();
  await page.evaluate(async()=>{
    const n=document.getElementById('pr-lineheight');n.value='1';n.dispatchEvent(new Event('change',{bubbles:true}));
    await __setsTest.openFavoritePrintProfile(__setsTest.state.printSel);
  });
  assert.equal(await page.locator('#pr-lineheight').inputValue(),'5');
  assert.match(await page.locator('#pr-favorite-settings-status').textContent(),/復元/);
  // A delayed folder response must not replace settings after navigation.
  await page.evaluate(async()=>{
    const original=Api.favoritePrintProfile;
    let release;
    Api.favoritePrintProfile=()=>new Promise(r=>release=r);
    const previous=__setsTest.state.printSel;
    const pending=__setsTest.openFavoritePrintProfile(previous);
    __setsTest.state.printSel={kind:'exam',uni:'',year:'',sched:'',folderId:null};
    release({settings:{version:1,controls:{lineheight:'1'},sections:{}},revision:9});
    await pending;
    Api.favoritePrintProfile=original;
  });
  assert.equal(await page.locator('#pr-lineheight').inputValue(),'5');
  // Legacy set leaves current settings untouched.
  const legacy={id:'00000000-0000-4000-8000-000000000088',name:'Legacy',exam_ids:[11],cover:{lines:['','',''],time:''}};
  assert.equal((await f.call('user-a',undefined,legacy)).status,200);
  await page.evaluate(async id=>{
    __setsTest.multiPrint.enabled=true;document.getElementById('pr-multi').checked=true;
    await __setsTest.openPrintSet(id);
  },legacy.id);
  assert.equal(await page.locator('#pr-lineheight').inputValue(),'5');
  assert.equal(await page.evaluate(()=>localStorage.getItem('anthropic_api_key')),'sentinel-key');
  assert.equal(await page.locator('#pr-favorite-settings-save').isVisible(),false);
  assert.deepEqual(errors,[]);
  assert.equal(f.sql.prepare('SELECT problem_text FROM questions').get().problem_text,'source');
  await page.screenshot({path:`/tmp/exam-print-settings-${width}.png`,fullPage:true});
  await context.close();f.close();console.log('PASS saved print layouts desktop/mobile',width);
 }
 }finally{await browser.close();clearTimeout(deadline);}
})().catch(e=>{console.error(e);process.exitCode=1;});
