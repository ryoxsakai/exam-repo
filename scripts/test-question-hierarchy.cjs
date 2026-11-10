const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const browser = { document: { addEventListener(){} }, Difficulty: { BAND_LABEL: {} }, UI: { el: () => null, escapeHtml: String }, localStorage: {getItem(){return null;},setItem(){}} };
browser.window = browser; vm.createContext(browser);
for (const file of ['store','markup']) vm.runInContext(read('assets/js/'+file+'.js'), browser);
vm.runInContext(read('assets/js/viewer.js').replace('document.addEventListener("DOMContentLoaded", init);','window.hierarchyTest={renumberPrintSections,buildPrintHtml,renderOptimizedAnswers,optimizePrintChoices};'), browser);
const M=browser.Markup, api=browser.hierarchyTest;
const text='{{問7}} Parent instruction\n{{{(4)}}} Child instruction\n((1)) First choice\n((2)) Second choice\n{{{{(a)}}}} Grandchild instruction\n（（１）） Grandchild first\n((2)) Grandchild second\nGrandchild body.\n{{{(6)}}} Second child\n| A | B |\n| --- | --- |\n| One | Two |\n{{問8}} Next parent';
const result=M.render(text);
assert.equal((result.html.match(/class="question-subgroup question-subgroup-level-2"/g)||[]).length,2);
assert.equal((result.html.match(/class="question-subgroup question-subgroup-level-3"/g)||[]).length,1);
assert.match(result.html, /<\/div><\/div><div class="question-block-header"><span class="question-badge">問８/);
assert.match(result.html,/question-badge question-level-2">\(４\)/);
assert.match(result.html,/question-badge question-level-3">\(ａ\)/);
assert.equal(M.render(text).html,result.html);
assert.equal(M.strip('{{問1}} Parent {{{(1)}}} Child {{{{a}}}} Grand').trim(),'Parent   Child   Grand');
for(const bad of ['{{{a}}','{{a}}}','{{{{{a}}}}}','{{a{b}}','{{{a}}}}']) assert.doesNotMatch(M.render(bad).html,/question-badge/,bad);
const inline=M.render('See {{{(4)}}} and {{{{(a)}}}}.');
assert.doesNotMatch(inline.html,/question-subgroup/);
assert.match(inline.html,/question-level-2/);assert.match(inline.html,/question-level-3/);
const notes=M.render('{{{(1)}}} ##word::語##\n{{{{a}}}} More');
assert.match(notes.html,/<\/div><\/div><div class="footnote-section">/);
assert.match(M.render('{{{(1)}}} Child\n----\nAfter').html,/<\/div><hr class="exam-hr"><span class="blk/);
assert.match(M.render('{{{{a}}}} No ancestors').html,/question-subgroup-level-3/);
for(const sample of ['{{{1}}} (a) first\n(b) second','{{{{a}}}} "First"\n"Second"']) {
 const html=M.render(sample).html; assert.match(html,/question-level-[23]/);assert.match(html,/sentence-pair|quoted-dialogue/);
}
const source='{{設問}}\n'+text+'\n{{解答}}\n{{問7}}\n{{{(4)}}} ((2))\n{{{{(a)}}}} A\n{{{(6)}}} B\n{{問8}} C\n{{全訳}}\n《題》\n本文';
const sections=M.parseSections(source);
assert.deepEqual(Array.from(sections,s=>s.type),['設問','解答','全訳']);
assert.equal(M.parseSections('{{設問}}\n{{{設問}}}\n{{{{本文}}}}')[0].text,'{{{設問}}}\n{{{{本文}}}}');
assert.equal(M.extractZenyakuTitle(source),'題');
const before=JSON.stringify(sections),renumbered=api.renumberPrintSections(sections);
assert.equal(JSON.stringify(sections),before);
assert.match(renumbered[0].text,/{{問1}} Parent/);assert.match(renumbered[0].text,/{{問2}} Next parent/);
assert.match(renumbered[0].text,/\{\{\{\(4\)\}\}\}/);assert.match(renumbered[1].text,/\{\{\{\(4\)\}\}\} \(\(2\)\)/);
assert.match(renumbered[1].text,/\{\{\{\{\(a\)\}\}\}\} A/);
// Nested numerical/named labels cannot allocate or inherit a parent's number map.
const protectedLabels=api.renumberPrintSections([{type:'設問',text:'{{問7}} Parent\n{{{問7}}} Child\n{{{{7}}}} Grand\n{{問8}} Parent2'}, {type:'解答',text:'{{問7}} {{{問7}}} {{{{7}}}}\n{{問8}} A'}]);
assert.equal(protectedLabels[1].text,'{{問1}} {{{問7}}} {{{{7}}}}\n{{問2}} A');
assert.match(api.renderOptimizedAnswers(sections[1].text,{}),/question-subgroup-level-3/);
const fixture={questions:[{question_number:1,problem_text:source}]};
const printed=api.buildPrintHtml(fixture,{renumber:true,optimizeAnswers:true,optimizeChoices:true});
assert.match(printed,/question-subgroup-level-3/);assert.doesNotMatch(printed,/\{\{\{/);
for (const file of ['index.html','setting/index.html']) {
 const html=read(file),asset=html.match(/src="([^"?]*\/markup[^"?]*\.js)/)[1],css=html.match(/href="([^"?]*\/main[^"?]*\.css)/)[1];
 assert.equal(fs.readFileSync(path.resolve(root,path.dirname(file),asset),'utf8'),read('assets/js/markup.js'));
 assert.equal(fs.readFileSync(path.resolve(root,path.dirname(file),css),'utf8'),read('assets/css/main.css'));
}
console.log('PASS: three explicit levels, balanced parsing, scopes, inline references, sections, legacy tags, answer correspondence and non-mutating print numbering');

(async()=>{
 const {build}=require('../panel/node_modules/esbuild');
 const bundle=await build({entryPoints:[path.join(root,'worker/mcp.ts')],bundle:true,write:false,platform:'node',format:'esm'});
 const {cleanPassageText}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
 assert.equal(cleanPassageText('{{問1}} Parent {{{(1)}}} Child {{{{a}}}} Grand').replace(/\s+/g,' ').trim(),'Parent Child Grand');
 console.log('PASS: Worker corpus text removes all hierarchy markers');
 if(!process.argv.includes('--browser'))return;
 const {chromium}=require('../panel/node_modules/playwright');
 const browserInstance=await chromium.launch({headless:true,...(process.env.PANEL_CHROMIUM?{executablePath:process.env.PANEL_CHROMIUM}:{})});
 const evidence='/tmp/exam-question-hierarchy';fs.mkdirSync(evidence,{recursive:true});
 try {
  for(const width of [1280,390]) {
   const page=await browserInstance.newPage({viewport:{width,height:1000}});await page.route('**/*',r=>r.request().url()==='https://hierarchy.test/'?r.fulfill({contentType:'text/html',body:'<!doctype html><html></html>'}):r.abort());await page.goto('https://hierarchy.test/');
   await page.setContent('<style>'+read('assets/css/main.css')+'\n'+read('assets/css/print-choices.css')+'</style><div id="print-area" class="print-out fs-md" style="display:block;width:calc(100% - 40px);margin:20px"><div class="print-part-q"><div class="exam-doc">'+result.html+'</div></div></div>');
   await page.addScriptTag({content:read('assets/js/store.js')});
   await page.addScriptTag({content:'window.Difficulty={BAND_LABEL:{}};window.UI={el:()=>null,$all:(s,r)=>(r||document).querySelectorAll(s),escapeHtml:String};'});
   await page.addScriptTag({content:read('assets/js/viewer.js').replace('document.addEventListener("DOMContentLoaded", init);','window.hierarchyTest={optimizePrintChoices};')});
   for(const media of ['screen','print']) {
    await page.emulateMedia({media});
    await page.evaluate(forPrint=>window.hierarchyTest.optimizePrintChoices(document.querySelector('#print-area'),forPrint),media==='print');
    await page.screenshot({path:path.join(evidence,width+'-'+media+'.png'),fullPage:true});
    assert.equal(await page.locator('.print-choice-group').count(),2);
    assert.equal(await page.locator('.question-subgroup-level-3 > .print-choice-group .answer-choice').count(),2);
    assert.equal(await page.locator('.question-subgroup-level-2 > .print-choice-group .answer-choice').count(),2);
    const geometry=await page.evaluate(()=>{
     const parent=document.querySelector('.question-block-header:not(.question-level-2):not(.question-level-3)');
     const child=document.querySelector('.question-block-header.question-level-2'),grand=document.querySelector('.question-block-header.question-level-3');
     return {left:[parent,child,grand].map(e=>e.getBoundingClientRect().left),fonts:[parent,child,grand].map(e=>getComputedStyle(e).fontSize), borders:[parent,child,grand].map(e=>getComputedStyle(e.querySelector('.question-badge')).borderTopWidth),over:document.documentElement.scrollWidth>innerWidth};
    });
    assert(geometry.left[0]<geometry.left[1]&&geometry.left[1]<geometry.left[2],JSON.stringify(geometry));
    assert.equal(new Set(geometry.fonts).size,1);
    assert(Math.abs(geometry.left[1]-geometry.left[0]-parseFloat(geometry.fonts[1]))<.1);
    assert(Math.abs(geometry.left[2]-geometry.left[1]-parseFloat(geometry.fonts[2]))<.1);assert(geometry.borders.every(v=>v==='0px'));assert(!geometry.over,JSON.stringify(geometry));
    const grid=await page.locator('.print-choice-group').first().evaluate(el=>({display:getComputedStyle(el).display,columns:el.dataset.columns}));
    assert.equal(grid.display,'flex');assert(Number(grid.columns)>=1);
    if(media==='print') {
     for(const grayscale of [false,true]) {
      await page.locator('#print-area').evaluate((el,on)=>el.classList.toggle('print-grayscale',on),grayscale);
      const styles=await page.evaluate(()=>[...document.querySelectorAll('.question-badge')].slice(0,3).map(el=>({bg:getComputedStyle(el).backgroundColor,image:getComputedStyle(el).backgroundImage,border:getComputedStyle(el).borderTopWidth,weight:getComputedStyle(el).fontWeight,gap:parseFloat(getComputedStyle(el).marginRight),font:parseFloat(getComputedStyle(el).fontSize)})));
      styles.forEach(style=>{assert.equal(style.bg,'rgba(0, 0, 0, 0)');assert.equal(style.image,'none');assert.equal(style.border,'0px');assert.equal(style.weight,'700');assert(Math.abs(style.gap-style.font)<.1);});
     }
     await page.locator('#print-area').evaluate(el=>el.classList.remove('print-grayscale'));
    }
    assert.equal(await page.locator('.question-subgroup-level-3').locator('..').getAttribute('class'),'question-subgroup question-subgroup-level-2');
   }
   await page.emulateMedia({media:'screen'});await page.screenshot({path:path.join(evidence,width+'.png'),fullPage:true});
   await page.pdf({path:path.join(evidence,width+'.pdf'),format:'A4',printBackground:true});
   await page.close();
  }
 } finally {await browserInstance.close();}
 console.log('PASS: desktop/mobile hierarchy layout, nested choice optimization and print geometry; screenshots/PDF saved');
})().catch(e=>{console.error(e);process.exitCode=1});
