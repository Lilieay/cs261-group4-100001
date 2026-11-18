// Run against the isolated Task125 Compose project described in docs/U6/testing.
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {mkdirSync, writeFileSync} = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.TASK125_PLAYWRIGHT || 'playwright-core');

const project = process.env.TASK125_PROJECT;
assert.match(project || '', /^cs261-task125-[a-z0-9-]+$/);
const backend = `${project}-backend-1`;
const ownerUrl = 'http://127.0.0.1:27500';
const otherUrl = 'http://127.0.0.1:27501';
const evidence = process.env.TASK125_EVIDENCE;
const tag = `Task125 ${Date.now()}`;
const ownerUsername = '6800000000';
const password = '0000000000000'; // Documented local mock account only.
const digest = data => createHash('sha256').update(data).digest('hex');
const results = {sourceSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),startedAt:new Date().toISOString(),authMode:'TU mock',checks:[],requests:[],snapshots:[]};
const createdIds = new Set();
const report = message => {results.checks.push(message);console.log(`PASS ${message}`);};
function flush() {if(evidence){mkdirSync(evidence,{recursive:true});writeFileSync(path.join(evidence,'results.json'),JSON.stringify(results,null,2)+'\n');}}

function docker(...args) {
  return execFileSync('docker', args, {encoding: 'utf8', timeout: 20000});
}

function backendPython(input) {
  return execFileSync('docker', ['exec', '-i', backend, 'python', '-'],
    {input, encoding: 'utf8', timeout: 20000});
}

function inspect(container, format) {
  return docker('inspect', '--type', 'container', '--format', format, container).trim();
}

function verifyStack() {
  const projectLabel = '{{ index .Config.Labels "com.docker.compose.project" }}';
  const network = project + '_default';
  for (const [frontend, upstream, hostname, url] of [
    [project + '-frontend-1', backend, 'backend', ownerUrl],
    [project + '-frontend-b', project + '-backend-b', project + '-backend-b', otherUrl]
  ]) {
    for (const container of [frontend, upstream]) {
      assert.equal(inspect(container, projectLabel), project, container + ' is outside ' + project);
      assert.equal(inspect(container, '{{.State.Running}}'), 'true', container + ' is stopped');
    }
    const ports = JSON.parse(inspect(frontend, '{{json .NetworkSettings.Ports}}'));
    const {hostname: host, port} = new URL(url);
    assert(ports['5000/tcp']?.some(binding => binding.HostIp === host && binding.HostPort === port),
      frontend + ' does not own ' + url);
    assert.equal(docker('exec', frontend, 'printenv', 'BACKEND_URL').trim(), 'http://' + hostname + ':8000');
    assert.equal(docker('exec', upstream, 'printenv', 'TU_API_MODE').trim(), 'mock');
    const upstreamNetworks = JSON.parse(inspect(upstream, '{{json .NetworkSettings.Networks}}'));
    const upstreamIp = upstreamNetworks[network]?.IPAddress;
    assert(upstreamIp, upstream + ' is missing from ' + network);
    const resolvedIp = docker('exec', frontend, 'node', '-e',
      "require('node:dns').lookup(process.argv[1], (error, address) => { if (error) throw error; console.log(address); })",
      hostname).trim();
    assert.equal(resolvedIp, upstreamIp, frontend + ' resolves a different backend');
  }
}

function inspectSummary(id) {
  assert(Number.isSafeInteger(id) && id > 0);
  const input = `
import json
from app.config import PDF_STORAGE_ROOT
from app.db import engine
from app.services.summary_storage import LocalPdfStorage
with engine.connect() as connection:
    summary = connection.exec_driver_sql("SELECT id FROM dbo.summaries WHERE id = ?", (${id},)).first()
    file = connection.exec_driver_sql("SELECT storage_key FROM dbo.summary_files WHERE summary_id = ?", (${id},)).first()
    print(json.dumps({
        "summary": summary is not None, "file": file is not None,
        "key": file[0] if file else None,
        "summary_count": connection.exec_driver_sql("SELECT COUNT(*) FROM dbo.summaries").scalar(),
        "file_count": connection.exec_driver_sql("SELECT COUNT(*) FROM dbo.summary_files").scalar(),
        "objects": sorted(LocalPdfStorage(PDF_STORAGE_ROOT).list_private_objects())
    }))
`;
  const state=JSON.parse(backendPython(input));results.snapshots.push({id,...state});return state;
}

