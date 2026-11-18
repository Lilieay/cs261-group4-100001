const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function preview() {
  const dialog = {open: false, showModal() { this.open = true; }, addEventListener(_, close) { this.close = () => { this.open = false; close(); }; }};
  const element = () => ({hidden: true, removeAttribute(name) { delete this[name]; }});
  const frame = element(), link = element(), status = element();
  const created = [], revoked = [];
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/pdf-preview.js'), 'utf8'), {
    window, AbortController,
    URL: {createObjectURL(pdf) { created.push(pdf); return `blob:${created.length}`; }, revokeObjectURL(url) { revoked.push(url); }}
  });
  return {dialog, frame, link, status, created, revoked, api: window.PdfPreview.create({dialog, frame, link, status})};
}

test('closing a PDF preview removes the file from the frame and releases its URL', async () => {
  const p = preview();
  await p.api.show(async () => 'original PDF');
  assert.equal(p.frame.src, 'blob:1#view=FitH');
  assert.equal(p.link.href, 'blob:1');
  p.dialog.close();
  assert.equal(p.frame.src, undefined);
  assert.equal(p.link.href, undefined);
  assert.deepEqual(p.revoked, ['blob:1']);
});

test('a late PDF load cannot replace a newer preview after closing and reopening', async () => {
  const p = preview();
  let resolve, signal;
  const old = p.api.show(current => { signal = current; return new Promise(done => { resolve = done; }); });
  p.dialog.close();
  assert.equal(signal.aborted, true);
  await p.api.show(async () => 'new PDF');
  resolve('old PDF');
  await old;
  assert.deepEqual(p.created, ['new PDF']);
  assert.equal(p.frame.src, 'blob:1#view=FitH');
  assert.equal(p.status.hidden, true);
});

test('closing during a failed PDF load suppresses the abandoned error', async () => {
  const p = preview();
  let reject;
  const pending = p.api.show(() => new Promise((_, fail) => { reject = fail; }));
  p.dialog.close();
  reject(new Error('aborted response'));
  await pending;
  assert.deepEqual(p.created, []);
  assert.equal(p.frame.hidden, true);
});
