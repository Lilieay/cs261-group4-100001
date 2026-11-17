// Run against the isolated Task126 Compose project described in docs/U7/testing.
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {mkdirSync, writeFileSync} = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.TASK126_PLAYWRIGHT || 'playwright');

const project = process.env.TASK126_PROJECT;
assert.match(project || '', /^cs261-task126-[a-z0-9-]+$/);
const backend = `${project}-backend-1`;
const ownerUrl = 'http://127.0.0.1:25626';
const otherUrl = 'http://127.0.0.1:25627';
const evidence = process.env.TASK126_EVIDENCE;
const mine = '/shared-courses.html?type=summaries';
const tag = `Task126 ${Date.now()}`;
const password = '0000000000000'; // Documented local mock account only.
const digest = data => createHash('sha256').update(data).digest('hex');
const results = {sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim(), startedAt: new Date().toISOString(), authMode: 'mock', checks: [], requests: [], snapshots: []};
const report = message => { results.checks.push({message, at:new Date().toISOString()}); console.log(`PASS ${message}`); };
function flush() { if (evidence) { mkdirSync(evidence,{recursive:true}); writeFileSync(path.join(evidence,'results.json'),JSON.stringify(results,null,2)); } }


function docker(...args) {
  return execFileSync('docker', args, {encoding: 'utf8', timeout: 20000});
}

function backendPython(input) {
  return execFileSync('docker', ['exec', '-i', backend, 'python', '-'],
    {input, encoding: 'utf8', timeout: 20000});
}

assert.equal(docker('inspect', '--format',
  '{{ index .Config.Labels "com.docker.compose.project" }}', backend).trim(), project);
assert.equal(docker('exec', backend, 'printenv', 'TU_API_MODE').trim(), 'mock');

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
        "objects": sorted(LocalPdfStorage(PDF_STORAGE_ROOT).list_private_objects())
    }))
`;
  const snapshot = JSON.parse(backendPython(input));
  results.snapshots.push({id, ...snapshot});
  return snapshot;
}

function setDbFault(id, active) {
  assert(Number.isSafeInteger(id) && id > 0);
  const sql = active
    ? `CREATE TRIGGER dbo.task126_test_summary_file ON dbo.summary_files AFTER UPDATE AS
       BEGIN IF EXISTS (SELECT 1 FROM inserted WHERE summary_id = ${id}) BEGIN
       ;THROW 51021, 'Task126 simulated test update failure', 1; END END`
    : 'DROP TRIGGER IF EXISTS dbo.task126_test_summary_file';
  backendPython(`from app.db import engine
with engine.begin() as connection:
    connection.exec_driver_sql(${JSON.stringify(sql)})
