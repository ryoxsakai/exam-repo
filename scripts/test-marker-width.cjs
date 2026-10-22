// Geometry and glyph regression: local synthetic content only; no network or storage writes.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {chromium}=require('../panel/node_modules/playwright');
const root=path.resolve(__dirname,'..'),index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const cssFile=index.match(/href="(assets\/css\/main[^"?]*\.css)/)[1];
const css=fs.readFileSync(path.join(root,cssFile),'utf8'),before=css.replace('min-width: 1.0125em; text-align: center; letter-spacing: 0;','min-width: 1.35em; text-align: center; letter-spacing: 0;');
assert.notEqual(before,css);assert.equal(css,fs.readFileSync(path.join(root,'assets/css/main.css'),'utf8'));
for(const file of ['index.html','setting/index.html']){
 const html=fs.readFileSync(path.join(root,file),'utf8'),sheet=html.match(/href="((?:\.\.\/)?assets\/css\/main[^"?]*\.css)/);
 assert.ok(sheet,file+' loads the main stylesheet');
 assert.equal(css,fs.readFileSync(path.resolve(root,path.dirname(file),sheet[1]),'utf8'));
}
const ctx={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'assets/js/markup.js'),'utf8'),ctx);const M=ctx.window.Markup;
const labels=['1','i','a','12','99','WW','あ','アイ'];
let source='';
for(const label of labels)for(const pair of [['(',')'],['（','）']])for(const style of ['__','~~','=='])source+=`${pair[0]}${label}${pair[1]}${style}Underline 日本語 text${style}\n\n`;
// The same labels must now have identical cells in questions and explanations.
for(const label of labels)for(const pair of [['(',')'],['（','）']])source+=`${pair[0]}${label}${pair[1]} ordinary reference 日本語\n\n`;
const unrelated='Ordinary (1), (12), (a), (word) and （本文） remain ordinary.\n\n( [[1]] ) blank.\n\n(123)__long label stays unchanged__\n\n((1)) choice';
const rendered=M.render(source).html,other=M.render(unrelated).html;
assert.equal((rendered.match(/class="marker-label"/g)||[]).length,labels.length*2*4);
assert.equal((other.match(/class="marker-label"/g)||[]).length,3);
const evidence=process.env.MARKER_EVIDENCE||'/tmp/exam-marker-width';fs.mkdirSync(evidence,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.PANEL_CHROMIUM?{executablePath:process.env.PANEL_CHROMIUM}:{})});
 const reports=[];
 try{for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:1000}});await page.route('**/*',r=>r.abort());
  await page.setContent(`<style id="sheet">${before}</style><div id="print-area" class="exam-doc print-out" style="display:block;width:calc(100% - 40px);max-width:660px;margin:20px"><div id="labels">${rendered}</div><div id="unrelated">${other}</div><div>${M.render('(1)__'+('Wrapped underline 日本語 text. '.repeat(45))+'__').html}</div></div>`);
  const measure=()=>page.evaluate(()=>{
   const box=r=>({w:r.width,h:r.height});
   const rangeBox=node=>{const r=document.createRange();r.selectNodeContents(node);return box(r.getBoundingClientRect())};
   return {labels:[...document.querySelectorAll('#labels .marker-parentheses')].map(p=>{const cell=p.querySelector('.marker-label'),s=getComputedStyle(cell);return {label:cell.textContent,cell:box(cell.getBoundingClientRect()),glyph:rangeBox(cell),open:rangeBox(p.firstChild),close:rangeBox(p.lastChild),outer:box(p.getBoundingClientRect()),size:s.fontSize,font:s.fontFamily};}),other:document.querySelector('#unrelated').innerHTML,unrelated:[...document.querySelectorAll('#unrelated .blank-badge,#unrelated .underline-marker,#unrelated .answer-choice-label')].map(n=>({text:n.textContent,box:box(n.getBoundingClientRect()),size:getComputedStyle(n).fontSize})),overflow:document.documentElement.scrollWidth>innerWidth};
  });
  for(const media of ['screen','print']){
   await page.emulateMedia({media});await page.locator('#sheet').evaluate((n,c)=>n.textContent=c,before);const old=await measure();
   await page.locator('#sheet').evaluate((n,c)=>n.textContent=c,css);const next=await measure();
   assert.equal(next.overflow,old.overflow);if(media==='screen')assert.equal(next.overflow,false);assert.equal(next.other,old.other);assert.deepEqual(next.unrelated,old.unrelated);
   next.labels.forEach((n,i)=>{const o=old.labels[i];for(const part of ['glyph','open','close'])for(const dim of ['w','h'])assert.ok(Math.abs(n[part][dim]-o[part][dim])<.03,`${media} ${n.label} ${part} unchanged`);assert.equal(n.size,o.size);assert.equal(n.font,o.font);assert.ok(n.cell.w+.03>=n.glyph.w,`${n.label} no clipped glyphs`);assert.ok(n.cell.w<=o.cell.w+.03);assert.ok(Math.abs((o.outer.w-n.outer.w)-(o.cell.w-n.cell.w))<.04,'Only inner width changes');if(n.glyph.w<o.cell.w*.75-.04)assert.ok(Math.abs(n.cell.w/o.cell.w-.75)<.003,`${n.label} inner cell 75%`);});
   reports.push({width,media,before:old,after:next});
   if(media==='screen'){await page.screenshot({path:path.join(evidence,`after-${width}.png`),fullPage:true});await page.locator('#sheet').evaluate((n,c)=>n.textContent=c,before);await page.screenshot({path:path.join(evidence,`before-${width}.png`),fullPage:true});await page.locator('#sheet').evaluate((n,c)=>n.textContent=c,css);}
  }
  await page.pdf({path:path.join(evidence,`after-${width}.pdf`),format:'A4',printBackground:true});await page.close();
 }
 fs.writeFileSync(path.join(evidence,'geometry.json'),JSON.stringify(reports,null,2));console.log('PASS: 75% fitting inner cells, unchanged glyphs/parentheses, long labels fit, unrelated content unchanged, desktop/mobile screen/print');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
