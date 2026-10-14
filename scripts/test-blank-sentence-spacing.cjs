const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=require('node:path').resolve(__dirname,'..');
const index=fs.readFileSync(root+'/index.html','utf8'),asset=index.match(/src="(assets\/js\/markup[^"?]*\.js)/)[1];
const source=fs.readFileSync(root+'/'+asset,'utf8');
assert.equal(source,fs.readFileSync(root+'/assets/js/markup.js','utf8'));
const context={window:{}};vm.createContext(context);vm.runInContext(source,context);const M=context.window.Markup;
for(const text of ['End. [[A]] Next sentence.', 'End.  [[A]]  Next sentence.', 'End.[[A]]Next sentence.', 'End? [[A]] Next sentence.', 'End! [[A]] Next sentence.', 'End.” [[A]] Next sentence.', '__End.__ [[A]] **Next sentence.**', 'End. [[--A--]] Next sentence.']) {
  const html=M.render(text).html;
  assert.match(html,/&nbsp;&nbsp;<span class="blank-badge(?: blank-badge-wide)?">/);
  assert.match(html,/<\/span>&nbsp;&nbsp;(?:<strong>)?Next/);
  assert.doesNotMatch(html,/&nbsp;&nbsp; <span class="blank-badge/);
  assert.equal(M.strip(text).includes('[[A]]'),false);
}
for(const text of ['A [[1]] word.', 'Dr. [[A]] Smith', 'End. [[A]], next', 'End. [[A]]', '([[A]]) Next sentence.']) {
  assert.doesNotMatch(M.render(text).html,/<\/span>&nbsp;&nbsp;/,text);
}
console.log('PASS: two equal sentence gaps, existing spaces normalized, punctuation/abbreviations/word blanks/parentheses retained');
if(process.argv.includes('--browser'))(async()=>{
  const {chromium}=require('../panel/node_modules/playwright');
  const browser=await chromium.launch({executablePath:process.env.PANEL_CHROMIUM||undefined});
  try {for(const width of [1280,390]){
    const page=await browser.newPage({viewport:{width,height:900}});
    await page.setContent('<style>body{margin:30px}.exam-doc{font:20px Arial}.blank-badge{display:inline-block;border:1px solid black;padding:2px 8px}</style><div class="exam-doc">'+M.render('End. [[A]] Next sentence.').html+'</div>');
    const gap=await page.evaluate(()=>{
      const badge=document.querySelector('.blank-badge'),before=badge.previousSibling,after=badge.nextSibling;
      const left=document.createRange(),right=document.createRange();
      left.setStart(before,before.textContent.length-2);left.setEnd(before,before.textContent.length);
      right.setStart(after,0);right.setEnd(after,2);
      return {left:left.getBoundingClientRect().width,right:right.getBoundingClientRect().width,before:before.textContent.slice(-2),after:after.textContent.slice(0,2)};
    });
    assert.equal(gap.before,'\u00a0\u00a0');assert.equal(gap.after,'\u00a0\u00a0');
    assert.ok(gap.left>0&&Math.abs(gap.left-gap.right)<.1,JSON.stringify(gap));
    await page.pdf({path:'/tmp/exam-blank-spacing-'+width+'.pdf',format:'A4'});await page.close();
  }}finally{await browser.close();}
  console.log('PASS: desktop/mobile measured equal left/right gaps and PDF output');
})().catch(e=>{console.error(e);process.exitCode=1});
