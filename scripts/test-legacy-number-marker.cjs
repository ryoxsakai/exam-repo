const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
for (const path of ['assets/js/markup.js', 'assets/js/markup-20261109marker.js']) {
 const ctx = {window:{}}; vm.runInNewContext(fs.readFileSync(path, 'utf8'), ctx);
 const render = s => ctx.window.Markup.render(s).html;
 for (const input of ['~~1~~__governing__', '~~12~~ __volume__']) {
  const html = render(input);
  assert.match(html, /<sub class="underline-marker">\d+<\/sub><u>/);
  assert.doesNotMatch(html, /wavy-underline/);
 }
 assert.match(render('~~1~~==word=='), /<sub class="underline-marker">1<\/sub><span class="double-underline">word/);
 assert.match(render('~~1~~~~word~~'), /<sub class="underline-marker">1<\/sub><span class="wavy-underline">word/);
 assert.match(render('~~1~~ alone'), /<span class="wavy-underline">1<\/span>/);
 assert.match(render('~~word~~__next__'), /<span class="wavy-underline">word<\/span><u>next/);
 assert.match(render('(1)__word__'), /<sub class="underline-marker">/);
}
console.log('PASS: legacy numeric markers, underline variants, standalone waves and existing markers');
