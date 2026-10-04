const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const active = fs.readFileSync(path.join(root, 'index.html'), 'utf8').match(/src="(assets\/js\/markup-[^"]+)"/)[1];
for (const file of ['assets/js/markup.js', active]) {
  const ctx = {window: {}};
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx);
  const render = text => ctx.window.Markup.render(text, {paraNum: true}).html;
  for (const name of ['A', 'B', 'Mr. Lee', 'Alex', 'Swisher', 'Musk', 'F. Zakaria', 'B. Gates', 'K. Swisher', 'E. Musk', 'J. K. Rowling', 'Q (Christiane Amanpour)', 'Speaker 1']) {
    const html = render(name + ': Speech with [[A]] and __evidence__.');
    assert.ok(html.includes('<strong class="dialogue-speaker">' + name + ':</strong>'), name);
    assert.doesNotMatch(html, /blk indent/);
    assert.match(html, /blank-badge/);
    assert.match(html, /<u>evidence<\/u>/);
  }
  for (const text of ['Question: Choose an answer.', 'Answer: Correct.', 'Note: Read carefully.', 'Example: A sample.', 'Source: A book.', 'Instructions: Choose.', 'Directions: Read.', 'Explanation: Because.', 'CF: An abbreviation.', 'NASA: A space agency.', 'U.S.: A country.', 'e.g.: An example.', 'The reason is: clear.', '[[A]]: blank', 'Q (1): heading']) {
    assert.doesNotMatch(render(text), /dialogue-speaker/, text);
  }
  const interview = '次のインタビューを読みなさい。\nQuestion: How?\nAnswer: Like this.\nQ: Why?\nA: Because.\nQ: When?\nA: Today.';
  assert.equal((render(interview).match(/dialogue-speaker/g) || []).length, 6);
  assert.doesNotMatch(render(interview.replace('次のインタビューを読みなさい。', 'Exercise: Read.')), /dialogue-speaker">Question/);
  const named = 'In this interview, Cory describes his life.\nQuestion: How?\nCory Friedman: Fine.\nQ: Why?\nCF: Because.\nQ: When?\nCF: Today.\nNASA: Space.';
  assert.equal((render(named).match(/dialogue-speaker/g) || []).length, 6);
  assert.doesNotMatch(render(named), /dialogue-speaker">NASA/);
  assert.doesNotMatch(render(named.replace('Cory Friedman:', 'Chris Freeman:').replaceAll('CF:', 'ZZ:')), /dialogue-speaker">ZZ/);
  const bold = render('**K. Swisher:** Hello.\n**A:** [[1]]');
  assert.equal((bold.match(/<strong>/g) || []).length, 2);
  assert.doesNotMatch(bold, /<strong[^>]*>[^<]*<strong|dialogue-speaker/);
  assert.doesNotMatch(render('次のインタビュー\nQuestion: Heading\nQ: One?\nA: One.'), /dialogue-speaker">Question/);
}
console.log('PASS: initials, names, guarded interview aliases, headings, markup, and released asset');
