const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('../panel/node_modules/playwright');
const root=path.resolve(__dirname,'..'),origin='https://university-settings.test';
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.PANEL_CHROMIUM?{executablePath:process.env.PANEL_CHROMIUM}:{})});
try{for(const width of [1280,390]){
 const context=await browser.newContext({viewport:{width,height:1000}});let universities=[{id:1,name:'合成大学',reading:'ごうせい',abbreviation:'合成',print_minutes:60}],writes=0,fail=false;
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(u.origin!==origin)return route.fulfill({status:200,body:''});
 if(u.pathname==='/api/universities')return route.fulfill({json:{universities}});
 if(u.pathname==='/api/universities/1/print-duration'){writes++;if(fail)return route.fulfill({status:500,json:{error:'Synthetic failure'}});universities[0].print_minutes=req.postDataJSON().university_minutes;return route.fulfill({json:{university_minutes:universities[0].print_minutes}});}
 const rel=u.pathname==='/setting/'?'setting/index.html':u.pathname.slice(1);let body=fs.readFileSync(path.join(root,rel));
 if(rel==='assets/js/settings.js')body=body.toString().replace(/document.addEventListener\("DOMContentLoaded", function \(\) \{[\s\S]*?\n  \}\);/, 'window.__settingsTest={loadUniYomi,saveUniYomi,rebuildSetTabs,SET_ORDER,wireUniYomi};');
 return route.fulfill({body,contentType:rel.endsWith('.html')?'text/html':rel.endsWith('.css')?'text/css':'application/javascript'});
 });
 await context.addInitScript(origin=>localStorage.setItem('cf_worker_url',origin),origin);
 await page.goto(origin+'/setting/',{waitUntil:'networkidle'});
 await page.evaluate(()=>{const t=__settingsTest;t.wireUniYomi();t.rebuildSetTabs(['extllm','ingest','ingestcfg','corpus',...t.SET_ORDER],'extllm');UI.setActiveTab(document.querySelector('#set-tabs'),'uniyomi');t.loadUniYomi();});
 await page.locator('[data-minutes]').waitFor();
 assert.equal(await page.locator('#set-tabs [data-tab]').count(),6);
 for(const id of ['extllm','ingest','ingestcfg','corpus'])assert.equal(await page.locator('#set-tabs [data-tab="'+id+'"]').count(),0);
 assert.equal(await page.locator('[data-minutes]').inputValue(),'60');
 await page.locator('[data-minutes]').fill('75');await page.locator('#uniyomi-save').click();await page.waitForFunction(()=>document.querySelector('[data-minutes]')?.value==='75'&&!document.querySelector('#uniyomi-save').disabled);assert.equal(universities[0].print_minutes,75);
 await page.locator('[data-minutes]').fill('0');await page.locator('#uniyomi-save').click();assert.equal(writes,1,'Invalid values do not save');
 fail=true;await page.locator('[data-minutes]').fill('90');await page.locator('#uniyomi-save').click();await page.waitForFunction(()=>document.querySelector('#uniyomi-status').textContent.includes('Synthetic failure'));assert.equal(await page.locator('[data-minutes]').inputValue(),'90');assert.equal(universities[0].print_minutes,75);
 fail=false;await page.locator('#uniyomi-save').click();await page.waitForFunction(()=>!document.querySelector('#uniyomi-save').disabled);assert.equal(universities[0].print_minutes,90);
 await page.locator('[data-minutes]').fill('');await page.locator('#uniyomi-save').click();await page.waitForFunction(()=>!document.querySelector('#uniyomi-save').disabled);assert.equal(universities[0].print_minutes,null);
 const size=await page.locator('[data-minutes]').evaluate(e=>({right:e.getBoundingClientRect().right,width:document.documentElement.clientWidth}));assert.ok(size.right<=size.width);
 await page.screenshot({path:'/tmp/university-settings-'+width+'.png'});assert.deepEqual(errors,[]);console.log('PASS '+width+': hidden tabs, read/save/reset/retry/validation, mobile fits');await context.close();
}}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
