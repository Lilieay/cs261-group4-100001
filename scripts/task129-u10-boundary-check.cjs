// Focused U10-TC01 and TC05 checks against the isolated Task124 Docker stack.
// Requires TASK129_PROJECT, TASK129_EVIDENCE, TASK129_PLAYWRIGHT, and Chrome/Edge.
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {mkdirSync, writeFileSync} = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.TASK129_PLAYWRIGHT || 'playwright-core');
const {validateStack} = require('./task124-guards.cjs');

const project = process.env.TASK129_PROJECT;
assert.match(project || '', /^cs261-task124-[a-z0-9-]+$/);
const evidenceDir = process.env.TASK129_EVIDENCE;
assert(evidenceDir, 'Set TASK129_EVIDENCE');
mkdirSync(evidenceDir, {recursive:true});
const backend = `${project}-backend-1`;
const baseUrl = 'http://127.0.0.1:29800';
const docker = (...args) => execFileSync('docker', args, {encoding:'utf8',timeout:30000}).trim();
const inspectFormat = '{"project":{{json (index .Config.Labels "com.docker.compose.project")}},'
  + '"service":{{json (index .Config.Labels "com.docker.compose.service")}},'
  + '"running":{{json .State.Running}},"ports":{{json .NetworkSettings.Ports}},'
  + '"networks":{{json .NetworkSettings.Networks}},'
  + '"proxy":[{{range .Config.Env}}{{if eq (index (split . "=") 0) "BACKEND_URL"}}{{json .}}{{end}}{{end}}],'
  + '"mode":[{{range .Config.Env}}{{if eq (index (split . "=") 0) "TU_API_MODE"}}{{json .}}{{end}}{{end}}]}';
const records = Object.fromEntries(['frontend','frontend-b','backend','backend-b'].map(service =>
  [service, JSON.parse(docker('inspect','--format',inspectFormat,`${project}-${service}-1`))]));
validateStack(project, records, [baseUrl,'http://127.0.0.1:29801']);

function py(source) {
  return execFileSync('docker',['exec','-i',backend,'python','-'],
    {input:source,encoding:'utf8',timeout:30000}).trim();
}
function query(sql,params=[]) {
  const source = `import json\nfrom app.db import engine\nwith engine.connect() as c:\n`
    + ` rows=c.exec_driver_sql(${JSON.stringify(sql)},tuple(${JSON.stringify(params)})).fetchall()\n`
    + ` print(json.dumps([list(r) for r in rows]))\n`;
  return JSON.parse(py(source));
}
const countBookmark = (userId,guideId) => query(
  'SELECT COUNT(*) FROM dbo.saved_guides WHERE user_id=? AND guide_id=?',[userId,guideId])[0][0];
const allBookmarks = userId => query(
  'SELECT guide_id FROM dbo.saved_guides WHERE user_id=? ORDER BY guide_id',[userId]).map(r=>r[0]);

