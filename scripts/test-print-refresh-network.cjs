// Real API client with intercepted HTTP, deferred replies and 503 failures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {chromium} = require('../panel/node_modules/playwright');
const root = path.resolve(__dirname, '..'), origin = 'https://print-refresh.test';
const only = process.env.PRINT_REFRESH_CASE;
const waitFor = async (condition, description) => {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for ' + description);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};
const evidence = '/tmp/exam-print-sets-qa/refresh';
fs.mkdirSync(evidence, {recursive: true});
(async () => {
  const browser = await chromium.launch({headless: true, ...(process.env.PANEL_CHROMIUM ? {executablePath: process.env.PANEL_CHROMIUM} : {})});
  try {
    for (const width of [1280, 390]) {
      const context = await browser.newContext({viewport: {width, height: 900}, isMobile: width < 640, hasTouch: width < 640, serviceWorkers: 'block'});
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      const exams = [11, 12, 13].map(id => ({id, university_id: 1, year: 2026, university_name: 'Fixture', schedule: String(id)}));
      let source = {folders: [{id: 1, name: 'Fixture folder', parent_id: null, sort_order: 0}], favorites: [11, 12].map((id, i) => ({entry_id: 'base:' + id, exam_id: id, question_number: 1, folder_id: 1, sort_order: i})), sections: []};
      let sets = [{id: 'old', name: 'Old set', archived: false}], favoritesMode = 'normal', setsMode = 'normal', holdExams = false;
      let favoriteReplies = [], examReplies = [], setReads = 0, favoriteReads = 0;
      const success = data => ({status: 200, json: data});
      const failure = {status: 503, json: {error: 'Synthetic favorites unavailable'}};
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.fulfill({body: '', contentType: 'application/javascript'});
        if (url.pathname.startsWith('/api/')) {
          assert.equal(route.request().method(), 'GET', 'No real/synthetic data writes');
          if (url.pathname === '/api/favorites') {
            favoriteReads++;
            if (favoritesMode === 'abort') return route.abort('failed');
            if (favoritesMode === 'hold') return route.fulfill(await new Promise(resolve => favoriteReplies.push(resolve)));
            return route.fulfill(favoritesMode === 'fail' ? failure : success(source));
          }
          if (url.pathname === '/api/print-sets') {
            setReads++;
            return route.fulfill(setsMode === 'fail' ? {status: 503, json: {error: 'Synthetic sets unavailable'}} : success({print_sets: sets, order_revision: setReads}));
          }
          if (url.pathname === '/api/exams') return route.fulfill(success({exams: exams.filter(e => !url.searchParams.get('schedule') || e.schedule === url.searchParams.get('schedule'))}));
          const match = url.pathname.match(/^\/api\/exams\/(\d+)(\/print-duration)?$/);
          if (match) {
            const id = Number(match[1]);
            if (match[2]) return route.fulfill(success({exam_id: id, university_id: 1, university_minutes: 60, exam_minutes: null, effective_minutes: 60, source: 'university'}));
            const reply = success({exam: {...exams.find(e => e.id === id), questions: [{exam_id: id, question_number: 1, problem_text: '{{本文}}\nPassage Q' + id, answer_text: 'Answer ' + id}]}});
            if (holdExams) await new Promise(resolve => examReplies.push(resolve));
            return route.fulfill(reply);
          }
          return route.fulfill(success({universities: [], results: [], stop: [], level: [], vocab: [], config: {}}));
        }
        const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        let body = fs.readFileSync(path.join(root, relative));
        if (relative === 'assets/js/auth.js') body = 'window.Auth={init(){},onChange(){},getCurrentUser(){return {uid:"fixture"}},getIdToken(){return Promise.resolve("fixture")}}';
        if (relative === 'assets/js/viewer.js') {
          if (process.env.PRINT_REFRESH_BASELINE_REF) body = execFileSync('git', ['show', process.env.PRINT_REFRESH_BASELINE_REF + ':' + relative], {cwd: root});
          body = body.toString().replace('document.addEventListener("DOMContentLoaded", init);', 'window.__refresh={state,multiPrint,openPrintTab,loadPrintPreview,runPrint}; document.addEventListener("DOMContentLoaded", init);');
        }
        return route.fulfill({body, contentType: {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css'}[path.extname(relative)] || 'text/plain'});
      });
      await context.addInitScript(o => {localStorage.setItem('cf_worker_url', o); window.printCalls = 0; window.print = () => {window.printCalls++;};}, origin);
      await page.goto(origin);
      await page.locator('[data-tab="print"]').click();
      await page.waitForFunction(() => __refresh.multiPrint.list.length === 1);
      await page.locator('#pr-tree .print-single-only .tree-row-fav').click();
      await page.locator('[data-favfolder="1"]').click();
      await page.waitForFunction(() => __refresh.state.printExam?.questions.length === 2);
      await page.evaluate(() => {__refresh.state.printQSel['11:1'] = false; __refresh.state.printTitleDrafts = {'1': ['', 'Unsaved cover', '']};});
      const blocked = async () => {
        assert.equal(await page.evaluate(() => __refresh.state.printExam), null, 'P1: old favorite preview invalidated before GET completion');
        assert.equal(await page.locator('#btn-print-run').isDisabled(), true);
        assert.equal(await page.locator('#btn-print-run-2').isDisabled(), true);
        assert.doesNotMatch(await page.locator('#print-preview').innerText(), /Passage Q12/);
        await page.evaluate(() => __refresh.runPrint());
        assert.equal(await page.evaluate(() => printCalls), 0);
      };
      if (!only || only === 'preview') {
        await page.locator('[data-tab="favorites"]').click();
        favoritesMode = 'hold';
        await page.locator('[data-tab="print"]').click();
        await page.waitForFunction(() => document.querySelector('[data-tab="print"]').classList.contains('active'));
        await waitFor(() => favoriteReplies.length === 1, 'held favorites GET');
        await blocked();
        // Reselecting a cached tree row while GET is pending must stay blocked.
        await page.locator('[data-favfolder="1"]').click();
        await page.waitForTimeout(100);
        assert.equal(favoriteReplies.length, 1, 'Pending folder selection must share the active GET');
        await blocked();
        favoriteReplies.shift()(failure);
        await page.waitForFunction(() => document.getElementById('pr-favorites-retry'));
        await blocked();
        await page.waitForTimeout(300);
        await page.screenshot({path: path.join(evidence, `${width}-failure.png`), fullPage: true});
        // Selecting a folder from cached tree data must not bypass the failed GET.
        favoritesMode = 'fail'; const failedRead = favoriteReads;
        if (!await page.locator('[data-favfolder="1"]').isVisible()) await page.locator('#pr-tree .print-single-only .tree-row-fav').click();
        await page.locator('[data-favfolder="1"]').click();
        await waitFor(() => favoriteReads > failedRead, 'failed direct folder GET');
        await page.waitForFunction(() => document.getElementById('pr-favorites-retry'));
        await blocked();
        favoritesMode = 'abort';
        const abortedRead = favoriteReads;
        await page.locator('#pr-favorites-retry').click();
        await waitFor(() => favoriteReads > abortedRead, 'aborted retry GET');
        await page.waitForFunction(() => document.getElementById('pr-favorites-retry') && document.getElementById('print-preview').textContent.includes('通信に失敗'));
        await blocked();
        favoritesMode = 'hold';
        source.favorites = [13, 11].map((id, i) => ({entry_id: 'base:' + id, exam_id: id, question_number: 1, folder_id: 1, sort_order: i}));
        await page.locator('#pr-favorites-retry').click();
        await waitFor(() => favoriteReplies.length === 1, 'retry GET');
        await blocked();
        favoriteReplies.shift()(success(source));
        await page.waitForFunction(() => __refresh.state.printExam?.questions[0].exam_id === 13);
        assert.deepEqual(await page.evaluate(() => __refresh.state.printExam.questions.map(q => q.exam_id)), [13, 11]);
        assert.equal(await page.evaluate(() => __refresh.state.printQSel['11:1']), false);
        assert.equal(await page.evaluate(() => __refresh.state.printTitleDrafts['1'][1]), 'Unsaved cover');
        assert.equal(await page.locator('#btn-print-run').isDisabled(), false);
        // An older folder-body request must not restore a preview during refresh.
        favoritesMode = 'normal'; holdExams = true;
        await page.evaluate(() => __refresh.loadPrintPreview());
        await waitFor(() => examReplies.length === 2, 'held old folder body');
        favoritesMode = 'hold';
        await page.evaluate(() => __refresh.openPrintTab());
        await waitFor(() => favoriteReplies.length === 1, 'refresh GET');
        holdExams = false; examReplies.splice(0).forEach(resolve => resolve());
        await page.waitForTimeout(100);
        await blocked();
        favoriteReplies.shift()(success(source));
        await page.waitForFunction(() => __refresh.state.printExam?.kind === 'favFolder');
        // Switching to a set while favorites is pending must keep the new preview.
        favoritesMode = 'hold';
        await page.evaluate(() => {__refresh.openPrintTab(); __refresh.multiPrint.ids = [11]; __refresh.multiPrint.cover.lines = ['', 'New mode draft', ''];});
        await waitFor(() => favoriteReplies.length === 1, 'GET before mode switch');
        await page.locator('#pr-multi').check();
        await page.waitForFunction(() => __refresh.state.printExam?.kind === 'printSet');
        favoriteReplies.shift()(failure);
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => __refresh.state.printExam.kind), 'printSet');
        assert.match(await page.locator('#print-preview').innerText(), /New mode draft/);
        favoritesMode = 'normal';
        await page.locator('#pr-multi').uncheck();
        await page.waitForFunction(() => __refresh.state.printExam?.kind === 'favFolder');
      }
      if (!only || only === 'epoch') {
        // Newer B wins even if older A completes after B has rendered.
        const older = structuredClone(source);
        source = structuredClone(source);
        source.folders[0].name = 'Latest folder';
        source.favorites.reverse().forEach((f, i) => f.sort_order = i);
        const latestIds = source.favorites.map(f => f.exam_id);
        favoritesMode = 'hold';
        await page.evaluate(() => __refresh.openPrintTab());
        await waitFor(() => favoriteReplies.length === 1, 'older A');
        await page.evaluate(() => __refresh.openPrintTab());
        await waitFor(() => favoriteReplies.length === 2, 'newer B');
        favoriteReplies.pop()(success(source));
        await page.waitForFunction(ids => __refresh.state.printExam?.questions[0].exam_id === ids[0], latestIds);
        favoriteReplies.shift()(success(older));
        await page.waitForTimeout(100);
        assert.deepEqual(await page.evaluate(() => __refresh.state.favRows.map(f => f.exam_id)), latestIds, 'Newest response must own the shared favorites cache');
        assert.equal(await page.evaluate(() => __refresh.state.favFolders[0].name), 'Latest folder');
        const readsBeforeCachedSelection = favoriteReads;
        if (!await page.locator('[data-favfolder="1"]').isVisible()) await page.locator('#pr-tree .print-single-only .tree-row-fav').click();
        await page.locator('[data-favfolder="1"]').click();
        await page.waitForFunction(ids => __refresh.state.printExam?.questions[0].exam_id === ids[0], latestIds);
        assert.equal(favoriteReads, readsBeforeCachedSelection);
        // An old failure must not invalidate the newer successful cache.
        await page.evaluate(() => __refresh.openPrintTab());
        await waitFor(() => favoriteReplies.length === 1, 'older failing A');
        await page.evaluate(() => __refresh.openPrintTab());
        await waitFor(() => favoriteReplies.length === 2, 'newer successful B');
        favoriteReplies.pop()(success(source));
        await page.waitForFunction(() => __refresh.state.printExam?.kind === 'favFolder');
        favoriteReplies.shift()(failure);
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => __refresh.state.favSet !== null), true);
        assert.deepEqual(await page.evaluate(() => __refresh.state.favRows.map(f => f.exam_id)), latestIds);
        // Latest failure must stay invalid, even after an older success arrives.
        await page.evaluate(() => __refresh.openPrintTab());
        await waitFor(() => favoriteReplies.length === 1, 'older successful A');
        await page.evaluate(() => __refresh.openPrintTab());
        await waitFor(() => favoriteReplies.length === 2, 'newer failing B');
        favoriteReplies.pop()(failure);
        await page.waitForFunction(() => document.getElementById('pr-favorites-retry'));
        favoriteReplies.shift()(success(older));
        await page.waitForTimeout(100);
        await blocked();
        assert.equal(await page.evaluate(() => __refresh.state.favSet), null);
        favoritesMode = 'normal';
        await page.locator('#pr-favorites-retry').click();
        await page.waitForFunction(ids => __refresh.state.printExam?.questions[0].exam_id === ids[0], latestIds);
      }
      if (!only || only === 'sets') {
        // Healthy print-set endpoint must update while favorites is pending/failing.
        await page.evaluate(() => {
          const m = __refresh.multiPrint; m.ids = [11]; m.name = 'Draft set'; m.cover = {lines: ['', 'Draft cover', ''], time: '45'}; m.questionSelection = {'11:1': false};
        });
        await page.locator('#pr-multi').check();
        await page.waitForFunction(() => __refresh.state.printExam?.kind === 'printSet');
        await page.locator('[data-tab="favorites"]').click();
        sets = [{id: 'new', name: 'New first set', archived: false}, {id: 'old', name: 'Renamed old set', archived: true}];
        favoritesMode = 'hold'; const before = setReads;
        await page.locator('[data-tab="print"]').click();
        await page.waitForFunction(() => __refresh.multiPrint.list[0]?.id === 'new', null, {timeout: 5000}).catch(() => { assert.fail('P2: saved sets did not refresh independently of the held favorites GET'); });
        assert.ok(setReads > before, 'P2: independent sets GET starts before favorites reply');
        assert.deepEqual(await page.locator('#pr-set-list option').allTextContents(), ['印刷セットを選択', 'New first set', 'Renamed old set（アーカイブ）']);
        assert.equal(await page.locator('#pr-set-favorites [data-open-set]').count(), 1);
        await waitFor(() => favoriteReplies.length === 1, 'favorites GET with healthy sets');
        favoriteReplies.shift()(failure);
        await page.waitForFunction(() => document.body.textContent.includes('Synthetic favorites unavailable'));
        assert.equal(await page.evaluate(() => __refresh.state.printExam.kind), 'printSet');
        assert.equal(await page.evaluate(() => __refresh.multiPrint.name), 'Draft set');
        assert.deepEqual(await page.evaluate(() => __refresh.multiPrint.cover), {lines: ['', 'Draft cover', ''], time: '45'});
        assert.deepEqual(await page.evaluate(() => __refresh.multiPrint.questionSelection), {'11:1': false});
        // Failure of sets must likewise leave favorite refresh operational.
        favoritesMode = 'normal'; setsMode = 'fail';
        await page.locator('#pr-multi').uncheck();
        await page.waitForFunction(() => __refresh.state.printExam?.kind === 'favFolder');
        await page.evaluate(() => __refresh.openPrintTab());
        await page.waitForFunction(() => document.body.textContent.includes('Synthetic sets unavailable'));
        await page.waitForFunction(() => __refresh.state.printExam?.kind === 'favFolder');
        assert.equal(await page.locator('#btn-print-run').isDisabled(), false);
        // A late favorite failure cannot erase a newly selected exam.
        favoritesMode = 'hold'; setsMode = 'normal';
        await page.evaluate(() => __refresh.openPrintTab());
        await waitFor(() => favoriteReplies.length === 1, 'refresh GET');
        await page.evaluate(() => {__refresh.state.printSel = {kind: 'exam', uni: 'Fixture', year: '2026', sched: '11'}; __refresh.loadPrintPreview();});
        await page.waitForFunction(() => __refresh.state.printExam?.kind === 'exam');
        favoriteReplies.shift()(failure);
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => __refresh.state.printExam.kind), 'exam');
        assert.match(await page.locator('#print-preview').innerText(), /Passage Q11/);
      }
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px: ${only || 'preview and sets'} HTTP delay/failure/retry, stale-load suppression, independent lists and draft preservation`);
      await context.close();
    }
  } finally {await browser.close();}
})().catch(e => {console.error(e); process.exitCode = 1;});
