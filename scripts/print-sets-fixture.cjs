const {DatabaseSync} = require('node:sqlite');
const {buildSync} = require('../panel/node_modules/esbuild');
const fs=require('node:fs'), path=require('node:path'), os=require('node:os');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'exam-print-sets-'));
const out=path.join(tmp,'sets.cjs');
buildSync({entryPoints:[path.resolve(__dirname,'../worker/print-sets.ts')],bundle:true,platform:'node',format:'cjs',outfile:out});
const {handlePrintSets}=require(out);
function fixture() {
  const filename=path.join(tmp,Math.random().toString(36)+'.sqlite');
  let sql=new DatabaseSync(filename);
  sql.exec(`CREATE TABLE exams(id INTEGER PRIMARY KEY); INSERT INTO exams VALUES (11),(12),(13),(21);
    CREATE TABLE questions(exam_id INTEGER, question_number INTEGER, problem_text TEXT); INSERT INTO questions VALUES (11,1,'source');
    CREATE TABLE favorites(uid TEXT,exam_id INTEGER,question_number INTEGER); INSERT INTO favorites VALUES ('user-a',11,1);`);
  const db={prepare(text) {let values=[];return {bind(...v){values=v;return this;}, async first(){return sql.prepare(text).get(...values)||null;},async all(){return {results:sql.prepare(text).all(...values)};},async run(){return sql.prepare(text).run(...values);}};}};
  const call=(uid='user-a',id,body,method=body===undefined?'GET':id?'PUT':'POST')=>handlePrintSets(new Request('https://fixture.test/api/print-sets'+(id?'/'+id:''),{method,...(body===undefined?{}:{body:JSON.stringify(body)})}),db,uid,id);
  return {call, db, get sql(){return sql;}, reopen(){sql.close();sql=new DatabaseSync(filename);},close(){sql.close();},filename};
}
module.exports={fixture,tmp};