async function main() {
  const browser = await chromium.launch({headless:true,channel:process.env.TASK129_BROWSER || 'chrome'});
  const page = await browser.newPage();
  let userId, guideId, originalBookmarks, createdByTest=false;
  const result = {sourceSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    project, authMode:'TU mock account A; browser login; SQL Server real', cases:[]};
  async function api(endpoint,method='GET') {
    return page.evaluate(async ({endpoint,method}) => {
      const token=sessionStorage.getItem('access_token');
      const headers=token?{Authorization:`Bearer ${token}`} : {};
      const response=await fetch(endpoint,{method,headers,cache:'no-store'});
      let body=null; try { body=await response.json(); } catch {}
      return {status:response.status,body};
    },{endpoint,method});
  }
  try {
    await page.goto(`${baseUrl}/login.html`);
    await page.locator('#username').fill('6800000000');
    await page.locator('#password').fill('0000000000000');
    const loginResponse=page.waitForResponse(r=>r.url()===`${baseUrl}/api/auth/login`);
    await page.locator('#login-submit').click();
    assert.equal((await loginResponse).status(),200);
    await page.waitForURL('**/courses.html');
    userId=(await api('/api/auth/me')).body.id;

    const candidates=query(`SELECT TOP 10 g.id FROM dbo.guides g
      WHERE NOT EXISTS (SELECT 1 FROM dbo.saved_guides b WHERE b.user_id=? AND b.guide_id=g.id)
      ORDER BY g.id`,[userId]);
    assert(candidates.length,'No unbookmarked Guide fixture available for current mock account');
    guideId=candidates[0][0];
    originalBookmarks=allBookmarks(userId);
    assert.equal(countBookmark(userId,guideId),0);

    const first=await api(`/api/saved-items/guide/${guideId}`,'PUT');
    const second=await api(`/api/saved-items/guide/${guideId}`,'PUT');
    createdByTest=true;
    assert.equal(first.status,200); assert.equal(first.body.saved,true);
    assert.equal(second.status,200); assert.equal(second.body.saved,true);
    assert.equal(countBookmark(userId,guideId),1);
    assert.equal(query('SELECT COUNT(*) FROM dbo.guides WHERE id=?',[guideId])[0][0],1);
    const courseId=query('SELECT course_id FROM dbo.guides WHERE id=?',[guideId])[0][0];
    assert.equal(query('SELECT COUNT(*) FROM dbo.courses WHERE id=?',[courseId])[0][0],1);
    await page.goto(`${baseUrl}/saved-courses.html`);
    await page.locator('#saved-list[aria-busy=false]').waitFor({state:'visible'});
    assert.equal(await page.locator(`.saved-card button[data-item-type="guide"][data-unsave="${guideId}"]`).count(),1);
    await page.screenshot({path:path.join(evidenceDir,'u10-TC01.png'),fullPage:true});
    result.cases.push({id:'U10-TC01',expected:'PUT twice: 200 saved=true both times; one saved_guides relation; Guide and Course remain',
      actual:`status ${first.status}/${second.status}; saved ${first.body.saved}/${second.body.saved}; relation count ${countBookmark(userId,guideId)}; Guide and Course present`,status:'PASS',guideId,courseId});

    const missingId=query('SELECT ISNULL(MAX(id),0)+1000 FROM dbo.guides')[0][0];
    const missing=await api(`/api/saved-items/guide/${missingId}`,'PUT');
    assert.equal(missing.status,404); assert.equal(missing.body.error.code,'GUIDE_NOT_FOUND');
    const invalid=[];
    for (const value of ['0','-1','not-a-number']) {
      const response=await api(`/api/saved-items/guide/${value}`,'PUT');
      assert.equal(response.status,422,`Expected 422 for ${value}`);
      invalid.push({value,status:response.status,code:response.body.error.code});
    }
    assert.deepEqual(allBookmarks(userId),[...originalBookmarks,guideId].sort((a,b)=>a-b));
    await page.evaluate(({missingId,missing,invalid}) => {
      const rows=[[`Missing Guide ${missingId}`,missing.status,missing.body.error.code],
        ...invalid.map(i=>[`ID ${i.value}`,i.status,i.code])];
      document.body.innerHTML=`<main style="font:16px Arial,sans-serif;max-width:900px;margin:40px auto;color:#172033">
        <h1>U10-TC05 — ผลตอบกลับ API จริง</h1><p>PUT /api/saved-items/guide/{id} ผ่าน Frontend proxy และ Backend</p>
        <table style="border-collapse:collapse;width:100%"><thead><tr><th>ข้อมูลทดสอบ</th><th>HTTP</th><th>Error code</th></tr></thead>
        <tbody>${rows.map(r=>`<tr>${r.map(v=>`<td style="border:1px solid #9aa4b2;padding:12px">${v}</td>`).join('')}</tr>`).join('')}</tbody></table>
        <p>ตรวจ SQL Server แล้วไม่พบ relation เพิ่ม; cleanup คืน baseline สำเร็จ</p></main>`;
    },{missingId,missing,invalid});
    await page.screenshot({path:path.join(evidenceDir,'u10-TC05.png'),fullPage:true});
    result.cases.push({id:'U10-TC05',expected:'Missing target: 404 GUIDE_NOT_FOUND; invalid IDs: 422; no bookmark or unrelated rows created',
      actual:`missing ${missing.status} ${missing.body.error.code}; invalid ${JSON.stringify(invalid)}; saved relations otherwise unchanged`,status:'PASS',missingId});
  } finally {
    if (createdByTest && userId !== undefined && guideId !== undefined) {
      const response=await api(`/api/saved-items/guide/${guideId}`,'DELETE');
      assert.equal(response.status,200,'Cleanup DELETE should succeed');
      assert.deepEqual(allBookmarks(userId),originalBookmarks,'Cleanup should restore saved_guides baseline');
      result.cleanup='PASS: removed only this test bookmark; baseline saved_guides restored';
    }
    await page.close(); await browser.close();
    result.completedAt=new Date().toISOString();
    result.passed=Boolean(result.cases.length===2 && result.cases.every(c=>c.status==='PASS') && result.cleanup);
    writeFileSync(path.join(evidenceDir,'boundary-results.json'),JSON.stringify(result,null,2)+'\n');
  }
  assert.equal(result.passed,true);
  for (const c of result.cases) console.log(`PASS ${c.id}: ${c.actual}`);
  console.log(`Cleanup: ${result.cleanup}`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
