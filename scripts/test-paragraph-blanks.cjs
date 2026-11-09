// Read-only synthetic regression tests. No live Exam data or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const ctx = {document:{addEventListener(){}}, Difficulty:{BAND_LABEL:{}}, UI:{el:()=>null,escapeHtml:String}, localStorage:{getItem(){return null},setItem(){}}};
ctx.window=ctx; vm.createContext(ctx);
for (const file of ['store','markup']) vm.runInContext(read('assets/js/'+file+'.js'),ctx);
vm.runInContext(read('assets/js/viewer.js').replace('document.addEventListener("DOMContentLoaded", init);','window.blankTest={renumberPrintSections,buildPrintHtml,renderOptimizedAnswers};'),ctx);
const M=ctx.Markup, api=ctx.blankTest;
for(const [token,label] of [['[[=A=]]','A'],['[[=12=]]','12'],['[[= =]]',' '],['[[==]]',''],['[[=(e)=]]','(e)'],['[[=A&B=]]','A&amp;B']]) {
 const rendered=M.render(token,{paraNum:true}).html;
 assert.equal(rendered,'<span class="blk blank-line"><span class="blank-badge blank-badge-line">'+label+'</span></span>');
 assert.equal(M.render('  @@'+token+' \r').html,rendered);
 assert.equal(M.render(token,{zenyaku:true}).html,rendered);
 assert.equal(M.strip(token).trim(),'');
 assert.equal(M.render('空所 '+token+' に入る段落').html,'<span class="blk">空所 <span class="blank-badge">'+label+'</span> に入る段落</span>');
}
for(const input of ['[13] [[= =]]','@@[13] [[= =]]','[13] @@[[= =]]']) assert.equal(M.render(input,{paraNum:true}).html,'<span class="blk blank-line"><span class="para-badge">13</span><span class="blank-badge blank-badge-line"> </span></span>');
assert.doesNotMatch(M.render('[13] [[----]]').html,/blank-badge-line/);
assert.doesNotMatch(M.render('[ ] [[=A=]]').html,/blank-badge-line/);
// Explicit inner choice labels use the same glyph/fallback rules as choices.
for(const [label,glyph] of [['e','ⓔ'],['E','Ⓔ'],['1','①'],['１２','⑫'],['ア','㋐']]) {
 for(const open of ['((', '（（', '(（', '（(']) for(const close of ['))','））',')）','）)']) {
  const token=open+label+close;
  for(const blank of ['[['+token+']]', '[[--'+token+'--]]', '[[='+token+'=]]']) {
   const html=M.render(blank).html;
   assert.match(html,/choice-inline choice-label-unicode/);
   assert(html.includes('>'+glyph+'</span>'),blank);
   assert.doesNotMatch(html,/class="answer-choice"/);
  }
 }
}
assert.match(M.render('((1)) Choose [[((e))]] here.').html,/class="answer-choice"/);
assert.match(M.render('（（１）） Choose [[（（e））]] here.').html,/class="answer-choice"/);
for(const label of ['あ','51','０１']) assert.match(M.render('[[（（'+label+'））]]').html,/choice-inline choice-label-compact|choice-inline"/);
for(const literal of ['(e)','(((e)))','prefix ((e))','**e**','__e__','((e)) suffix']) assert.equal(M.render('[['+literal+']]').html,'<span class="blk"><span class="blank-badge">'+literal+'</span></span>');
// Explicit circled labels retain their original number, like other choice labels;
// only bare numeric blank identifiers participate in print renumbering.
assert.equal(api.renumberPrintSections([{type:'本文',text:'[[66]] [[((66))]] [[（（６６））]] [[--((66))--]]'}])[0].text,'[[1]] [[((66))]] [[（（６６））]] [[--((66))--]]');
for(const token of ['[[=A]]','[[A=]]','[[==A==]]','[[=A=B=]]']) {
 assert.doesNotMatch(M.render(token).html,/blank-badge-line|blank-line/);
 assert.match(M.render(token).html,/class="blank-badge"/);
}
for(const [token,label,wide] of [['[[A]]','A',false],['[[]]','',false],['[[(e)]]','(e)',false],['[[--A--]]','A',true],['[[---A---]]','A',true],['[[-- --]]',' ',true]]) {
 assert.equal(M.render(token).html,'<span class="blk"><span class="blank-badge'+(wide?' blank-badge-wide':'')+'">'+label+'</span></span>');
}
for(const literal of ['`[[=A=]]`','https://example.test/[[=A=]]','![[[=A=]]](https://example.test/image.png)','[link](https://example.test/[[=A=]])']) assert.doesNotMatch(M.render(literal).html,/blank-badge-line/);
assert.doesNotMatch(M.render('@@**Choose [[=A=]] now.**').html,/blank-badge-line/);
assert.doesNotMatch(M.render('| Blank | Label |\n| --- | --- |\n| [[=A=]] | A |').html,/blank-badge-line/);
assert.match(M.render('==double underline==').html,/double-underline/);
const prose='First paragraph.\n\n[[=A=]]\n\nNext paragraph.\n[[= =]]\nLast paragraph.\n\n[13] [[= =]]';
const rendered=M.render(prose,{paraNum:true}).html;
assert.equal((rendered.match(/blank-badge-line/g)||[]).length,3);
assert.match(rendered,/class="blk indent">Next paragraph/);
assert.match(rendered,/class="blk indent">Last paragraph/);
assert.match(M.render('{{問7}} Parent\n{{{(4)}}} Child\n[[=A=]]\n{{問8}} Next').html,/blank-badge-line">A<\/span><\/span><\/div><div class="question-block-header/);
const sections=[{type:'リード文',text:'[[=66=]]〜[[=70=]] を選ぶ。'},
 {type:'本文',text:'First [[((e))]] and [[（（１２））]] and [[((あ))]].\n\n[[=66=]]\n\nNext.\n\n[[--68--]]\n\n[[70]]'},
 {type:'設問',text:'{{問7}} 空所 [[66]] / [[=68=]] / [[=70=]].'},
 {type:'解答',text:'[[=66=]] A\n[[68]] B\n[[=70=]] C'},
 {type:'解説',text:'[[=66-70=]]: [[=A=]], [[=99=]], [[=66]], [[66=]]'}];
const original=JSON.stringify(sections), renumbered=api.renumberPrintSections(sections);
assert.equal(JSON.stringify(sections),original);
assert.equal(renumbered[0].text,'[[=1=]]〜[[=3=]] を選ぶ。');
assert.match(renumbered[1].text,/\[\[=1=\]\]/);
assert.match(renumbered[1].text,/\[\[--2--\]\]/);
assert.equal(renumbered[2].text,'{{問1}} 空所 [[1]] / [[=2=]] / [[=3=]].');
assert.equal(renumbered[3].text,'[[=1=]] A\n[[2]] B\n[[=3=]] C');
assert.equal(renumbered[4].text,'[[=1-3=]]: [[=A=]], [[=99=]], [[=66]], [[66=]]');
// Endpoints of a reference range cannot allocate the second number.
assert.equal(api.renumberPrintSections([{type:'本文',text:'[[=71=]] [[=49=]] [[=50=]]'}, {type:'設問',text:'Fill [[=49=]]〜[[=71=]].'}])[0].text,'[[=1=]] [[=2=]] [[=3=]]');
const stored='{{リード文}}\n'+sections[0].text+'\n{{本文}}\n'+sections[1].text+'\n{{設問}}\n'+sections[2].text;
const exam={questions:[{question_number:1,problem_text:stored,answer_text:sections[3].text,commentary_text:sections[4].text}]};
const before=JSON.stringify(exam), printed=api.buildPrintHtml(exam,{renumber:true,optimizeAnswers:true});
assert.match(printed,/blank-badge-line">1<\/span>/);
assert.equal(JSON.stringify(exam),before);
assert.match(api.buildPrintHtml(exam,{renumber:false}),/blank-badge-line">66<\/span>/);
assert.doesNotMatch(api.renderOptimizedAnswers('[[=A=]] ((1))\n[[=B=]] ((2))',{}),/blank-badge-line/);
assert.equal(api.renderOptimizedAnswers('[[(e)]] ((1))',{}).includes('blank-badge">(e)</span>'),true);
for(const file of ['index.html','setting/index.html']) {
 const html=read(file),asset=html.match(/src="([^"?]*\/markup[^"?]*\.js)/)[1],css=html.match(/href="([^"?]*\/main[^"?]*\.css)/)[1];
 assert.equal(fs.readFileSync(path.resolve(root,path.dirname(file),asset),'utf8'),read('assets/js/markup.js'));
 assert.equal(fs.readFileSync(path.resolve(root,path.dirname(file),css),'utf8'),read('assets/css/main.css'));
}
console.log('PASS: standalone/inline blanks, old notation, malformed/literal collisions, indentation, nesting, print numbering and non-mutating source');

(async()=>{
 const {build}=require('../panel/node_modules/esbuild');
 const bundle=await build({entryPoints:[path.join(root,'worker/mcp.ts')],bundle:true,write:false,platform:'node',format:'esm'});
 const {cleanPassageText}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
 assert.equal(cleanPassageText('First. [[=A=]] Second.').replace(/\s+/g,' ').trim(),'First. Second.');
 const panel=read('worker/panel-resource.ts');
 assert(panel.includes('blank-badge-line'),'Built conversation panel includes the new renderer and shared CSS');
 console.log('PASS: Worker corpus cleaning and built conversation panel');
 if(!process.argv.includes('--browser'))return;
 const {chromium}=require('../panel/node_modules/playwright');
 const browser=await chromium.launch({headless:true,...(process.env.PANEL_CHROMIUM?{executablePath:process.env.PANEL_CHROMIUM}:{})});
 const evidence='/tmp/exam-paragraph-blanks';fs.mkdirSync(evidence,{recursive:true});const reports=[];
 try {
  for(const width of [1280,390]) {
   const page=await browser.newPage({viewport:{width,height:1000}});await page.route('**/*',r=>r.abort());
   await page.setContent('<style>'+read('assets/css/main.css')+'\n'+read('assets/css/print-choices.css')+'</style><main style="padding:20px"><section class="exam-doc" id="viewer">'+rendered+'<p>References [[=A=]]</p>'+M.render('[[A]] [[--A--]] [[(e)]] [[((e))]] [[（（１２））]] [[((あ))]] 空所 [[=A=]] を選ぶ。').html+'</section><section id="editor" class="exam-doc" style="max-width:480px">'+M.render('[[=A=]]',{paraNum:true}).html+'</section><section class="exam-doc" id="nested">'+M.render('{{問7}} Parent\n{{{(4)}}} Child\n[[=A=]]').html+'</section></main><div id="print-area" class="print-out fs-md" style="display:block">'+printed+'</div>');
   for(const media of ['screen','print']) {
    await page.emulateMedia({media});
    const geometry=await page.evaluate(()=>({
     blanks:[...document.querySelectorAll('.blank-badge-line')].filter(n=>n.getBoundingClientRect().width).map(n=>{
      const r=n.getBoundingClientRect(),p=n.parentElement.getBoundingClientRect(),s=getComputedStyle(n);const range=document.createRange();range.selectNodeContents(n);const glyph=range.getBoundingClientRect();
      const prefix=n.previousElementSibling,offset=prefix?prefix.getBoundingClientRect().width+parseFloat(getComputedStyle(prefix).marginRight):0;
      return {width:r.width,parent:p.width-offset,left:r.left,parentLeft:p.left+offset,height:r.height,font:parseFloat(s.fontSize),center:r.left+r.width/2,labelCenter:glyph.left+glyph.width/2,label:n.textContent,breakInside:getComputedStyle(n.parentElement).breakInside};}),
     old:[...document.querySelectorAll('#viewer .blank-badge:not(.blank-badge-line)')].map(n=>({label:n.textContent,width:n.getBoundingClientRect().width,font:parseFloat(getComputedStyle(n).fontSize),wide:n.classList.contains('blank-badge-wide')})),
     circles:[...document.querySelectorAll('.blank-badge > .choice-inline')].filter(n=>n.getBoundingClientRect().width).map(n=>{const r=n.getBoundingClientRect(),p=n.parentElement.getBoundingClientRect();return {center:r.left+r.width/2,parentCenter:p.left+p.width/2,top:r.top,bottom:r.bottom,parentTop:p.top,parentBottom:p.bottom,font:getComputedStyle(n).fontFamily,parentFont:getComputedStyle(n.parentElement).fontFamily};}),
     overflow:document.documentElement.scrollWidth>innerWidth
    }));
    assert(geometry.blanks.length>0);
    for(const c of geometry.circles){assert(Math.abs(c.center-c.parentCenter)<.2);assert(c.top>=c.parentTop-.1&&c.bottom<=c.parentBottom+.1);assert.equal(c.font,c.parentFont);}
    for(const b of geometry.blanks){assert(Math.abs(b.width-b.parent)<.1,JSON.stringify(b));assert(Math.abs(b.left-b.parentLeft)<.1);assert(b.height>=b.font*2-.1);assert(b.height<b.font*2+.2);if(b.label.trim())assert(Math.abs(b.center-b.labelCenter)<1.1,JSON.stringify(b));assert.equal(b.breakInside,'avoid');}
    if(media==='screen'){assert(!geometry.overflow,JSON.stringify(geometry));for(const b of geometry.old)assert(Math.abs(b.width-b.font*(b.wide?12:4))<.1,JSON.stringify(b));}
    reports.push({width,media,...geometry});
   }
   await page.emulateMedia({media:'screen'});await page.screenshot({path:path.join(evidence,width+'.png'),fullPage:true});
   await page.pdf({path:path.join(evidence,width+'.pdf'),format:'A4',printBackground:true});await page.close();
  }
  fs.writeFileSync(path.join(evidence,'geometry.json'),JSON.stringify(reports,null,2));
 } finally {await browser.close();}
 console.log('PASS: desktop/mobile viewer/editor/nesting, print geometry, label centering, stable old widths and A4 PDF');
})().catch(e=>{console.error(e);process.exitCode=1});
