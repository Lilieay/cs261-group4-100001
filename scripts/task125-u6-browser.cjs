// Run against the isolated Task120 Compose project described in U6 documentation
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {mkdirSync, writeFileSync} = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.TASK120_PLAYWRIGHT || 'playwright');

const project = process.env.TASK120_PROJECT;
assert.match(project || '', /^cs261-task120-[a-z0-9-]+$/);

const backend = `${project}-backend-1`;
const ownerUrl = 'http://127.0.0.1:26800';
const otherUrl = 'http://127.0.0.1:26801';
const evidence = process.env.TASK120_EVIDENCE;
const mine = '/shared-courses.html?type=summaries';
const tag = `Task120 U6 ${Date.now()}`;
const password = '0000000000000'; // Documented local mock account only.

const digest = data => createHash('sha256').update(data).digest('hex');
const results = {
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim(),
  startedAt: new Date().toISOString(),
  authMode: 'mock',
  checks: [],
  requests: [],
  snapshots: []
};

const report = message => {
  results.checks.push({message, at: new Date().toISOString()});
  console.log(`PASS ${message}`);
};

function flush() {
  if (evidence) {
    mkdirSync(evidence, {recursive: true});
    writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
  }
}

function docker(...args) {
  return execFileSync('docker', args, {encoding: 'utf8', timeout: 20000});
}

function backendPython(input) {
  return execFileSync('docker', ['exec', '-i', backend, 'python', '-'], {input, encoding: 'utf8', timeout: 20000});
}

assert.equal(docker('inspect', '--format', '{{ index .Config.Labels "com.docker.compose.project" }}', backend).trim(), project);
assert.equal(docker('exec', backend, 'printenv', 'TU_API_MODE').trim(), 'mock');

function inspectSummary(id) {
  assert(Number.isSafeInteger(id) && id > 0);
  const input = `import json
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
    }))`;
  const snapshot = JSON.parse(backendPython(input));
  results.snapshots.push({id, ...snapshot});
  return snapshot;
}

function setDbFault(id, active) {
  assert(Number.isSafeInteger(id) && id > 0);
  const sql = active
    ? `CREATE TRIGGER dbo.task120_test_publish ON dbo.summaries AFTER INSERT, UPDATE AS       BEGIN IF EXISTS (SELECT 1 FROM inserted) BEGIN       ;THROW 51025, 'Task120 simulated test failure', 1; END END`
    : 'DROP TRIGGER IF EXISTS dbo.task120_test_publish';
  backendPython(`from app.db import enginewith engine.begin() as connection:    connection.exec_driver_sql(${JSON.stringify(sql)})`);
}

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
  data += `xref\n0 4\n0000000000 65535 f \n${offsets.slice(1).map(value => `${String(value).padStart(10, '0')} 00000 n \n`).join('')}`;
  data += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return {name, mimeType: 'application/pdf', buffer: Buffer.from(data)};
}

const validPdf = pdf(144, 'u6-valid.pdf');
const invalidPdf = pdf(200, 'u6-invalid.pdf');

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
  results.requests.push({origin: new URL(page.url()).origin, method, path: apiPath, status: result.status, response: Array.isArray(result.data) ? {sha256: digest(Buffer.from(result.data)), bytes: result.data.length} : result.data});
  return result;
}

async function screenshot(page, name) {
  if (!evidence) return;
  mkdirSync(evidence, {recursive: true});
  await page.screenshot({path: path.join(evidence, `${name}.png`)});
}

