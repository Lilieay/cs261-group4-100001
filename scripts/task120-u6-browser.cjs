// Run against the isolated Task120 Compose project described in docs/U6/testing.
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {mkdirSync} = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.TASK120_PLAYWRIGHT || 'playwright-core');

const project = process.env.TASK120_PROJECT;
assert.match(project || '', /^cs261-task120-[a-z0-9-]+$/);
const backend = `${project}-backend-1`;
const ownerUrl = 'http://127.0.0.1:26800';
const otherUrl = 'http://127.0.0.1:26801';
const evidence = process.env.TASK120_EVIDENCE;
const tag = `Task120 ${Date.now()}`;
const ownerUsername = '6800000000';
const password = '0000000000000'; // Documented local mock account only.
const digest = data => createHash('sha256').update(data).digest('hex');
const report = message => console.log(`PASS ${message}`);

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
  return JSON.parse(backendPython(input));
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

const original = pdf(144, 'task120-original.pdf');

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
  return page.evaluate(async ({apiPath, method, fields, file}) => {
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
}

async function submitSummary(page, url, title, file, createdIds) {
  await page.goto(url + '/upload-summary.html');
  const course = page.locator('#summary-course');
  await course.locator('option', {hasText: 'CS261'}).waitFor({state: 'attached'});
  await course.selectOption(await course.locator('option', {hasText: 'CS261'}).first().getAttribute('value'));
  await page.locator('#summary-title').fill(title);
  await page.locator('#summary-description').fill('ข้อมูลทดสอบ Task120');
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
  const createdIds = new Set();
  const failures = [];
  try {
    const a = await login(owner, ownerUrl, ownerUsername);
    const b = await login(reader, otherUrl, '6800000001');
    assert.notEqual(a, b);
    const published = await submitSummary(owner, ownerUrl, tag, original, createdIds);
    assert.equal(published.status, 201, JSON.stringify(published.data));
    const row = published.data;
    assert.deepEqual([row.academic_year, row.semester, row.exam_period], [2569, 1, 'midterm']);
    assert.equal(row.owner.id, a);
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

    const anonymous = await browser.newPage();
    await anonymous.goto(otherUrl + '/login.html');
    assert.equal((await request(anonymous, route + '/file')).status, 401);
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
    changeTrigger(`CREATE TRIGGER dbo.task120_test_publish ON dbo.summaries AFTER INSERT AS
BEGIN IF EXISTS (SELECT 1 FROM inserted WHERE title = '${sqlFailureTitle}')
BEGIN ;THROW 51020, 'Task120 publish failure', 1; END END`);
    try {
      await verifyPublishFailure(sqlFailureTitle, '02-sql-publish-failure');
      report('SQL publish failure shows a form error, leaves the success dialog closed and preserves SQL/PDF');
    } finally {
      changeTrigger('DROP TRIGGER IF EXISTS dbo.task120_test_publish');
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

    execFileSync('docker', ['compose', '-p', project, 'up', '-d', '--wait', '--no-deps', '--force-recreate', 'backend'], {stdio: 'inherit', timeout: 120000});
    assert.equal(await login(owner, ownerUrl, ownerUsername), a);
    const detail = await request(owner, route);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.title, tag);
    assert.deepEqual(inspectSummary(row.id), before);
    await verifyPdf();
    const reopened = await request(owner, route + '/file');
    assert.equal(reopened.status, 200);
    assert.equal(digest(Buffer.from(reopened.data)), digest(original.buffer));
    report('Backend recreated with existing volume, fresh login retrieves unchanged metadata and PDF');
  } catch (error) {
    failures.push(error);
  }
  await cleanupSummaries(owner, createdIds).catch(error => failures.push(error));
  await browser.close().catch(error => failures.push(error));
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, failures[0].message);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
