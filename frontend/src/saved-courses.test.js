const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const tick = () => new Promise(resolve => setImmediate(resolve));

function runPage(file, services) {
  const elements = new Map(), events = {};
  const document = {querySelector: get, getElementById: get, activeElement: null};
  function get(selector) {
    if (!elements.has(selector)) elements.set(selector, {
      value: '', dataset: {}, listeners: {}, classList: {toggle() {}}, setAttribute() {},
      focus() { document.activeElement = this; },
      querySelectorAll() { return []; },
      addEventListener(type, callback) { this.listeners[type] = callback; }
    });
    return elements.get(selector);
  }
  const window = {...services,
    UiUtils: {escapeHtml: value => String(value).replaceAll('<', '&lt;')},
    addEventListener: (type, callback) => { events[type] = callback; }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js', file), 'utf8'),
    {window, document, URL, URLSearchParams, AbortController});
  return {get, events, document};
}

function page({saved = async () => [], savedState = async () => false} = {}) {
  return runPage('saved-courses.js', {SavedItems: {list: saved, state: savedState}});
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

test('U10 displays separate course and document links and updates the filtered count', async () => {
  const secondGuide = {...row, item_id: 13, title: 'Practice exam'};
  const {get} = page({saved: async () => [secondGuide, row, summary]});
  const list = get('#saved-list');
  await tick();
  assert.match(list.innerHTML, /choose-courses\.html\?course=CS261&courseId=4[^>]*>Software Engineering/);
  assert.match(list.innerHTML, /read-courses\.html\?guide=13&/);
  assert.match(list.innerHTML, /read-courses\.html\?guide=12&/);
  assert.match(list.innerHTML, /read-summary\.html\?summary=12&/);
  assert.match(list.innerHTML, /class="saved-code">CS261/);
  assert.match(list.innerHTML, /class="saved-document-type">สรุปเนื้อหา/);
  get('#saved-type').value = 'guide';
  get('#saved-type').listeners.change();
  assert.equal(get('#saved-count').textContent, 'แสดง 2 จาก 3 รายการ');
  assert.doesNotMatch(list.innerHTML, /read-summary\.html/);
  get('#saved-search').value = 'Practice exam';
  get('#saved-search').listeners.input();
  assert.equal(get('#saved-count').textContent, 'แสดง 1 จาก 3 รายการ');
  assert.doesNotMatch(list.innerHTML, /guide=12&/);
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

for (const focusedControl of ['#saved-search', '#saved-type', null]) {
  test(`U10 removal respects focus on ${focusedControl || 'the initiating button'}`, async () => {
    let finish;
    const {get, document} = page({saved: async () => [row, summary],
      savedState: () => new Promise(resolve => { finish = resolve; })});
    await tick();
    const list = get('#saved-list');
    const button = get('#remove-guide');
    button.dataset = {unsave: '12', itemType: 'guide'};
    list.querySelectorAll = () => [button, get('#remove-summary')];
    button.focus();
    const pending = list.listeners.click({target: {closest: selector => selector === '[data-unsave]' ? button : null}});
    assert.equal(document.activeElement, button);
    if (focusedControl) {
      const control = get(focusedControl);
      control.focus();
      control.value = focusedControl === '#saved-search' ? 'Saved' : 'summary';
      control.listeners[focusedControl === '#saved-search' ? 'input' : 'change']();
    }
    finish(false);
    await pending;
    assert.equal(document.activeElement, get(focusedControl || '#saved-search'));
    assert.match(list.innerHTML, /Saved summary/);
    assert.doesNotMatch(list.innerHTML, /Saved title/);
  });
}

test('U10 keeps focus on the same document link after another bookmark is removed', async () => {
  const nextGuide = {...row, item_id: 13, title: 'Next exam'};
  const sameIdSummary = {...summary, item_id: 13};
  let finish;
  const {get, document} = page({
    saved: async () => [row, nextGuide, sameIdSummary],
    savedState: () => new Promise(resolve => { finish = resolve; })
  });
  await tick();

  const list = get('#saved-list');
  const button = get('#remove-guide');
  button.dataset = {unsave: '12', itemType: 'guide'};
  button.focus();
  const pending = list.listeners.click({target: {closest: selector => selector === '[data-unsave]' ? button : null}});
  const oldLink = get('#old-guide-link');
  oldLink.dataset.openItem = 'guide:13';
  oldLink.focus();

  const summaryLink = get('#new-summary-link');
  summaryLink.dataset.openItem = 'summary:13';
  const guideLink = get('#new-guide-link');
  guideLink.dataset.openItem = 'guide:13';
  list.querySelectorAll = selector => selector === '[data-open-item]' ? [summaryLink, guideLink] : [];
  finish(false);
  await pending;

  assert.equal(document.activeElement, guideLink);
  assert.match(list.innerHTML, /data-open-item="guide:13"/);
  assert.match(list.innerHTML, /data-open-item="summary:13"/);
  assert.doesNotMatch(list.innerHTML, /data-open-item="guide:12"/);
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

test('U9 keeps an uncertain DELETE message after refreshing the list and finding the bookmark gone', async () => {
  let reads = 0;
  const issue = 'ยังยืนยันผลไม่ได้ กรุณาโหลดสถานะล่าสุด';
  const {get} = page({saved: async () => ++reads === 1 ? [summary] : [],
    savedState: async () => { throw Object.assign(new Error(issue), {status: 503}); }});
  await tick();
  await get('#saved-list').listeners.click({target: {closest: selector =>
    selector === '[data-unsave]' ? {dataset: {unsave: '12', itemType: 'summary'}} : null}});
  assert.equal(reads, 2);
  assert.equal(get('#saved-status').textContent, issue);
  assert.match(get('#saved-list').innerHTML, /ยังไม่มีรายการที่บันทึก/);
});

for (const missingAt of ['guide', 'summary', 'pdf-file']) {
  test(`U9 reloads a restored saved list after opening a missing ${missingAt}`, async () => {
    const isGuide = missingAt === 'guide';
    const remaining = isGuide ? summary : row;
    let items = [row, summary];
    let listReads = 0;
    const {get, events} = page({saved: async () => { listReads++; return items; }});
    await tick();
    events.pageshow({persisted: false});
    assert.equal(listReads, 1);
    const readerPath = isGuide ? 'read-courses' : 'read-summary';
    const link = [...get('#saved-list').innerHTML.matchAll(/href="([^"]+)"/g)]
      .find(([, href]) => href.startsWith(readerPath));
    assert.ok(link);
    assert.equal(get('#saved-count').textContent, 'บันทึกไว้ 2 รายการ');

    items = [remaining]; // The shared document was deleted while the saved page was open.
    const url = new URL(link[1], 'http://frontend/');
    const requests = [];
    const missing = async id => {
      requests.push(id);
      throw Object.assign(new Error('รายการถูกลบแล้ว'), {status: 404});
    };
    const reader = runPage(`${readerPath}.js`, {
      location: url,
      CourseApi: {getCourse: async () => ({id: 4, code: 'CS261'})},
      GuideApi: {read: missing},
      SummaryApi: {
        read: missingAt === 'summary' ? missing : async () => ({
          id: 12, title: 'Saved summary', owner: {display_name: 'Owner'}, course: {id: 4}
        }),
        openFile: missing
      },
      SavedItems: {state: async () => false}
    });
    await tick();
    assert.deepEqual(requests, [missingAt === 'pdf-file' ? 12 : '12']);
    if (isGuide) {
      assert.match(reader.get('#readingContent').innerHTML, /ไม่พบแนวข้อสอบ/);
      assert.equal(reader.get('#readingBack').href, 'saved-courses.html');
    } else {
      const error = reader.get(missingAt === 'summary' ? 'summary-read-status' : 'summary-file-alert');
      assert.match(error.textContent, /รายการถูกลบแล้ว/);
      assert.equal(reader.get('summary-back').href, 'saved-courses.html');
    }

    // Browser Back restores the original page without triggering its initial load.
    await events.pageshow({persisted: true});
    assert.equal(listReads, 2);
    assert.equal(get('#saved-count').textContent, 'บันทึกไว้ 1 รายการ');
    assert.match(get('#saved-list').innerHTML, isGuide ? /Saved summary/ : /Saved title/);
    assert.doesNotMatch(get('#saved-list').innerHTML, isGuide ? /Saved title/ : /Saved summary/);
  });
}
