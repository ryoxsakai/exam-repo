const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
for(const path of ['assets/js/markup.js','assets/js/markup-20261109digits.js']){
 const ctx={window:{}};vm.runInNewContext(fs.readFileSync(path,'utf8'),ctx);const M=ctx.window.Markup;
 for(const style of ['__','~~','==']) for(const prefix of ['', 'The text ', '“']) for(const marker of ['1','10','12','99']) {
  const html=M.render(prefix+marker+style+'word'+style).html;
  assert.ok(html.includes('<sub class="underline-marker">'+marker+'</sub>'),prefix+marker+style+' '+html);
 }
 for(const input of ['123__word__','abc12__word__','12__word__ending','data__word__','12 normal text']) assert.doesNotMatch(M.render(input).html,/<sub class="underline-marker">/,input);
 assert.match(M.render('(12)__word__').html,/<sub class="underline-marker">/);
 assert.match(M.render('~~12~~__word__').html,/<sub class="underline-marker">12<\/sub><u>word<\/u>/);
 assert.match(M.render('Do you?__Yes.__ Next.').html, /<\/u>&nbsp;&nbsp;Next/);
}
console.log('PASS: 1 and 2 digit markers, all underline styles, boundaries and unrelated text');
