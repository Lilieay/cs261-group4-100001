// Run against the isolated Task123 Compose project described in docs/U9/testing.
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');

const {mkdirSync} = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.TASK123_PLAYWRIGHT || 'playwright-core');

const project = process.env.TASK123_PROJECT;
assert.match(project || '', /^cs261-task123-[a-z0-9-]+$/);
const backend = `${project}-backend-1`;
const ownerUrl = 'http://127.0.0.1:27800';
const otherUrl = 'http://127.0.0.1:27801';
const evidence = process.env.TASK123_EVIDENCE;
const tag = `Task123 ${Date.now()}`;
const password = '0000000000000'; // Documented local mock account only.
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
assert.equal(docker('exec', project + '-backend-b', 'printenv', 'TU_API_MODE').trim(), 'mock');

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

const original = pdf(144, 'task123-original.pdf');

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
  await page.locator('#summary-description').fill('ข้อมูลทดสอบ Task123');
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
  await page.screenshot({path: path.join(evidence, `${name}.png`), fullPage: true});
}



async function api(page, endpoint, method = 'GET', data) {
  return page.evaluate(async ({endpoint, method, data}) => {
    const headers = {};
    const token = sessionStorage.getItem('access_token');
    if (token) headers.Authorization = 'Bearer ' + token;
    if (data !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(endpoint, {
      method, headers, cache: 'no-store',
      ...(data === undefined ? {} : {body: JSON.stringify(data)})
    });
    return {status: response.status, data: response.status === 204 ? null : await response.json()};
  }, {endpoint, method, data});
}

function bookmarkUsers(kind, id) {
  assert(['guide', 'summary'].includes(kind));
  assert(Number.isSafeInteger(id) && id > 0);
  const table = kind === 'guide' ? 'saved_guides' : 'saved_summaries';
  return JSON.parse(backendPython(`import json
from app.db import engine
with engine.connect() as connection:
    rows = connection.exec_driver_sql("SELECT user_id FROM dbo.${table} WHERE ${kind}_id = ? ORDER BY user_id", (${id},))
    print(json.dumps([row[0] for row in rows]))
`));
}

function faultSql(sql) {
  backendPython(`from app.db import engine
with engine.begin() as connection:
    connection.exec_driver_sql(${JSON.stringify(sql)})
`);
}

function failBookmark(kind, id, userId) {
  assert(['guide', 'summary'].includes(kind));
  assert([id, userId].every(value => Number.isSafeInteger(value) && value > 0));
  const table = kind === 'guide' ? 'saved_guides' : 'saved_summaries';
  faultSql(`CREATE TRIGGER dbo.task123_test_save ON dbo.${table} AFTER INSERT AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM inserted WHERE ${kind}_id = ${id} AND user_id = ${userId})
  BEGIN
    ;THROW 51023, 'Task123 scoped SQL failure', 1;
  END
END`);
}

function snapshot() {
  return JSON.parse(backendPython(`import json, hashlib
from pathlib import Path
from app.config import PDF_STORAGE_ROOT
from app.db import engine
with engine.connect() as connection:
    tables = {}
    for name in ('guides','summaries','summary_files','saved_guides','saved_summaries'):
        rows = connection.exec_driver_sql('SELECT * FROM dbo.' + name)
        tables[name] = sorted([list(map(str, row)) for row in rows])
    files = {str(p.relative_to(PDF_STORAGE_ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
             for p in Path(PDF_STORAGE_ROOT).rglob('*') if p.is_file()}
    trigger = connection.exec_driver_sql("SELECT OBJECT_ID('dbo.task123_test_save', 'TR')").scalar()
    print(json.dumps({'tables': tables, 'files': files, 'testTrigger': trigger}))
`));
}

async function ready(page, selector, checked) {
  const button = page.locator(selector + '[aria-pressed="' + checked + '"]:enabled');
  await button.waitFor({state: 'visible'});
  return button;
}

async function exercise(browser, owner, other, fixture, course, userA, userB) {
  const {kind, id} = fixture;
  const target = '/api/saved-items/' + kind + '/' + id;
  const read = kind === 'guide'
    ? '/read-courses.html?' + new URLSearchParams({source: 'api', guide: id, courseId: course.id, course: course.course_code})
    : '/read-summary.html?summary=' + id;
  const button = kind === 'guide' ? '.save-button' : '#summary-save';
  const status = kind === 'guide' ? '#reading-status' : '#summary-save-status';
  const check = (response, saved) => {
    assert.equal(response.status, 200, JSON.stringify(response));
    assert.deepEqual(response.data, {item_type: kind, item_id: id, saved});
  };
  const apiResponse = (page, method) => page.waitForResponse(r =>
    new URL(r.url()).pathname === target && r.request().method() === method);
  const idleMessage = (page, message) => page.locator(status).getByText(message, {exact: false}).waitFor({state: 'visible'});

  async function unsavedButton(page) {
    await page.bringToFront();
    if (kind === 'summary') {
      await page.locator('#summary-pdf[src^="blob:"]').waitFor({state: 'visible'});
    }
    await (await ready(page, button, false)).focus();
    return ready(page, button, false);
  }

  await owner.goto(ownerUrl + read);
  await other.goto(otherUrl + read);
  await ready(other, button, false);
  const unsaved = await unsavedButton(owner);
  assert.deepEqual(bookmarkUsers(kind, id), []);
  const [saved] = await Promise.all([apiResponse(owner, 'PUT'), unsaved.click()]);
  assert.equal(saved.status(), 200);
  await ready(owner, button, true);
  await screenshot(owner, kind + '-01-saved');
  assert.deepEqual(bookmarkUsers(kind, id), [userA]);

  for (const response of await Promise.all([api(owner, target, 'PUT'), api(owner, target, 'PUT')])) check(response, true);
  assert.deepEqual(bookmarkUsers(kind, id), [userA]);
  await owner.reload();
  await ready(owner, button, true);
  assert.equal(await login(owner, ownerUrl, '6800000000'), userA);
  await owner.goto(ownerUrl + read);
  await ready(owner, button, true);
  check(await api(other, target), false);
  report(kind + ': UI GET/PUT, repeat save, reload, fresh login and account isolation');

  // Two requests start with no bookmark and must converge on one SQL row.
  check(await api(owner, target, 'DELETE'), false);
  assert.deepEqual(bookmarkUsers(kind, id), []);
  for (const response of await Promise.all([api(owner, target, 'PUT'), api(owner, target, 'PUT')])) check(response, true);
  assert.deepEqual(bookmarkUsers(kind, id), [userA]);
  report(kind + ': concurrent first PUTs both return 200 and leave one row');

  const failingButton = await unsavedButton(other);
  failBookmark(kind, id, userB);
  try {
    const [failed, reread] = await Promise.all([
      apiResponse(other, 'PUT'), apiResponse(other, 'GET'), failingButton.click()
    ]);
    assert.equal(failed.status(), 503);
    const error = (await failed.json()).error;
    assert.equal(error.code, 'SAVED_ITEMS_UNAVAILABLE');
    check({status: reread.status(), data: await reread.json()}, false);
    await ready(other, button, false);
    await idleMessage(other, error.message);
    assert.deepEqual(bookmarkUsers(kind, id), [userA]);
    await screenshot(other, kind + '-02-sql-failure');
  } finally {
    faultSql('DROP TRIGGER dbo.task123_test_save');
  }
  report(kind + ': real SQL rejection keeps A saved, B unsaved and shows the error');

  // Forward the write to real Backend/SQL, then simulate the Browser losing its response.
  let upstreamStatus;
  const maskWriteResponse = async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    upstreamStatus = (await route.fetch()).status();
    return route.abort('failed');
  };
  await other.route('**' + target, maskWriteResponse);
  try {
    const uncertainButton = await unsavedButton(other);
    const [refreshed] = await Promise.all([apiResponse(other, 'GET'), uncertainButton.click()]);
    check({status: refreshed.status(), data: await refreshed.json()}, true);
    await ready(other, button, true);
    assert.equal(upstreamStatus, 200);
    await idleMessage(other, 'ยังยืนยันผลไม่ได้');
    assert.deepEqual(bookmarkUsers(kind, id), [userA, userB].sort((a,b) => a-b));
    await screenshot(other, kind + '-03-lost-response');
  } finally {
    await other.unroute('**' + target, maskWriteResponse);
  }
  report(kind + ': lost Browser response prompts GET and SQL confirms saved with uncertainty message');

  const anonymous = await browser.newPage();
  try {
    await anonymous.goto(otherUrl + '/login.html');
    assert.equal((await api(anonymous, target)).status, 401);
  } finally { await anonymous.close(); }
}

