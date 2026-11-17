// Real browser -> existing Express proxy -> FastAPI -> SQL Server/PDF volume.
// TU is explicitly mock; run only against the isolated Compose project below.
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {mkdirSync, writeFileSync} = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.TASK127_PLAYWRIGHT || 'playwright-core');
const {validateExpiringBackend,cleanupFixtures,throwFailure} = require('./task127-support.cjs');
const project = process.env.TASK127_PROJECT;
assert.match(project || '', /^cs261-task127-[a-z0-9-]+$/);
const backend = `${project}-backend-1`;
const evidence = process.env.TASK127_EVIDENCE;
assert(evidence, 'Set TASK127_EVIDENCE to a directory outside public/');
mkdirSync(evidence, {recursive: true});
const urls = ['http://127.0.0.1:31800', 'http://127.0.0.1:31801', 'http://127.0.0.1:31802'];
const tag = `Task127-${Date.now()}`;
const results = [];
const targets = [];
let ownsFault = false;
const digest = data => createHash('sha256').update(data).digest('hex');
function passed(name, detail = {}) { results.push({name, ...detail}); console.log(`PASS ${name}`); }
function py(code) {
  return execFileSync('docker', ['exec', '-i', backend, 'python', '-'],
    {input: code, encoding: 'utf8', timeout: 30000}).trim();
}
const label = execFileSync('docker', ['inspect', '--format',
  '{{ index .Config.Labels "com.docker.compose.project" }}', backend], {encoding: 'utf8'}).trim();
