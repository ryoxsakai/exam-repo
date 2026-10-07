// All API traffic uses synthetic read-only fixtures. No production data or account writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'../panel/node_modules/playwright');
const root=path.resolve(__dirname,'..'),origin='https://exam-answer-layout.test';
const exam={id:11,university_id:1,university_name:'合成大学',year:2026,schedule:'前期'};
const answer='{{7}} [[35]]((4))　[[36]]((5))\n\n{{8}} [[37]]((5))　[[38]]((3))\n\n{{9}} [[39]]((3))　[[40]]((1))\n\n{{10}} [[41]]((1))　[[42]]((2))';
const questions=[
 {exam_id:11,question_number:1,category:'文法',problem_text:'{{本文}}\nSynthetic passage for the original question.\n{{設問}}\n{{問7}} Choose [[35]] [[36]].\n\n((1)) after\n\n((2)) her\n\n((3)) him\n\n((4)) I\n\n((5)) not\n\n((6)) to\n\n((7)) told\n\n{{問8}} Choose [[37]] [[38]].\n\n{{問9}} Choose [[39]] [[40]].\n\n{{問10}} Choose [[41]] [[42]].',answer_text:answer,commentary_text:'{{7}} The first explanation.\n\n\nThe second paragraph.\n{{8}} Another explanation.\n\n| Word | Meaning |\n| --- | --- |\n| after | 後 |'},
 {exam_id:11,question_number:2,category:'和訳',problem_text:'{{問題}}\n{{問1}} Translate.\n{{問2}} Translate.',answer_text:'{{1}} This is a long model answer with details that should be kept as one complete response and wrap neatly under its own question number.\n\n{{2}} The second long model answer also includes enough words to demonstrate the vertical layout and preserve the full meaning.'},
 {exam_id:11,question_number:3,category:'英作文',problem_text:'{{問題}}\nWrite an essay.',answer_text:'A plain model essay.\n\nIts paragraphs remain unchanged.'}
];
const source=JSON.stringify(questions);
const hook='window.__answersTest={state,loadPrintPreview,renderPrintPreview,runPrint,printField};';
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.PANEL_CHROMIUM?{executablePath:process.env.PANEL_CHROMIUM}:{})});
 try{for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});
  const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  await context.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());
   if(u.origin!==origin)return route.fulfill({status:200,contentType:req.resourceType()==='stylesheet'?'text/css':'application/javascript',body:''});
   if(u.pathname.startsWith('/api/')){
    assert.equal(req.method(),'GET','Source data/settings must remain read-only');
    const data=u.pathname==='/api/exams'?{exams:[exam]}:u.pathname==='/api/exams/11'?{exam:{...exam,questions}}:u.pathname==='/api/exams/11/print-duration'?{exam_id:11,university_id:1,university_minutes:null,exam_minutes:null,effective_minutes:null,source:'unset'}:({'/api/config':{},'/api/universities':{universities:[]},'/api/search':{results:[]},'/api/wordlists':{stop:[],level:[],vocab:[]}})[u.pathname];
    assert.ok(data,'Unhandled fixture '+u.pathname);
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
   }
   const rel=u.pathname==='/'?'index.html':u.pathname.slice(1),file=path.resolve(root,rel);assert.ok(file.startsWith(root+path.sep));let body=fs.readFileSync(file);
   if(rel==='assets/js/viewer.js')body=body.toString().replace('document.addEventListener("DOMContentLoaded", init);',hook+'\ndocument.addEventListener("DOMContentLoaded", init);');
   return route.fulfill({status:200,contentType:({'.html':'text/html','.js':'application/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream',body});
  });
  await context.addInitScript(origin=>{if(location.origin!==origin)return;localStorage.setItem('cf_worker_url',origin);localStorage.setItem('exam_lasttab_main','print');window.print=()=>window.__prints=(window.__prints||0)+1;},origin);
  const page=await context.newPage();page.setDefaultTimeout(15000);
  const load=async()=>{await page.goto(origin,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__answersTest?.state.config!==null);await page.evaluate(exam=>{const t=__answersTest;t.state.printSel={kind:'exam',uni:exam.university_name,year:String(exam.year),sched:exam.schedule};t.loadPrintPreview();},exam);await page.waitForFunction(()=>__answersTest.state.printExam?.id===11);await page.locator('#pr-settings-open').click();};
  await load();
  const edgeCases=await page.evaluate(()=>{
   const t=__answersTest;
   const fallback=['{{1}}\n\n{{2}} B','{{見出し}}\nA paragraph.','{{1}} A\n{{補足}} More text'];
   const safe=fallback.every(text=>t.printField('解答',text,{optimizeAnswers:true})===t.printField('解答',text,{}));
   const multi=t.printField('解答','{{1}} First paragraph.\n\nSecond paragraph.\n\n{{2}} Another answer.',{optimizeAnswers:true});
   const short=t.printField('解答','{{1}} A\n\n{{2}} B\n\n{{3}} C\n\n{{4}} D',{optimizeAnswers:true});
   const div=document.createElement('div');div.innerHTML=short;
   return {safe,multi:multi.includes('print-answer-long')&&multi.includes('Second paragraph.'),short:div.querySelectorAll('.print-answer-item').length};
  });
  assert.deepEqual(edgeCases,{safe:true,multi:true,short:4});
  assert.equal(await page.locator('#pr-optimize-answers').isChecked(),false);assert.equal(await page.locator('#pr-compact-commentary').isChecked(),false);
  const baseline=await page.locator('#print-preview .print-part-a').innerHTML();
  const questionBaseline=await page.locator('#print-preview .print-part-q').innerHTML();
  await page.locator('#pr-optimize-answers').check();
  assert.equal(await page.locator('#print-preview .print-answer-group').count(),2);
  assert.equal(await page.locator('#print-preview .print-part-q').innerHTML(),questionBaseline);
  assert.equal(await page.locator('#print-preview .print-answer-item').count(),6);
  assert.equal(await page.locator('#print-preview .print-answer-group').nth(1).getAttribute('data-columns'),'1');
  const commentary=p=>p.locator('#print-preview .print-field').filter({has:p.locator('.print-field-label',{hasText:'解説'})}).locator('.exam-doc');
  const beforeCommentary=await commentary(page).innerHTML();assert.ok(beforeCommentary.includes('height:.6em'));
  await page.locator('#pr-compact-commentary').check();const compact=await commentary(page).innerHTML();
  assert.equal(compact,beforeCommentary.replace(/<div style="height:\.6em"><\/div>/g,''));assert.equal(await commentary(page).locator('table').count(),1);
  await page.locator('#pr-renumber').check();await page.locator('#pr-linenum').check();await page.locator('#pr-optimize-choices').check();
  const labels=await page.locator('#print-preview .print-answer-group').first().locator('.print-answer-item > .question-badge').allTextContents();assert.deepEqual(labels,['1','2','3','4']);
  assert.equal(await page.locator('#print-preview .print-choice-group').getAttribute('data-columns'),width===1280?'3':await page.locator('#print-preview .print-choice-group').getAttribute('data-columns'));
  assert.equal(await page.evaluate(()=>Store.getPrintOptimizeAnswers()&&Store.getPrintCompactCommentary()),true);
  await page.locator('#pr-optimize-answers').uncheck();await page.locator('#pr-compact-commentary').uncheck();await page.locator('#pr-renumber').uncheck();await page.locator('#pr-linenum').uncheck();await page.locator('#pr-optimize-choices').uncheck();
  assert.equal(await page.locator('#print-preview .print-part-a').innerHTML(),baseline,'OFF must restore exact old output');
  await page.locator('#pr-optimize-answers').check();await page.locator('#pr-compact-commentary').check();await load();
  assert.equal(await page.locator('#pr-optimize-answers').isChecked(),true);assert.equal(await page.locator('#pr-compact-commentary').isChecked(),true);
  await page.evaluate(()=>__answersTest.runPrint());await page.waitForFunction(()=>window.__prints===1);
  assert.equal(await page.locator('#print-area .print-answer-group').count(),2);
  assert.equal(await page.locator('#print-area .print-answer-group').first().getAttribute('data-columns'),'2');
  await page.emulateMedia({media:'print'});
  const rows=await page.locator('#print-area .print-answer-group').first().locator('.print-answer-item').evaluateAll(items=>items.map(x=>({x:x.getBoundingClientRect().left,y:x.getBoundingClientRect().top})));
  assert.ok(Math.abs(rows[0].x-rows[2].x)<1);assert.ok(Math.abs(rows[1].x-rows[3].x)<1);assert.ok(rows[2].y>rows[0].y);
  if(width===1280)await page.screenshot({path:'/tmp/print-answers-layout.png',fullPage:true});
  await page.pdf({path:'/tmp/print-answers-'+width+'.pdf',format:'A4'});
  assert.equal(JSON.stringify(questions),source);assert.deepEqual(errors,[]);
  console.log('PASS '+width+'px: actual settings listeners/reload, answer+number grouping, compact commentary preserves lines/headings/table, OFF exact output, renumber/choices/line numbers, hidden print-area and A4, no source writes');
  await context.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
