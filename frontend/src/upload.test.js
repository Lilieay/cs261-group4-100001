const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const tick = () => new Promise(resolve => setImmediate(resolve));

function page({publish = async () => ({id: 12})} = {}) {
  const elements = new Map(), navigations = [], bodies = [];
  let redundantUserReads = 0;
  const get = selector => {
    const id = selector.replace(/^#/, '');
    if (!elements.has(id)) elements.set(id, {
      id, value: '', dataset: {}, validity: {badInput: false}, listeners: {},
      setAttribute() {}, replaceChildren() {}, append() {}, focus() {},
      addEventListener(type, callback) { this.listeners[type] = callback; }
    });
    return elements.get(id);
  };
  const window = {
    AppConfig: require('../public/js/app-config'),
    GuideConfig: {academicYears: [2568]},
    currentUserReady: Promise.resolve({id: 1, username: 'student', display_name: 'Student User'}),
    GuideApi: {
      courses: async () => [{id: 4, code: 'CS261', name: 'Software Engineering'}],
      currentUser: () => { redundantUserReads++; throw new Error('Duplicate user request'); },
      publish: async body => { bodies.push(body); return publish(body); }
    },
    location: {href: 'http://frontend/upload.html', assign: value => navigations.push(value)}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/upload.js'), 'utf8'), {
    window, document: {querySelector: get, getElementById: get, createElement: () => get('error-link')},
    Option: function(text, value) { this.text = text; this.value = value; }, URL, URLSearchParams
  });
  return {get, bodies, navigations, userReads: () => redundantUserReads};
}

function fill(get) {
  for (const [id, value] of Object.entries({'course-select': 'CS261', 'exam-title': 'Guide',
    'academic-year': '2568', semester: '1', 'exam-period': 'midterm', 'exam-type': 'subjective',
    'subjective-count': '2', 'objective-count': '10', 'exam-topics': 'Requirements', note: 'Advice'})) get(id).value = value;
}

test('upload reuses the authenticated profile and preserves publish payload and redirect', async () => {
  const p = page(); await tick();
  assert.equal(p.userReads(), 0);
  assert.equal(p.get('author').value, 'Student User');
  assert.equal(p.get('upload-fields').disabled, false);
  fill(p.get);
  await p.get('upload-form').listeners.submit({preventDefault() {}});
  assert.equal(p.bodies.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(p.bodies[0])), {
    course_id: 4, title: 'Guide', academic_year: 2568, semester: 1, exam_period: 'midterm',
    exam_format: 'subjective', subjective_count: 2, objective_count: null,
    topics: 'Requirements', additional_advice: 'Advice'
  });
  assert.match(p.navigations[0], /guide=12&source=api/);
});

test('upload prevents duplicate publishing and blocks resubmission after uncertain success', async () => {
  let reject;
  const p = page({publish: () => new Promise((_, fail) => { reject = fail; })});
  await tick(); fill(p.get);
  const event = {preventDefault() {}};
  const pending = p.get('upload-form').listeners.submit(event);
  p.get('upload-form').listeners.submit(event);
  assert.equal(p.bodies.length, 1);
  reject(Object.assign(new Error('Uncertain'), {uncertain: true}));
  await pending;
  await p.get('upload-form').listeners.submit(event);
  assert.equal(p.bodies.length, 1);
  assert.equal(p.get('upload-fields').disabled, true);
  assert.equal(p.get('exam-title').value, 'Guide');
});
