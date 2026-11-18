const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const { chromium } = require('../panel/node_modules/playwright');
(async () => {
 const source = fs.readFileSync(path.join(root, 'assets/css/main.css'), 'utf8');
 const asset = 'main-20261118squareimages.css';
 assert.equal(source, fs.readFileSync(path.join(root, 'assets/css', asset), 'utf8'));
 for (const file of ['index.html', 'setting/index.html']) assert.ok(fs.readFileSync(path.join(root,file),'utf8').includes(asset));
 const browser = await chromium.launch({executablePath:process.env.PANEL_CHROMIUM || undefined,headless:true,args:['--no-sandbox']});
 const page = await browser.newPage();
 const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="#cde"/><rect x="1" y="1" width="238" height="118" fill="none" stroke="black"/></svg>');
 for (const width of [1200,390]) {
  await page.setViewportSize({width,height:800});
  await page.setContent('<style>'+source+'</style><main class="exam-doc" id="print-area" style="display:block"><img class="exam-img" src="'+image+'"><figure><img class="exam-img" src="'+image+'"><figcaption>図1</figcaption></figure></main><button class="btn">UI button</button>');
  for (const media of ['screen','print']) {
   await page.emulateMedia({media});
   const values = await page.locator('.exam-img').evaluateAll(imgs => imgs.map(img => ({radius:getComputedStyle(img).borderRadius,width:img.getBoundingClientRect().width,height:img.getBoundingClientRect().height})));
   for(const value of values) {assert.equal(value.radius,'0px');assert.ok(value.width>0);assert.ok(value.height>0);}
   await page.screenshot({path:'/tmp/exam-square-'+width+'-'+media+'.png'});
  }
 }
 await page.pdf({path:'/tmp/exam-square-images.pdf',format:'A4'});
 await browser.close();
 console.log('PASS image corners: source/published CSS parity, viewer/settings references, desktop/mobile screen/print, PDF output');
})().catch(e=>{console.error(e);process.exit(1)});