// Generate a valid PDF fixture with a checksum that can be compared to the served bytes.
function pdf(width, name) {
  const entries = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} 144] /Resources << >> >>`
  ];
  const offsets = [0];
  let data = '%PDF-1.4\n';
  for (const [i, entry] of entries.entries()) {
    offsets.push(data.length);
    data += `${i + 1} 0 obj\n${entry}\nendobj\n`;
  }
  const start = data.length;
  data += `xref\n0 4\n0000000000 65535 f \n${offsets.slice(1).map(value =>
    `${String(value).padStart(10, '0')} 00000 n \n`).join('')}`;
  data += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return {name, mimeType: 'application/pdf', buffer: Buffer.from(data)};
}

const original = pdf(144, 'task125-original.pdf');

async function login(page, url, username) {
  await page.goto(url + '/login.html');
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  const result = page.waitForResponse(r => r.url() === url + '/api/auth/login');
  await page.locator('#login-submit').click();
  const response = await result;
  assert.equal(response.status(), 200);
  await page.waitForURL('**/courses.html');
  const profile = await request(page, '/api/auth/me');
  assert.equal(profile.status, 200);
  assert.equal(profile.data.username, username);
  return profile.data.id;
}

async function request(page, apiPath, method = 'GET', fields, file) {
  const result = await page.evaluate(async ({apiPath, method, fields, file}) => {
    const headers = {};
    const token = sessionStorage.getItem('access_token');
    if (token) headers.Authorization = `Bearer ${token}`;
    const body = fields && new FormData();
    if (body) for (const [name, value] of Object.entries(fields)) body.set(name, value);
    if (file) body.set('file', new File([Uint8Array.from(file.bytes)], file.name, {type: file.mimeType}));
    const response = await fetch(apiPath, {method, headers, body, cache: 'no-store'});
    const type = response.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await response.json()
      : type.includes('application/pdf') ? Array.from(new Uint8Array(await response.arrayBuffer())) : null;
    return {status: response.status, contentType: type, data};
  }, {apiPath, method, fields, file: file && {...file, buffer: undefined, bytes: Array.from(file.buffer)}});
  if(method==='POST' && result.status===201 && Number.isSafeInteger(result.data?.id))createdIds.add(result.data.id);
  results.requests.push({method,path:apiPath,status:result.status,response:result.contentType.includes('application/pdf')?{sha256:digest(Buffer.from(result.data)),bytes:result.data.length}:result.data});
  return result;
}

async function submitSummary(page, url, title, file, createdIds) {
  await page.goto(url + '/upload-summary.html');
  const course = page.locator('#summary-course');
  await course.locator('option', {hasText: 'CS261'}).waitFor({state: 'attached'});
  await course.selectOption(await course.locator('option', {hasText: 'CS261'}).first().getAttribute('value'));
  await page.locator('#summary-title').fill(title);
  await page.locator('#summary-description').fill('');
  await page.locator('#summary-year').selectOption('2569');
  await page.locator('#summary-semester').selectOption('1');
  await page.locator('#summary-period').selectOption('midterm');
  await page.locator('#summary-file').setInputFiles(file);
  const result = page.waitForResponse(r => r.url() === url + '/api/summaries'
    && r.request().method() === 'POST');
  await page.locator('#summary-form button[type=submit]').click();
  const response = await result;
  const data = await response.json();
  if (response.status() === 201) {
    assert(Number.isSafeInteger(data.id) && data.id > 0, 'Publish response is missing its summary ID');
    createdIds.add(data.id);
  }
  return {status: response.status(), data};
}

async function screenshot(page, name) {
  if (!evidence) return;
  mkdirSync(evidence, {recursive: true});
  await page.screenshot({path: path.join(evidence, `${name}.png`)});
}


async function cleanupSummaries(owner, createdIds) {
  if (!createdIds.size) return;
  let id;
  try {
    for (id of createdIds) {
      const route = '/api/summaries/' + id;
      let response = await request(owner, route, 'DELETE');
      if (response.status === 401) {
        await login(owner, ownerUrl, ownerUsername);
        response = await request(owner, route, 'DELETE');
      }
      assert.equal(response.status, 204, JSON.stringify(response));
      const cleaned = inspectSummary(id);
      assert(!cleaned.summary && !cleaned.file);
      createdIds.delete(id);
    }
    assert.deepEqual(inspectSummary(id).objects, []);
    report('Cleanup removed the fixture SQL rows and PDF files');
  } catch (error) {
    const remaining = [...createdIds].join(', ') || 'none unconfirmed';
    throw new Error('Cleanup failed. Remaining summary IDs: ' + remaining, {cause: error});
  }
}

async function main() {
  verifyStack();
  report('Both browser ports and proxy backends belong to the selected mock Docker stack');
  const browser = await chromium.launch({channel: 'chrome', headless: true});
  const owner = await browser.newPage();
  const reader = await browser.newPage();
  results.browser=browser.version();
  const failures = [];
  let outsideCourse;
  try {
    const a = await login(owner, ownerUrl, ownerUsername);
    const b = await login(reader, otherUrl, '6800000001');
    assert.notEqual(a, b);
    const baseline=inspectSummary(1);
    assert.equal(baseline.summary_count,0,'Use a fresh isolated SQL/PDF volume');
    assert.equal(baseline.file_count,0);assert.deepEqual(baseline.objects,[]);
    const courseRows=(await request(owner,'/api/courses?search=CS261')).data;
    const mainCourse=courseRows.find(c=>c.course_code==='CS261');assert(mainCourse);
    const metadata={course_id:String(mainCourse.id),title:tag,academic_year:'2569',semester:'1',exam_period:'midterm'};
    const assertUnchanged=()=>assert.deepEqual(inspectSummary(1),baseline);
    const reject=async(fields,file,status,code)=>{
      const r=await request(owner,'/api/summaries','POST',fields,file);
      assert.equal(r.status,status,JSON.stringify(r));assert.equal(r.data.error.code,code);assertUnchanged();
    };
    for(const missing of ['title','whitespace','course','file']) {
      await owner.goto(ownerUrl+'/upload-summary.html');
      const select=owner.locator('#summary-course');await select.locator('option',{hasText:'CS261'}).waitFor({state:'attached'});
      if(missing!=='course')await select.selectOption(String(mainCourse.id));
      await owner.locator('#summary-title').fill(missing==='title'?'':missing==='whitespace'?'   ':tag);
      await owner.locator('#summary-year').selectOption('2569');await owner.locator('#summary-semester').selectOption('1');await owner.locator('#summary-period').selectOption('midterm');
      if(missing!=='file')await owner.locator('#summary-file').setInputFiles(original);
      const writes=[];const capture=req=>{if(req.method()==='POST')writes.push(req.url());};owner.on('request',capture);
      await owner.locator('#summary-form button[type=submit]').click();
      await owner.locator('#summary-form [aria-invalid="true"]').first().waitFor();
      assert.equal(writes.length,0);owner.off('request',capture);assertUnchanged();
      await screenshot(owner,'TC03-'+missing);
    }
    for(const change of [{title:''},{title:'   '},{course_id:''}])await reject({...metadata,...change},original,422,'INVALID_PARAMETERS');
    await reject(metadata,undefined,422,'INVALID_PARAMETERS');
    report('U6-TC03: missing/whitespace title, missing course and missing file rejected by UI without POST and by API without SQL/PDF changes');
    const badFiles=[{name:'not-pdf.txt',mimeType:'text/plain',buffer:Buffer.from('not a PDF')},{name:'disguised.pdf',mimeType:'application/pdf',buffer:Buffer.from('not a PDF')}];
    for(const file of badFiles){
      await owner.goto(ownerUrl+'/upload-summary.html');await owner.locator('#summary-file').setInputFiles(file);
      await owner.locator('#summary-form button[type=submit]').click();
      await owner.locator('#summary-file-error').waitFor({state:'visible'});await screenshot(owner,'TC04-'+file.name);
      await reject(metadata,file,422,'PDF_INVALID');
    }
    const tooLarge=await owner.evaluate(async fields=>{
      const form=new FormData();for(const [k,v] of Object.entries(fields))form.set(k,v);
      form.set('file',new File([new Uint8Array(15000001)],'oversize.pdf',{type:'application/pdf'}));
      const r=await fetch('/api/summaries',{method:'POST',headers:{Authorization:'Bearer '+sessionStorage.getItem('access_token')},body:form});return {status:r.status,data:await r.json()};
    },metadata);
    assert.equal(tooLarge.status,413);assert.equal(tooLarge.data.error.code,'PDF_TOO_LARGE');results.requests.push({method:'POST',path:'/api/summaries',scenario:'15000001 bytes',...tooLarge});assertUnchanged();
    report('U6-TC04: wrong extension/MIME, disguised content and PDF over 15000000 bytes rejected; no SQL/file residue');
    outsideCourse=Number(backendPython(`from app.db import SessionLocal
