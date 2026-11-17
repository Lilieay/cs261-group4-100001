// Chrome -> Express proxy -> FastAPI -> SQL Server/PDF volume in the isolated Task123 stack.
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {isDeepStrictEqual} = require('node:util');
const {mkdirSync, writeFileSync} = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.TASK123_PLAYWRIGHT || 'playwright-core');
const {finishRun} = require('./task128-cleanup.cjs');
const {
  api, bookmarkUsers, docker, failBookmark, faultSql, login, original,
  otherUrl, ownerUrl, ready, request, snapshot
} = require('./task123-u9-browser.cjs');

const project = process.env.TASK123_PROJECT;
assert.match(project, /^cs261-task123-task128-[a-z0-9-]+$/);
const evidence = process.env.TASK128_EVIDENCE;
assert(evidence, 'Set TASK128_EVIDENCE');
mkdirSync(evidence, {recursive: true});
const tag = `Task128 ${Date.now()}`;
const fixtures = [];
const results = [];
const statePath = ({kind, id}) => `/api/saved-items/${kind}/${id}`;
const bookmarkButton = ({kind}) => kind === 'guide' ? '.save-button' : '#summary-save';
const statusBox = ({kind}) => kind === 'guide' ? '#reading-status' : '#summary-save-status';
const itemCard = (page, {kind, id}) =>
  page.locator(`[data-unsave="${id}"][data-item-type="${kind}"]`).locator('xpath=ancestor::article');

function verifyStack() {
  const label = '{{index .Config.Labels "com.docker.compose.project"}}';
  for (const [front, back, backHost, url] of [
    [project + '-frontend-1', project + '-backend-1', 'backend', ownerUrl],
    [project + '-frontend-b', project + '-backend-b', project + '-backend-b', otherUrl]
  ]) {
    for (const container of [front, back]) {
      assert.equal(docker('inspect', '--format', label, container).trim(), project);
    }
    const ports = JSON.parse(docker('inspect', '--format', '{{json .NetworkSettings.Ports}}', front));
    assert(ports['5000/tcp']?.some(binding =>
      binding.HostIp === '127.0.0.1' && binding.HostPort === new URL(url).port));
    assert.equal(docker('exec', front, 'printenv', 'BACKEND_URL').trim(), `http://${backHost}:8000`);
    assert.equal(docker('exec', back, 'printenv', 'TU_API_MODE').trim(), 'mock');
    const store = JSON.parse(docker('inspect', '--format', '{{json .Mounts}}', back));
    assert(store.some(volume => volume.Name === `${project}_pdf_storage`));
  }
  const database = project + '-sqlserver-1';
  assert.equal(docker('inspect', '--format', label, database).trim(), project);
  const volumes = JSON.parse(docker('inspect', '--format', '{{json .Mounts}}', database));
  assert(volumes.some(volume => volume.Name === `${project}_sqlserver_data`));
}

async function runCase(id, run) {
  try {
    const outcome = await run();
    const details = typeof outcome === 'string' ? {actual: outcome} : outcome;
    results.push({id, status: 'Pass', ...details});
    console.log(`PASS ${id} ${details.actual}`);
  } catch (error) {
    results.push({id, status: 'Fail', actual: error.message});
    throw error;
  }
}

async function screenshot(page, name) {
  await page.screenshot({path: path.join(evidence, name + '.png'), fullPage: true});
}

async function createFixture(page, kind, course) {
  const title = `${tag} ${course.course_code} ${kind}`;
  const metadata = {academic_year: 2569, semester: 1, exam_period: 'midterm'};
  const response = kind === 'guide'
    ? await api(page, '/api/guides', 'POST', {
      ...metadata, course_id: course.id, title, topics: 'Task128 system test',
      exam_format: 'objective', objective_count: 5
    })
    : await request(page, '/api/summaries', 'POST', {
      ...metadata, course_id: course.id, title
    }, original);
  assert.equal(response.status, 201, JSON.stringify(response));
  const fixture = {kind, id: response.data.id, title, course};
  fixtures.push(fixture);
  assert(Number.isSafeInteger(fixture.id) && fixture.id > 0);
  return fixture;
}

