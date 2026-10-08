const assert=require('node:assert/strict');
const {fixture}=require('./print-sets-fixture.cjs');
(async()=>{
 const f=fixture();
 const body={id:'00000000-0000-4000-8000-000000000001',name:'授業用',exam_ids:[21,11,13],cover:{lines:['春期','合成過去問','英語'],time:'各60分'},question_selection:{'11:1':false,'21:1':true}};
 try {
  assert.equal((await f.call(null)).status,401);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM sqlite_master WHERE name='print_sets'").get().n,0,'Unauthenticated request cannot initialize storage');
  const saved=await f.call('user-a',undefined,body); assert.equal(saved.status,200); assert.equal(saved.body.print_set.revision,1);
  assert.equal((await f.call('user-a',undefined,body)).status,200,'Lost create response is idempotent');
  f.reopen();const r=await f.call('user-a',body.id); assert.deepEqual(r.body.print_set.exam_ids,[21,11,13]); assert.deepEqual(r.body.print_set.cover,body.cover); assert.deepEqual(r.body.print_set.question_selection,body.question_selection);
  assert.equal((await f.call('user-b',body.id)).status,404); assert.deepEqual((await f.call('user-b')).body.print_sets,[]);
  const next={...body,name:'変更',revision:1};
  const concurrent=await Promise.all([f.call('user-a',body.id,next),f.call('user-a',body.id,{...next,name:'別端末'})]);
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
  const row=(await f.call('user-a',body.id)).body.print_set; assert.equal(row.revision,2); assert.equal(row.name,'変更');
  assert.equal((await f.call('user-b',body.id,{...next,revision:2})).status,409,'Cross-account write is isolated');
  for(const extra of [{exam_ids:[]},{exam_ids:[11,11]},{exam_ids:[999]},{exam_ids:['11']},{exam_ids:[1.5]},{name:''},{cover:{lines:['bad'],time:''}},{cover:{lines:['x'.repeat(121),'',''],time:''}},{cover:{lines:['','',''],time:'x'.repeat(121)}},{cover:{lines:['','',''],time:3}},{revision:0},{unexpected:true},{question_selection:[]},{question_selection:{'999:1':false}},{question_selection:{'11:0':false}},{question_selection:{'11:1':'false'}},{question_selection:{'011:1':false}}]) {
    assert.ok((await f.call('user-a',body.id,{...next,revision:2,...extra})).status>=400);
  }
  assert.equal((await f.call('user-a',body.id,undefined,'DELETE')).status,405,'No permanent delete endpoint');
  const legacyUpdate={...next,revision:2};delete legacyUpdate.question_selection;
  assert.equal((await f.call('user-a',body.id,legacyUpdate)).status,200);
  assert.deepEqual((await f.call('user-a',body.id)).body.print_set.question_selection,body.question_selection,'Old clients preserve existing exclusions');
  // A legacy table gains only the new optional column and retains all old rows.
  const legacy=fixture();
  try {
    legacy.sql.exec("CREATE TABLE print_sets(uid TEXT,id TEXT,name TEXT,exam_ids TEXT,cover TEXT,revision INTEGER,archived INTEGER,updated_at TEXT,PRIMARY KEY(uid,id))");
    legacy.sql.prepare('INSERT INTO print_sets VALUES (?,?,?,?,?,?,?,?)').run('user-a',body.id,body.name,JSON.stringify(body.exam_ids),JSON.stringify(body.cover),1,0,'2026-01-01');
    const migrated=await legacy.call('user-a',body.id);assert.equal(migrated.status,200);assert.deepEqual(migrated.body.print_set.question_selection,{});assert.equal(migrated.body.print_set.name,body.name);
    legacy.reopen();assert.equal((await legacy.call('user-a',body.id)).body.print_set.revision,1);
  }finally{legacy.close();}
  const styled=fixture();
  try {
    const rich={...body,cover:{lines:['','','','Extra',''],time:'60',sizes:[null,2,null,4],colors:[null,3]}};
    assert.equal((await styled.call('user-a',undefined,rich)).status,200);
    styled.reopen();assert.deepEqual((await styled.call('user-a',body.id)).body.print_set.cover,rich.cover);
    const old={...body,revision:1};assert.equal((await styled.call('user-a',body.id,old)).status,200);
    assert.deepEqual((await styled.call('user-a',body.id)).body.print_set.cover.sizes,[null,2,null],'Old clients preserve styles within the retained lines');
    for(const cover of [{...rich.cover,sizes:[6]},{...rich.cover,colors:['red']},{...rich.cover,lines:Array(21).fill('')}]) assert.equal((await styled.call('user-a',body.id,{...rich,revision:2,cover})).status,400);
  } finally {styled.close();}
  const other={...body,id:'00000000-0000-4000-8000-000000000002',name:'別セット'};
  assert.equal((await f.call('user-a',undefined,other)).status,200);
  const beforeOrder=(await f.call('user-a',body.id)).body.print_set;
  const order=[body.id,other.id];
  assert.equal((await f.call('user-a','reorder',{ids:order,revision:0},'POST')).status,200);
  f.reopen(); assert.deepEqual((await f.call('user-a')).body.print_sets.map(s=>s.id),order);
  assert.deepEqual((await f.call('user-a',body.id)).body.print_set,beforeOrder,'Ordering changes no set data or version');
  assert.equal((await f.call('user-a','reorder',{ids:order.slice().reverse(),revision:0},'POST')).status,409);
  assert.equal((await f.call('user-a','reorder',{ids:[body.id],revision:1},'POST')).status,409);
  assert.equal((await f.call('user-b','reorder',{ids:order,revision:0},'POST')).status,409);
  assert.equal((await f.call('user-a','reorder',{ids:[body.id,body.id],revision:1},'POST')).status,400);
  assert.equal((await f.call('user-a','reorder',{ids:order.slice().reverse(),revision:1},'POST')).status,200);
  assert.deepEqual((await f.call('user-a')).body.print_sets.map(s=>s.id),order.slice().reverse());
  f.sql.exec('DELETE FROM exams WHERE id=13');
  assert.deepEqual((await f.call('user-a',body.id)).body.print_set.exam_ids,[21,11,13],'Missing reference is preserved');
  const archive=await f.call('user-a',body.id,{...next,revision:3,archived:true});assert.equal(archive.status,200);
  assert.equal((await f.call('user-a',body.id,{...next,revision:4,archived:false})).status,409,'Cannot silently restore missing exam');
  f.sql.exec('INSERT INTO exams VALUES (13)');
  assert.equal((await f.call('user-a',body.id,{...next,revision:4,archived:false})).status,200);
  f.reopen();assert.equal((await f.call('user-a',body.id)).body.print_set.archived,false);
  assert.equal(f.sql.prepare('SELECT problem_text FROM questions').get().problem_text,'source');
  assert.equal(f.sql.prepare('SELECT count(*) n FROM favorites').get().n,1,'Source problems and favorites unchanged');
  console.log('PASS: isolated real SQLite reopen, create replay, per-account authorization, atomic revision conflict, validation, missing references, archive/restore, no problem/favorite writes');
 }finally {f.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
