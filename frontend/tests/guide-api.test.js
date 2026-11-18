const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../public/js/guide-api.js'), 'utf8');

function loadGuideApi({token = 'test-token', apiBaseUrl = 'http://127.0.0.1:8000',
  fetchImpl = async () => new Response('{}')} = {}) {
  const values = new Map(token ? [['access_token', token]] : []);
  const calls = [];
  const redirects = [];
  const window = {
    AppConfig: require('../public/js/app-config'),
    GuideConfig: {apiBaseUrl, tokenStorageKey: 'access_token',
      mePath: '/api/auth/me', myGuidesPath: '/api/my-guides', coursesPath: '/courses', publishPath: '/guides', timeoutMs: 15000},
    LoginConfig: {tokenStorageKey: 'access_token'},
    location: {origin: 'http://frontend', replace: url => redirects.push(url)}
  };
  const context = {
    window,
    sessionStorage: {
      getItem: key => values.get(key) ?? null,
      removeItem: key => values.delete(key)
    },
    localStorage: {
      getItem: key => values.get(key) ?? null,
      removeItem: key => values.delete(key)
    },
    fetch: (...args) => { calls.push(args); return fetchImpl(...args); },
    URL, URLSearchParams, AbortController, Response, setTimeout, clearTimeout
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/http-client.js'), 'utf8'), context);
  vm.runInNewContext(source, context, {filename: 'guide-api.js'});
  return {api: window.GuideApi, calls, redirects, values};
}

test('guide read and publish use the same-origin proxy without a preview fallback', async () => {
  const client = loadGuideApi({fetchImpl: async () => new Response(JSON.stringify({
    id: 12, title: 'แนวข้อสอบ', academic_year: 2568, semester: 1, exam_period: 'midterm',
    publisher_name: 'ผู้เผยแพร่', course: {id: 4, course_code: 'CS261', course_name: 'วิชา', instructor_names: 'อาจารย์'},
    topics: 'หัวข้อ', exam_format: 'mixed', objective_count: 10, subjective_count: 2,
    additional_advice: null
  }))});

  const detail = await client.api.read(12, 'CS261');
  assert.equal(detail.course.course_code, 'CS261');
  assert.equal(client.calls[0][0], '/api/guides/12');
  assert.equal(client.calls[0][1].headers.Authorization, 'Bearer test-token');
  await assert.rejects(client.api.publish({}, 'CS261'), /ยืนยันรายการที่สร้างไม่ได้/);
  assert.equal(client.calls[1][0], '/api/guides');
  assert.equal(client.calls[1][1].method, 'POST');
});

test('guide read client accepts zero legacy question counts', async () => {
  const client = loadGuideApi({fetchImpl: async () => new Response(JSON.stringify({
    id: 12, title: 'แนวข้อสอบ', academic_year: 2568, semester: 1, exam_period: 'midterm',
    publisher_name: 'ผู้เผยแพร่', course: {id: 4, course_code: 'CS261', course_name: 'วิชา'},
    topics: 'หัวข้อ', exam_format: 'mixed', objective_count: 0, subjective_count: null,
    additional_advice: null
  }))});
  const row = await client.api.read(12, 'CS261');
  assert.equal(row.objective_count, 0);
});

test('guide list client sends database filters and maps rows without preview data', async () => {
  const client = loadGuideApi({fetchImpl: async () => new Response(JSON.stringify({
    course_id: 27,
    items: [{id: 31, title: 'กลางภาค', academic_year: 2568, semester: 1,
      exam_period: 'midterm', publisher_name: 'ผู้เผยแพร่'}]
  }))});

  const rows = await client.api.list(27, {academic_year: '2568', semester: '1', exam_period: 'midterm'});
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [{
    id: '31', title: 'กลางภาค', year: '2568', semester: '1',
    period: 'กลางภาค', publisher_name: 'ผู้เผยแพร่'
  }]);
  assert.equal(client.calls[0][0], '/api/guides/courses/27/guides?academic_year=2568&semester=1&exam_period=midterm');
});

test('my guides client maps the flat API DTO without adding preview fields', async () => {
  const client = loadGuideApi({fetchImpl: async () => new Response(JSON.stringify([{
    id: 31, course_id: 902, course_code: 'CS902', course_name: 'วิชานอกตัวอย่าง',
    instructor_name: null, title: 'แนวสอบจริง', academic_year: 2568, semester: 2,
    exam_period: 'final', topics: 'กราฟ', exam_format: 'mixed',
    objective_count: 0, subjective_count: null, additional_advice: null
  }]))});

  const rows = await client.api.mine();
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [{
    id: '31', course_id: 902, course_code: 'CS902', course_name: 'วิชานอกตัวอย่าง',
    instructor_name: null, title: 'แนวสอบจริง', year: '2568', semester: '2',
    period: 'ปลายภาค', formats: ['ผสม'], topics: 'กราฟ', notes: '',
    objective_count: 0, essay_count: null
  }]);
  assert.equal(client.calls[0][0], '/api/my-guides');
  assert.equal(client.calls[0][1].headers.Authorization, 'Bearer test-token');
});

