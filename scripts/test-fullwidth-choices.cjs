// Display-only choice normalization. Uses synthetic content; never contacts or changes Exam data.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/js/markup.js'), 'utf8');
const context = {window: {}};
vm.runInNewContext(source, context);
const M = context.window.Markup;
const render = text => M.render(text).html;
const count = (html, token) => html.split(token).length - 1;
const full = text => text.replace(/[0-9]/g, d => String.fromCharCode(d.charCodeAt(0) + 0xFEE0));
const forms = [];
// Independently mix both opening and closing parentheses, not just matching pairs.
for (const a of ['(', '（']) for (const b of ['(', '（'])
 for (const c of [')', '）']) for (const d of [')', '）']) forms.push(n => a + b + n + c + d);
for (const form of forms) {
 for (const n of ['1', '9', '10', '20', '21', '35', '36', '50']) {
  for (const label of [n, full(n), n[0] + full(n.slice(1))]) {
   const marker = form(label), ascii = '((' + n + '))';
   for (const template of [x => x + ' choice', x => 'Choose ' + x + '.',
     x => '**See ' + x + '**', x => '| Label |\n| --- |\n| ' + x + ' |']) {
    assert.equal(render(template(marker)), render(template(ascii)), template(marker));
   }
   for (const style of ['__', '==', '~~']) {
    const html = render('See ' + marker + style + 'words' + style);
    assert.equal(html, render('See ' + ascii + style + 'words' + style));
    assert.equal(count(html, 'underline-marker'), 1);
    assert.doesNotMatch(html, /answer-choice/);
   }
   assert.equal(M.strip(marker + ' choice'), M.strip(ascii + ' choice'));
  }
 }
}
for (const marker of ['（（ア））', '(（a）)', '（(A)）']) {
 const html = render(marker + ' choice');
 assert.match(html, /choice-label-unicode/);
}
for (const label of ['０', '０１', '５１', '１２３', 'あ']) {
 assert.match(render('（（' + label + '）） choice'), /answer-choice-label/);
 assert.doesNotMatch(render('（（' + label + '）） choice'), /choice-label-unicode/);
 assert.ok(render('（（' + label + '）） choice').includes('>' + label + '</span>'));
}
// Ordinary single parentheses retain their meaning, including underline numbering.
for (const marker of ['(1)', '（1）', '(１)', '（１）', '(１）', '（1)']) {
 assert.doesNotMatch(render('Reference ' + marker), /choice-/);
 assert.doesNotMatch(render(marker + '__underlined__'), /choice-/);
 assert.match(render(marker + '__underlined__'), /underline-marker/);
}
assert.doesNotMatch(render('Ordinary （本文の説明） and (ordinary prose).'), /choice-/);
// Outer prose parentheses must not be swallowed as part of a choice label.
for (const input of ['(((１)))', '（（（１）））', '(（（１））)', '（((１))）']) {
 const html = render(input);
 assert.equal(count(html, 'choice-label-text'), 1, input);
 assert.ok(html.includes('>①</span>'), input);
 assert.doesNotMatch(html, /answer-choice/, input);
}
const row = '（（１）） first　((2)) second　(（３）) third';
assert.equal(count(render(row), 'choice-label-text'), 3);
assert.doesNotMatch(render(row), /answer-choice/);
const data = Object.freeze({problem_text: '（（１）） first\n\n(（２）) second\n\n((3)) third'});
const stored = JSON.stringify(data);
assert.equal(count(render(data.problem_text), 'class="answer-choice"'), 3);
assert.equal(render(data.problem_text), render(data.problem_text));
M.strip(data.problem_text);
assert.equal(JSON.stringify(data), stored, 'render/strip do not rewrite stored source');
for (const input of ['（（５）） __th__ough', '（（１）） c__o__st　((2)) e__x__amine']) {
 assert.doesNotMatch(render(input), /underline-marker/);
}
// Exercise the real viewer preprocessing without a DOM or released-asset substitution.
const viewer = {Difficulty: {BAND_LABEL: {}}, document: {addEventListener() {}},
 UI: {el: () => null, escapeHtml: s => String(s)}, Store: {getFavCollapsed: () => ({})}, Markup: M};
viewer.window = viewer;
vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/js/viewer.js'), 'utf8').replace(
 'document.addEventListener("DOMContentLoaded", init);',
 'window.testDisplay = {renderDisplayContent, renderOptimizedAnswers};'), viewer);
