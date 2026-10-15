const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {buildSync} = require('../panel/node_modules/esbuild');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exam-overload-'));
const out = path.join(tmp, 'worker.cjs');
buildSync({entryPoints:['worker/index.ts'], bundle:true, platform:'node', format:'cjs', outfile:out});
const worker = require(out).default;
const request = route => new Request('https://test/api/'+route);
(async () => {
  try {
    let ddl = 0;
    const db = {
      exec: async () => { ddl++; throw new Error('Unexpected legacy migration'); },
      prepare(sql) { return {bind(){return this;}, async first(){return {id:93,university_id:1,schedule:'前期'};},async all(){return {results:[{question_number:1}]};},async run(){}}; },
      async batch(){ddl++;}
    };
    const detail = await worker.fetch(request('exams/93'), {DB:db});
    assert.equal(detail.status,200);
    assert.equal((await detail.json()).exam.id,93);
    assert.equal(ddl,0, 'exam read must not run DDL');
    await Promise.all(Array.from({length:8},()=>worker.fetch(request('exams/93/print-duration'),{DB:db})));
    assert.equal(ddl,1,'duration schema shared by concurrent reads');
    const broken = {...db,prepare(){throw new Error('D1 DB is overloaded. Requests queued for too long.');}};
    const busy = await worker.fetch(request('exams/93'),{DB:broken});
    assert.equal(busy.status,503);
    assert.equal(busy.headers.get('Retry-After'),'1');
    let attempts=0;
    const retryDb = {...db, async batch(){if (++attempts===1) throw new Error('D1 DB is overloaded');}};
    assert.equal((await worker.fetch(request('exams/93/print-duration'),{DB:retryDb})).status,503);
    assert.equal((await worker.fetch(request('exams/93/print-duration'),{DB:retryDb})).status,200);
    assert.equal(attempts,2,'failed initialization can retry');
    let migrations=0;
    const legacyDb = {...db,async exec(){migrations++; await Promise.resolve();}};
    await Promise.all(Array.from({length:8},()=>worker.fetch(request('missing-route'),{DB:legacyDb})));
    const count=migrations;
    await worker.fetch(request('missing-route'),{DB:legacyDb});
    assert.equal(migrations,count,'legacy migration shared and cached');
    assert.equal(count,17,'one legacy migration sequence');

    let calls=0, statuses=[];
    const context = {window:{},Store:{getWorkerUrl:()=> 'https://test'},URLSearchParams,Math,setTimeout:fn=>fn(),fetch:async()=>{calls++;const status=statuses.shift()||200;return {ok:status===200,status,json:async()=>status===200?{exam:{id:93}}:{error:'busy'}};}};
    vm.runInNewContext(fs.readFileSync('assets/js/api.js','utf8'),context);
    statuses=[503,503,200]; calls=0;
    assert.equal((await context.window.Api.getExam(93)).exam.id,93); assert.equal(calls,3);
    statuses=[503,503,503]; calls=0;
    await assert.rejects(context.window.Api.getExam(93),/busy/); assert.equal(calls,3);
    statuses=[404]; calls=0;
    await assert.rejects(context.window.Api.getExam(93),/busy/); assert.equal(calls,1);
    statuses=[503]; calls=0;
    await assert.rejects(context.window.Api.createExam({}),/busy/); assert.equal(calls,1,'writes never retried');

    const source=fs.readFileSync('assets/js/viewer.js','utf8');
    const fn=source.slice(source.indexOf('  async function loadPrintExams('),source.indexOf('  function loadMultiPrint()'));
    const load=vm.runInNewContext('('+fn.trim()+')');
    let active=0,max=0;
    const result=await load([1,2,3,4,5],async id=>{active++;max=Math.max(active,max);await new Promise(resolve=>setImmediate(resolve));active--;return id;},()=>true);
    assert.equal(JSON.stringify(result),'[1,2,3,4,5]'); assert.equal(max,2);
    let current=true, started=0;
    await load([1,2,3,4],async id=>{started++; await Promise.resolve();current=false;return id;},()=>current);
    assert.equal(started,2,'stale selection schedules no further reads');
    console.log('D1 overload: read isolation, shared/recoverable initialization, 503, bounded retries and print concurrency passed');
  } finally {fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
