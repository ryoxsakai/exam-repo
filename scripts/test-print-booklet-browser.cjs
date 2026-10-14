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
const hook='window.__answersTest={state,loadPrintPreview,renderPrintPreview,runPrint,printField,buildPrintHtml,printOptions};';
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
  await page.locator('#pr-answer-left').check();
  await page.locator('#pr-page-numbers').check();
  await load();
  assert.equal(await page.locator('#pr-answer-left').isChecked(),true);
  assert.equal(await page.locator('#pr-page-numbers').isChecked(),true);
  await page.evaluate(()=>{
    const original=PrintBooklet.prepare;
    PrintBooklet.prepare=async(...args)=>{const frame=await original(...args);frame.contentWindow.print=()=>window.__prints=(window.__prints||0)+1;return frame;};
    __answersTest.runPrint();
  });
  await page.waitForFunction(()=>window.__prints===1);
  assert.equal(await page.locator('#print-area.answer-left.print-page-numbers').count(),1);
  // Exercise native pagination using the production stylesheet and output selectors.
  const pdfPage=await context.newPage();
  // Real rendered questions/answers, plus naturally flowing multi-page text.
  const original=await page.evaluate(async()=>{
    const area=document.querySelector('#print-area');
    area.querySelector('.print-part-q .exam-doc').insertAdjacentHTML('beforeend','<p>'+Array.from({length:350},(_,i)=>'FLOWTOKEN'+i+' continues through the natural page boundary.').join(' ')+'</p>');
    const frame=await PrintBooklet.prepare(area,{answerLeft:true,pageNumbers:true});
    const d=frame.contentDocument;
    return '<!doctype html><style>'+[...d.styleSheets].map(s=>{try{return [...s.cssRules].map(r=>r.cssText).join('\n')}catch{return ''}}).join('\n')+'</style>'+d.body.innerHTML;
  });
  await pdfPage.setContent(original);
  await pdfPage.pdf({path:'/tmp/exam-booklet-flow.pdf',preferCSSPageSize:true,displayHeaderFooter:false});
  const flowText=require('node:child_process').execFileSync('pdftotext',['-layout','/tmp/exam-booklet-flow.pdf','-'],{encoding:'utf8'});
  for(let i=0;i<350;i++)assert.ok(new RegExp('FLOWTOKEN'+i+'\\b').test(flowText),'Missing flowing text '+i);

  for(const cover of [false,true])for(const qPages of [0,1,2,3])for(const multi of [false,true])for(const numbered of [false,true])for(const left of [false,true]){
    const rendered=await page.evaluate(async({cover,qPages,multi,numbered,left})=>{
      const area=document.querySelector('#print-area');
      area.className='print-out fs-md lh-3'+(left?' answer-left':'')+(numbered?' print-page-numbers':'');
      area.innerHTML=(cover?'<div class="print-cover">COVER</div>':'')+
        Array.from({length:qPages},(_,i)=>'<div class="'+(multi?'print-exam-block print-exam-q':'print-part print-part-q')+'" style="break-before:page">QUESTION'+i+'</div>').join('')+
        '<div class="'+(multi?'print-exam-block print-exam-a':'print-part print-part-a')+'">ANSWER</div>';
      const frame=await PrintBooklet.prepare(area,{answerLeft:left,pageNumbers:numbered});
      const d=frame.contentDocument;
      const css=[...d.styleSheets].map(sheet=>{try{return [...sheet.cssRules].map(r=>r.cssText).join('\n')}catch{return ''}}).join('\n');
      return '<!doctype html><style>'+css+'</style>'+d.body.innerHTML;
    },{cover,qPages,multi,numbered,left});
    await pdfPage.setContent(rendered);
    const file='/tmp/exam-booklet-'+[width,cover,qPages,multi,numbered,left].join('-')+'.pdf';
    await pdfPage.pdf({path:file,preferCSSPageSize:true,displayHeaderFooter:false});
    const text=require('node:child_process').execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8'});
    const pages=text.split('\f').slice(0,-1);
    const answerPage=pages.findIndex(p=>p.includes('ANSWER'))+1;
    // A document starting with answers has no preceding page to align against.
    if(left)assert.equal(answerPage%2,0,JSON.stringify({cover,qPages,multi,numbered,pages}));
    if(cover)assert.equal(pages[0].trim(),'COVER');
    for(let i=cover?1:0;i<pages.length;i++){
      const content=pages[i].trim();
      if(!content)continue;
      if(numbered)assert.match(content,new RegExp('\\s'+(i+1-(cover?1:0))+'$'),JSON.stringify({cover,qPages,multi,numbered,pages}));
      else assert.ok(!/\n\s*\d+\s*$/.test(content));
    }
  }
  await pdfPage.close();
  assert.deepEqual(errors,[]);
  await context.close();
 }console.log('Booklet parity, cover-excluded numbering, persisted options: passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
