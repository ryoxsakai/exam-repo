const fs = require('fs'), vm = require('vm'), assert = require('node:assert/strict');
const path = require('path'), root = path.resolve(__dirname, '..');
const context = {}; context.window = context; vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'assets/js/markup.js'), 'utf8'), context);
const render = text => context.Markup.render(text).html;
context.Markup.setImageBase('https://example.test');
assert.equal(render('![図](/api/image/a.png)'), '<span class="blk"><img class="exam-img" src="https://example.test/api/image/a.png" alt="図" title="図"></span>');
for (const size of ['large', 'medium', 'small', 'full']) {
  for (const align of ['left', 'right', 'center']) {
    const text = `![図](/api/image/a.png){size=${size} align=${align} caption="図1 English caption"}`;
    assert.match(render(text), new RegExp(`exam-figure-${size} exam-figure-${align}`));
    assert.match(render(text), /class="exam-caption">図1 English caption<\/span>/);
    assert.equal(context.Markup.strip(text).trim(), '');
  }
}
assert.match(render('![図](a.png){align=left}'), /exam-figure-medium exam-figure-left/);
assert.match(render('![図](a.png){caption="text"}'), /exam-figure-auto exam-figure-center/);
assert.match(render('![図](a.png){caption="a } b \\"quoted\\" & <script>" align=right size=small}'), /a } b &quot;quoted&quot; &amp; &lt;script&gt;/);
assert.match(render('![図](a.png){size=invalid}'), /\{size=invalid\}/);
assert.equal((render('![a](a.png){size=small}\n![b](b.png){caption="B"}').match(/role="figure"/g)||[]).length, 2);
const source = fs.readFileSync(path.join(root,'worker/mcp.ts'), 'utf8');
const clean = source.slice(source.indexOf('function cleanPassageText'), source.indexOf('function englishWords')).replace('value: unknown', 'value');
vm.runInContext(clean, context);
const text = 'One two. ![alt](https://example.test/image.png){caption="English __caption__" size=small align=left} Three.';
assert.equal(context.cleanPassageText(text).trim(), 'One two.   Three.');
assert.equal(context.Markup.strip(text).trim(), 'One two.   Three.');
console.log('PASS: old images, all sizes/alignments, caption escaping, optional/reordered tags, invalid tags, multiple images, browser/Worker passage extraction');
