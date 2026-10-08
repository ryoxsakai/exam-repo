const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'../panel/node_modules/playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.PANEL_CHROMIUM?{executablePath:process.env.PANEL_CHROMIUM}:{})});
 try{
 const page=await browser.newPage({viewport:{width:1000,height:900}});
 page.on('pageerror', e=>console.error('PAGE ERROR',e));
 await page.route('**/*',r=>r.abort());
 await page.setContent('<style>'+fs.readFileSync(root+'/assets/css/main-20261008double.css','utf8')+'\n'+fs.readFileSync(root+'/assets/css/print-choices.css','utf8')+'</style><div id="print-preview"></div>');
 await page.evaluate(()=>{window.UI={el:id=>document.getElementById(id),escapeHtml:s=>s,$all:(q,r=document)=>Array.from(r.querySelectorAll(q))};window.Store={getPrintFontSize:()=> 'md',getFavCollapsed:()=>({})};});
 await page.addScriptTag({content:fs.readFileSync(root+'/assets/js/markup-20261008double.js','utf8')});
 await page.addScriptTag({content:fs.readFileSync(root+'/assets/js/difficulty.js','utf8')});
 await page.addScriptTag({content:fs.readFileSync(root+'/assets/js/viewer.js','utf8').replace('document.addEventListener("DOMContentLoaded", init);','window.testChoices={optimizePrintChoices,printField};')});
 const result=await page.evaluate(()=>{
  const short=['after','her','him','I','not','to','told'];
  const texts=[short.slice(0,4),short,Array(4).fill('This is a long sentence with a substantial amount of detail that should occupy its own line in the printed question.'),['are','communities','members','most','of']];
  const text=texts.map((x,i)=>'{{問'+(i+1)+'}} Test\n\n'+x.map((t,j)=>'(('+ (j+1)+')) '+t).join('\n\n')).join('\n\n');
  const p=document.getElementById('print-preview');
  const original=testChoices.printField('問題',text,{optimizeChoices:false});
  const optimized=testChoices.printField('問題',text,{optimizeChoices:true});
  p.innerHTML='<div class="print-doc fs-md lh-3"><div class="print-part-q">'+optimized+'</div><div class="print-part-a">'+original+'</div></div>';
  testChoices.optimizePrintChoices(p);
  const groups=[...p.querySelectorAll('.print-choice-group')];
  const x=[...groups[1].children].map(c=>c.getBoundingClientRect().left);
  const columns=groups.map(g=>g.dataset.columns);
  const inner=groups[1].innerHTML; testChoices.optimizePrintChoices(p);
  const idempotent=inner===groups[1].innerHTML;
  const answerUntouched=p.querySelector('.print-part-a').innerHTML===original;
  const number=p.querySelectorAll('.print-choice-group .answer-choice').length;
  const noSpacers=groups.every(g=>g.children.length===g.querySelectorAll(':scope > .answer-choice').length);
  testChoices.optimizePrintChoices(p,true);
  const printColumns=groups.map(g=>g.dataset.columns);
  return {columns,x,idempotent,answerUntouched,number,noSpacers,printColumns,sourceUnchanged:text===texts.map((x,i)=>'{{問'+(i+1)+'}} Test\n\n'+x.map((t,j)=>'(('+ (j+1)+')) '+t).join('\n\n')).join('\n\n')};
 });
 assert.deepEqual(result.columns,['4','3','1','3']);assert.deepEqual(result.printColumns,['4','3','1','3']);
 for(const [a,b] of [[0,3],[1,4],[2,5],[0,6]])assert.ok(Math.abs(result.x[a]-result.x[b])<1);
 for(const key of ['idempotent','answerUntouched','noSpacers','sourceUnchanged'])assert.equal(result[key],true,key);
 assert.equal(result.number,20);
 await page.emulateMedia({media:'print'});
 await page.pdf({path:process.env.PRINT_CHOICES_PDF || '/tmp/print-choices-preview.pdf',format:'A4'});
 console.log('PASS: 4 across, 7 in aligned 3 columns, 5 in two rows, long choices vertical, gaps removed, answers/source preserved, idempotence, print widths');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
