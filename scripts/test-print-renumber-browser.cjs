// Synthetic HTTPS fixtures only. Optional EXAM_RENUMBER_FIXTURES reads local,
// previously fetched read-only exam snapshots; every browser request is intercepted.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'../panel/node_modules/playwright');
const root=path.resolve(__dirname,'..'),origin='https://exam-renumber.test';
const evidence='/tmp/exam-print-sets-qa/renumber'+(process.env.EXAM_RENUMBER_FIXTURES?'-readonly':'');
fs.mkdirSync(evidence,{recursive:true});
function question(id,n,start,nested=false) {
 const labels=Array.from({length:4},(_,i)=>`{{問${start+i}}} QUESTION-${id}-${n}-${i+1}`);
 if(nested)labels[0]+='\n(1) Lower one\n((1)) First choice\n(4) Lower four\n((4)) Fourth choice\n(6) Lower six';
 return {exam_id:id,question_number:n,category:'長文',problem_text:`{{本文}}\n${'Synthetic passage for line numbering. '.repeat(60)}\n{{問題}}\n(4)__Passage reference.__\n${labels.join('\n')}`,answer_text:labels.map((_,i)=>`{{問${start+i}}} ANSWER-${id}-${n}-${i+1}`).join('\n'),commentary_text:`問${start+3}の説明。\n(4) Lower four explanation.`};
}
let exams=[{id:11,university_id:1,university_name:'合成医科',year:2026,schedule:'前期',questions:[question(11,1,1),question(11,3,7,true)]},
 {id:21,university_id:2,university_name:'第二テスト大学',year:2025,schedule:'後期',questions:[question(21,7,33,true)]}];
