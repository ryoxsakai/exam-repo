const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/js/markup.js'), 'utf8');
const ctx = {window:{}}; vm.runInNewContext(source, ctx); const M = ctx.window.Markup;
const phonetics = ['c__o__st','cr__ou__ch','fl__ou__r','gh__o__st','__ough__t',
 '__g__igantic','ama__z__ing','distin__g__uish','e__x__amine','in__j__ured','po__ss__ess',
 'w__or__ship','br__oa__dcast','c__or__poration','p__ur__ple','s__our__ce','w__ar__ning',
 'i__ss__ue','da__zz__ling','defi__c__iency','e__cc__entric','fa__sc__inate','per__s__uade',
 '__th__eme','au__th__ority','brea__th__e','clo__th__es','smoo__th__','__th__ough'];
for(const input of phonetics){
 const html=M.render(input).html;
 assert.doesNotMatch(html,/underline-marker/,input);
 assert.equal(html.replace(/<[^>]+>/g,''),input.replaceAll('__',''),input);
 assert.match(html,/<u>[^<]+<\/u>/,input);
}
const choices='((1)) c__o__st　((2)) e__x__amine　((5)) __th__ough';
assert.doesNotMatch(M.render(choices).html,/underline-marker/);
const terminalWords=['t__oe__','a__che__','b__oy__','w__eigh__','__toe__','t__o__e'];
const phoneticLead='次の各群の単語の下線部の発音が他と異なるものを選べ。\n\n';
for(const input of terminalWords){
 for(const html of [M.render(input,{phoneticWords:true}).html,M.render(phoneticLead+input).html]){
  assert.doesNotMatch(html,/underline-marker/,input);
  assert.ok(html.includes(input.replace(/__([^_]+)__/,'<u>$1</u>')),input);
 }
}
assert.match(M.render('t__oe__').html,/underline-marker/,'ordinary bare lowercase label retained');
assert.doesNotMatch(M.render(phoneticLead+'((1)) t__oe__　((2)) __toe__').html,/underline-marker/);
for(const input of ['A__word__','イ__語句__','(a)__word__','~~(1)~~__in__side']){
 assert.match(M.render(phoneticLead+input).html,/underline-marker/,input);
}
for(const prefix of ['', 'He said “', 'He said "', 'He said ‘', 'He said 「']){
 for(const marker of ['A','a','1','ニ']){
  const html=M.render(prefix+marker+'__underlined words__.').html;
  assert.equal((html.match(/underline-marker/g)||[]).length,1,prefix+marker);
 }
}
for(const marker of ['(1)','（ア）','~~(1)~~'])assert.match(M.render(marker+'__in__side').html,/underline-marker/);
for(const file of ['index.html','setting/index.html']){
 const html=fs.readFileSync(path.join(root,file),'utf8');
 const asset=html.match(/src="((?:\.\.\/)?assets\/js\/markup[^"?]+\.js)/)[1];
 assert.equal(fs.readFileSync(path.resolve(root,path.dirname(file),asset),'utf8'),source);
}
if(!process.argv.includes('--browser')){console.log('PASS phonetic word segments, choices, quoted labels and published assets');process.exit(0);}
(async()=>{
 const {chromium}=require('../panel/node_modules/playwright');
 const browser=await chromium.launch({headless:true,...(process.env.PANEL_CHROMIUM?{executablePath:process.env.PANEL_CHROMIUM}:{})});
 const evidence=process.env.PHONETIC_EVIDENCE||'/tmp/exam-phonetic-underlines';fs.mkdirSync(evidence,{recursive:true});
 try{for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:1000}});await page.route('**/*',r=>r.abort());
  const css=fs.readFileSync(path.join(root,'assets/css/main.css'),'utf8');
  await page.setContent(`<style>${css}</style><div id="print-area" class="print-out exam-doc" style="display:block;width:calc(100% - 30px);margin:15px"><div id="words">${phonetics.concat(terminalWords).map(x=>M.render(x,{phoneticWords:true}).html).join('')}</div><div id="choices">${M.render(phoneticLead+choices+'　((3)) t__oe__　((4)) __toe__').html}</div><div id="labels">${M.render('Donors include “ニ__people of note__,” and A__urgent__ requests.').html}</div></div>`);
  for(const media of ['screen','print']){
   await page.emulateMedia({media});
   assert.equal(await page.locator('#words .underline-marker,#choices .underline-marker').count(),0);
   assert.deepEqual(await page.locator('#labels .underline-marker').allTextContents(),['ニ','A']);
   const ranges=await page.locator('#words u').evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,decoration:getComputedStyle(n).textDecorationLine,font:getComputedStyle(n).fontSize,parent:getComputedStyle(n.parentElement).fontSize})));
   for(const r of ranges){assert.match(r.decoration,/underline/);assert.equal(r.font,r.parent,r.text);}
   fs.writeFileSync(path.join(evidence,`${width}-${media}.json`),JSON.stringify(ranges,null,2));
  }
  await page.emulateMedia({media:'screen'});await page.screenshot({path:path.join(evidence,`${width}.png`),fullPage:true});
  await page.pdf({path:path.join(evidence,`${width}.pdf`),format:'A4',printBackground:true});await page.close();
 }}finally{await browser.close();}
 console.log('PASS desktop/mobile screen/print phonetic baselines and quoted labels');
})().catch(e=>{console.error(e);process.exitCode=1});
