// Synthetic, read-only typography QA. No production data or account writes.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {chromium}=require('../panel/node_modules/playwright');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const baselineRef='5eab0f1';
const oldCss=execFileSync('git',['show',baselineRef+':assets/css/main.css'],{cwd:root,encoding:'utf8'}),css=read('assets/css/main.css');
const parser=source=>{const context={window:{}};vm.runInNewContext(source,context);return context.window.Markup;};
const M=parser(read('assets/js/markup.js')),oldM=parser(execFileSync('git',['show',baselineRef+':assets/js/markup.js'],{cwd:root,encoding:'utf8'}));
for(const file of ['index.html','setting/index.html']){
 const html=read(file);for(const [pattern,canonical] of [[/href="([^"?]*\/main[^"?]*\.css)/,'assets/css/main.css'],[/src="([^"?]*\/markup[^"?]*\.js)/,'assets/js/markup.js']]){
  assert.equal(fs.readFileSync(path.resolve(root,path.dirname(file),html.match(pattern)[1]),'utf8'),read(canonical));
 }
}
const labels=['1','i','a','A','W','あ','ア'];
const markers=labels.flatMap(label=>['('+label+')','（'+label+'）']);
const source=markers.map(marker=>marker+' ordinary reference').join('\n\n')+'\n\n'+['__','==','~~'].map(style=>'(A)'+style+'Underlined text'+style+' and '+style+'(a)'+style).join('\n\n')+'\n\n**(A)** bold\n\n| Label | Text |\n| --- | --- |\n| (ア) | Table |';
const unaffected='{{(A)}} Question\n{{{(a)}}} Child\n{{{{(1)}}}} Grand\n[[(A)]] [[((A))]] [A] ((A))\n\n(12) (WW) （アイ） <1> <<12>> 〈1〉 《12》\n\n(word) (123) `code (A)` https://example.test/(A)';
assert.equal(M.render(unaffected).html,oldM.render(unaffected).html,'Question/blank/paragraph/choice tags, longer labels, angles and literals are untouched');
assert.equal(M.strip(source),oldM.strip(source),'Plain-text extraction is unchanged');
const original=JSON.stringify({source,unaffected});
for(const type of ['リード文','本文','設問','解答','全訳','解説']){
 const section=M.parseSections('{{'+type+'}}\n(A)')[0];assert.match(M.render(section.text).html,/marker-parentheses-fit/);
}
assert.doesNotMatch(M.render(unaffected).html,/marker-parentheses-fit/);
assert.equal((M.render(source).html.match(/marker-parentheses-fit/g)||[]).length,markers.length+8);
console.log('PASS: only single-character round labels fit; all sections, source extraction and independent notation preserved');
if(process.argv.includes('--unit'))process.exit(0);
const evidence=process.env.MARKER_EVIDENCE||'/tmp/exam-marker-width';fs.mkdirSync(evidence,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.PANEL_CHROMIUM?{executablePath:process.env.PANEL_CHROMIUM}:{})});
 const reports=[];
 try{for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:1000}});await page.route('**/*',r=>r.abort());
  const content=(sheet,markup)=>`<style id="sheet">${sheet}</style><div id="print-area" class="exam-doc print-out" style="display:block;width:calc(100% - 40px);max-width:660px;margin:20px"><div id="labels">${markup.render(source).html}</div><div id="unrelated">${markup.render(unaffected).html}</div><div id="baseline">${markup.render('(A)').html}<span id="baseline-probe" style="display:inline-block;width:0;height:0;vertical-align:baseline"></span></div></div>`;
  for(const media of ['screen','print'])for(const font of ['', 'serif', 'sans-serif']){
   await page.emulateMedia({media});await page.setContent(content(oldCss,oldM));if(font)await page.locator('#print-area').evaluate((n,f)=>n.style.fontFamily=f,font);
   const old=await page.locator('#unrelated').evaluate(n=>({html:n.innerHTML,boxes:[...n.querySelectorAll('.question-badge,.blank-badge,.para-badge,.choice-inline,.marker-angle,.marker-parentheses')].map(x=>({text:x.textContent,width:x.getBoundingClientRect().width,height:x.getBoundingClientRect().height,font:getComputedStyle(x).fontFamily,size:getComputedStyle(x).fontSize}))}));
   await page.setContent(content(css,M));if(font)await page.locator('#print-area').evaluate((n,f)=>n.style.fontFamily=f,font);await page.evaluate(()=>document.fonts.ready);
   const current=await page.locator('#unrelated').evaluate(n=>({html:n.innerHTML,boxes:[...n.querySelectorAll('.question-badge,.blank-badge,.para-badge,.choice-inline,.marker-angle,.marker-parentheses')].map(x=>({text:x.textContent,width:x.getBoundingClientRect().width,height:x.getBoundingClientRect().height,font:getComputedStyle(x).fontFamily,size:getComputedStyle(x).fontSize}))}));
   assert.deepEqual(current,old,'Unaffected tags, two-character and angle geometry remain identical');
   const geometry=await page.evaluate(()=>({
    markers:[...document.querySelectorAll('#labels .marker-parentheses-fit')].map(n=>{
     const text=n.querySelector('text'),box=n.getBoundingClientRect(),glyph=text.getBoundingClientRect(),font=parseFloat(getComputedStyle(n).fontSize);
     const clone=text.cloneNode(true);clone.removeAttribute('textLength');text.parentElement.appendChild(clone);const natural=clone.getBoundingClientRect();clone.remove();
     const range=document.createRange();range.selectNodeContents(n);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);const selected=selection.toString();selection.removeAllRanges();
     return {text:n.textContent,label:n.querySelector('svg').getAttribute('aria-label'),selected,width:box.width,font,glyphWidth:glyph.width,glyphHeight:glyph.height,naturalHeight:natural.height,svgWidth:n.querySelector('svg').getBoundingClientRect().width};
    }),
    baseline:(()=>{const n=document.querySelector('#baseline .marker-parentheses-fit'),text=n.querySelector('text'),point=text.getStartPositionOfChar(0),position=new DOMPoint(point.x,point.y).matrixTransform(text.getScreenCTM());return {actual:position.y,expected:document.querySelector('#baseline-probe').getBoundingClientRect().top};})(),
    overflow:document.documentElement.scrollWidth>innerWidth
   }));
   geometry.markers.forEach(n=>{assert.ok(Math.abs(n.width-n.font)<.05,JSON.stringify(n));assert.ok(Math.abs(n.svgWidth-n.font)<.05);assert.ok(n.glyphWidth<=n.font+1,JSON.stringify(n));assert.ok(Math.abs(n.glyphHeight-n.naturalHeight)<.05,'Fitting never shrinks glyph height');assert.equal(n.label,n.text);assert.equal(n.selected,n.text,'Selection preserves original text');});
   assert.ok(Math.abs(geometry.baseline.actual-geometry.baseline.expected)<.1,'SVG alphabetic baseline stays at the normal text baseline');
   if(media==='screen')assert.equal(geometry.overflow,false);
   reports.push({width,media,font,geometry});
   if(!font){await page.screenshot({path:path.join(evidence,`after-${width}-${media}.png`),fullPage:true});if(media==='print'){
     const file=path.join(evidence,`after-${width}.pdf`);await page.pdf({path:file,format:'A4',printBackground:true});const extracted=execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8'}).replace(/\s/g,'');for(const token of ['(A)','(a)','(あ)','(ア)','（A）','（ア）'])assert.ok(extracted.includes(token),'PDF retains '+token);
    }}
  }
  await page.close();
 }
 assert.equal(JSON.stringify({source,unaffected}),original);fs.writeFileSync(path.join(evidence,'geometry.json'),JSON.stringify(reports,null,2));
 console.log('PASS: exact1em, normal glyph height/baseline, no overflow, original selection/PDF text, default/serif/sans, desktop/mobile screen/print');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