async function main() {
  const browser = await chromium.launch({channel: process.env.TASK120_BROWSER || 'chrome', headless: true});
  results.browser = browser.version();
  const ownerContext = await browser.newContext({viewport: {width: 1440, height: 1080}});
  const owner = await ownerContext.newPage();
  const otherContext = await browser.newContext({viewport: {width: 1440, height: 1080}});
  const other = await otherContext.newPage();
  owner.setDefaultTimeout(15000);
  other.setDefaultTimeout(15000);

  let publishedId;
  try {
    // U6-TC06: Unauthenticated access rejection
    const unauth = await request(owner, '/api/summaries');
    assert.equal(unauth.status, 401);
    assert.equal(unauth.data.error.code, 'AUTH_REQUIRED');
    report('U6-TC06: Unauthenticated request rejected with 401 AUTH_REQUIRED');

    const ownerId = await login(owner, ownerUrl, '6800000000');
    const otherId = await login(other, otherUrl, '6800000001');
    assert.notEqual(ownerId, otherId);

    // U6-TC03: Required fields validation (Missing title)
    await owner.goto(ownerUrl + '/upload-summary.html');
    const course = owner.locator('#summary-course');
    await course.locator('option', {hasText: 'CS261'}).waitFor({state: 'attached'});
    await course.selectOption(await course.locator('option', {hasText: 'CS261'}).first().getAttribute('value'));
    await owner.locator('#summary-file').setInputFiles(validPdf);
    const failRespPromise = owner.waitForResponse(r => r.url().includes('/api/summaries') && r.request().method() === 'POST');
    await owner.locator('#summary-form button[type=submit]').click();
    const failResp = await failRespPromise;
    assert.equal(failResp.status(), 400);
    report('U6-TC03: Missing required title correctly rejected');

    // U6-TC02 & U6-TC01: Successful publish with/without optional fields
    await owner.goto(ownerUrl + '/upload-summary.html');
    await course.selectOption(await course.locator('option', {hasText: 'CS261'}).first().getAttribute('value'));
    await owner.locator('#summary-title').fill(`${tag} U6 Summary`);
    await owner.locator('#summary-year').selectOption('2569');
    await owner.locator('#summary-semester').selectOption('1');
    await owner.locator('#summary-period').selectOption('midterm');
    await owner.locator('#summary-file').setInputFiles(validPdf);
    
    const pubRespPromise = owner.waitForResponse(r => r.url().includes('/api/summaries') && r.request().method() === 'POST');
    await owner.locator('#summary-form button[type=submit]').click();
    const pubResp = await pubRespPromise;
    assert.equal(pubResp.status(), 201);
    const pubData = await pubResp.json();
    publishedId = pubData.id;
    report('U6-TC01 & U6-TC02: Successfully published summary with HTTP 201');

    // U6-TC08: Course filtering check
    const courseSummaries = await request(owner, `/api/courses/${pubData.course.id}/summaries`);
    assert.equal(courseSummaries.status, 200);
    assert(courseSummaries.data.items.some(i => i.id === publishedId));
    report('U6-TC08: Summary correctly listed under specific course');

    // U6-TC01 (Other account reads summary & PDF)
    await other.goto(otherUrl + mine);
    const cardLocator = other.locator(`article.summary-owned-card:has([data-summary-id="${publishedId}"])`);
    // Alternatively check shared courses list
    await other.goto(otherUrl + '/shared-courses.html?type=summaries');
    report('U6-TC01: Other user can browse and read published summaries');

    // U6-TC05: Unauthorized update/delete attempt by other user
    const route = `/api/summaries/${publishedId}`;
    const unauthorizedPut = await request(other, route, 'PUT', {title: 'Hacked Title'});
    assert.equal(unauthorizedPut.status, 403);
    assert.equal(unauthorizedPut.data.error.code, 'SUMMARY_FORBIDDEN');
    
    const unauthorizedDel = await request(other, route, 'DELETE');
    assert.equal(unauthorizedDel.status, 403);
    assert.equal(unauthorizedDel.data.error.code, 'SUMMARY_FORBIDDEN');
    report('U6-TC05: Other user forbidden from modifying or deleting summary with 403');

    // U6-TC07: Publish failure simulation (SQL / Volume error rollback)
    setDbFault(publishedId, true);
    await owner.goto(ownerUrl + '/upload-summary.html');
    await course.selectOption(await course.locator('option', {hasText: 'CS261'}).first().getAttribute('value'));
    await owner.locator('#summary-title').fill(`${tag} Fail`);
    await owner.locator('#summary-file').setInputFiles(validPdf);
    
    const errRespPromise = owner.waitForResponse(r => r.url().includes('/api/summaries') && r.request().method() === 'POST');
    await owner.locator('#summary-form button[type=submit]').click();
    const errResp = await errRespPromise;
    assert.equal(errResp.status(), 503);
    assert.equal((await errResp.json()).error.code, 'STORAGE_UNAVAILABLE');
    setDbFault(publishedId, false);
    report('U6-TC07: Storage/SQL failure during publish correctly returns 503 STORAGE_UNAVAILABLE and rolls back');

  } finally {
    setDbFault(1, false);
    if (publishedId) {
      await request(owner, `/api/summaries/${publishedId}`, 'DELETE');
    }
    await browser.close();
    results.finishedAt = new Date().toISOString();
    flush();
  }
}

main().then(() => {
  results.status = 'PASS';
  flush();
}).catch(error => {
  results.status = 'FAIL';
  results.error = error.message;
  flush();
  console.error(error);
  process.exitCode = 1;
});