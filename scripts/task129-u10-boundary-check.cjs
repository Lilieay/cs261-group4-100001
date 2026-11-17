// U10-TC01/TC05 checks against the isolated Task124 Docker stack.
// Set TASK129_APP_SHA and TASK129_PROJECT; evidence and Playwright paths are required.
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {mkdirSync, writeFileSync} = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.TASK129_PLAYWRIGHT || 'playwright-core');
const {validateStack} = require('./task124-guards.cjs');

const project = process.env.TASK129_PROJECT;
assert.match(project || '', /^cs261-task124-[a-z0-9-]+$/);
const appSha = process.env.TASK129_APP_SHA;
assert.match(appSha || '', /^[0-9a-f]{40}$/i, 'Set TASK129_APP_SHA to the tested application revision');
const evidenceDir = process.env.TASK129_EVIDENCE;
assert(evidenceDir, 'Set TASK129_EVIDENCE');
mkdirSync(evidenceDir, {recursive:true});
const backend = `${project}-backend-1`;
const baseUrl = 'http://127.0.0.1:29800';
const docker = (...args) => execFileSync('docker', args, {encoding:'utf8',timeout:30000}).trim();
const git = (...args) => execFileSync('git', args, {encoding:'utf8'}).trim();
const testRunnerSha = git('rev-parse','HEAD');
assert.equal(git('rev-parse',`${appSha}^{commit}`),appSha,'Application SHA must resolve to a commit');
execFileSync('git',['merge-base','--is-ancestor',appSha,testRunnerSha],{stdio:'ignore'});
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
const sameIds = (left,right) => assert.deepEqual([...left].sort((a,b)=>a-b),[...right].sort((a,b)=>a-b));