async function openReader(page, url, fixture, saved) {
  const {kind, id, course} = fixture;
  const target = kind === 'guide'
    ? '/read-courses.html?' + new URLSearchParams({
      source: 'api', guide: id, courseId: course.id, course: course.course_code
    })
    : `/read-summary.html?summary=${id}`;
  await page.bringToFront();
  await page.goto(url + target);
  if (kind === 'summary') {
    await page.locator('#summary-pdf[src^="blob:"]').waitFor({state: 'visible'});
  }
  await (await ready(page, bookmarkButton(fixture), saved)).focus();
  return ready(page, bookmarkButton(fixture), saved);
}

function expectState(response, {kind, id}, saved) {
  assert.equal(response.status, 200, JSON.stringify(response));
  assert.deepEqual(response.data, {item_type: kind, item_id: id, saved});
}

function observe(page, fixture, method) {
  return page.waitForResponse(response =>
    new URL(response.url()).pathname === statePath(fixture) && response.request().method() === method);
}

async function saveInReader(page, url, fixture) {
  const button = await openReader(page, url, fixture, false);
  const [saved] = await Promise.all([observe(page, fixture, 'PUT'), button.press('Enter')]);
  expectState({status: saved.status(), data: await saved.json()}, fixture, true);
  await ready(page, bookmarkButton(fixture), true);
}

async function checkCard(page, fixture) {
  const card = itemCard(page, fixture);
  await card.waitFor({state: 'visible'});
  assert.equal(await card.locator('h3').innerText(), fixture.title);
  assert.equal(await card.locator('.saved-code').innerText(), fixture.course.course_code);
  assert.equal(await card.locator('xpath=parent::section').getAttribute('aria-labelledby'),
    `saved-course-${fixture.course.id}`);
  assert.equal(await card.count(), 1);
}

async function openSaved(page, ...items) {
  await Promise.all([
    page.waitForURL('**/saved-courses.html', {waitUntil: 'domcontentloaded'}),
    page.locator('nav a[href="saved-courses.html"]').press('Enter')
  ]);
  for (const item of items) await checkCard(page, item);
}

async function logout(page) {
  const oldToken = await page.evaluate(() => sessionStorage.getItem('access_token'));
  assert(oldToken);
  await page.locator('[data-logout]').click();
  await page.waitForURL('**/login.html', {waitUntil: 'domcontentloaded'});
  return oldToken;
}

async function putWithAuthorization(page, endpoint, token) {
  return page.evaluate(async ({endpoint, token}) => {
    const response = await fetch(endpoint, {
      method: 'PUT', headers: token ? {Authorization: `Bearer ${token}`} : {}
    });
    return {status: response.status, data: await response.json()};
  }, {endpoint, token});
}

function expectError(response, status, code) {
  assert.equal(response.status, status, JSON.stringify(response));
  assert.equal(response.data.error.code, code);
}

function sourceRevisions() {
  const appSha = process.env.TASK128_APP_SHA;
  assert.match(appSha || '', /^[0-9a-f]{40}$/, 'Set TASK128_APP_SHA to the full app commit SHA');
  const git = (...args) => execFileSync('git', args, {encoding: 'utf8'}).trim();
  const runnerSha = git('rev-parse', 'HEAD');
  git('diff', '--exit-code', appSha, '--', 'backend', 'frontend', 'compose.yaml', '.gitattributes');
  git('diff', '--exit-code', runnerSha, '--',
    'scripts/task128-u9-system.cjs', 'scripts/task128-cleanup.cjs', 'scripts/task123-u9-browser.cjs');
  return {appSha, runnerSha};
}

