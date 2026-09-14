// Run with: node scripts/test-print-writing-space.cjs
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=require('path').resolve(__dirname, '..');
const ctx={console,document:{addEventListener(){}},localStorage:{getItem:k=>ctx.saved[k]??null,setItem:(k,v)=>ctx.saved[k]=v},saved:{},UI:{el:()=>null,escapeHtml:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')}};ctx.window=ctx;vm.createContext(ctx);
for(const f of ['store','markup','difficulty'])vm.runInContext(fs.readFileSync(`${root}/assets/js/${f}.js`,'utf8'),ctx);
vm.runInContext(fs.readFileSync(`${root}/assets/js/viewer.js`,'utf8').replace('document.addEventListener("DOMContentLoaded", init);','window.testPrint = {buildPrintHtml, state};'),ctx);
const ex={questions:[{question_number:1,category:'英作文',problem_text:'{{問題}}\n次のテーマについて英語で述べなさい。\n{{設問}}\nDescribe a place you would like to visit.',answer_text:'I would like to visit Kyoto.'},{question_number:2,category:'文法',problem_text:'{{問題}}\nChoose the correct word.',answer_text:'A'}]};
const count=h=>(h.match(/class="print-writing-space"/g)||[]).length;
assert.equal(ctx.Store.getPrintWritingSpace(),false);ctx.Store.setPrintWritingSpace(true);assert.equal(ctx.Store.getPrintWritingSpace(),true);
for(const n of [5,10,15,20,25]) {
 ctx.Store.setPrintWritingLines(n); assert.equal(ctx.Store.getPrintWritingLines(),n);
 const h=ctx.testPrint.buildPrintHtml(ex,{writingSpace:true,writingLines:n},false);
 assert.equal((h.match(/class="print-writing-line"/g)||[]).length,n);
}
ctx.Store.setPrintWritingLines(999);assert.equal(ctx.Store.getPrintWritingLines(),10);
const html=ctx.testPrint.buildPrintHtml(ex,{writingSpace:true},false);assert.equal(count(html),1);assert.equal(count(html.split('print-part-a')[1]),0);
assert.equal(count(ctx.testPrint.buildPrintHtml(ex,{writingSpace:false},false)),0);
ctx.testPrint.state.printQSel={'0:1':false};assert.equal(count(ctx.testPrint.buildPrintHtml(ex,{writingSpace:true},false)),0);ctx.testPrint.state.printQSel={};
ctx.Store.setPrintSection('問題',false);ctx.Store.setPrintSection('設問',false);assert.equal(count(ctx.testPrint.buildPrintHtml(ex,{writingSpace:true},false)),0);
console.log('PASS: category, problem side only, option off, excluded question/sections, persisted setting');
