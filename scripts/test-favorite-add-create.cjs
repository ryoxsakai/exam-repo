// Uses only synthetic data; all network requests are intercepted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '../panel/node_modules/playwright');
const root = path.resolve(__dirname, '..'), origin = 'https://favorite-add.test';
const fixture = [{id: 1, name: '医療', parent_id: null}, {id: 2, name: '演習', parent_id: 1}, {id: 3, name: '医療', parent_id: null}, {id: 4, name: '演習', parent_id: 3}, {id: 90, name: '見出し', parent_id: null, kind: 'section'}];
for (let i = 5; i < 25; i++) fixture.push({id: i, name: i === 24 ? '<img src=x onerror=alert(1)>' : '深い階層と非常に長い名前' + i, parent_id: i === 5 ? 2 : i - 1});
(async () => {
 const executablePath = process.env.PANEL_CHROMIUM || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
 const browser = await chromium.launch({headless: !process.env.HEADED, ...(executablePath ? {executablePath} : {})});
 try {
 for (const viewport of [{width:1280,height:960},{width:390,height:844}]) {
  const context = await browser.newContext({viewport, serviceWorkers:'block'}), page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await context.route('**/*', route => {
   const url = new URL(route.request().url());
   if (url.origin !== origin) return route.fulfill({body:'',contentType:'application/javascript'});
   if(url.pathname.startsWith('/api/')) { assert.equal(route.request().method(),'GET'); return route.fulfill({contentType:'application/json',body:JSON.stringify({universities:[], exams:[], results:[],stop:[],level:[],vocab:[]})}); }
   const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1), file = path.resolve(root, relative);
   assert.ok(file.startsWith(root + path.sep));
   let body = fs.readFileSync(file);
   if(relative === 'assets/js/viewer.js') body = body.toString().replace('document.addEventListener("DOMContentLoaded", init);','window.__test = {state, openFavoriteAddModal, createFavoriteAddFolder, saveFavoriteAddModal}; document.addEventListener("DOMContentLoaded", init);');
   return route.fulfill({body,contentType:{'.html':'text/html','.js':'application/javascript','.css':'text/css'}[path.extname(file)] || 'application/octet-stream'});
  });
  await context.addInitScript(origin => localStorage.setItem('cf_worker_url',origin),origin);
  await page.goto(origin);
  await page.waitForFunction(() => !!window.__test);
  await page.evaluate(fixtureFolders => {
   window.Auth = {getCurrentUser: () => ({uid:'fixture'}), getIdToken: async () => 'fixture'};
   window.folders = fixtureFolders.filter(f => f.kind !== 'section'); window.rows = []; window.calls = []; window.failLoad = false; window.failAdd = false;
   Api.getFavorites = async () => {if(failLoad) throw new Error('取得エラー'); return JSON.parse(JSON.stringify({folders, favorites:rows, sections:[{id:90,name:'見出し',parent_id:null}]}));};
   Api.createFavoriteFolder = (name,parentId,kind) => {calls.push({type:'create',name,parentId,kind}); return new Promise((resolve,reject) => {window.complete = () => {const folder = {id:100 + calls.length,name,parent_id:parentId,sort_order:99}; folders.push(folder); resolve({folder});};window.fail = () => reject(new Error('保存エラー'));});};
   Api.addFavorite = async (examId,qnum,folderId) => {calls.push({type:'add',folderId}); rows.push({exam_id:examId,question_number:qnum,folder_id:folderId});};
   Api.copyFavorite = async (examId,qnum,folderId) => {calls.push({type:'copy',folderId}); if(failAdd){failAdd=false;throw new Error('追加エラー');} rows.push({exam_id:examId,question_number:qnum,folder_id:folderId});};
   __test.state.nav = {examId:7,qnum:1};
  }, fixture);
  const modal = page.locator('#favorite-add-modal'), list = page.locator('#fav-add-folder'), parent = page.locator('#fav-add-parent'), create = page.locator('#fav-add-create-save'), save = page.locator('#fav-add-save');
  const open = async () => {await page.evaluate(() => __test.openFavoriteAddModal());await page.waitForFunction(() => !document.getElementById('fav-add-new-folder').disabled);};
  const expand = async () => page.locator('#fav-add-new-folder').click();
  const close = async () => modal.getByRole('button',{name:'キャンセル',exact:true}).click();
  await open(); assert.equal(await save.isDisabled(),true);
  await list.locator('input[value="1"]').check(); await list.locator('input[value="4"]').check();
  await expand(); assert.equal(await page.locator('#favorite-folder-modal').isVisible(),false);
  const labels = await parent.locator('option').allTextContents();
  assert.equal(await list.locator('label').first().evaluate(n=>getComputedStyle(n).display),'flex');
  assert.ok(labels.includes('医療（ID: 1）'));assert.ok(labels.includes('医療 / 演習（ID: 2）'));assert.ok(labels.find(l=>l.includes('<img src=x onerror=alert(1)>')));assert.ok(!labels.includes('見出し'));
  assert.equal(await list.locator('img').count(),0);
  await create.click(); assert.equal(await page.evaluate(() => calls.length),0);
  await page.locator('#fav-add-name').fill('演習');
  const beforeInvalid = await page.evaluate(() => calls.length);
  await page.evaluate(() => {const o=document.createElement('option');o.value='90';document.getElementById('fav-add-parent').appendChild(o);document.getElementById('fav-add-parent').value='90';__test.createFavoriteAddFolder();});
  assert.equal(await page.evaluate(() => calls.length),beforeInvalid);
  await parent.selectOption('24');
  await page.evaluate(() => {__test.createFavoriteAddFolder();__test.createFavoriteAddFolder();__test.saveFavoriteAddModal();});
  assert.equal(await page.evaluate(() => calls.length),1);assert.equal(await save.isDisabled(),true);assert.equal(await parent.isDisabled(),true);assert.equal(await page.locator('#fav-add-create-cancel').isDisabled(),true);
  await page.screenshot({path:path.join(root,'../favorite-add-'+viewport.width+'-creating.png'),fullPage:true});
  await page.evaluate(() => complete());await page.waitForFunction(() => document.getElementById('fav-add-create').hidden);
  assert.deepEqual(await list.locator('input:checked').evaluateAll(ns=>ns.map(n=>Number(n.value))),[1,101,4]);
  assert.equal(await page.evaluate(() => calls.filter(c=>c.type!=='create').length),0);
  await expand();await page.locator('#fav-add-name').fill('キャンセル');await page.locator('#fav-add-create-cancel').click();assert.equal(await page.locator('#fav-add-create').isVisible(),false);assert.equal(await list.locator('input:checked').count(),3);
  // Root creation + failure/retry preserve fields and selections.
  await expand();await page.locator('#fav-add-name').fill('最上位');await create.click();assert.equal(await page.evaluate(() => calls[1].parentId),null);await page.evaluate(() => fail());await page.waitForFunction(() => !document.getElementById('fav-add-create-save').disabled);assert.equal(await page.locator('#fav-add-name').inputValue(),'最上位');assert.equal(await list.locator('input:checked').count(),3);
  await create.click();await page.evaluate(() => complete());await page.waitForFunction(() => document.getElementById('fav-add-create').hidden);
  // Visible layout and long paths stay within modal at both widths.
  await expand();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
  const bounds = await modal.locator('.modal').boundingBox();assert.ok(bounds.x>=0 && bounds.x+bounds.width<=viewport.width);
  await page.waitForTimeout(3600);await page.screenshot({path:path.join(root,'../favorite-add-'+viewport.width+'.png'),fullPage:true});
  await page.locator('#fav-add-create-cancel').click();
  // Partial multi-add failure retries only destinations still pending.
  await page.evaluate(() => {failAdd=true;__test.saveFavoriteAddModal();__test.saveFavoriteAddModal();});await page.waitForFunction(() => !document.getElementById('fav-add-save').disabled);
  assert.equal(await page.evaluate(() => calls.filter(c=>c.type==='add').length),1);assert.equal(await list.locator('input[value="1"]').count(),0);
  await save.click();await page.waitForFunction(() => !document.getElementById('favorite-add-modal').classList.contains('open'));
  assert.deepEqual(await page.evaluate(() => rows.map(r=>r.folder_id)),[1,101,4,103]);
  // Reopen resets drafts, excludes occupied folders; creation alone never adds questions.
  await open();assert.equal(await list.locator('input:checked').count(),0);assert.equal(await page.locator('#fav-add-name').inputValue(),'');assert.equal(await list.locator('input[value="1"]').count(),0);await expand();await page.locator('#fav-add-name').fill('古い処理');await create.click();await close();await open();await expand();await page.locator('#fav-add-name').fill('新しい入力');await page.evaluate(() => complete());await page.waitForTimeout(30);assert.equal(await page.locator('#fav-add-name').inputValue(),'新しい入力');assert.equal(await list.locator('input:checked').count(),0);await close();
  // Load failure is safe and recoverable by reopen.
  await page.evaluate(() => {failLoad=true;__test.openFavoriteAddModal();});await page.waitForFunction(() => document.getElementById('fav-add-status').textContent.includes('取得に失敗'));assert.equal(await save.isDisabled(),true);assert.equal(await page.locator('#fav-add-new-folder').isDisabled(),true);await close();await page.evaluate(() => failLoad=false);await open();await close();
  // Close during delayed load must not reopen; an old load cannot replace next dialog.
  await page.evaluate(() => {Api.getFavorites=()=>new Promise(r=>window.resolveLoad=r);__test.openFavoriteAddModal();});await close();await page.evaluate(() => resolveLoad({folders,favorites:rows}));await page.waitForTimeout(30);assert.equal(await modal.isVisible(),false);
  // Empty account can create its first folder and then add.
  await page.evaluate(() => {folders=[]; rows=[]; Api.getFavorites=async()=>JSON.parse(JSON.stringify({folders,favorites:rows}));});await open();await expand();assert.deepEqual(await parent.locator('option').allTextContents(),['最上位']);await page.locator('#fav-add-name').fill('初回');await create.click();await page.evaluate(() => complete());await page.waitForFunction(() => !document.getElementById('fav-add-save').disabled);assert.equal(await list.locator('input:checked').count(),1);assert.equal(await page.evaluate(() => rows.length),0);await close();
  // A successful create with a malformed response must not allow duplicate retry.
  await open();await expand();await page.waitForTimeout(3600);await page.screenshot({path:path.join(root,'../favorite-add-'+viewport.width+'-empty.png'),fullPage:true});await page.locator('#fav-add-name').fill('不明な結果');
  await page.evaluate(() => Api.createFavoriteFolder=async()=>({}));await create.click();await page.waitForFunction(()=>document.getElementById('fav-add-status').textContent.includes('結果を取得できません'));
  assert.equal(await create.isDisabled(),true);assert.equal(await save.isDisabled(),true);await close();
  await page.evaluate(() => {Auth.getCurrentUser=()=>null;__test.openFavoriteAddModal();});assert.equal(await modal.isVisible(),false);
  assert.deepEqual(errors,[]);console.log('PASS Mac Chrome '+viewport.width+': hierarchy/duplicates/escaping, selection preservation, create-only, root/nested, busy/double-click, cancel/reopen/stale results, load/save errors, partial multi-add retry, empty account, layout');
  await context.close();
 }
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