for (const label of ['問題', '設問']) {
 const result = viewer.testDisplay.renderDisplayContent(label, row, {optimizeChoices: true});
 assert.equal(count(result, 'class="answer-choice"'), 3, 'inline choices split for '+label);
 assert.equal(count(viewer.testDisplay.renderDisplayContent(label, row, {optimizeChoices: false}), 'choice-inline '), 3);
}
for (const text of ['{{1}}（（１）） {{2}}(（２))', '[[1]]（（１）） [[2]](（２))']) {
 const result = viewer.testDisplay.renderOptimizedAnswers(text, {});
 assert.equal(count(result, 'class="print-answer-item"'), 2, 'compact fullwidth answers split');
 assert.ok(result.includes('>①</span>') && result.includes('>②</span>'));
}
for (const text of ['{{1}} See {{2}} above', '{{1}} （１） refers to {{2}} （２）']) {
 assert.equal(count(viewer.testDisplay.renderOptimizedAnswers(text, {}), 'class="print-answer-item"'), 1, 'prose references do not split');
}
assert.equal(JSON.stringify(data), stored);
console.log('PASS: full-width/mixed numeric choices, inline/table/bold, block classification, triple parentheses, underlines, phonetics, prose, fallback, source preservation');

if (process.argv.includes('--browser')) (async () => {
 const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '../panel/node_modules/playwright');
 const browser = await chromium.launch({headless: true, ...(process.env.PANEL_CHROMIUM ? {executablePath: process.env.PANEL_CHROMIUM} : {})});
 try {
  for (const width of [1280, 390]) {
   const page = await browser.newPage({viewport: {width, height: 900}});
   await page.route('**/*', route => route.abort());
   await page.setContent('<style>' + fs.readFileSync(path.join(root, 'assets/css/main.css'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'assets/css/print-choices.css'), 'utf8') + '</style><div id="print-preview"></div>');
   await page.evaluate(() => {
    window.UI = {el: id => document.getElementById(id), escapeHtml: s => s, $all: (q, r = document) => Array.from(r.querySelectorAll(q))};
    window.Store = {getPrintFontSize: () => 'md', getFavCollapsed: () => ({})};
   });
   await page.addScriptTag({content: source});
   await page.addScriptTag({content: fs.readFileSync(path.join(root, 'assets/js/difficulty.js'), 'utf8')});
   await page.addScriptTag({content: fs.readFileSync(path.join(root, 'assets/js/viewer.js'), 'utf8').replace('document.addEventListener("DOMContentLoaded", init);', 'window.testChoices = {optimizePrintChoices, printField};')});
   for (const media of ['screen', 'print']) {
    await page.emulateMedia({media});
    const result = await page.evaluate(text => {
     const root = document.getElementById('print-preview');
     const mixed = text + '\n\n（（１）） duplicate starts a new group\n\n((２)) next\n\nOrdinary （１） prose\n\n' + '（（３）） last\n\n((4)) final';
     root.innerHTML = '<div class="print-doc fs-md lh-3"><div class="print-part-q">' + testChoices.printField('問題', mixed, {optimizeChoices: true}) + '</div></div>';
     testChoices.optimizePrintChoices(root);
     const groups = [...root.querySelectorAll('.print-choice-group')];
     const sizes = groups.map(g => g.querySelectorAll('.answer-choice').length);
     const labels = [...root.querySelectorAll('.answer-choice-label')].map(n => n.textContent);
     testChoices.optimizePrintChoices(root, true);
     const repeatedSizes = [...root.querySelectorAll('.print-choice-group')].map(g => g.querySelectorAll('.answer-choice').length);
     const repeatedLabels = [...root.querySelectorAll('.answer-choice-label')].map(n => n.textContent);
     return {sizes, labels, repeatedSizes, repeatedLabels, sourceUnchanged: text === '（（１）） first\n\n(（２）) second\n\n((3)) third'};
    }, data.problem_text);
    assert.deepEqual(result.sizes, [3, 2, 2]);
    assert.deepEqual(result.labels, ['①', '②', '③', '①', '②', '③', '④']);
    assert.deepEqual(result.repeatedSizes, result.sizes);
    assert.deepEqual(result.repeatedLabels, result.labels);
    assert.equal(result.sourceUnchanged, true);
    // Print width can change column styles; regrouping must retain the same content and boundaries.
    assert.equal(await page.locator('.print-choice-group').count(), 3);
   }
   await page.close();
  }
  console.log('PASS: desktop/mobile screen/print real choice grouping, normalized duplicate boundaries and prose boundaries');
 } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});
