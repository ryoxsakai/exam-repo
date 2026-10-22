const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const shared = fs.readFileSync(path.join(root, 'assets/js/markup.js'), 'utf8');
const ctx = {window: {}};
vm.runInNewContext(shared, ctx);
const M = ctx.window.Markup;
let css;
for (const entry of ['index.html', 'setting/index.html']) {
  const html = fs.readFileSync(path.join(root, entry), 'utf8');
  const src = html.match(/src="([^"?]*\/markup[^"?]*\.js)/)[1];
  assert.equal(fs.readFileSync(path.resolve(root, path.dirname(entry), src), 'utf8'), shared);
  const sheet = html.match(/href="([^"?]*\/main[^"?]*\.css)/)[1];
  css = fs.readFileSync(path.resolve(root, path.dirname(entry), sheet), 'utf8');
  assert.equal(css, fs.readFileSync(path.join(root, 'assets/css/main.css'), 'utf8'));
}
for (const label of ['<1>', '<12>', '<<1>>', '〈1〉', '《1》']) {
  for (const style of ['__', '~~', '==']) {
    const html = M.render(label + style + 'word' + style + ' reference ' + label + ' and (1).').html;
    assert.equal((html.match(/class="marker-angle"/g) || []).length, 2);
    assert.equal((html.match(/class="underline-marker"/g) || []).length, 1);
    assert.equal((html.match(/class="marker-parentheses"/g) || []).length, 1);
    assert.ok(html.includes('marker-angle-glyph'));
  }
}
for (const input of ['`<1>`', '```\n<1>\n```', '<!-- <1> -->', '<code><1></code>', '<span title="<1>">', 'x < 1 > y', '((1)) choice', '[link](https://example.test/%3C1%3E)']) {
  assert.doesNotMatch(M.render(input).html, /marker-angle/, input);
}
assert.equal(M.strip('Before <<1>> after <2>__word__'), 'Before   after  word');
const source = ['リード文', '本文', '設問', '解答', '全訳', '解説'].map(type => '{{' + type + '}}\n<1>__Word__ and (1)__meaning__.  Refer to <1> and (1); complete <<1>>.').join('\n\n');
const rendered = M.parseSections(source).map(section => '<h3>' + section.type + '</h3>' + M.render(section.text).html).join('');
assert.equal((rendered.match(/class="marker-angle"/g) || []).length, 18);
assert.match(M.render('| <1> | (1) |\n| --- | --- |\n| <<1>> | <2>__word__ |').html, /marker-angle/);
assert.match(css, /src: local\("MS Mincho"\)/);
if (!process.argv.includes('--browser')) {
  console.log('PASS: angle/round distinctions, underline-only subscript, all sections, protected literals, source stripping and public assets');
} else {
  const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '../panel/node_modules/playwright');
  (async () => {
    const browser = await chromium.launch({headless: true, ...(process.env.PANEL_CHROMIUM ? {executablePath: process.env.PANEL_CHROMIUM} : {})});
    try {
      for (const width of [1280, 390]) {
        const page = await browser.newPage({viewport: {width, height: 900}});
        await page.route('**/*', route => route.abort());
        await page.setContent('<style>' + css + '</style><main class="exam-doc" style="margin:20px;max-width:660px">' + rendered + '</main>');
        for (const media of ['screen', 'print']) {
          await page.emulateMedia({media});
          const data = await page.evaluate(() => ({
            text: document.querySelector('main').textContent,
            fonts: [...document.querySelectorAll('.marker-angle-glyph')].map(n => getComputedStyle(n).fontFamily),
            overflow: document.documentElement.scrollWidth > innerWidth,
            underlines: document.querySelectorAll('.underline-marker .marker-angle').length,
            fitted: [...document.querySelectorAll('.marker-angle')].every(n => n.getBoundingClientRect().width > 0)
          }));
          assert.equal(data.overflow, false, width + ' ' + media);
          assert.equal(data.underlines, 6);
          assert.ok(data.fitted);
          assert.ok(data.text.includes('<1>') && data.text.includes('<<1>>') && data.text.includes('(1)'));
          assert.ok(data.fonts.every(font => font.startsWith('"Exam Angle Brackets"')));
        }
        await page.emulateMedia({media: 'screen'});
        await page.screenshot({path: '/tmp/exam-angles-' + width + '.png', fullPage: true});
        await page.pdf({path: '/tmp/exam-angles-' + width + '.pdf', format: 'A4'});
        await page.close();
      }
      console.log('PASS: angle labels and MS Mincho font selection, desktop/mobile screen/print, no overflow, PDF rendering');
    } finally { await browser.close(); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
