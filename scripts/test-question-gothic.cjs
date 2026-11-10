// Synthetic data only. Question typography does not change stored identifiers.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const context={document:{addEventListener(){}},Difficulty:{BAND_LABEL:{}},UI:{el:()=>null,escapeHtml:String},localStorage:{getItem(){return null},setItem(){}}};
context.window=context;vm.createContext(context);
for(const name of ['store','markup'])vm.runInContext(read('assets/js/'+name+'.js'),context);
vm.runInContext(read('assets/js/viewer.js').replace('document.addEventListener("DOMContentLoaded", init);','window.typography={renumberPrintSections,renderOptimizedAnswers};'),context);
const M=context.Markup,api=context.typography;
const cases={'1':'１','９':'９','10':'10','01':'01','０１':'01','１２':'12','1２':'12','１２3':'123','1234':'1234','問1':'問１','問１２':'問12','A1':'A１','1A':'１A','(1)':'(１)','1-2':'１-２','1.5':'1.5','１．５':'１．５','1,000':'1,000','a':'a','設問':'設問'};
for(const [input,expected] of Object.entries(cases))for(const level of [1,2,3]){
 const tag='{'.repeat(level+1)+input+'}'.repeat(level+1);
 for(const text of [tag+' Heading','See '+tag+' here.','**'+tag+'**','| Label |\n| --- |\n| '+tag+' |']){
  const html=M.render(text).html;
  assert.ok(html.includes('>'+expected+'</span>'),text);
  assert.ok(html.includes('class="question-badge'+(level>1?' question-level-'+level:'')+'"'),text);
 }
 assert.equal(M.questionBadge({label:input,level}),M.questionBadge({label:expected,level}),'display idempotence');
}
assert.match(M.questionBadge({label:'<1>&',level:1}),/&lt;１&gt;&amp;/,'labels remain escaped');
assert.match(M.render('[[1]] ((1)) (1) 1').html,/blank-badge">1<\/span>/);
assert.match(M.render('[[1]] ((1)) (1) 1').html,/>①<\/span>/);
assert.match(M.render('(1)').html,/marker-label">1<\/span>/);
for(const text of ['{{1}}((a)) {{12}}((b))','{{１}}((a)) {{12}}((b))']){
 const html=api.renderOptimizedAnswers(text,{});
 assert.equal((html.match(/class="print-answer-item"/g)||[]).length,2);
 assert.match(html,/question-badge">１<\/span>/);assert.match(html,/question-badge">12<\/span>/);
}
assert.match(api.renderOptimizedAnswers('[[1]]((a)) [[2]]((b))',{}),/blank-badge">1<\/span>/);
const sections=[{type:'設問',text:'{{問7}} Parent\n{{{(4)}}} Child\n{{{{1}}}} Grand\n{{問8}} Next'}, {type:'解答',text:'{{問7}} ((2))\n{{問8}} ((1))'}];
const before=JSON.stringify(sections),renumbered=api.renumberPrintSections(sections);
assert.equal(JSON.stringify(sections),before);assert.match(renumbered[0].text,/\{\{問1\}\}/);assert.match(renumbered[1].text,/\{\{問1\}\} \(\(2\)\)/);
assert.match(M.render(renumbered[0].text).html,/question-badge">問１<\/span>/);
assert.match(M.render(renumbered[1].text).html,/question-badge">問１<\/span>/);
assert.equal(M.parseSections('{{設問}}\n{{問1}} x')[0].text,'{{問1}} x');
const css=read('assets/css/main.css');assert.match(css,/font-family: "BIZ UDGothic"/);assert.match(css,/font-variant-numeric: tabular-nums/);
assert.match(css,/\.question-badge \{[^}]*margin: 0;/);
assert.match(css,/\.question-block-header > \.question-badge \{ margin-right: 1em; \}/);
for(const file of ['index.html','setting/index.html','panel/index.html'])assert.match(read(file),/family=BIZ\+UDGothic:wght@700/);
assert.match(read('worker/mcp.ts'),/resourceDomains: \[baseUrl\(url\), "https:\/\/fonts.googleapis.com", "https:\/\/fonts.gstatic.com"\]/);
console.log('PASS: Gothic loading/fallback declarations, all hierarchy levels, digit-run boundaries, optimized answers, unchanged blanks/choices, renumber identities and source');
if(process.argv.includes('--browser'))(async()=>{
 const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'../panel/node_modules/playwright');
 let font;
 if(process.env.QUESTION_GOTHIC_FONT)font=fs.readFileSync(process.env.QUESTION_GOTHIC_FONT);
 else {const response=await fetch('https://raw.githubusercontent.com/google/fonts/main/ofl/bizudgothic/BIZUDGothic-Bold.ttf');assert.ok(response.ok,'official font download');font=Buffer.from(await response.arrayBuffer());}
 const browser=await chromium.launch({headless:true,...(process.env.PANEL_CHROMIUM?{executablePath:process.env.PANEL_CHROMIUM}:{})});
 try{for(const width of [1280,390])for(const loaded of [false,true]){
  const page=await browser.newPage({viewport:{width,height:1000}});
  await page.route('**/*',r=>r.request().url()==='https://font.test/biz.ttf'&&loaded?r.fulfill({status:200,contentType:'font/ttf',body:font}):r.abort());
  const face=loaded?'@font-face{font-family:"BIZ UDGothic";font-weight:700;src:url("https://font.test/biz.ttf") format("truetype");font-display:swap;}':'';
  const text='{{1}} Parent\n{{{12}}} Child\n{{{{123}}}} Grandchild\n{{問1}} Mixed\n{{１２}} Fullwidth source';
  await page.setContent('<style>'+css+face+'</style><div id="print-area" class="exam-doc print-out" style="display:block;font-size:20px;width:calc(100% - 40px);margin:20px">'+M.render(text).html+'</div>');
  await page.evaluate(()=>document.fonts.ready);
  if(loaded)assert.equal(await page.evaluate(()=>document.fonts.check('700 20px "BIZ UDGothic"','１123問')),true);
  for(const media of ['screen','print']){
   await page.emulateMedia({media});
   const result=await page.evaluate(()=>[...document.querySelectorAll('.question-badge')].map(e=>{const s=getComputedStyle(e);return {text:e.textContent,width:e.getBoundingClientRect().width,size:parseFloat(s.fontSize),weight:s.fontWeight,family:s.fontFamily,gap:parseFloat(s.marginRight)};}));
   assert.deepEqual(result.map(x=>x.text),['１','12','123','問１','12']);
   for(const label of result){assert.equal(label.weight,'700');assert.equal(label.size,20);assert.equal(label.gap,20);assert.match(label.family,/BIZ UDGothic/);assert.ok(label.width>0);}
   if(loaded){assert.ok(Math.abs(result[0].width-result[1].width)<.1);assert.ok(Math.abs(result[2].width-result[0].width*1.5)<.1);assert.ok(Math.abs(result[3].width-result[0].width*2)<.1);}
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  await page.emulateMedia({media:'screen'});await page.screenshot({path:'/tmp/exam-question-gothic-'+width+'-'+loaded+'.png',fullPage:true});
  if(loaded){
   await page.emulateMedia({media:'print'});
   const pdf='/tmp/exam-question-gothic-'+width+'.pdf';await page.pdf({path:pdf,format:'A4',printBackground:true});
   const info=require('node:child_process').execFileSync('pdfinfo',[pdf],{encoding:'utf8'});assert.match(info,/Pages:\s+1\s*\n/,'Short fixture has no trailing blank sheet');
   const extracted=require('node:child_process').execFileSync('pdftotext',[pdf,'-'],{encoding:'utf8'});
   for(const label of ['Parent','Child','Grandchild','Mixed','Fullwidth source'])assert.ok(extracted.includes(label),'Real print content: '+label);
  }
  // Reproduce merged lead references while preserving only leading-heading gaps.
  const lead=M.mergeLeadSections([{type:'リード文',text:'次の英文を読み、{{問1}}-{{問6}}は文を完成させ、{{問7}}-{{問9}}は問いに答えなさい。{{問10}}は指示に従って答えなさい。'},{type:'本文',text:'Body.'}])[0].text;
  const headings='{{問1}} Parent refers to {{問2}}.\n{{{(1)}}} Child refers to {{{(2)}}}.\n{{{{a}}}} Grandchild refers to {{{{b}}}}.';
  const inline='本文中の{{問1}}、{{{(1)}}}、{{{{a}}}}を参照。';
  const answers=api.renderOptimizedAnswers('{{1}}((a)) {{2}}((b))',{});
  const fixture='<section id="lead">'+M.render(lead).html+'</section><section id="headings">'+M.render(headings).html+'</section><section id="inline">'+M.render(inline).html+'</section><section id="answers">'+answers+'</section>';
  await page.setContent('<style>'+css+read('assets/css/print-choices.css')+face+'</style><main id="print-area" class="exam-doc print-out" style="display:block;font-size:20px;width:calc(100% - 40px);margin:20px">'+fixture+'</main>');
  await page.evaluate(()=>document.fonts.ready);
  for(const media of ['screen','print']){
   await page.emulateMedia({media});
   const spacing=await page.evaluate(()=>{
    const measure=selector=>[...document.querySelectorAll(selector)].map(e=>{const s=getComputedStyle(e);return {gap:parseFloat(s.marginRight),size:parseFloat(s.fontSize),left:e.getBoundingClientRect().left}});
    return {lead:measure('#lead .lead-line .question-badge'),inline:measure('#inline .question-badge'),nested:measure('#headings .qtext .question-badge'),headings:measure('#headings .question-block-header > .question-badge'),answers:measure('#answers .print-answer-item > .question-badge'),overflow:document.documentElement.scrollWidth>innerWidth};
   });
   assert.equal(spacing.lead.length,5);assert.equal(spacing.inline.length,3);assert.equal(spacing.nested.length,3);assert.equal(spacing.headings.length,3);assert.equal(spacing.answers.length,2);
   for(const label of [...spacing.lead,...spacing.inline,...spacing.nested])assert.equal(label.gap,0,'Inline label has no added gap');
   for(const label of [...spacing.headings,...spacing.answers])assert.equal(label.gap,label.size,'Leading label retains one-em gap');
   assert.ok(Math.abs(spacing.headings[1].left-spacing.headings[0].left-20)<.1);assert.ok(Math.abs(spacing.headings[2].left-spacing.headings[1].left-20)<.1);
   assert.equal(spacing.overflow,false);
  }
  await page.emulateMedia({media:'screen'});await page.screenshot({path:'/tmp/exam-question-gothic-spacing-'+width+'-'+loaded+'.png',fullPage:true});
  if(loaded){await page.emulateMedia({media:'print'});await page.pdf({path:'/tmp/exam-question-gothic-spacing-'+width+'.pdf',format:'A4',printBackground:true});}
  await page.close();
 }console.log('PASS: actual BIZ font 2:1 metrics, 700 weight, fallback, desktop/mobile screen/print, screenshots and PDFs');}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
