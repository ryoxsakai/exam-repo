const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHmac } = require('node:crypto');
const { buildSync } = require('../panel/node_modules/esbuild');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exam-validation-'));
  try {
    const out = path.join(tmp, 'mcp.mjs');
    buildSync({stdin:{contents:fs.readFileSync('worker/mcp.ts','utf8') + '\nexport { normalizeChoiceMarkers, detectCorrectionAuditIssues, analyzeQuestionFormatRecord };', resolveDir:path.resolve('worker'), loader:'ts'}, bundle:true, platform:'node', format:'esm', outfile:out});
    const { handleMcpRoute, normalizeChoiceMarkers, detectCorrectionAuditIssues, analyzeQuestionFormatRecord, cleanPassageText } = await import(pathToFileURL(out));
    let row;
    const env = { EXAM_SESSION_SECRET:'synthetic-validation-only', DB:{
      prepare(sql) {
        assert.match(sql, /^SELECT /, 'validation must only read');
        return {bind(){return this;}, async all(){return {results:[row]};},
          run(){assert.fail('validation must not write');}};
      },
      batch(){assert.fail('validation must not batch writes');},
      exec(){assert.fail('validation must not run DDL');}
    }};
    const payload = Buffer.from(JSON.stringify({aud:'medical-exam-mcp', client_id:'validation-test', scope:'exams:read', exp:Date.now()+60000})).toString('base64url');
    const token = payload+'.'+createHmac('sha256',env.EXAM_SESSION_SECRET).update(payload).digest('base64url');
    async function check(name, problem, answer, expected=[]) {
      row = {exam_id:327, question_number:2, category:'文法', problem_text:problem, answer_text:answer, commentary_text:'synthetic'};
      const before = JSON.stringify(row);
      const response = await handleMcpRoute(new Request('https://test/mcp', {
        method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`},
        body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'validate_questions',arguments:{}}})
      }), env);
      assert.equal(response.status,200,name);
      const body = await response.json();
      assert.ok(!body.error && !body.result.isError, JSON.stringify(body));
      const result = body.result.structuredContent || JSON.parse(body.result.content[0].text);
      assert.equal(result.summary.scanned_count,1);
      assert.deepEqual(result.results.flatMap(r=>r.issues.map(i=>i.code)),expected,name);
      assert.equal(JSON.stringify(row),before,'registered data unchanged');
    }
    const choices = ['alpha','bravo','charlie','delta','echo'].map((s,i)=>`((${i+1})) ${s}`);
    await check('vertical',choices.join('\n'),'((5))');
    await check('horizontal',choices.join('  '),'((4))');
    await check('mixed',choices.slice(0,2).join('  ')+'\n'+choices.slice(2).join('\n'),'((5))');
    await check('fullwidth whitespace','　'+choices.join('　'),'((5))');
    const reproduction = '{{リード文}}\n適切な選択肢を選びなさい。\n{{設問}}\n{{1}} 選択肢から選びなさい。\n[[ア]] '+choices.join('  ')+'\n[[イ]] '+choices.join('  ')+'\n{{3}} 下線部と同じ意味を選びなさい。\n'+choices.join('  ');
    await check('reported multiple-question reproduction',reproduction,'{{1}}[[ア]]((1))　[[イ]]((4))\n{{3}}((4))');
    await check('blank-prefixed only','　[[ア]]　'+choices.join('　'),'((5))');
    for (const separator of ['〜','～',' - ']) {
      await check('prose ranges '+separator,'{{本文}}\n本文中の((1))'+separator+'((5))から選ぶ。\n((1))'+separator+'((5))から選ぶ\n{{設問}}\n{{1}} ((1))'+separator+'((5))から選ぶ\n'+choices.join('\n'),'((5))');
    }
    await check('range cannot inflate maximum','本文中の((1))〜((9))から選ぶ\n'+choices.join('  '),'((6))',['answer_out_of_range']);
    await check('horizontal out of range',choices.join('  '),'((6))',['answer_out_of_range']);
    await check('vertical out of range',choices.join('\n'),'((6))',['answer_out_of_range']);
    await check('blank-prefixed out of range','[[ア]] '+choices.join('  '),'((6))',['answer_out_of_range']);
    await check('missing choice',[choices[0],...choices.slice(2)].join('  '),'((5))',['non_contiguous_choices']);
    await check('misordered choice',[choices[0],choices[2],choices[1]].join('\n'),'((3))',['non_contiguous_choices']);
    await check('stored answer section excluded',choices.join('  ')+'\n{{解答}}\n((9))','((6))',['answer_out_of_range']);
    for (const decoration of ['__underlined text__', '==double underline==', '~~wavy underline~~']) {
      await check('inline underline excluded '+decoration, '((1)) Refer to ((4))'+decoration+'.\n((2)) bravo\n((3)) charlie', '((3))');
      await check('underline cannot inflate maximum '+decoration, '((1)) Refer to  ((9)) '+decoration+'.  ((2)) bravo  ((3)) charlie', '((4))', ['answer_out_of_range']);
    }
    await check('inline prose reference', '((1)) Refer to ((4)) in the passage.\n((2)) bravo\n((3)) charlie', '((4))', ['answer_out_of_range']);
    await check('inline range in a choice', '((1)) Choose from  ((1))〜((9)) here.  ((2)) bravo  ((3)) charlie', '((4))', ['answer_out_of_range']);
    await check('tab separated', choices.join('\t'), '((5))');
    const fullwidthChoices = ['（（１）） alpha', '(（２)) bravo', '（(3)） charlie'];
    for (const separator of ['\n', '  ', '　', '\t']) {
      await check('fullwidth and mixed choices '+JSON.stringify(separator), fullwidthChoices.join(separator), '（（３））');
      await check('fullwidth answer range '+JSON.stringify(separator), fullwidthChoices.join(separator), '(（４）)', ['answer_out_of_range']);
    }
    await check('fullwidth missing choice', [fullwidthChoices[0],fullwidthChoices[2]].join('　'), '（（３））', ['non_contiguous_choices']);
    await check('fullwidth range excluded', '（（１））〜(（９）)から選ぶ\n'+fullwidthChoices.join('　'), '（（４））', ['answer_out_of_range']);
    await check('fullwidth inline underline excluded', '（（１）） Refer to  （（９）） __words__.　'+fullwidthChoices.slice(1).join('　'), '（（４））', ['answer_out_of_range']);
    await check('fullwidth blank prefix', '[[ア]] '+fullwidthChoices.join('　'), '（（３））');
    await check('fullwidth answer section excluded', fullwidthChoices.join('　')+'\n{{解答}}\n（（９））', '（（４））', ['answer_out_of_range']);
    await check('single parentheses are not choices', '（１） ordinary prose\n(2) ordinary prose', '（（９））');
    await check('fullwidth unbalanced open', '（（１） missing delimiter', '（（１））', ['unbalanced_choice']);
    await check('mixed unbalanced close', '１)） missing opener', '（（１））', ['unbalanced_choice']);
    const format = analyzeQuestionFormatRecord({problem_text:fullwidthChoices.join('\n')});
    assert.equal(format.marker_counts.choice, 3);
    assert.ok(format.formats.includes('multiple_choice'));
    assert.equal(cleanPassageText(fullwidthChoices.join('\n')), cleanPassageText(normalizeChoiceMarkers(fullwidthChoices.join('\n'))));
    const prose = '（普通の文章） (１) ＡＢ１２ {{問３}} [[４]]';
    assert.equal(normalizeChoiceMarkers(prose), prose, 'normalization is limited to explicit choice tokens');
    assert.equal(normalizeChoiceMarkers('（（１）） and (（２))'), '((1)) and ((2))');
    for (const text of [...fullwidthChoices, '（（（１）））', prose]) {
      assert.deepEqual(detectCorrectionAuditIssues(text, 'problem_text'), [], 'audit accepts '+text);
    }
    for (const text of ['（（１） missing closer', '１)） missing opener']) {
      assert.deepEqual(detectCorrectionAuditIssues(text, 'problem_text').map(issue => issue.code), ['unbalanced_choice']);
    }
    console.log('Question validation: ASCII/fullwidth/mixed choices, ranges, audits, missing delimiters, prose and answer mapping passed; reads only, registered data unchanged');
  } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
