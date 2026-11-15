const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function client(fetch) {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/http-client.js'), 'utf8'), {
    window, fetch, AbortController, setTimeout, clearTimeout,
    sessionStorage: {getItem: () => 'session-token'}, localStorage: {getItem: () => 'legacy-token'}
  });
  return window.HttpClient;
}

test('transport preserves caller headers, bearer auth, HTTP errors and malformed response payloads', async () => {
  const calls = [];
  const api = client(async (url, init) => {
    calls.push([url, init]);
    return new Response(url === '/invalid' ? '<html>Unavailable</html>' : '{"detail":"Invalid"}', {status: 422});
  });
  const {response, payload} = await api.request('/api', {token: 'session', headers: {'X-Test': 'value'}});
  assert.equal(response.status, 422);
  assert.equal(payload.detail, 'Invalid');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer session');
  assert.equal(calls[0][1].headers['X-Test'], 'value');
  assert.equal(calls[0][1].cache, 'no-store');
  assert.equal((await api.request('/invalid')).payload, null);
});

test('transport timeout covers response-body reading and callers can still cancel', async () => {
  const api = client(async (_, init) => ({text: () => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')), {once: true});
  })}));
  await assert.rejects(api.request('/slow-body', {timeoutMs: 10}), /aborted/);
  const controller = new AbortController();
  const pending = api.request('/cancel', {timeoutMs: 1000, signal: controller.signal});
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, /aborted/);
});

test('summary client gives PDF upload, replacement and reading the same 120-second deadline', async () => {
  const calls = [];
  const file = new File(['%PDF-example'], 'original.pdf', {type: 'application/pdf'});
  const summary = {id: 41, course: {id: 2, course_code: 'CS261'}, title: 'Summary',
    owner: {id: 1, display_name: 'Student'}, file: {original_name: file.name, read_path: '/api/summaries/41/file'}};
  const window = {HttpClient: {token: () => 'session', request: async (url, options) => {
    calls.push(options.timeoutMs);
    return {response: {status: 200, ok: true}, payload: url.endsWith('/file') ? file : summary};
  }}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/summary-api.js'), 'utf8'),
    {window, FormData, URLSearchParams});
  await window.SummaryApi.publish(2, 'Summary', '', file);
  await window.SummaryApi.update(41, 2, 'Summary', '', file);
  await window.SummaryApi.openFile(41);
  assert.deepEqual(calls, [120_000, 120_000, 120_000]);
});
