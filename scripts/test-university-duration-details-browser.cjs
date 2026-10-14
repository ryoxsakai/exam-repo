// All requests use synthetic data; this test never writes production.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('../panel/node_modules/playwright');
const root=path.resolve(__dirname,'..'),origin='https://duration-details.test';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PANEL_CHROMIUM});
 try {for(const width of [1280,390]) {
  const context=await browser.newContext({viewport:{width,height:960}}),page=await context.newPage();
  let data={university_id:1,university_minutes:60,combined:false,schedules:[{schedule:'前期',minutes:null},{schedule:'後期',minutes:90}]},writes=0;
  await context.addInitScript(o=>localStorage.setItem('cf_worker_url',o),origin);
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!==origin)return route.fulfill({body:'',contentType:route.request().resourceType()==='stylesheet'?'text/css':'application/javascript'});
   if(url.pathname.startsWith('/api/')) {
    let body;
    if(url.pathname==='/api/universities')body={universities:[{id:1,name:'合成大学',reading:'ごうせい',print_minutes:data.university_minutes,print_combined:data.combined?1:0}]};
    else if(url.pathname==='/api/universities/1/print-duration') {
     if(route.request().method()==='PUT'){const b=route.request().postDataJSON();writes++;data={...data,university_minutes:b.university_minutes,combined:b.combined,schedules:data.schedules.map(r=>({...r,minutes:b.schedules?.[r.schedule]??null}))};}
     body=data;
    }else throw new Error('Unexpected API '+url.pathname);
    return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
   }
   const relative=url.pathname==='/setting/'?'setting/index.html':url.pathname.slice(1),file=path.resolve(root,relative);
   let body=fs.readFileSync(file,'utf8');
   if(relative==='assets/js/settings.js')body=body.replace('    init();\n    wireSearchModalTabs();\n    wireEditModal();','    wireUniYomi(); UI.wireModal(el("university-duration-modal")); loadUniYomi(); document.querySelector("[data-panel=uniyomi]").classList.add("active");');
   return route.fulfill({contentType:path.extname(file)==='.html'?'text/html':path.extname(file)==='.css'?'text/css':'application/javascript',body});
  });
  await page.goto(origin+'/setting/');
  await page.locator('[data-duration-detail]').click();
  await page.locator('#university-duration-apply').waitFor();
  await page.waitForFunction(()=>!document.getElementById('university-duration-apply').disabled);
  await page.locator('#university-duration-combined').check();
  await page.locator('#university-duration-parent').fill('');
  await page.locator('[data-duration-schedule="前期"]').fill('100');
  await page.locator('#university-duration-modal [data-close]').last().click();
  assert.equal(writes,0);
  await page.locator('[data-duration-detail]').click();
  await page.waitForFunction(()=>!document.getElementById('university-duration-apply').disabled);
  assert.equal(await page.locator('#university-duration-parent').inputValue(),'60');
  assert.equal(await page.locator('#university-duration-combined').isChecked(),false,'Cancel discards edits');
  await page.locator('#university-duration-combined').check();
  await page.locator('#university-duration-parent').fill('');
  await page.locator('[data-duration-schedule="前期"]').fill('100');
  await page.locator('[data-duration-schedule="後期"]').fill('');
  await page.locator('#university-duration-apply').click(); assert.equal(writes,0,'Apply is draft');
  await page.locator('#uniyomi-save').click();
  await page.waitForFunction(()=>!document.getElementById('uniyomi-save').disabled);
  assert.equal(writes,1);assert.equal(data.university_minutes,null);assert.equal(data.combined,true);assert.deepEqual(data.schedules.map(r=>r.minutes),[100,null]);
  await page.reload();await page.locator('[data-duration-detail]').click();await page.waitForFunction(()=>!document.getElementById('university-duration-apply').disabled);
  assert.equal(await page.locator('#university-duration-combined').isChecked(),true);
  assert.equal(await page.locator('[data-duration-schedule="前期"]').inputValue(),'100');
  await page.waitForTimeout(350);
  await page.screenshot({path:'/tmp/exam-duration-details-'+width+'.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No horizontal overflow');
  console.log('PASS: '+width+'px details modal cancel/draft/save/reload, child-only and combined');await context.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