async function main() {
  const revisions = sourceRevisions();
  verifyStack();
  const browser = await chromium.launch({channel: process.env.TASK123_BROWSER || 'chrome', headless: true});
  const owner = await browser.newPage();
  const other = await browser.newPage();
  const versions = {
    ...revisions,
    chrome: browser.version(),
    node: process.version,
    docker: docker('version', '--format', '{{.Server.Version}}').trim(),
    sqlImage: docker('inspect', '--format', '{{.Config.Image}}', project + '-sqlserver-1').trim(),
    authMode: 'TU mock only'
  };
  let baseline;
  let originalError;
  try {
    const userA = await login(owner, ownerUrl, '6800000000');
    const userB = await login(other, otherUrl, '6800000001');
    assert.notEqual(userA, userB);
    baseline = snapshot();
    assert.equal(baseline.testTrigger, null);
    const response = await api(owner, '/api/courses');
    assert.equal(response.status, 200);
    const courses = ['CS261', 'CS101'].map(code => response.data.find(course => course.course_code === code));
    assert(courses.every(Boolean));
    for (const course of courses) {
      await createFixture(owner, 'guide', course);
      await createFixture(owner, 'summary', course);
    }
    const [guide, summary, otherGuide, otherSummary] = fixtures;
    let revokedToken;

    for (const [caseId, fixture] of [['U9-TC06', guide], ['U9-TC07', summary]]) {
      await runCase(caseId, async () => {
        await saveInReader(owner, ownerUrl, fixture);
        await openSaved(owner, fixture);
        await owner.reload();
        await checkCard(owner, fixture);
        revokedToken = await logout(owner);
        assert.equal(await login(owner, ownerUrl, '6800000000'), userA);
        await openSaved(owner, fixture);
        assert.deepEqual(bookmarkUsers(fixture.kind, fixture.id), [userA]);
        await screenshot(owner, caseId + '-after-relogin');
        return `${fixture.kind} UI PUT 200, same card after reload and login, one SQL bookmark`;
      });
    }

    await runCase('U9-TC08', async () => {
      for (const fixture of [otherGuide, otherSummary]) await saveInReader(owner, ownerUrl, fixture);
      await openSaved(owner, ...fixtures);
      assert.equal(await owner.locator('.saved-course-group').count(), 2);
      assert.equal(await owner.locator('.saved-card').count(), 4);
      const scores = owner.locator('.compact-review-score:not([hidden])');
      await scores.nth(3).waitFor({state: 'visible'});
      assert.deepEqual(await scores.allTextContents(), Array(4).fill('0 รีวิว'));
      await screenshot(owner, 'U9-TC08-two-course-groups');
      return 'Guide and PDF under CS261 and CS101, four distinct cards and four review counts';
    });

    await runCase('U9-TC09', async () => {
      for (const fixture of [guide, summary]) {
        for (let attempt = 0; attempt < 2; attempt++) {
          expectState(await api(owner, statePath(fixture), 'PUT'), fixture, true);
        }
        const button = await openReader(owner, ownerUrl, fixture, true);
        await button.press('Enter');
        await owner.locator(statusBox(fixture)).getByText('ได้บันทึกการแบ่งปันนี้ไปแล้ว').waitFor();
        assert.deepEqual(bookmarkUsers(fixture.kind, fixture.id), [userA]);
        await screenshot(owner, `U9-TC09-${fixture.kind}-duplicate`);
      }
      await openSaved(owner, guide, summary);
      return 'Both types return PUT 200 twice, display already saved, and keep one bookmark each';
    });

    await runCase('U9-TC10', async () => {
      for (const fixture of [guide, summary]) {
        const target = statePath(fixture);
        for (const token of [null, 'invalid-task128-token', revokedToken]) {
          expectError(await putWithAuthorization(owner, target, token), 401, 'AUTH_REQUIRED');
        }
        for (const endpoint of [
          `/api/saved-items/${fixture.kind}/0`, `/api/saved-items/course/${fixture.id}`,
          target + '?user_id=' + userB
        ]) {
          expectError(await api(owner, endpoint, 'PUT'), 422, 'INVALID_PARAMETERS');
        }
        expectError(await api(owner, target, 'PUT', {user_id: userB}), 422, 'INVALID_PARAMETERS');
        expectError(await api(owner, `/api/saved-items/${fixture.kind}/2147483647`, 'PUT'),
          404, fixture.kind.toUpperCase() + '_NOT_FOUND');
        expectState(await api(other, target), fixture, false);
        assert.deepEqual(bookmarkUsers(fixture.kind, fixture.id), [userA]);
      }
      const list = await api(other, '/api/saved-items');
      assert.equal(list.status, 200);
      assert.deepEqual(list.data.items, []);
      return 'Both types reject missing/invalid/revoked token (401), invalid input/forged owner (422), missing target (404); B stays empty';
    });

    await runCase('U9-TC11', async () => {
      const existing = [otherGuide, otherSummary];
      for (const fixture of existing) await saveInReader(other, otherUrl, fixture);
      const originalOwnerList = await api(owner, '/api/saved-items');
      assert.equal(originalOwnerList.status, 200);
      const expectedUsers = [userA, userB].sort((a, b) => a - b);
      const details = [];
      for (const fixture of [guide, summary]) {
        const button = await openReader(other, otherUrl, fixture, false);
        failBookmark(fixture.kind, fixture.id, userB);
        try {
          const [failed, refreshed] = await Promise.all([
            observe(other, fixture, 'PUT'), observe(other, fixture, 'GET'), button.press('Enter')
          ]);
          const failure = {status: failed.status(), data: await failed.json()};
          expectError(failure, 503, 'SAVED_ITEMS_UNAVAILABLE');
          expectState({status: refreshed.status(), data: await refreshed.json()}, fixture, false);
          await ready(other, bookmarkButton(fixture), false);
          const box = other.locator(statusBox(fixture));
          await box.getByText(failure.data.error.message).waitFor();
          assert.doesNotMatch(await box.innerText(), /เพิ่มในรายวิชาที่บันทึกแล้ว/);
          assert.deepEqual(bookmarkUsers(fixture.kind, fixture.id), [userA]);
          await screenshot(other, `U9-TC11-${fixture.kind}-sql-rejected`);
        } finally {
          faultSql('DROP TRIGGER dbo.task123_test_save');
        }
        expectState(await api(other, statePath(fixture)), fixture, false);
        const retained = await api(other, '/api/saved-items');
        assert.equal(retained.status, 200);
        assert.deepEqual(
          retained.data.items.map(item => [item.item_type, item.item_id]),
          existing.map(item => [item.kind, item.id])
        );
        for (const item of existing) {
          expectState(await api(other, statePath(item)), item, true);
          assert.deepEqual(bookmarkUsers(item.kind, item.id), expectedUsers);
        }
        assert.deepEqual(await api(owner, '/api/saved-items'), originalOwnerList);
        await openSaved(other, ...existing);
        assert.equal(await itemCard(other, fixture).count(), 0);
        await screenshot(other, `U9-TC11-${fixture.kind}-retained-bookmarks`);
        details.push({
          attempted: {kind: fixture.kind, id: fixture.id, putStatus: 503, saved: false},
          retainedByB: existing.map(({kind, id}) => ({kind, id, ui: true, sql: true})),
          ownerAUnchanged: true
        });
      }
      return {
        actual: 'Both UI PUTs return 503. B sees the error and GET confirms each attempted item is unsaved. Existing B Guide/PDF remain in UI and SQL; A is unchanged.',
        details
      };
    });

    await runCase('U9-TC12', async () => {
      for (const fixture of [guide, summary]) expectState(await api(owner, statePath(fixture), 'DELETE'), fixture, false);
      const legacy = await api(owner, `/api/saved-guides/${guide.id}`, 'PUT');
      assert.equal(legacy.status, 200, JSON.stringify(legacy));
      assert.deepEqual(legacy.data, {id: guide.id, saved: true});
      await saveInReader(owner, ownerUrl, summary);
      expectState(await api(owner, statePath(guide), 'PUT'), guide, true);
      await openSaved(owner, guide, summary);
      assert.deepEqual(bookmarkUsers(guide.kind, guide.id), [userA]);
      await screenshot(owner, 'U9-TC12-legacy-and-summary');
      return 'Legacy Guide and typed Summary coexist in one course; typed Guide PUT does not duplicate legacy row';
    });
  } catch (error) {
    originalError = error;
  }

  const outcome = await finishRun({
    fixtures,
    originalError,
    remove: ({kind, id}) => api(owner, (kind === 'guide' ? '/api/my-guides/' : '/api/summaries/') + id, 'DELETE'),
    verifyBaseline: () => {
      if (baseline && !isDeepStrictEqual(snapshot(), baseline)) {
        throw new Error('SQL fixture tables, PDF volume or scoped trigger differ from baseline');
      }
    }
  });
  try {
    writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({versions, results, ...outcome}, null, 2) + '\n');
  } finally {
    await browser.close();
  }
  if (outcome.cleanup.status === 'Pass') console.log('PASS cleanup restored SQL/PDF and removed scoped trigger');
  else console.error('Cleanup failed:', JSON.stringify(outcome.cleanup));
  if (originalError) throw originalError;
  assert.equal(outcome.cleanup.status, 'Pass', 'Task128 cleanup did not restore the test stack');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
