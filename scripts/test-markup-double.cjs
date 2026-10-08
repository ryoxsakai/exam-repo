const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..'),index=fs.readFileSync(root+'/index.html','utf8');
const parser=index.match(/src="(assets\/js\/markup[^"?]*\.js)/)[1],css=index.match(/href="(assets\/css\/main[^"?]*\.css)/)[1];
const ctx={window:{}};vm.createContext(ctx);vm.runInContext(fs.readFileSync(root+'/'+parser,'utf8'),ctx);const M=ctx.window.Markup;
for(const text of ['==double==','(1)==double==','((1))==double==','A==double==','Before A==double==']){
 const html=M.render(text).html;assert.match(html,/class="double-underline"/);assert.doesNotMatch(html,/<mark|answer-choice/);if(text!=='==double==')assert.match(html,/underline-marker/);
}
for(const text of ['::plain::','::blue:::blue','==legacy==:blue','::##Word::訳## __under__ ~~wave~~ ==double==::']){
 const result=M.render(text);assert.match(result.html,/<mark class="hl hl-/);assert.doesNotMatch(result.html,/::|==/);if(text.includes('##')){assert.equal(result.footnotes.length,1);assert.match(result.html,/<u>under<\/u>/);assert.match(result.html,/wavy-underline/);assert.match(result.html,/double-underline/);}
}
assert.doesNotMatch(M.render('A ==double== phrase.').html,/underline-marker/);
assert.match(M.render('((1))==legacy==:blue').html,/answer-choice/);
assert.match(M.render('((1)) choice').html,/answer-choice/);
assert.match(M.render('Text [[1]] {{問1}} ((1))').html,/blank-badge/);
assert.equal(M.strip('::##Word::訳## __under__ ~~wave~~ ==double==:::blue'), 'Word under wave double');
assert.equal(M.strip('==legacy==:blue ::color:::pink'), 'legacy color');
assert.equal(fs.readFileSync(root+'/'+parser,'utf8'),fs.readFileSync(root+'/assets/js/markup.js','utf8'));
console.log('PASS: released parser, double underline, adjacent markers, choice distinction, nested notes/styles, colors, strip');
if(process.argv.includes('--browser'))(async()=>{
 const {chromium}=require('../panel/node_modules/playwright');const browser=await chromium.launch({headless:true,...(process.env.PANEL_CHROMIUM?{executablePath:process.env.PANEL_CHROMIUM}:{})});
 try{for(const width of [1280,390]){
 const page=await browser.newPage({viewport:{width,height:900}});await page.route('**/*',r=>r.abort());
 const text='(1)=='+('This phrase wraps across several lines with ordinary words. '.repeat(12))+'==\n\n::##Word::訳## __under__ ~~wave~~:::blue\n\n==legacy==:pink\n\n{{問1}} Choose [[1]].\n((1)) first\n((2)) second';
 await page.setContent('<style>'+fs.readFileSync(root+'/'+css,'utf8')+'</style><div class="exam-doc" style="width:calc(100% - 40px);max-width:660px;margin:20px">'+M.render(text).html+'</div>');
 const metrics=await page.locator('.double-underline').evaluate(el=>{const s=getComputedStyle(el),r=document.createRange();r.selectNodeContents(el);return {style:s.textDecorationStyle,line:s.textDecorationLine,rows:new Set([...r.getClientRects()].map(r=>r.top)).size,overflow:document.documentElement.scrollWidth>innerWidth};});assert.equal(metrics.style,'double');assert.equal(metrics.line,'underline');assert.ok(metrics.rows>2);assert.equal(metrics.overflow,false);
 await page.screenshot({path:'/tmp/exam-double-'+width+'.png',fullPage:true});await page.locator('.exam-doc').evaluate(el=>{el.id='print-area';el.classList.add('print-out');});await page.pdf({path:'/tmp/exam-double-'+width+'.pdf',format:'A4',printBackground:true});const pdfText=require('node:child_process').execFileSync('pdftotext',['/tmp/exam-double-'+width+'.pdf','-'],{encoding:'utf8'});assert.match(pdfText,/This phrase wraps/);assert.match(pdfText,/legacy/);assert.doesNotMatch(pdfText,/::|==|##/);await page.close();
 }console.log('PASS: desktop/mobile wrapping, no overflow, screenshots and real A4 PDFs');}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
