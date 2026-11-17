const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../public/js/course-api.js'), 'utf8');

function loadCourseApi({token = 'test-token', fetchImpl = async () => new Response('[]')} = {}) {
  const values = new Map(token ? [['access_token', token]] : []);
  const redirects = [];
  const calls = [];
  const window = {
    AppConfig: require('../public/js/app-config'),
    LoginConfig: {tokenStorageKey: 'access_token'},
    location: {replace: url => redirects.push(url)}
  };
  const context = {
    window,
    sessionStorage: {
      getItem: key => values.get(key) ?? null,
      removeItem: key => values.delete(key)
    },
    fetch: (...args) => {
      calls.push(args);
      return fetchImpl(...args);
    },
    URLSearchParams,
    AbortController, setTimeout, clearTimeout,
    Response
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/http-client.js'), 'utf8'), context);
  vm.runInNewContext(source, context, {filename: 'course-api.js'});
  return {api: window.CourseApi, calls, redirects, values};
}

test('course client sends a same-origin authenticated search and maps the DTO', async () => {
  const client = loadCourseApi({fetchImpl: async () => new Response(JSON.stringify([
    {id: 17, course_code: 'CS777', course_name: 'ชื่อ <วิชา>', description: null}
  ]), {status: 200})});
  const courses = await client.api.searchCourses(' CS777 ');
  assert.deepEqual(JSON.parse(JSON.stringify(courses)), [{
    id: 17, code: 'CS777', name: 'ชื่อ <วิชา>', instructorName: null, description: null
  }]);
  assert.equal(client.calls[0][0], '/api/courses?search=CS777');
  assert.equal(client.calls[0][1].headers.Authorization, 'Bearer test-token');
});

test('course client redirects when there is no token', async () => {
  const client = loadCourseApi({token: ''});
  await assert.rejects(client.api.searchCourses('CS777'), error => error.status === 401);
  assert.deepEqual(client.redirects, ['login.html']);
  assert.equal(client.calls.length, 0);
});

test('course client clears an expired token and redirects on 401', async () => {
  const client = loadCourseApi({fetchImpl: async () => new Response('{"error":{"code":"AUTH_REQUIRED"}}', {status: 401})});
  await assert.rejects(client.api.getCourse(17), error => error.status === 401);
  assert.deepEqual(client.redirects, ['login.html']);
  assert.equal(client.values.has('access_token'), false);
});

test('course client keeps API status and error message for a missing course', async () => {
  const client = loadCourseApi({fetchImpl: async () => new Response(
    '{"error":{"code":"COURSE_NOT_FOUND","message":"ไม่พบรายวิชา"}}', {status: 404}
  )});
  await assert.rejects(client.api.getCourse(999), error => error.status === 404 && /ไม่พบรายวิชา/.test(error.message));
});
