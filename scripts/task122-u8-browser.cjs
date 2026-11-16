// Real browser -> existing Express proxy -> FastAPI -> SQL Server/PDF volume.
// TU is explicitly mock; run only against the isolated Compose project below.
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {mkdirSync, writeFileSync} = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.TASK122_PLAYWRIGHT || 'playwright-core');
const project = process.env.TASK122_PROJECT;
assert.match(project || '', /^cs261-task122-[a-z0-9-]+$/);
const backend = `${project}-backend-1`;
const evidence = process.env.TASK122_EVIDENCE;
assert(evidence, 'Set TASK122_EVIDENCE to a directory outside public/');
mkdirSync(evidence, {recursive: true});
const urls = ['http://127.0.0.1:25800', 'http://127.0.0.1:25801'];
const tag = `Task122-${Date.now()}`;
const results = [];
const targets = [];
const digest = data => createHash('sha256').update(data).digest('hex');
function passed(name, detail = {}) { results.push({name, ...detail}); console.log(`PASS ${name}`); }
function py(code) {
  return execFileSync('docker', ['exec', '-i', backend, 'python', '-'],
    {input: code, encoding: 'utf8', timeout: 30000}).trim();
}
const label = execFileSync('docker', ['inspect', '--format',
  '{{ index .Config.Labels "com.docker.compose.project" }}', backend], {encoding: 'utf8'}).trim();
