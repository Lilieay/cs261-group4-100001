const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const original = {
  id: 41, course: {id: 2, course_code: 'CS261', course_name: 'Algorithms'},
  title: 'Original', description: 'Original description', file: {original_name: 'original.pdf'}
};

class Element {
  constructor(id) {
    this.id = id;
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.listeners = {};
    this.attributes = {};
  }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  replaceChildren() {}
  add() {}
  focus() {}
  showModal() { this.open = true; }
  close() { this.open = false; this.listeners.close?.(); }
}

function runPage({mine = async () => [original], update, remove, openFile} = {}) {
  const elements = new Map();
  function get(id) {
    if (!elements.has(id)) elements.set(id, new Element(id));
    return elements.get(id);
  }
  const form = get('summary-editor-form');
  form.reset = () => {
    for (const id of ['summary-edit-title', 'summary-edit-description']) get(id).value = '';
    get('summary-edit-file').files = [];
  };
  form.querySelector = () => [...elements.values()].find(element => element.attributes['aria-invalid'] === 'true');
  const pdfUrls = [];
  const window = {
    CourseApi: {searchCourses: async () => []},
    SummaryApi: {mine, update, remove, openFile, pdfSelectionError: () => '', pdfSignatureError: async () => ''}
  };
  const context = {
    window, document: {getElementById: get},
    Option: function(text, value) { this.text = text; this.value = value; },
    URLSearchParams, AbortController,
    URL: {createObjectURL(pdf) { pdfUrls.push(pdf); return 'blob:pdf'; }, revokeObjectURL() {}}
  };
  for (const file of ['ui-utils.js', 'my-summaries.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js', file), 'utf8'), context);
  }
  function open(action) {
    return get('my-summary-list').listeners.click({
      target: {closest: () => ({dataset: {summaryAction: action, summaryId: '41'}})}
    });
  }
  return {get, open, load: () => window.MySummaries.load(), pdfUrls};
}

test('cancelling U7 delete confirmation keeps the card and sends no DELETE', async () => {
  let calls = 0;
  const page = runPage({remove: async () => { calls += 1; }});
  await page.load();
  page.open('delete');
  assert.equal(page.get('summary-delete-dialog').open, true);
  page.get('summary-delete-cancel').listeners.click();
  assert.equal(page.get('summary-delete-dialog').open, false);
  assert.equal(calls, 0);
  assert.match(page.get('my-summary-list').innerHTML, /Original/);
});

test('a failed PDF replacement keeps the draft, lets the owner preview the original and requires a fresh list before retry', async () => {
  let listCalls = 0;
  const updates = [];
  const originalFile = new File(['%PDF-original'], 'original.pdf', {type: 'application/pdf'});
  const replacement = new File(['%PDF-replacement'], 'replacement.pdf', {type: 'application/pdf'});
  const page = runPage({
    mine: async () => {
      if (++listCalls === 2) throw new Error('List unavailable');
      return [original];
    },
    update: async (...args) => {
      updates.push(args);
      throw Object.assign(new Error('Storage unavailable'), {status: 503});
    },
    openFile: async id => {
      assert.equal(id, original.id);
      return originalFile;
    }
  });
  await page.load();
  page.open('edit');
  const title = page.get('summary-edit-title');
  const description = page.get('summary-edit-description');
  title.value = 'Edited title';
  description.value = 'Edited description';
  const fileInput = page.get('summary-edit-file');
  fileInput.files = [replacement];
  fileInput.listeners.change();
  const submit = () => page.get('summary-editor-form').listeners.submit({preventDefault() {}});
  await submit();

  assert.equal(page.get('summary-editor').open, true);
  assert.equal(title.value, 'Edited title');
  assert.equal(description.value, 'Edited description');
  assert.equal(updates[0][4], replacement);
  assert.equal(page.get('summary-edit-file-name').textContent, replacement.name);
  assert.match(page.get('summary-editor-error').textContent, /Storage unavailable/);
  assert.equal(page.get('summary-edit-save').disabled, true);
  assert.equal(page.get('summary-edit-refresh').hidden, false);
  await submit();
  assert.equal(updates.length, 1);

  await page.get('summary-edit-preview-button').listeners.click();
  assert.equal(page.pdfUrls.at(-1), originalFile);
  assert.equal(page.get('summary-edit-preview-name').textContent, originalFile.name);
  page.get('summary-edit-preview').close();
  await page.get('summary-edit-preview-new').listeners.click();
  assert.equal(page.pdfUrls.at(-1), replacement);
  page.get('summary-edit-preview').close();

  await page.get('summary-edit-refresh').listeners.click();
  assert.equal(listCalls, 3);
  assert.equal(updates.length, 1);
  assert.equal(page.get('summary-edit-save').disabled, false);
  assert.equal(page.get('summary-edit-refresh').hidden, true);
  assert.equal(page.get('summary-edit-file-name').textContent, replacement.name);
  assert.equal(title.value, 'Edited title');
});
