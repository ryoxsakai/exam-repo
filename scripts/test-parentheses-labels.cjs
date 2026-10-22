// Synthetic section contents only; exercise the public parser and shared parser.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const shared = fs.readFileSync(path.join(root, 'assets/js/markup.js'), 'utf8');
for (const entry of ['index.html', 'setting/index.html']) {
  const html = fs.readFileSync(path.join(root, entry), 'utf8');
  const src = html.match(/src="([^"?]*\/markup[^"?]*\.js)/)[1];
  assert.equal(fs.readFileSync(path.resolve(root, path.dirname(entry), src), 'utf8'), shared);
}
const context = {window: {}};
vm.runInNewContext(shared, context);
const M = context.window.Markup;
const text = '(1) と (12)、(a)、(I)、（ア）、（あ）を参照。';
const source = ['リード文', '本文', '設問', '解答', '全訳', '解説'].map(type => '{{' + type + '}}\n' + text).join('\n');
for (const section of M.parseSections(source)) {
  const html = M.render(section.text, {zenyaku: section.type === '全訳'}).html;
  assert.equal((html.match(/class="marker-label"/g) || []).length, 6, section.type);
  assert.doesNotMatch(html, /underline-marker/, 'Ordinary references stay on the baseline');
  assert.equal(M.strip(section.text), text);
}
for (const input of ['**(1)**', '__（ア）__', '::(a)::', '| (1) | (a) |\n| --- | --- |\n| （ア） | (I) |', '{{問1}} (a) First sentence\n(b) Second sentence']) {
  assert.match(M.render(input).html, /marker-label/);
}
for (const input of ['(word)', '（補足の文章）', '(123)', '()', '(　　)', '`(1)`', 'https://example.test/(1)', '[link](https://example.test/(1))', '((1)) choice']) {
  assert.doesNotMatch(M.render(input).html, /marker-label/, input);
}
for (const style of ['__', '~~', '==']) {
  const html = M.render('(1)' + style + 'underlined' + style + ' を (1) で参照。').html;
  assert.equal((html.match(/underline-marker/g) || []).length, 1);
  assert.equal((html.match(/class="marker-label"/g) || []).length, 2);
}
console.log('PASS: public/shared parsers, all six sections, nested styles, tables, paired sentences, baseline references, protected literals and existing underline markers');