from app.models.course import Course
with SessionLocal.begin() as session:
    row=Course(course_code="MA125",course_name="Task125 isolated non-CS fixture")
    session.add(row)
    session.flush()
    print(row.id)
`).trim());
    await reject({...metadata,course_id:'2147483647'},original,404,'COURSE_NOT_FOUND');
    await reject({...metadata,course_id:String(outsideCourse)},original,404,'COURSE_NOT_FOUND');
    for(const key of ['owner_id','user_id'])await reject({...metadata,[key]:String(b)},original,422,'INVALID_PARAMETERS');
    report('U6-TC05: missing course, actual non-CS course and owner/user spoof rejected during POST with no SQL/PDF changes');
    const published = await submitSummary(owner, ownerUrl, tag, original, createdIds);
    assert.equal(published.status, 201, JSON.stringify(published.data));
    const row = published.data;
    assert.deepEqual([row.academic_year, row.semester, row.exam_period], [2569, 1, 'midterm']);
    assert.equal(row.owner.id, a);
    assert.equal(row.description,null);
    report('U6-TC02: optional description empty; POST201 stores null and valid PDF');
    const before = inspectSummary(row.id);
    assert(before.summary && before.file && before.objects.includes(before.key));
    const course = row.course;
    const query = new URLSearchParams({courseId: course.id, course: course.course_code, type: 'summaries'});
    await reader.goto(otherUrl + '/choose-courses.html?' + query);
    await reader.locator("article.document-card").filter({hasText: tag}).getByRole("link", {name: "ดูเอกสาร"}).click();
    await reader.locator('#summary-pdf[src^="blob:"]').waitFor({state: 'attached'});
    const route = '/api/summaries/' + row.id;
    async function verifyPdf() {
      const response = await request(reader, route + '/file');
      assert.equal(response.status, 200);
      assert.equal(digest(Buffer.from(response.data)), digest(original.buffer));
    }
    await verifyPdf();
    await screenshot(reader, '01-read-pdf');
    report('UI publish, course list, second account and matching PDF bytes');
    await reader.reload();await reader.locator('#summary-pdf[src^="blob:"]').waitFor({state:'attached'});await verifyPdf();
    report('U6-TC01: other account opens the exact PDF through course UI, reloads it and checksum matches');
    const emptyCourse=(await request(owner,'/api/courses?search=CS104')).data.find(c=>c.course_code==='CS104');assert(emptyCourse);
    await reader.goto(otherUrl+'/choose-courses.html?'+new URLSearchParams({courseId:String(emptyCourse.id),course:'CS104',type:'summaries'}));
    await reader.getByText('ไม่พบสรุปในรายวิชานี้',{exact:true}).waitFor();
    assert.deepEqual((await request(reader,`/api/courses/${emptyCourse.id}/summaries`)).data.items,[]);
    assert((await request(reader,`/api/courses/${course.id}/summaries`)).data.items.every(item=>item.course.id===course.id));
    await screenshot(reader,'TC08-other-course-empty');
    report('U6-TC08: CS261 contains its PDF; CS104 stays empty in UI/API without cross-course items');


    const anonymous = await browser.newPage();
    await anonymous.goto(otherUrl + '/login.html');
    assert.equal((await request(anonymous, route + '/file')).status, 401);
    for(const tokenMode of ['missing','invalid','revoked']) {
      if(tokenMode==='revoked'){await login(anonymous,otherUrl,'6800000001');await request(anonymous,'/api/auth/logout','POST');}
      else await anonymous.evaluate(mode=>{sessionStorage.removeItem('access_token');if(mode==='invalid')sessionStorage.setItem('access_token','invalid-task125');},tokenMode);
      for(const target of [`/api/courses/${course.id}/summaries`,route,route+'/file']) {
        const rejected=await request(anonymous,target);assert.equal(rejected.status,401);assert.equal(rejected.data.error.code,'AUTH_REQUIRED');
      }
    }
    report('U6-TC06: missing, invalid and revoked sessions cannot read course list, summary details or PDF');
    const expiryBackend=project+'-backend-expiring';
    assert.equal(inspect(expiryBackend,'{{ index .Config.Labels "com.docker.compose.project" }}'),project);
    assert.equal(docker('exec',expiryBackend,'printenv','AUTH_SESSION_TTL_SECONDS').trim(),'1');
    const expiredBase='http://127.0.0.1:28526';
    const expiryLogin=await fetch(expiredBase+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'6800000002',password})});
    assert.equal(expiryLogin.status,200);const expiryToken=(await expiryLogin.json()).access_token;
    await new Promise(resolve=>setTimeout(resolve,1200));
    for(const target of [`/api/courses/${course.id}/summaries`,route,route+'/file']){
      const r=await fetch(expiredBase+target,{headers:{Authorization:'Bearer '+expiryToken}});const data=await r.json();assert.equal(r.status,401);assert.equal(data.error.code,'AUTH_REQUIRED');
      results.requests.push({method:'GET',path:target,auth:'expired 1-second session',status:r.status,response:data});
    }
    await anonymous.goto(otherUrl+'/read-summary.html?summary='+row.id);await anonymous.waitForURL('**/login.html');
    report('U6-TC06: actual 1-second session expires and all protected API reads return401; unauthenticated reader redirects to login');

    const unknownCourse = await request(reader, '/api/summaries', 'POST', {
      course_id: '2147483647', title: tag + ' missing course', academic_year: '2569', semester: '1', exam_period: 'midterm'
    }, original);
    assert.equal(unknownCourse.status, 404);

    async function verifyPublishFailure(title, screenshotName, expectedCode) {
      const failure = await submitSummary(owner, ownerUrl, title, original, createdIds);
      assert.equal(failure.status, 503, JSON.stringify(failure.data));
      if (expectedCode) assert.equal(failure.data.error.code, expectedCode);
      const error = owner.locator('#summary-upload-error');
      await error.waitFor({state: 'visible'});
      assert.match(await error.innerText(), /เผยแพร่สรุปไม่สำเร็จ/);
      assert.equal(await owner.locator('#summary-success').evaluate(dialog => dialog.open), false);
      assert.deepEqual(inspectSummary(row.id), before, title + ' changed SQL rows or PDF files');
      await screenshot(owner, screenshotName);
    }
    const sqlFailureTitle = tag + ' SQL failure';
    const changeTrigger = sql => backendPython(`from app.db import engine
