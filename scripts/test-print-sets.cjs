const assert=require('node:assert/strict');
const {fixture}=require('./print-sets-fixture.cjs');
(async()=>{
 const f=fixture();
 const body={id:'00000000-0000-4000-8000-000000000001',name:'授業用',exam_ids:[21,11,13],cover:{lines:['春期','合成過去問','英語'],time:'各60分'}};
 try {
  assert.equal((await f.call(null)).status,401);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM sqlite_master WHERE name='print_sets'").get().n,0,'Unauthenticated request cannot initialize storage');
  const saved=await f.call('user-a',undefined,body); assert.equal(saved.status,200); assert.equal(saved.body.print_set.revision,1);
  assert.equal((await f.call('user-a',undefined,body)).status,200,'Lost create response is idempotent');
  f.reopen();const r=await f.call('user-a',body.id); assert.deepEqual(r.body.print_set.exam_ids,[21,11,13]); assert.deepEqual(r.body.print_set.cover,body.cover);
  assert.equal((await f.call('user-b',body.id)).status,404); assert.deepEqual((await f.call('user-b')).body.print_sets,[]);
  const next={...body,name:'変更',revision:1};
  const concurrent=await Promise.all([f.call('user-a',body.id,next),f.call('user-a',body.id,{...next,name:'別端末'})]);
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
  const row=(await f.call('user-a',body.id)).body.print_set; assert.equal(row.revision,2); assert.equal(row.name,'変更');
  assert.equal((await f.call('user-b',body.id,{...next,revision:2})).status,409,'Cross-account write is isolated');
  for(const extra of [{exam_ids:[]},{exam_ids:[11,11]},{exam_ids:[999]},{exam_ids:['11']},{exam_ids:[1.5]},{name:''},{cover:{lines:['bad'],time:''}},{cover:{lines:['x'.repeat(121),'',''],time:''}},{cover:{lines:['','',''],time:'x'.repeat(121)}},{cover:{lines:['','',''],time:3}},{revision:0},{unexpected:true}]) {
    assert.ok((await f.call('user-a',body.id,{...next,revision:2,...extra})).status>=400);
  }
  assert.equal((await f.call('user-a',body.id,undefined,'DELETE')).status,405,'No permanent delete endpoint');
  f.sql.exec('DELETE FROM exams WHERE id=13');
  assert.deepEqual((await f.call('user-a',body.id)).body.print_set.exam_ids,[21,11,13],'Missing reference is preserved');
  const archive=await f.call('user-a',body.id,{...next,revision:2,archived:true});assert.equal(archive.status,200);
  assert.equal((await f.call('user-a',body.id,{...next,revision:3,archived:false})).status,409,'Cannot silently restore missing exam');
  f.sql.exec('INSERT INTO exams VALUES (13)');
  assert.equal((await f.call('user-a',body.id,{...next,revision:3,archived:false})).status,200);
  f.reopen();assert.equal((await f.call('user-a',body.id)).body.print_set.archived,false);
  assert.equal(f.sql.prepare('SELECT problem_text FROM questions').get().problem_text,'source');
  assert.equal(f.sql.prepare('SELECT count(*) n FROM favorites').get().n,1,'Source problems and favorites unchanged');
  console.log('PASS: isolated real SQLite reopen, create replay, per-account authorization, atomic revision conflict, validation, missing references, archive/restore, no problem/favorite writes');
 }finally {f.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
