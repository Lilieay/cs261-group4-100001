const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

class Element {
  constructor() {
    this.listeners = {};
    this.attributes = {};
    this.classList = {add() {}, remove() {}, toggle() {}};
    this.options = [{value: 'all'}];
    this.value = '';
    this.dataset = {};
  }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  setAttribute(name, value) { this.attributes[name] = value; }
  replaceChildren() { this.innerHTML = ''; this.textContent = ''; }
  append() {}
  focus() {}
  querySelector() { return null; }
}

function runPage(file, {url, api, summaryApi, guideApi = {}, data = {}}) {
  const elements = new Map();
  const get = selector => {
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector);
  };
  const tabs = ['guides', 'summaries'].map(value => {
    const tab = new Element(); tab.dataset = {tab: value}; return tab;
  });
  const document = {
    title: '', querySelector: get, querySelectorAll: () => tabs,
    createElement: () => new Element(), createTextNode: text => ({textContent: text})
  };
  const window = {
    location: {href: url}, history: {replaceState() {}}, addEventListener() {},
    CourseApi: api, SummaryApi: summaryApi, GuideApi: {savedState: async () => false, ...guideApi}, CourseData: data
  };
  const source = fs.readFileSync(path.join(__dirname, '../public/js', file), 'utf8');
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/ui-utils.js'), 'utf8'), {window});
  window.UiUtils = {...window.UiUtils, ...data};
  vm.runInNewContext(source, {window, document, URL, URLSearchParams, AbortController, setTimeout, clearTimeout});
  return {elements, get, tabs};
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