assert.equal(label, project);
for (const container of [backend, `${project}-backend-b-1`, `${project}-backend-c-1`, `${project}-backend-expiring-1`]) {
  assert.equal(execFileSync('docker', ['exec', container, 'printenv', 'TU_API_MODE'], {encoding: 'utf8'}).trim(), 'mock');
}
function snapshot() {
  return JSON.parse(py(`import json, hashlib
from pathlib import Path
from app.db import engine
from app.config import PDF_STORAGE_ROOT
with engine.connect() as c:
    tables = {}
    for name in ('users','courses','guides','summaries','summary_files','reviews','saved_guides','saved_summaries'):
        rows = c.exec_driver_sql('SELECT * FROM dbo.' + name).fetchall()
        tables[name] = sorted([list(map(str, row)) for row in rows])
    files = {str(p.relative_to(PDF_STORAGE_ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
             for p in Path(PDF_STORAGE_ROOT).rglob('*') if p.is_file()}
    print(json.dumps({'tables': tables, 'files': files}))`));
}
function sqlReview(id) {
  assert(Number.isSafeInteger(id));
  return JSON.parse(py(`import json
from app.db import engine
with engine.connect() as c:
    row = c.exec_driver_sql('SELECT id,author_id,guide_id,summary_id,rating,comment FROM dbo.reviews WHERE id=?', (${id},)).first()
    print(json.dumps(list(row) if row else None))`));
}
function fault(target, active) {
  if (!active && !ownsFault) return;
  assert(Number.isSafeInteger(target.id));
  const col = target.kind === 'guide' ? 'guide_id' : 'summary_id';
  const sql = active ? `CREATE TRIGGER dbo.task127_review_failure ON dbo.reviews AFTER INSERT, UPDATE, DELETE AS
    BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted WHERE ${col}=${target.id})
    OR EXISTS (SELECT 1 FROM deleted WHERE ${col}=${target.id})
    BEGIN ;THROW 51022, 'Task127 scoped SQL failure', 1; END END`
    : 'DROP TRIGGER IF EXISTS dbo.task127_review_failure';
  py(`from app.db import engine\nwith engine.begin() as c:\n    c.exec_driver_sql(${JSON.stringify(sql)})`);
  ownsFault = active;
}
async function login(page, index) {
  await page.goto(urls[index] + '/login.html');
  await page.locator('#username').fill(`680000000${index}`);
  await page.locator('#password').fill('0000000000000'); // documented local mock only
  const pending = page.waitForResponse(r => r.url() === urls[index] + '/api/auth/login');
  await page.locator('#login-submit').click();
  assert.equal((await pending).status(), 200);
  await page.waitForURL('**/courses.html');
  return (await api(page, '/api/auth/me')).data;
}
async function api(page, endpoint, method = 'GET', data, anonymous = false) {
  return page.evaluate(async ({endpoint, method, data, anonymous}) => {
    const headers = {};
    if (!anonymous) headers.Authorization = `Bearer ${sessionStorage.getItem('access_token')}`;
    if (data !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(endpoint, {method, headers, ...(data === undefined ? {} : {body: JSON.stringify(data)})});
    return {status: r.status, data: r.status === 204 ? null : await r.json()};
  }, {endpoint, method, data, anonymous});
}
function pdf() {
  const rows = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 144 144] /Resources << >> >>'];
  let data = '%PDF-1.4\n'; const offsets = [];
  rows.forEach((row, i) => { offsets.push(data.length); data += `${i+1} 0 obj\n${row}\nendobj\n`; });
  const start = data.length;
  data += 'xref\n0 4\n0000000000 65535 f \n' + offsets.map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('');
  return Buffer.from(data + `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
}
const originalPdf = pdf();
async function publish(page, kind, index, course) {
  let r;
  if (kind === 'guide') {
    r = await api(page, '/api/guides', 'POST', {course_id: course, title: `${tag} guide ${index}`,
      academic_year: 2569, semester: 1, exam_period: 'midterm', topics: 'ข้อมูลทดสอบ U8', exam_format: 'objective', objective_count: 5});
  } else {
    r = await page.evaluate(async ({course, title, bytes}) => {
      const body = new FormData(); body.set('course_id', String(course)); body.set('title', title);
      body.set('file', new File([Uint8Array.from(bytes)], 'task127.pdf', {type: 'application/pdf'}));
      const r = await fetch('/api/summaries', {method: 'POST', body,
        headers: {Authorization: `Bearer ${sessionStorage.getItem('access_token')}`}});
      return {status: r.status, data: await r.json()};
    }, {course, title: `${tag} PDF ${index}`, bytes: [...originalPdf]});
  }
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const target = {id: r.data.id, kind, owner: index, course}; targets.push(target); return target;
}
const endpoint = t => `/api/${t.kind === 'guide' ? 'guides' : 'summaries'}/${t.id}/reviews`;
const action = (page, name) => page.locator(`dialog[open] [data-review-action="${name}"]`);
async function open(page, target, index) {
  const url = target.kind === 'guide' ? `/read-courses.html?source=api&guide=${target.id}&courseId=${target.course}` : `/read-summary.html?summary=${target.id}`;
  await page.goto(urls[index] + url);
  const trigger = page.locator(target.kind === 'guide' ? '.review-button' : '#summary-review');
  if (target.kind === 'summary') {
    await page.locator('#summary-pdf[src^="blob:"]').waitFor({state: 'visible'});
  }
  await trigger.focus();
  await trigger.click();
  await page.waitForFunction(() => {
    const d = document.querySelector('dialog[open]');
    return d && ['add','edit'].some(n => d.querySelector(`[data-review-action=${n}]`)?.checkVisibility())
      || Boolean(d?.querySelector('[data-review-owner-note]')?.checkVisibility());
  });
}
async function submit(page, target, method, rating, comment) {
  await page.locator(`#star-${rating}`).check();
  await page.locator('#review-comment').fill(comment);
  const pending = page.waitForResponse(r => r.request().method() === method && new URL(r.url()).pathname.includes('/reviews'));
  await page.locator('dialog[open] [type=submit]').click();
  const response = await pending;
  assert.equal(response.status(), method === 'POST' ? 201 : 200, await response.text());
  await action(page, 'edit').waitFor({state: 'visible'});
  return response.json();
}
async function shot(page, name) { await page.screenshot({path: path.join(evidence, name + '.png')}); }
async function removeTarget(page, t) {
  const url = t.kind === 'guide' ? `/api/my-guides/${t.id}` : `/api/summaries/${t.id}`;
  const r = await api(page, url, 'DELETE');
  assert.equal(r.status, t.kind === 'guide' ? 200 : 204, JSON.stringify(r.data));
  t.removed = true;
}

const cases = [];
async function tc(kind, code, expected, run) {
  const row = {tc:code,kind,expected,status:'RUNNING',level:'System/E2E',evidence:[]};cases.push(row);
  try { row.actual = await run() || expected; row.status='PASS';console.log(`PASS ${kind} ${code}`); }
  catch(error){row.status='FAIL';row.actual=error.message;throw error;}
}
async function screenshotTc(page,kind,code,suffix='') {
  const file=`${kind}-${code}${suffix}.png`;await shot(page,file.replace('.png',''));
  cases.findLast(row=>row.tc===code&&row.kind===kind).evidence.push(file);
}
async function own(page,rating,comment) {
  const entry=page.locator('dialog[open] [data-review-own-entry]');await entry.waitFor({state:'visible'});
  assert.equal(await entry.locator('[data-review-entry-stars]').getAttribute('aria-label'),`${rating} จาก 5 ดาว`);
  assert.equal(await entry.locator('[data-review-comment]').textContent(),comment || '');
}
async function deleteReviewUi(page,id) {
  await action(page,'edit').click();await action(page,'delete').click();
  const pending=page.waitForResponse(r=>r.request().method()==='DELETE'&&new URL(r.url()).pathname===`/api/reviews/${id}`);
  await action(page,'confirm-delete').click();assert.equal((await pending).status(),204);
  await action(page,'add').waitFor({state:'visible'});
}
function contentState() { const s=snapshot();delete s.tables.reviews;return s; }
async function main() {
  // All HTTP ports must belong to this project before any Login or fixture write.
  for(const [i,suffix] of ['', '-b', '-c'].entries()) {
    const front=`${project}-frontend${suffix}-1`;
    assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "com.docker.compose.project" }}',front],{encoding:'utf8'}).trim(),project);
    const ports=JSON.parse(execFileSync('docker',['inspect','--format','{{json .NetworkSettings.Ports}}',front],{encoding:'utf8'}));
    assert(ports['5000/tcp'].some(p=>p.HostPort===String(31800+i)&&['127.0.0.1','0.0.0.0'].includes(p.HostIp)));
    assert.equal(execFileSync('docker',['exec',front,'printenv','BACKEND_URL'],{encoding:'utf8'}).trim(),`http://backend${suffix}:8000`);
  }
  const expiringBackend = `${project}-backend-expiring-1`;
  const expiringRecord = JSON.parse(execFileSync('docker',['inspect','--format',
    '{"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"running":{{json .State.Running}},"ports":{{json .NetworkSettings.Ports}}}',expiringBackend],{encoding:'utf8'}));
  expiringRecord.mode=execFileSync('docker',['exec',expiringBackend,'printenv','TU_API_MODE'],{encoding:'utf8'}).trim();
  expiringRecord.ttl=execFileSync('docker',['exec',expiringBackend,'printenv','AUTH_SESSION_TTL_SECONDS'],{encoding:'utf8'}).trim();
  validateExpiringBackend(expiringRecord,project); // Before browser launch or any Login.
  assert.equal(py("from app.db import engine\nwith engine.connect() as c:\n    print(c.exec_driver_sql(\"SELECT OBJECT_ID('dbo.task127_review_failure','TR')\").scalar())"),'None');
  const browser=await chromium.launch({channel:process.env.TASK127_BROWSER||'chrome',headless:true});
  const contexts=await Promise.all([0,1,2].map(()=>browser.newContext({viewport:{width:1440,height:1000}})));
  const pages=await Promise.all(contexts.map(c=>c.newPage()));
  const environment={browser:browser.version(),expiringBackend:expiringRecord,docker:execFileSync('docker',['version','--format','{{.Server.Version}}'],{encoding:'utf8'}).trim(),
    sqlServer:py("from app.db import engine\nwith engine.connect() as c:\n    print(c.exec_driver_sql(\"SELECT CAST(SERVERPROPERTY('ProductVersion') AS VARCHAR)\").scalar())")};
  let baseline,completed=false,cleanup=false,expiredToken,primaryError;
  let cleanupOutcome={errors:[],remaining:[]};
  try {
    const users=[];for(let i=0;i<3;i++)users.push(await login(pages[i],i));
    assert.equal(new Set(users.map(u=>u.id)).size,3);
    // Real short-lived Bearer session, isolated from the three interactive users.
    const expiring=await contexts[0].request.post('http://127.0.0.1:34803/api/auth/login',
      {data:{username:'6800000003',password:'0000000000000'}});
    assert.equal(expiring.status(),200);expiredToken=(await expiring.json()).access_token;
    await new Promise(resolve=>setTimeout(resolve,1100));
    assert.equal((await contexts[0].request.get('http://127.0.0.1:34803/api/auth/me',{headers:{Authorization:'Bearer '+expiredToken}})).status(),401);
    baseline=snapshot();
    const course=(await api(pages[0],'/api/courses?search=CS261')).data.find(c=>c.course_code==='CS261');assert(course);
    for(const kind of ['guide','summary']) {
      const t=await publish(pages[0],kind,0,course.id);
      const control=await publish(pages[0],kind,0,course.id);
      const before=contentState();let review,otherReview;
      await tc(kind,'U8-TC01','5 stars with text persists; another logged-in user reads the same review',async()=>{
        await open(pages[1],t,1);await action(pages[1],'add').click();
        review=await submit(pages[1],t,'POST',5,'อ่านง่ายและตรงประเด็น');
        await open(pages[1],t,1);await own(pages[1],5,'อ่านง่ายและตรงประเด็น');
        await login(pages[1],1);await open(pages[1],t,1);await own(pages[1],5,'อ่านง่ายและตรงประเด็น');
        await open(pages[2],t,2);assert((await pages[2].locator('[data-review-entries]').innerText()).includes('อ่านง่ายและตรงประเด็น'));
        assert.deepEqual(sqlReview(review.id).slice(4),[5,'อ่านง่ายและตรงประเด็น']);
        await screenshotTc(pages[1],kind,'U8-TC01');
        return {reviewId:review.id,sql:sqlReview(review.id),visibleToThirdUser:true,reloaded:true,newSession:true};
      });
      await tc(kind,'U8-TC02','1 and 5 stars without comment save null and survive reload',async()=>{
        await deleteReviewUi(pages[1],review.id);
        const observed=[];for(const rating of [1,5]) {
          await open(pages[1],t,1);await action(pages[1],'add').click();
          const r=await submit(pages[1],t,'POST',rating,'');assert.equal(r.comment,null);
          await open(pages[1],t,1);await own(pages[1],rating,null);assert.deepEqual(sqlReview(r.id).slice(4),[rating,null]);
          observed.push({id:r.id,rating:r.rating,comment:r.comment,sql:sqlReview(r.id)});
          await screenshotTc(pages[1],kind,'U8-TC02',`-${rating}-stars`);await deleteReviewUi(pages[1],r.id);
        }
        return observed;
      });
      await tc(kind,'U8-TC03','UI blocks missing stars; POST and PUT reject missing/0/6/-1/2.5 and preserve data',async()=>{
        await open(pages[1],t,1);await action(pages[1],'add').click();
        let writes=0;const observe=req=>{if(req.method()==='POST'&&new URL(req.url()).pathname===endpoint(t))writes++;};
        pages[1].on('request',observe);
        try {
          await pages[1].locator('dialog[open] [type=submit]').click();
          assert.equal(await pages[1].locator('#star-1').evaluate(e=>e.validity.valueMissing),true);assert.equal(writes,0);
        }finally{pages[1].off('request',observe);}
        for(const rating of [undefined,0,6,-1,2.5]) {
          const r=await api(pages[1],endpoint(t),'POST',rating===undefined?{}:{rating});
          assert.equal(r.status,422);assert.equal(r.data.error.code,'INVALID_PARAMETERS');
          assert.equal((await api(pages[1],endpoint(t))).data.items.length,0);
        }
        review=await submit(pages[1],t,'POST',4,'เดิม');
        for(const rating of [undefined,0,6,-1,2.5]) {
          const r=await api(pages[1],`/api/reviews/${review.id}`,'PUT',rating===undefined?{}:{rating});
          assert.equal(r.status,422);assert.equal(r.data.error.code,'INVALID_PARAMETERS');
          assert.deepEqual(sqlReview(review.id).slice(4),[4,'เดิม']);
        }
        await open(pages[1],t,1);await own(pages[1],4,'เดิม');await screenshotTc(pages[1],kind,'U8-TC03');
        return {uiPostsWithoutRating:writes,rejectedRatings:['missing',0,6,-1,2.5],unchangedSql:sqlReview(review.id)};
      });
      await tc(kind,'U8-TC04','stars-only, text-only and both edits keep review ID/author/target; clearing text works',async()=>{
        const observed=[];for(const [rating,comment] of [[3,'เดิม'],[3,'ข้อความใหม่'],[4,'แก้ทั้งสอง'],[4,'']]) {
          await open(pages[1],t,1);await action(pages[1],'edit').click();
          const r=await submit(pages[1],t,'PUT',rating,comment);
          assert.equal(r.id,review.id);assert.equal(r.author.id,review.author.id);assert.equal(r.target_id,t.id);
          await open(pages[1],t,1);await own(pages[1],rating,comment);
          assert.deepEqual(sqlReview(r.id).slice(4),[rating,comment||null]);
          observed.push({id:r.id,author:r.author.id,rating:r.rating,comment:r.comment,target:r.target_id});
        }
        await screenshotTc(pages[1],kind,'U8-TC04');
        return observed;
      });
      await tc(kind,'U8-TC05','cancel preserves own review; delete removes only own while another reviewer and content remain',async()=>{
        await open(pages[2],t,2);await action(pages[2],'add').click();otherReview=await submit(pages[2],t,'POST',3,'รีวิวของ X');
        const otherBefore=sqlReview(otherReview.id);
        await open(pages[1],t,1);await action(pages[1],'edit').click();await action(pages[1],'delete').click();
        await action(pages[1],'cancel-delete').click();assert(sqlReview(review.id));
        await action(pages[1],'cancel-editor').click();const deletedId=review.id;await deleteReviewUi(pages[1],deletedId);
        assert.equal(sqlReview(deletedId),null);assert.deepEqual(sqlReview(otherReview.id),otherBefore);
        const current=await api(pages[1],endpoint(t));assert.equal(current.status,200);
        assert(!current.data.items.some(r=>r.id===deletedId));assert(current.data.items.some(r=>r.id===otherReview.id));
        await open(pages[1],t,1);assert.equal(await pages[1].locator('[data-review-own-entry] .review-entry').count(),0);
        const visible=pages[1].locator('[data-review-entries] .review-entry');assert.equal(await visible.count(),1);
        assert.equal(await visible.locator('[data-review-comment]').innerText(),'รีวิวของ X');
        assert.deepEqual(contentState(),before);await screenshotTc(pages[1],kind,'U8-TC05');
        if(kind==='summary') {
          const bytes=await pages[1].locator('#summary-pdf').evaluate(async frame=>[...new Uint8Array(await (await fetch(frame.src.split('#')[0])).arrayBuffer())]);
          assert.equal(digest(Buffer.from(bytes)),digest(originalPdf));
        }
        await action(pages[1],'add').click();review=await submit(pages[1],t,'POST',4,'หลังลบสร้างใหม่');
        return {deletedId,getStatus:current.status,remainingReviewIds:current.data.items.map(r=>r.id),visibleOtherReviews:1,otherReviewSql:sqlReview(otherReview.id),newReviewId:review.id,contentUnchanged:true};
      });
      await tc(kind,'U8-TC06','other user cannot mutate; missing and genuinely TTL-expired tokens reject POST/PUT/DELETE; forged author rejected',async()=>{
        const saved=sqlReview(review.id);
        for(const method of ['PUT','DELETE'])assert.equal((await api(pages[2],`/api/reviews/${review.id}`,method,method==='PUT'?{rating:1}:undefined)).status,403);
        for(const method of ['POST','PUT','DELETE']) {
          const url=method==='POST'?endpoint(t):`/api/reviews/${review.id}`;
          assert.equal((await api(pages[1],url,method,method==='DELETE'?undefined:{rating:5},true)).status,401);
          const r=await contexts[0].request.fetch('http://127.0.0.1:34803'+url,{method,
            headers:{Authorization:'Bearer '+expiredToken},...(method==='DELETE'?{}:{data:{rating:5}})});
          assert.equal(r.status(),401);
        }
        for(const method of ['POST','PUT'])for(const field of ['author_id','author']) {
          const r=await api(pages[1],method==='POST'?endpoint(t):`/api/reviews/${review.id}`,method,{rating:5,[field]:users[0].id});
          assert.equal(r.status,422);
        }
        assert.deepEqual(sqlReview(review.id),saved);await open(pages[2],t,2);
        assert((await pages[2].locator('[data-review-entries]').innerText()).includes('หลังลบสร้างใหม่'));
        await screenshotTc(pages[2],kind,'U8-TC06');
        return {thirdUser:users[2].id,unchangedSql:sqlReview(review.id),expiredSessionTtlSeconds:1,missingAndExpiredRejected:true};
      });
      await tc(kind,'U8-TC07','owner UI has no add button; direct self-review is 403 and does not write',async()=>{
        const saved=(await api(pages[0],endpoint(t))).data;
        await open(pages[0],t,0);assert.equal(await action(pages[0],'add').isVisible(),false);
        assert.equal(await pages[0].locator('[data-review-owner-note]').isVisible(),true);
        const r=await api(pages[0],endpoint(t),'POST',{rating:5});assert.equal(r.status,403);assert.equal(r.data.error.code,'SELF_REVIEW_FORBIDDEN');
        assert.deepEqual((await api(pages[0],endpoint(t))).data,saved);await screenshotTc(pages[0],kind,'U8-TC07');
        return {httpStatus:r.status,error:r.data.error.code,ownerAddButtonVisible:false};
      });
      await tc(kind,'U8-TC08','duplicate POST is 409 and preserves original review; works remain isolated',async()=>{
        const saved=sqlReview(review.id);
        const r=await api(pages[1],endpoint(t),'POST',{rating:1,comment:'ซ้ำ'});assert.equal(r.status,409);assert.equal(r.data.error.code,'REVIEW_ALREADY_EXISTS');
        assert.deepEqual(sqlReview(review.id),saved);
        assert.equal((await api(pages[1],endpoint(t))).data.items.filter(x=>x.author.id===users[1].id).length,1);
        assert.equal((await api(pages[1],endpoint(control))).data.items.length,0);
        await open(pages[1],t,1);await screenshotTc(pages[1],kind,'U8-TC08');
        return {httpStatus:r.status,error:r.data.error.code,unchangedSql:sqlReview(review.id),controlCount:0};
      });
      await tc(kind,'U8-TC09','SQL create/update/delete failure retains data and UI error; deleted target/review return 404',async()=>{
        await open(pages[2],control,2);await action(pages[2],'add').click();fault(control,true);
        try {
          await pages[2].locator('#star-5').check();const failed=pages[2].waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===endpoint(control));
          await pages[2].locator('dialog[open] [type=submit]').click();assert.equal((await failed).status(),503);
          await pages[2].waitForFunction(()=>document.querySelector('dialog[open]')?.getAttribute('aria-busy')==='false');
          assert.equal((await api(pages[2],endpoint(control))).data.items.length,0);
          assert.match(await pages[2].locator('[data-review-message]').innerText(),/ไม่สามารถ|ไม่สำเร็จ|ไม่ทราบ/);
        }finally{fault(control,false);}
        await open(pages[1],t,1);await action(pages[1],'edit').click();const saved=sqlReview(review.id);let refreshedReview;fault(t,true);
        try {
          await pages[1].locator('#star-1').check();await pages[1].locator('#review-comment').fill('ไม่ควรบันทึก');
          let sawFailure=false;const observe=r=>{if(r.status()===503&&r.request().method()==='PUT')sawFailure=true;};pages[1].on('response',observe);
          try {
            const fresh=pages[1].waitForResponse(r=>sawFailure&&r.request().method()==='GET'&&new URL(r.url()).pathname===endpoint(t));
            const fail=pages[1].waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname===`/api/reviews/${review.id}`);
            await pages[1].locator('dialog[open] [type=submit]').click();assert.equal((await fail).status(),503);
            const latest=await fresh;assert.equal(latest.status(),200);
            refreshedReview=(await latest.json()).items.find(r=>r.id===review.id);assert(refreshedReview);
            assert.deepEqual([refreshedReview.id,refreshedReview.rating,refreshedReview.comment],[saved[0],saved[4],saved[5]]);
          }finally{pages[1].off('response',observe);}
          await pages[1].waitForFunction(()=>document.querySelector('dialog[open]')?.getAttribute('aria-busy')==='false');
          assert.match(await pages[1].locator('[data-review-message]').innerText(),/โหลดข้อมูลล่าสุดแล้ว/);assert.deepEqual(sqlReview(review.id),saved);
          await action(pages[1],'cancel-editor').click();await own(pages[1],saved[4],saved[5]);
          await screenshotTc(pages[1],kind,'U8-TC09');
          await action(pages[1],'edit').click();
          await action(pages[1],'delete').click();const fail=pages[1].waitForResponse(r=>r.request().method()==='DELETE'&&new URL(r.url()).pathname===`/api/reviews/${review.id}`);
          await action(pages[1],'confirm-delete').click();assert.equal((await fail).status(),503);
          await pages[1].waitForFunction(()=>document.querySelector('dialog[open]')?.getAttribute('aria-busy')==='false');
          assert.match(await pages[1].locator('[data-review-message]').innerText(),/ไม่สามารถ|ไม่สำเร็จ|ไม่ทราบ/);
          assert.deepEqual(sqlReview(review.id),saved);
        }finally{fault(t,false);}
        assert.deepEqual(contentState(),before);await removeTarget(pages[0],t);
        assert.equal(sqlReview(review.id),null);assert.equal(sqlReview(otherReview.id),null);
        const missingCodes={};
        for(const method of ['GET','POST']) {
          const r=await api(pages[1],endpoint(t),method,method==='POST'?{rating:5}:undefined);assert.equal(r.status,404);
          assert.equal(r.data.error.code,`${kind.toUpperCase()}_NOT_FOUND`);missingCodes[method]=r.data.error.code;
        }
        for(const method of ['PUT','DELETE']) {
          const r=await api(pages[1],`/api/reviews/${review.id}`,method,method==='PUT'?{rating:5}:undefined);assert.equal(r.status,404);
          assert.equal(r.data.error.code,'REVIEW_NOT_FOUND');missingCodes[method]=r.data.error.code;
        }
        assert.equal((await api(pages[1],endpoint(control))).data.items.length,0);
        return {refreshedReview,originalVisibleAfterCancel:true,missingCodes,sqlCreateUpdateDeleteRejected:true,targetRemoved:t.removed,deletedReview:sqlReview(review.id),deletedOtherReview:sqlReview(otherReview.id),controlCount:0};
      });
    }
    completed=true;
  } catch(error){primaryError=error;console.error('System test failed:',error.message);}
  finally {
    cleanupOutcome=await cleanupFixtures(targets,t=>removeTarget(pages[0],t),()=>fault({id:1,kind:'guide'},false),()=>{
      if(baseline)assert.deepEqual(snapshot(),baseline);
    });
    try{await browser.close();}catch(error){cleanupOutcome.errors.push({phase:'browser',message:error.message});}
    cleanup=Boolean(baseline)&&cleanupOutcome.errors.length===0;
    try{writeFileSync(path.join(evidence,'system-results.json'),JSON.stringify({passed:completed&&cleanup,cleanupPassed:cleanup,
        primaryFailure:primaryError?{name:primaryError.name,message:primaryError.message}:null,
        cleanupErrors:cleanupOutcome.errors,remainingFixtures:cleanupOutcome.remaining,
        sourceSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),environment,project,date:new Date().toISOString(),
        authMode:'TU mock; three role accounts plus a real 1-second session for TTL expiry',uat:{status:'PENDING',reason:'No PO acceptance session performed'},cases},null,2)+'\n');
    }catch(error){cleanupOutcome.errors.push({phase:'report',message:error.message});}
  }
  if(cleanupOutcome.errors.length)console.error('Cleanup errors / remaining fixture IDs:',JSON.stringify(cleanupOutcome));
  throwFailure(primaryError,cleanupOutcome.errors);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
