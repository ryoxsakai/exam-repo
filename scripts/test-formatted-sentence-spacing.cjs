const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
for (const path of ['assets/js/markup.js', 'assets/js/markup-20261109sentence.js']) {
  const ctx = {window:{}};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path, 'utf8'), ctx);
  const render = s => ctx.window.Markup.render(s).html;
  for (const [input, expected] of [
    ["(C)__why can't they be trained to do other things?__ For example", /things\?<\/u>&nbsp;&nbsp;For example/],
    ['__Really!__ Yes.', /Really!<\/u>&nbsp;&nbsp;Yes/],
    ['**Finished.** Next.', /Finished\.<\/strong>&nbsp;&nbsp;Next/],
    ['__Really?__  “Yes.”', /Really\?<\/u>&nbsp;&nbsp;“Yes/],
    ['__Really?__ (1) Yes.', /Really\?<\/u>&nbsp;&nbsp;<(?:span|exam-marker-fit) class="marker-parentheses/],
    ['__Dr.__ Smith', /Dr\.<\/u> Smith/],
    ['__Really?__ yes', /Really\?<\/u> yes/],
    ['Ordinary? Next.', /Ordinary\?&nbsp;&nbsp;Next/],
  ]) assert.match(render(input), expected, `${path}: ${input}`);
}
console.log('PASS: formatted punctuation spacing and existing abbreviation behavior');
