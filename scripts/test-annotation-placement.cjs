// Synthetic, read-only regression fixtures. No production data or account writes.
// node scripts/test-annotation-placement.cjs [--browser]
// Browser: panel Playwright, or PLAYWRIGHT_MODULE=/path/to/playwright;
// optional PANEL_CHROMIUM=/path/to/chromium. Evidence: /tmp/exam-annotation-placement/.
// Worker bundling uses panel esbuild, or ESBUILD_MODULE=/path/to/esbuild.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('assets/js/markup.js');
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox, { filename: 'markup.js' });
const M = sandbox.window.Markup;
const plain = value => JSON.parse(JSON.stringify(value));
const failures = [];
let cases = 0;

function test(name, fn) {
  cases++;
  try { fn(); }
  catch (error) { failures.push({ name, error }); }
}
function render(input, opts) {
  const before = JSON.stringify({ input, opts });
  const result = M.render(input, opts);
  assert.deepEqual(plain(M.render(input, opts)), plain(result), 'Repeated rendering must be stable');
  assert.equal(JSON.stringify({ input, opts }), before, 'Rendering must not change source or options');
  assert.doesNotMatch(result.html, /[\uE000\uE001]/, 'Internal literal tokens must not leak');
  return result;
}
function blocks(html) {
  return [...html.matchAll(/<div\b[^>]*class="([^"]*\bfootnote-section\b[^"]*)"[^>]*>([\s\S]*?)<\/div>/g)]
    .map(match => ({ html: match[0], content: match[2], free: /\bfree-note\b/.test(match[1]), offset: match.index }));
}
function numbers(html) {
  return [...html.matchAll(/class="footnote-number">\*(\d+)/g)].map(match => Number(match[1]));
}
function automaticGroups(html) { return blocks(html).filter(block => !block.free).map(block => numbers(block.html)); }
function textContent(html) {
  return html.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}
function ordered(html, strings) {
  let cursor = -1;
  for (const string of strings) {
    const found = html.indexOf(string, cursor + 1);
    assert.ok(found > cursor, `Expected ordered fragment ${JSON.stringify(string)} after ${cursor}`);
    cursor = found;
  }
}
function normalize(text) { return text.replace(/\s+/g, ' ').trim(); }
function warningCodes(result) { return Array.from(result.warnings || [], warning => warning.code); }

test('legacy glossary surface, lemma, caret, occurrence numbering and end placement', () => {
  const result = render('##M^isdiagnosis::誤診## and ##capillaries|capillary::毛細血管##, then ##capillaries|capillary::毛細血管##.');
  assert.deepEqual(plain(result.footnotes), [
    { index: 1, word: 'misdiagnosis', translation: '誤診' },
    { index: 2, word: 'capillary', translation: '毛細血管' },
    { index: 3, word: 'capillary', translation: '毛細血管' },
  ]);
  assert.match(result.html, /Misdiagnosis<sup class="footnote-number">\*1/);
  assert.match(result.html, /capillaries<sup class="footnote-number">\*2/);
  assert.deepEqual(automaticGroups(result.html), [[1, 2, 3]]);
  assert.equal(blocks(result.html).at(-1).offset, result.html.lastIndexOf('<div class="footnote-section'));
});

