const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { buildSync } = require('../panel/node_modules/esbuild');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exam-title-'));
buildSync({entryPoints:['worker/university-index.ts'],bundle:true,platform:'node',format:'cjs',outfile:path.join(tmp,'index.cjs')});
const worker = require(path.join(tmp,'index.cjs'));
buildSync({entryPoints:['worker/index.ts'],bundle:true,platform:'node',format:'cjs',outfile:path.join(tmp,'worker.cjs')});
const api = require(path.join(tmp,'worker.cjs')).default;
const html = fs.readFileSync('index.html','utf8');
const published = html.match(/src="(assets\/js\/markup[^"?]+)(?:\?[^"]*)?"/)[1];
const frontends = [...new Set(['assets/js/markup.js',published])].map(file => {
  const context = {window:{}};
  vm.runInNewContext(fs.readFileSync(file,'utf8'),context);
  return [file,context.window.Markup.extractZenyakuTitle];
});
const cases = [
  ['Q1','{{全訳}}\n《ディスレクシア》\n訳文','ディスレクシア'],
  ['Q3','{{全訳}}\n@@《幼児期健忘の解明に向けて》\n訳文','幼児期健忘の解明に向けて'],
  ['Q5','{{全訳}}\n@@《分子生物学の出発点》\n訳文','分子生物学の出発点'],
  ['whitespace/CRLF','{{本文}}\r\n《採用しない》\r\n  {{全訳}} \r\n\r\n \t@@　《Title》 suffix\r\n訳文','Title'],
  ['plain whitespace','{{全訳}}\n\n　《Title》','Title'],
  ['empty','', ''],
  ['no translation','{{本文}}\n@@《採用しない》',''],
  ['no title','{{全訳}}\n訳文のみ',''],
  ['later title','{{全訳}}\n訳文\n@@《採用しない》',''],
  ['inline title','{{全訳}}\n本文《採用しない》',''],
  ['next section','{{全訳}}\n訳文\n{{解説}}\n《採用しない》',''],
  ['empty title','{{全訳}}\n@@《》',''],
  ['marker without title','{{全訳}}\n@@本文\n《採用しない》',''],
  ['first translation','{{全訳}}\n《First》\n{{解説}}\n解説\n{{全訳}}\n《Second》','First'],
];
(async () => {
  try {
    for (const [name,input,expected] of cases) {
      for (const [file,extract] of [...frontends,['worker',worker.extractZenyakuTitle]]) {
        assert.equal(extract(input),expected,`${file}: ${name}`);
      }
    }
    const key = 'indexes/universities/v1/7.json';
    let reads = 0, writes = 0;
    let cached = {version:1,university:{id:7},exams:[{id:56,questions:[{zenyaku_title:''}]}]};
    const rows = cases.slice(0,3).map((c,i)=>({exam_id:56,year:2023,schedule:'前期',question_number:1+i*2,category:'長文',problem_text:c[1]}));
    const env = {
      DB:{prepare(sql){reads++;return {bind(id){assert.equal(id,7);return this;},async first(){return {id:7,name:'東邦大学',reading:'とうほう',abbreviation:'東邦'};},async all(){return {results:rows};}};}},
      IMAGES:{async get(k){assert.equal(k,key);return cached ? {text:async()=>JSON.stringify(cached)} : null;},async put(k,body){assert.equal(k,key);writes++;cached=JSON.parse(body);},async delete(){throw Error('unexpected invalidation');},async list(){throw Error('must not scan universities');}}
    };
    const index = await worker.readUniversityIndex(env,7);
    assert.equal(reads,2,'one university lookup and one scoped questions query');
    assert.equal(writes,1,'overwrite only the visited legacy university cache');
    assert.equal(index.title_extraction_version,2);
    assert.deepEqual(index.exams[0].questions.map(q=>q.zenyaku_title),cases.slice(0,3).map(c=>c[2]));
    assert.equal(JSON.stringify(index).includes('problem_text'),false,'cache excludes source text');
    await worker.readUniversityIndex(env,7);
    assert.equal(reads,2,'current cache requires no D1 reads');
    cached=null;
    await worker.readUniversityIndex(env,7);
    assert.equal(writes,2,'missing cache is rebuilt');
    cached={version:1};
    const response = await api.fetch(new Request('https://test/api/university-index/7'),env);
    assert.equal(response.status,200);
    assert.deepEqual((await response.json()).exams[0].questions.map(q=>q.zenyaku_title),cases.slice(0,3).map(c=>c[2]));
    env.DB.exec=async()=>{}; // Existing schema initialization, synthetic DB only.
    env.DB.prepare=(sql)=>({async run(){assert.match(sql,/^(ALTER|CREATE) /);},bind(...values){this.values=values;return this;},async all(){
      if (sql.includes('WHERE id IN')) return {results:rows.map((row,i)=>({id:i+1,problem_text:row.problem_text}))};
      assert.deepEqual(this.values,['%東邦%',2023,'前期']);
      return {results:rows.map((row,i)=>({question_id:i+1,exam_id:56,question_number:row.question_number,category:'長文'}))};
    }});
    const search = await api.fetch(new Request('https://test/api/search?universityName=%E6%9D%B1%E9%82%A6&year=2023&schedule=%E5%89%8D%E6%9C%9F'),env);
    assert.equal(search.status,200);
    const searchBody = await search.json();
    assert.deepEqual(searchBody.results.map(q=>q.zenyaku_title),cases.slice(0,3).map(c=>c[2]));
    cached={version:1};
    env.DB.prepare=()=>{throw Error('D1 busy');};
    await assert.rejects(worker.readUniversityIndex(env,7),/D1 busy/);
    assert.deepEqual(cached,{version:1},'failed rebuild retains legacy cache for retry');
    console.log(`Title extraction: ${cases.length} cases agree across canonical/public JS and Worker; scoped legacy cache refresh, cache hits, misses and failure passed`);
  } finally {fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