if(process.env.EXAM_RENUMBER_FIXTURES) {
 exams=process.env.EXAM_RENUMBER_FIXTURES.split(',').map((file,i)=>{
  const ex=JSON.parse(fs.readFileSync(file,'utf8')).exam;
  const selected=ex.id===970?[4,5]:ex.id===42?[3]:ex.questions.map(q=>q.question_number);
  return {...ex,university_id:i+1,questions:ex.questions.filter(q=>selected.includes(q.question_number)).map(q=>({...q,exam_id:ex.id}))};
 });
}
const allQuestions=exams.flatMap(e=>e.questions),favorites=[...allQuestions].reverse();
const originals=Object.fromEntries(allQuestions.map(q=>[`${q.exam_id}:${q.question_number}`,q.problem_text]));
const auth=`window.Auth={init(){},onChange(cb){cb({uid:'fixture'});},getCurrentUser(){return{uid:'fixture'};},getIdToken(){return Promise.resolve('fixture');}};`;
const hook='window.__renumberTest={state,runPrint,renderPrintPreview,isPreparing:()=>printPreparing};';
(async()=>{
 const deadline=setTimeout(()=>{console.error('Renumber browser QA exceeded 240 seconds');process.exit(1);},240000);
 const browser=await chromium.launch({headless:true,...(process.env.PANEL_CHROMIUM?{executablePath:process.env.PANEL_CHROMIUM}:{})});
 try {for(const width of [1280,390]) {
  const context=await browser.newContext({viewport:{width,height:960},isMobile:width<640,hasTouch:width<640,serviceWorkers:'block'});
  const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.origin!==origin)return route.fulfill({status:200,contentType:req.resourceType()==='stylesheet'?'text/css':'application/javascript',body:''});
   if(url.pathname.startsWith('/api/')) {
    assert.equal(req.method(),'GET','No API writes in numbering QA');let data;
    const m=url.pathname.match(/^\/api\/exams\/(\d+)(\/print-duration)?$/);
    if(m){const ex=exams.find(e=>e.id===Number(m[1]));assert.ok(ex);data=m[2]?{exam_id:ex.id,university_id:ex.university_id,university_minutes:60,exam_minutes:null,effective_minutes:60,source:'university'}:{exam:ex};}
    else if(url.pathname==='/api/exams')data={exams:exams.filter(e=>!url.searchParams.get('year')||String(e.year)===url.searchParams.get('year'))};
    else data=({'/api/config':{},'/api/universities':{universities:[]},'/api/search':{results:[]},'/api/wordlists':{stop:[],level:[],vocab:[]},'/api/user-settings':{},'/api/print-sets':{print_sets:[]},'/api/favorites':{folders:[{id:1,name:'番号確認',parent_id:null,sort_order:0}],sections:[],favorites:favorites.map((q,i)=>({id:i+1,exam_id:q.exam_id,question_number:q.question_number,folder_id:1,sort_order:i}))}})[url.pathname];
    assert.ok(data,`Unhandled fixture ${url.pathname}`);return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
   }
   const file=path.resolve(root,url.pathname==='/'?'index.html':url.pathname.slice(1));assert.ok(file.startsWith(root+path.sep));let body=fs.readFileSync(file);
   if(url.pathname==='/assets/js/auth.js')body=auth;
   if(url.pathname==='/assets/js/viewer.js') {
    if(process.env.RENUMBER_BASELINE_REF)body=execFileSync('git',['show',process.env.RENUMBER_BASELINE_REF+':assets/js/viewer.js'],{cwd:root});
    body=body.toString().replace('document.addEventListener("DOMContentLoaded", init);',hook+'\n document.addEventListener("DOMContentLoaded", init);');
   }
   return route.fulfill({contentType:({'.html':'text/html','.js':'application/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream',body});
  });
  await context.addInitScript(origin=>{if(location.origin!==origin)return;localStorage.setItem('cf_worker_url',origin);localStorage.setItem('exam_lasttab_main','print');window.print=()=>window.__prints=(window.__prints||0)+1;},origin);
  const page=await context.newPage();page.setDefaultTimeout(15000);await page.goto(origin,{waitUntil:'networkidle'});
  const ready=kind=>page.waitForFunction(kind=>window.__renumberTest.state.printExam?.kind===kind,kind);
  const close=async()=>{const button=page.locator('.print-modal.open [data-print-close]').first();if(await button.count()){await button.click();await page.waitForFunction(()=>!document.querySelector('.print-modal.open'));await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}};
  const settings=async()=>{await close();await page.locator('#pr-settings-open').click();};
  const first=exams[0];await page.locator('.tree-row-uni').filter({hasText:first.university_name}).click();await page.locator('.tree-row-year').filter({hasText:first.year+'年度'}).click();await page.locator(`.tree-row-sched[data-year="${first.year}"]`).filter({hasText:first.schedule}).click();await ready('exam');
  async function check(label,order) {
   await settings();await page.locator('#pr-linenum').uncheck();await page.locator('#pr-renumber').uncheck();await close();
   const before=await page.locator('#print-preview').innerText();
   for(const on of [false,true,false,true]) {
    await settings();await page.locator('#pr-renumber').setChecked(on);await close();
    const actual=await page.locator('#print-preview .print-part-q .print-q').evaluateAll(rows=>rows.map(row=>{
     const fields=[...row.querySelectorAll('.print-field')];const primary=fields.filter(f=>/^(設問|問題)$/.test(f.querySelector('.print-field-label')?.textContent));
     return (primary.length?primary:fields).flatMap(f=>[...f.querySelectorAll('.question-block-header > .question-badge')].map(n=>n.textContent).filter(t=>/^問\d+$/.test(t)));
    }));
    const expected=await page.evaluate(({order,on})=>order.map(q=>{
     const sections=Markup.parseSections(q.problem_text).filter(s=>!/解答|解説|和訳|訳|答|講評/.test(s.type)&&s.type!=='リード文');
     const primary=sections.filter(s=>/^(設問|問題)$/.test(s.type));const texts=(primary.length?primary:sections).map(s=>s.text);
     const numbers=texts.flatMap(t=>[...t.matchAll(/^\s*\{\{問(\d+)\}\}(?!\s*[〜～~–—-])/gm)].map(m=>+m[1]));
     const unique=[...new Set(numbers)],resolve=n=>'問'+(on&&unique.includes(n)?unique.indexOf(n)+1:n);
     const embedded=Markup.parseSections(q.problem_text).find(s=>s.type==='解答');
     const answers=[...(embedded?.text||q.answer_text||'').matchAll(/\{\{問(\d+)\}\}/g)].map(m=>resolve(+m[1]));
     return {questions:numbers.map(resolve),answers};
    }),{order,on});
    assert.deepEqual(actual,expected.map(e=>e.questions),`${width}px ${label} renumber ${on}`);
    const answers=await page.locator('#print-preview .print-part-a .print-q').evaluateAll(rows=>rows.map(row=>[...row.querySelectorAll('.print-field')].filter(f=>f.querySelector('.print-field-label')?.textContent==='解答').flatMap(f=>[...f.querySelectorAll('.question-badge')].map(n=>n.textContent).filter(t=>/^問\d+$/.test(t)))));
    assert.deepEqual(answers,expected.map(e=>e.answers),'Answer labels use the same per-question correspondence');
    if(!on)assert.equal(await page.locator('#print-preview').innerText(),before,'OFF restores the original print content');
    const current=await page.evaluate(()=>{
     const qs=window.__renumberTest.state.printExam.questions;
     return Object.fromEntries(qs.map(q=>[`${q.exam_id}:${q.question_number}`,q.problem_text]));
    });
    for(const [key,text] of Object.entries(current))assert.equal(text,originals[key],'Raw problem data is unchanged');
   }
   for(const on of [false,true]) {
    await settings();await page.locator('#pr-renumber').setChecked(on);await close();
    const previous=await page.evaluate(()=>window.__prints||0);await page.locator('#btn-print-run').click();await page.waitForFunction(n=>window.__prints===n+1,previous);await page.waitForFunction(()=>!window.__renumberTest.isPreparing());
    assert.equal(await page.locator('#print-area .print-modal').count(),0);
    const badges=await page.locator('#print-area .question-badge').allTextContents();
    await page.emulateMedia({media:'print'});
    const color=await page.locator('#print-area .question-badge').first().evaluate(n=>getComputedStyle(n).color);
    const pdf=path.join(evidence,`${width}-${label}-${on?'on':'off'}.pdf`),json=pdf.replace(/\.pdf$/,'.json');
    fs.writeFileSync(json,JSON.stringify({badges:badges.filter(t=>/^問\d+$/.test(t)),color}));
    fs.writeFileSync(pdf.replace(/\.pdf$/,'.html'),await page.locator('#print-area').innerHTML());
    await page.pdf({path:pdf,format:'A4',printBackground:true});await page.emulateMedia({media:'screen'});
    execFileSync('python3',[path.join(__dirname,'verify-print-renumber-pdf.py'),pdf,json],{stdio:'inherit'});
   }
   await settings();await page.locator('#pr-linenum').check();await close();
   // Read-only examples may have copyright-omitted bodies shorter than five lines.
   if(!process.env.EXAM_RENUMBER_FIXTURES)await page.waitForFunction(()=>document.querySelectorAll('#print-preview .print-linenum').length>0);
   console.log(`PASS ${width}px ${label}: original order, numbered headings, repeated OFF/ON, raw data and real A4 PDF`);
  }
  await check('single',first.questions);
  await page.locator('#pr-multi').check();
  for(const ex of exams) {
   const cb=page.locator(`[data-multi-exam="${ex.id}"]`);
   if(!await cb.isVisible()) {
    const year=page.locator('.tree-row-year').filter({hasText:ex.year+'年度'});
    if(!await year.isVisible())await page.locator('.tree-row-uni').filter({hasText:ex.university_name}).click();
    if(!await cb.isVisible())await page.locator('.tree-row-year').filter({hasText:ex.year+'年度'}).click();
   }
   await cb.check();
  }
  await ready('printSet');await check('multi',allQuestions);
  await page.locator('#pr-multi').uncheck();await page.locator('.tree-row-fav').click();await page.locator('[data-favfolder="1"]').click();await ready('favFolder');await check('favorite',favorites);
  await page.locator('#pr-questions-open').click();await page.locator('[data-prq]').first().uncheck();await close();
  assert.equal(await page.locator('#print-preview .print-part-q .print-q').count(),favorites.length-1,'Excluded questions remain excluded');
  assert.deepEqual(errors,[]);await context.close();
 }}finally{clearTimeout(deadline);await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
