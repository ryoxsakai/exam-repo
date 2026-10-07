// All traffic uses synthetic fixtures; no production data, accounts or writes.
// Requires panel Playwright, Chromium, pypdf/PyMuPDF. PANEL_CHROMIUM overrides the executable.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '../panel/node_modules/playwright');
const root = path.resolve(__dirname, '..'), origin = 'https://exam-print-lines.test';
const evidence = '/tmp/exam-print-sets-qa/line-numbers'; fs.mkdirSync(evidence, {recursive:true});
const exams = [{id:11,university_id:1,university_name:'大阪医科薬科',year:2021,schedule:'前期'}, {id:21,university_id:2,university_name:'合成大学',year:2026,schedule:''}];
function passage(id, letter, count) {
 const words = Array.from({length:count}, (_,i)=>`${letter}${id}${String(i+1).padStart(4,'0')}river`);
 words[33] = `**${words[33]}**`; words[66] = `__${words[66]}__`; words[89] += ' [[7]]';
 return Array.from({length:Math.ceil(count/300)}, (_,i)=>words.slice(i*300,(i+1)*300).join(' ')).join('\n\n');
}
const questions = id => [{exam_id:id,question_number:1,category:'長文',problem_text:`{{リード文}}\nRead this synthetic passage and choose the answer.\n{{本文}}\n${passage(id,'a',900)}\n{{本文}}\n${passage(id,'b',180)}\n{{設問}}\nChoose a word.\n((1)) one\n((2)) two`,answer_text:'ANSWER ONLY 7',commentary_text:'COMMENTARY ONLY'}];
const hook = 'window.__lineTest={state,runPrint,printExam,renderPrintPreview,isPreparing:()=>printPreparing};';
const auth = `window.Auth={init(){},onChange(cb){cb({uid:'fixture',displayName:'Fixture'});},getCurrentUser(){return{uid:'fixture'};},getIdToken(){return Promise.resolve('fixture');}};`;
const pause = ms => new Promise(r=>setTimeout(r,ms));
async function waitFlag(fn) {for(let i=0;i<500;i++){if(fn())return;await pause(10);}throw Error('Fixture was not requested');}
(async()=>{
 const deadline = setTimeout(()=>{console.error('Line PDF QA exceeded 360 seconds');process.exit(1);},360000);
 const browser = await chromium.launch({headless:!process.env.HEADED,...(process.env.PANEL_CHROMIUM?{executablePath:process.env.PANEL_CHROMIUM}:{})});
 try {for(const width of [1280,390]) {
  const context = await browser.newContext({viewport:{width,height:960},isMobile:width<640,hasTouch:width<640,serviceWorkers:'block'});
  let holdFont=false, fontHeld=false, releaseFont, holdImage=false, imageHeld=false, releaseImage;
  const errors=[]; context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  await context.route('**/*',async route=>{
   const req=route.request(), url=new URL(req.url());
   if(url.origin!==origin)return route.fulfill({status:200,contentType:req.resourceType()==='stylesheet'?'text/css':'application/javascript',body:''});
   if(url.pathname==='/fixture-font.ttf') {if(holdFont){fontHeld=true;await new Promise(r=>releaseFont=r);}return route.fulfill({contentType:'font/ttf',body:fs.readFileSync('/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf')});}
   if(url.pathname==='/fixture-image.svg') {if(holdImage){imageHeld=true;await new Promise(r=>releaseImage=r);}return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><rect width="32" height="24" fill="#999"/></svg>'});}
   if(url.pathname.startsWith('/api/')) {
    assert.equal(req.method(),'GET','No API writes in line-number QA');let data;
    const m=url.pathname.match(/^\/api\/exams\/(\d+)(\/print-duration)?$/);
    if(m) {const ex=exams.find(e=>e.id===Number(m[1]));assert.ok(ex);data=m[2]?{exam_id:ex.id,university_id:ex.university_id,university_minutes:60,exam_minutes:null,effective_minutes:60,source:'university'}:{exam:{...ex,questions:questions(ex.id)}};}
    else if(url.pathname==='/api/exams')data={exams:exams.filter(e=>!url.searchParams.get('year')||String(e.year)===url.searchParams.get('year'))};
    else data=({'/api/config':{},'/api/universities':{universities:[]},'/api/search':{results:[]},'/api/wordlists':{stop:[],level:[],vocab:[]},'/api/user-settings':{},'/api/print-sets':{print_sets:[]},'/api/favorites':{folders:[{id:1,name:'合成お気に入り',parent_id:null,sort_order:0}],sections:[],favorites:exams.map((e,i)=>({id:i+1,exam_id:e.id,question_number:1,folder_id:1,sort_order:i}))}})[url.pathname];
    assert.ok(data,`Unhandled fixture ${url.pathname}`);return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
   }
   const file=path.resolve(root,url.pathname==='/'?'index.html':url.pathname.slice(1));assert.ok(file.startsWith(root+path.sep));let body=fs.readFileSync(file);
   if(url.pathname==='/assets/js/auth.js')body=auth;
   if(url.pathname==='/assets/js/viewer.js')body=body.toString().replace('document.addEventListener("DOMContentLoaded", init);',hook+'\n document.addEventListener("DOMContentLoaded", init);');
   return route.fulfill({contentType:({'.html':'text/html','.js':'application/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream',body});
  });
  await context.addInitScript(origin=>{if(location.origin!==origin)return;localStorage.setItem('cf_worker_url',origin);localStorage.setItem('exam_lasttab_main','print');window.print=()=>window.__prints=(window.__prints||0)+1;},origin);
  const page=await context.newPage();page.setDefaultTimeout(15000);await page.goto(origin,{waitUntil:'networkidle'});
  const ready=kind=>page.waitForFunction(kind=>window.__lineTest.state.printExam?.kind===kind,kind);
  const close=async()=>{const button=page.locator('.print-modal.open [data-print-close], .print-modal.open [data-set-close]').first();if(await button.count()){await button.click();await page.waitForFunction(()=>!document.querySelector('.print-modal.open'));await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}};
  const settings=async()=>{await close();await page.locator('#pr-settings-open').click();await page.locator('#pr-settings-modal').waitFor({state:'visible'});};
  const printPdf=async(filename,fromModal=false)=>{
   const old=await page.evaluate(()=>window.__prints||0);await page.locator(fromModal?'#btn-print-run-2':'#btn-print-run').click();await page.waitForFunction(old=>window.__prints===old+1,old);await page.waitForFunction(()=>!window.__lineTest.isPreparing());
   assert.equal(await page.locator('#print-area .print-part-a .print-linenum, #print-area .print-cover .print-linenum, #print-area .print-modal').count(),0);
   await page.emulateMedia({media:'print'});await page.pdf({path:filename,format:'A4',printBackground:true});await page.emulateMedia({media:'screen'});
  };
  await page.locator('.tree-row-uni').filter({hasText:'大阪医科薬科'}).click();await page.locator('.tree-row-year').filter({hasText:'2021年度'}).click();await page.locator('.tree-row-sched').filter({hasText:'前期'}).click();await ready('exam');
  async function checkCase(label,size,height,font,baseline=false) {
   await page.evaluate(font=>document.documentElement.style.setProperty('--serif',font),font);
   await settings();await page.locator('#pr-fontsize').selectOption(size);await page.locator('#pr-lineheight').selectOption(height);await page.locator('#pr-linenum').uncheck();await close();
   const prefix=path.join(evidence,`${width}-${label}`),off=prefix+'-off.pdf',on=prefix+'-on.pdf';let previous;
   if(baseline) {
    const style=await page.addStyleTag({content:'@media print {@page {margin:15mm 18mm;} #print-area.print-out {page:auto;margin-left:0;margin-right:0;}}'});previous=prefix+'-main-off.pdf';await printPdf(previous);await style.evaluate(n=>n.remove());
   }
   await printPdf(off);await settings();await page.locator('#pr-linenum').check();
   await page.waitForFunction(()=>document.querySelectorAll('#print-preview .print-linenum').length>0);await printPdf(on,true);await close();
   const report=JSON.parse(execFileSync('python3',[path.join(__dirname,'verify-print-lines-pdf.py'),off,on,...(previous?[previous]:[])],{encoding:'utf8'}));
   if(size==='md'&&height==='3')assert.ok(report.number_pages.length>=2,'Long passage crosses pages');
   console.log(`PASS ${width}px ${label}:`,report);
   return {off,on};
  }
  const combinations=width===1280?[['xs','1','Times New Roman, serif'],['sm','2','Arial, sans-serif'],['md','3','Times New Roman, serif'],['lg','4','Georgia, serif'],['xl','5','Arial, sans-serif']]:[['xs','1','Times New Roman, serif'],['md','3','Times New Roman, serif'],['xl','5','Arial, sans-serif']];
  for(const [size,height,font] of combinations)await checkCase('single-'+size,size,height,font,size==='md');
  // Switching out of the named print-tab page must retain legacy modal printing.
  await page.evaluate(text=>{document.getElementById('exam-modal-title').textContent='Synthetic legacy print';document.getElementById('exam-modal-body').innerHTML='<section class="exam-section"><div class="exam-field" data-sectype="本文"><div class="exam-doc">'+Markup.render(text).html+'</div></div></section>';window.__lineTest.printExam();},passage(11,'a',900));
  assert.equal(await page.locator('#print-area').evaluate(n=>n.classList.contains('print-out')),false);
  const legacy=path.join(evidence,`${width}-legacy.pdf`);await page.emulateMedia({media:'print'});await page.pdf({path:legacy,format:'A4',printBackground:true});
  const legacyStyle=await page.addStyleTag({content:'@media print {@page {margin:15mm 18mm;size:A4} #print-area {page:auto;margin-left:0;margin-right:0;width:auto;}}'});
  const oldLegacy=path.join(evidence,`${width}-legacy-main.pdf`);await page.pdf({path:oldLegacy,format:'A4',printBackground:true});await legacyStyle.evaluate(n=>n.remove());await page.emulateMedia({media:'screen'});
  execFileSync('python3',['-c',"import runpy,sys;d=runpy.run_path(sys.argv[3],run_name='pdf_helpers');d['compare'](d['inspect'](sys.argv[1],False),d['inspect'](sys.argv[2],False))",legacy,oldLegacy,path.join(__dirname,'verify-print-lines-pdf.py')],{encoding:'utf8'});
  console.log(`PASS ${width}px legacy print and named-page switching preserve original PDF geometry`);
  await page.locator('#pr-multi').check();await page.locator('.tree-row-uni').filter({hasText:'合成大学'}).click();await page.locator('.tree-row-year').filter({hasText:'2026年度'}).click();
  for(const id of [11,21])await page.locator(`[data-multi-exam="${id}"]`).check();await ready('printSet');
  await checkCase('multi','md','3','Times New Roman, serif');await page.locator('#pr-set-manage').click();
  assert.deepEqual(await page.locator('#pr-multi-selection li > span').allTextContents(),['2021 大阪医科薬科 前期','2026 合成大学']);await close();
  await page.locator('#pr-multi').uncheck();await page.locator('.tree-row-fav').click();await page.locator('[data-favfolder="1"]').click();await ready('favFolder');
  await checkCase('favorite','md','3','Times New Roman, serif');
  if(width===1280) {
   // The existing readiness guard must await both a real delayed font and image.
   holdFont=true;await page.addStyleTag({content:`@font-face{font-family:FixtureDelay;src:url('${origin}/fixture-font.ttf')} :root{--serif:FixtureDelay,serif}`});
   await page.evaluate(()=>{document.fonts.load('16px FixtureDelay');});await waitFlag(()=>fontHeld);let old=await page.evaluate(()=>window.__prints);
   await page.locator('#btn-print-run').click();await pause(100);assert.equal(await page.evaluate(()=>window.__prints),old,'Font load must finish before print');holdFont=false;releaseFont();await page.waitForFunction(old=>window.__prints===old+1,old);await page.waitForFunction(()=>!window.__lineTest.isPreparing());
   holdImage=true;await page.evaluate(origin=>{window.__lineTest.state.printExam.questions[0].problem_text+=`\n![Synthetic diagram](${origin}/fixture-image.svg)`;window.__lineTest.renderPrintPreview();},origin);await waitFlag(()=>imageHeld);old=await page.evaluate(()=>window.__prints);
   await page.locator('#btn-print-run').click();await pause(100);assert.equal(await page.evaluate(()=>window.__prints),old,'Image decode must finish before print');holdImage=false;releaseImage();await page.waitForFunction(old=>window.__prints===old+1,old);await page.waitForFunction(()=>!window.__lineTest.isPreparing());
   const stable=await checkCase('delayed-font-image','md','3','FixtureDelay,serif');await printPdf(path.join(evidence,'1280-reprint.pdf'));execFileSync('python3',[path.join(__dirname,'verify-print-lines-pdf.py'),stable.off,path.join(evidence,'1280-reprint.pdf')],{encoding:'utf8'});
  }
  assert.deepEqual(errors,[]);await context.close();
 }}finally {clearTimeout(deadline);await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
