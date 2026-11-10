// Synthetic data only. Question typography does not change stored identifiers.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const context={document:{addEventListener(){}},Difficulty:{BAND_LABEL:{}},UI:{el:()=>null,escapeHtml:String},localStorage:{getItem(){return null},setItem(){}}};
context.window=context;vm.createContext(context);
for(const name of ['store','markup'])vm.runInContext(read('assets/js/'+name+'.js'),context);
vm.runInContext(read('assets/js/viewer.js').replace('document.addEventListener("DOMContentLoaded", init);','window.typography={renumberPrintSections,renderOptimizedAnswers};'),context);
const M=context.Markup,api=context.typography;
const cases={'1':'１','９':'９','10':'10','01':'01','０１':'01','１２':'12','1２':'12','１２3':'123','1234':'1234','問1':'問１','問１２':'問12','A1':'Ａ１','1A':'１Ａ','(1)':'(１)','1-2':'１-２','1.5':'1.5','１．５':'１．５','1,000':'1,000','a':'ａ','A':'Ａ','Ａ':'Ａ','Ｂb':'Ｂｂ','Az09':'Ａｚ09','A1.5b':'Ａ1.5ｂ','設問':'設問'};
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
for(const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz') {
 const fullwidth=String.fromCharCode(letter.charCodeAt(0)+0xFEE0);
 assert.equal(M.questionBadge({label:letter,level:1}),M.questionBadge({label:fullwidth,level:1}));
 const tag={label:letter,level:1};M.questionBadge(tag);
 assert.equal(tag.label,letter,'semantic tag label stays ASCII');
 assert.equal(M.parseSections('{{設問}}\n{{'+letter+'}} Example')[0].text,'{{'+letter+'}} Example','source token stays ASCII');
}
const unchanged=M.render('A a [[A]] [[a]] ((A)) ((a)) (A) (a)').html;
assert.match(unchanged,/blank-badge">A<\/span>/);assert.match(unchanged,/blank-badge">a<\/span>/);
assert.match(unchanged,/>Ⓐ<\/span>/);assert.match(unchanged,/>ⓐ<\/span>/);
assert.match(unchanged,/marker-label">A<\/span>/);assert.match(unchanged,/marker-label">a<\/span>/);
assert.doesNotMatch(unchanged,/[Ａａ]/);
const letterSections=[{type:'設問',text:'{{A}} Parent\n{{{B}}} Child\n{{{{a}}}} Grand\n{{B}} Next'}, {type:'解答',text:'{{A}} ((a))\n{{B}} ((b))'}];
const letterBefore=JSON.stringify(letterSections);
assert.equal(JSON.stringify(api.renumberPrintSections(letterSections)),letterBefore);
assert.equal(JSON.stringify(letterSections),letterBefore);
assert.equal(M.parseSections('{{設問}}\n{{A}} x')[0].text,'{{A}} x');
const compactLetters=api.renderOptimizedAnswers('{{A}}((a)) {{B}}((b)) {{c}}((c))',{});
assert.equal((compactLetters.match(/class="print-answer-item"/g)||[]).length,3);
for(const letter of ['Ａ','Ｂ','ｃ'])assert.ok(compactLetters.includes('question-badge">'+letter+'</span>'));
assert.match(api.renderOptimizedAnswers('{{Ａ}} ((a))\n{{Ｂ}} ((b))',{}),/question-badge">Ｂ<\/span>/);

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
const css=read('assets/css/main.css');assert.match(css,/font-family: "Kosugi"/);assert.match(css,/font-variant-numeric: tabular-nums/);assert.match(css,/font-synthesis: weight/);
assert.match(css,/\.question-badge \{[^}]*margin: 0;/);
assert.match(css,/\.question-block-header > \.question-badge \{ margin-right: 1em; \}/);
for(const file of ['index.html','setting/index.html','panel/index.html'])assert.match(read(file),/family=Kosugi(?:&|"|$)/);
assert.match(read('worker/mcp.ts'),/resourceDomains: \[baseUrl\(url\), "https:\/\/fonts.googleapis.com", "https:\/\/fonts.gstatic.com"\]/);
console.log('PASS: Gothic loading/fallback declarations, all hierarchy levels, digit-run boundaries, optimized answers, all ASCII letters display fullwidth, unchanged blanks/choices/parentheses, renumber identities and source');
if(process.argv.includes('--browser'))(async()=>{
 const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'../panel/node_modules/playwright');
 let font;
 if(process.env.QUESTION_GOTHIC_FONT)font=fs.readFileSync(process.env.QUESTION_GOTHIC_FONT);
 else {const response=await fetch('https://raw.githubusercontent.com/google/fonts/main/apache/kosugi/Kosugi-Regular.ttf');assert.ok(response.ok,'official font download');font=Buffer.from(await response.arrayBuffer());}
 assert.equal(require('node:crypto').createHash('sha256').update(font).digest('hex'),'f5e81d6a6b865d9b88c54d2d3c16bcaa3b239dfcefaf2a62976ac9dc7574bab7','verified official Kosugi regular face');
 const panelSource=read('worker/panel-resource.ts');
 const panelHtml=JSON.parse(panelSource.slice(panelSource.indexOf(' = ')+3).trim().replace(/;$/,''));
 const panelCss=panelHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
 assert.match(panelHtml,/family=Kosugi(?:&|"|$)/);
 const browser=await chromium.launch({headless:true,...(process.env.PANEL_CHROMIUM?{executablePath:process.env.PANEL_CHROMIUM}:{})});
 try{for(const [surface,sheet] of [['viewer',css],['panel',panelCss]])for(const width of [1280,390])for(const loaded of [false,true]){
  const page=await browser.newPage({viewport:{width,height:1000}});
  await page.route('**/*',r=>r.request().url()==='https://font.test/kosugi.ttf'&&loaded?r.fulfill({status:200,contentType:'font/ttf',body:font}):r.abort());
  const face=loaded?'@font-face{font-family:"Kosugi";font-weight:400;src:url("https://font.test/kosugi.ttf") format("truetype");font-display:swap;}':'';
  const text='{{1}} Parent\n{{{12}}} Child\n{{{{123}}}} Grandchild\n{{問1}} Mixed\n{{１２}} Fullwidth source\n{{A}} Uppercase\n{{{B}}} Child letter\n{{{{a}}}} Lowercase\n{{Ａ}} Existing fullwidth\n{{A1}} Alphanumeric';
  await page.setContent('<style>'+sheet+face+'</style><div id="print-area" class="exam-doc print-out" style="display:block;font-size:20px;width:calc(100% - 40px);margin:20px">'+M.render(text).html+'</div>');
  await page.evaluate(()=>document.fonts.ready);
  if(loaded)assert.equal(await page.evaluate(()=>document.fonts.check('700 20px "Kosugi"','１123問ＡＢａ')),true);
  for(const media of ['screen','print']){
   await page.emulateMedia({media});
   const result=await page.evaluate(()=>[...document.querySelectorAll('.question-badge')].map(e=>{const s=getComputedStyle(e);return {text:e.textContent,width:e.getBoundingClientRect().width,size:parseFloat(s.fontSize),weight:s.fontWeight,family:s.fontFamily,gap:parseFloat(s.marginRight)};}));
   assert.deepEqual(result.map(x=>x.text),['１','12','123','問１','12','Ａ','Ｂ','ａ','Ａ','Ａ１']);
   for(const label of result){assert.equal(label.weight,'700');assert.equal(label.size,20);assert.equal(label.gap,20);assert.match(label.family,/Kosugi/);assert.ok(label.width>0);}
   if(loaded){assert.ok(Math.abs(result[0].width-result[1].width)<.1);assert.ok(Math.abs(result[2].width-result[0].width*1.5)<.1);assert.ok(Math.abs(result[3].width-result[0].width*2)<.1);for(const i of [5,6,7,8])assert.ok(Math.abs(result[i].width-result[0].width)<.1,'Fullwidth letters are one em');assert.ok(Math.abs(result[9].width-result[0].width*2)<.1);}
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  await page.emulateMedia({media:'screen'});await page.screenshot({path:'/tmp/exam-question-gothic-'+surface+'-'+width+'-'+loaded+'.png',fullPage:true});
  if(loaded){
   await page.emulateMedia({media:'print'});
   const pdf='/tmp/exam-question-gothic-'+surface+'-'+width+'.pdf';await page.pdf({path:pdf,format:'A4',printBackground:true});
   const info=require('node:child_process').execFileSync('pdfinfo',[pdf],{encoding:'utf8'});assert.match(info,/Pages:\s+1\s*\n/,'Short fixture has no trailing blank sheet');
   const extracted=require('node:child_process').execFileSync('pdftotext',[pdf,'-'],{encoding:'utf8'});
   for(const label of ['Parent','Child','Grandchild','Mixed','Fullwidth source','Uppercase','Child letter','Lowercase','Existing fullwidth','Alphanumeric'])assert.ok(extracted.includes(label),'Real print content: '+label);
   for(const letter of ['Ａ','Ｂ','ａ'])assert.ok(extracted.includes(letter),'Selectable fullwidth PDF label: '+letter);
  }
  // Reproduce merged lead references while preserving only leading-heading gaps.
  const lead=M.mergeLeadSections([{type:'リード文',text:'次の英文を読み、{{問1}}-{{問6}}は文を完成させ、{{問7}}-{{問9}}は問いに答えなさい。{{問10}}は指示に従って答えなさい。'},{type:'本文',text:'Body.'}])[0].text;
  const headings='{{問1}} Parent refers to {{問2}}.\n{{{(1)}}} Child refers to {{{(2)}}}.\n{{{{a}}}} Grandchild refers to {{{{b}}}}.';
  const inline='本文中の{{問1}}、{{{(1)}}}、{{{{a}}}}を参照。';
  const answers=api.renderOptimizedAnswers('{{A}}((a)) {{b}}((b))',{});
  const fixture='<section id="lead">'+M.render(lead).html+'</section><section id="headings">'+M.render(headings).html+'</section><section id="inline">'+M.render(inline).html+'</section><section id="answers">'+answers+'</section>';
  await page.setContent('<style>'+sheet+read('assets/css/print-choices.css')+face+'</style><main id="print-area" class="exam-doc print-out" style="display:block;font-size:20px;width:calc(100% - 40px);margin:20px">'+fixture+'</main>');
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
   assert.deepEqual(await page.locator('#answers .question-badge').allTextContents(),['Ａ','ｂ']);
   assert.deepEqual(await page.locator('#inline .question-badge').allTextContents(),['問１','(１)','ａ']);
  }
  await page.emulateMedia({media:'screen'});await page.screenshot({path:'/tmp/exam-question-gothic-spacing-'+surface+'-'+width+'-'+loaded+'.png',fullPage:true});
  if(loaded){await page.emulateMedia({media:'print'});await page.pdf({path:'/tmp/exam-question-gothic-spacing-'+surface+'-'+width+'.pdf',format:'A4',printBackground:true});}
  if(loaded){
   // The @font-face is honestly declared 400. Verify CSS 700 creates painted bold,
   // rather than only changing the computed weight or loading a mislabeled face.
   await page.setContent('<style>'+sheet+face+'</style><main id="print-area" class="exam-doc print-out" style="display:block"><span id="bold-proof" class="question-badge" style="display:block;width:300px;height:80px;font-size:32px;line-height:80px;background:white;color:black">１12ＡＢａｂ問</span></main>');
   await page.evaluate(()=>document.fonts.ready);
   assert.deepEqual(await page.evaluate(()=>[...document.fonts].filter(f=>f.family==='Kosugi').map(f=>f.weight)),['400']);
   const proof=page.locator('#bold-proof');
   for(const media of ['screen','print']){
    await page.emulateMedia({media});
    await proof.evaluate(e=>e.style.fontWeight='400');const regular=await proof.screenshot();
    await proof.evaluate(e=>e.style.fontWeight='700');const bold=await proof.screenshot();
    await proof.evaluate(e=>e.style.fontSynthesis='none');const disabled=await proof.screenshot();
    assert.ok(regular.equals(disabled),'Disabling synthesis restores the regular face');
    assert.ok(!regular.equals(bold),'700 has genuinely different painted strokes');
    await proof.evaluate(e=>e.style.fontSynthesis='weight');
    fs.writeFileSync('/tmp/exam-question-gothic-kosugi-'+surface+'-'+width+'-'+media+'-400.png',regular);
    fs.writeFileSync('/tmp/exam-question-gothic-kosugi-'+surface+'-'+width+'-'+media+'-700.png',bold);
   }
   await page.emulateMedia({media:'print'});
   const boldPdf='/tmp/exam-question-gothic-kosugi-bold-'+surface+'-'+width+'.pdf',regularPdf='/tmp/exam-question-gothic-kosugi-regular-'+surface+'-'+width+'.pdf';
   await page.pdf({path:boldPdf,format:'A4',printBackground:true});
   await proof.evaluate(e=>e.style.fontWeight='400');await page.pdf({path:regularPdf,format:'A4',printBackground:true});
   const raster=file=>{const prefix=file.replace('.pdf','-raster');require('node:child_process').execFileSync('pdftoppm',['-f','1','-singlefile','-scale-to','1200','-png',file,prefix]);return fs.readFileSync(prefix+'.png');};
   assert.ok(!raster(boldPdf).equals(raster(regularPdf)),'Synthetic bold is actually painted in the PDF');
  }
  await page.close();
 }console.log('PASS: actual Kosugi font 2:1 metrics, genuine synthetic 700 screen/PDF raster, fullwidth letter metrics/text/PDF extraction, fallback, desktop/mobile screen/print, screenshots and PDFs');}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
