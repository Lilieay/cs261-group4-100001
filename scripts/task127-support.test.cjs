const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateExpiringBackend,cleanupFixtures,throwFailure}=require('./task127-support.cjs');
const project='cs261-task127-preflight';
const record=()=>({project,service:'backend-expiring',running:true,mode:'mock',ttl:'1',
  ports:{'8000/tcp':[{HostPort:'34803',HostIp:'127.0.0.1'}]}});
test('accept selected project expiry backend on port 34803 with TTL 1',()=>validateExpiringBackend(record(),project));
for(const [key,value] of [['project','other-stack'],['service','backend'],['running',false],['mode','real'],['ttl','28800'],['ports',{'8000/tcp':[{HostPort:'8000',HostIp:'127.0.0.1'}]}]]) {
  test(`reject wrong expiry backend ${key} before Login`,()=>{const r=record();r[key]=value;assert.throws(()=>validateExpiringBackend(r,project));});
}
test('failed first DELETE does not prevent remaining known fixture cleanup',async()=>{
  const attempts=[];let verified=false;
  const rows=[{id:1,kind:'guide'},{id:2,kind:'summary'},{id:3,kind:'guide',removed:true}];
  const result=await cleanupFixtures(rows,async row=>{attempts.push(row.id);if(row.id===2)throw Error('DELETE failed');row.removed=true;},()=>{},()=>{verified=true;});
  assert.deepEqual(attempts,[2,1]);assert(verified);assert.deepEqual(result.remaining,[{kind:'summary',id:2}]);
});
test('trigger and baseline errors recorded without blocking fixture attempts',async()=>{
  let attempted=false;const r=await cleanupFixtures([{id:9,kind:'guide'}],()=>{attempted=true;},()=>{throw Error('trigger');},()=>{throw Error('baseline');});
  assert(attempted);assert.deepEqual(r.errors.map(e=>e.phase),['trigger','baseline']);
});
test('cleanup failure never replaces primary exception identity or stack',()=>{
  const primary=new Error('original TC failure');assert.throws(()=>throwFailure(primary,[{message:'cleanup failed'}]),e=>e===primary);
});
test('cleanup-only failures fail the run and retain all error messages',()=>{
  assert.throws(()=>throwFailure(null,[{message:'first'},{message:'second'}]),e=>e instanceof AggregateError&&e.errors.length===2);
});
