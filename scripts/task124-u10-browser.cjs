// U10 browser -> Express -> FastAPI -> real SQL Server and PDF storage.
// Requires compose.yaml + compose.task124.yaml on an isolated mock-auth stack.
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {mkdirSync, writeFileSync} = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.TASK124_PLAYWRIGHT || 'playwright-core');
const {validateStack, OwnedDeleteTrigger} = require('./task124-guards.cjs');
const project = process.env.TASK124_PROJECT;
assert.match(project || '', /^cs261-task124-[a-z0-9-]+$/);
const evidence = process.env.TASK124_EVIDENCE;
assert(evidence, 'Set TASK124_EVIDENCE');
mkdirSync(evidence, {recursive: true});
const backend = `${project}-backend-1`;
const urls = ['http://127.0.0.1:29800','http://127.0.0.1:29801'];
const tag = `Task124-${Date.now()}`;
const fixtures = [], results = [];
const digest = value => createHash('sha256').update(value).digest('hex');
const report = (name, detail = {}) => { results.push({name, ...detail}); console.log(`PASS ${name}`); };
function docker(...args) { return execFileSync('docker', args, {encoding:'utf8', timeout:30000}).trim(); }
function py(input) { return execFileSync('docker', ['exec','-i',backend,'python','-'], {input,encoding:'utf8',timeout:30000}).trim(); }
// Capture only nonsecret fields needed for preflight; never inspect credentials.
const inspectFormat = '{"project":{{json (index .Config.Labels "com.docker.compose.project")}},'
  + '"service":{{json (index .Config.Labels "com.docker.compose.service")}},"running":{{json .State.Running}},'
  + '"ports":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}},'
  + '"proxy":[{{range .Config.Env}}{{if eq (index (split . "=") 0) "BACKEND_URL"}}{{json .}}{{end}}{{end}}],'
  + '"mode":[{{range .Config.Env}}{{if eq (index (split . "=") 0) "TU_API_MODE"}}{{json .}}{{end}}{{end}}]}';
const records = Object.fromEntries(['frontend','frontend-b','backend','backend-b'].map(service =>
  [service, JSON.parse(docker('inspect','--format',inspectFormat,`${project}-${service}-1`))]));
validateStack(project, records, urls); // Must finish before browser/Login/fixtures.
report('preflight verifies frontend port owners and A/B proxies on the selected Compose project', {project,urls});
function sql(statement) {
  py(`from app.db import engine\nwith engine.begin() as c:\n    c.exec_driver_sql(${JSON.stringify(statement)})`);
}
const ownedTrigger = new OwnedDeleteTrigger(sql);
function snapshot() {
  return JSON.parse(py(`import json, hashlib
from pathlib import Path
from app.config import PDF_STORAGE_ROOT
from app.db import engine
with engine.connect() as c:
    tables = {}
    for name in ('users','courses','guides','summaries','summary_files','reviews','saved_guides','saved_summaries'):
        tables[name] = sorted([list(map(str,row)) for row in c.exec_driver_sql('SELECT * FROM dbo.'+name)])
    files = {str(p.relative_to(PDF_STORAGE_ROOT)):hashlib.sha256(p.read_bytes()).hexdigest()
             for p in Path(PDF_STORAGE_ROOT).rglob('*') if p.is_file()}
    trigger = c.exec_driver_sql("SELECT OBJECT_ID('dbo.task124_delete_failure','TR')").scalar()
    print(json.dumps({'tables':tables,'files':files,'testTrigger':trigger}))`));
}
function contentOnly(value) {
  return {tables:Object.fromEntries(Object.entries(value.tables).filter(([name]) => !name.startsWith('saved_'))),files:value.files};
}
function bookmarkUsers(t) {
  assert(['guide','summary'].includes(t.kind) && Number.isSafeInteger(t.id) && t.id > 0);
  return JSON.parse(py(`import json
from app.db import engine
with engine.connect() as c:
    print(json.dumps(list(c.exec_driver_sql('SELECT user_id FROM dbo.saved_${t.kind === 'guide' ? 'guides' : 'summaries'} WHERE ${t.kind}_id=? ORDER BY user_id', (${t.id},)).scalars())))`));
}
function deleteFault(t, user, active) {
  assert(Number.isSafeInteger(user));
  // Validate the target even when disabling the trigger.
  assert(['guide','summary'].includes(t.kind) && Number.isSafeInteger(t.id) && t.id > 0);
  if (active) ownedTrigger.create(`CREATE TRIGGER dbo.task124_delete_failure ON dbo.saved_${t.kind === 'guide' ? 'guides' : 'summaries'} AFTER DELETE AS
    BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM deleted WHERE ${t.kind}_id=${t.id} AND user_id=${user})
    BEGIN ;THROW 51024, 'Task124 scoped DELETE failure', 1; END END`);
  else ownedTrigger.cleanup();
}
async function login(page, index) {
  await page.goto(urls[index]+'/login.html');
  await page.locator('#username').fill(`680000000${index}`);
  await page.locator('#password').fill('0000000000000'); // local TU mock only
  const pending = page.waitForResponse(r => r.url() === urls[index]+'/api/auth/login');
  await page.locator('#login-submit').click(); assert.equal((await pending).status(),200);
  await page.waitForURL('**/courses.html');
  return (await api(page,'/api/auth/me')).data.id;
}
async function api(page, endpoint, method='GET', data, anonymous=false) {
  return page.evaluate(async ({endpoint,method,data,anonymous}) => {
    const headers = {};
    if (!anonymous) headers.Authorization = 'Bearer '+sessionStorage.getItem('access_token');
    if (data !== undefined) headers['Content-Type']='application/json';
    const r=await fetch(endpoint,{method,headers,cache:'no-store',...(data===undefined?{}:{body:JSON.stringify(data)})});
    return {status:r.status,data:r.status===204?null:await r.json()};
  },{endpoint,method,data,anonymous});
}
const statePath=t=>`/api/saved-items/${t.kind}/${t.id}`;
async function save(page,t) { assert.equal((await api(page,statePath(t),'PUT')).status,200); }
function pdf(width) {
  const rows=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} 144] /Resources << >> >>`];
  let value='%PDF-1.4\n'; const offsets=[];
  rows.forEach((row,i)=>{offsets.push(value.length);value+=`${i+1} 0 obj\n${row}\nendobj\n`;});
  const xref=value.length;
  value+='xref\n0 4\n0000000000 65535 f \n'+offsets.map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('');
  return Buffer.from(value+`trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
