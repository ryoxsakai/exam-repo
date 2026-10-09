// All HTTP is intercepted and writes go only to disposable SQLite.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('../panel/node_modules/playwright'),{fixture}=require('./print-set-folders-fixture.cjs');
const root=path.resolve(__dirname,'..'),origin='https://set-folders.test';
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.PANEL_CHROMIUM?{executablePath:process.env.PANEL_CHROMIUM}:{})});try{for(const width of [1280,390]){
 const f=fixture(),id='00000000-0000-4000-8000-000000000001',id2='00000000-0000-4000-8000-000000000002';
 const payload={id,name:'Book',exam_ids:[11],cover:{lines:['','Cover',''],time:'60'},question_selection:{'11:1':false}};
 await f.call('print-sets',payload);await f.call('print-sets',{...payload,id:id2,name:'Other'});
 const parent=(await f.call('favorite-folders',{name:'Parent'})).body.folder.id;
 const child=(await f.call('favorite-folders',{name:'Child',parentId:parent})).body.folder.id;
 let hold=false,release,held=false,fail=false,failList=false,writes=0;
 const ctx=await browser.newContext({viewport:{width,height:960},isMobile:width<640,hasTouch:width<640,serviceWorkers:'block'}),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await ctx.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(u.origin!==origin)return route.fulfill({body:''});
  if(u.pathname.startsWith('/api/')){
   const api=u.pathname.slice(5),body=req.method()==='GET'||req.method()==='DELETE'?undefined:req.postDataJSON();
   if(api==='favorite-folders/reorder'){writes++;if(hold){held=true;await new Promise(r=>release=r);}if(fail){fail=false;return route.fulfill({status:503,json:{error:'Synthetic failure'}});}}
   if(api==='print-sets'&&failList)return route.fulfill({status:503,json:{error:'List failure'}});
   if(/^(favorites|favorite-folders|print-sets)/.test(api)){const uid=(req.headers().authorization||'').replace('Bearer fixture-','');const r=await f.call(api,body,req.method(),uid);return route.fulfill({status:r.status,json:r.body});}
   const data=api==='exams'?{exams:[{id:11,year:2026,university_name:'Fixture',schedule:'前期'}]}:api==='exams/11'?{exam:{id:11,year:2026,university_name:'Fixture',schedule:'前期',questions:[{exam_id:11,question_number:1,problem_text:'Synthetic',answer_text:'answer'}]}}:api.endsWith('print-duration')?{effective_minutes:60}: {universities:[],results:[],stop:[],level:[],vocab:[]};return route.fulfill({json:data});
  }
  const rel=u.pathname==='/'?'index.html':u.pathname.slice(1);let body=fs.readFileSync(path.join(root,rel));
  if(rel==='assets/js/auth.js')body='window.user={uid:"a"};window.cb=[];window.Auth={init(){},getCurrentUser(){return user},getIdToken(){return Promise.resolve("fixture-"+user.uid)},onChange(f){cb.push(f);f(user)},switchUser(uid){user={uid};cb.forEach(f=>f(user))}}';
  if(rel==='assets/js/viewer.js')body=body.toString().replace('document.addEventListener("DOMContentLoaded", init);','window.__folders={state,multiPrint,commitFavDrop,refreshPrintSets}; document.addEventListener("DOMContentLoaded", init);');
  return route.fulfill({body,contentType:{'.html':'text/html','.js':'application/javascript','.css':'text/css'}[path.extname(rel)]||'text/plain'});
 });
 await ctx.addInitScript(o=>localStorage.setItem('cf_worker_url',o),origin);await page.goto(origin);await page.locator('[data-tab="favorites"]').click();await page.locator('#favorites-sets-toggle').check();
 const row=key=>page.locator(`#favorites-area [data-node="${key}"] > .fav-row`);
 await row('set:'+id).waitFor();assert.equal(await page.locator('#btn-favorites-new-folder').isVisible(),true);
 assert.equal(await page.locator('#favorites-area .fav-drag-handle').count(),4);
 const move=async()=>{
  const src=row('set:'+id),dst=row('folder:'+child);
  if(width>640)await src.dragTo(dst);
  else{const a=await src.boundingBox(),b=await dst.boundingBox();const cdp=await ctx.newCDPSession(page);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x+30,y:a.y+a.height/2}]});
   await page.waitForFunction(()=>document.body.classList.contains('fav-dragging-touch'));
   await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:b.x+60,y:b.y+b.height/2}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
 };
 await move();await page.waitForFunction(({id,child})=>__folders.multiPrint.list.find(s=>s.id===id)?.folder_id===child,{id,child});
 await page.waitForFunction(()=>!document.querySelector('#favorites-area [data-open-set]:disabled'));
 assert.equal((await f.call('print-sets/'+id)).body.print_set.folder_id,child);
 const saved=(await f.call('print-sets/'+id)).body.print_set;assert.deepEqual(saved.exam_ids,payload.exam_ids);assert.deepEqual(saved.cover,payload.cover);assert.deepEqual(saved.question_selection,payload.question_selection);assert.equal(saved.revision,1);
 await page.reload();await page.locator('[data-tab="favorites"]').click();await page.locator('#favorites-sets-toggle').check();await row('set:'+id).waitFor();assert.equal(await page.locator(`[data-node="folder:${child}"] [data-node="set:${id}"]`).count(),1);
 // POST and recovery list failure must not leave an unsaved optimistic classification.
 fail=true;failList=true;const oldWrites=writes;
 await page.evaluate(({id,parent})=>{__folders.commitFavDrop('set:'+id,{parentId:parent});__folders.commitFavDrop('set:'+id,{parentId:null});},{id,parent});
 await page.waitForFunction(()=>!document.querySelector('#favorites-area [data-open-set]:disabled'));assert.equal(writes,oldWrites+1);assert.equal((await f.call('print-sets/'+id)).body.print_set.folder_id,child);
 assert.equal(await page.locator(`[data-node="folder:${child}"] [data-node="set:${id}"]`).count(),1);failList=false;
 // Delayed move completion after switching to printing refreshes the shared tree.
 hold=true;held=false;await page.evaluate(({id,parent})=>__folders.commitFavDrop('set:'+id,{parentId:parent}),{id,parent});
 while(!held)await new Promise(r=>setTimeout(r,10));await page.locator('[data-tab="print"]').click();await page.locator('#pr-multi').check();hold=false;release();
 await page.waitForFunction(({id,parent})=>__folders.multiPrint.list.find(s=>s.id===id)?.folder_id===parent,{id,parent});
 await page.locator('#pr-tree .print-multi-only.tree-node > .tree-row').click();await page.locator(`#pr-set-favorites [data-set-folder="${parent}"]`).waitFor();assert.equal(await page.locator(`#pr-set-favorites [data-set-folder="${parent}"] + .tree-children [data-open-set="${id}"]`).count(),1);
 // Existing folder deletion lifts the set to root without touching its content.
 await page.locator('[data-tab="favorites"]').click();page.once('dialog',d=>d.accept());await page.locator(`[data-fav-delete-folder="${parent}"]`).click();await page.waitForFunction(id=>__folders.multiPrint.list.find(s=>s.id===id)?.folder_id===null,id);
 assert.equal((await f.call('print-sets/'+id)).body.print_set.revision,1);
 // Corrupt/deleted historical folder references remain discoverable at root.
 f.sql.prepare('UPDATE print_set_placements SET folder_id=99999 WHERE set_id=?').run(id);await page.evaluate(()=>__folders.refreshPrintSets());await row('set:'+id).waitFor();
 const dir='/tmp/exam-print-sets-qa/folders';fs.mkdirSync(dir,{recursive:true});await page.screenshot({path:dir+'/'+width+'.png',fullPage:true});assert.deepEqual(errors,[]);
 await ctx.close();f.close();console.log('PASS '+width+'px: native/touch folder move, reload, content preservation, double action/failure rollback, pending mode switch, picker hierarchy, folder deletion, orphan visibility');
}}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
