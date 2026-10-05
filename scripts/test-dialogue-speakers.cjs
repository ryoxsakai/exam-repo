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
for (const file of ['assets/js/markup.js', active]) {
  const ctx = {window: {}};
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx);
  const source = '{{リード文}}\n次のインタビューを読みなさい。\n{{本文}}\nK. Swisher: How?\nE. Musk: Fine.\nSwisher: Why?\nMusk: Because.';
  const render = (text, dialogueSource = source, zenyaku = true) => ctx.window.Markup.render(text, {zenyaku, dialogueSource}).html;
  for (const label of ['K. スウィッシャー：', 'E. マスク：', 'スウィッシャー：', 'マスク：', 'F. ザカリア:', 'B. ゲイツ:', 'コーリー＝フリードマン:']) {
    const html = render(label + ' 話の内容。[[A]] と __根拠__。');
    assert.ok(html.includes('<strong class="dialogue-speaker">' + label + '</strong>'));
    assert.doesNotMatch(html, /blk indent/);
    assert.match(html, /blank-badge/);
    assert.match(html, /<u>根拠<\/u>/);
    assert.doesNotMatch(render(label + '内容', ''), /dialogue-speaker/);
    assert.doesNotMatch(render(label + '内容', source, false), /dialogue-speaker/);
  }
  for (const label of ['注：', '例：', '出典：', '問題：', '設問：', '解答：', '解説：', 'ポイント：', 'テーマ：', 'NASA：', '本文の要点は：', '問1：', 'Question：', 'Answer：', 'constructor：', 'toString：']) {
    assert.doesNotMatch(render(label + '内容'), /dialogue-speaker/, label);
  }
  for (const [english, japanese] of [['Professor', '教授'], ['Student', '学生'], ['Host', '司会者']]) {
    const paired = '{{本文}}\n' + english + ': Hello.\nAlex: Hi.';
    assert.ok(render(japanese + '： 内容', paired).includes('dialogue-speaker'));
    assert.doesNotMatch(render(japanese + '： 内容', source), /dialogue-speaker/);
  }
  const named = '{{リード文}}\n次の会話文を読みなさい。\n{{本文}}\nQuestion: How?\nCory Friedman: Fine.\nQ: Why?\nCF: Because.\nQ: When?\nCF: Today.';
  for (const label of ['問:', 'CF:', 'CF：']) assert.ok(render(label + ' 内容', named).includes('dialogue-speaker'));
  assert.doesNotMatch(render('問: 見出し', source), /dialogue-speaker/);
  const bold = render('**マスク：** 内容');
  assert.equal((bold.match(/<strong>/g) || []).length, 1);
  assert.doesNotMatch(bold, /dialogue-speaker|<strong[^>]*>[^<]*<strong/);
  assert.doesNotMatch(render('マスク：内容', '{{本文}}\nNote: heading\nAnswer: answer'), /dialogue-speaker/);
}
console.log('PASS: translated names/colons and source-derived aliases; non-dialogue/headings/markup remain unchanged');
for (const file of ['assets/js/markup.js', active]) {
 const ctx={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),ctx);
 const render=(text,source='')=>ctx.window.Markup.render(text,{zenyaku:true,dialogueSource:source}).html;
 for(const label of ['A：','B：','Alex：','Mr. Lee：','K. Swisher：','Q (Christiane Amanpour)：','A ：']) {
  assert.ok(render(label+' 発話').includes('<strong class="dialogue-speaker">'+label+'</strong>'));
 }
 for(const label of ['Question：','Answer：','Note：','Source：','Question ：','NASA：','U.S.：']) assert.doesNotMatch(render(label+' 説明'),/dialogue-speaker/);
 for(const [english,japanese] of [['Woman','女性'],['Man','男性'],['Doctor','医師'],['Patient','患者'],['Teacher','先生'],['Female Reporter','女性レポーター'],['TV Anchor','テレビキャスター'],['Prof. Gable','ゲーブル教授'],['Dr. Wadman','ウォドマン医師'],['Mr. Whitaker','ホイッティカー氏'],['Dr. Taylor','テイラー博士'],['Prof.','教授']]) {
  const source='{{問題}}\n@@'+english+': Hello.\n@@Alex: Hi.';
  for(const colon of [':','：']) assert.ok(render(japanese+colon+' 発話',source).includes('dialogue-speaker'),japanese+colon);
  assert.doesNotMatch(render(japanese+'：説明','{{本文}}\nNote: info\nAnswer: response'),/dialogue-speaker/);
 }
 const source='{{問題}}\n{{ア}}\n@@Kate: Hi.\n@@Nancy: Hello.\n{{イ}}\n@@Jack: Hi.\n@@Tom: Hello.\n{{解説}}\nNote: heading';
 assert.match(render('ケイト ： 発話',source),/dialogue-speaker/);
 assert.match(render('ナンシー：発話',source),/dialogue-speaker/);
 const prefixed=render('(ア) ケイト：発話',source);
 assert.match(prefixed,/\(ア\) <strong class="dialogue-speaker">ケイト：<\/strong>/);
 assert.doesNotMatch(render('注：説明',source),/dialogue-speaker/);
 const named='{{本文}}\nSusan: Hi.\nBarry: Hello.';
 assert.match(render('スーザン(以下S)：発話',named),/dialogue-speaker/);
 assert.doesNotMatch(render('**Alex：** 発話'),/dialogue-speaker|<strong[^>]*>[^<]*<strong/);
}
console.log('PASS: both colon widths, source-backed Japanese roles/titles, dialogue subheadings, and protected ordinary headings');
for (const file of ['assets/js/markup.js', active]) {
  const ctx = {window: {}};
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx);
  const render = (text, opts) => ctx.window.Markup.render(text, opts).html;
  const named = 'In this interview, Cory describes his life.\nQuestion: How?\nCory Friedman: Fine.\nQ: Why?\nCF: Because with [[A]] and __evidence__.\nQ: When?\nCF: Today.\nAnswer: Enough.\nNASA: Space.';
  for (const separator of [':', '：', ' ：', '\t：']) {
    const text = named.replaceAll(':', separator);
    const html = render(text, {paraNum: true});
    assert.equal((html.match(/dialogue-speaker/g) || []).length, 7, separator);
    for (const label of ['Question', 'Answer', 'CF']) assert.ok(html.includes('dialogue-speaker">' + label + separator + '</strong>'));
    assert.doesNotMatch(html, /dialogue-speaker">NASA/);
    assert.match(html, /blank-badge/); assert.match(html, /<u>evidence<\/u>/);
    assert.doesNotMatch(render(text.replace('In this interview', 'In this exercise')), /dialogue-speaker">(?:Question|Answer|CF)/);
    assert.doesNotMatch(render(text.replaceAll('CF' + separator, 'ZZ' + separator)), /dialogue-speaker">ZZ/);
    const qa = '次のインタビューを読みなさい。\nQuestion: How?\nAnswer: Fine.\nQ: Why?\nA: Because.\nQ: When?\nA: Today.';
    assert.equal((render(qa.replaceAll(':', separator)).match(/dialogue-speaker/g) || []).length, 6);
    const translation = render('CF：内容\nQuestion：質問\nAnswer：返答\n問：質問', {zenyaku: true, dialogueSource:'{{本文}}\n' + text});
    assert.equal((translation.match(/dialogue-speaker/g) || []).length, 4);
  }
  const mixed = named.replace('Q: Why?', 'Q： Why?').replace('CF: Because', 'CF ： Because').replace('Question:', 'Question：').replace('Answer:', 'Answer ：');
  assert.equal((render(mixed).match(/dialogue-speaker/g) || []).length, 7);
  const insufficient = '次のインタビュー\nQuestion： Heading\nQ： One?\nA： One.';
  assert.doesNotMatch(render(insufficient), /dialogue-speaker">Question/);
  for (const line of ['Question： Heading','Answer ： Key','CF： Abbreviation','NASA： Agency','Note： Important','U.S.： Country']) assert.doesNotMatch(render(line), /dialogue-speaker/);
  assert.doesNotMatch(render('**CF：** Content\n**Question：** Question'), /dialogue-speaker|<strong[^>]*>[^<]*<strong/);
}
console.log('PASS: guarded interview aliases use either colon width in source, translation and mixed-width dialogue');