async function publish(page, owner, kind, course, width=144) {
  const title=`${tag} ${kind} ${fixtures.length}`;
  let r; const bytes=kind==='summary'?pdf(width):null;
  if(kind==='guide') r=await api(page,'/api/guides','POST',{course_id:course,title,academic_year:2569,
    semester:1,exam_period:'midterm',topics:'Task124 ทดสอบเปิดตรงชิ้น',exam_format:'objective',objective_count:5});
  else r=await page.evaluate(async ({course,title,bytes})=>{
    const body=new FormData();body.set('course_id',String(course));body.set('title',title);
    body.set('file',new File([Uint8Array.from(bytes)],'task124.pdf',{type:'application/pdf'}));
    const r=await fetch('/api/summaries',{method:'POST',body,headers:{Authorization:'Bearer '+sessionStorage.getItem('access_token')}});
    return {status:r.status,data:await r.json()};
  },{course,title,bytes:[...bytes]});
  assert.equal(r.status,201,JSON.stringify(r.data));
  const t={id:r.data.id,kind,owner,course,title,sha256:bytes?digest(bytes):undefined};fixtures.push(t);return t;
}
const card=(page,t)=>page.locator(`.saved-card:has(button[data-item-type="${t.kind}"][data-unsave="${t.id}"])`);
async function readyList(page) {
  await page.locator('#saved-list[aria-busy=false]').waitFor({state:'visible'});
}
async function list(page,index) { await page.goto(urls[index]+'/saved-courses.html');await readyList(page); }
async function shot(page,name) { await page.screenshot({path:path.join(evidence,name+'.png'),fullPage:true}); }
async function removeUi(page,t,expected=200) {
  const pending=page.waitForResponse(r=>new URL(r.url()).pathname===statePath(t)&&r.request().method()==='DELETE');
  await card(page,t).locator('button[data-unsave]').click();
  const response=await pending; assert.equal(response.status(),expected,await response.text());
  await readyList(page);return response;
}
async function deleteTarget(page,t) {
  const r=await api(page,t.kind==='guide'?`/api/my-guides/${t.id}`:`/api/summaries/${t.id}`,'DELETE');
  assert.equal(r.status,t.kind==='guide'?200:204,JSON.stringify(r.data));t.deleted=true;
}
async function checkOpen(page,t) {
  await card(page,t).locator('a').click();
  if(t.kind==='guide') {
    await page.locator('#readingContent h1').getByText(t.title,{exact:true}).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('guide'),String(t.id));
    const r=await api(page,`/api/guides/${t.id}`);assert.equal(r.status,200);assert.equal(r.data.title,t.title);
  } else {
    await page.locator('#summary-reading-title').getByText(t.title,{exact:true}).waitFor();
    await page.locator('#summary-pdf[src^="blob:"]').waitFor({state:'visible'});
    // Read the exact blob URL attached to the viewer, not an independent API GET.
    const bytes=await page.locator('#summary-pdf').evaluate(async frame=>{
      const r=await fetch(frame.src.split('#')[0]);
      if(!r.ok)throw Error('Viewer PDF read failed');return [...new Uint8Array(await r.arrayBuffer())];
    });
    const viewerSha256=digest(Buffer.from(bytes));
    assert.equal(viewerSha256,t.sha256);
    report('PDF reader blob matches selected fixture', {id:t.id,viewerSha256,fixtureSha256:t.sha256});
    assert.equal(new URL(page.url()).searchParams.get('summary'),String(t.id));
  }
  const back=page.locator(t.kind==='guide'?'#readingBack':'#summary-back');
  assert.equal(new URL(await back.getAttribute('href'),page.url()).pathname,'/saved-courses.html');
  const label=t.kind==='guide'?'guide':`summary-${fixtures.filter(row=>row.kind==='summary').findIndex(row=>row.id===t.id)+1}`;
  await shot(page,`02-open-${label}`);await back.click();await readyList(page);
}
async function main() {
  const preexistingTrigger = JSON.parse(py(`import json
from app.db import engine
with engine.connect() as c:
    print(json.dumps(c.exec_driver_sql("SELECT OBJECT_ID('dbo.task124_delete_failure','TR')").scalar()))`));
  assert.equal(preexistingTrigger, null, 'A preexisting test trigger must be reviewed, not deleted');
  const browser=await chromium.launch({channel:process.env.TASK124_BROWSER||'chrome',headless:true});
  const contexts=await Promise.all([browser.newContext({viewport:{width:1440,height:1000}}),browser.newContext({viewport:{width:1440,height:1000}})]);
  const pages=await Promise.all(contexts.map(c=>c.newPage()));
  pages.forEach(p=>p.setDefaultTimeout(15000));
  const environment={browser:browser.version(),docker:docker('version','--format','{{.Server.Version}}'),
    sqlServer:py("from app.db import engine\nwith engine.connect() as c:\n    print(c.exec_driver_sql(\"SELECT CAST(SERVERPROPERTY('ProductVersion') AS VARCHAR)\").scalar())")};
  let baseline,completed=false,cleaned=false,renamed=false;
  try {
    const users=[await login(pages[0],0),await login(pages[1],1)];assert.notEqual(users[0],users[1]);
    baseline=snapshot();assert.equal(baseline.testTrigger,null);
    await list(pages[0],0);await pages[0].getByText('ยังไม่มีรายการที่บันทึก',{exact:true}).waitFor();
    assert.equal(await pages[0].getByRole('link',{name:'ค้นหารายวิชา',exact:true}).getAttribute('href'),'courses.html');
    const anonymous=await api(pages[0],'/api/saved-items','GET',undefined,true);assert.equal(anonymous.status,401);
    report('empty UI and search link; anonymous list rejected; two SQL users',{userIds:users});await shot(pages[0],'01-empty');
    const course=(await api(pages[0],'/api/courses?search=CS261')).data.find(c=>c.course_code==='CS261');assert(course);
    const guide=await publish(pages[0],0,'guide',course.id);
    const summary=await publish(pages[0],0,'summary',course.id,144);
    const secondPdf=await publish(pages[0],0,'summary',course.id,240);
    const other=await publish(pages[1],1,'guide',course.id);
    const content=contentOnly(snapshot());
    for(const t of [guide,summary,secondPdf])await save(pages[0],t);
    for(const t of fixtures)await save(pages[1],t);
    await list(pages[0],0);assert.equal(await pages[0].locator('.saved-card').count(),3);
    assert.equal(await pages[0].locator('.saved-course-group').count(),1);assert.equal(await card(pages[0],other).count(),0);
    await shot(pages[0],'02-grouped-list');
    const courseLink=pages[0].locator('.saved-course-group h2 a');
    await courseLink.click();assert.equal(new URL(pages[0].url()).searchParams.get('courseId'),String(course.id));
    await pages[0].locator('#courseHeading').getByText(`ชีตสรุปและแนวข้อสอบ ${course.course_code}`, {exact:true}).waitFor();
    assert.equal(await pages[0].locator('#courseName').innerText(), `${course.course_code} ${course.course_name}`);
    report('course page displays selected course code and name', {code:course.course_code,name:course.course_name});
    await pages[0].goBack();await readyList(pages[0]);
    for(const t of [guide,summary,secondPdf])await checkOpen(pages[0],t);
    report('list groups one course and three distinct works; Guide alias and two different PDF checksums open exact selection');
    await login(pages[0],0);await list(pages[0],0);assert.equal(await pages[0].locator('.saved-card').count(),3);
    await list(pages[1],1);assert.equal(await pages[1].locator('.saved-card').count(),4);
    report('reload and new Bearer session preserve list; second account has its own list');
    for(const t of [guide,summary]) {
      await list(pages[0],0);deleteFault(t,users[0],true);
      try {
        let sawFailedDelete=false;
        const observeFailure=r=>{if(r.request().method()==='DELETE' && new URL(r.url()).pathname===statePath(t) && r.status()===503)sawFailedDelete=true;};
        pages[0].on('response',observeFailure);
        let latest;
        try {
          const refreshed=pages[0].waitForResponse(r=>sawFailedDelete && r.request().method()==='GET' && new URL(r.url()).pathname==='/api/saved-items');
          const r=await removeUi(pages[0],t,503);assert.equal((await r.json()).error.code,'SAVED_ITEMS_UNAVAILABLE');
          const response=await refreshed;assert.equal(response.status(),200);latest=await response.json();
          assert(latest.items.some(row=>row.item_type===t.kind && row.item_id===t.id));
        }finally{pages[0].off('response',observeFailure);}
        assert.deepEqual(bookmarkUsers(t),[...users].sort((a,b)=>a-b));
        await card(pages[0],t).waitFor();await pages[0].locator('#saved-status[data-kind=error]').waitFor();
        await shot(pages[0],`03-${t.kind}-delete-sql-failure`);
        report(`${t.kind}: DELETE 503 followed by actual GET 200 retaining current user's bookmark`, {deleteStatus:503,getStatus:200,items:latest.items.length});
      } finally { deleteFault(t,users[0],false); }
      await removeUi(pages[0],t);assert.equal(await card(pages[0],t).count(),0);
      assert.deepEqual(bookmarkUsers(t),[users[1]]);
      const repeat=await api(pages[0],statePath(t),'DELETE');assert.equal(repeat.status,200);assert.equal(repeat.data.saved,false);
      assert.deepEqual(contentOnly(snapshot()),content);
      await pages[0].reload();await readyList(pages[0]);assert.equal(await card(pages[0],t).count(),0);
      await save(pages[0],t);
      report(`${t.kind}: SQL DELETE rollback, UI error/reload, remove/repeat, content and other account preserved`);
    }
    // Hide only this isolated stack's relation table to exercise a real SELECT error.
    await list(pages[0],0);
    sql("EXEC sp_rename 'dbo.saved_summaries', 'task124_saved_summaries_unavailable'");renamed=true;
    try {
      await pages[0].reload();await readyList(pages[0]);
      await pages[0].getByText('โหลดรายการไม่สำเร็จ',{exact:true}).waitFor();
      assert.equal(await pages[0].locator('.saved-card').count(),0);
      const r=await api(pages[0],'/api/saved-items');assert.equal(r.status,503);
      await shot(pages[0],'04-list-sql-failure');
    } finally { sql("EXEC sp_rename 'dbo.task124_saved_summaries_unavailable', 'saved_summaries'");renamed=false; }
    await pages[0].locator('#saved-retry').click();await readyList(pages[0]);assert.equal(await pages[0].locator('.saved-card').count(),3);
    report('real SELECT failure shows error rather than empty or partial list; retry recovers all three bookmarks');
    // Forward DELETE to the real backend, then discard only the browser response.
    for(const t of [guide,summary]) {
      await list(pages[0],0);let upstreamStatus;
      const url=urls[0]+statePath(t);
      const intercept=async route=>{
        if(route.request().method()!=='DELETE')return route.continue();
        const upstream=await route.fetch();upstreamStatus=upstream.status();await route.abort('failed');
      };
      await pages[0].route(url,intercept);
      try {
        const fresh=pages[0].waitForResponse(r=>new URL(r.url()).pathname==='/api/saved-items'&&r.request().method()==='GET');
        await card(pages[0],t).locator('button').click();await fresh;await readyList(pages[0]);
        assert.equal(upstreamStatus,200);assert.equal(await card(pages[0],t).count(),0);
        assert.deepEqual(bookmarkUsers(t),[users[1]]);
        assert.match(await pages[0].locator('#saved-status').innerText(),/ยังยืนยันผลไม่ได้/);
        await shot(pages[0],`05-${t.kind}-lost-response`);
      } finally {await pages[0].unroute(url,intercept);}
      await save(pages[0],t);
      report(`${t.kind}: lost browser DELETE response triggers real GET list; current SQL state shown without claiming original request success`);
    }
    for(const t of [guide,summary]) {
      await list(pages[0],0);
      // Delete through a second HTTP client without refreshing the stale UI first.
      const token=await pages[0].evaluate(()=>sessionStorage.getItem('access_token'));
      const targetUrl=t.kind==='guide'?`/api/my-guides/${t.id}`:`/api/summaries/${t.id}`;
      const removed=await contexts[0].request.delete(urls[0]+targetUrl,{headers:{Authorization:'Bearer '+token}});
      assert.equal(removed.status(),t.kind==='guide'?200:204);t.deleted=true;
      await card(pages[0],t).locator('a').click();
      await pages[0].getByText(t.kind==='guide'?'ไม่พบแนวข้อสอบ':'ไม่พบสรุป',{exact:false}).first().waitFor();
      let reads=0;const track=req=>{if(new URL(req.url()).pathname==='/api/saved-items'&&req.method()==='GET')reads++;};
      pages[0].on('request',track);
      try{await pages[0].goBack();await readyList(pages[0]);assert.equal(await card(pages[0],t).count(),0);assert(reads>0);}
      finally{pages[0].off('request',track);}
      assert.equal((await api(pages[0],statePath(t),'DELETE')).status,200);
      assert.deepEqual(bookmarkUsers(t),[]);await card(pages[0],secondPdf).waitFor();
      report(`${t.kind}: stale saved card opens typed 404; Back refreshes list and preserves other work`);
    }
    // Validation and ownership are checked at the real HTTP boundary as well.
    for(const endpoint of ['/api/saved-items/summary/1.0','/api/saved-items/course/1'])assert.equal((await api(pages[0],endpoint,'DELETE')).status,422);
    assert.equal((await api(pages[0],'/api/saved-items?user_id='+users[1])).status,422);
    assert.equal((await api(pages[0],statePath(secondPdf),'DELETE',undefined,true)).status,401);
    await list(pages[0],0);await removeUi(pages[0],secondPdf);
    await pages[0].getByText('ยังไม่มีรายการที่บันทึก',{exact:true}).waitFor();
    await login(pages[0],0);await list(pages[0],0);assert.equal(await pages[0].locator('.saved-card').count(),0);
    await list(pages[1],1);await card(pages[1],secondPdf).waitFor();await card(pages[1],other).waitFor();
    const stillThere=await api(pages[0],`/api/summaries/${secondPdf.id}`);assert.equal(stillThere.status,200);
    report('invalid IDs/type/user override rejected; no-token DELETE rejected; empty state persists; other bookmarks and PDF remain');
    await shot(pages[0],'06-final-empty');completed=true;
  } catch(error){console.error('Integration failed:',error.message);throw error;}
  finally {
    try {
      if(renamed)sql("EXEC sp_rename 'dbo.task124_saved_summaries_unavailable', 'saved_summaries'");
      ownedTrigger.cleanup();
      for(const t of [...fixtures].reverse())if(!t.deleted)await deleteTarget(pages[t.owner],t);
      if(baseline){assert.deepEqual(snapshot(),baseline);cleaned=true;report('cleanup restored baseline SQL rows and PDF checksums; test trigger absent');}
    } finally {
      await browser.close();writeFileSync(path.join(evidence,'results.json'),JSON.stringify({passed:completed&&cleaned,
        sourceSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),environment,
        authMode:'TU mock; two backend processes; distinct SQL user IDs',project,date:new Date().toISOString(),results,
        fixtures:fixtures.map(({id,kind,owner,title,sha256,deleted})=>({id,kind,owner,title,sha256,deleted}))},null,2)+'\n');
    }
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