test('named references select notes, allow re-display and preserve occurrence numbering', () => {
  const result = render([
    'ALPHA ##a@alpha::第一の訳## and ##b@betas|beta::第二の訳##.',
    '##->b,a,b##',
    'BETWEEN',
    '  \t##->a## \t',
    'GAMMA ##gamma::第三の訳## and ##d@delta::第四の訳##.',
  ].join('\n'));
  assert.deepEqual(automaticGroups(result.html), [[2, 1], [1], [3, 4]]);
  assert.deepEqual(plain(result.footnotes).map(note => note.index), [1, 2, 3, 4]);
  ordered(result.html, ['ALPHA', '<strong>beta</strong>', '<strong>alpha</strong>', 'BETWEEN', '<strong>alpha</strong>', 'GAMMA', '<strong>gamma</strong>', '<strong>delta</strong>']);
  assert.doesNotMatch(result.html, /##->/);
  assert.deepEqual(warningCodes(result), []);
});

test('internal IDs do not become displayed numbers; definitions determine numbering before forward calls', () => {
  const result = render('##->99##\nBEFORE DEFINITIONS\n##x@alpha::A## ##99@beta::B## ##old::O##\n##->x##');
  assert.deepEqual(automaticGroups(result.html), [[2], [1], [3]]);
  ordered(result.html, ['<strong>beta</strong>', 'BEFORE DEFINITIONS', 'alpha<sup', '<strong>alpha</strong>', '<strong>old</strong>']);
  assert.doesNotMatch(result.html, /\*99|>99@|>x@/);
  assert.deepEqual(warningCodes(result), []);
});

test('repeated named ID reuses the number with differing surfaces but identical lemma and translation', () => {
  const result = render('##cap@capillaries|capillary::毛細血管## ##cap@capillary|capillary::毛細血管## ##cap@Capillary|capillary::毛細血管##\n##->cap##\n##old::旧## ##old::旧##');
  assert.deepEqual(plain(result.footnotes).map(note => [note.index, note.word]), [[1, 'capillary'], [2, 'old'], [3, 'old']]);
  assert.deepEqual(automaticGroups(result.html), [[1], [2, 3]]);
  assert.equal((result.html.match(/<sup class="footnote-number">\*1/g) || []).length, 3);
  assert.match(result.html, /capillaries<sup/);
  assert.match(result.html, /Capillary<sup/);
  assert.deepEqual(warningCodes(result), []);
  const caret = render('##m@M^isdiagnosis::誤診##\n##->m##');
  assert.equal(caret.footnotes[0].word, 'misdiagnosis');
  assert.match(caret.html, /Misdiagnosis<sup/);
});

test('conflicting named definitions stay literal, warn and never replace the original note', () => {
  for (const conflicting of ['##a@alpha::B##', '##a@beta::A##', '##a@alphas|beta::A##']) {
    const result = render('##a@alpha::A##\n' + conflicting + '\n##->a##');
    assert.equal(result.footnotes.length, 1);
    assert.equal(result.footnotes[0].word, 'alpha');
    assert.equal(result.footnotes[0].translation, 'A');
    assert.ok(textContent(result.html).includes(conflicting));
    assert.deepEqual(automaticGroups(result.html), [[1]]);
    assert.ok(warningCodes(result).includes('duplicate_note_id'));
  }
});

test('repeated identical literal translations compare original text rather than protection tokens', () => {
  for (const translation of ['<food>', '<span title="a|b">food</span>', 'line<br>break', '`literal`']) {
    const definition = '##id@diet::' + translation + '##';
    const result = render(definition + ' ' + definition + '\n##->id##');
    assert.equal(result.footnotes.length, 1, translation);
    assert.equal(result.footnotes[0].translation, translation);
    assert.deepEqual(automaticGroups(result.html), [[1]]);
    assert.deepEqual(warningCodes(result), []);
  }
});

test('unknown references keep the whole call literal and do not hide known notes from the tail', () => {
  for (const call of ['##->missing##', '##->known,missing##', '##->missing,known##']) {
    const result = render('##known@word::訳##\n' + call + '\nAFTER');
    assert.ok(textContent(result.html).includes(call));
    assert.deepEqual(automaticGroups(result.html), [[1]]);
    ordered(result.html, ['AFTER', '<strong>word</strong>']);
    assert.ok(warningCodes(result).includes('undefined_note_id'));
  }
  const missing = render('##->missing##');
  assert.equal(blocks(missing.html).length, 0);
  assert.match(textContent(missing.html), /##->missing##/);
});

test('IDs accept exactly the documented alphabet and maximum length including prototype-like names', () => {
  for (const id of ['1', 'A_b-9', '_', '-', 'a'.repeat(64), '__proto__', 'constructor', 'toString']) {
    const result = render(`##${id}@word::訳##\n##->${id}##`);
    assert.deepEqual(automaticGroups(result.html), [[1]], id);
    assert.deepEqual(warningCodes(result), [], id);
    assert.equal(result.footnotes[0].word, 'word', id);
  }
  for (const id of ['', 'a'.repeat(65), 'bad.id', 'bad id', '日本語']) {
    const call = `##->${id}##`;
    const result = render(`##${id}@word::訳##\n${call}`);
    assert.ok(textContent(result.html).includes(call), 'Malformed ID reference stays literal: ' + id);
    assert.equal(blocks(result.html).filter(block => !block.free).length, result.footnotes.length ? 1 : 0);
  }
});

test('standalone references support padding and CRLF; inline references and old flush notation are literal', () => {
  const crlf = render('##one@one::一##\r\n \t##->one##\r\nAFTER');
  assert.deepEqual(automaticGroups(crlf.html), [[1]]);
  ordered(crlf.html, ['<strong>one</strong>', 'AFTER']);
  for (const marker of ['Text ##->a## here.', '**##->a##**', '##->a## suffix', 'prefix ##->a##', '\\##->a##', '##注釈##']) {
    const result = render('##a@before::前##\n' + marker + '\nAFTER ##after::後##');
    assert.match(textContent(result.html), /##(?:->a|注釈)##/);
    assert.deepEqual(automaticGroups(result.html), [[1, 2]], marker);
    ordered(result.html, ['AFTER', '<strong>before</strong>']);
    assert.deepEqual(warningCodes(result), []);
  }
});

test('complete free note is literal prose without automatic numbers, headwords or rich notation', () => {
  const body = ['**Original note symbol', '**Second symbol', '* Single symbol',
    '__under__ **bold** ::highlight:: ((1)) [[2]] ##word::translation##',
    '##->word##', '##注釈##', ':::注釈', '{{設問}}', '| literal | table |'].join('\n');
  const result = render('BEFORE\n:::注釈\n' + body + '\n:::\nAFTER');
  assert.equal(result.footnotes.length, 0);
  const free = blocks(result.html).filter(block => block.free);
  assert.equal(free.length, 1);
  assert.equal(normalize(textContent(free[0].html)), normalize(body));
  assert.doesNotMatch(free[0].html, /<(?:strong|ol|li|table|mark|sup)\b|class="(?:question|blank|para)-badge/);
  ordered(result.html, ['BEFORE', free[0].html, 'AFTER']);
});

test('free notes do not register definitions or execute named references', () => {
  const result = render('##first@first::第一##\n:::注釈\n**A free note\n##second@second::第二##\n##->first##\n:::\nCONTINUE ##third@third::第三##\n##->first,third##\nEND');
  assert.deepEqual(plain(result.footnotes).map(note => note.word), ['first', 'third']);
  assert.deepEqual(automaticGroups(result.html), [[1, 2]]);
  ordered(result.html, ['**A free note', 'CONTINUE', '<strong>first</strong>', 'END']);
  assert.equal(blocks(result.html).filter(block => block.free).length, 1);
});

test('free-note boundaries require standalone lines and do not consume adjacent prose', () => {
  const result = render('BEFORE\r\n \t:::注釈 \t\r\n**One\r\nTwo\r\n \t::: \r\nAFTER');
  assert.equal(blocks(result.html).filter(block => block.free).length, 1);
  ordered(result.html, ['BEFORE', '**One', 'Two', 'AFTER']);
  for (const text of ['prefix :::注釈\nContent\n:::', ':::注釈 suffix\nContent\n:::', ':::注釈\nContent\n::: suffix\nAFTER']) {
    const literal = render(text);
    assert.equal(blocks(literal.html).filter(block => block.free).length, 0, text);
    assert.match(textContent(literal.html), /:::注釈/);
    assert.match(textContent(literal.html), /Content/);
  }
});

test('a complete literal note owns unmatched code symbols without swallowing its close or later prose', () => {
  for (const note of ['An unfinished backtick `', 'An unfinished code fence\n```', 'An unfinished comment <!--']) {
    const result = render(':::注釈\n' + note + '\n:::\nNormal `after` text.');
    const free = blocks(result.html).filter(block => block.free);
    assert.equal(free.length, 1, note);
    assert.ok(textContent(free[0].html).includes(note));
    assert.ok(textContent(result.html).includes('Normal `after` text.'));
    assert.deepEqual(warningCodes(result), []);
  }
});

test('unterminated blocks remain literal and preserve later content and section boundaries', () => {
  const input = 'BEFORE\n:::注釈\n**Literal note\n##注釈##\n{{設問}}\n{{問2}} FOLLOWING QUESTION';
  const result = render(input);
  assert.equal(blocks(result.html).filter(block => block.free).length, 0);
  assert.match(textContent(result.html), /:::注釈/);
  assert.match(textContent(result.html), /FOLLOWING QUESTION/);
  const sections = plain(M.parseSections('{{本文}}\n' + input));
  assert.deepEqual(sections.map(section => section.type), ['本文', '設問']);
  assert.match(sections[1].text, /FOLLOWING QUESTION/);
});

test('table boundaries remain structural around placements and free notes', () => {
  const table = '| Term | Meaning |\n| --- | --- |\n| ##cap@capillaries|capillary::毛細血管## | cell<br>break |';
  for (const gap of ['\n', '\n\n']) {
    const result = render(table + gap + '##->cap##\n:::注釈\n**Table note\n| literal | pipe |\n:::\nAFTER ##vessels|vessel::血管##');
    assert.equal((result.html.match(/<td[ >]/g) || []).length, 2);
    assert.equal((result.html.match(/<tbody><tr>/g) || []).length, 1);
    assert.deepEqual(automaticGroups(result.html), [[1], [2]]);
    assert.equal(blocks(result.html).filter(block => block.free).length, 1);
    assert.match(result.html, /<td>cell<br\s*\/?\s*>break<\/td>/);
    ordered(result.html, ['</table>', '<strong>capillary</strong>', '**Table note', 'AFTER', '<strong>vessel</strong>']);
    assert.doesNotMatch(result.html.match(/<table[\s\S]*?<\/table>/)[0], /footnote-section/);
  }
  const oneColumn = render('| Header |\n| --- |\n| ##one::一## |\n:::注釈\n**One column note\n:::\nHe studies ##ones|one::一##.');
  assert.equal((oneColumn.html.match(/<td[ >]/g) || []).length, 1);
  assert.deepEqual(automaticGroups(oneColumn.html), [[1, 2]]);
  assert.match(oneColumn.html, /He studies/);
  const cell = render('| Header |\n| --- |\n| ##->missing## |\n| :::注釈 |');
  assert.equal(blocks(cell.html).length, 0);
  assert.match(textContent(cell.html), /##->missing##/);
  assert.match(textContent(cell.html), /:::注釈/);
});

test('attribute-free br spellings create genuine breaks in prose, question, table and note', () => {
  for (const br of ['<br>', '<br/>', '<br />', '<BR>', '<Br/>', '<bR />']) {
    const fixtures = [
      ['First' + br + 'Second', /First<br\s*\/?\s*>Second/],
      ['{{問2}} First' + br + 'Second', /First<br\s*\/?\s*>Second/],
      ['| Header |\n| --- |\n| First' + br + 'Second |', /<td>First<br\s*\/?\s*>Second<\/td>/],
      [':::注釈\n**First' + br + 'Second\n:::', /\*\*First<br\s*\/?\s*>Second/],
    ];
    for (const [input, expected] of fixtures) {
      const result = render(input);
      assert.match(result.html, expected, input);
      assert.doesNotMatch(result.html, /&lt;br\b/i, input);
    }
    assert.equal(normalize(M.strip('first' + br + 'second')), 'first second');
  }
});

const literalFixtures = [
  '`##->missing## <br> :::注釈`',
  '``##->missing## <br> :::注釈``',
  '```text\n##->missing##\n:::注釈\n<br>\n::: \n```',
  '~~~text\n##->missing##\n:::注釈\n<br>\n:::\n~~~',
  '<!--\n##->missing##\n:::注釈\n<br>\n:::\n-->',
  '<pre>\n##->missing##\n:::注釈\n<br>\n:::\n</pre>',
  '<code>\n##->missing##\n:::注釈\n<br>\n:::\n</code>',
  '<span title="##->missing## :::注釈 <br>">literal</span>',
];
test('markers and br inside code, comments and HTML attributes stay escaped and inert', () => {
  for (const literal of literalFixtures) {
    const result = render('##before::前##\n' + literal + '\nAFTER ##after::後##');
    assert.deepEqual(automaticGroups(result.html), [[1, 2]], literal);
    assert.equal(blocks(result.html).filter(block => block.free).length, 0, literal);
    assert.ok(textContent(result.html).includes(literal), literal);
    assert.doesNotMatch(result.html, /<(?:br|pre|code|span\s+title="##|!--)\b/i, literal);
  }
});

const unsafeTags = [
  '<br class="x">', '<BR onclick="window.__annotationInjected=1">',
  '<br style="display:none"/>', '<br data-x="<br>">',
  '<script>window.__annotationInjected=1</script>',
  '<img src=x onerror="window.__annotationInjected=1">',
  '<svg onload="window.__annotationInjected=1"></svg>',
  '<iframe srcdoc="<script>window.__annotationInjected=1</script>"></iframe>',
  '<a href="javascript:window.__annotationInjected=1">link</a>',
];
test('all attribute-bearing tags and injection payloads remain escaped in every note context', () => {
  for (const payload of unsafeTags) {
    for (const input of [payload, '{{問2}} ' + payload, '| H |\n| --- |\n| ' + payload + ' |', ':::注釈\n**' + payload + '\n:::']) {
      const result = render(input);
      assert.ok(textContent(result.html).includes(payload), input);
      assert.doesNotMatch(result.html, /<(?:script|img|svg|iframe|a)(?:\s|>)/i, input);
      assert.doesNotMatch(result.html, /<br\s+[a-z]/i, input);
    }
  }
});

const sectionFixture = [
  '{{本文}}', 'BODY ##1@bodyword::本文語注##', '##->1##',
  ':::注釈', '**Body note', '{{設問}}', '##->1##', ':::', 'BODY TAIL',
  '{{設問}}', '{{問2}} QUESTION<br>SECOND QUESTION LINE ##1@questionword::設問語注##',
  ':::注釈', '**Question note', ':::', '##->1##', 'QUESTION TAIL',
  '{{全訳}}', 'TRANSLATION ##1@translationword::全訳語注##', '##->1##',
  ':::注釈', '**Translation note', ':::', 'TRANSLATION TAIL',
].join('\n');
test('free notes stay within their section and glossary numbering is local to each render', () => {
  const sections = plain(M.parseSections(sectionFixture));
  assert.deepEqual(sections.map(section => section.type), ['本文', '設問', '全訳']);
  assert.match(sections[0].text, /\*\*Body note\n\{\{設問\}\}\n##->1##/);
  for (const section of sections) {
    const result = render(section.text, { paraNum: section.type === '本文', zenyaku: section.type === '全訳' });
    assert.deepEqual(automaticGroups(result.html), [[1]]);
    assert.equal(blocks(result.html).filter(block => block.free).length, 1);
    assert.equal(result.footnotes[0].index, 1);
  }
  const bodyAgain = render(sections[0].text);
  assert.equal(bodyAgain.footnotes[0].word, 'bodyword');
  assert.deepEqual(automaticGroups(bodyAgain.html), [[1]]);
  assert.equal(sectionFixture, sections.map(section => '{{' + section.type + '}}\n' + section.text).join('\n'));
  const separate = render('##->1##');
  assert.equal(separate.footnotes.length, 0);
  assert.match(textContent(separate.html), /##->1##/);
  assert.ok(warningCodes(separate).includes('undefined_note_id'));
});

test('named definitions inside inline decorations and table headers preserve first-use order', () => {
  const result = render('**##a@alphas|alpha::A##** ::##b@beta::B##::\n| ##c@gamma::C## | H |\n| --- | --- |\n| ##a@alpha::A## | cell |\n##->c,b,a##');
  assert.deepEqual(automaticGroups(result.html), [[3, 2, 1]]);
  assert.deepEqual(plain(result.footnotes).map(note => note.word), ['alpha', 'beta', 'gamma']);
  assert.equal((result.html.match(/<sup class="footnote-number">\*1/g) || []).length, 2);
  assert.deepEqual(warningCodes(result), []);
});

test('strip removes free notes and standalone references, and named IDs, preserving word boundaries', () => {
  const input = 'First ##cap@capillaries|capillary::毛細血管##\n##->cap##\n:::注釈\n**DO NOT COUNT\n{{設問}}\n##hidden::秘密##\n:::注釈\n:::\nsecond<br>third';
  assert.equal(normalize(M.strip(input)), 'First capillaries second third');
  assert.match(M.strip('First ##->cap## second'), /##->cap##/, 'Inline placement text is not a directive');
  const malformed = M.strip('First\n:::注釈\nDO NOT SWALLOW\nLast');
  assert.match(malformed, /DO NOT SWALLOW/);
  assert.match(malformed, /Last/);
  assert.equal(M.strip(input), M.strip(input), 'Repeated stripping is stable');
});

const publicAssets = [];
test('both published pages serve the exact shared parser, discovered without a pinned version', () => {
  for (const filename of ['index.html', 'setting/index.html']) {
    const html = read(filename);
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match => match[1]);
    const matches = scripts.filter(asset => /(?:^|\/)markup[^/?]*\.js(?:[?#]|$)/.test(asset));
    assert.equal(matches.length, 1, filename + ' must load exactly one shared parser');
    const asset = path.resolve(root, path.dirname(filename), matches[0].split(/[?#]/)[0]);
    assert.ok(asset.startsWith(root + path.sep), filename + ' parser must be a local published asset');
    assert.equal(fs.readFileSync(asset, 'utf8'), source, filename + ' must not serve a stale parser');
    publicAssets.push({ page: filename, asset: path.relative(root, asset), url: matches[0] });
  }
});

for (const failure of failures) console.error('FAIL: ' + failure.name + '\n' + failure.error.stack);
console.log(`${failures.length ? 'FAIL' : 'PASS'}: ${cases - failures.length}/${cases} annotation placement regression groups`);
if (failures.length) process.exitCode = 1;

workerTest().then(() => {
  if (process.argv.includes('--browser') && !failures.length) return browserTest();
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});

async function workerTest() {
  const { createHmac } = require('node:crypto');
  const { build } = require(process.env.ESBUILD_MODULE || '../panel/node_modules/esbuild');
  const bundle = await build({ stdin: { contents: read('worker/mcp.ts') + '\nexport { extractMarkedSection, replaceMarkedSection, detectCorrectionAuditIssues };', resolveDir: path.join(root, 'worker'), sourcefile: 'mcp.ts', loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm' });
  const { cleanPassageText, analyzePassageText, handleMcpRoute, extractMarkedSection, replaceMarkedSection, detectCorrectionAuditIssues } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const cleaningCases = [
    ['The ##1@capillaries|capillary::毛細血管## carry blood.\n##->1##', 'The capillaries carry blood.'],
    ['##->1,2##\nThe ##1@M^isdiagnosis::誤診## is rare.\n##2@patient::患者##', 'The Misdiagnosis is rare. patient'],
    ['First<br>second<BR/>third<br />fourth', 'First second third fourth'],
    ['First\n:::注釈\n**Hidden prose\n##hidden@word::訳##\n{{設問}}\n##->hidden##\n:::\nlast', 'First last'],
    ['##legacy::旧## and ##id@new::新##\n##->id##', 'legacy and new'],
    ['First\n##->missing##\nlast', 'First last'],
    [':::注釈\nAn unfinished backtick `\n:::\nNormal `after` text.', 'Normal `after` text.'],
    [':::注釈\nAn unfinished code fence\n```\n:::\nNormal text.', 'Normal text.'],
    ['##id@::value##', 'id@'],
  ];
  for (const [input, expected] of cleaningCases) {
    const before = input;
    assert.equal(normalize(cleanPassageText(input)), expected, 'Worker extraction: ' + input);
    assert.equal(normalize(M.strip(input)), expected, 'Browser extraction: ' + input);
    assert.equal(analyzePassageText(input).word_count, (expected.match(/[a-z][a-z'’]*[a-z]|[a-z]/gi) || []).length, 'Note text/IDs must not inflate passage metrics');
    assert.equal(input, before);
  }
  const codeExample = '```text\n:::注釈\nVISIBLE EXAMPLE\n:::\n```';
  assert.match(M.strip(codeExample), /VISIBLE EXAMPLE/);
  assert.match(cleanPassageText(codeExample), /VISIBLE EXAMPLE/);
  // Existing generic HTML stripping removes complete comments from the corpus.
  const commentExample = '<!--\n:::注釈\nVISIBLE EXAMPLE\n:::\n-->';
  assert.equal(normalize(M.strip(commentExample)), normalize(cleanPassageText(commentExample)));
  for (const newline of ['\n', '\r\n']) {
    const body = ['BODY', ':::注釈', '**This note is still part of the body.', '{{全訳}}', '{{設問}}', ':::', 'BODY TAIL'].join(newline);
    const translation = ['TRANSLATION', ':::注釈', '{{設問}}', '**Literal heading within the translation.', ':::'].join(newline);
    const input = ['{{本文}}', body, '{{全訳}}', translation, '{{設問}}', '{{問2}} QUESTION'].join(newline);
    assert.equal(extractMarkedSection(input, '本文'), body);
    assert.equal(extractMarkedSection(input, '全訳'), translation);
    assert.equal(extractMarkedSection(input, '設問'), '{{問2}} QUESTION');
    assert.equal(replaceMarkedSection(input, '全訳', 'REPLACED'), ['{{本文}}', body, '{{全訳}}', 'REPLACED', '{{設問}}', '{{問2}} QUESTION'].join(newline));
    const literalOnly = ['{{本文}}', body, '{{設問}}', 'Question.'].join(newline);
    assert.equal(extractMarkedSection(literalOnly, '全訳'), '');
    assert.equal(replaceMarkedSection(literalOnly, '全訳', 'NEW'), literalOnly + '\n\n{{全訳}}\nNEW');
  }
  assert.equal(extractMarkedSection(':::注釈\nUNTERMINATED\n{{全訳}}\nKEEP THIS', '全訳'), 'KEEP THIS');
  for (const [input, expected] of [
    ['##->missing##', ['undefined_note_id']],
    ['##x@alpha::A## ##x@beta::A##', ['duplicate_note_id']],
    [':::注釈\nUnclosed', ['unclosed_annotation']],
    [':::注釈\n##->missing## [[ (( ## !!!!\n:::', []],
    [literalFixtures.join('\n'), []],
  ]) {
    const issues = detectCorrectionAuditIssues(input, 'problem_text');
    assert.deepEqual([...new Set(issues.map(issue => issue.code))].sort(), expected.sort(), 'Correction audit: ' + input);
  }

  let row;
  const env = { EXAM_SESSION_SECRET: 'synthetic-annotation-test-only', DB: {
    prepare(sql) {
      assert.match(sql, /^SELECT /, 'Validation must only read');
      return { bind() { return this; }, async all() { return { results: [row] }; }, run() { assert.fail('Validation must not write'); } };
    },
    batch() { assert.fail('Validation must not batch writes'); },
    exec() { assert.fail('Validation must not run DDL'); },
  } };
  const payload = Buffer.from(JSON.stringify({ aud: 'medical-exam-mcp', client_id: 'annotation-regression', scope: 'exams:read', exp: Date.now() + 60000 })).toString('base64url');
  const token = payload + '.' + createHmac('sha256', env.EXAM_SESSION_SECRET).update(payload).digest('base64url');
  async function request(method, params) {
    const response = await handleMcpRoute(new Request('https://annotation-validation.test/mcp', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }), env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(!body.error && !body.result?.isError, JSON.stringify(body));
    return body.result;
  }
  let validations = 0;
  async function check(name, problem, expected = [], answer = 'A', commentary = 'Synthetic explanation.') {
    row = { exam_id: 99001, question_number: 2, category: '文法', problem_text: problem, answer_text: answer, commentary_text: commentary };
    const before = JSON.stringify(row);
    const result = await request('tools/call', { name: 'validate_questions', arguments: {} });
    const parsed = result.structuredContent || JSON.parse(result.content[0].text);
    assert.equal(parsed.summary.scanned_count, 1);
    const codes = [...new Set(parsed.results.flatMap(item => item.issues.map(issue => issue.code)))].sort();
    assert.deepEqual(codes, [...expected].sort(), name);
    assert.equal(JSON.stringify(row), before, 'Registered source must remain unchanged');
    validations++;
  }
  await check('same-section named note', '{{設問}}\n{{問2}} ##1@diet::食事##\n##->1##');
  await check('forward call and repeated group references', '##->2,1,2##\n##1@diet::食事## ##2@food::食物##\n##->1##');
  await check('same lemma with plural and singular surfaces', '##c@capillaries|capillary::毛細血管## ##c@capillary::毛細血管##\n##->c##');
  await check('same literal translation is not a token-index conflict', '##id@diet::<food>## ##id@diet::<food>##\n##->id##');
  await check('different literal translations still conflict', '##id@diet::<food>## ##id@diet::<meal>##\n##->id##', ['duplicate_note_id']);
  await check('unreferenced and legacy notes remain valid', '##x@diet::食事## ##legacy::旧##');
  await check('unknown ID', 'Question.\n##->missing##', ['undefined_note_id']);
  await check('partly unknown group', '##known@diet::食事##\n##->known,missing##', ['undefined_note_id']);
  await check('conflicting translation', '##1@diet::食事## ##1@diet::習慣##', ['duplicate_note_id']);
  await check('conflicting lemma', '##1@diet::食事## ##1@food::食事##', ['duplicate_note_id']);
  await check('cross-section reference cannot resolve', '{{本文}}\n##1@diet::食事##\n{{設問}}\n##->1##', ['undefined_note_id']);
  await check('same ID in different sections is independent', '{{本文}}\n##1@diet::食事##\n##->1##\n{{設問}}\n##1@food::食物##\n##->1##');
  await check('inline references and old notation are literal', '##注釈##\nText ##->missing## here.');
  await check('free notes ignore definitions, references and section-like text', '{{設問}}\n##1@diet::食事##\n:::注釈\n##1@food::食物##\n##->missing##\n{{本文}}\n**Literal note\n:::\n##->1##');
  await check('free-note definition cannot resolve outside itself', ':::注釈\n##1@diet::食事##\n:::\n##->1##', ['undefined_note_id']);
  await check('literal contexts cannot register or call notes', literalFixtures.join('\n'));
  await check('masked trailing literals cannot turn inline calls into directives', '##->missing##<!-- example -->\n##->missing##`code`\n:::注釈<span>\nNot a note.');
  await check('Markdown link examples cannot define or call notes', '[##1@diet::食事##](https://example.test/(x))\n[example](https://example.test/##->missing##)');
  await check('bare URL examples do not define notes', 'https://example.test/##a@word::訳##\n##->a##', ['undefined_note_id']);
  await check('literal free notes own unmatched code symbols', ':::注釈\nAn unfinished backtick `\n```\n:::\nNormal `after` text.');
  await check('code definition cannot resolve outside itself', '`##1@diet::食事##`\n##->1##', ['undefined_note_id']);
  await check('answer and commentary have independent annotation scopes', 'Question.', [], '##1@answer::解答##\n##->1##', '##1@commentary::解説##\n##->1##');
  await check('answer cannot borrow a definition from problem', '##1@diet::食事##', ['undefined_note_id'], '##->1##');
  await check('unclosed annotation block', 'Question.\n:::注釈\nUnclosed note', ['unclosed_annotation']);
  await check('free-note symbols do not look like unclosed markup or choices', '((1)) First\n((2)) Second\n:::注釈\n## [[ (( !!!!\n((9)) Not a choice\n:::', [], '((2))');
  await check('note choices in an answer do not inflate answer range', '((1)) First\n((2)) Second', [], '((2))\n:::注釈\n((9)) Not an answer\n:::');
  await check('lead and following section share definitions', '{{リード文}}\n##a@diet::食事##\n{{設問}}\n##->a##');
  await check('lead and following section share conflicts', '{{リード文}}\n##a@diet::食事##\n{{設問}}\n##a@food::食物##\n##->a##', ['duplicate_note_id']);
  await check('consecutive leads share the following render scope', '{{リード文}}\n##a@diet::食事##\n{{リード文}}\n##b@food::食物##\n{{設問}}\n##->b,a##');
  await check('trailing lead group shares definitions', '{{設問}}\nQuestion.\n{{リード文}}\n##a@diet::食事##\n{{リード文}}\n##->a##');
  await check('trailing lead cannot borrow the previous section', '{{設問}}\n##a@diet::食事##\n{{リード文}}\n##->a##', ['undefined_note_id']);
  const listed = await request('tools/list', {});
  const validationTool = listed.tools.find(tool => tool.name === 'validate_questions');
  assert.ok(validationTool, 'Validation tool is discoverable');
  for (const code of ['undefined_note_id', 'duplicate_note_id', 'unclosed_annotation']) {
    assert.ok(validationTool.inputSchema.properties.issue_code.enum.includes(code), 'Validation filter exposes ' + code);
  }
  console.log(`PASS: ${cleaningCases.length} browser/Worker extraction and word-count cases; ${validations} read-only MCP annotation validation cases`);
}

async function browserTest() {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../panel/node_modules/playwright');
  const evidence = '/tmp/exam-annotation-placement';
  fs.mkdirSync(evidence, { recursive: true });
  const origin = 'https://exam-annotation-placement.test';
  const browser = await chromium.launch({ headless: true, ...(process.env.PANEL_CHROMIUM ? { executablePath: process.env.PANEL_CHROMIUM } : {}) });
  const viewerInit = 'document.addEventListener("DOMContentLoaded", init);';
  const viewer = read('assets/js/viewer.js');
  assert.ok(viewer.includes(viewerInit), 'Viewer hook must replace actual initialization');
  const viewerHook = 'window.__annotationTest={renderField,printField,countableTextNodes,lineStartPositions,insertLineNumbers,positionLineNumbers};';
  const cssAssets = [...read('index.html').matchAll(/<link\b[^>]*href="(assets\/css\/[^"?]+\.css)(?:\?[^"]*)?"/g)].map(match => match[1]);
  assert.ok(cssAssets.some(asset => /\/main[^/]*\.css$/.test(asset)), 'Use the actual published main stylesheet');
  const fixture = [
    '[1] A passage with ##body@bodyword::本文の語注## before a table.',
    '| Group | Result |', '| --- | --- |', '| ##cap@capillaries|capillary::毛細血管## | first<br>second |',
    '##->body,cap##',
    ':::注釈', '**TABLE NOTE', '**Second source symbol<br>Second note line', '##注釈##', ':::',
    'AFTER TABLE NOTE. This paragraph must stay outside the table.',
    '##tailword::最後の語注## finishes the passage.',
  ].join('\n');
  const snapshot = JSON.stringify({ fixture, sectionFixture, unsafeTags, literalFixtures });
  const reports = [];
  try {
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, isMobile: width < 640, hasTouch: width < 640, serviceWorkers: 'block' });
      const errors = [], requests = [];
      context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
      await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        requests.push({ url: request.url(), method: request.method() });
        assert.equal(request.method(), 'GET', 'Browser fixture must never write');
        if (url.origin !== origin) return route.abort();
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Annotation placement regression</title><main id="screen"><h1>Annotation placement</h1><div id="preview"></div></main><div id="print-area" class="print-out print-doc"></div>' });
        const file = path.resolve(root, url.pathname.slice(1));
        assert.ok(file.startsWith(root + path.sep));
        assert.ok(publicAssets.some(asset => path.resolve(root, asset.asset) === file), 'Only discovered parser assets may be requested');
        const asset = fs.readFileSync(file, 'utf8');
        assert.equal(asset, source, 'The browser must receive the same parser tested in Node');
        return route.fulfill({ contentType: 'application/javascript', body: asset });
      });
      try {
        const page = await context.newPage();
        await page.goto(origin, { waitUntil: 'load' });
        for (const asset of cssAssets) await page.addStyleTag({ content: read(asset) });
        await page.addStyleTag({ content: '#screen { margin:20px; max-width:960px; } #preview { width:100%; } @media screen { #print-area { display:none; } } @media print { #screen { display:none!important; } #print-area { display:block!important; } }' });
        for (const asset of publicAssets) await page.addScriptTag({ url: origin + '/' + asset.asset });
        await page.evaluate(() => {
          window.UI = {
            el: id => document.getElementById(id), $: (selector, root = document) => root.querySelector(selector),
            $all: (selector, root = document) => Array.from(root.querySelectorAll(selector)),
            escapeHtml: value => Markup.escape(value),
            create: (tag, attrs = {}) => { const node = document.createElement(tag); for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value); return node; },
          };
          window.Store = { getFavCollapsed: () => ({}), isPrintSection: () => true, getPrintFontSize: () => 'md', getPrintLineHeight: () => '3', builtinStopList: () => ({ words: [] }), getDifficultyVocabWeight: () => 0.5 };
          window.__annotationInjected = 0;
        });
        await page.addScriptTag({ content: read('assets/js/corpus.js') });
        await page.addScriptTag({ content: read('assets/js/difficulty.js') });
        await page.addScriptTag({ content: viewer.replace(viewerInit, viewerHook) });
        await page.evaluate(({ fixture, sectionFixture, unsafeTags, literalFixtures }) => {
          const sections = Markup.parseSections(sectionFixture);
          const preview = document.getElementById('preview');
          const printed = document.getElementById('print-area');
          preview.innerHTML = '<section id="table-preview" class="exam-doc">' + Markup.render(fixture, { paraNum: true }).html + '</section>' +
            sections.map(section => __annotationTest.renderField(section.type, '', section.text)).join('');
          printed.innerHTML = '<section id="table-print" class="exam-doc">' + Markup.render(fixture, { paraNum: true }).html + '</section>' +
            sections.map(section => __annotationTest.printField(section.type, section.text, { optimizeFootnotes: true })).join('');
          const safety = document.createElement('section'); safety.id = 'safety'; safety.hidden = true;
          safety.innerHTML = Markup.render(unsafeTags.join('\n') + '\n:::注釈\n**' + unsafeTags.join('\n') + '\n:::\n' + literalFixtures.join('\n')).html;
          document.body.appendChild(safety);
          window.__annotationFixture = { fixture, sectionFixture };
        }, { fixture, sectionFixture, unsafeTags, literalFixtures });
        assert.equal(await page.locator('#safety script, #safety img, #safety svg, #safety iframe, #safety a, #safety br').count(), 0, 'Unsafe tags and code br must stay text');
        assert.equal(await page.evaluate(() => window.__annotationInjected), 0);

        for (const media of ['screen', 'print']) {
          await page.emulateMedia({ media });
          const id = media === 'screen' ? '#table-preview' : '#table-print';
          const tableDoc = page.locator(id);
          assert.equal(await tableDoc.locator('tbody tr').count(), 1);
          assert.equal(await tableDoc.locator('td').count(), 2);
          assert.equal(await tableDoc.locator('td br').count(), 1);
          assert.equal(await tableDoc.locator('.footnote-section ol li').count(), 3);
          assert.equal(await tableDoc.locator('.footnote-section.free-note').count(), 1);
          assert.equal(await tableDoc.locator('table .footnote-section').count(), 0);
          assert.match(await tableDoc.locator('.free-note').innerText(), /\*\*TABLE NOTE/);
          const report = await tableDoc.evaluate((doc, media) => {
            const notes = [...doc.querySelectorAll('.footnote-section')];
            const prose = [...doc.querySelectorAll('.blk')].find(node => node.textContent.includes('AFTER TABLE NOTE'));
            const rect = node => ({ top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom });
            const counted = __annotationTest.countableTextNodes(doc);
            return { media, table: rect(doc.querySelector('table')), notes: notes.map(rect), prose: rect(prose),
              sequence: notes.map(node => node.classList.contains('free-note') ? 'free' : [...node.querySelectorAll('li .footnote-number')].map(node => node.textContent).join(',')),
              counted: counted.map(node => node.nodeValue).join(' '), countedNoteNodes: counted.filter(node => node.parentElement.closest('.footnote-section')).length };
          }, media);
          assert.deepEqual(report.sequence, ['*1,*2', 'free', '*3']);
          assert.ok(report.notes[0].top >= report.table.bottom - 1, JSON.stringify(report));
          assert.ok(report.notes[1].top >= report.notes[0].bottom - 1, JSON.stringify(report));
          assert.ok(report.prose.top >= report.notes[1].bottom - 1, JSON.stringify(report));
          assert.ok(report.notes[2].top >= report.prose.bottom - 1, JSON.stringify(report));
          assert.equal(report.countedNoteNodes, 0);
          assert.doesNotMatch(report.counted, /\*\*TABLE NOTE|本文の語注|毛細血管|最後の語注/);
          assert.match(report.counted, /AFTER TABLE NOTE/);
          reports.push({ width, ...report });

          const container = media === 'screen' ? '#preview' : '#print-area';
          const sections = page.locator(container + ' .exam-field, ' + container + ' .print-field');
          assert.equal(await sections.count(), 3, 'Viewer and print must retain the three original sections');
          for (let i = 0; i < 3; i++) {
            const section = sections.nth(i);
            assert.equal(await section.locator('.free-note').count(), 1);
            assert.deepEqual(await section.locator('li .footnote-number').allTextContents(), ['*1']);
          }
          await page.screenshot({ path: path.join(evidence, `${width}-${media}.png`), fullPage: true });
        }

        await page.pdf({ path: path.join(evidence, `${width}.pdf`), format: 'A4', printBackground: true });
        // Exercise actual text-node selection and insertion, not just the CSS selector.
        const lineReport = await page.evaluate(() => {
          const doc = document.getElementById('table-print');
          const before = doc.textContent;
          const measured = __annotationTest.lineStartPositions(doc);
          const anchors = __annotationTest.insertLineNumbers(doc, measured);
          __annotationTest.positionLineNumbers(doc, anchors);
          const result = { lines: measured.starts.length, anchors: anchors.length,
            noteAnchors: doc.querySelectorAll('.footnote-section .print-linenum').length,
            numbers: anchors.map(node => Number(node.textContent)) };
          anchors.forEach(node => node.remove());
          result.restored = doc.textContent === before;
          return result;
        });
        assert.equal(lineReport.noteAnchors, 0);
        assert.equal(lineReport.anchors, Math.floor(lineReport.lines / 5));
        assert.deepEqual(lineReport.numbers, Array.from({ length: lineReport.anchors }, (_, index) => (index + 1) * 5));
        assert.equal(lineReport.restored, true);
        assert.equal(await page.evaluate(() => JSON.stringify(__annotationFixture)), JSON.stringify({ fixture, sectionFixture }));
        assert.equal(JSON.stringify({ fixture, sectionFixture, unsafeTags, literalFixtures }), snapshot);
        assert.deepEqual(errors, []);
        assert.ok(requests.every(request => request.method === 'GET'));
        await page.screenshot({ path: path.join(evidence, `${width}-line-number-check.png`), fullPage: true });
        console.log(`PASS: ${width}px screen + print placement, literal notes, table/line breaks, section scope, real viewer line-number exclusion, injection safety, A4 PDF`);
      } finally { await context.close(); }
    }
    fs.writeFileSync(path.join(evidence, 'geometry.json'), JSON.stringify({ publicAssets, reports }, null, 2));
  } finally { await browser.close(); }
}