`);
}

// A tiny PDF with valid offsets. Changing the page width changes its checksum.
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

const original = pdf(144, 'task126-original.pdf');
const replacement = pdf(240, 'task126-replacement.pdf');
const failedReplacement = pdf(320, 'task126-failure.pdf');

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
    return {status: response.status, data};
  }, {apiPath, method, fields, file: file && {...file, buffer: undefined, bytes: Array.from(file.buffer)}});
  results.requests.push({origin:new URL(page.url()).origin, method, path:apiPath, status:result.status, response: Array.isArray(result.data) ? {sha256:digest(Buffer.from(result.data)),bytes:result.data.length} : result.data});
  return result;
}

async function publish(page, url, title, file) {
  await page.goto(url + '/upload-summary.html');
  const course = page.locator('#summary-course');
  await course.locator('option', {hasText: 'CS261'}).waitFor({state: 'attached'});
  await course.selectOption(await course.locator('option', {hasText: 'CS261'}).first().getAttribute('value'));
  await page.locator('#summary-title').fill(title);
  await page.locator('#summary-description').fill('ข้อมูลทดสอบ Task126');
  await page.locator('#summary-year').selectOption('2569');
  await page.locator('#summary-semester').selectOption('1');
  await page.locator('#summary-period').selectOption('midterm');
  await page.locator('#summary-file').setInputFiles(file);
  const result = page.waitForResponse(r => r.url() === url + '/api/summaries'
    && r.request().method() === 'POST');
  await page.locator('#summary-form button[type=submit]').click();
  const response = await result;
  assert.equal(response.status(), 201, await response.text());
  const row = await response.json();
  assert.deepEqual([row.academic_year, row.semester, row.exam_period], [2569, 1, 'midterm']);
  return row;
}

function card(page, id) {
  return page.locator(`article.summary-owned-card:has([data-summary-id="${id}"])`);
}

async function screenshot(page, name) {
  if (!evidence) return;
  mkdirSync(evidence, {recursive: true});
  await page.screenshot({path: path.join(evidence, `${name}.png`)});
}

async function edit(page, row) {
  await card(page, row.id).locator('[data-summary-action=edit]').click();
  await page.locator('#summary-editor').waitFor();
}

async function save(page, id) {
  const result = page.waitForResponse(r => new URL(r.url()).pathname === `/api/summaries/${id}`
    && r.request().method() === 'PUT');
  await page.locator('#summary-edit-save').click();
  const response = await result;
  results.requests.push({method:'PUT',path:`/api/summaries/${id}`,status:response.status(),response:await response.json(),scenario:'UI save'});
  return response;
}

async function assertPdf(page, id, expected) {
  const result = await request(page, `/api/summaries/${id}/file`);
  assert.equal(result.status, 200);
  assert.equal(digest(Buffer.from(result.data)), digest(expected.buffer));
}

async function main() {
  const browser = await chromium.launch({channel: process.env.TASK126_BROWSER || 'chrome', headless: true});
  results.browser = browser.version();
  const ownerContext = await browser.newContext({viewport:{width:1440,height:1080}});
  const owner = await ownerContext.newPage();
  const otherContext = await browser.newContext({viewport:{width:1440,height:1080}});
  const other = await otherContext.newPage();
  owner.setDefaultTimeout(15000);
  other.setDefaultTimeout(15000);
  let owned;
  let control;
  try {
    await owner.goto(ownerUrl + '/login.html');
    assert.equal((await request(owner, '/api/my-summaries')).status, 401);
    const invalidAuth = await owner.evaluate(async () => {
      const r = await fetch('/api/my-summaries',{headers:{Authorization:'Bearer invalid-task126-test-token'}});
      return {status:r.status,data:await r.json()};
    });
    assert.equal(invalidAuth.status,401); assert.equal(invalidAuth.data.error.code,'AUTH_REQUIRED');
    results.requests.push({method:'GET',path:'/api/my-summaries',auth:'invalid',...invalidAuth});
    const ownerId = await login(owner, ownerUrl, '6800000000');
    const otherId = await login(other, otherUrl, '6800000001');
    assert.notEqual(ownerId, otherId);
    await owner.goto(ownerUrl + mine);
    await owner.getByText('คุณยังไม่ได้แบ่งปันสรุป PDF').waitFor();
    assert.equal(await owner.getByRole('link', {name: 'แบ่งปันสรุป', exact: true}).getAttribute('href'), 'upload-summary.html');
    report('TC02 empty state; anonymous request rejected; two mock accounts have distinct DB IDs');


    owned = await publish(owner, ownerUrl, `${tag} owner`, original);
    control = await publish(other, otherUrl, `${tag} other`, original);
    assert.equal(owned.owner.id, ownerId);
    assert.equal(control.owner.id, otherId);
    await owner.goto(ownerUrl + mine);
    await card(owner, owned.id).waitFor();
    assert.equal(await card(owner, control.id).count(), 0);
    await screenshot(owner, '01-owned-list');
    await card(owner, owned.id).locator('a[href^="read-summary.html?"]').click();
    await owner.locator('#summary-viewer').waitFor();
    assert.equal(await owner.locator('#summary-reading-title').textContent(), owned.title);
    assert.match(await owner.locator('#summary-pdf').getAttribute('src'), /^blob:/);
    await assertPdf(owner, owned.id, original);
    await screenshot(owner, '02-open-pdf');
    await owner.locator('#summary-back').click();
    report('TC01 browser opened the correct PDF; owned list excludes other account');

    const route = `/api/summaries/${owned.id}`;
    const change = {course_id: String(owned.course.id), title: 'Unauthorised edit'};
    const deniedBefore = inspectSummary(owned.id);
    const persistedOwner = (await request(owner,route)).data;
    for (const method of ['PUT','DELETE']) {
      const denied = await request(other, route, method, method === 'PUT' ? change : undefined);
      assert.equal(denied.status,403); assert.equal(denied.data.error.code,'SUMMARY_FORBIDDEN');
    }
    assert.deepEqual((await request(owner, route)).data, persistedOwner);
    assert.deepEqual(inspectSummary(owned.id),deniedBefore);
    await other.goto(otherUrl + mine);
    await card(other,control.id).waitFor();
    assert.equal(await card(other,owned.id).count(),0);
    await screenshot(other,'05-tc07-other-account');
    await assertPdf(other, owned.id, original);
    report('TC07 second account can read published PDF but cannot edit or delete it');

    const before = inspectSummary(owned.id);
    assert(before.summary && before.file && before.objects.includes(before.key));
    await edit(owner, owned);
    const writes = [];
    owner.on('request', req => { if (req.method() === 'PUT') writes.push(req.url()); });
    await owner.locator('#summary-edit-title').fill('   ');
    await owner.locator('#summary-edit-save').click();
    await owner.locator('#summary-edit-title-error').waitFor();
    assert.equal(writes.length, 0);
    assert.equal((await request(owner, route)).data.title, owned.title);
    report('TC04 blank title prevented the update');

    const nextCourse = owner.locator(`#summary-edit-course option:not([value="${owned.course.id}"])`).first();
    await nextCourse.waitFor({state: 'attached'});
    const nextCourseId = Number(await nextCourse.getAttribute('value'));
    assert(nextCourseId > 0);
    await owner.locator('#summary-edit-course').selectOption(String(nextCourseId));
    await owner.locator('#summary-edit-title').fill(`${tag} moved`);
    await owner.locator('#summary-edit-description').fill('แก้ชื่อและย้ายวิชา');
    assert.equal((await save(owner, owned.id)).status(), 200);
    await owner.locator('#summary-editor').waitFor({state: 'hidden'});
    await assertPdf(owner, owned.id, original);
    assert.equal(inspectSummary(owned.id).key, before.key);
    const list = courseId => request(owner, `/api/courses/${courseId}/summaries`);
    assert(!(await list(owned.course.id)).data.items.some(item => item.id === owned.id));
    assert((await list(nextCourseId)).data.items.some(item => item.id === owned.id));
    await edit(owner, owned);
    await owner.locator('#summary-edit-file').setInputFiles(replacement);
    assert.equal((await save(owner, owned.id)).status(), 200);
    await owner.locator('#summary-editor').waitFor({state: 'hidden'});
    await assertPdf(owner, owned.id, replacement);
    const after = inspectSummary(owned.id);
    assert.notEqual(after.key, before.key);
    assert(after.objects.includes(after.key) && !after.objects.includes(before.key));
    const updated = (await request(owner, route)).data;
    assert.deepEqual([updated.academic_year, updated.semester, updated.exam_period], [2569, 1, 'midterm']);
    await owner.reload();
    await card(owner, owned.id).getByText(`${tag} moved`).waitFor();
    await owner.locator('[data-logout]').click();
    await owner.waitForURL('**/login.html');
    await login(owner, ownerUrl, '6800000000');
    await owner.goto(ownerUrl + mine);
    await card(owner, owned.id).getByText(`${tag} moved`).waitFor();
    report('TC03 title/course persisted after reload and login; old PDF retained for metadata edit; new PDF replaces bytes and exam metadata survives');

    await edit(owner, owned);
    await owner.locator('#summary-edit-title').fill(`${tag} must not persist`);
    await owner.locator('#summary-edit-file').setInputFiles(failedReplacement);
    const storageRoot = docker('exec', backend, 'printenv', 'PDF_STORAGE_ROOT').trim();
    assert.equal(storageRoot, '/app/data/pdfs');
    const mode = docker('exec', backend, 'stat', '-c', '%a', storageRoot).trim();
    docker('exec', '-u', '0', backend, 'chmod', '0555', storageRoot);
    try {
      const response = await save(owner, owned.id);
      assert.equal(response.status(), 503);
      assert.equal((await response.json()).error.code, 'STORAGE_UNAVAILABLE');
      await owner.locator('#summary-editor-error').waitFor();
      assert.equal(await owner.locator('#summary-edit-title').inputValue(), `${tag} must not persist`);
      assert.equal(await owner.locator('#summary-edit-file').evaluate(input => input.files[0]?.name), failedReplacement.name);
      await screenshot(owner, '03-storage-failure');
    } finally {
      docker('exec', '-u', '0', backend, 'chmod', mode, storageRoot);
    }
    await assertPdf(owner, owned.id, replacement);
    assert.equal((await request(owner, route)).data.title, updated.title);
    assert.deepEqual(inspectSummary(owned.id), after);
    await owner.locator('#summary-edit-cancel').click();
    report('TC09 real volume write failure gives 503, preserves draft and keeps original DB metadata/PDF');

    await edit(owner, owned);
    await owner.locator('#summary-edit-title').fill(`${tag} SQL rollback`);
    await owner.locator('#summary-edit-file').setInputFiles(failedReplacement);
    setDbFault(owned.id, true);
    try {
      const response = await save(owner, owned.id);
      assert.equal(response.status(), 503);
      assert.equal((await response.json()).error.code, 'STORAGE_UNAVAILABLE');
      await owner.locator('#summary-editor-error').waitFor();
    } finally {
      setDbFault(owned.id, false);
    }
    assert.equal((await request(owner, route)).data.title, updated.title);
    await assertPdf(owner, owned.id, replacement);
    assert.deepEqual(inspectSummary(owned.id), after);
    await screenshot(owner,'06-tc08-update-failure');
    await owner.locator('#summary-edit-cancel').click();
    report('TC08 SQL Server rejected the file UPDATE; metadata rolled back and staged PDF was cleaned');

    const deleteTrigger = 'task126_test_summary_delete';
    await card(owner, owned.id).locator('[data-summary-action=delete]').click();
    backendPython(`from app.db import engine
with engine.begin() as connection:
    connection.exec_driver_sql("CREATE TRIGGER dbo.${deleteTrigger} ON dbo.summaries AFTER DELETE AS BEGIN IF EXISTS (SELECT 1 FROM deleted WHERE id = ${owned.id}) BEGIN ;THROW 51026, 'Task126 simulated delete failure', 1; END END")
`);
    try {
      const pending = owner.waitForResponse(r=>new URL(r.url()).pathname===route && r.request().method()==='DELETE');
      await owner.locator('#summary-delete-confirm').click();
      const response = await pending;
      assert.equal(response.status(),503); assert.equal((await response.json()).error.code,'STORAGE_UNAVAILABLE');
      results.requests.push({method:'DELETE',path:route,status:response.status(),response:await response.json(),scenario:'SQL delete failure'});
      await owner.locator('#summary-delete-dialog').waitFor({state:'hidden'});
      await owner.locator('#summary-management-status').getByText('ยังยืนยันผลไม่ได้ กรุณาตรวจรายการล่าสุดก่อนลองอีกครั้ง',{exact:true}).waitFor();
      await card(owner,owned.id).waitFor();
      await screenshot(owner,'07-tc08-delete-failure');
    } finally {
      backendPython(`from app.db import engine
with engine.begin() as connection:
    connection.exec_driver_sql("DROP TRIGGER IF EXISTS dbo.${deleteTrigger}")
`);
    }
    assert.deepEqual((await request(owner,route)).data,updated);
    assert.deepEqual(inspectSummary(owned.id),after);
    await assertPdf(owner,owned.id,replacement);
    await owner.reload(); await card(owner,owned.id).getByText(updated.title).waitFor();
    report('TC08 DELETE rejected by real SQL trigger gives 503; DB metadata, file row and PDF checksum unchanged after reload');

    const second = await owner.context().newPage();
    for (const action of ['edit','delete']) {
      const stale = await publish(owner,ownerUrl,`${tag} stale ${action}`,original);
      try {
        await owner.goto(ownerUrl+mine); await card(owner,stale.id).waitFor();
        if (action==='edit') {
          await edit(owner,stale); await owner.locator('#summary-edit-title').fill(`${tag} never resurrect`);
        } else await card(owner,stale.id).locator('[data-summary-action=delete]').click();
        // A new tab copies the owner's session at creation only; set it explicitly in this test tab.
        await second.goto(ownerUrl+'/courses.html');
        const token = await owner.evaluate(()=>sessionStorage.getItem('access_token'));
        await second.evaluate(t=>sessionStorage.setItem('access_token',t),token);
        await second.goto(ownerUrl+mine); await card(second,stale.id).waitFor();
        await card(second,stale.id).locator('[data-summary-action=delete]').click();
        const deleted = second.waitForResponse(r=>new URL(r.url()).pathname===`/api/summaries/${stale.id}` && r.request().method()==='DELETE');
        await second.locator('#summary-delete-confirm').click(); assert.equal((await deleted).status(),204);
        const method = action==='edit'?'PUT':'DELETE';
        const pending = owner.waitForResponse(r=>new URL(r.url()).pathname===`/api/summaries/${stale.id}` && r.request().method()===method);
        await owner.locator(action==='edit'?'#summary-edit-save':'#summary-delete-confirm').click();
        const response = await pending; assert.equal(response.status(),404); assert.equal((await response.json()).error.code,'SUMMARY_NOT_FOUND');
        results.requests.push({method,path:`/api/summaries/${stale.id}`,status:response.status(),response:await response.json(),scenario:'stale UI'});
        await owner.getByText('ไม่พบสรุป', {exact:true}).waitFor();
        await screenshot(owner,`08-tc08-stale-${action}`);
        for (const suffix of ['', '/file']) {
          const missing=await request(owner,`/api/summaries/${stale.id}${suffix}`);
          assert.equal(missing.status,404); assert.equal(missing.data.error.code,'SUMMARY_NOT_FOUND');
        }
        const repeat = await request(owner,`/api/summaries/${stale.id}`,'DELETE');
        assert.equal(repeat.status,404); assert.equal(repeat.data.error.code,'SUMMARY_NOT_FOUND');
        const snapshot = inspectSummary(stale.id); assert(!snapshot.summary && !snapshot.file);
        await owner.reload(); assert.equal(await card(owner,stale.id).count(),0);
        report(`TC08 stale ${method} from first tab after second-tab deletion gives 404; GET/file/DELETE 404; no resurrection`);
      } finally { await request(owner,`/api/summaries/${stale.id}`,'DELETE'); }
    }
    await second.close();
    await owner.goto(ownerUrl+mine); await card(owner,owned.id).waitFor();

    const deletes = [];
    owner.on('request', req => { if (req.method() === 'DELETE') deletes.push(req.url()); });
    await card(owner, owned.id).locator('[data-summary-action=delete]').click();
    await owner.locator('#summary-delete-cancel').click();
    await owner.locator('#summary-delete-dialog').waitFor({state: 'hidden'});
    assert.equal(deletes.length, 0);
    await screenshot(owner,'09-tc06-cancel-preserved');
    await assertPdf(owner, owned.id, replacement);
    report('TC06 cancel sent no DELETE and the PDF remained readable');

    await card(owner, owned.id).locator('[data-summary-action=delete]').click();
    await screenshot(owner, '04-confirm-delete');
    const removed = owner.waitForResponse(r => new URL(r.url()).pathname === route && r.request().method() === 'DELETE');
    await owner.locator('#summary-delete-confirm').click();
    assert.equal((await removed).status(), 204);
    await card(owner, owned.id).waitFor({state: 'detached'});
    assert.equal((await request(owner, route)).status, 404);
    assert.equal((await request(owner, `${route}/file`)).status, 404);
    assert.equal((await request(owner, route, 'DELETE')).status, 404);
    await owner.reload();
    await owner.getByText('คุณยังไม่ได้แบ่งปันสรุป PDF').waitFor();
    assert(!(await list(nextCourseId)).data.items.some(item => item.id === owned.id));
    const afterDelete = inspectSummary(owned.id);
    assert(!afterDelete.summary && !afterDelete.file && !afterDelete.objects.includes(after.key));
    await assertPdf(other, control.id, original);
    assert((await request(other, '/api/my-summaries')).data.items.some(item => item.id === control.id));
    report('TC05 and TC08 confirmed delete returned 204; stale detail/file/delete return 404; SQL rows and PDF removed; other user unaffected');
  } finally {
    for (const [page, row] of [[owner, owned], [other, control]]) {
      if (row) {
        const cleaned = await request(page, `/api/summaries/${row.id}`, 'DELETE');
        assert([204, 404].includes(cleaned.status), 'Fixture cleanup failed');
      }
    }
    await browser.close();
    results.finishedAt=new Date().toISOString(); flush();
  }
}

main().then(()=>{results.status='PASS';flush();}).catch(error => { results.status='FAIL'; results.error=error.message; flush(); console.error(error); process.exitCode = 1; });
