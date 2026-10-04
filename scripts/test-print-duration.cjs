const assert = require('node:assert/strict');
const {DatabaseSync} = require('node:sqlite');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {buildSync} = require('../panel/node_modules/esbuild');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exam-duration-'));
const out = path.join(tmp, 'duration.cjs');
buildSync({entryPoints: [path.join(root, 'worker/print-duration.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: out});
const {handlePrintDuration} = require(out);
let sql = new DatabaseSync(path.join(tmp, 'test.sqlite'));
sql.exec('PRAGMA foreign_keys=ON; CREATE TABLE universities(id INTEGER PRIMARY KEY); CREATE TABLE exams(id INTEGER PRIMARY KEY, university_id INTEGER REFERENCES universities(id), year INTEGER, schedule TEXT); INSERT INTO universities VALUES (1),(2); INSERT INTO exams VALUES (11,1,2026,\'前期\'),(12,1,2025,\'前期\'),(13,1,2026,\'後期\'),(21,2,2026,\'前期\');');
function dbAdapter() {
  return {prepare(text) { let values=[]; return {bind(...v) {values=v; return this;}, async first() {return sql.prepare(text).get(...values) || null;}, async run() {return sql.prepare(text).run(...values);}}; },
    async batch(stmts) {sql.exec('BEGIN'); try {const r=[]; for (const s of stmts) r.push(await s.run()); sql.exec('COMMIT'); return r;} catch(e) {sql.exec('ROLLBACK'); throw e;}}};
}
const call = (id, body, method = body === undefined ? 'GET' : 'PUT') => handlePrintDuration(new Request('https://test/api/exams/'+id+'/print-duration', {method, ...(body === undefined ? {} : {body: JSON.stringify(body)})}), dbAdapter(), id);
const get = async id => {const r=await call(id); assert.equal(r.status,200); return r.body;};
(async () => {
  try {
    assert.equal((await get(11)).source, 'unset');
    assert.equal((await get(11)).effective_minutes, null);
    assert.equal((await call(11,{university_minutes:60})).status,200);
    sql.close(); sql=new DatabaseSync(path.join(tmp,'test.sqlite')); sql.exec('PRAGMA foreign_keys=ON');
    assert.equal((await get(11)).effective_minutes,60, 'Actual SQLite persists after reopening');
    assert.equal((await get(12)).effective_minutes,60);
    assert.equal((await get(13)).source,'university');
    assert.equal((await get(21)).effective_minutes,null,'Other university is isolated');
    await call(11,{exam_minutes:75});
    assert.equal((await get(11)).source,'exam'); assert.equal((await get(11)).effective_minutes,75);
    assert.equal((await get(12)).effective_minutes,60); assert.equal((await get(13)).effective_minutes,60);
    await call(11,{university_minutes:90}); assert.equal((await get(11)).effective_minutes,75);
    await call(11,{exam_minutes:null}); assert.equal((await get(11)).effective_minutes,90); assert.equal((await get(11)).source,'university');
    await call(11,{university_minutes:null}); assert.equal((await get(11)).source,'unset');
    for (const bad of [0,-1,1.5,1441,'60',true,{},[]]) assert.equal((await call(11,{exam_minutes:bad})).status,400);
    for (const bad of [{},{unexpected:60},[],null,{exam_minutes:60,university_minutes:0}]) assert.equal((await call(11,bad)).status,400);
    assert.equal((await get(11)).source,'unset','Invalid multi-field write is atomic');
    assert.equal((await call(999,{exam_minutes:60})).status,404);
    assert.equal((await call(11,undefined,'POST')).status,405);
    await call(11,{exam_minutes:1,university_minutes:1440});
    sql.exec('DELETE FROM exams WHERE id=11'); assert.equal(sql.prepare('SELECT count(*) n FROM exam_print_durations').get().n,0);
    assert.equal((await get(12)).effective_minutes,1440);
    console.log('PASS: real SQLite save/reopen, defaults, overrides, reset, null, university/year/schedule isolation, validation, FK cleanup');
    const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
    const source=fs.readFileSync(path.join(root,'assets/js/viewer.js'),'utf8');
    const nodes={'pr-cover':{checked:true},'pr-duration':{checked:true}};
    const saved={}; const ctx={console,document:{addEventListener(){}},localStorage:{getItem:k=>saved[k]??null,setItem:(k,v)=>saved[k]=v}, UI:{el:id=>nodes[id]||null,escapeHtml:s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}}; ctx.window=ctx; vm.createContext(ctx);
    const markup=index.match(/src="(assets\/js\/markup[^"?]*\.js)/)[1];
    for(const file of ['assets/js/store.js',markup,'assets/js/difficulty.js']) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx);
    vm.runInContext(source.replace('document.addEventListener("DOMContentLoaded", init);','window.__test={state,buildPrintHtml,printOptions};'),ctx);
    assert.equal(ctx.Store.getPrintDuration(),true); ctx.Store.setPrintDuration(false); assert.equal(ctx.Store.getPrintDuration(),false); assert.equal(saved.exam_print_duration,'false');
    const t=ctx.__test;
    const ex={kind:'exam',year:2026,university_name:'Synthetic',schedule:'前期',questions:[{question_number:1,problem_text:'Test',answer_text:'Answer'}]};
    for(const draft of [false,true]) {
      const plain=t.buildPrintHtml(ex,{cover:true},draft);
      assert.equal(t.buildPrintHtml(ex,{cover:true,duration:true},draft),plain);
      ex.duration={effective_minutes:60};
      const on=t.buildPrintHtml(ex,{cover:true,duration:true},draft);
      assert.match(on, /pc-sched">前期<\/div><div class="pc-duration">時間：60分<\/div>/);
      assert.equal(on.replace('<div class="pc-duration">時間：60分</div>',''),plain);
      assert.doesNotMatch(t.buildPrintHtml(ex,{cover:false,duration:true},draft),/pc-duration/);
      assert.equal(t.buildPrintHtml(ex,{cover:true,duration:false},draft),plain);
      delete ex.duration;
      const fav={...ex,kind:'favFolder',folderId:55,duration:{effective_minutes:60}}; t.state.favFolders=[{id:55,name:'Favorite'}];
      assert.equal(t.buildPrintHtml(fav,{cover:true,duration:true},draft),t.buildPrintHtml(fav,{cover:true,duration:false},draft));
    }
    assert.equal(t.printOptions().duration,true);
    console.log('PASS: saved toggle, fourth cover row, unset/ON/OFF/no-cover, exact prior HTML preservation, favorite HTML unchanged');
  } finally {sql.close(); fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
