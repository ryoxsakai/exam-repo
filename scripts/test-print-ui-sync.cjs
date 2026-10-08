// Synthetic browser regression: all requests intercepted; no real user data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('../panel/node_modules/playwright');
const root = path.resolve(__dirname, '..'), origin = 'https://print-ui.test';
(async () => {
  const browser = await chromium.launch({headless: true, ...(process.env.PANEL_CHROMIUM ? {executablePath: process.env.PANEL_CHROMIUM} : {})});
  try {
    for (const width of [1280, 390]) {
      const context = await browser.newContext({viewport: {width, height: 900}, isMobile: width < 640, hasTouch: width < 640, serviceWorkers: 'block'});
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.fulfill({body: '', contentType: 'application/javascript'});
        if (url.pathname.startsWith('/api/')) return route.fulfill({json: {exams: [], universities: [], results: [], stop: [], level: [], vocab: []}});
        const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        let body = fs.readFileSync(path.join(root, rel));
        if (rel === 'assets/js/auth.js') body = 'window.Auth={init(){},onChange(){},getCurrentUser(){return {uid:"fixture"}},getIdToken(){return Promise.resolve("fixture")}}';
        if (rel === 'assets/js/viewer.js') body = body.toString().replace('document.addEventListener("DOMContentLoaded", init);', 'window.__printUI={state,multiPrint,openPrintTab,loadPrintPreview,renderMultiControls,commitFavDrop,renderFavorites}; document.addEventListener("DOMContentLoaded", init);');
        return route.fulfill({body, contentType: {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css'}[path.extname(rel)] || 'text/plain'});
      });
      await context.addInitScript(o => localStorage.setItem('cf_worker_url', o), origin);
      await page.goto(origin);
      await page.evaluate(() => {
        window.source = {folders: [{id: 1, name: 'Original', parent_id: null, sort_order: 0}], favorites: [{entry_id: 'a', exam_id: 11, question_number: 1, folder_id: 1, sort_order: 0}, {entry_id: 'b', exam_id: 12, question_number: 1, folder_id: 1, sort_order: 1}], sections: []};
        window.savedSets = [{id: 'saved', name: 'Saved', archived: false}];
        Api.getFavorites = async () => structuredClone(source);
        Api.printSets = async () => ({print_sets: structuredClone(savedSets), order_revision: 1});
        Api.getExams = async () => ({exams: [{id: 11, year: 2026, university_name: 'Fixture', schedule: '前期'}]});
        Api.getPrintDuration = async id => ({exam_id: id, university_id: 1, university_minutes: 60, exam_minutes: null, effective_minutes: 60, source: 'university'});
        Api.getExam = async id => ({exam: {id, year: 2026, university_name: 'Fixture', schedule: '前期', questions: [{exam_id: id, question_number: 1, problem_text: '{{本文}}\nSynthetic passage.', answer_text: 'answer'}]}});
      });
      await page.locator('[data-tab="favorites"]').click();
      const toggle = page.locator('label.mode-toggle').filter({has: page.locator('#favorites-sets-toggle')});
      const toggleState = t => t.locator('.mode-toggle-state').evaluate(e => getComputedStyle(e, '::after').content);
      assert.equal(await toggleState(toggle), '"OFF"');
      assert.ok((await toggle.boundingBox()).x < (await page.locator('#btn-favorites-new-folder').boundingBox()).x);
      await toggle.click();
      assert.equal(await page.locator('#favorites-sets-toggle').isChecked(), true);
      assert.equal(await toggleState(toggle), '"ON"');
      await toggle.click();
      await page.locator('#favorites-sets-toggle').focus();
      await page.keyboard.press('Space');
      assert.equal(await page.locator('#favorites-sets-toggle').isChecked(), true);
      await page.keyboard.press('Space');
      await page.locator('[data-tab="print"]').click();
      await page.locator('#pr-tree .print-single-only .tree-row-fav').click();
      await page.locator('[data-favfolder="1"]').click();
      await page.waitForFunction(() => __printUI.state.printExam?.questions.length === 2);
      await page.locator('#pr-questions-open').click();
      const rows = page.locator('#pr-questions-modal .pr-secgroup:first-child .check-inline');
      const boxes = await rows.evaluateAll(es => es.map(e => ({h: e.getBoundingClientRect().height, y: e.getBoundingClientRect().y})));
      assert.ok(boxes[0].h <= 30 && boxes[1].y - boxes[0].y <= 34, JSON.stringify(boxes));
      await page.locator('[data-prq="11:1"]').uncheck();
      await page.screenshot({path: `/tmp/print-ui-${width}-questions.png`, fullPage: true});
      await page.locator('#pr-questions-modal [data-print-close]').first().click();
      const lineHeight = await page.locator('#print-preview .exam-doc').first().evaluate(e => getComputedStyle(e).lineHeight);
      await page.evaluate(() => { __printUI.state.printTitleDrafts = {'1': ['', 'Unsaved cover', '']}; });
      await page.locator('[data-tab="favorites"]').click();
      await page.evaluate(() => {
        source.folders[0].name = 'Renamed'; source.favorites.reverse(); source.favorites.forEach((f, i) => f.sort_order = i);
        source.favorites.push({entry_id: 'c', exam_id: 13, question_number: 1, folder_id: 1, sort_order: 2});
        savedSets.push({id: 'new', name: 'New saved set', archived: false});
      });
      await page.locator('[data-tab="print"]').click();
      await page.waitForFunction(() => __printUI.state.printExam?.questions.length === 3);
      assert.deepEqual(await page.evaluate(() => __printUI.state.printExam.questions.map(q => q.exam_id)), [12, 11, 13]);
      assert.equal(await page.evaluate(() => __printUI.state.printQSel['11:1']), false);
      assert.equal(await page.evaluate(() => __printUI.state.printQSel['13:1']), true);
      assert.equal(await page.evaluate(() => __printUI.state.printTitleDrafts['1'][1]), 'Unsaved cover');
      assert.match(await page.locator('[data-favfolder="1"]').innerText(), /Renamed/);
      assert.equal(await page.locator('#print-preview .exam-doc').first().evaluate(e => getComputedStyle(e).lineHeight), lineHeight);
      // A reorder may be pending when the user switches to printing.
      await page.locator('[data-tab="favorites"]').click();
      await page.evaluate(() => {
        Api.reorderFavorites = (parentId, items) => new Promise(resolve => {
          window.finishReorder = () => {
            items.forEach((item, i) => { source.favorites.find(f => f.entry_id === item.entryId).sort_order = i; });
            resolve({});
          };
        });
        __printUI.commitFavDrop('fav:c', {parentId: 1, before: 'fav:b'});
      });
      await page.locator('[data-tab="print"]').click();
      await page.waitForFunction(() => __printUI.state.printExam?.questions[0].exam_id === 12);
      await page.evaluate(() => finishReorder());
      await page.waitForFunction(() => __printUI.state.printExam?.questions[0].exam_id === 13);
      assert.equal(await page.evaluate(() => __printUI.state.printQSel['11:1']), false);
      // Rename/remove/section edits finishing after the tab switch also refresh.
      await page.evaluate(() => {
        source.folders[0].name = 'Final folder';
        source.favorites = source.favorites.filter(f => f.exam_id !== 12);
        source.sections = [{id: 9, name: 'New heading', parent_id: 1, sort_order: -1}];
        __printUI.renderFavorites();
      });
      await page.waitForFunction(() => __printUI.state.printExam?.questions.length === 2 && __printUI.state.printExam.items[0].name === 'New heading');
      assert.match(await page.locator('[data-favfolder="1"]').innerText(), /Final folder/);
      const multiToggle = page.locator('label.mode-toggle').filter({has: page.locator('#pr-multi')});
      assert.ok((await multiToggle.boundingBox()).x < (await page.locator('#btn-print-run').boundingBox()).x);
      await multiToggle.click();
      await page.evaluate(() => { __printUI.multiPrint.name = 'Unsaved set'; __printUI.multiPrint.cover.lines = ['', 'Draft set cover', '']; __printUI.renderMultiControls(); });
      await page.locator('[data-tab="favorites"]').click();
      await page.locator('[data-tab="print"]').click();
      await page.waitForFunction(() => __printUI.multiPrint.list.length === 2);
      assert.equal(await page.evaluate(() => __printUI.multiPrint.name), 'Unsaved set');
      assert.equal(await page.evaluate(() => __printUI.multiPrint.cover.lines[1]), 'Draft set cover');
      assert.equal(await toggleState(multiToggle), '"ON"');
      await page.waitForTimeout(300);
      await page.screenshot({path: `/tmp/print-ui-${width}-toggles.png`, fullPage: true});
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
      // Failed favorites refresh leaves a set draft intact; retry recovers.
      await page.evaluate(() => { Api.getFavorites = async () => { throw new Error('Synthetic refresh failure'); }; __printUI.openPrintTab(); });
      await page.waitForFunction(() => document.body.textContent.includes('Synthetic refresh failure'));
      assert.equal(await page.evaluate(() => __printUI.multiPrint.name), 'Unsaved set');
      await page.evaluate(() => { Api.getFavorites = async () => structuredClone(source); __printUI.openPrintTab(); });
      await page.waitForFunction(() => __printUI.state.favSet !== null);
      await page.locator('[data-tab="favorites"]').click();
      await page.waitForTimeout(300);
      await page.screenshot({path: `/tmp/print-ui-${width}-favorites.png`, fullPage: true});
      // Returning to printing must not reload a single exam's unsaved time inputs.
      await page.locator('[data-tab="print"]').click();
      await multiToggle.click();
      await page.locator('#pr-tree .tree-row-uni').click();
      await page.locator('#pr-tree .tree-row-year').click();
      await page.locator('#pr-tree .tree-row-sched.print-single-only').click();
      await page.waitForFunction(() => __printUI.state.printExam?.kind === 'exam');
      await page.locator('#pr-settings-open').click();
      await page.locator('#pr-duration-university').fill('77');
      await page.locator('#pr-duration-exam').fill('88');
      await page.locator('#pr-settings-modal [data-print-close]').first().click();
      await page.locator('[data-tab="favorites"]').click();
      await page.locator('[data-tab="print"]').click();
      await page.waitForTimeout(300);
      assert.equal(await page.locator('#pr-duration-university').inputValue(), '77');
      assert.equal(await page.locator('#pr-duration-exam').inputValue(), '88');
      assert.deepEqual(errors, []);
      console.log(`PASS: ${width}px compact questions, toggle placement/state, live favorites order/rename/add, exclusions, cover/set drafts, unchanged passage spacing`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
