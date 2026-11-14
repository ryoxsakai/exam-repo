// Synthetic fixtures only: no production writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { buildSync } = require('../panel/node_modules/esbuild');
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exam-sections-'));
  try {
    const out = path.join(tmp, 'mcp.mjs');
    buildSync({ stdin: { contents: fs.readFileSync('worker/mcp.ts', 'utf8') +
      '\nexport {extractMarkedSection, replaceMarkedSection, assertAuditTargetConsistent};',
      resolveDir: path.resolve('worker'), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: out });
    const { extractMarkedSection, replaceMarkedSection, assertAuditTargetConsistent } = await import(pathToFileURL(out));
    const sandbox = {window:{}};
    vm.runInNewContext(fs.readFileSync('assets/js/markup.js','utf8'), sandbox);
    for (const newline of ['\n', '\r\n']) {
      for (const badge of ['{{問1}}', '{{問12}}', '{{1}}', '{{A}}', '{{{(1)}}}']) {
        const translation = [badge, '訳一', '{{問2}}', '訳二',
          ':::注釈', '{{解説}}', '注の中', ':::'].join(newline);
        const original = ['{{本文}}', 'Original.', '{{全訳}}', translation, '{{解説}}', 'Keep commentary.'].join(newline);
        assert.equal(extractMarkedSection(original, '全訳'), translation);
        const rendered = sandbox.window.Markup.parseSections(original).find(s => s.type === '全訳');
        assert.equal(rendered.text, translation);
        const replaced = replaceMarkedSection(original, '全訳', '新訳');
        assert.equal(extractMarkedSection(replaced, '全訳'), '新訳');
        assert.ok(replaced.startsWith('{{本文}}' + newline + 'Original.'));
        assert.ok(replaced.endsWith('{{解説}}' + newline + 'Keep commentary.'));
        assert.ok(!replaced.includes('訳二'));
        assert.equal(original.includes('訳二'), true);
        assertAuditTargetConsistent({target_field:'translation_text', original_storage_text:original, original_target_text:translation});
        assert.throws(() => assertAuditTargetConsistent({target_field:'translation_text', original_storage_text:original, original_target_text:''}), /run audit_question_for_correction again/);
      }
    }
    assert.equal(extractMarkedSection('{{全訳}}\n{{問1}}\n末尾', '全訳'), '{{問1}}\n末尾');
    assert.equal(extractMarkedSection('本文のみ', '全訳'), '');
    assertAuditTargetConsistent({target_field:'problem_text', original_storage_text:'本文', original_target_text:'本文'});
    const source = fs.readFileSync('worker/mcp.ts','utf8');
    for (const action of ['prepare_question_correction', 'apply_audited_correction', 'add_question_image']) {
      const start = source.indexOf('if (name === "' + action + '")');
      const end = source.indexOf('\n  if (name === ', start + 1);
      assert.match(source.slice(start, end < 0 ? undefined : end), /assertAuditTargetConsistent\(audit\)/, action);
    }
    console.log('MCP section extraction, replacement, display parity and stale-audit guards passed');
  } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
})().catch(error => {console.error(error); process.exitCode=1;});
