// Real Worker routes with only Firebase token verification substituted, isolated SQLite.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {DatabaseSync}=require('node:sqlite'),{buildSync}=require('../panel/node_modules/esbuild');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'exam-set-folders-'));
const source=fs.readFileSync(path.join(root,'worker/index.ts'),'utf8').replace('return verifyFirebaseIdToken(m[1]);','return m[1].startsWith("fixture-") ? m[1].slice(8) : null;');
buildSync({stdin:{contents:source,resolveDir:path.join(root,'worker'),loader:'ts'},bundle:true,platform:'node',format:'cjs',outfile:path.join(tmp,'worker.cjs')});
const worker=require(path.join(tmp,'worker.cjs')).default;
function fixture(){
 const filename=path.join(tmp,Math.random().toString(36).slice(2)+'.sqlite');let sql=new DatabaseSync(filename);
 sql.exec(fs.readFileSync(path.join(root,'schema.sql'),'utf8'));
 sql.exec("DELETE FROM questions; DELETE FROM exams; DELETE FROM universities; INSERT INTO universities(id,name) VALUES(9999,'Fixture'); INSERT INTO exams(id,university_id,year,schedule) VALUES(11,9999,2026,'前期'); INSERT INTO questions(exam_id,question_number,problem_text) VALUES(11,1,'Synthetic');");
 const db={prepare(text){let values=[];return {bind(...v){values=v;return this;},async first(){return sql.prepare(text).get(...values)||null;},async all(){return {results:sql.prepare(text).all(...values)};},async run(){return this.execute();},execute(){const rows=sql.prepare(text).all(...values);return {results:rows,success:true};}};},async exec(text){sql.exec(text);},async batch(statements){sql.exec('BEGIN');try{const r=statements.map(s=>s.execute());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const call=async(pathname,body,method=body===undefined?'GET':'POST',uid='a')=>{const r=await worker.fetch(new Request('https://fixture.test/api/'+pathname,{method,headers:uid?{Authorization:'Bearer fixture-'+uid}:{},...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB:db});return {status:r.status,body:await r.json()};};
 return {call,get sql(){return sql;},reopen(){sql.close();sql=new DatabaseSync(filename);},close(){sql.close();}};
}
module.exports={fixture};
