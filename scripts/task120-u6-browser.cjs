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

async function publish(page, url, title, file) {
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
  assert.equal(response.status(), 201, await response.text());
  const row = await response.json();
  assert.deepEqual([row.academic_year, row.semester, row.exam_period], [2569, 1, 'midterm']);
  return row;
}

async function screenshot(page, name) {
  if (!evidence) return;
  mkdirSync(evidence, {recursive: true});
  await page.screenshot({path: path.join(evidence, `${name}.png`)});
}


async function main() {
  const browser = await chromium.launch({channel: 'chrome', headless: true});
  const owner = await browser.newPage();
  const reader = await browser.newPage();
  let row;
  try {
    const a = await login(owner, ownerUrl, '6800000000');
    const b = await login(reader, otherUrl, '6800000001');
    assert.notEqual(a, b);
    row = await publish(owner, ownerUrl, tag, original);
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

    const fields = {course_id: String(course.id), title: tag + ' failure', academic_year: '2569', semester: '1', exam_period: 'midterm'};
    const post = (overrides = {}) => request(reader, '/api/summaries', 'POST', {...fields, ...overrides}, original);
    const anonymous = await browser.newPage();
    await anonymous.goto(otherUrl + '/login.html');
    assert.equal((await request(anonymous, route + '/file')).status, 401);
    assert.equal((await post({course_id: '2147483647'})).status, 404);
    const changeTrigger = sql => backendPython(`from app.db import engine
with engine.begin() as connection:
    connection.exec_driver_sql(${JSON.stringify(sql)})
`);
    changeTrigger(`CREATE TRIGGER dbo.task120_test_publish ON dbo.summaries AFTER INSERT AS
BEGIN IF EXISTS (SELECT 1 FROM inserted WHERE title = '${fields.title}')
BEGIN ;THROW 51020, 'Task120 publish failure', 1; END END`);
    try {
      const failure = await post();
      assert.equal(failure.status, 503, JSON.stringify(failure));
    } finally {
      changeTrigger('DROP TRIGGER IF EXISTS dbo.task120_test_publish');
    }
    const storage = docker('exec', backend, 'printenv', 'PDF_STORAGE_ROOT').trim();
    assert.equal(storage, '/app/data/pdfs');
    const mode = docker('exec', backend, 'stat', '-c', '%a', storage).trim();
    docker('exec', '-u', '0', backend, 'chmod', '0555', storage);
    try {
      const failure = await post();
      assert.equal(failure.status, 503, JSON.stringify(failure));
      assert.equal(failure.data.error.code, 'STORAGE_UNAVAILABLE');
    } finally {
      docker('exec', '-u', '0', backend, 'chmod', mode, storage);
    }
    const unwanted = backendPython(`from app.db import engine
with engine.connect() as connection:
    print(connection.exec_driver_sql("SELECT COUNT(*) FROM dbo.summaries WHERE title = ?", (${JSON.stringify(fields.title)},)).scalar())
`).trim();
    assert.equal(unwanted, '0');
    assert.deepEqual(inspectSummary(row.id), before);
    report('Unauthenticated and missing course; SQL and storage failures leave SQL/PDF unchanged');

    execFileSync('docker', ['compose', '-p', project, 'up', '-d', '--wait', '--no-deps', '--force-recreate', 'backend'], {stdio: 'inherit', timeout: 120000});
    assert.equal(await login(owner, ownerUrl, '6800000000'), a);
    const detail = await request(owner, route);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.title, tag);
    assert.deepEqual(inspectSummary(row.id), before);
    await verifyPdf();
    const reopened = await request(owner, route + '/file');
    assert.equal(reopened.status, 200);
    assert.equal(digest(Buffer.from(reopened.data)), digest(original.buffer));
    report('Backend recreated with existing volume, fresh login retrieves unchanged metadata and PDF');
  } finally {
    try {
      if (row) {
        const response = await request(owner, '/api/summaries/' + row.id, 'DELETE');
        assert.equal(response.status, 204, JSON.stringify(response));
        const cleaned = inspectSummary(row.id);
        assert(!cleaned.summary && !cleaned.file);
        assert.deepEqual(cleaned.objects, []);
        report('Cleanup removed the fixture SQL rows and PDF');
      }
    } finally { await browser.close(); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
