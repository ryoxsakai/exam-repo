// Synthetic markup only. Compare actual raster output with decoration disabled.
const {execFileSync} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const {chromium} = require('../panel/node_modules/playwright');
const root = path.resolve(__dirname, '..'), context = {window:{}};
vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/js/markup.js'), 'utf8'), context);
const M = context.window.Markup, baseline = process.argv.includes('--baseline');
const baselineRef='80d864e2a059a7983257b48a7d7ccb4be32d9815';
const css = baseline ? execFileSync('git',['show',baselineRef+':assets/css/main.css'],{cwd:root,encoding:'utf8'}) : fs.readFileSync(path.join(root, 'assets/css/main.css'), 'utf8');
const resource = fs.readFileSync(path.join(root, 'worker/panel-resource.ts'), 'utf8');
const panel = JSON.parse(resource.slice(resource.indexOf(' = ') + 3).trim().replace(/;$/, ''));
const panelCss = baseline ? execFileSync('git',['show',baselineRef+':panel/panel.css'],{cwd:root,encoding:'utf8'})+'\n'+css.slice(css.indexOf('.exam-doc .blk {'),css.indexOf('.exam-section-title {')) : panel.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
if (!baseline) for (const name of ['marker-fonts','markup','markers']) {
 const region = css.split(`/* exam-shared:${name}:start */`)[1].split(`/* exam-shared:${name}:end */`)[0];
 assert.ok(panelCss.includes(region), `panel preserves complete shared region: ${name}`);
}
const markers = ['(1)', '(a)', '（ア）', '(12)', '<1>', '<<12>>', '〈1〉', '《12》'];
const styles = ['__', '==', '~~'];
const evidence = '/tmp/exam-marker-decoration-panel'; fs.mkdirSync(evidence, {recursive:true});
const rows = markers.flatMap(marker => styles.map(style => ({marker, style, html:M.render(style + marker + style).html})));
(async () => {
 const browser = await chromium.launch({headless:true, ...(process.env.PANEL_CHROMIUM ? {executablePath:process.env.PANEL_CHROMIUM} : {})});
 const report = []; let missing = 0;
 try {
  if (!baseline) {
   const page=await browser.newPage({viewport:{width:390,height:900}});
   await page.route('**/*',r=>r.abort());
   const originalCss=execFileSync('git',['show','80d864e2a059a7983257b48a7d7ccb4be32d9815:assets/css/main.css'],{cwd:root,encoding:'utf8'});
   await page.setContent(`<style id="sheet">${originalCss}</style><main id="print-area" class="exam-doc" style="display:block">${M.render(markers.join(' ')+' (1)__following text__').html}</main>`);
   const measure=()=>page.locator('.marker-label').evaluateAll(nodes=>nodes.map(n=>{const r=document.createRange();r.selectNodeContents(n);const glyph=r.getBoundingClientRect();return [n.parentElement.getBoundingClientRect().width,n.getBoundingClientRect().width,glyph.width,glyph.height];}));
   for (const media of ['screen','print']) {
    await page.emulateMedia({media});await page.locator('#sheet').evaluate((n,c)=>n.textContent=c,originalCss);const before=await measure();
    await page.locator('#sheet').evaluate((n,c)=>n.textContent=c,css);const after=await measure();
    assert.equal(before.length,after.length);before.forEach((row,i)=>row.forEach((value,j)=>assert.ok(Math.abs(value-after[i][j])<.05,`unchanged ${media} marker and glyph geometry: ${i}/${j}`)));
   }
   await page.close();
  }
  for (const [surface, sheet] of [['viewer', css], ['panel', panelCss]]) for (const width of [1280,390]) {
   const page = await browser.newPage({viewport:{width,height:1000}});
   await page.route('**/*', route => route.abort());
   await page.setContent(`<style>${sheet}</style><style>body{margin:20px;background:white;color:black}.exam-doc{font:24px/2.5 var(--serif)!important;color:black!important;width:300px} .case{height:60px}.case .blk{display:inline!important;text-align:left!important}.case{display:block} #narrow{width:1px} .off,.off *{text-decoration:none!important}</style><main id="print-area" class="exam-doc" style="display:block">${rows.map((row,i)=>`<div class="case" id="c${i}">${row.html}</div>`).join('')}<div id="following">${M.render('(1)__word__ and <2>==text==').html}</div><div id="narrow">${M.render('(12) 〈12〉').html}</div></main>`);
   await page.evaluate(()=>document.fonts.ready);
   for (const media of ['screen','print']) {
    await page.emulateMedia({media});
    const layout = await page.evaluate(()=>({
     markers:[...document.querySelectorAll('.marker-parentheses,.marker-angle')].map(n=>({display:getComputedStyle(n).display,whiteSpace:getComputedStyle(n).whiteSpace,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})),
     labels:[...document.querySelectorAll('.marker-label')].map(n=>({minimum:getComputedStyle(n).minWidth,align:getComputedStyle(n).textAlign})),
     angleFonts:[...document.querySelectorAll('.marker-angle-glyph')].map(n=>getComputedStyle(n).fontFamily),
     following:[...document.querySelectorAll('#following .underline-marker span')].map(n=>getComputedStyle(n).textDecorationLine),
     decoration:[...document.querySelectorAll('.case .marker-label')].map(n=>({line:getComputedStyle(n).textDecorationLine,style:getComputedStyle(n).textDecorationStyle})),
     markerFont:getComputedStyle(document.querySelector('.marker-label')).fontFamily,
     fonts:[...document.fonts].map(n=>({family:n.family,unicodeRange:n.unicodeRange}))
    }));
    const missingStyles = layout.markers.some(n=>n.display!==(baseline?'inline-flex':'inline-block')||n.whiteSpace!=='nowrap') || layout.labels.some(n=>n.align!=='center'||n.minimum==='0px') || !layout.fonts.some(n=>n.family==='Exam Angle Brackets') || !layout.fonts.some(n=>n.family==='Exam Parentheses');
    if (baseline && surface==='panel') assert.ok(missingStyles, 'reproduce omitted panel marker styles');
    else assert.equal(missingStyles,false,`${surface} includes complete marker layout and font faces`);
    if (!baseline) {
     assert.ok(layout.angleFonts.every(n=>n.startsWith('"Exam Angle Brackets"')));
     assert.ok(layout.markerFont.startsWith('"Exam Parentheses"'));
     layout.decoration.forEach((n,i)=>{assert.equal(n.line,'underline'); assert.equal(n.style,['solid','double','wavy'][i%3]);});
    }
    assert.ok(layout.following.every(n=>n==='none'), 'marker preceding underlined text remains undecorated');
    for (let i=0;i<rows.length;i++) {
     const locator = page.locator('#c'+i);
     const decorated=await locator.screenshot({animations:'disabled'});
     await locator.evaluate(n=>n.classList.add('off'));
     const plain=await locator.screenshot({animations:'disabled'});
     await locator.evaluate(n=>n.classList.remove('off'));
     const visible=!decorated.equals(plain);
     if (!visible) missing++;
     report.push({surface,width,media,...rows[i],visible});
     if (!baseline) assert.ok(visible, `${surface} ${width} ${media} ${rows[i].style}${rows[i].marker} decoration is painted`);
    }
   }
   await page.emulateMedia({media:'screen'});
   await page.screenshot({path:path.join(evidence,`${baseline?'before':'after'}-${surface}-${width}.png`),fullPage:true});
   const pdfPath = path.join(evidence,`${baseline?'before':'after'}-${surface}-${width}.pdf`);
   await page.pdf({path:pdfPath,format:'A4',printBackground:true});
   if (!baseline) {
    await page.locator('.case').evaluateAll(nodes=>nodes.forEach(n=>n.classList.add('off')));
    const plainPath = pdfPath.replace('.pdf','-plain.pdf');
    await page.pdf({path:plainPath,format:'A4',printBackground:true});
    assert.equal(execFileSync('pdftotext',['-layout',pdfPath,'-'],{encoding:'utf8'}),execFileSync('pdftotext',['-layout',plainPath,'-'],{encoding:'utf8'}),'PDF text and pagination unchanged by marker decorations');
    const raster = file=>{const prefix=file.replace('.pdf','-raster');execFileSync('pdftoppm',['-f','1','-singlefile','-scale-to','1200','-png',file,prefix]);return fs.readFileSync(prefix+'.png');};
    assert.ok(!raster(pdfPath).equals(raster(plainPath)),'marker decoration is painted in actual PDF raster');
   }
   await page.close();
  }
  if (baseline) assert.ok(missing>0,'reproduce lost marker decoration');
  fs.writeFileSync(path.join(evidence,`${baseline?'before':'after'}.json`),JSON.stringify({missing,report},null,2));
  console.log(baseline ? `REPRODUCED: ${missing} missing decorations; panel marker styles absent` : 'PASS: painted single/double/wavy round/angle marker decorations, preceding markers undecorated, complete panel fonts/spacing/no-wrap; desktop/mobile screen/print and PDFs');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
