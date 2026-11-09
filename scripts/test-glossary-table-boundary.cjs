const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/js/markup.js'), 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context);
const markup = context.window.Markup;
const lemma = '##capillaries|capillary::毛細血管##';
const table = '| Term | Meaning |\n| --- | --- |\n| a | b |';

// Neither a glossary's internal pipe nor an escaped pipe continues a table.
const paragraphs = [
  `He studied ${lemma} today.`,
  `He studied **${lemma}** today.`,
  `He studied ::${lemma}:: today.`,
  `[1] He studied ${lemma} and ##vessels|vessel::血管## today.`,
  'He studied ##capillaries::毛細血管## today.',
  'He studied ##capillaries::毛細血管|血管## today.',
  'The literal a \\| b remains prose.',
];
for (const paragraph of paragraphs) {
  for (const gap of ['\n', '\n\n']) {
    const input = table + gap + paragraph;
    const result = markup.render(input);
    const tbody = result.html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
    assert.equal((tbody.match(/<tr>/g) || []).length, 1, paragraph);
    assert.match(result.html.slice(result.html.indexOf('</table>')), /class="blk/, paragraph);
    assert.equal(markup.render(input).html, result.html, 'Repeated rendering is stable');
    if (paragraph.includes(lemma)) {
      assert.equal(result.footnotes[0].word, 'capillary');
      assert.equal(result.footnotes[0].translation, '毛細血管');
      assert.equal((result.html.match(/title="capillary:/g) || []).length, 1);
    }
  }
}

// A glossary-only or escaped pipe must not make prose into a table header.
for (const paragraph of paragraphs) {
  const result = markup.render(paragraph + '\n| --- | --- |\n| a | b |');
  assert.doesNotMatch(result.html, /<table/);
}

// Structural pipes still delimit cells, including borderless and one-column rows.
for (const row of [`| ${lemma} | vessels |`, `${lemma} | vessels`, `| **${lemma}** | vessels |`]) {
  const result = markup.render('| Term | Meaning |\n| --- | --- |\n' + row);
  assert.equal((result.html.match(/<td[ >]/g) || []).length, 2);
  assert.match(result.html, /<td>vessels<\/td>/);
  assert.equal(result.footnotes[0].word, 'capillary');
}
const oneColumn = markup.render(`| Term |\n| --- |\n| ${lemma} |\nHe studied ${lemma} today.`);
assert.equal((oneColumn.html.match(/<td[ >]/g) || []).length, 1);
assert.match(oneColumn.html, /<\/table><\/div><span class="blk/);
const escapedCell = markup.render('| Term | Meaning |\n| --- | --- |\n| a \\| b | vessels |');
assert.match(escapedCell.html, /<td>a \| b<\/td><td>vessels<\/td>/);

for (const filename of ['index.html', 'setting/index.html']) {
  const html = fs.readFileSync(path.join(root, filename), 'utf8');
  const asset = html.match(/src="([^"?]*\/markup[^"?]*\.js)/)[1];
  assert.equal(fs.readFileSync(path.resolve(root, path.dirname(filename), asset), 'utf8'), source);
}
console.log('PASS: glossary/escaped pipes do not start or extend tables; structural cells and published parsers are preserved');

if (process.argv.includes('--browser')) (async () => {
  const { chromium } = require('../panel/node_modules/playwright');
  const browser = await chromium.launch({ headless: true, ...(process.env.PANEL_CHROMIUM ? { executablePath: process.env.PANEL_CHROMIUM } : {}) });
  const evidence = '/tmp/exam-glossary-table-boundary';
  fs.mkdirSync(evidence, { recursive: true });
  try {
    for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.route('**/*', route => route.abort());
      await page.setContent('<style>' + fs.readFileSync(path.join(root, 'assets/css/main.css'), 'utf8') + '</style><div id="print-area" class="print-out exam-doc" style="display:block;width:calc(100% - 40px);margin:20px">' + markup.render(table + '\n' + paragraphs[0]).html + '</div>');
      for (const media of ['screen', 'print']) {
        await page.emulateMedia({ media });
        assert.equal(await page.locator('tbody tr').count(), 1);
        assert.equal(await page.locator('.blk').count(), 1);
        assert.match(await page.locator('.blk').innerText(), /He studied capillaries\*1 today\./);
        assert.equal(await page.locator('.footnote-section li').count(), 1);
        assert.equal(await page.locator('.blk').evaluate(el => el.closest('table')), null);
        const geometry = await page.evaluate(() => ({ tableBottom: document.querySelector('table').getBoundingClientRect().bottom, paragraphTop: document.querySelector('.blk').getBoundingClientRect().top }));
        assert.ok(geometry.paragraphTop >= geometry.tableBottom, JSON.stringify(geometry));
      }
      await page.emulateMedia({ media: 'screen' });
      await page.screenshot({ path: path.join(evidence, `${width}.png`), fullPage: true });
      await page.pdf({ path: path.join(evidence, `${width}.pdf`), format: 'A4', printBackground: true });
      await page.close();
    }
  } finally { await browser.close(); }
  console.log('PASS: desktop/mobile screen and print keep the paragraph below the table');
})().catch(error => { console.error(error); process.exitCode = 1; });