test('U6 lists summaries using the selected course and discards a guide response after switching tabs', async () => {
  const guide = deferred();
  const summaryCalls = [];
  const {get, tabs} = runPage('choose-courses.js', {
    url: 'http://frontend/choose-courses.html?courseId=7&course=CS261&type=summaries',
    api: {getCourse: async () => ({id: 7, code: 'CS261', name: 'Software Engineering'})},
    guideApi: {
      filterOptions: async () => ({exam_periods: [], academic_years: [], semesters: []}),
      list: () => guide.promise
    },
    summaryApi: {list: async id => {
      summaryCalls.push(id);
      return [{id: 41, title: 'สรุป <CS261>', owner: {display_name: 'ผู้เผยแพร่'}}];
    }}
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(get('#filters').hidden, false);
  assert.match(get('#documentList').innerHTML, /สรุป &lt;CS261&gt;/);
  assert.match(get('#documentList').innerHTML, /read-summary\.html\?summary=41/);

  tabs[0].listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  tabs[1].listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  guide.resolve([{id: '55', title: 'Stale guide'}]);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(summaryCalls, [7, 7]);
  assert.match(get('#documentList').innerHTML, /ผู้เผยแพร่/);
  assert.doesNotMatch(get('#documentList').innerHTML, /Stale guide/);
});

test('summary filters combine year, semester and exam period while keeping old uploads in all results', async () => {
  const owner = {display_name: 'ผู้เผยแพร่'};
  const rows = [
    {id: 1, title: 'Old upload', owner},
    {id: 2, title: 'Match', academic_year: 2569, semester: 2, exam_period: 'final', owner},
    {id: 3, title: 'Other semester', academic_year: 2569, semester: 1, exam_period: 'final', owner},
    {id: 4, title: 'Other year', academic_year: 2568, semester: 2, exam_period: 'final', owner},
    {id: 5, title: 'Other period', academic_year: 2569, semester: 2, exam_period: 'midterm', owner}
  ];
  const {get} = runPage('choose-courses.js', {
    url: 'http://frontend/choose-courses.html?courseId=7&type=summaries',
    api: {getCourse: async () => ({id: 7, code: 'CS261', name: 'Software Engineering'})},
    summaryApi: {list: async () => rows}
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(get('#documentList').innerHTML, /Old upload/);
  assert.match(get('#yearFilter').innerHTML, /2568/);
  assert.match(get('#periodFilter').innerHTML, /ปลายภาค/);
  get('#yearFilter').value = '2569';
  get('#semesterFilter').value = '2';
  get('#periodFilter').value = 'ปลายภาค';
  get('#periodFilter').listeners.change();
  assert.equal(get('#resultCount').textContent, 'พบ 1 เอกสาร');
  assert.match(get('#documentList').innerHTML, /Match/);
  assert.doesNotMatch(get('#documentList').innerHTML, /Old upload|Other/);
  get('#clearFilters').listeners.click();
  assert.equal(get('#resultCount').textContent, 'พบ 5 เอกสาร');
});

test('course search page keeps the newest response when an older search finishes last', async () => {
  const old = deferred();
  const calls = [];
  const api = {searchCourses(query) {
    calls.push(query);
    return query === '' ? Promise.resolve([]) : query === 'old' ? old.promise
      : Promise.resolve([{id: 902, code: 'CS902', name: 'Newest API course'}]);
  }};
  const {get} = runPage('courses.js', {url: 'http://frontend/courses.html', api});
  await new Promise(resolve => setImmediate(resolve));

  const input = get('#course-search');
  const form = get('#course-search-form');
  input.value = 'old';
  form.listeners.submit({preventDefault() {}});
  input.value = 'new';
  form.listeners.submit({preventDefault() {}});
  await new Promise(resolve => setImmediate(resolve));
  old.resolve([{id: 901, code: 'CS901', name: 'Stale API course'}]);
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(calls, ['', 'old', 'new']);
  assert.match(get('#course-grid').innerHTML, /Newest API course/);
  assert.doesNotMatch(get('#course-grid').innerHTML, /Stale API course/);
});

test('course detail page renders an API course outside the legacy catalog with a Thai name', async () => {
  const apiCourse = {id: 902, code: 'CS902', name: 'วิศวกรรมซอฟต์แวร์ขั้นสูง'};
  const calls = [];
  const api = {
    getCourse: async id => { calls.push(id); return apiCourse; },
    searchCourses: async () => []
  };
  const data = {
    escapeHtml: value => String(value), loadExams: () => [], semesterLabel: value => value,
    publisherName: () => '', subscribe() {}
  };
  const {get} = runPage('choose-courses.js', {
    url: 'http://frontend/choose-courses.html?courseId=902&course=CS902', api, data
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(calls, ['902']);
  assert.match(get('#courseHeading').textContent, /CS902/);
  assert.match(get('#courseName').textContent, /วิศวกรรมซอฟต์แวร์ขั้นสูง/);
  assert.equal(get('#documentList').innerHTML, '');
});

test('course list loads API guides and sends the database course ID to filter-options and list', async () => {
  const calls = [];
  const guideApi = {
    filterOptions: async id => { calls.push(['options', id]); return {academic_years: [2568], semesters: [1], exam_periods: ['midterm']}; },
    list: async (id, filters) => {
      calls.push(['list', id, filters]);
      return [{id: '31', title: 'แนวข้อสอบจริง', year: '2568', semester: '1', period: 'กลางภาค', publisher_name: 'ผู้เผยแพร่'}];
    }
  };
  const data = {
    escapeHtml: value => String(value), semesterLabel: value => `ที่ ${value}`,
    publisherName: () => 'preview publisher', subscribe() {}
  };
  const {get} = runPage('choose-courses.js', {
    url: 'http://frontend/choose-courses.html?courseId=27&course=CS902',
    api: {getCourse: async id => ({id: Number(id), code: 'CS902', name: 'วิชาจริง'}), searchCourses: async () => []},
    guideApi, data
  });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(calls.map(call => call.slice(0, 2)), [['options', 27], ['list', 27]]);
  assert.match(get('#documentList').innerHTML, /แนวข้อสอบจริง/);
  assert.match(get('#documentList').innerHTML, /ผู้เผยแพร่/);
  assert.doesNotMatch(get('#documentList').innerHTML, /preview publisher/);
  assert.match(get('#documentList').innerHTML, /source=api/);
});

test('course list requests selected filters and shows the filtered empty state', async () => {
  const filters = [];
  const guideApi = {
    filterOptions: async () => ({academic_years: [2568], semesters: [1], exam_periods: ['midterm']}),
    list: async (_id, selected) => { filters.push(selected); return []; }
  };
  const data = {escapeHtml: value => String(value), semesterLabel: value => String(value)};
  const {get} = runPage('choose-courses.js', {
    url: 'http://frontend/choose-courses.html?courseId=27&course=CS902',
    api: {getCourse: async id => ({id: Number(id), code: 'CS902', name: 'วิชา'}), searchCourses: async () => []},
    guideApi, data
  });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  get('#yearFilter').value = '2568';
  get('#yearFilter').listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(filters.at(-1).academic_year, '2568');
  assert.equal(get('#emptyTitle').textContent, 'ไม่พบแนวข้อสอบที่ตรงกับที่กรอง');
  assert.equal(get('#emptyClear').hidden, false);
});

test('read page resolves a database course and guide by URL without the preview catalog', async () => {
  const calls = [];
  const data = {
    escapeHtml: value => String(value), semesterLabel: value => `ที่ ${value}`,
    publisherName: () => 'preview publisher', questionCounts: row => ({
      objective: row.objective_count, essay: row.essay_count
    }), findCourse: () => { throw new Error('preview catalog must not be used'); }
  };
  const {get} = runPage('read-courses.js', {
    url: 'http://frontend/read-courses.html?source=api&courseId=902&course=CS902&guide=71',
    api: {getCourse: async id => ({id: Number(id), code: 'CS902', name: 'วิชาจริง'})},
    guideApi: {
      read: async (id, code) => {
        calls.push([id, code]);
        return {id: 71, course: {course_code: 'CS902'}};
      },
      toPreviewRow: () => ({
        id: '71', title: 'แนวข้อสอบจาก API', year: '2568', semester: '1',
        period: 'กลางภาค', formats: ['ผสม'], topics: 'หัวข้อจริง', notes: '',
        objective_count: 10, essay_count: 2, publisher_name: 'ผู้เผยแพร่จริง',
        instructor_names: 'อาจารย์จริง'
      })
    },
    data
  });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(calls, [['71', 'CS902']]);
  assert.match(get('#readingContent').innerHTML, /แนวข้อสอบจาก API/);
  assert.doesNotMatch(get('#readingContent').innerHTML, /อาจารย์จริง|ผู้สอน/);
  assert.match(get('#readingContent').innerHTML, /ผู้เผยแพร่จริง/);
  assert.doesNotMatch(get('#readingContent').innerHTML, /preview publisher/);
});

test('read page allows the my-guides return path and rejects an external return URL', async () => {
  const data = {
    escapeHtml: value => String(value), semesterLabel: value => String(value),
    questionCounts: row => ({objective: row.objective_count, essay: row.essay_count})
  };
  for (const [returnTo, expected] of [
    ['shared-courses.html', 'shared-courses.html'],
    ['https://attacker.example/steal', 'choose-courses.html?course=CS902']
  ]) {
    const {get} = runPage('read-courses.js', {
      url: `http://frontend/read-courses.html?source=api&courseId=902&course=CS902&guide=71&returnTo=${encodeURIComponent(returnTo)}`,
      api: {getCourse: async () => ({id: 902, code: 'CS902', name: 'วิชา'})},
      guideApi: {
        read: async () => ({id: 71, course: {course_code: 'CS902'}}),
        toPreviewRow: () => ({id: '71', title: 'แนวข้อสอบ', year: '2568', semester: '1',
          period: 'กลางภาค', formats: ['ผสม'], topics: 'หัวข้อ', notes: '',
          objective_count: 1, essay_count: 1, publisher_name: 'ผู้เผยแพร่'})
      },
      data
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(get('#readingBack').href, expected);
    if (expected === 'shared-courses.html') {
      assert.equal(get('#readingBack').attributes['aria-label'], 'กลับแนวข้อสอบของฉัน');
    }
  }
});

test('course search page renders a Thai API result even when it is absent from the catalog', async () => {
  const calls = [];
  const api = {searchCourses: async query => {
    calls.push(query);
    return query === 'วิศวกรรม' ? [{id: 902, code: 'CS902', name: 'วิศวกรรมซอฟต์แวร์ขั้นสูง'}] : [];
  }};
  const {get} = runPage('courses.js', {url: 'http://frontend/courses.html', api});
  await new Promise(resolve => setImmediate(resolve));
  const input = get('#course-search'); input.value = 'วิศวกรรม';
  get('#course-search-form').listeners.submit({preventDefault() {}});
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(calls, ['', 'วิศวกรรม']);
  assert.match(get('#course-grid').innerHTML, /วิศวกรรมซอฟต์แวร์ขั้นสูง/);
  assert.match(get('#course-grid').innerHTML, /CS902/);
});


test('read bookmark waits for API state, prevents duplicate writes, and toggles persisted state', async () => {
  const state = deferred(), write = deferred();
  const calls = [];
  const {get} = runPage('read-courses.js', {
    url: 'http://frontend/read-courses.html?source=api&courseId=4&course=CS261&guide=12',
    api: {getCourse: async () => ({id: 4, code: 'CS261', name: 'Software Engineering'})},
    guideApi: {read: async () => ({}), toPreviewRow: () => ({title: 'Guide', formats: ['ผสม']}),
      savedState: async (id, desired) => { calls.push([id, desired]); return desired === undefined ? state.promise : write.promise; }},
    data: {escapeHtml: String, semesterLabel: String, questionCounts: () => ({}), publisherName: () => 'Publisher'}
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(get('#readingContent').innerHTML, /aria-pressed="false" disabled/);
  state.resolve(false);
  await new Promise(resolve => setImmediate(resolve));
  assert.doesNotMatch(get('#readingContent').innerHTML, /aria-pressed="false" disabled/);
  const click = {target: {closest: selector => selector === '.save-button' ? {} : null}};
  const pending = get('#readingContent').listeners.click(click);
  get('#readingContent').listeners.click(click);
  assert.equal(calls.length, 2);
  write.resolve(true);
  await pending;
  assert.match(get('#readingContent').innerHTML, /aria-pressed="true"/);
  assert.match(get('#reading-status').textContent, /เพิ่มในรายวิชาที่บันทึกแล้ว/);
  assert.match(get('#readingContent').innerHTML, /review-button" type="button" disabled/);
});

test('an older filter response cannot overwrite rows later rendered by sorting', async () => {
  const old = deferred();
  const row = (id, title) => ({id, title, year: '2568', semester: '1', period: 'กลางภาค', publisher_name: 'Publisher'});
  const {get} = runPage('choose-courses.js', {
    url: 'http://frontend/choose-courses.html?courseId=4&course=CS261',
    api: {getCourse: async () => ({id: 4, code: 'CS261', name: 'Software Engineering'})},
    guideApi: {
      filterOptions: async () => ({academic_years: [2567, 2568], semesters: [1], exam_periods: ['midterm']}),
      list: async (_, filters) => filters.academic_year === '2567' ? old.promise : [row('2', 'Newest response')]
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  get('#yearFilter').value = '2567'; get('#yearFilter').listeners.change();
  get('#yearFilter').value = '2568'; get('#yearFilter').listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  old.resolve([row('1', 'Stale response')]);
  await new Promise(resolve => setImmediate(resolve));
  get('#sortFilter').value = 'title'; get('#sortFilter').listeners.change();
  assert.match(get('#documentList').innerHTML, /Newest response/);
  assert.doesNotMatch(get('#documentList').innerHTML, /Stale response/);
});

test('clearing a filter chip reloads API rows with the remaining filters', async () => {
  const calls = [];
  const {get} = runPage('choose-courses.js', {
    url: 'http://frontend/choose-courses.html?courseId=4&course=CS261',
    api: {getCourse: async () => ({id: 4, code: 'CS261', name: 'Software Engineering'})},
    guideApi: {
      filterOptions: async () => ({academic_years: [2568], semesters: [1], exam_periods: ['midterm']}),
      list: async (_, filters) => {
        calls.push(filters);
        return [{id: '1', title: filters.academic_year ? 'Filtered list' : 'Full list', year: '2568', semester: '1', period: 'กลางภาค', publisher_name: 'Publisher'}];
      }
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  get('#yearFilter').value = '2568'; get('#yearFilter').listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  get('#activeFilters').listeners.click({target: {closest: () => ({dataset: {clearFilter: 'year'}})}});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.at(-1).academic_year, null);
  assert.match(get('#documentList').innerHTML, /Full list/);
});
