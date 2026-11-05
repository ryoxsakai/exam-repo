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
    buildSync({entryPoints:['worker/mcp.ts'], bundle:true, platform:'node', format:'esm', outfile:out});
    const { handleMcpRoute } = await import(pathToFileURL(out));
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
    console.log('Question validation: 25 MCP regressions passed; reads only, registered data unchanged');
  } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