with engine.begin() as connection:
    connection.exec_driver_sql(${JSON.stringify(sql)})
`);
    changeTrigger(`CREATE TRIGGER dbo.task125_test_publish ON dbo.summaries AFTER INSERT AS
BEGIN IF EXISTS (SELECT 1 FROM inserted WHERE title = '${sqlFailureTitle}')
BEGIN ;THROW 51020, 'Task125 publish failure', 1; END END`);
    try {
      await verifyPublishFailure(sqlFailureTitle, '02-sql-publish-failure');
      report('SQL publish failure shows a form error, leaves the success dialog closed and preserves SQL/PDF');
    } finally {
      changeTrigger('DROP TRIGGER IF EXISTS dbo.task125_test_publish');
    }
    const storage = docker('exec', backend, 'printenv', 'PDF_STORAGE_ROOT').trim();
    assert.equal(storage, '/app/data/pdfs');
    const mode = docker('exec', backend, 'stat', '-c', '%a', storage).trim();
    docker('exec', '-u', '0', backend, 'chmod', '0555', storage);
    try {
      await verifyPublishFailure(tag + ' storage failure', '03-storage-publish-failure', 'STORAGE_UNAVAILABLE');
      report('Storage publish failure shows a form error, leaves the success dialog closed and preserves SQL/PDF');
    } finally {
      docker('exec', '-u', '0', backend, 'chmod', mode, storage);
    }
    report('Unauthenticated PDF read and unknown course publish are rejected');

    docker('restart', backend);
    execFileSync('docker',['exec',backend,'curl','--retry','30','--retry-delay','1','--retry-connrefused','--fail','--silent','http://127.0.0.1:8000/'],{stdio:'ignore',timeout:45000});
    assert.equal(await login(owner, ownerUrl, ownerUsername), a);
    const detail = await request(owner, route);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.title, tag);
    assert.deepEqual(inspectSummary(row.id), before);
    await verifyPdf();
    const reopened = await request(owner, route + '/file');
    assert.equal(reopened.status, 200);
    assert.equal(digest(Buffer.from(reopened.data)), digest(original.buffer));
    report('Backend restarted with existing volume, fresh login retrieves unchanged metadata and PDF');
  } catch (error) {
    failures.push(error);
  }
  await cleanupSummaries(owner, createdIds).catch(error => failures.push(error));
  if(outsideCourse)try{backendPython(`from app.db import engine
with engine.begin() as connection:
    connection.exec_driver_sql("DELETE FROM dbo.courses WHERE id=? AND course_code='MA125'",(${outsideCourse},))
`);}catch(error){failures.push(error);}
  results.finishedAt=new Date().toISOString();results.cleanup=failures.length===0;

  await browser.close().catch(error => failures.push(error));
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, failures[0].message);
}
main().then(()=>{results.status='PASS';flush();}).catch(error=>{results.status='FAIL';results.error=error.message;flush();console.error(error);process.exitCode=1;});
