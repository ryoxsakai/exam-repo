const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const parser = index.match(/src="(assets\/js\/markup[^"?]*\.js)/)[1];
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, parser), 'utf8'), ctx);
const M = ctx.window.Markup;
for (const lead of [
  '次の英文を読み、{{問24}}〜{{問28}}に答えなさい。*の付いた語には[Notes]があります。',
  '次の文の**4番目**を選びなさい。',
  'Choose [[1]] from ((1)) to ((4)).'
]) {
  const sections = M.mergeLeadSections([{type:'リード文', text:lead}, {type:'本文', text:'Body.'}]);
  const html = M.render(sections[0].text).html;
  assert.match(html, /class="blk lead-line"><strong>/);
  assert.doesNotMatch(html, /\*\*/);
  if (lead.includes('[Notes]')) assert.match(html, /\*の付いた語/);
  if (lead.includes('4番目')) assert.match(html, /<strong>4番目<\/strong>/);
  if (lead.includes('{{問24}}')) assert.match(html, /question-badge/);
  if (lead.includes('[[1]]')) assert.match(html, /blank-badge/);
}
assert.equal(fs.readFileSync(path.join(root,parser),'utf8'), fs.readFileSync(path.join(root,'assets/js/markup.js'),'utf8'));
console.log('PASS: lead wrappers, literal notes, nested bold and markers');
