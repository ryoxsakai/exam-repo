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
// Reference-only text must not allocate numbers, even when it comes first.
const rangeSections = [
  {type:'リード文',text:'Fill [[49]]〜[[71]]. Review [[71]] and {{71}} first. {{99}} stays unknown.'},
  {type:'リード文',text:'Again [[49]]～[[71]].'},
  {type:'問題',text:Array.from({length:23},(_,i)=>'[[ '+(i+49)+' ]]').join(' ')},
  {type:'解答',text:Array.from({length:23},(_,i)=>'{{'+(i+49)+'}}(('+((i%8)+1)+'))').join('　')},
  {type:'解説',text:'{{49}}〜{{56}}; {{57}}〜{{64}}; {{65}}〜{{71}}. Values 49 and 71 stay.'},
  {type:'リード文',text:'Last reference [[71]].'}
];
const rangeBefore=JSON.stringify(rangeSections),ranges=renumber(rangeSections);
assert.equal(ranges[0].text,'Fill [[1]]〜[[23]]. Review [[23]] and {{23}} first. {{99}} stays unknown.');
assert.equal(ranges[1].text,'Again [[1]]～[[23]].');
assert.deepEqual([...ranges[2].text.matchAll(/\[\[ (\d+) \]\]/g)].map(m=>+m[1]),Array.from({length:23},(_,i)=>i+1));
assert.deepEqual([...ranges[3].text.matchAll(/\{\{(\d+)\}\}/g)].map(m=>+m[1]),Array.from({length:23},(_,i)=>i+1));
assert.deepEqual(ranges[3].text.match(/\(\(\d+\)\)/g),rangeSections[3].text.match(/\(\(\d+\)\)/g));
assert.equal(ranges[4].text,'{{1}}〜{{8}}; {{9}}〜{{16}}; {{17}}〜{{23}}. Values 49 and 71 stay.');
assert.equal(ranges[5].text,'Last reference [[23]].');
assert.equal(JSON.stringify(rangeSections),rangeBefore);

// Legacy merged instructions and other range expressions have the same mapping.
for(const join of ['〜','～','~','-','–','—','から',' to ']) {
  const legacy=renumber([{type:'問題',text:'@@**Fill [[49]]'+join+'[[71]].**\n\n[[49]] [[50]] [[71]]'},
    {type:'解答',text:'{{49}} A　{{50}} B　{{71}} C'}]);
  assert.equal(legacy[0].text,'@@**Fill [[1]]'+join+'[[3]].**\n\n[[1]] [[2]] [[3]]');
  assert.equal(legacy[1].text,'{{1}} A　{{2}} B　{{3}} C');
}
assert.equal(renumber([{type:'問題',text:'[[49]]〜[[50]]〜[[71]] are references.\n[[71]] [[49]] [[50]]'}])[0].text,
  '[[2]]〜[[3]]〜[[1]] are references.\n[[1]] [[2]] [[3]]','Definitions retain appearance order, not numeric order');

const questionRefs=renumber([
  {type:'リード文',text:'See 問9, {{問9}} and [[9]]. 問7〜9; {{問7}}〜{{問9}}; {{問7-9}}.'},
  {type:'本文',text:'See {{問9}} before the questions.\n問9の説明を参照。\n{{問9}}を参照。\n(9)の説明も参照。\n[[66]]'},
  {type:'設問',text:'問7〜9を解きなさい。\n{{問7}}〜{{問9}}を解きなさい。\n{{問7}} First\n{{問8}} Second\n{{問9}} Third\n{{問7}} repeated'},
  {type:'解説',text:'問7〜9, 問7から問9, {{問7-9}}, {{問7}}〜{{問9}}. 大問7 remains.'}
]);
assert.equal(questionRefs[0].text,'See 問3, {{問3}} and [[3]]. 問1〜3; {{問1}}〜{{問3}}; {{問1-3}}.');
assert.equal(questionRefs[1].text,'See {{問3}} before the questions.\n問3の説明を参照。\n{{問3}}を参照。\n(3)の説明も参照。\n[[1]]');
assert.equal(questionRefs[2].text,'問1〜3を解きなさい。\n{{問1}}〜{{問3}}を解きなさい。\n{{問1}} First\n{{問2}} Second\n{{問3}} Third\n{{問1}} repeated');
assert.equal(questionRefs[3].text,'問1〜3, 問1から問3, {{問1-3}}, {{問1}}〜{{問3}}. 大問7 remains.');
assert.equal(renumber([{type:'リード文',text:'(66)を見よ。\n(68)を見よ。\n66: 内容'},
  {type:'設問',text:'{{問7}} Choose [[66]].\n{{問8}} Choose [[68]].'}])[0].text,'(1)を見よ。\n(2)を見よ。\n1: 内容');

