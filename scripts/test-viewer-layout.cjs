// Synthetic DOM only: no production reads or writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'../panel/node_modules/playwright');
const root=path.resolve(__dirname,'..');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.PANEL_CHROMIUM});try{
const page=await browser.newPage();await page.route('**/*',r=>r.request().url()==='https://fixture.test/figure.svg'?r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="30"><rect width="80" height="30" fill="teal"/></svg>'}):r.abort());
await page.setContent('<style>'+fs.readFileSync(root+'/assets/css/main-20261023markerdecorations.css','utf8')+fs.readFileSync(root+'/assets/css/print-choices.css','utf8')+'</style><button id="exam-fontsize"></button><h1 id="exam-modal-title">Synthetic</h1><div id="print-area"></div><div id="exam-modal-body" style="width:90vw"></div>');
await page.evaluate(()=>{window.UI={el:id=>document.getElementById(id),escapeHtml:s=>s,$all:(q,r=document)=>Array.from(r.querySelectorAll(q))};window.Store={isPrintSection:()=>true,getPrintFontSize:()=> 'xs',getFontSize:()=>'xl',getFavCollapsed:()=>({})};});
for(const file of ['markup.js','difficulty.js','viewer.js'])await page.addScriptTag({content:fs.readFileSync(root+'/assets/js/'+file,'utf8').replace('document.addEventListener("DOMContentLoaded", init);','window.testViewer={renderField,layoutExamModal,watchExamModalLayout,printField,printExam,applyFontSize};')});
const fixture={question:'((1)) one　((2)) two\n\n((3)) three\n\n((4)) four',answer:'{{1}}((a))　{{2}}((b))\n{{3}} '+ 'Long response with preserved meaning. '.repeat(15),commentary:'First paragraph.\n\n\nSecond paragraph.\n\n| Term | Meaning |\n| --- | --- |\n| x | y |\n\n![figure](https://fixture.test/figure.svg)\n\n^^2^^',notes:'Text ##alpha::first## and ##beta::second##.'};
for(const width of [1280,390,768]){await page.setViewportSize({width,height:1000});
await page.evaluate(f=>{const t=testViewer;document.getElementById('exam-modal-body').innerHTML=t.renderField('設問','',f.question)+t.renderField('解答','',f.answer)+t.renderField('解説','',f.commentary)+t.renderField('問題','',f.notes);t.layoutExamModal();t.watchExamModalLayout();},fixture);
await page.waitForTimeout(150);
const result=await page.evaluate(()=>{const r=document.getElementById('exam-modal-body');return {choices:r.querySelectorAll('.print-choice-group > .answer-choice').length,answers:r.querySelectorAll('.print-answer-item').length,spacers:r.querySelector('[data-sectype="解説"]').innerHTML.includes('height:.6em'),table:!!r.querySelector('table'),figure:!!r.querySelector('img')?.naturalWidth,paragraph:r.textContent.includes('Second paragraph.'),footnotes:getComputedStyle(r.querySelector('.footnote-section ol')).display,overflow:[...r.querySelectorAll('.print-choice-group,.print-answer-group')].some(g=>g.scrollWidth>g.clientWidth+2)};});
assert.deepEqual(result,{choices:4,answers:3,spacers:false,table:true,figure:true,paragraph:true,footnotes:'flex',overflow:false});
await page.screenshot({path:'/tmp/exam-viewer-'+width+'.png',fullPage:true});}
await page.setViewportSize({width:390,height:1000});await page.waitForTimeout(150);assert.equal(await page.locator('.print-choice-group').getAttribute('data-columns'),'4');
await page.evaluate(()=>{window.print=()=>{};testViewer.printExam();});
assert.equal(await page.locator('#print-area .print-choice-group').count(),1);
assert.equal(await page.locator('#print-area .print-answer-item').count(),3);
assert.equal(await page.locator('#print-area .footnote-section ol').evaluate(e=>getComputedStyle(e).display),'flex');
// Inline prose references stay inside answer 1, including unpunctuated Japanese.
await page.evaluate(()=>{
 for(const source of ['{{1}} 解答は {{2}} と同じ','{{1}} Same as {{2}} above','[[1]] 解答は [[2]] と同じ']) {
  const d=document.createElement('div');d.innerHTML=testViewer.renderField('解答','',source);
  if(d.querySelectorAll('.print-answer-item').length!==1)throw Error('Reference split: '+source);
 }
 const root=document.getElementById('exam-modal-body');
 root.style.cssText='width:350px;height:180px;overflow:auto';
 root.innerHTML=testViewer.renderField('設問','','((1)) mediumlength\n((2)) mediumlength\n((3)) mediumlength\n((4)) mediumlength');
 testViewer.applyFontSize('xs');
});
await page.waitForTimeout(100);
const small=await page.locator('#exam-modal-body .print-choice-group').getAttribute('data-columns');
await page.evaluate(()=>testViewer.applyFontSize('xl'));
await page.waitForTimeout(100);
const large=await page.locator('#exam-modal-body .print-choice-group').getAttribute('data-columns');
assert.ok(Number(large)<Number(small),'Fixed-size scrolling body must recalculate after font changes');
await page.emulateMedia({media:'print'});await page.pdf({path:'/tmp/exam-viewer-layout.pdf'});
console.log('PASS viewer defaults: choices, mixed answers, commentary, table/figure notation, notes, PC/mobile resize and PDF');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
