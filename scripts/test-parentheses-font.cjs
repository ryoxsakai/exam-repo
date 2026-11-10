// Read-only synthetic typography checks. Optional local official Google Fonts file.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const css=read('assets/css/main.css');
assert.match(css,/\.marker-parentheses \.marker-label \{ font-family: "Noto Serif JP", serif; \}/);
for(const file of ['index.html','setting/index.html','panel/index.html'])assert.match(read(file),/family=Noto\+Serif\+JP:wght@400;700/);
const panel=JSON.parse(read('worker/panel-resource.ts').slice(read('worker/panel-resource.ts').indexOf(' = ')+3).trim().replace(/;$/,''));
assert.ok(panel.includes('.marker-parentheses .marker-label { font-family: "Noto Serif JP", serif; }'));
console.log('PASS: scoped Noto Serif JP rule and Google Fonts loading in viewer, editor and panel');
if(!process.argv.includes('--browser'))process.exit(0);
(async()=>{
 const {chromium}=require('../panel/node_modules/playwright');
 const font=process.env.NOTOSERIF_FONT;assert.ok(font,'Provide official NotoSerifJP variable TTF via NOTOSERIF_FONT');
 const face='@font-face{font-family:"Noto Serif JP";font-weight:100 900;src:url(data:font/ttf;base64,'+fs.readFileSync(font).toString('base64')+')}';
 const browser=await chromium.launch({headless:true,...(process.env.PANEL_CHROMIUM?{executablePath:process.env.PANEL_CHROMIUM}:{})}),report=[];
 try{for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:900}});
  for(const media of ['screen','print'])for(const kind of ['web','panel']){
   await page.emulateMedia({media});await page.setContent('<style>'+face+(kind==='web'?css:panel.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1])+'</style><div class="exam-doc" id="fixture" style="font-size:16px"></div>');
   await page.addScriptTag({content:read('assets/js/markup.js')});
   await page.evaluate(()=>document.querySelector('#fixture').innerHTML=Markup.render('(A) (a) (W) (1) （A） (ア) (12) (AB) <1>\n\n**(A)**\n\n(A)__underlined__\n\n{{A}} heading [[A]] ((A))').html);
   await page.evaluate(async()=>{await document.fonts.load('16px "Noto Serif JP"','AaW1ア12AB');await document.fonts.ready;Markup.fitMarkerLabels(document);});
   const result=await page.evaluate(()=>[...document.querySelectorAll('.marker-parentheses')].map(n=>{
    const label=n.querySelector('.marker-label'),range=document.createRange();range.selectNodeContents(label);const r=range.getBoundingClientRect();
    return {text:n.textContent,font:getComputedStyle(label).fontFamily,size:parseFloat(getComputedStyle(n).fontSize),width:n.getBoundingClientRect().width,labelWidth:r.width,scale:n.firstElementChild.style.getPropertyValue('--marker-fit-scale')};
   }));
   for(const n of result){assert.equal(n.font,'"Noto Serif JP", serif');if(n.scale)assert.ok(Math.abs(n.width-n.size*1.5)<.05,JSON.stringify(n));}
   assert.ok(await page.evaluate(()=>document.fonts.check('16px "Noto Serif JP"','A')));
   const unrelated=await page.locator('.question-badge,.blank-badge,.choice-inline,.marker-angle .marker-label').evaluateAll(ns=>ns.map(n=>getComputedStyle(n).fontFamily));
   assert.ok(unrelated.every(f=>f!=='"Noto Serif JP", serif'));
   report.push({width,media,kind,markers:result});
   if(width===1280&&kind==='web'){await page.screenshot({path:'/tmp/exam-noto-'+media+'.png'});if(media==='print')await page.pdf({path:'/tmp/exam-noto.pdf',format:'A4'});}
  }
  await page.close();
 }
 fs.writeFileSync('/tmp/exam-noto-geometry.json',JSON.stringify(report,null,2));console.log('PASS: real Noto Serif JP, viewer/panel, desktop/mobile, screen/print; 1.5em fit and unrelated fonts preserved');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