const compound=renumber([
  {type:'問題',text:'{{56-61}} Group\n[[56]] [[57]] [[61]]\n{{62-68}} Group\n[[62]] [[68]]\n{{69-75}} Group\n[[69]] [[75]]'},
  {type:'解説',text:'{{56-61}} then {{62〜68}} then {{69-75}}. [[56-75]]; [[--56-75--]]; {{56-99}}.'}
]);
assert.equal(compound[0].text,'{{1-3}} Group\n[[1]] [[2]] [[3]]\n{{4-5}} Group\n[[4]] [[5]]\n{{6-7}} Group\n[[6]] [[7]]');
assert.equal(compound[1].text,'{{1-3}} then {{4〜5}} then {{6-7}}. [[1-7]]; [[--1-7--]]; {{1-99}}.');
// No-indent/bold is generic formatting, not proof that the line is a lead.
assert.equal(renumber([{type:'問題',text:'@@**{{問7}} Choose [[66]].**\n@@**問1 Choose [[68]].**'},
  {type:'解説',text:'{{問7-1}}; 問7〜1; [[66]] [[68]]'}])[1].text,'{{問1-2}}; 問1〜2; [[1]] [[2]]');
assert.equal(renumber([{type:'リード文',text:'[[49]]〜[[71]]; 問7〜9; {{56-61}}'}])[0].text,
  '[[49]]〜[[71]]; 問7〜9; {{56-61}}','References never invent definitions');
for(const word of ['がん','におい','へき地','はしか','やけど','からだ']) {
  for(const style of [n=>'{{問'+n+'}}',n=>'問'+n,n=>'('+n+')',n=>n+'.']) {
    const result=renumber([{type:'設問',text:style(7)+' '+word+'について答えよ。\n'+style(8)+' 次の英文について答えよ。'},
      {type:'解答',text:'問7：A\n問8：B'}]);
    assert.equal(result[0].text,style(1)+' '+word+'について答えよ。\n'+style(2)+' 次の英文について答えよ。');
    assert.equal(result[1].text,'問1：A\n問2：B');
  }
}

// Exercise the raw-section → numbering → lead-merge path used by printing.
const rangedQuestion={exam_id:50,question_number:7,problem_text:rangeSections.map(s=>'{{'+s.type+'}}\n'+s.text).join('\n'),answer_text:'Duplicate legacy answer must not appear'};
const rangedExam={questions:[rangedQuestion]},rangedBefore=JSON.stringify(rangedExam);
const rangedHtml=ctx.testPrint.buildPrintHtml(rangedExam,{renumber:true});
assert(rangedHtml.includes('Fill <span class="blank-badge">1</span> 〜 <span class="blank-badge">23</span>'));
assert(rangedHtml.includes('question-badge">23</span>'));
assert(!rangedHtml.includes('Duplicate legacy answer'));
assert(ctx.testPrint.buildPrintHtml(rangedExam,{renumber:false}).includes('question-badge">71</span>'));
assert.equal(ctx.testPrint.buildPrintHtml(rangedExam,{renumber:true}),rangedHtml);
ctx.Store.setPrintSection('問題',false);ctx.Store.setPrintSection('リード文',false);
const rangedAnswers=ctx.testPrint.buildPrintHtml(rangedExam,{renumber:true});
assert(!rangedAnswers.includes('print-part-q'));
assert(rangedAnswers.includes('question-badge">23</span>'));
ctx.Store.setPrintSection('問題',true);ctx.Store.setPrintSection('リード文',true);
assert.equal(JSON.stringify(rangedExam),rangedBefore);
const rangedSecond={exam_id:60,question_number:7,problem_text:'{{リード文}}\nFill [[56]]〜[[58]].\n{{問題}}\n[[56]] [[57]] [[58]]',answer_text:'{{56}} A {{57}} B {{58}} C'};
const rangedFolder={kind:'favFolder',questions:[rangedQuestion,rangedSecond],items:[
  {kind:'section',name:'Range group one'},{kind:'question',q:rangedQuestion},
  {kind:'section',name:'Range group two'},{kind:'question',q:rangedSecond}
]};
const rangedFolderBefore=JSON.stringify(rangedFolder),rangedFolderHtml=ctx.testPrint.buildPrintHtml(rangedFolder,{renumber:true});
assert.equal((rangedFolderHtml.match(/print-section-head">Range group one/g)||[]).length,2);
assert.equal((rangedFolderHtml.match(/print-section-head">Range group two/g)||[]).length,2);
assert(rangedFolderHtml.includes('Fill <span class="blank-badge">1</span> 〜 <span class="blank-badge">3</span>'));
assert(rangedFolderHtml.includes('question-badge">1</span><span class="qtext">A <span class="question-badge">2</span> B <span class="question-badge">3</span> C'));
assert.equal(JSON.stringify(rangedFolder),rangedFolderBefore);
const trailingLegacy={questions:[{question_number:1,problem_text:'{{本文}}\nBody [[66]].\n{{リード文}}\nTrailing [[66]] instructions.',answer_text:'{{66}} A',commentary_text:'{{66}} Explanation.'}]};
for(const on of [false,true]) {
  const output=ctx.testPrint.buildPrintHtml(trailingLegacy,{renumber:on});
  const [questionSide,answerSide]=output.split('<div class="print-part print-part-a">');
  assert(questionSide.includes('Trailing'),'A trailing stored lead stays on the question side');
  assert(!answerSide.includes('Trailing'),'Legacy answer columns must not absorb a stored trailing lead');
  assert(answerSide.includes('question-badge">'+(on?1:66)+'</span>'));
}

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
console.log('PASS: definition-first numbering; explicit/legacy/repeated/trailing leads; range references and compound labels; persisted option; per-question and blank-to-answer numbering; all label styles; choices/numeric answers preserved; overlapping maps; no double remapping; legacy/embedded answers; favorite groups; OFF/ON; answer-only printing; excluded questions; no data mutation');