assert.equal(label, project);
for (const container of [backend, `${project}-backend-b-1`]) {
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
  assert(Number.isSafeInteger(target.id));
  const col = target.kind === 'guide' ? 'guide_id' : 'summary_id';
  const sql = active ? `CREATE TRIGGER dbo.task122_review_failure ON dbo.reviews AFTER INSERT, UPDATE, DELETE AS
    BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted WHERE ${col}=${target.id})
    OR EXISTS (SELECT 1 FROM deleted WHERE ${col}=${target.id})
    BEGIN ;THROW 51022, 'Task122 scoped SQL failure', 1; END END`
    : 'DROP TRIGGER IF EXISTS dbo.task122_review_failure';
  py(`from app.db import engine\nwith engine.begin() as c:\n    c.exec_driver_sql(${JSON.stringify(sql)})`);
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
      body.set('file', new File([Uint8Array.from(bytes)], 'task122.pdf', {type: 'application/pdf'}));
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
async function main() {
  const browser = await chromium.launch({channel: process.env.TASK122_BROWSER || 'chrome', headless: true});
  const contexts = await Promise.all([browser.newContext({viewport: {width: 1440, height: 1000}}), browser.newContext({viewport: {width: 1440, height: 1000}})]);
  const pages = await Promise.all(contexts.map(c => c.newPage()));
  let baseline;
  let completed = false;
  let cleanupPassed = false;
  const environment = {
    browser: browser.version(),
    docker: execFileSync('docker', ['version','--format','{{.Server.Version}}'], {encoding:'utf8'}).trim(),
    sqlServer: py("from app.db import engine\nwith engine.connect() as c:\n    print(c.exec_driver_sql(\"SELECT CAST(SERVERPROPERTY('ProductVersion') AS VARCHAR)\").scalar())")
  };
  try {
    const users = [await login(pages[0], 0), await login(pages[1], 1)];
    assert.notEqual(users[0].id, users[1].id);
    baseline = snapshot();
    passed('two real SQL user IDs; TU mock', {userIds: users.map(u => u.id)});
    const courses = (await api(pages[0], '/api/courses?search=CS261')).data;
    const course = courses.find(c => c.course_code === 'CS261'); assert(course);
    for (const kind of ['guide','summary']) {
      const t = await publish(pages[0], kind, 0, course.id);
      const other = await publish(pages[1], kind, 1, course.id);
      const keep = await api(pages[0], endpoint(other), 'POST', {rating: 3, comment: 'รีวิวของอีกบัญชีต้องคงอยู่'});
      assert.equal(keep.status, 201);
      const keepSql = sqlReview(keep.data.id);
      await open(pages[1], t, 1);
      await action(pages[1], 'add').click();
      const created = await submit(pages[1], t, 'POST', 5, 'อ่านง่าย ทดสอบระบบจริง');
      assert.deepEqual(sqlReview(created.id).slice(4), [5, 'อ่านง่าย ทดสอบระบบจริง']);
      await shot(pages[1], `${kind}-01-create`);
      await open(pages[1], t, 1); // reload document and request reviews afresh
      assert((await pages[1].locator('[data-review-own-entry]').innerText()).includes('อ่านง่าย'));
      await login(pages[1], 1); // issue a new Bearer session through login UI
      await open(pages[1], t, 1);
      await action(pages[1], 'edit').click();
      const updated = await submit(pages[1], t, 'PUT', 4, 'แก้ไขแล้ว');
      assert.equal(updated.id, created.id); assert.deepEqual(sqlReview(created.id).slice(4), [4, 'แก้ไขแล้ว']);
      await shot(pages[1], `${kind}-02-update`);
      passed(`${kind}: UI create/list/update; SQL persistence across reload and new session`);
      const checks = [
        [await api(pages[0], endpoint(t), 'POST', {rating: 5}), 403, 'SELF_REVIEW_FORBIDDEN'],
        [await api(pages[1], endpoint(t), 'POST', {rating: 5}), 409, 'REVIEW_ALREADY_EXISTS'],
        [await api(pages[0], `/api/reviews/${created.id}`, 'PUT', {rating: 1}), 403, 'REVIEW_FORBIDDEN'],
        [await api(pages[0], `/api/reviews/${created.id}`, 'DELETE'), 403, 'REVIEW_FORBIDDEN'],
        [await api(pages[1], endpoint(t), 'GET', undefined, true), 401, 'AUTH_REQUIRED'],
        [await api(pages[1], `/api/reviews/${created.id}`, 'PUT', {rating: 2.5}), 422, 'INVALID_PARAMETERS'],
        [await api(pages[1], `/api/reviews/${created.id}`, 'PUT', {rating: 4, comment: '😀'.repeat(2001)}), 422, 'INVALID_PARAMETERS']
      ];
      for (const [r, status, code] of checks) { assert.equal(r.status, status); assert.equal(r.data.error.code, code); }
      assert.deepEqual(sqlReview(created.id).slice(4), [4,'แก้ไขแล้ว']);
      await open(pages[0], t, 0);
      assert.equal(await action(pages[0], 'add').isVisible(), false);
      assert.equal(await pages[0].locator('[data-review-owner-note]').isVisible(), true);
      passed(`${kind}: real API self/duplicate/owner/auth/validation checks; owner UI cannot add`);
      // All DB failure responses below come from a real, narrowly scoped SQL trigger.
      fault(t, true);
      try {
        await open(pages[1], t, 1); await action(pages[1], 'edit').click();
        await pages[1].locator('#star-1').check(); await pages[1].locator('#review-comment').fill('ต้องไม่ถูกบันทึก');
        let pending = pages[1].waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/api/reviews/'));
        await pages[1].locator('dialog[open] [type=submit]').click();
        assert.equal((await pending).status(), 503);
        await pages[1].waitForFunction(() => document.querySelector('dialog[open]')?.getAttribute('aria-busy') === 'false');
        assert.deepEqual(sqlReview(created.id).slice(4), [4,'แก้ไขแล้ว']);
        await shot(pages[1], `${kind}-03-sql-failure`);
        const failedDelete = await api(pages[1], `/api/reviews/${created.id}`, 'DELETE');
        assert.equal(failedDelete.status, 503); assert(sqlReview(created.id));
      } finally { fault(t, false); }
      await open(pages[1], t, 1); await action(pages[1], 'edit').click(); await action(pages[1], 'delete').click();
      await action(pages[1], 'cancel-delete').click(); assert(sqlReview(created.id));
      await action(pages[1], 'delete').click();
      const pending = pages[1].waitForResponse(r => r.request().method() === 'DELETE' && r.url().includes('/api/reviews/'));
      await action(pages[1], 'confirm-delete').click(); assert.equal((await pending).status(), 204);
      await action(pages[1], 'add').waitFor({state: 'visible'});
      assert.equal(sqlReview(created.id), null); assert.deepEqual(sqlReview(keep.data.id), keepSql);
      await shot(pages[1], `${kind}-04-delete`);
      fault(t, true);
      try { assert.equal((await api(pages[1], endpoint(t), 'POST', {rating: 5})).status, 503);
        assert.equal((await api(pages[1], endpoint(t))).data.items.length, 0);
      } finally { fault(t, false); }
      const concurrent = await Promise.all([1,2].map(() => api(pages[1], endpoint(t), 'POST', {rating: 5})));
      assert.deepEqual(concurrent.map(r => r.status).sort(), [201,409]);
      const again = concurrent.find(r => r.status === 201).data;
      assert.notEqual(again.id, created.id);
      passed(`${kind}: SQL failure create/update/delete rolls back; UI cancel/delete; concurrent duplicate prevented`);
      if (kind === 'summary') {
        const bytes = await pages[1].evaluate(async id => {
          const r = await fetch(`/api/summaries/${id}/file`, {headers: {Authorization: `Bearer ${sessionStorage.getItem('access_token')}`}});
          if (!r.ok) throw Error('PDF read failed'); return [...new Uint8Array(await r.arrayBuffer())];
        }, t.id);
        assert.equal(digest(Buffer.from(bytes)), digest(originalPdf));
        passed('real PDF unchanged after review CRUD/failures', {sha256: digest(originalPdf)});
      }
      await removeTarget(pages[0], t);
      assert.equal(sqlReview(again.id), null); assert.deepEqual(sqlReview(keep.data.id), keepSql);
      for (const method of ['GET','POST']) {
        const r = await api(pages[1], endpoint(t), method, method === 'POST' ? {rating: 5} : undefined);
        assert.equal(r.status, 404); assert.equal(r.data.error.code, `${kind.toUpperCase()}_NOT_FOUND`);
      }
      for (const method of ['PUT','DELETE']) assert.equal((await api(pages[1], `/api/reviews/${again.id}`, method,
        method === 'PUT' ? {rating: 4} : undefined)).status, 404);
      passed(`${kind}: target deletion cascades only related reviews; missing target/review returns 404`);
    }
    completed = true;
  } catch (error) {
    console.error('Integration failed:', error.message);
    throw error;
  } finally {
    try {
      fault({id: 1, kind: 'guide'}, false);
      for (const t of [...targets].reverse()) if (!t.removed) await removeTarget(pages[t.owner], t);
      if (baseline) { assert.deepEqual(snapshot(), baseline); cleanupPassed = true;
        passed('cleanup restored original SQL rows and PDF files exactly'); }
    } finally {
      await browser.close();
      writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({
        passed: completed && cleanupPassed,
        sourceSha: execFileSync('git', ['rev-parse','HEAD'], {encoding:'utf8'}).trim(), environment,
        authMode: 'TU mock, two processes, distinct SQL user IDs', project, date: new Date().toISOString(),
        results, targets: targets.map(({id,kind,owner,removed}) => ({id,kind,owner,removed}))
      }, null, 2) + '\n');
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
