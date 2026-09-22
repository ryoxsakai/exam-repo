// Run with Node.js 24+: node scripts/test-readability.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const browser = { console, document: { addEventListener() {} },
  localStorage: { getItem: () => null, setItem() {} },
  UI: { el: () => null, escapeHtml: value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;") } };
browser.window = browser;
vm.createContext(browser);
for (const file of ["assets/data/oxford5000.js", "assets/js/store.js", "assets/js/markup.js",
  "assets/js/corpus.js", "assets/js/difficulty.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), browser);
}

(async () => {
  const worker = await import(pathToFileURL(path.join(root, "worker/mcp.ts")));
  const passages = [
    "{{本文}}\n[1] Dr. A. Smith examined ##allergy::アレルギー## in 2025.  The findings were clear.\n\n[2] A second paragraph followed.  !!!!Source: sample!!!!",
    "The {{本文}} is here.  ![diagram](/api/image/test){size=small caption=\"A long caption\"}  ==Doctors==:blue compared **symptoms** and __treatment__.  [[1]]",
    "“Short answer.”  However, M.D. and e.g. are abbreviations.  Is the next sentence difficult?"
  ];
  for (const raw of passages) {
    const local = browser.Difficulty.passageMetrics(raw);
    const remote = worker.analyzePassageText(raw);
    assert.equal(remote.word_count, local.words);
    assert.equal(remote.sentence_count, local.sentences);
    assert.equal(remote.average_sentence_length, Math.round(local.asl * 10) / 10);
    assert.equal(remote.flesch_kincaid_grade, local.fk);
  }
  const example = browser.Difficulty.passageMetrics(passages[0]);
  assert.equal(example.sentences, 3);
  assert.equal(browser.Difficulty.passageMetrics("").fk, null);
  const viewer = fs.readFileSync(path.join(root, "assets/js/viewer.js"), "utf8")
    .replace('document.addEventListener("DOMContentLoaded", init);',
      "window.testPassages = { examSections, renderField };");
  vm.runInContext(viewer, browser);
  const raw = "{{リード文}}\nRead the article and answer the questions.\n\n{{本文}}\nThe article is short.  It ends here.";
  const section = browser.testPassages.examSections(raw).find(sec => sec.type === "本文");
  assert.match(section.text, /Read the article/);
  assert.doesNotMatch(section.metricText, /Read the article/);
  const rendered = browser.testPassages.renderField("本文", "fa-file-lines", section.text, section.metricText);
  assert.match(rendered, /\(7 words\)/);
  assert.match(rendered, /FK /);
  console.log("PASS: browser and MCP passage metrics agree");
})().catch(error => { console.error(error); process.exitCode = 1; });