async function removeFixture(page, fixture) {
  const endpoint = fixture.kind === 'guide' ? '/api/my-guides/' : '/api/summaries/';
  const deleted = await api(page, endpoint + fixture.id, 'DELETE');
  assert.equal(deleted.status, fixture.kind === 'guide' ? 200 : 204, JSON.stringify(deleted));
  fixture.deleted = true;
}

async function main() {
  const browser = await chromium.launch({channel: process.env.TASK123_BROWSER || 'chrome', headless: true});
  const owner = await browser.newPage();
  const other = await browser.newPage();
  const fixtures = [];
  let baseline;
  try {
    const a = await login(owner, ownerUrl, '6800000000');
    const b = await login(other, otherUrl, '6800000001');
    assert.notEqual(a, b);
    baseline = snapshot();
    assert.equal(baseline.testTrigger, null);
    const courses = await api(owner, '/api/courses?search=CS261');
    assert.equal(courses.status, 200);
    const course = courses.data.find(item => item.course_code === 'CS261');
    assert(course);
    const guide = await api(owner, '/api/guides', 'POST', {
      course_id: course.id, title: tag + ' Guide', academic_year: 2569,
      semester: 1, exam_period: 'midterm', topics: 'Task123', exam_format: 'objective', objective_count: 5
    });
    assert.equal(guide.status, 201, JSON.stringify(guide));
    fixtures.push({kind: 'guide', id: guide.data.id});
    const summary = await publish(owner, ownerUrl, tag + ' PDF', original);
    fixtures.push({kind: 'summary', id: summary.id});

    for (const fixture of fixtures) {
      await exercise(browser, owner, other, fixture, course, a, b);
      await removeFixture(owner, fixture);
      assert.deepEqual(bookmarkUsers(fixture.kind, fixture.id), []);
      for (const method of ['GET', 'PUT']) {
        const missing = await api(other, '/api/saved-items/' + fixture.kind + '/' + fixture.id, method);
        assert.equal(missing.status, 404, JSON.stringify(missing));
        assert.equal(missing.data.error.code, fixture.kind.toUpperCase() + '_NOT_FOUND');
      }
      report(fixture.kind + ': deleted target returns typed 404 and leaves no bookmarks');
    }
  } finally {
    try {
      for (const fixture of fixtures.reverse()) {
        if (!fixture.deleted) await removeFixture(owner, fixture);
      }
      if (baseline) {
        assert.deepEqual(snapshot(), baseline);
        report('cleanup restored SQL fixture tables and original PDF volume contents');
      }
    } finally { await browser.close(); }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
