// Run with: node scripts/test-print-line-numbers.cjs
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const source=fs.readFileSync(path.resolve(__dirname,'../assets/js/viewer.js'),'utf8');
const nodes=[];const ctx={console,Store:{getFavCollapsed:()=>({})},NodeFilter:{SHOW_TEXT:4,FILTER_ACCEPT:1,FILTER_REJECT:2},getComputedStyle:()=>({lineHeight:'30px',fontSize:'16px'}),UI:{el:()=>null,$all:()=>[],escapeHtml:String},Difficulty:{BAND_LABEL:{}},document:{addEventListener(){},createTreeWalker(root,type,filter){let i=0;return{nextNode(){while(i<nodes.length){const n=nodes[i++];if(filter.acceptNode(n)===1)return n;}return null;}}},createRange(){let node,start=0;return{selectNodeContents(n){node=n;},setStart(n,i){node=n;start=i;},setEnd(){},getClientRects(){return node.rects;},getBoundingClientRect(){return{top:node.charTop?node.charTop(start):node.rects[0].top,width:8,height:16};}}}}};ctx.window=ctx;
vm.createContext(ctx);vm.runInContext(source.replace('document.addEventListener("DOMContentLoaded", init);','window.lineTest={lineStartPositions,lineAnchorOffset};'),ctx);
const node=(value,tops,skip=false)=>({nodeValue:value,rects:tops.map(top=>({top,width:80,height:16})),parentElement:{closest(sel){return sel!=='.blk'&&skip?{}:null;}}});
nodes.push(node('First line', [0]),node('bold inline fragment',[2]),node('1',[-8],true),node('Second line',[30]),node('Third line',[60]),node('66',[58],true),node('Fourth line',[90]),node('Fifth line',[120]));
assert.equal(ctx.lineTest.lineStartPositions({}).starts.length,5,'Inline formatting and raised badge labels must not add lines');
const long=node('word0 word1 word2',[150,180,210]);long.charTop=i=>150+Math.floor(i/6)*30;nodes.push(long);
const result=ctx.lineTest.lineStartPositions({}).starts;
assert.equal(result.length,8);assert.equal(result[6].offset,6);assert.equal(result[7].offset,12);
for(const [text,offset,want] of [['longword next',0,8],['  first second',0,7],['first second',6,12],['final',0,5]])assert.equal(ctx.lineTest.lineAnchorOffset({nodeValue:text},offset),want,'Anchor must follow a complete word');
console.log('PASS: visual lines across formatted text, superscript/badge exclusion, wrapped-line offsets, whole-word anchor boundaries');
