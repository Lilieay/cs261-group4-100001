const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const tick = () => new Promise(resolve => setImmediate(resolve));

function page({saved = async () => [], savedState = async () => false} = {}) {
  const elements = new Map(), events = {};
  const get = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      value: '', dataset: {}, listeners: {}, setAttribute() {}, focus() {},
      addEventListener(type, callback) { this.listeners[type] = callback; }
    });
    return elements.get(selector);
  };
  const window = {SavedItems: {list: saved, state: savedState},
    UiUtils: {escapeHtml: value => String(value).replaceAll('<', '&lt;')},
    addEventListener: (type, callback) => { events[type] = callback; }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/saved-courses.js'), 'utf8'),
    {window, document: {querySelector: get}, URLSearchParams});
  return {get, events};
}

const course = {id: 4, course_code: 'CS261', course_name: 'Software Engineering'};
const row = {item_id: 12, item_type: 'guide', course, title: '<Saved title>'};
const summary = {item_id: 12, item_type: 'summary', course, title: 'Saved summary'};

test('saved page reads API data, escapes text, filters, and links to the API reading page', async () => {
  const {get} = page({saved: async () => [row, summary]});
  await tick();
  assert.match(get('#saved-list').innerHTML, /&lt;Saved title>/);
  assert.match(get('#saved-list').innerHTML, /source=api/);
  assert.match(get('#saved-list').innerHTML, /courseId=4/);
  assert.match(get('#saved-count').textContent, /2 รายการ/);
  assert.match(get('#saved-list').innerHTML, /read-summary.html\?summary=12/);
  assert.equal((get('#saved-list').innerHTML.match(/class="saved-course-group"/g) || []).length, 1);
  get('#saved-search').value = 'unmatched';
  get('#saved-search').listeners.input();
  assert.match(get('#saved-list').innerHTML, /ไม่พบรายการที่ตรง/);
});

test('saved page prevents duplicate removal and removes a row only after API success', async () => {
  let resolve, calls = 0;
  const {get} = page({saved: async () => [row, summary], savedState: (type, id, value) => {
    assert.equal(type, 'guide');
    assert.equal(id, '12'); assert.equal(value, false); calls++;
    return new Promise(done => { resolve = done; });
  }});
  await tick();
  const click = {target: {closest: selector => selector === '[data-unsave]' ? {dataset: {unsave: '12', itemType: 'guide'}} : null}};
  const pending = get('#saved-list').listeners.click(click);
  get('#saved-list').listeners.click(click);
  assert.equal(calls, 1);
  assert.match(get('#saved-count').textContent, /2 รายการ/);
  resolve(false); await pending;
  assert.match(get('#saved-list').innerHTML, /Saved summary/);
  assert.doesNotMatch(get('#saved-list').innerHTML, /Saved title/);
});

test('saved page rejects stale refreshes and reloads an uncertain removal', async () => {
  let calls = 0, resolveOld;
  const {get, events} = page({saved: () => {
    calls++;
    if (calls === 2) return new Promise(resolve => { resolveOld = resolve; });
    return Promise.resolve(calls === 1 ? [row] : []);
  }});
  await tick();
  const old = events.focus();
  const newest = events.focus();
  await newest;
  resolveOld([row]); await old;
  assert.match(get('#saved-list').innerHTML, /ยังไม่มีรายการที่บันทึก/);
  let uncertainReads = 0;
  const uncertain = page({saved: async () => (++uncertainReads === 1 ? [row] : []),
    savedState: async () => { throw new Error('uncertain'); }});
  await tick();
  await uncertain.get('#saved-list').listeners.click({target: {closest: selector =>
    selector === '[data-unsave]' ? {dataset: {unsave: '12', itemType: 'guide'}} : null}});
  assert.match(uncertain.get('#saved-status').textContent, /uncertain/);
  assert.match(uncertain.get('#saved-list').innerHTML, /ยังไม่มีรายการที่บันทึก/);
});

test('saved page provides retry on API failure', async () => {
  const failed = page({saved: async () => { throw new Error('API unavailable'); }});
  await tick();
  assert.match(failed.get('#saved-list').innerHTML, /API unavailable/);
  assert.match(failed.get('#saved-list').innerHTML, /saved-retry/);
});
