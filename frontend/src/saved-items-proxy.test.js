const test = require('node:test');
const assert = require('node:assert/strict');
const {createApp} = require('./server');

test('U10 proxy forwards list/remove and exact Guide alias, preserves errors and rejects extra inputs', async t => {
  const originalFetch = global.fetch;
  const calls = [];
  let failure = false;
  let unauthorized = false;
  global.fetch = async (url, options) => {
    calls.push([String(url), options]);
    if (failure) throw new Error('offline');
    if (unauthorized) return new Response(JSON.stringify({error: {code: 'AUTH_REQUIRED', message: 'Login', fields: []}}),
      {status: 401, headers: {'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer'}});
    const body = options.method === 'DELETE'
      ? {item_type: 'summary', item_id: 101, saved: false}
      : String(url).endsWith('/guides/42') ? {id: 42} : {items: []};
    return new Response(JSON.stringify(body), {headers: {'Content-Type': 'application/json'}});
  };
  const server = createApp({backendUrl: 'http://backend.test'}).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { global.fetch = originalFetch; server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = {Authorization: 'Bearer synthetic'};
  for (const [path, method, upstream] of [
    ['/api/saved-items', 'GET', '/api/saved-items'],
    ['/api/saved-items/summary/101', 'DELETE', '/api/saved-items/summary/101'],
    ['/api/guides/42', 'GET', '/guides/42'],
    ['/api/guides/guides/42', 'GET', '/guides/42'],
  ]) {
    const response = await originalFetch(base + path, {method, headers});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(calls.at(-1)[0], `http://backend.test${upstream}`);
    assert.equal(calls.at(-1)[1].headers.Authorization, headers.Authorization);
  }
  const before = calls.length;
  for (const path of ['/api/saved-items?user_id=2', '/api/saved-items/course/1',
    '/api/saved-items/guide/1.0', '/api/saved-items/guide/2147483648', '/api/guides/1?x=1']) {
    assert.equal((await originalFetch(base + path, {headers})).status, 422);
  }
  assert.equal((await originalFetch(base + '/api/saved-items/guide/42',
    {method: 'DELETE', headers, body: '{}'})).status, 422);
  assert.equal(calls.length, before);
  unauthorized = true;
  const denied = await originalFetch(base + '/api/saved-items', {headers});
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get('www-authenticate'), 'Bearer');
  failure = true;
  const offline = await originalFetch(base + '/api/saved-items', {headers});
  assert.equal(offline.status, 502);
  assert.deepEqual((await offline.json()).error, {
    code: 'UPSTREAM_UNAVAILABLE', message: 'เชื่อมต่อบริการรายการที่บันทึกไม่สำเร็จ', fields: []
  });
});
