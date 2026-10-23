const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const root = require('node:path').resolve(__dirname, '..');
const ctx = {window: {}}; vm.createContext(ctx);
const source = fs.readFileSync(root + '/assets/js/markup.js', 'utf8');
vm.runInContext(source, ctx); const M = ctx.window.Markup;
const dash = ' <span class="em-dash">——</span> ';
for (const input of ['word--word', 'word -- word', 'word  --\tword', 'word　--　word']) {
  assert.ok(M.render(input).html.includes('word' + dash + 'word'), input);
}
for (const input of ['--word', 'word--', '--']) assert.ok(M.render(input).html.includes(dash), input);
assert.ok(M.render('a--b--c').html.includes('a' + dash + 'b' + dash + 'c'));
for (const input of ['a-b', 'a - b', '---', '`a--b`', '``a--b``', '``a`--b``', '<CODE>a--b</CODE>',
  'https://example.test/a--b?q=--', 'www.example.test/a--b', '<!-- a--b -->', '<!-- a\n--b -->',
  '<a href="a--b">', '\\--', '```js\na--b\n```', '~~~\na--b\n~~~', '```js\na--b', '<code>a--b</code>', '<pre>a--b</pre>', '[link](./a--b)', '[link](./a--b "title ) --")', '[link](<./a_(--b>)', '[link](https://example.test/a_(b)--c)', '[link](./a_(b_(c))--d)', '[link](./a_\\(b\\)--c)', '<a title="1 > 0" href="a--b">', "<a title='1 > 0' href='a--b'>"]) {
  const html = M.render(input).html; assert.ok(!html.includes('em-dash'), input);
}
for (const input of ['clarity - you should say what you mean - and the subject', 'raining - there is just the process', 'flashing - there is just the flashing', 'word  -\tword', 'word　-　word']) {
  assert.ok(M.render(input).html.includes(dash), input);
}
assert.equal((M.render('clarity - you should say what you mean - and the subject').html.match(/em-dash/g)||[]).length, 2);
// Screenshot regression: both parenthetical dashes touch English prose words.
const screenshot = 'It—and another just like it—belonged to John Dalton, the English schoolteacher.';
assert.ok(M.render(screenshot).html.includes('It' + dash + 'and another just like it' + dash + 'belonged'));
for (const glyph of ['—', '–', '―', '——', '––', '――']) {
  for (const spacing of ['', ' ', '　', '\t']) {
    const input = 'word' + spacing + glyph + spacing + 'word';
    assert.ok(M.render(input).html.includes('word' + dash + 'word'), input);
    assert.equal(M.strip(input), input, 'Source text for corpus remains unchanged');
  }
}
// Common Unicode/OCR variants, arbitrary runs, Japanese and style boundaries.
for (const glyph of ['-', '‐', '‑', '‒', '–', '—', '―', '−', '⸺', '⸻', '﹘', '﹣', '－']) {
  for (const count of [1, 2, 3, 5]) {
    const mark = glyph.repeat(count);
    assert.ok(M.render('word ' + mark + ' word').html.includes('word' + dash + 'word'), glyph + count);
    if (glyph !== '-' || count < 4) assert.equal(M.strip('word ' + mark + ' word'), 'word ' + mark + ' word');
    if (count > 1 || !['-', '‐', '‑'].includes(glyph)) {
      assert.ok(M.render('word' + mark + 'word').html.includes('word' + dash + 'word'), glyph + count + ' touching');
    }
  }
}
for (const input of ['a---b', 'a-----b', 'a —— b', 'word - - word', 'word — – ― word', 'word\u00a0—\u00a0word', 'word\u2009–\u2009word', 'word -word', 'word- word', 'word. - Next', '説明―補足', '説明－補足', '説明 − 補足', '—Opening words', 'Closing words—', 'word—5 reasons', '3kg—word', 'word—word2', 'word⸺word', 'word⸻word']) {
  assert.equal((M.render(input).html.match(/class="em-dash"/g) || []).length, 1, input);
}
for (const input of ['**word**—__word__', '__word__ - **word**', 'word—((1))', '(1)—word', 'I—a teacher', 'a—b', 'x—y']) {
  assert.match(M.render(input).html, /em-dash/, input);
}
for (const input of ['**5**–**10**', '__5__ − __3__', 'A–Z', 'I–III', '1e−3', '−5', '5 − 3', 'x−y', '2020－2022', '2020--2022', 'well‐being', 'non‑profit', 'soft\u00adhyphen', 'スーパー', '説明〜補足', '---', '----']) {
  assert.doesNotMatch(M.render(input).html, /em-dash/, input);
}
const normalized = screenshot.replace(/—/g, ' —— ');
assert.equal(M.render(screenshot).html, M.render(normalized).html);
for (const input of ['2020–2022', '5—3', '3.5―1.2', 'x–y', '−5', 'well-being', '`word—word`', '<code>word—word</code>', 'https://example.test/word—word', '[link](./word—word)', '![word—word](a.png)']) {
  assert.doesNotMatch(M.render(input).html, /em-dash/, input);
}
for (const type of ['リード文', '本文', '設問', '解答', '全訳', '解説']) {
  const section = M.parseSections('{{' + type + '}}\n' + screenshot)[0];
  assert.equal((M.render(section.text).html.match(/class="em-dash"/g) || []).length, 2, type);
}
assert.match(M.render('| word—word | other |\n| --- | --- |\n| word–word | other |').html, /em-dash/);
assert.match(M.render('__word—word__ **word–word**').html, /<u>word <span class="em-dash">——<\/span> word<\/u>/);
for (const input of ['5 - 3', '５ - ３', '2020 - 2022', '3.5 - 1.2', 'x - y', 'x - value', 'value - x', 'value - 5', '5 - value', '- 5', 'subject-verb-object', 'word - 3kg', '3kg - word', 'word - word2', '`word - word`', '<code>word - word</code>', '[link](./word - word)', '[[--A--]]']) {
  assert.doesNotMatch(M.render(input).html, /em-dash/, input);
}
assert.equal(M.strip('clarity - you'), 'clarity - you');
for (const input of ['- First item', '  - Second item', '- 日本語の項目', '- **Important** item', '- a point', '- I think so']) {
  const html=M.render(input,{zenyaku:true}).html;
  assert.ok(html.includes('・ '),input);assert.doesNotMatch(html,/class="blk indent"/,input);
}
assert.equal((M.render('- First item\n- Second item').html.match(/・ /g)||[]).length,2);
for (const input of ['- 5','- 3.5','- ５','- x','- x + y','- 3 kg','- 1e5','`- First item`','```\n- First item\n```','<pre>- First item</pre>']) {
  assert.ok(!M.render(input).html.includes('・ '),input);
}
assert.equal(M.strip('- First item'),'- First item');

