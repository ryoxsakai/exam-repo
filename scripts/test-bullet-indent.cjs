const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..'),index=fs.readFileSync(root+'/index.html','utf8');
const asset=index.match(/src="(assets\/js\/markup[^"?]*\.js)/)[1],css=index.match(/href="(assets\/css\/main[^"?]*\.css)/)[1];
const ctx={window:{}};vm.createContext(ctx);vm.runInContext(fs.readFileSync(root+'/'+asset,'utf8'),ctx);const M=ctx.window.Markup;
assert.match(M.render('- First item',{zenyaku:true}).html,/class="blk bullet-line"/);
assert.equal(M.render('- A ##word::意味## in a list').footnotes.length,1);
for(const source of ['- 5','- x + y','A normal sentence.'])assert.doesNotMatch(M.render(source).html,/bullet-line/);
console.log('PASS: hanging-list structure, single footnote, numbers and normal text preserved');
(async()=>{
 const {chromium}=require('../panel/node_modules/playwright');const browser=await chromium.launch({executablePath:process.env.PANEL_CHROMIUM||undefined});
 try {for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:900}});await page.route('**/*',r=>r.abort());
  const text='- **First** item '+ 'continues across several wrapped lines with useful details and examples '.repeat(5)+'\n- Second item with another explanation';
  await page.setContent('<style>'+fs.readFileSync(root+'/'+css,'utf8')+'</style><div id="print-area" class="exam-doc no-indent" style="display:block!important;width:280px;margin:24px;font-family:Arial;font-size:20px">'+M.render(text,{zenyaku:true}).html+'</div>');
  for(const media of ['screen','print']){
   await page.emulateMedia({media});
   const lines=await page.locator('.bullet-text').first().evaluate(node=>{
    const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT),range=document.createRange(),rows=[];let n;
    while(n=walker.nextNode())for(let i=0;i<n.length;i++){
     if(/\s/.test(n.textContent[i]))continue;
     range.setStart(n,i);range.setEnd(n,i+1);const r=range.getBoundingClientRect();
     let row=rows.find(x=>Math.abs(x.top-r.top)<5);if(!row)rows.push(row={top:r.top,left:r.left});else row.left=Math.min(row.left,r.left);
    }
    return rows;
   });
   assert.ok(lines.length>=3);assert.ok(lines.every(l=>Math.abs(l.left-lines[0].left)<.5),JSON.stringify({width,media,lines}));
  }
  await page.pdf({path:'/tmp/exam-bullet-indent-'+width+'.pdf',format:'A4'});
  if(width===390)await page.screenshot({path:'/tmp/exam-bullet-indent.png',fullPage:true});await page.close();
 }}finally{await browser.close();}
 console.log('PASS: 3+ wrapped lines align on desktop/mobile in screen and print media');
})().catch(e=>{console.error(e);process.exitCode=1});