async function main() {
  const browser = await chromium.launch({headless:true,channel:process.env.TASK129_BROWSER || 'chrome'});
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  let userId, guideId, originalBookmarks, cleanupRequired=false;
  let tc05Visual, runError=null;
  const injectSecondPutFailure=process.env.TASK129_SIMULATE_SECOND_PUT_FAILURE==='1';
  const result = {appSha,testRunnerSha,runnerFile:'scripts/task129-u10-boundary-check.cjs',project,
    authMode:'TU mock account A; browser login; SQL Server real',failureInjection:injectSecondPutFailure,
    cases:[],cleanup:{status:'NOT_RUN'}};
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
    assert.equal(countBookmark(userId,guideId),0,'Guide must be unsaved before cleanup is registered');
    // Register cleanup before the first PUT: either PUT may commit before its response fails.
    cleanupRequired=true;

    const routePattern=`${baseUrl}/api/saved-items/guide/${guideId}`;
    let putCount=0, secondUpstreamStatus=null;
    const abortSecondResponse=async route=>{
      if(route.request().method()!=='PUT')return route.continue();
      putCount++;
      if(putCount===2) {
        const upstream=await route.fetch();
        secondUpstreamStatus=upstream.status();
        await route.abort('failed');
        return;
      }
      await route.continue();
    };
    if(injectSecondPutFailure)await page.route(routePattern,abortSecondResponse);
    const first=await api(`/api/saved-items/guide/${guideId}`,'PUT');
    assert.equal(first.status,200); assert.equal(first.body.saved,true);
    let second, secondError;
    try { second=await api(`/api/saved-items/guide/${guideId}`,'PUT'); }
    catch(error) { secondError=error; }
    if(injectSecondPutFailure) {
      await page.unroute(routePattern,abortSecondResponse);
      assert(secondError,'Second PUT browser response should fail in this injected scenario');
      assert.equal(putCount,2);
      assert.equal(secondUpstreamStatus,200,'Upstream SQL-backed PUT must commit before its response is dropped');
      assert.equal(countBookmark(userId,guideId),1,'Second PUT must have committed before simulated response failure');
      result.cases.push({id:'U10-TC01-CLEANUP-FAILURE-INJECTION',
        expected:'Second PUT response fails after upstream commit; cleanup still restores original bookmark baseline',
        actual:`second browser request failed; upstream status ${secondUpstreamStatus}; one relation existed before cleanup`,
        status:'PASS',guideId});
      await page.goto(`${baseUrl}/saved-courses.html`);
      await page.locator('#saved-list[aria-busy=false]').waitFor({state:'visible'});
      assert.equal(await page.locator(`.saved-card button[data-item-type="guide"][data-unsave="${guideId}"]`).count(),1);
      await page.screenshot({path:path.join(evidenceDir,'u10-TC01-second-put-failure.png'),fullPage:true});
    } else {
      assert.equal(second.status,200); assert.equal(second.body.saved,true);
      assert.equal(countBookmark(userId,guideId),1);
      assert.equal(query('SELECT COUNT(*) FROM dbo.guides WHERE id=?',[guideId])[0][0],1);
      const courseId=query('SELECT course_id FROM dbo.guides WHERE id=?',[guideId])[0][0];
      assert.equal(query('SELECT COUNT(*) FROM dbo.courses WHERE id=?',[courseId])[0][0],1);
      await page.goto(`${baseUrl}/saved-courses.html`);
      await page.locator('#saved-list[aria-busy=false]').waitFor({state:'visible'});
      assert.equal(await page.locator(`.saved-card button[data-item-type="guide"][data-unsave="${guideId}"]`).count(),1);
      await page.screenshot({path:path.join(evidenceDir,'u10-TC01.png'),fullPage:true});
      result.cases.push({id:'U10-TC01',expected:'PUT twice: 200 saved=true both times; one relation; Guide and Course remain',
        actual:`status ${first.status}/${second.status}; saved true/true; relation count 1; Guide and Course present`,
        status:'PASS',guideId,courseId});

      const missingId=query('SELECT ISNULL(MAX(id),0)+1000 FROM dbo.guides')[0][0];
      const missing=await api(`/api/saved-items/guide/${missingId}`,'PUT');
      assert.equal(missing.status,404); assert.equal(missing.body.error.code,'GUIDE_NOT_FOUND');
      const invalid=[];
      for (const value of ['0','-1','not-a-number']) {
        const response=await api(`/api/saved-items/guide/${value}`,'PUT');
        assert.equal(response.status,422,`Expected 422 for ${value}`);
        invalid.push({value,status:response.status,code:response.body.error.code});
      }
      sameIds(allBookmarks(userId),[...originalBookmarks,guideId]);
      tc05Visual={missingId,missing,invalid};
      result.cases.push({id:'U10-TC05',expected:'Missing target: 404 GUIDE_NOT_FOUND; invalid IDs: 422; no extra relation created',
        actual:`missing 404 GUIDE_NOT_FOUND; invalid IDs ${JSON.stringify(invalid)}; saved rows otherwise unchanged`,
        status:'PASS',missingId});
    }
  } catch(error) {
    runError=error;
    result.runError=String(error?.stack || error);
  } finally {
    try {
      if(cleanupRequired && userId!==undefined && guideId!==undefined) {
        const response=await api(`/api/saved-items/guide/${guideId}`,'DELETE');
        assert.equal(response.status,200,'Cleanup DELETE should succeed');
        const after=allBookmarks(userId);
        sameIds(after,originalBookmarks);
        result.cleanup={status:'PASS',baselineRestored:true,
          detail:'DELETE completed and saved_guides exactly matches pre-PUT baseline'};
      } else {
        result.cleanup={status:'NOT_REQUIRED',baselineRestored:null,
          detail:'No PUT was sent; cleanup was not registered'};
      }
    } catch(error) {
      result.cleanup={status:'FAIL',baselineRestored:false,detail:String(error?.stack || error)};
      runError ||= error;
    }

    if(tc05Visual) {
      const cleanupText=result.cleanup.status==='PASS' && result.cleanup.baselineRestored
        ? 'Cleanup verification: PASS — bookmark list matches its pre-test baseline.'
        : `Cleanup verification: ${result.cleanup.status} — ${result.cleanup.detail}`;
      try {
        await page.evaluate(({missingId,missing,invalid,cleanupText}) => {
          const rows=[[`Missing Guide ${missingId}`,missing.status,missing.body.error.code],
            ...invalid.map(i=>[`ID ${i.value}`,i.status,i.code])];
          document.body.innerHTML=`<main style="font:16px Arial,sans-serif;max-width:900px;margin:40px auto;color:#172033">
            <h1>U10-TC05 — ผลตอบกลับ API จริง</h1><p>PUT /api/saved-items/guide/{id} ผ่าน Frontend proxy และ Backend</p>
            <table style="border-collapse:collapse;width:100%"><thead><tr><th>ข้อมูลทดสอบ</th><th>HTTP</th><th>Error code</th></tr></thead>
            <tbody>${rows.map(r=>`<tr>${r.map(v=>`<td style="border:1px solid #9aa4b2;padding:12px">${v}</td>`).join('')}</tr>`).join('')}</tbody></table>
            <p>${cleanupText}</p></main>`;
        },{...tc05Visual,cleanupText});
        await page.screenshot({path:path.join(evidenceDir,'u10-TC05.png'),fullPage:true});
      } catch(error) {
        result.tc05ScreenshotError=String(error?.stack || error);
        runError ||= error;
      }
    }

    try { await page.close(); } catch(error) { result.pageCloseError=String(error); runError ||= error; }
    try { await browser.close(); } catch(error) { result.browserCloseError=String(error); runError ||= error; }
    result.completedAt=new Date().toISOString();
    const expectedCaseCount=injectSecondPutFailure?1:2;
    result.passed=!runError && result.cleanup.status==='PASS' && result.cleanup.baselineRestored
      && result.cases.length===expectedCaseCount && result.cases.every(c=>c.status==='PASS');
    const filename=injectSecondPutFailure?'cleanup-failure-results.json':'boundary-results.json';
    writeFileSync(path.join(evidenceDir,filename),JSON.stringify(result,null,2)+'\n');
  }
  if(runError)throw runError;
  assert.equal(result.passed,true,JSON.stringify(result));
  for(const c of result.cases)console.log(`PASS ${c.id}: ${c.actual}`);
  console.log(`Cleanup ${result.cleanup.status}: ${result.cleanup.detail}`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
