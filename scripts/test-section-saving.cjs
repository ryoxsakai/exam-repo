// Run with Node.js 24+: node scripts/test-section-saving.cjs
// DOM and API boundaries are mocked; no live exam data is read or written.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const initMarker = '  document.addEventListener("DOMContentLoaded", function () {';
const settingsSource = read('assets/js/settings.js');
assert.ok(settingsSource.includes(initMarker), 'Settings test hook must match initialization');
const nodes = new Map(), errorToasts = [];
const el = id => {
  if (!nodes.has(id)) nodes.set(id, { value: '', innerHTML: '', textContent: '',
    classList: { add() {}, remove() {} }, appendChild() {} });
  return nodes.get(id);
};
const browser = { console, document: { addEventListener() {} },
  localStorage: { getItem: () => null, setItem() {} },
  UI: { el, $: () => null, $all: () => [], setActiveTab() {}, toast(message, kind) { if (kind === 'err') errorToasts.push(message); }, create: () => ({ innerHTML: '' }), openModal() {},
    escapeHtml: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;') } };
browser.window = browser;
vm.createContext(browser);
for (const file of ['store', 'markup', 'corpus', 'difficulty']) {
  vm.runInContext(read(`assets/js/${file}.js`), browser);
}
vm.runInContext(settingsSource.replace(initMarker,
  '  window.sectionSavingTest = { collectReg, ingSectionsToQuestion, previewReg, examSections, renderReg, saveReg, loadExamIntoForm, registerIngest, state };\n' + initMarker), browser);
const api = browser.sectionSavingTest;
const sections = text => plain(browser.Markup.parseSections(text));
for (const [id, value] of Object.entries({ 'reg-year': '2023', 'reg-university': 'テスト大学',
  'reg-schedule': '一般', 'reg-qnum': '3', 'reg-label': ' III ', 'reg-category': '長文' })) el(id).value = value;
const sec = (type, text) => ({ type, text });
const lead = 'Read the article and answer the questions.';
const body = '[1] The article is short. It ends here.';
const fixtures = [
  [sec('リード文', lead), sec('本文', body), sec('設問', '{{問1}} Choose [[1]].')],
  [sec('リード文', '次の問いに答えよ。'), sec('問題', '{{問1}} Which is correct?')],
  [sec('問題', 'Part one.'), sec('問題', 'Part two.'), sec('解答', 'A'), sec('問題', 'Part three.')],
  [sec('リード文', 'Read passage A.'), sec('本文', 'Alpha.'), sec('設問', '{{問1}} A?'),
    sec('リード文', 'Read passage B.'), sec('本文', 'Beta.'), sec('問題', '{{問2}} B?')],
  [sec('リード文', 'First instruction.\nSecond line.'), sec('リード文', 'Another instruction.'), sec('本文', body)],
  [sec('本文', body), sec('リード文', 'Trailing instruction.')],
  [sec('リード文', 'Only an instruction.')],
  [sec('リード文', 'For answers:'), sec('解答', 'A'), sec('リード文', 'For commentary:'), sec('解説', 'Explanation.')],
  [sec('解答', 'A'), sec('解説', 'First.'), sec('解答', 'B'), sec('解説', 'Second.'), sec('全訳', '《題》\n全訳。')],
  [sec('問題', 'Legacy text without section headers.\n{{問1}} A?')],
  [sec('本文', '@@**Old merged instruction.**\n\n' + body), sec('設問', '{{問1}} Choose.')],
  [sec('本文', body), sec('注意事項', 'Custom Japanese section.'), sec('問題', 'Next question.')]
];
let rounds = 0;
for (const [fixtureIndex, original] of fixtures.entries()) {
  let current = plain(original), previous = null;
  for (let round = 0; round < 4; round++) {
    const before = JSON.stringify(current);
    api.state.reg.sections = current;
    const regular = plain(api.collectReg().questions[0]);
    const imported = plain(api.ingSectionsToQuestion({ questionNumber: 3, category: ' 長文 ', sections: current }));
    assert.deepEqual(sections(regular.problemText), original, `Fixture ${fixtureIndex}, save ${round}: section boundaries`);
    for (const key of ['problemText', 'answerText', 'commentaryText']) assert.equal(regular[key], imported[key]);
    assert.equal(regular.answerText, original.filter(s => s.type === '解答').map(s => s.text).join('\n\n'));
    assert.equal(regular.commentaryText, original.filter(s => s.type === '解説').map(s => s.text).join('\n\n'));
    assert.equal(regular.label, 'III');
    assert.equal(regular.questionNumber, 3);
    assert.equal(imported.category, '長文');
    assert.equal(JSON.stringify(current), before, 'Saving must not mutate editor state');
    if (previous !== null) assert.equal(regular.problemText, previous, 'Repeated save must be stable');
    previous = regular.problemText;
    current = sections(previous);
    rounds++;
  }
}
assert.equal(api.ingSectionsToQuestion({ sections: [] }).problemText, '');
const withEmptyLead = api.ingSectionsToQuestion({ sections: [sec('リード文', ''), sec('本文', body), sec('リード文', '')] });
assert.deepEqual(sections(withEmptyLead.problemText), [sec('本文', body)], 'Blank placeholders must not add content');
api.state.reg.sections = plain(fixtures[0]);
const beforePreview = JSON.stringify(api.state.reg.sections);
api.previewReg();
assert.equal(JSON.stringify(api.state.reg.sections), beforePreview);
assert.match(el('preview-body').innerHTML, /<strong>Read the article and answer the questions\.<\/strong>/);
assert.doesNotMatch(el('preview-body').innerHTML, /exam-section-title">リード文/);
assert.match(el('preview-body').innerHTML, /\(7 words\)/, 'Preview metrics must exclude the lead');
assert.equal(sections(api.collectReg().questions[0].problemText)[0].type, 'リード文', 'Preview must not affect the next save');
let boxes = [];
browser.UI.create = () => ({ innerHTML: '' });
el('reg-sections').appendChild = box => boxes.push(box.innerHTML);
api.state.config.section_types = ['問題', '本文'];
api.renderReg();
assert.match(boxes[0], /<option value="リード文" selected>リード文<\/option>/);
assert.deepEqual(plain(api.state.config.section_types), ['問題', '本文'], 'Loaded types must not mutate saved configuration');

vm.runInContext(read('assets/js/viewer.js').replace('document.addEventListener("DOMContentLoaded", init);',
  'window.viewerTest = { examSections, buildPrintHtml };'), browser);
const stored = api.ingSectionsToQuestion({ sections: plain(fixtures[0]) }).problemText;
const display = plain(browser.viewerTest.examSections(stored));
assert.equal(display[0].type, '本文');
assert.equal(display[0].text, '@@**' + lead + '**\n\n' + body);
assert.equal(display[0].metricText, body);
const legacyDisplay = plain(browser.viewerTest.examSections('{{本文}}\n' + display[0].text + '\n{{設問}}\n{{問1}} Choose [[1]].'));
assert.deepEqual(display.map(s => [s.type, s.text]), legacyDisplay.map(s => [s.type, s.text]), 'Legacy and separate leads retain the same display text');
const print = browser.viewerTest.buildPrintHtml({ questions: [{ question_number: 3, problem_text: stored }] }, {}, false);
assert.match(print, /<strong>Read the article and answer the questions\.<\/strong>/);
assert.doesNotMatch(print, /exam-section-title">リード文/);
console.log(`PASS: ${fixtures.length} fixtures × 4 save/load cycles (${rounds}); both serializers, legacy formats, previews, print, metrics, and type dropdown`);

// Exercise actual save/load entrypoints with an in-memory API and minimal DOM.
async function editorApiTest() {
  const writes = [];
  let question = { question_number: 3, category: '長文', problem_text: stored,
    answer_text: 'A', commentary_text: 'Legacy commentary.' };
  function persist(payload) {
    writes.push(plain(payload));
    const q = payload.questions[0];
    question = { question_number: q.questionNumber, category: q.category, label: q.label,
      problem_text: q.problemText, answer_text: q.answerText, commentary_text: q.commentaryText };
    return Promise.resolve({ exam: { id: 42 } });
  }
  browser.Api = {
    getExam: () => Promise.resolve({ exam: { id: 42, university_name: 'テスト大学', year: 2023,
      schedule: '一般', questions: [plain(question)] } }),
    updateExam: (id, payload) => { assert.equal(id, 42); return persist(payload); },
    createExam: persist,
    getConfig: () => Promise.resolve({ schedules: ['一般'], year_presets: ['2023'], question_categories: ['長文'],
      section_types: ['問題', '本文', '設問', '解答', '解説', '全訳'] }),
    getUniversities: () => Promise.resolve({ universities: [{ id: 1, name: 'テスト大学' }] })
  };
  const flush = () => new Promise(resolve => setImmediate(resolve));
  for (let i = 0; i < 3; i++) {
    api.loadExamIntoForm(42, 3, true);
    await flush();
    assert.equal(api.state.reg.sections[0].type, 'リード文');
    assert.deepEqual(plain(api.state.reg.sections.slice(-2)), [sec('解答', 'A'), sec('解説', 'Legacy commentary.')],
      'Legacy answer columns should be loaded once, with no duplication after resaving');
    api.state.reg.sections[0].text = lead + ' Revision ' + (i + 1) + '.';
    api.previewReg();
    api.saveReg();
    await flush();
    assert.equal(writes.length, i + 1);
    assert.deepEqual(sections(question.problem_text), plain(api.state.reg.sections));
  }
  question = { question_number: 3, category: '長文',
    problem_text: '{{本文}}\n@@**Old merged instruction.**\n\n' + body,
    answer_text: 'A', commentary_text: 'Legacy commentary.' };
  api.loadExamIntoForm(42, 3, true);
  await flush();
  api.saveReg();
  await flush();
  assert.equal(sections(question.problem_text)[0].text, '@@**Old merged instruction.**\n\n' + body);
  assert.equal(question.answer_text, 'A');
  assert.equal(question.commentary_text, 'Legacy commentary.');
  api.state.reg.editingExamId = null;
  api.state.reg.sections = plain(fixtures[1]);
  api.saveReg();
  await flush();
  assert.deepEqual(sections(question.problem_text), fixtures[1]);
  assert.equal(api.state.reg.editingExamId, 42, 'New registration should transition to editing');
  api.state.ing = { universityName: 'テスト大学', year: 2023, schedule: '一般',
    questions: [{ questionNumber: 3, category: '長文', sections: plain(fixtures[3]) }] };
  api.registerIngest();
  await flush();
  assert.deepEqual(sections(question.problem_text), fixtures[3]);
  assert.equal(writes.length, 6);
  assert.deepEqual(errorToasts, [], 'Save/load paths must not swallow errors into UI toasts');
  console.log('PASS: actual edit/save/reload × 3, legacy-column fallback, new registration, and import registration entrypoints with mocked DOM/API');
}
editorApiTest().catch(error => { console.error(error); process.exitCode = 1; });
