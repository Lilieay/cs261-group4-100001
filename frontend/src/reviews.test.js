const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

class Element {
  constructor() {
    this.elements = new Map();
    this.children = [];
    this.listeners = {};
    this.dataset = {};
    this.classList = {add() {}, remove() {}};
    this.style = {};
    this.value = '';
  }

  get childElementCount() { return this.children.length; }
  querySelector(selector) {
    if (!this.elements.has(selector)) this.elements.set(selector, new Element());
    return this.elements.get(selector);
  }
  querySelectorAll() { return []; }
  matches() { return false; }
  setAttribute() {}
  removeAttribute() {}
  contains() { return true; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  cloneNode() { return new Element(); }
  focus() {}
  showModal() { this.open = true; }
  addEventListener(event, listener) { this.listeners[event] = listener; }
}

const tick = () => new Promise(resolve => setImmediate(resolve));
const currentUser = {id: 7, username: 'student', display_name: 'Student'};
const ok = payload => ({response: {ok: true, status: 200}, payload});
const unavailable = {response: {ok: false, status: 503}, payload: {error: {code: 'STORAGE_UNAVAILABLE'}}};

function reviewPage({type, profile, items, write = () => unavailable}) {
  const dialog = new Element();
  const actions = action => dialog.querySelector(`[data-review-action="${action}"]`);
  const target = {id: 12, type, title: 'เอกสารทดสอบ', ownerId: 99};
  const calls = [];
  const window = {
    GuideApi: {mine: async () => []},
    HttpClient: {
      clearToken() {},
      token: () => 'mock-session',
      async request(endpoint, options) {
        calls.push([endpoint, options.method || 'GET', options.body]);
        if (endpoint === '/api/auth/me') return profile();
        if (options.method === 'GET') return ok({target_id: target.id, target_type: type, items: items()});
        return write();
      }
    }
  };
  const context = {
    window,
    document: {
      body: new Element(),
      createElement: () => dialog,
      createElementNS: () => new Element(),
      getElementById: () => null,
      querySelectorAll: () => []
    },
    fetch: async () => ({ok: true, text: async () => ''}),
    DOMParser: class {
      parseFromString() { return {getElementById: () => ({content: new Element()})}; }
    }
  };
  dialog.querySelector('.review-editor').reset = () => {};
  for (const file of ['profile.js', 'reviews.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js', file), 'utf8'), context);
  }
  window.Reviews.open(target, new Element());
  return {
    calls, dialog, actions,
    notice: () => dialog.querySelector('[data-review-message]').textContent,
    click: action => dialog.listeners.click({target: {closest: () => ({dataset: {reviewAction: action}})}}),
    submit(rating, comment) {
      dialog.querySelector('input[name="rating"]:checked').value = String(rating);
      dialog.querySelector('#review-comment').value = comment;
      dialog.listeners.submit({preventDefault() {}});
    }
  };
}

const ownReview = (type, values = {}) => ({
  id: 22, target_type: type, target_id: 12, author: {id: 7, display_name: 'Student'},
  rating: 4, comment: 'ใช้ทบทวนได้', ...values
});

for (const type of ['guide', 'summary']) {
  test(`U8 ${type} does not report a no-op PUT with a 503 as saved`, async () => {
    const row = ownReview(type);
    const page = reviewPage({type, profile: () => ok(currentUser), items: () => [row]});
    await tick();
    assert.equal(page.dialog.querySelector('[data-review-own-review]').hidden, false);
    await page.click('edit');
    page.submit(row.rating, row.comment);
    await tick();
    assert.match(page.notice(), /ยังยืนยันผลการบันทึกครั้งนี้ไม่ได้/);
    assert.equal(page.dialog.querySelector('[data-review-editor]').hidden, false);
    assert.deepEqual(page.calls.filter(([, method]) => method === 'PUT'),
      [['/api/reviews/22', 'PUT', JSON.stringify({rating: row.rating, comment: row.comment})]]);
    assert.equal(page.calls.filter(([endpoint]) => endpoint.endsWith('/reviews')).length, 2);
  });

  test(`U8 ${type} keeps reviews readable when the profile fails and retries the account request`, async () => {
    let profileCalls = 0;
    const page = reviewPage({
      type,
      profile: () => ++profileCalls === 1 ? unavailable : ok(currentUser),
      items: () => [ownReview(type)]
    });
    await tick();
    assert.equal(page.dialog.querySelector('[data-review-community]').hidden, false);
    assert.equal(page.dialog.querySelector('[data-review-own-review]').hidden, true);
    assert.equal(page.dialog.querySelector('[data-review-editor]').hidden, true);
    assert.equal(page.actions('add').hidden, true);
    assert.equal(page.actions('retry-profile').hidden, false);
    await page.click('retry-profile');
    await tick();
    assert.equal(profileCalls, 2);
    assert.equal(page.calls.filter(([endpoint]) => endpoint.endsWith('/reviews')).length, 1);
    assert.equal(page.dialog.querySelector('[data-review-own-review]').hidden, false);
    assert.equal(page.actions('retry-profile').hidden, true);
  });
}

test('U8 does not confirm an uncertain edit using a different review ID with matching values', async () => {
  const original = ownReview('guide');
  const replacement = ownReview('guide', {id: 38, rating: 5, comment: 'คะแนนใหม่'});
  let reads = 0;
  const page = reviewPage({
    type: 'guide', profile: () => ok(currentUser), items: () => [++reads === 1 ? original : replacement]
  });
  await tick();
  await page.click('edit');
  page.submit(replacement.rating, replacement.comment);
  await tick();
  assert.match(page.notice(), /รีวิวของคุณมีการเปลี่ยนแปลง/);
  assert.equal(page.dialog.querySelector('[data-review-editor]').hidden, true);
});
