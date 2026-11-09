const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'assets/js/markup.js'),'utf8');
for(const name of ['index.html','setting/index.html']) {
 const html=fs.readFileSync(path.join(root,name),'utf8'); const src=html.match(/src="([^"?]*\/markup[^"?]*\.js)/)[1];
 assert.equal(fs.readFileSync(path.resolve(root,path.dirname(name),src),'utf8'),source);
}
const c={window:{}};vm.runInNewContext(source,c);const M=c.window.Markup;
let r=M.render('He studied ##capillaries|capillary::毛細血管## and ##M^isdiagnosis::誤診##.');
assert.match(r.html,/capillaries<sup class="footnote-number">\*1/);
assert.equal(r.footnotes[0].word,'capillary');assert.equal(r.footnotes[0].translation,'毛細血管');
assert.equal(r.footnotes[1].word,'misdiagnosis');assert.match(r.html,/Misdiagnosis<sup/);
assert.equal(M.strip('He studied ##capillaries|capillary::毛細血管##.'),'He studied capillaries.');
r=M.render('| Term | Meaning |\n| --- | --- |\n| ##capillaries|capillary::毛細血管## | vessels |');
assert.match(r.html,/<td>.*capillaries<sup/);assert.match(r.html,/<td>vessels<\/td>/);assert.equal(r.footnotes[0].word,'capillary');
r=M.render('::##capillaries|capillary::毛細血管##::');assert.match(r.html,/<mark/);assert.equal(r.footnotes[0].word,'capillary');
console.log('PASS: lemma in prose, highlights and tables; legacy case markers; passage extraction');
(async()=>{const bundle=await require('../panel/node_modules/esbuild').build({entryPoints:[path.join(root,'worker/mcp.ts')],bundle:true,write:false,platform:'node',format:'esm'}); const {cleanPassageText,analyzePassageText}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64')); const text='The ##capillaries|capillary::毛細血管## carry blood.'; assert.equal(cleanPassageText(text),'The capillaries carry blood.');assert.equal(analyzePassageText(text).word_count,4);console.log('PASS: MCP passage extraction and word count');})().catch(e=>{console.error(e);process.exitCode=1});
