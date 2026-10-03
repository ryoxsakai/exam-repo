// Synthetic browser regression: no real login, user data, or external API writes.
// npm ci --prefix panel; node scripts/test-favorite-folder-parent.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '../panel/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const origin = 'https://favorite-folder.test';
const fixture = [
  {id: 1, name: '医療', parent_id: null, sort_order: 0},
  {id: 2, name: '演習', parent_id: 1, sort_order: 0},
  {id: 3, name: '英語', parent_id: null, sort_order: 1},
  {id: 4, name: '演習', parent_id: 3, sort_order: 0},
  {id: 5, name: '<img src=x onerror=alert(1)>', parent_id: 2, sort_order: 0},
  {id: 6, name: '演習', parent_id: 3, sort_order: 1}
];
(async () => {
  const browser = await chromium.launch({headless: true, ...(process.env.PANEL_CHROMIUM ? {executablePath: process.env.PANEL_CHROMIUM} : {})});
  try {
    for (const viewport of [{width: 1280, height: 960}, {width: 390, height: 844}]) {
      const context = await browser.newContext({viewport, serviceWorkers: 'block'});
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.fulfill({body: '', contentType: 'application/javascript'});
        if (url.pathname.startsWith('/api/')) {
          assert.equal(route.request().method(), 'GET');
          return route.fulfill({contentType: 'application/json', body: JSON.stringify({universities: [], exams: [], results: [], stop: [], level: [], vocab: []})});
        }
        const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        const file = path.resolve(root, relative);
        assert.ok(file.startsWith(root + path.sep));
        let body = fs.readFileSync(file);
        if (relative === 'assets/js/viewer.js') body = body.toString().replace('document.addEventListener("DOMContentLoaded", init);', 'window.__favTest = {state, openFavoriteFolderModal, saveFavoriteFolderModal, favoriteFolderParentTargets}; document.addEventListener("DOMContentLoaded", init);');
        return route.fulfill({body, contentType: {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css'}[path.extname(file)] || 'application/octet-stream'});
      });
      await context.addInitScript(origin => localStorage.setItem('cf_worker_url', origin), origin);
      await page.goto(origin);
      await page.waitForFunction(() => !!window.__favTest);
      await page.evaluate(folders => {
        window.Auth = {getCurrentUser: () => ({uid: 'fixture'}), getIdToken: async () => 'fixture'};
        window.calls = [];
        window.testFolders = folders;
        Api.getFavorites = async () => ({folders: testFolders, favorites: [], sections: [{id: 90, name: '見出し', parent_id: null}]});
        Api.createFavoriteFolder = (name, parentId, kind) => {
          calls.push({name, parentId, kind});
          return new Promise((resolve, reject) => { window.complete = () => {
            testFolders.push({id: 100 + calls.length, name, parent_id: parentId, sort_order: 99}); resolve({});
          }; window.fail = () => reject(new Error('親フォルダが見つかりません')); });
        };
        Api.renameFavoriteFolder = async (id, name) => { calls.push({id, name, rename: true}); };
        __favTest.state.favSet = null;
      }, fixture);
      await page.locator('[data-tab="favorites"]').click();
      const modal = page.locator('#favorite-folder-modal');
      const select = page.locator('#fav-folder-parent');
      const save = page.locator('#fav-folder-save');
      const open = async () => { await page.locator('#btn-favorites-new-folder').click(); await page.waitForFunction(() => !document.getElementById('fav-folder-save').disabled); };
      await open();
      assert.deepEqual(await select.locator('option').allTextContents(), ['最上位', '医療', '医療 / 演習', '医療 / 演習 / <img src=x onerror=alert(1)>', '英語', '英語 / 演習（ID: 4）', '英語 / 演習（ID: 6）']);
      assert.equal(await select.inputValue(), '');
      assert.equal(await select.locator('img').count(), 0);
      await save.click(); // Empty name: no API write.
      assert.equal(await page.evaluate(() => calls.length), 0);
      await select.selectOption('2');
      await page.locator('#fav-folder-name').fill('  子フォルダ  ');
      await page.evaluate(() => { __favTest.state.favCollapsed = {1: true, 2: true}; __favTest.saveFavoriteFolderModal(); __favTest.saveFavoriteFolderModal(); });
      assert.equal(await save.isDisabled(), true);
      assert.deepEqual(await page.evaluate(() => calls), [{name: '子フォルダ', parentId: 2, kind: 'folder'}]);
      await page.evaluate(() => complete());
      await page.waitForFunction(() => !document.getElementById('favorite-folder-modal').classList.contains('open'));
      assert.deepEqual(await page.evaluate(() => __favTest.state.favCollapsed), {1: false, 2: false});
      assert.ok(await page.locator('.fav-node[data-node="folder:101"]').isVisible());
      // Root is reset on reopen. Cancel/close must never save.
      await open();
      assert.equal(await select.inputValue(), '');
      await select.selectOption('4');
      await modal.getByRole('button', {name: 'キャンセル'}).click();
      await page.evaluate(() => __favTest.saveFavoriteFolderModal());
      assert.equal(await page.evaluate(() => calls.length), 1);
      await open();
      await page.locator('#fav-folder-name').fill('最上位の子');
      await save.click();
      assert.equal(await page.evaluate(() => calls[1].parentId), null);
      // An old in-flight save must not dismiss a newly opened modal.
      await modal.getByRole('button', {name: 'キャンセル'}).click();
      await open();
      await page.locator('#fav-folder-name').fill('次の入力');
      await page.evaluate(() => complete());
      await page.waitForTimeout(30);
      assert.ok(await modal.isVisible());
      assert.equal(await page.locator('#fav-folder-name').inputValue(), '次の入力');
      await select.selectOption('4');
      await save.click();
      await page.evaluate(() => fail());
      await page.waitForFunction(() => !document.getElementById('fav-folder-save').disabled);
      assert.ok(await modal.isVisible());
      assert.equal(await select.inputValue(), '4');
      await save.click(); // Retry preserves selected parent.
      assert.equal(await page.evaluate(() => calls[3].parentId), 4);
      await page.evaluate(() => complete());
      await page.waitForFunction(() => !document.getElementById('favorite-folder-modal').classList.contains('open'));
      // Locally removed parent and sections cannot become a destination.
      await open();
      await select.selectOption('6');
      await page.locator('#fav-folder-name').fill('invalid');
      await page.evaluate(() => { __favTest.state.favFolders = __favTest.state.favFolders.filter(f => f.id !== 6); });
      await save.click();
      assert.equal(await page.evaluate(() => calls.length), 4);
      // Rename never exposes a parent choice or changes membership.
      await page.evaluate(() => __favTest.openFavoriteFolderModal({mode: 'rename', kind: 'folder', id: 2, name: '演習'}));
      assert.equal(await select.isVisible(), false);
      await page.locator('#fav-folder-name').fill('改名');
      await save.click();
      await page.waitForFunction(() => !document.getElementById('favorite-folder-modal').classList.contains('open'));
      assert.deepEqual(await page.evaluate(() => calls[4]), {id: 2, name: '改名', rename: true});
      await page.locator('#btn-favorites-new-section').click();
      assert.equal(await select.isVisible(), false);
      await page.locator('#fav-folder-name').fill('セクション');
      await save.click();
      assert.deepEqual(await page.evaluate(() => calls[5]), {name: 'セクション', parentId: null, kind: 'section'});
      await page.evaluate(() => complete());
      await page.waitForFunction(() => !document.getElementById('favorite-folder-modal').classList.contains('open'));
      // Empty account and login interruption.
      await page.evaluate(() => { window.testFolders = []; __favTest.state.favFolders = []; });
      await open();
      assert.deepEqual(await select.locator('option').allTextContents(), ['最上位']);
      await modal.getByRole('button', {name: '閉じる', exact: true}).click();
      await page.evaluate(() => { Auth.getCurrentUser = () => null; });
      await page.locator('#btn-favorites-new-folder').click();
      assert.equal(await modal.isVisible(), false);
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS ${viewport.width}px: parent paths, ID disambiguation, escaping, nested/root create, cancel/reopen, repeat save, failure/retry, stale parent, rename/section, empty account, signed out`);
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
