const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const root=path.resolve(__dirname,'..');
const ctx={Difficulty:{BAND_LABEL:{}},document:{addEventListener(){}},saved:{},localStorage:{getItem:k=>ctx.saved[k]??null,setItem:(k,v)=>ctx.saved[k]=v},UI:{el:()=>null,escapeHtml:s=>String(s)}};ctx.window=ctx;vm.createContext(ctx);
for(const file of ['assets/js/store.js','assets/js/markup-20261001a.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx);
vm.runInContext(fs.readFileSync(path.join(root,'assets/js/viewer.js'),'utf8').replace('document.addEventListener("DOMContentLoaded", init);','window.testPrint={renumberPrintSections,buildPrintHtml,state};'),ctx);
const renumber=secs=>JSON.parse(JSON.stringify(ctx.testPrint.renumberPrintSections(secs)));
assert.equal(ctx.Store.getPrintRenumber(),false);ctx.Store.setPrintRenumber(true);assert.equal(ctx.Store.getPrintRenumber(),true);
const secs=[{type:'本文',text:'[1] In 1966 [[66]] and [[--67--]].  ##word::問7##\n![問7](https://example.com/66.png)\n!!!!Source 問7 1966!!!!'}, {type:'設問',text:'{{問7}} [[66]]\n((1)) First choice\n((2)) Second choice\n{{問8}} [[67]]'}, {type:'解答',text:'問7：[[66]] = 2\n問8：[[67]] = 1'}, {type:'解説',text:'問7の説明。大問7はそのまま。問8も参照。'}];
const original=JSON.stringify(secs),r=renumber(secs);
assert.equal(JSON.stringify(secs),original);
assert.equal(r[0].text,'[1] In 1966 [[1]] and [[--2--]].  ##word::問7##\n![問7](https://example.com/66.png)\n!!!!Source 問7 1966!!!!');
assert.equal(r[1].text,'{{問1}} [[1]]\n((1)) First choice\n((2)) Second choice\n{{問2}} [[2]]');
assert.equal(r[2].text,'問1：[[1]] = 2\n問2：[[2]] = 1');
assert.equal(r[3].text,'問1の説明。大問7はそのまま。問2も参照。');
assert.equal(renumber([{type:'問題',text:'{{66}} A\n{{68}} B\n{{66}} reference'},{type:'解答',text:'66: B\n68: A'}])[1].text,'1: B\n2: A');
assert.equal(renumber([{type:'設問',text:'(66) A\n(67) B'},{type:'解説',text:'(66) Explanation\n(67) Explanation'}])[1].text,'(1) Explanation\n(2) Explanation');
assert.equal(renumber([{type:'問題',text:'問7 A\n問8 B'}])[0].text,'問1 A\n問2 B');
assert.equal(renumber([{type:'本文',text:'[1] paragraph\n((3)) choice\n1980 year'}])[0].text,'[1] paragraph\n((3)) choice\n1980 year');
// Answer labels often use {{N}} while the question defines only [[N]] blanks.
const blankSections = [
  {type:'問題',text:'Choose [[66]], [[--68--]], and [[70]].'},
  {type:'解答',text:'{{66}}((4))　{{68}}((66))　{{70}} 66.5'},
  {type:'解説',text:'{{66}}〜{{68}} Numbers 66, 68 and 70 stay.\n{{70}} [[66]] is the blank.\n66\n66.5\n[66] paragraph\n((66)) choice'}
];
let blankResult = renumber(blankSections);
assert.equal(blankResult[0].text,'Choose [[1]], [[--2--]], and [[3]].');
assert.equal(blankResult[1].text,'{{1}}((4))　{{2}}((66))　{{3}} 66.5');
assert.equal(blankResult[2].text,'{{1}}〜{{2}} Numbers 66, 68 and 70 stay.\n{{3}} [[1]] is the blank.\n66\n66.5\n[66] paragraph\n((66)) choice');
// Resolve each number, not just whether a question-number map exists at all.
const mixed = renumber([
  {type:'本文',text:'[[66]] then [[68]].'},
  {type:'設問',text:'{{問7}} Choose [[66]].\n{{問8}} Choose [[68]].'},
  {type:'解答',text:'{{問7}} {{66}}((4))　{{問8}} {{68}}((66))\n66: 68\n(68) 66\n問66：68\n[[7]] = 66\n{{99}} Unknown'},
  {type:'講評',text:'{{66}} and {{68}}. ##word::問66##\nhttps://example.com/問66\n!!!!問66!!!!'}
]);
assert.equal(mixed[2].text,'{{問1}} {{1}}((4))　{{問2}} {{2}}((66))\n1: 68\n(2) 66\n問1：68\n[[1]] = 66\n{{99}} Unknown');
assert.equal(mixed[3].text,'{{1}} and {{2}}. ##word::問66##\nhttps://example.com/問66\n!!!!問66!!!!');
// An explicit question label wins over a different blank with the same number.
assert.equal(renumber([{type:'問題',text:'[[68]] [[66]]\n{{66}} A\n{{68}} B'},
  {type:'解答',text:'{{66}} 68; [[66]] 68'}])[1].text,'{{1}} 68; [[2]] 68');
// A transformed badge must not be interpreted as an original number again.
assert.equal(renumber([{type:'設問',text:'{{問7}} A\n{{問1}} B'},
  {type:'解答',text:'{{問7}} 7　{{問1}} 1'}])[1].text,'{{問1}} 7　{{問2}} 1');
assert.equal(renumber([{type:'解答',text:'{{66}}((7))\n問7：66\n66: B'}])[0].text,'{{66}}((7))\n問7：66\n66: B');
const ex={kind:'favFolder',questions:[{exam_id:10,question_number:1,problem_text:'{{設問}}\n{{問7}} A\n{{解答}}\n問7：B'},{exam_id:20,question_number:1,problem_text:'{{設問}}\n{{問66}} C\n{{解答}}\n問66：D'}]};
const before=JSON.stringify(ex);let html=ctx.testPrint.buildPrintHtml(ex,{renumber:true});assert.equal((html.match(/question-badge">問1</g)||[]).length,2);assert(html.includes('問1：B'));assert(html.includes('問1：D'));assert.equal(JSON.stringify(ex),before);
html=ctx.testPrint.buildPrintHtml(ex,{renumber:false});assert(html.includes('問7'));assert(html.includes('問66'));
ctx.Store.setPrintSection('設問',false);html=ctx.testPrint.buildPrintHtml(ex,{renumber:true});assert(html.includes('問1：B'));assert(!html.includes('question-badge'));
ctx.Store.setPrintSection('設問',true);
const blankQuestion = {exam_id:30,question_number:1,problem_text:blankSections[0].text,answer_text:blankSections[1].text,commentary_text:blankSections[2].text};
const mixedQuestion = {exam_id:40,question_number:1,problem_text:'{{設問}}\n{{問7}} Choose [[76]].\n{{解答}}\n{{問7}} {{76}}((68))',answer_text:'Legacy duplicate must not appear'};
const folder = {kind:'favFolder',questions:[blankQuestion,mixedQuestion],items:[
  {kind:'section',name:'First group'},{kind:'question',q:blankQuestion},
  {kind:'section',name:'Second group'},{kind:'question',q:mixedQuestion}
]};
const folderBefore = JSON.stringify(folder);
html=ctx.testPrint.buildPrintHtml(folder,{renumber:true});
assert.equal((html.match(/print-section-head">First group/g)||[]).length,2);
assert.equal((html.match(/print-section-head">Second group/g)||[]).length,2);
assert(html.includes('question-badge">1</span><span class="qtext"><span class="choice-inline choice-label-unicode"><span class="choice-label-text">④</span>'));
assert(html.includes('question-badge">2</span><span class="choice-inline choice-label-compact"><span class="choice-label-text">66</span>'));
assert(html.includes('question-badge">問1</span><span class="qtext"><span class="question-badge">1</span><span class="choice-inline choice-label-compact"><span class="choice-label-text">68</span>'));
assert(!html.includes('Legacy duplicate must not appear'));
const enabledHtml = html;
html=ctx.testPrint.buildPrintHtml(folder,{renumber:false});
assert(html.includes('question-badge">66</span>'));
assert(html.includes('question-badge">問7</span>'));
assert.equal(ctx.testPrint.buildPrintHtml(folder,{renumber:true}),enabledHtml,'Repeated OFF/ON must not renumber previous output');
ctx.Store.setPrintSection('問題',false);ctx.Store.setPrintSection('設問',false);
html=ctx.testPrint.buildPrintHtml(folder,{renumber:true});
assert(!html.includes('print-part-q'));
assert(html.includes('question-badge">1</span><span class="qtext"><span class="choice-inline choice-label-unicode"><span class="choice-label-text">④</span>'));
ctx.testPrint.state.printQSel['30:1']=false;
html=ctx.testPrint.buildPrintHtml(folder,{renumber:true});
assert(!html.includes('First group'));
assert(html.includes('Second group'));
assert.equal(JSON.stringify(folder),folderBefore,'Printing must not mutate stored or favorite data');
console.log('PASS: persisted option; per-question and blank-to-answer numbering; all label styles; choices/numeric answers preserved; overlapping maps; no double remapping; legacy/embedded answers; favorite groups; OFF/ON; answer-only printing; excluded questions; no data mutation');
