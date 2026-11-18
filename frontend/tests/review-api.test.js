const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const target = {type: 'guide', id: 12};
const review = {id: 5, target_type: 'guide', target_id: 12, author: {id: 7, display_name: 'Student'}, rating: 4, comment: null};

function api(write = async () => ({response: {ok: true, status: 201}, payload: review})) {
  const calls = [];
  const window = {AppConfig: require('../public/js/app-config'), HttpClient: {
    token: () => 'test-session',
    request: async (url, options) => {
      calls.push([url, options.method]);
      return options.method === 'GET'
        ? {response: {ok: true, status: 200}, payload: {target_type: 'guide', target_id: 12, items: [review]}}
        : write();
    }
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/review-api.js'), 'utf8'), {window});
  return {client: window.ReviewApi, calls};
}

test('review reads share a cached result until a write makes that result stale', async () => {
  const {client, calls} = api();
  await client.read(target);
  await client.read(target);
  assert.equal(calls.length, 1);
  await client.write(target, {method: 'POST', authorId: 7, body: {rating: 4}});
  await client.read(target);
  assert.deepEqual(calls.map(call => call[1]), ['GET', 'POST', 'GET']);
});

test('an uncertain review write also discards cached data before the next read', async () => {
  const {client, calls} = api(async () => ({response: {ok: false, status: 503}, payload: {error: {code: 'STORAGE_UNAVAILABLE', message: 'Unavailable'}}}));
  await client.read(target);
  await assert.rejects(client.write(target, {method: 'POST', authorId: 7}), error => error.status === 503);
  await client.read(target);
  assert.deepEqual(calls.map(call => call[1]), ['GET', 'POST', 'GET']);
});
