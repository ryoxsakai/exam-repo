const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(root + '/index.html', 'utf8');
const setting = fs.readFileSync(root + '/setting/index.html', 'utf8');
const parser = html.match(/src="(assets\/js\/markup[^"?]*\.js)/)[1];
assert.ok(setting.includes('../' + parser));
const source = fs.readFileSync(root + '/' + parser, 'utf8');
assert.equal(source, fs.readFileSync(root + '/assets/js/markup.js', 'utf8'));
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context);
const M = context.window.Markup;
const render = input => M.render(input).html;
for (const input of ['*italic*', '*two words*', '日本語の*語句*です', '*A*', '*one* and *two*']) {
  assert.match(render(input), /<em>[^<]+<\/em>/, input);
}
assert.match(render('*one **bold** end*'), /<em>one <strong>bold<\/strong> end<\/em>/);
assert.match(render('**bold** and ||||old italic|||| and *new italic*'), /<strong>bold<\/strong>.*<em>old italic<\/em>.*<em>new italic<\/em>/);
for (const input of ['word* and another*', '*1 first and *2 second', '*notes and *terms', 'word* and *another', '\\*escaped\\*', '*missing close', '* space *']) {
  assert.doesNotMatch(render(input), /<em>/, input);
}
assert.match(render('word* and *italic*'), /word\* and <em>italic<\/em>/);
assert.match(render('read *<script>* now'), /<em>&lt;script&gt;<\/em>/);
assert.equal(M.strip('Read *one **bold** phrase* now.'), 'Read one bold phrase now.');
assert.equal(M.strip('word* and *1 and *2'), 'word* and *1 and *2');
assert.match(render('Read *see ##term::訳##*.'), /<em>see <span/);
assert.equal(M.render('Read *see ##term::訳##*.').footnotes.length, 1);
console.log('PASS: single-star italics, nested bold, legacy italics, note markers, escaping, footnotes and strip');