test('my guides client rejects malformed DTOs and preserves the empty list', async () => {
  const empty = loadGuideApi({fetchImpl: async () => new Response('[]')});
  assert.deepEqual(JSON.parse(JSON.stringify(await empty.api.mine())), []);
  const malformed = loadGuideApi({fetchImpl: async () => new Response('[{"id":1,"course_code":"CS999"}]')});
  await assert.rejects(malformed.api.mine(), /ข้อมูลรายการแนวข้อสอบของฉันไม่ถูกต้อง/);
});

test('my guides client redirects when the token is missing or expired', async () => {
  const missing = loadGuideApi({token: ''});
  await assert.rejects(missing.api.mine(), error => error.status === 401);
  assert.deepEqual(missing.redirects, ['login.html']);

  const expired = loadGuideApi({fetchImpl: async () => new Response('{"detail":"expired"}', {status: 401})});
  await assert.rejects(expired.api.mine(), error => error.status === 401);
  assert.deepEqual(expired.redirects, ['login.html']);
});

test('update client uses PUT on the same-origin owned-guide proxy and validates the returned identity', async () => {
  const dto = {id: 7, course_id: 13, course_code: 'CS263', course_name: 'New course',
    title: 'Updated', academic_year: 2569, semester: 1, exam_period: 'final',
    topics: 'Topics', exam_format: 'mixed', subjective_count: null, objective_count: 3};
  const client = loadGuideApi({fetchImpl: async () => new Response(JSON.stringify(dto))});
  const row = await client.api.update('7', {course_id: 13});
  assert.equal(row.course_code, 'CS263');
  assert.equal(client.calls[0][0], '/api/my-guides/7');
  assert.equal(client.calls[0][1].method, 'PUT');
  await assert.rejects(client.api.update('8', {course_id: 13}), /ยืนยันรายการที่แก้ไขไม่ได้/);
});

test('delete client uses the owned-guide proxy and validates the deleted record identity', async () => {
  const client = loadGuideApi({fetchImpl: async () => new Response('{"id":7,"message":"deleted"}')});
  const result = await client.api.remove('7');
  assert.equal(result.id, 7);
  assert.equal(client.calls[0][0], '/api/my-guides/7');
  assert.equal(client.calls[0][1].method, 'DELETE');
  assert.equal(client.calls[0][1].headers.Authorization, 'Bearer test-token');

  const mismatch = loadGuideApi({fetchImpl: async () => new Response('{"id":8,"message":"deleted"}')});
  await assert.rejects(mismatch.api.remove('7'), error => error.uncertain);
});

test('guide client sends publish through the same-origin proxy and keeps auth and course reads on their existing proxies', async () => {
  const client = loadGuideApi({fetchImpl: async url => {
    if (url === '/api/auth/me') return new Response('{"id":8,"username":"student"}');
    if (url === '/api/courses') return new Response('[{"id":4,"course_code":"CS261","course_name":"วิชา"}]');
    return new Response(JSON.stringify({
      id: 32, title: 'แนวข้อสอบ', academic_year: 2568, semester: 1, exam_period: 'midterm',
      publisher_name: 'ผู้เผยแพร่', course: {id: 4, course_code: 'CS261', course_name: 'วิชา', instructor_names: null},
      topics: 'หัวข้อ', exam_format: 'objective', objective_count: 10, subjective_count: null,
      additional_advice: null
    }), {status: 201});
  }});
  await client.api.currentUser();
  await client.api.courses();
  await client.api.publish({course_id: 4}, 'CS261');
  assert.equal(client.calls[0][0], '/api/auth/me');
  assert.equal(client.calls[1][0], '/api/courses');
  assert.equal(client.calls[2][0], '/api/guides');
  assert.equal(client.calls[2][1].method, 'POST');
  assert.deepEqual(JSON.parse(client.calls[2][1].body), {course_id: 4});
  assert.equal(client.calls[2][1].headers.Authorization, 'Bearer test-token');
});

test('guide client redirects when login is missing and clears an expired token', async () => {
  const missing = loadGuideApi({token: ''});
  await assert.rejects(missing.api.filterOptions(27), error => error.status === 401);
  assert.deepEqual(missing.redirects, ['login.html']);

  const expired = loadGuideApi({fetchImpl: async () => new Response('{"error":{"code":"AUTH_REQUIRED"}}', {status: 401})});
  await assert.rejects(expired.api.read(31, 'CS261'), error => error.status === 401);
  assert.deepEqual(expired.redirects, ['login.html']);
  assert.equal(expired.values.has('access_token'), false);
});
