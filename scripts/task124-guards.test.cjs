const {test} = require('node:test');
const assert = require('node:assert/strict');
const {validateStack, OwnedDeleteTrigger} = require('./task124-guards.cjs');
const project = 'cs261-task124-guard-test';
const urls = ['http://127.0.0.1:29800', 'http://127.0.0.1:29801'];
function stack() {
  const records = {};
  for (const [i, suffix] of ['', '-b'].entries()) {
    for (const kind of ['frontend', 'backend']) {
      const service = kind + suffix;
      records[service] = {project, service, running:true,
        ports:{'5000/tcp':[{HostIp:'127.0.0.1',HostPort:String(29800+i)}]},
        networks:{[`${project}_default`]:{Aliases:[service]}},
        proxy:kind==='frontend'?[`BACKEND_URL=http://backend${suffix}:8000`]:[],
        mode:kind==='backend'?['TU_API_MODE=mock']:[]};
    }
  }
  return records;
}
test('accept only matching ports, project, proxies and backend networks', () => validateStack(project,stack(),urls));
for (const [name, mutate] of [
  ['wrong port', r=>{r.frontend.ports['5000/tcp'][0].HostPort='5000';}],
  ['frontend from another project',r=>{r['frontend-b'].project='old-stack';}],
  ['proxy points at the other backend',r=>{r['frontend-b'].proxy=['BACKEND_URL=http://backend:8000'];}],
  ['backend from another project',r=>{r.backend.project='old-stack';}],
  ['different network',r=>{r.backend.networks={};}],
  ['real auth',r=>{r.backend.mode=['TU_API_MODE=real'];}]
]) test(`reject ${name} during preflight`,()=>{const r=stack();mutate(r);assert.throws(()=>validateStack(project,r,urls));});
test('cleanup does not touch an existing trigger it did not create',()=>{
  const calls=[];new OwnedDeleteTrigger(sql=>calls.push(sql)).cleanup();assert.deepEqual(calls,[]);
});
test('failed CREATE never grants cleanup ownership',()=>{
  const calls=[];const trigger=new OwnedDeleteTrigger(sql=>{calls.push(sql);throw Error('already exists');});
  assert.throws(()=>trigger.create('CREATE TRIGGER existing'));trigger.cleanup();assert.deepEqual(calls,['CREATE TRIGGER existing']);
});
test('assertion failure still cleans this run trigger once',()=>{
  const calls=[];const trigger=new OwnedDeleteTrigger(sql=>calls.push(sql));
  assert.throws(()=>{try{trigger.create('CREATE TRIGGER ours');assert.fail('injected assertion');}finally{trigger.cleanup();}});
  trigger.cleanup();assert.deepEqual(calls,['CREATE TRIGGER ours','DROP TRIGGER dbo.task124_delete_failure']);
});
