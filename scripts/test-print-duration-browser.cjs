// Synthetic browser QA; intercepts all requests, never writes production data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {execFileSync}=require('node:child_process');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '../panel/node_modules/playwright');
const root=path.resolve(__dirname,'..');
const origin='https://exam-duration.test';
const marker='document.addEventListener("DOMContentLoaded", init);';
const hook='window.__durationTest={state,loadPrintPreview,renderPrintPreview,renderPrintDurationSettings,runPrint};';
const exams=[{id:11,university_id:1,university_name:'合成大学',year:2026,schedule:'前期'},{id:12,university_id:1,university_name:'合成大学',year:2025,schedule:'前期'},{id:13,university_id:1,university_name:'合成大学',year:2026,schedule:'後期'},{id:21,university_id:2,university_name:'別大学',year:2026,schedule:'前期'}];
(async()=>{
  const browser=await chromium.launch({headless:true, ...(process.env.PANEL_CHROMIUM?{executablePath:process.env.PANEL_CHROMIUM}:{})});
  try {
    for (const width of [1280,390]) {
      const context=await browser.newContext({viewport:{width,height:960},serviceWorkers:'block'});
      const page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
      const defaults={}, overrides={}; let holdSave=false, releaseSave, held, holdRead=false, releaseRead, readHeld=false, failRead=false;
      const duration=id=>{const e=exams.find(e=>e.id===id); const u=defaults[e.university_id]??null,x=overrides[id]??null; return {exam_id:id,university_id:e.university_id,university_minutes:u,exam_minutes:x,effective_minutes:x??u,source:x!==null?'exam':u!==null?'university':'unset'};};
      await context.route('**/*',async route=>{
        const req=route.request(), url=new URL(req.url());
        if(url.origin!==origin) return route.fulfill({status:200,contentType:req.resourceType()==='stylesheet'?'text/css':'application/javascript',body:''});
        if(url.pathname.startsWith('/api/')) {
          let data;
          const match=url.pathname.match(/^\/api\/exams\/(\d+)(\/print-duration)?$/);
          if(match) {
            const id=Number(match[1]),e=exams.find(e=>e.id===id);
            if(match[2]) {
              if(req.method()==='PUT') {
                if(holdSave) {held=true; await new Promise(resolve=>releaseSave=resolve);}
                const b=req.postDataJSON();
                if(Object.hasOwn(b,'university_minutes')) defaults[e.university_id]=b.university_minutes;
                if(Object.hasOwn(b,'exam_minutes')) overrides[id]=b.exam_minutes;
              }
              if(req.method()==='GET' && holdRead) {readHeld=true; await new Promise(resolve=>releaseRead=resolve);}
              if(req.method()==='GET' && failRead) {failRead=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic duration re-read failure'})});}
              data=duration(id);
            } else data={exam:{...e,questions:[{exam_id:id,question_number:1,problem_text:'{{本文}}\nSynthetic test passage.\n{{設問}}\nChoose a word.',answer_text:'Answer'}]}};
          } else if(url.pathname==='/api/exams') data={exams:exams.filter(e=>(!url.searchParams.get('year')||String(e.year)===url.searchParams.get('year'))&&(!url.searchParams.get('universityName')||e.university_name===url.searchParams.get('universityName'))&&(!url.searchParams.get('schedule')||e.schedule===url.searchParams.get('schedule')))};
          else data=({'/api/config':{},'/api/universities':{universities:[]},'/api/search':{results:[]},'/api/wordlists':{stop:[],level:[],vocab:[]}})[url.pathname];
          assert.ok(data,`Unhandled fixture API ${url.pathname}`);
          return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
        }
        const relative=url.pathname==='/'?'index.html':url.pathname.slice(1), file=path.resolve(root,relative);
        assert.ok(file.startsWith(root+path.sep));
        let body=fs.readFileSync(file);
        if(relative==='assets/js/viewer.js') {if(process.env.DURATION_TEST_BASELINE) body=execFileSync('git',['show',(process.env.DURATION_TEST_BASELINE_REF || 'ec763574121f2d7c2c6097789c8d6df3538b194a')+':assets/js/viewer.js'],{cwd:root,encoding:'utf8'});body=body.toString().replace(marker,hook+'\n'+marker);}
        return route.fulfill({status:200,contentType:({'.html':'text/html','.js':'application/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream',body});
      });
      await context.addInitScript(origin=>{localStorage.setItem('cf_worker_url',origin);localStorage.setItem('exam_lasttab_main','print');window.print=()=>{window.__prints=(window.__prints||0)+1;};},origin);
      const open=async()=>{await page.goto(origin,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__durationTest&&window.__durationTest.state.config!==null);await page.locator('#pr-settings-open').click();};
      const choose=async id=>{const e=exams.find(e=>e.id===id);await page.evaluate(e=>{const t=window.__durationTest;t.state.printSel={kind:'exam',uni:e.university_name,year:String(e.year),sched:e.schedule};t.loadPrintPreview();},e);await page.waitForFunction(id=>window.__durationTest.state.printExam?.id===id,id);};
      const save=async(key,value)=>{await page.locator('#pr-duration-'+key).fill(value);await page.locator('#pr-duration-save-'+key).click();await page.waitForFunction(()=>!document.getElementById('pr-duration-save-university').disabled);};
      await open(); await choose(11);
      assert.match(await page.locator('#pr-duration-source').innerText(),/未登録/); assert.equal(await page.locator('#print-preview .pc-duration').count(),0);
      await page.locator('#pr-duration-exam').fill('75'); await save('university','60');
      assert.equal(await page.locator('#pr-duration-exam').inputValue(),'75','Saving default retains unsaved override');
      assert.equal(await page.locator('#print-preview .pc-duration').innerText(),'時間：60分');
      // Re-read after PUT must complete before either button or direct runPrint can print.
      holdRead=true;readHeld=false;
      await page.locator('#pr-duration-save-exam').click();
      while(!readHeld) await new Promise(r=>setTimeout(r,10));
      assert.equal(await page.locator('#btn-print-run').isDisabled(),true);
      assert.equal(await page.locator('#btn-print-run-2').isDisabled(),true);
      await page.evaluate(()=>window.__durationTest.runPrint());
      assert.equal(await page.evaluate(()=>window.__prints||0),0,'Direct runPrint is blocked while post-save GET is pending');
      holdRead=false;releaseRead();
      await page.waitForFunction(()=>document.querySelector('#print-preview .pc-duration')?.textContent==='時間：75分');
      await page.waitForFunction(()=>!document.getElementById('btn-print-run').disabled);
      assert.match(await page.locator('#pr-duration-source').innerText(),/例外/);
      await choose(12); assert.equal(await page.locator('#print-preview .pc-duration').innerText(),'時間：60分');
      await choose(13); assert.match(await page.locator('#pr-duration-source').innerText(),/初期値/);
      await choose(21); assert.equal(await page.locator('#print-preview .pc-duration').count(),0);
      await choose(11); await page.locator('#pr-duration-reset').click();await page.waitForFunction(()=>document.querySelector('#print-preview .pc-duration')?.textContent==='時間：60分');
      await page.locator('#pr-duration').uncheck();assert.equal(await page.locator('#print-preview .pc-duration').count(),0);
      await open(); await choose(11); assert.equal(await page.locator('#pr-duration').isChecked(),false);
      await page.locator('#pr-duration').check();await page.locator('#pr-cover').uncheck();assert.equal(await page.locator('#pr-duration').isDisabled(),true);assert.equal(await page.locator('#print-preview .pc-duration').count(),0);
      await page.locator('#pr-cover').check();assert.equal(await page.locator('#pr-duration').isEnabled(),true);
      holdSave=true;held=false;await page.locator('#pr-duration-university').fill('90');await page.locator('#pr-duration-save-university').click();
      await page.waitForFunction(()=>document.getElementById('pr-duration-university').disabled); while(!held) await new Promise(r=>setTimeout(r,10));
      assert.equal(await page.locator('#btn-print-run').isDisabled(),true);
      assert.equal(await page.locator('#btn-print-run-2').isDisabled(),true);
      await page.evaluate(()=>window.__durationTest.runPrint());
      assert.equal(await page.evaluate(()=>window.__prints||0),0,'Direct runPrint cannot use old default during pending PUT');
      const e=exams[1]; await page.evaluate(e=>{const t=window.__durationTest;t.state.printSel={kind:'exam',uni:e.university_name,year:String(e.year),sched:e.schedule};t.loadPrintPreview();},e);
      releaseSave();holdSave=false;await page.waitForFunction(()=>window.__durationTest.state.printExam?.id===12);
      assert.equal(await page.locator('#print-preview .pc-duration').innerText(),'時間：90分','Selection waits for pending shared default save');
      // Stale year request must never replace the newest selection.
      await page.evaluate(()=>{const t=window.__durationTest;t.state.printSel={kind:'exam',uni:'合成大学',year:'2026',sched:'前期'};t.loadPrintPreview();t.state.printSel={kind:'exam',uni:'別大学',year:'2026',sched:'前期'};t.loadPrintPreview();});
      await page.waitForFunction(()=>window.__durationTest.state.printExam?.id===21);assert.equal(await page.locator('#print-preview .pc-duration').count(),0);
      await choose(12);
      // If PUT succeeds but GET fails, keep printing blocked until a verified reload.
      failRead=true;await save('university','95');
      assert.match(await page.locator('#pr-duration-source').innerText(),/印刷は停止中/);
      assert.equal(await page.locator('#btn-print-run').isDisabled(),true);
      assert.equal(await page.locator('#btn-print-run-2').isDisabled(),true);
      await page.evaluate(()=>window.__durationTest.runPrint());
      assert.equal(await page.evaluate(()=>window.__prints||0),0);
      await choose(12);assert.equal(await page.locator('#btn-print-run').isEnabled(),true);
      assert.equal(await page.locator('#print-preview .pc-duration').innerText(),'時間：95分');
      // Print preparations started before a save must also be cancelled.
      await page.evaluate(()=>{window.__fontResolve=null;Object.defineProperty(document,'fonts',{configurable:true,value:{ready:new Promise(r=>window.__fontResolve=r)}});window.__durationTest.runPrint();});
      holdSave=true;held=false;await page.locator('#pr-duration-university').fill('90');await page.locator('#pr-duration-save-university').click();
      while(!held) await new Promise(r=>setTimeout(r,10));
      await page.evaluate(async()=>{window.__fontResolve();await Promise.resolve();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));delete document.fonts;});
      assert.equal(await page.evaluate(()=>window.__prints||0),0,'Prepared old print cancels after metadata save starts');
      holdSave=false;releaseSave();await page.waitForFunction(()=>!document.getElementById('btn-print-run').disabled);
      await page.locator('#pr-settings-modal [data-print-close]').first().click();
      await page.locator('#btn-print-run').click();await page.waitForFunction(()=>window.__prints>0);
      assert.equal(await page.locator('#print-area .pc-duration').innerText(),'時間：90分');
      assert.deepEqual(await page.locator('#print-area .print-part').evaluateAll(nodes=>nodes.map(n=>n.innerHTML)),await page.locator('#print-preview .print-part').evaluateAll(nodes=>nodes.map(n=>n.innerHTML)));
      assert.deepEqual(await page.locator('#print-area .pc-year,#print-area .pc-uni,#print-area .pc-sched,#print-area .pc-duration').allTextContents(),await page.locator('#print-preview .pc-year,#print-preview .pc-uni,#print-preview .pc-sched,#print-preview .pc-duration').allTextContents());
      assert.equal(await page.locator('#print-area button').count(),0);
      await page.pdf({path:`/tmp/exam-duration-${width}.pdf`,format:'A4',preferCSSPageSize:true});
      await page.locator('#print-preview .print-cover').screenshot({path:`/tmp/exam-duration-${width}.png`});
      await page.evaluate(()=>{const t=window.__durationTest;t.state.favFolders=[{id:55,name:'Favorite'}];t.state.printExam={kind:'favFolder',folderId:55,questions:[{exam_id:11,question_number:1,problem_text:'Favorite question'}],duration:{effective_minutes:90}};t.renderPrintDurationSettings();t.renderPrintPreview();});
      assert.equal(await page.locator('#pr-duration-settings').isHidden(),true);assert.equal(await page.locator('#pr-duration').isDisabled(),true);assert.equal(await page.locator('#print-preview .pc-duration').count(),0);
      assert.equal(await page.locator('#print-preview [data-print-title]').count(),3);
      assert.deepEqual(errors,[]);
      console.log(`PASS: ${width}px real init/listeners, save/reread, unsaved input retention, years/schedules/universities, reset, saved ON/OFF, cover OFF, pending save switch, stale selection, PUT/GET print blocking, failed re-read recovery, pending print cancellation, actual print/PDF, favorites untouched`);
      await context.close();
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