assert.equal((M.render('a -- -- b').html.match(/em-dash/g)||[]).length, 1);
assert.doesNotMatch(M.render('![alt](a.png){caption="`[link](./a--b)`"}').html, /[\uE000\uE001]/);
assert.match(M.render('----').html, /exam-hr/);
assert.match(M.render('| a--b | c |\n| --- | :--: |\n| d--e | f |').html, /<table/);
assert.equal((M.render('| a--b | c |\n| --- | :--: |\n| d--e | f |').html.match(/em-dash/g)||[]).length, 2);
for (const input of ['[[-- --]]', '[[--A--]]', '[[--]]']) {
  const html=M.render(input).html; assert.match(html, /blank-badge-wide/); assert.doesNotMatch(html, /em-dash/);
}
assert.ok(M.render('__a--b__ **c--d** ==e--f==').html.includes('<u>a' + dash + 'b</u>'));
assert.match(M.render('![alt](https://example.test/a--b.png)').html, /src="https:\/\/example.test\/a--b.png"/);
assert.ok(M.render('a--`b--c`--d').html.includes('`b--c`'));
assert.ok(M.render('\uE000a--b').html.includes('\uE000a' + dash + 'b'));
assert.equal(JSON.stringify(M.render('a--b').footnotes), '[]');
assert.equal(M.strip('a--b'), 'a--b');
for (const file of ['index.html', 'setting/index.html']) {
 const html=fs.readFileSync(root+'/'+file,'utf8');
 const parser=html.match(/src="((?:\.\.\/)?assets\/js\/markup[^"?]*\.js)/);
 assert.ok(parser, file+' loads a markup parser');
 assert.equal(source, fs.readFileSync(require('node:path').resolve(root,require('node:path').dirname(file),parser[1]),'utf8'));
}
assert.match(fs.readFileSync(root+'/panel/app.js','utf8'), /import '\.\.\/assets\/js\/markup\.js'/);
console.log('PASS: prose dashes, spacing, literal protection, exam notation, tables, source preservation, all released consumers');
if (process.argv.includes('--browser')) (async () => {
 const {chromium}=require('../panel/node_modules/playwright');
 const browser=await chromium.launch({executablePath:process.env.PANEL_CHROMIUM||undefined});
 try {
  for (const width of [1280,390]) {
   const page=await browser.newPage({viewport:{width,height:900}}); await page.route('**/*',r=>r.abort());
   await page.setContent('<style>'+fs.readFileSync(root+'/assets/css/main.css','utf8')+'</style><div class="exam-doc" id="print-area">'+M.render('Body - phrase\n\n__under--lined__\n\n' + screenshot + '\n\n[[--A--]]\n\nhttps://example.test/a--b\n\n`code--literal`').html+'</div>');
   assert.match(await page.locator('.exam-doc').textContent(), /Body —— phrase/);
   assert.equal(await page.locator('.em-dash').count(),4);
   assert.match(await page.locator('.exam-doc').textContent(), /It —— and another just like it —— belonged/);
   assert.ok(await page.locator('.em-dash').evaluateAll(nodes=>nodes.every(n=>n.textContent==='——' && n.previousSibling.textContent.endsWith(' ') && n.nextSibling.textContent.startsWith(' '))));
   await page.emulateMedia({media:'print'});
   assert.match(await page.locator('.exam-doc').textContent(), /under —— lined/);
   await page.pdf({path:'/tmp/exam-dash-'+width+'.pdf',format:'A4'});
   await page.screenshot({path:'/tmp/exam-dash-'+width+'.png',fullPage:true}); await page.close();
  }
  console.log('PASS: desktop/mobile display and print with A4 PDF evidence');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
