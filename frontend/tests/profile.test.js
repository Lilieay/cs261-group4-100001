const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const tick = () => new Promise(resolve => setImmediate(resolve));

function profile({token = 'session', logout = async () => new Response('{}')} = {}) {
  const button = {listeners: {}, setAttribute() {}, addEventListener(type, callback) { this.listeners[type] = callback; }};
  const status = {}, redirects = [], calls = [];
  const session = new Map(token ? [['access_token', token]] : []), local = new Map([['access_token', 'old-token']]);
  const storage = values => ({getItem: key => values.get(key), removeItem: key => values.delete(key)});
  const window = {location: {replace: value => redirects.push(value)}};
  const context = {
    window, sessionStorage: storage(session), localStorage: storage(local), AbortController, setTimeout, clearTimeout,
    document: {querySelectorAll: selector => selector === '[data-logout]' ? [button] : [], getElementById: () => status},
    fetch: async (url, init) => {
      calls.push([url, init]);
      return url.endsWith('/logout') ? logout() : new Response('{"username":"one","display_name":"Student"}');
    }
  };
  for (const file of ['http-client.js', 'profile.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js', file), 'utf8'), context);
  }
  return {button, status, calls, redirects, session, local};
}

test('logout revokes the server session, clears both token stores and prevents duplicate clicks', async () => {
  let resolve;
  const p = profile({logout: () => new Promise(done => { resolve = done; })});
  await tick();
  const pending = p.button.listeners.click();
  p.button.listeners.click();
  assert.equal(p.calls.filter(([url]) => url.endsWith('/logout')).length, 1);
  assert.equal(p.calls.at(-1)[1].headers.Authorization, 'Bearer session');
  assert.equal(p.button.disabled, true);
  resolve(new Response('{}')); await pending;
  assert.equal(p.session.size, 0); assert.equal(p.local.size, 0);
  assert.deepEqual(p.redirects, ['login.html']);
});

test('failed logout keeps the token and permits retry; no session redirects to login', async () => {
  const failed = profile({logout: async () => { throw new Error('offline'); }});
  await tick(); await failed.button.listeners.click();
  assert.equal(failed.session.get('access_token'), 'session');
  assert.equal(failed.button.disabled, false);
  assert.match(failed.status.textContent, /ออกจากระบบไม่สำเร็จ/);
  const anonymous = profile({token: null});
  await tick(); assert.deepEqual(anonymous.redirects, ['login.html']);
});
