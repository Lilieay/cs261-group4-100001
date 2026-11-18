const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function editor(update = async () => ({})) {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', disabled: false, hidden: false, validity: {badInput: false}, listeners: {},
      addEventListener(type, callback) { this.listeners[type] = callback; },
      setAttribute() {}, focus() {}, replaceChildren() {}
    });
    return elements.get(id);
  };
  const submit = get('submit'), cancel = get('cancel');
  const form = get('edit-form');
  form.reset = () => {};
  form.querySelector = selector => selector === '[type="submit"]' ? submit : cancel;
  form.querySelectorAll = () => [...elements.values()];
  const dialog = get('editor');
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; };
  const window = {AppConfig: require('../public/js/app-config'), GuideApi: {courses: async () => [{id: 4, code: 'CS261', name: 'Old'}, {id: 13, code: 'CS263', name: 'New'}], update}};
  const document = {querySelector: selector => get(selector.slice(1)), getElementById: get, createElement: () => ({})};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/edit-form.js'), 'utf8'), {window, document});
  const row = {id: '7', course_id: 4, title: 'Original', year: '2569', semester: '1', period: 'ปลายภาค',
    formats: ['ผสม'], essay_count: '2', objective_count: '3', topics: 'Topics', notes: 'Advice'};
  return {get, dialog, cancel, open: saved => window.GuideEditor.open(row, saved), submit: () => form.listeners.submit({preventDefault() {}})};
}

test('editor updates and moves the existing guide then refreshes the list once', async () => {
  const calls = [];
  const page = editor(async (id, payload) => { calls.push({id, payload}); });
  let saved = 0;
  await page.open(async () => { saved += 1; });
  page.get('edit-course').value = '13';
  page.get('edit-title').value = '  Updated  ';
  await page.submit();
  assert.equal(calls[0].id, '7');
  assert.equal(calls[0].payload.course_id, 13);
  assert.equal(calls[0].payload.title, 'Updated');
  assert.equal(calls[0].payload.subjective_count, 2);
  assert.equal(saved, 1);
  assert.equal(page.dialog.open, false);
});

test('editor rejects blank titles and non-positive counts, and cancel never writes', async () => {
  let calls = 0;
  const page = editor(async () => { calls += 1; });
  await page.open(async () => {});
  page.get('edit-title').value = ' ';
  page.get('edit-objective-count').value = '0';
  await page.submit();
  assert.equal(calls, 0);
  assert.equal(page.get('edit-title-error').hidden, false);
  assert.equal(page.get('edit-objective-count-error').hidden, false);
  page.get('edit-title').value = 'a'.repeat(201);
  page.get('edit-objective-count').value = '1';
  await page.submit();
  assert.equal(calls, 0);
  assert.match(page.get('edit-title-error').textContent, /200/);
  page.cancel.listeners.click();
  assert.equal(page.dialog.open, false);
  assert.equal(calls, 0);
});

test('editor retains inputs on API failure and prevents duplicate submissions while pending', async () => {
  let reject, calls = 0;
  const pending = new Promise((_, fail) => { reject = fail; });
  const page = editor(() => { calls += 1; return pending; });
  await page.open(async () => { throw new Error('must not report success'); });
  const saving = page.submit();
  await page.submit();
  assert.equal(calls, 1);
  reject(Object.assign(new Error('offline'), {status: 502}));
  await saving;
  assert.equal(page.dialog.open, true);
  assert.equal(page.get('edit-title').value, 'Original');
  assert.match(page.get('edit-error').textContent, /ยืนยันผลการแก้ไขไม่ได้/);
});

test('editor accepts academic years 2566 through 2569', async () => {
  for (const year of [2566, 2567, 2568, 2569]) {
    const calls = [];
    const page = editor(async (_id, payload) => { calls.push(payload); });
    await page.open(async () => {});
    page.get('edit-year').value = String(year);
    await page.submit();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].academic_year, year);
  }
});

test('editor rejects academic years outside 2566 through 2569 before sending', async () => {
  for (const year of [2565, 2570]) {
    let calls = 0;
    const page = editor(async () => { calls += 1; });
    await page.open(async () => {});
    page.get('edit-year').value = String(year);
    await page.submit();
    assert.equal(calls, 0);
    assert.equal(page.get('edit-year-error').hidden, false);
    assert.equal(page.dialog.open, true);
  }
});
