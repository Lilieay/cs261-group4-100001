const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const tick = () => new Promise(resolve => setImmediate(resolve));

function reader(state) {
  const elements = new Map();
  const events = {};
  const get = id => {
    if (!elements.has(id)) elements.set(id, {
      listeners: {}, attributes: {}, classList: {toggle() {}},
      addEventListener(type, callback) { this.listeners[type] = callback; },
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; },
      focus() {}
    });
    return elements.get(id);
  };
  const window = {
    location: {search: '?summary=12&source=saved'},
    SavedItems: {state},
    SummaryApi: {
      read: async () => ({id: 12, title: 'Test PDF', owner: {display_name: 'Owner'}, course: {id: 1}, file: {original_name: 'test.pdf'}}),
      openFile: async () => new Blob(['PDF'])
    },
    CourseApi: {getCourse: async () => ({})},
    addEventListener: (type, callback) => { events[type] = callback; }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/read-summary.js'), 'utf8'),
    {window, document: {getElementById: get}, URL, URLSearchParams, AbortController});
  return {get, events};
}

test('U9 PDF reader refreshes on focus and skips the refresh while PUT is pending', async () => {
  let saved = true;
  let finishWrite;
  const calls = [];
  const {get, events} = reader(async (type, id, desired) => {
    assert.equal(type, 'summary');
    assert.equal(id, 12);
    calls.push(desired);
    if (desired === undefined) return saved;
    return new Promise(resolve => {
      finishWrite = () => { saved = true; resolve(true); };
    });
  });
  await tick();
  assert.equal(get('summary-save-label').textContent, 'บันทึกแล้ว');
  saved = false; // Another tab removed the bookmark.
  await events.focus();
  assert.equal(get('summary-save-label').textContent, 'บันทึก');
  assert.equal(get('summary-save').disabled, false);
  const writing = get('summary-save').listeners.click();
  await events.focus();
  assert.equal(get('summary-save').disabled, true);
  assert.deepEqual(calls, [undefined, undefined, true]);
  finishWrite();
  await writing;
  assert.equal(get('summary-save-label').textContent, 'บันทึกแล้ว');
  events.pagehide();
});

for (const [latest, issue] of [
  [false, 'จัดการรายการที่บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง'],
  [true, 'ยังยืนยันผลไม่ได้ กรุณาโหลดสถานะล่าสุด']
]) {
  test(`U9 PDF reader keeps the PUT outcome separate from the refreshed state saved=${latest}`, async () => {
    let saved = false;
    const calls = [];
    const {get, events} = reader(async (_type, _id, desired) => {
      calls.push(desired);
      if (desired === undefined) return saved;
      saved = latest;
      throw Object.assign(new Error(issue), {status: 503});
    });
    await tick();
    await get('summary-save').listeners.click();
    assert.deepEqual(calls, [undefined, true, undefined]);
    assert.equal(get('summary-save').attributes['aria-pressed'], String(latest));
    assert.equal(get('summary-save-status').textContent, issue);
    await events.focus();
    assert.equal(get('summary-save-status').textContent, issue);
    events.pagehide();
  });
}

test('U9 bookmark client preserves Backend 503 detail and reports an unknown result on a lost connection', async () => {
  const unknown = 'ยังยืนยันผลไม่ได้ กรุณาโหลดสถานะล่าสุด';
  const failed = 'จัดการรายการที่บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง';
  const outcomes = [failed, unknown, null];
  const window = {HttpClient: {
    token: () => 'test-token',
    async request() {
      const message = outcomes.shift();
      if (message === null) throw new Error('offline');
      return {response: {ok: false, status: 503}, payload: {error: {code: 'SAVED_ITEMS_UNAVAILABLE', message}}};
    }
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/saved-items.js'), 'utf8'), {window});
  for (const [status, message] of [[503, failed], [503, unknown], [0, unknown]]) {
    await assert.rejects(window.SavedItems.state('summary', 12, true), error =>
      error.status === status && error.message === message);
  }
});
