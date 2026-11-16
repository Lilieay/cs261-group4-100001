// Real SQL checks for the preexisting-trigger and assertion-failure cleanup paths.
// Run before task124-u10-browser.cjs on the same isolated test stack.
const assert = require('node:assert/strict');
const {execFileSync, spawnSync} = require('node:child_process');
const {mkdirSync, writeFileSync} = require('node:fs');
const path = require('node:path');
const {OwnedDeleteTrigger} = require('./task124-guards.cjs');
const project = process.env.TASK124_PROJECT;
assert.match(project || '', /^cs261-task124-[a-z0-9-]+$/);
assert(process.env.TASK124_EVIDENCE);
const backend = `${project}-backend-1`;
function docker(...args) {return execFileSync('docker',args,{encoding:'utf8',timeout:30000}).trim();}
assert.equal(docker('inspect','--format','{{ index .Config.Labels "com.docker.compose.project" }}',backend),project);
function py(input) {return execFileSync('docker',['exec','-i',backend,'python','-'],{input,encoding:'utf8',timeout:30000}).trim();}
function sql(statement) {py(`from app.db import engine\nwith engine.begin() as c:\n    c.exec_driver_sql(${JSON.stringify(statement)})`);}
function snapshot() {
  return JSON.parse(py(`import json
from app.db import engine
with engine.connect() as c:
    counts={t:c.exec_driver_sql('SELECT COUNT(*) FROM dbo.'+t).scalar()
            for t in ('users','guides','summaries','saved_guides','saved_summaries')}
    trigger=c.exec_driver_sql("SELECT OBJECT_ID('dbo.task124_delete_failure','TR'), OBJECT_DEFINITION(OBJECT_ID('dbo.task124_delete_failure','TR'))").first()
    print(json.dumps({'counts':counts,'trigger':list(trigger)}))`));
}
function loginCount() {
  const logs=spawnSync('docker',['logs',backend],{encoding:'utf8',timeout:30000});
  assert.equal(logs.status,0);
  return ((logs.stdout+logs.stderr).match(/POST \/api\/auth\/login/g)||[]).length;
}
const before=snapshot();assert.equal(before.trigger[0],null,'Do not replace a preexisting trigger');
const statement='CREATE TRIGGER dbo.task124_delete_failure ON dbo.saved_guides AFTER DELETE AS BEGIN SET NOCOUNT ON; END';
const ours=new OwnedDeleteTrigger(sql);
const results=[];
try {
  ours.create(statement);
  const existing=snapshot();const logins=loginCount();
  const rejected=spawnSync(process.execPath,[path.join(__dirname,'task124-u10-browser.cjs')],
    {env:process.env,encoding:'utf8',timeout:60000});
  assert.notEqual(rejected.status,0);
  assert.match(rejected.stderr,/preexisting test trigger/);
  assert.deepEqual(snapshot(),existing);
  assert.equal(loginCount(),logins);
  results.push('main script rejects preexisting trigger before Login/fixtures; original ID and definition preserved');
} finally {ours.cleanup();}
assert.deepEqual(snapshot(),before);
const created=new OwnedDeleteTrigger(sql);
let injected=false;
try {
  try {created.create(statement);assert.fail('Task124 injected assertion after CREATE');}
  finally {created.cleanup();}
} catch(error) {assert.match(error.message,/Task124 injected assertion/);injected=true;}
assert(injected);assert.deepEqual(snapshot(),before);
results.push('trigger created by current run removed in finally after injected assertion failure');
const dir=process.env.TASK124_EVIDENCE;mkdirSync(dir,{recursive:true});
writeFileSync(path.join(dir,'trigger-safety-results.json'),JSON.stringify({passed:true,project,
  sourceSha:dockerGitSha(),date:new Date().toISOString(),results},null,2)+'\n');
for(const result of results)console.log('PASS '+result);
function dockerGitSha(){return execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();}
