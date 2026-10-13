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
for (const input of ['a-b', 'a - b', 'a---b', 'a-----b', 'a—b', 'a —— b', '---', '`a--b`', '``a--b``',
  'https://example.test/a--b?q=--', 'www.example.test/a--b', '<!-- a--b -->', '<!-- a\n--b -->',
  '<a href="a--b">', '\\--', '```js\na--b\n```', '~~~\na--b\n~~~', '```js\na--b', '<code>a--b</code>', '<pre>a--b</pre>', '[link](./a--b)']) {
  const html = M.render(input).html; assert.ok(!html.includes('em-dash'), input);
}
assert.equal((M.render('a -- -- b').html.match(/em-dash/g)||[]).length, 2);
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
 const html=fs.readFileSync(root+'/'+file,'utf8'); assert.match(html,/markup-20261013dash\.js/);
}
assert.equal(source, fs.readFileSync(root+'/assets/js/markup-20261013dash.js','utf8'));
assert.match(fs.readFileSync(root+'/panel/app.js','utf8'), /import '\.\.\/assets\/js\/markup\.js'/);
console.log('PASS: prose dashes, spacing, literal protection, exam notation, tables, source preservation, all released consumers');
if (process.argv.includes('--browser')) (async () => {
 const {chromium}=require('../panel/node_modules/playwright');
 const browser=await chromium.launch({executablePath:process.env.PANEL_CHROMIUM||undefined});
 try {
  for (const width of [1280,390]) {
   const page=await browser.newPage({viewport:{width,height:900}}); await page.route('**/*',r=>r.abort());
   await page.setContent('<style>'+fs.readFileSync(root+'/assets/css/main.css','utf8')+'</style><div class="exam-doc" id="print-area">'+M.render('Body--phrase\n\n__under--lined__\n\n[[--A--]]\n\nhttps://example.test/a--b\n\n`code--literal`').html+'</div>');
   assert.match(await page.locator('.exam-doc').textContent(), /Body —— phrase/);
   assert.equal(await page.locator('.em-dash').count(),2);
   await page.emulateMedia({media:'print'});
   assert.match(await page.locator('.exam-doc').textContent(), /under —— lined/);
   await page.pdf({path:'/tmp/exam-dash-'+width+'.pdf',format:'A4'});
   await page.screenshot({path:'/tmp/exam-dash-'+width+'.png',fullPage:true}); await page.close();
  }
  console.log('PASS: desktop/mobile display and print with A4 PDF evidence');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
