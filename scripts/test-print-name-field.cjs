// Node regressions: node scripts/test-print-name-field.cjs
// Synthetic HTTPS UI/PDF QA: node scripts/test-print-name-field.cjs --browser
// Uses panel's Playwright, or PLAYWRIGHT_MODULE / PANEL_CHROMIUM overrides.
// All browser requests are intercepted. No real accounts, user data, or network.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const index = read('index.html');
const viewer = read('assets/js/viewer.js');
const initMarker = 'document.addEventListener("DOMContentLoaded", init);';
assert.equal(viewer.split(initMarker).length, 2, 'The test hook must replace exactly one init marker');
const exportHook = 'window.__printTest = {state, buildPrintHtml, printOptions, renderPrintPreview, renderPrintSectionControls, runPrint};';
const markupFile = index.match(/src="(assets\/js\/markup[^"?]*\.js)(?:\?[^" ]*)?"/)[1];
const stylesheet = index.match(/href="(assets\/css\/main[^"?]*\.css)(?:\?[^" ]*)?"/)[1];
const saved = {};
const nodes = {'pr-cover': {checked: true}, 'pr-name-field': {checked: false}};
const ctx = {
  console, document: {addEventListener() {}},
  localStorage: {getItem: k => saved[k] ?? null, setItem: (k, v) => { saved[k] = String(v); }},
  UI: {el: id => nodes[id] || null, escapeHtml: s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}
};
ctx.window = ctx;
vm.createContext(ctx);
for (const file of ['assets/js/store.js', markupFile, 'assets/js/difficulty.js']) {
  vm.runInContext(read(file), ctx, {filename: file});
}
vm.runInContext(viewer.replace(initMarker, exportHook), ctx, {filename: 'viewer.js'});

function fixtures() {
  const first = {exam_id: 101, question_number: 7, category: '長文',
    problem_text: '{{本文}}\nThis is the first synthetic passage with [[66]].\n{{設問}}\n{{問9}} Choose the best answer.\n((1)) First choice\n((2)) Second choice',
    answer_text: '{{問9}} {{66}} A', commentary_text: '問9：This is the explanation.'};
  const second = {exam_id: 202, question_number: 7, category: '長文',
    problem_text: '{{本文}}\nThis is the second synthetic passage with [[88]].\n{{設問}}\n{{問12}} Choose another answer.',
    answer_text: '{{問12}} {{88}} B'};
  return {
    exam: {kind: 'exam', year: 2026, university_name: 'テスト医科大学', schedule: '前期', questions: [first]},
    folder: {kind: 'favFolder', folderId: 55, questions: [second, first], items: [
      {kind: 'section', name: 'Second exam first'}, {kind: 'question', q: second},
      {kind: 'section', name: 'First exam second'}, {kind: 'question', q: first}
    ]},
    titles: ['2026年度', '医学部演習 <A&B>', '英語・前期', '追加タイトル']
  };
}
const fixture = fixtures();
const {state, buildPrintHtml, printOptions} = ctx.__printTest;
state.favFolders = [{id: 55, name: '演習フォルダ'}];
ctx.Store.setPrintFolderTitleLines(55, fixture.titles, [1, 4, 2, 3], [1, 2, 3, 4]);
const countNames = html => (html.match(/class="pc-name-field"/g) || []).length;
const withoutName = html => html.replace('print-cover has-name-field', 'print-cover')
  .replace(/<div class="pc-name-field"[^>]*>[\s\S]*?<\/div>/g, '');

assert.equal(ctx.Store.getPrintNameField(), false, 'New setting defaults OFF');
ctx.Store.setPrintNameField(true);
assert.equal(ctx.Store.getPrintNameField(), true);
assert.equal(saved.exam_print_name_field, 'true', 'Persist in the dedicated local key');
ctx.Store.setPrintNameField(false);
assert.equal(ctx.Store.getPrintNameField(), false);
assert.equal(saved.exam_print_name_field, 'false');
saved.exam_print_name_field = 'invalid-json';
assert.equal(ctx.Store.getPrintNameField(), false, 'Malformed saved JSON falls back to OFF');
delete saved.exam_print_name_field;
assert.equal(printOptions().nameField, false);
nodes['pr-name-field'].checked = true;
assert.equal(printOptions().nameField, true, 'Read the checkbox, not stale storage');
delete nodes['pr-name-field'];
assert.equal(printOptions().nameField, false, 'Older page without checkbox is safe');

for (const ex of [fixture.exam, fixture.folder]) {
  const original = JSON.stringify(ex);
  for (const renumber of [false, true]) {
    for (const draft of [false, true]) {
      const off = buildPrintHtml(ex, {cover: true, nameField: false, renumber}, draft);
      const on = buildPrintHtml(ex, {cover: true, nameField: true, renumber}, draft);
      assert.equal(countNames(off), 0);
      assert.doesNotMatch(off, /has-name-field|pc-name-line/);
      assert.equal(countNames(on), 1, `${ex.kind}: exactly one name field`);
      assert.match(on, /氏名:<\/span><span class="pc-name-line"[^>]*><\/span>/);
      assert.equal(withoutName(on), off, 'Only the name field and cover class may change');
      assert.equal(buildPrintHtml(ex, {cover: true, renumber}, draft), off, 'Omitted setting preserves legacy output');
      assert.equal(buildPrintHtml(ex, {cover: false, nameField: true, renumber}, draft),
        buildPrintHtml(ex, {cover: false, nameField: false, renumber}, draft), 'No cover means no name field');
      assert.doesNotMatch(on.slice(on.indexOf('<div class="print-part ')), /pc-name-|氏名:/, 'Never add names to question/answer pages');
      assert.equal(buildPrintHtml(ex, {cover: true, nameField: true, renumber}, draft), on, 'Repeated rendering is stable');
    }
  }
  assert.equal(JSON.stringify(ex), original, 'Printing does not mutate exam or favorite data');
}
assert.ok(buildPrintHtml(fixture.exam, {cover: true}).startsWith(
  '<div class="print-cover"><div class="pc-year">2026年度</div><div class="pc-uni">テスト医科大学</div><div class="pc-sched">前期</div></div>'), 'Legacy standard cover HTML remains byte-for-byte identical');
let html = buildPrintHtml(fixture.folder, {cover: true, nameField: true, renumber: true});
assert.match(html, /医学部演習 &lt;A&amp;B&gt;/);
assert.match(html, /pc-extra pc-title-edit pc-title-size-3 pc-title-color-4/);
assert.ok(html.indexOf('second synthetic passage') < html.indexOf('first synthetic passage'), 'Favorite order is retained');
assert.equal((html.match(/question-badge">問1<\/span>/g) || []).length, 4, 'Question and answer numbering restarts for each favorite');
assert.doesNotMatch(html, /blank-badge">(?:66|88)<\/span>/);
state.printTitleDrafts = {'55': ['Draft top', 'UNSAVED TITLE', '', 'Draft extra']};
assert.match(buildPrintHtml(fixture.folder, {cover: true, nameField: true}, true), /UNSAVED TITLE/);
assert.doesNotMatch(buildPrintHtml(fixture.folder, {cover: true, nameField: true}, false), /UNSAVED TITLE/);
state.printTitleDrafts = {};
state.printQSel = {'202:7': false};
html = buildPrintHtml(fixture.folder, {cover: true, nameField: true});
assert.equal(countNames(html), 1);
assert.doesNotMatch(html, /second synthetic passage|Second exam first/);
assert.match(html, /first synthetic passage/);
state.printQSel = {};
for (const cssFile of ['assets/css/main.css', stylesheet]) {
  const css = read(cssFile);
  assert.match(css, /\.print-cover\.has-name-field\s*\{[^}]*position:\s*relative/);
  assert.match(css, /\.pc-name-field\s*\{[^}]*position:\s*absolute/);
  assert.match(css, /\.pc-name-line\s*\{[^}]*border-bottom:\s*1px solid/);
}
assert.match(index, /id="pr-name-field"[^>]*>\s*<span>氏名欄を追加<\/span>/);
console.log('PASS: print name-field persistence, default OFF, legacy HTML, both cover types, cover disabled, saved/draft/escaped titles, favorite order/renumbering, excluded questions, no mutation');

async function browserTest() {
  const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '../panel/node_modules/playwright');
  const browser = await chromium.launch({headless: true, ...(process.env.PANEL_CHROMIUM ? {executablePath: process.env.PANEL_CHROMIUM} : {})});
  const origin = 'https://exam-print-name.test';
  const results = [];
  try {
    for (const [device, viewport] of [['desktop', {width: 1280, height: 960}], ['mobile', {width: 390, height: 844}]]) {
      const context = await browser.newContext({viewport, hasTouch: device === 'mobile', serviceWorkers: 'block'});
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      // Keep production init and its listeners intact. Only export internal entry points
      // for synthetic fixture injection; NEVER duplicate the checkbox change listener.
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) {
          return route.fulfill({status: 200, contentType: route.request().resourceType() === 'stylesheet' ? 'text/css' : 'application/javascript', body: ''});
        }
        if (url.pathname.startsWith('/api/')) {
          assert.equal(route.request().method(), 'GET', 'This regression must never mutate an API');
          const api = {
            '/api/config': {}, '/api/universities': {universities: []},
            '/api/exams': {exams: []}, '/api/search': {results: []},
            '/api/wordlists': {stop: [], level: [], vocab: []}
          };
          assert.ok(Object.hasOwn(api, url.pathname), `Unrecognized fixture API ${url.pathname}`);
          return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(api[url.pathname])});
        }
        const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
        const file = path.resolve(root, relative);
        assert.ok(file.startsWith(root + path.sep), 'Never serve paths outside the checkout');
        assert.ok(fs.existsSync(file) && fs.statSync(file).isFile(), `Missing deployed asset: ${relative}`);
        const ext = path.extname(file);
        const contentType = {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png'}[ext] || 'application/octet-stream';
        const body = relative === 'assets/js/viewer.js' ? viewer.replace(initMarker, exportHook + '\n' + initMarker) : fs.readFileSync(file);
        return route.fulfill({status: 200, contentType, body});
      });
      await context.addInitScript(({origin}) => {
        localStorage.setItem('cf_worker_url', origin);
        localStorage.setItem('exam_lasttab_main', 'print');
        window.__printCalls = 0;
        window.print = () => { window.__printCalls++; };
      }, {origin});
      const openPage = async () => {
        await page.goto(origin + '/', {waitUntil: 'networkidle'});
        await page.waitForFunction(() => window.__printTest && window.__printTest.state.config !== null);
        await page.locator('#pr-settings-open').click();
        assert.equal(await page.getByLabel('氏名欄を追加', {exact: true}).count(), 1, 'Checkbox has an accessible label');
      };
      const setFixture = async ex => {
        await page.evaluate(({ex, titles}) => {
          const t = window.__printTest;
          t.state.favFolders = [{id: 55, name: '演習フォルダ'}];
          Store.setPrintFolderTitleLines(55, titles, [1, 4, 2, 3], [1, 2, 3, 4]);
          t.state.printExam = ex;
          t.state.printQSel = {};
          t.state.printTitleDrafts = {};
          t.renderPrintSectionControls();
          t.renderPrintPreview();
        }, {ex, titles: fixture.titles});
      };
      // Empty cover lines must accept a click across their full width in Chrome,
      // including after deleting all text or adding a new line.
      const verifyCoverFocus = async () => {
        await page.locator("#pr-settings-modal [data-print-close]").first().click();
        await setFixture(fixture.folder);
        await page.evaluate(() => {
          Store.setPrintFolderTitleLines(55, ['', '演習フォルダ', '']);
          window.__printTest.renderPrintPreview();
        });
        const empty = page.locator('#print-preview [data-print-title][data-line="0"]');
        await empty.click({position: {x: 20, y: 10}});
        assert.equal(await empty.evaluate(n => document.activeElement === n && n.isContentEditable), true, 'Empty line accepts one click');
        assert.ok(await empty.evaluate(n => parseFloat(getComputedStyle(n).fontSize)>=16),'Small title input does not trigger iOS font zoom');
        assert.ok(await empty.evaluate(n => n.getBoundingClientRect().height >= 20), 'CSS preserves empty hit area');
        await page.keyboard.insertText('表紙タイトル');
        assert.equal(await empty.evaluate(n => n.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', isComposing: true, bubbles: true, cancelable: true}))), true, 'IME confirmation is not prevented');
        assert.equal(await empty.evaluate(n => document.activeElement === n), true, 'IME confirmation retains focus');
        assert.equal(await empty.textContent(), '表紙タイトル');
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
        await page.keyboard.press('Backspace');
        await page.locator('#print-preview [data-print-title-add]').click();
        const added = page.locator('#print-preview [data-print-title][data-line="3"]');
        await added.click({position: {x: 20, y: 10}});
        await page.keyboard.insertText('追加行');
        assert.equal(await added.textContent(), '追加行');
        await page.locator('#print-preview [data-print-title][data-line="0"]').click();
        await page.keyboard.insertText('再入力');
        assert.equal(await page.locator('#print-preview [data-print-title][data-line="0"]').textContent(), '再入力');
        const populated = page.locator('#print-preview [data-print-title][data-line="1"]');
        await populated.dblclick();
        await page.keyboard.insertText('置き換え');
        assert.equal(await populated.textContent(), '置き換え', 'Existing title remains replaceable by double click');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#print-preview [data-print-title][data-line="1"]').textContent(), '演習フォルダ', 'Escape cancels drafts');
        await page.locator('#print-preview [data-print-title][data-line="0"]').focus();
        await page.keyboard.press('Enter');
        await page.keyboard.insertText('キーボード入力');
        assert.equal(await page.locator('#print-preview [data-print-title][data-line="0"]').textContent(), 'キーボード入力');
        await page.keyboard.press('Enter');
      };
      const nameBox = page.locator('#pr-name-field');
      const coverBox = page.locator('#pr-cover');
      await openPage();
      await verifyCoverFocus();
      assert.equal(await nameBox.isChecked(), false, `${device}: starts OFF`);
      await setFixture(fixture.exam);
      await page.locator("#pr-settings-open").click();
      await nameBox.check();
      assert.equal(await page.locator('#print-preview .pc-name-field').count(), 1, 'Real change event rerenders preview');
      assert.equal(await page.evaluate(() => localStorage.getItem('exam_print_name_field')), 'true');
      await openPage();
      assert.equal(await nameBox.isChecked(), true, 'Real init restores ON after reload');
      await setFixture(fixture.exam);
      await coverBox.uncheck();
      assert.equal(await nameBox.isDisabled(), true);
      assert.equal(await nameBox.isChecked(), true, 'Disabling cover retains name preference');
      assert.equal(await page.locator('#print-preview .print-cover, #print-preview .pc-name-field').count(), 0);
      await coverBox.check();
      assert.equal(await nameBox.isEnabled(), true);
      assert.equal(await page.locator('#print-preview .pc-name-field').count(), 1);
      await nameBox.uncheck();
      await openPage();
      assert.equal(await nameBox.isChecked(), false, 'Real init restores OFF after reload');

      for (const [kind, ex] of [['exam', fixture.exam], ['folder', fixture.folder]]) {
        await setFixture(ex);
        if (!await page.locator("#pr-settings-modal").isVisible()) await page.locator("#pr-settings-open").click();
        await page.locator('#pr-renumber').check();
        const outputs = {};
        for (const enabled of [false, true]) {
          await page.emulateMedia({media: 'screen'});
          if (!await page.locator("#pr-settings-modal").isVisible()) await page.locator("#pr-settings-open").click();
          await nameBox.setChecked(enabled);
          await page.locator("#pr-settings-modal [data-print-close]").first().click();
          const preview = page.locator('#print-preview .print-doc');
          assert.equal(await preview.locator('.pc-name-field').count(), +enabled);
          const screen = await measure(page, '#print-preview .print-cover');
          if (enabled) checkNameGeometry(screen, `${device}/${kind}/preview`);
          await preview.locator('.print-cover').screenshot({path: `/tmp/exam-print-name-${device}-${kind}-${enabled ? 'on' : 'off'}-preview.png`});
          const previous = await page.evaluate(() => window.__printCalls);
          await page.locator('#btn-print-run').click();
          await page.waitForFunction(n => window.__printCalls === n + 1, previous);
          assert.equal(await page.locator('#print-area .pc-name-field').count(), +enabled, 'Actual runPrint output matches the setting');
          assert.equal(await page.locator('#print-area').innerHTML(), await preview.innerHTML(), 'Saved preview and real print use the same HTML');
          assert.equal(await page.locator('#print-area .print-part .pc-name-field').count(), 0);
          await page.emulateMedia({media: 'print'});
          const geometry = await measure(page, '#print-area .print-cover');
          if (enabled) checkNameGeometry(geometry, `${device}/${kind}/print`);
          await page.locator('#print-area .print-cover').screenshot({path: `/tmp/exam-print-name-${device}-${kind}-${enabled ? 'on' : 'off'}-print.png`});
          const pdfPath = `/tmp/exam-print-name-${device}-${kind}-${enabled ? 'on' : 'off'}.pdf`;
          const pdf = await page.pdf({path: pdfPath, format: 'A4', preferCSSPageSize: true, printBackground: true});
          const pdfText = pdf.toString('latin1');
          const pages = (pdfText.match(/\/Type\s*\/Page\b/g) || []).length;
          assert.ok(pages >= 3, 'Fixture produces cover, question, and answer pages');
          assert.match(pdfText, /\/MediaBox\s*\[\s*0\s+0\s+59[45](?:\.\d+)?\s+84[12](?:\.\d+)?\s*\]/, 'PDF uses A4');
          outputs[enabled ? 'on' : 'off'] = {pages, geometry, screen, pdfPath};
        }
        assert.equal(outputs.on.pages, outputs.off.pages, `${device}/${kind}: name field must not add a page`);
        for (const mode of ['geometry', 'screen']) {
          assertSameTitles(outputs.off[mode].titles, outputs.on[mode].titles, `${device}/${kind}/${mode}`);
        }
        results.push({device, kind, pages: outputs.on.pages, off: outputs.off.pdfPath, on: outputs.on.pdfPath});
        await page.emulateMedia({media: 'screen'});
        // Disabled cover also applies to the real print path, not only preview.
        if (!await page.locator("#pr-settings-modal").isVisible()) await page.locator("#pr-settings-open").click();
        await coverBox.uncheck();
        const previous = await page.evaluate(() => window.__printCalls);
        await page.locator('#btn-print-run-2').click();
        await page.waitForFunction(n => window.__printCalls === n + 1, previous);
        assert.equal(await page.locator('#print-area .print-cover, #print-area .pc-name-field').count(), 0);
        await coverBox.check();
      }
      assert.deepEqual(errors, [], `${device}: no uncaught browser errors`);
      await context.close();
    }
    fs.writeFileSync('/tmp/exam-print-name-results.json', JSON.stringify(results, null, 2));
    console.log('PASS: empty cover click/type/delete/retype/add, keyboard edit/cancel, IME guard, real init/change/reload wiring, desktop/mobile, cover toggle retention, preview/runPrint parity, lower-right geometry/underline, unchanged title layout and ON/OFF A4 page counts');
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
  }
}

async function measure(page, selector) {
  return page.locator(selector).evaluate(cover => {
    const rect = element => {
      const r = element.getBoundingClientRect();
      const c = cover.getBoundingClientRect();
      return {left: r.left - c.left, top: r.top - c.top, right: r.right - c.left, bottom: r.bottom - c.top, width: r.width, height: r.height};
    };
    const name = cover.querySelector('.pc-name-field');
    const label = name && name.querySelector('span');
    const line = cover.querySelector('.pc-name-line');
    return {
      cover: rect(cover), coverPosition: getComputedStyle(cover).position,
      titles: Array.from(cover.querySelectorAll('.pc-year, .pc-uni, .pc-sched, .pc-extra')).map(node => ({text: node.textContent, ...rect(node)})),
      name: name && rect(name), position: name && getComputedStyle(name).position,
      line: line && rect(line), label: label && rect(label),
      border: line && parseFloat(getComputedStyle(line).borderBottomWidth)
    };
  });
}
function checkNameGeometry(g, label) {
  assert.equal(g.coverPosition, 'relative', label + ': cover anchors the field');
  assert.equal(g.position, 'absolute', label + ': field stays outside title flow');
  assert.ok(g.name.left >= -1 && g.name.right <= g.cover.width + 1, label + ': field fits horizontally');
  assert.ok(g.name.top > g.cover.height / 2 && g.name.bottom <= g.cover.height + 1, label + ': field is in the bottom half');
  assert.ok(g.cover.width - g.name.right <= 40 && g.cover.height - g.name.bottom <= 40, label + ': lower-right corner');
  assert.ok(g.line.width >= 70 && g.border >= 1, label + ': writable underline is visible');
  assert.ok(g.line.bottom >= g.label.top + g.label.height * 0.35 && g.line.bottom <= g.label.bottom + 2, label + ': underline aligns with the label baseline');
  for (const title of g.titles) {
    if (title.text.trim()) assert.ok(title.bottom <= g.name.top + 1 || title.right <= g.name.left, label + ': name does not overlap title');
  }
}
function assertSameTitles(before, after, label) {
  assert.equal(after.length, before.length, label + ': title count');
  before.forEach((old, i) => {
    assert.equal(after[i].text, old.text, label + ': title text');
    for (const key of ['left', 'top', 'width', 'height']) {
      assert.ok(Math.abs(old[key] - after[i][key]) <= 0.6, `${label}: title ${i} ${key} changed from ${old[key]} to ${after[i][key]}`);
    }
  });
}
if (process.argv.includes('--browser')) browserTest().catch(error => { console.error(error); process.exitCode = 1; });
