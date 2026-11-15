(() => {
  'use strict';
  const data = window.UiUtils;
  const $ = selector => document.querySelector(selector);
  const e = data.escapeHtml;
  const params = new URL(window.location.href).searchParams;
  let course = null;
  let courseLoading = true;
  const PAGE_SIZE = 6;
  let rows = [];
  let loadError = '';
  let rowsLoading = false;
  let rowLoadVersion = 0;
  let courseError = '';
  let courseErrorStatus = 0;
  let activeType = params.get('type') === 'summaries' ? 'summaries' : 'guides';
  let page = 1;
  const filterIds = {period: '#periodFilter', year: '#yearFilter', semester: '#semesterFilter'};
  const tabFilters = {};
  const periodLabel = value => ({midterm: 'กลางภาค', final: 'ปลายภาค'})[value];

  function sortDocuments(items, order) {
    if (activeType === 'summaries' && order === 'latest') return items;
    return [...items].sort((a, b) => {
      if (order === 'title') return a.title.localeCompare(b.title, 'th');
      const dateA = Date.parse(a.created_at || a.updated_at || '') || 0;
      const dateB = Date.parse(b.created_at || b.updated_at || '') || 0;
      if (activeType === 'summaries') return dateA - dateB || a.id - b.id;
      return (order === 'oldest' ? dateA - dateB : dateB - dateA) || a.id.localeCompare(b.id);
    });
  }

  function selectOptions(id, values, label, text = value => value) {
    const select = $(id);
    const previous = select.value;
    select.innerHTML = `<option value="all">${label}: ทั้งหมด</option>` + values.map(value => `<option value="${e(value)}">${label}: ${e(text(value))}</option>`).join('');
    select.value = values.includes(previous) ? previous : 'all';
  }

  function setFilterOptions({exam_periods, academic_years, semesters}) {
    selectOptions('#periodFilter', exam_periods.map(periodLabel).filter(Boolean), 'ช่วงสอบ');
    selectOptions('#yearFilter', academic_years.map(String).sort((a, b) => Number(b) - Number(a)), 'ปีการศึกษา');
    selectOptions('#semesterFilter', semesters.map(String).sort(), 'ภาคเรียน', data.semesterLabel);
  }

  function restoreFilters(selection) {
    if (!selection) return;
    for (const [key, id] of Object.entries(filterIds)) {
      $(id).value = [...$(id).options].some(option => option.value === selection[key]) ? selection[key] : 'all';
    }
  }

  async function loadFilteredRows({loadOptions = false, selection} = {}) {
    if (!course) { rows = []; rowsLoading = false; render(); return; }
    const version = ++rowLoadVersion;
    rowsLoading = true;
    loadError = '';
    render();
    const summaries = activeType === 'summaries';
    try {
      if (summaries) {
        const result = await window.SummaryApi.list(course.id);
        if (version !== rowLoadVersion) return;
        const optionsFor = key => [...new Set(result.map(row => row[key]).filter(value => value != null))];
        setFilterOptions({exam_periods: optionsFor('exam_period'), academic_years: optionsFor('academic_year'),
          semesters: optionsFor('semester')});
        restoreFilters(selection);
        rows = result;
        return;
      }
      if (loadOptions) {
        const options = await window.GuideApi.filterOptions(course.id).catch(() => null);
        if (version !== rowLoadVersion) return;
        if (options) setFilterOptions(options);
        restoreFilters(selection);
      }
      const filters = filterState();
      const result = await window.GuideApi.list(course.id, {
        academic_year: filters.year === 'all' ? null : filters.year,
        semester: filters.semester === 'all' ? null : filters.semester,
        exam_period: filters.period === 'all' ? null : filters.period === 'กลางภาค' ? 'midterm' : 'final'
      });
      if (version !== rowLoadVersion) return;
      rows = result;
    } catch (error) {
      if (version !== rowLoadVersion) return;
      rows = [];
      loadError = error.message || (summaries ? 'โหลดรายการสรุปไม่สำเร็จ' : 'โหลดรายการแนวข้อสอบไม่สำเร็จ');
    } finally {
      if (version === rowLoadVersion) {
        rowsLoading = false;
        render();
      }
    }
  }

  function filterState() {
    return { period: $('#periodFilter').value, year: $('#yearFilter').value, semester: $('#semesterFilter').value };
  }

  function matchingSummaries() {
    const {period, semester, year} = filterState();
    return rows.filter(row => (period === 'all' || periodLabel(row.exam_period) === period)
      && (semester === 'all' || String(row.semester) === semester)
      && (year === 'all' || String(row.academic_year) === year));
  }

  function updateUrl() {
    if (!course) return;
    const url = new URL(window.location.href);
    url.searchParams.set('course', course.code);
    url.searchParams.set('courseId', String(course.id));
    const filters = filterState();
    for (const key of ['period', 'year', 'semester']) {
      if (filters[key] === 'all') url.searchParams.delete(key);
      else url.searchParams.set(key, filters[key]);
    }
    if (activeType === 'guides') url.searchParams.delete('type');
    else url.searchParams.set('type', activeType);
    if ($('#sortFilter').value === 'latest') url.searchParams.delete('sort');
    else url.searchParams.set('sort', $('#sortFilter').value);
    if (page === 1) url.searchParams.delete('page'); else url.searchParams.set('page', String(page));
    try { window.history.replaceState(null, '', url); } catch (_) { /* Optional on file URLs. */ }
  }

  function renderChips() {
    const values = filterState();
    const chips = course ? [`<span class="chip">${e(course.code)}</span>`] : [];
    for (const [key, label] of [['year', 'ปี'], ['period', 'ช่วงสอบ'], ['semester', 'ภาคเรียน']]) {
      if (values[key] !== 'all') chips.push(`<span class="chip">${e(label)} ${e(key === 'semester' ? data.semesterLabel(values[key]) : values[key])}<button type="button" data-clear-filter="${key}" aria-label="ล้างตัวกรอง${e(label)}">×</button></span>`);
    }
    $('#activeFilters').innerHTML = chips.join('');
  }

  function documentCard(row) {
    const back = `choose-courses.html${new URL(window.location.href).search}`;
    const query = new URLSearchParams({ course: course.code, courseId: String(course.id), guide: row.id, source: 'api', returnTo: back });
    return `<article class="document-card"><div class="document-main"><div class="badges"><span class="course-badge">${e(course.code)}</span><span class="type-badge">แนวข้อสอบ</span><span>ปี ${e(row.year)}</span><span>ภาคเรียน${e(data.semesterLabel(row.semester))}</span><span>${e(row.period)}</span></div><h2>${e(row.title)}</h2><div class="document-bottom"><span>แบ่งปันโดย ${e(row.publisher_name || 'ไม่ระบุชื่อ')}</span></div></div><a class="view-button" href="read-courses.html?${e(query.toString())}">ดูเอกสาร <span aria-hidden="true">→</span></a></article>`;
  }

  function summaryCard(row) {
    const query = new URLSearchParams({summary: row.id});
    if (page > 1) query.set('page', String(page));
    if ($('#sortFilter').value !== 'latest') query.set('sort', $('#sortFilter').value);
    for (const [key, value] of Object.entries(filterState())) {
      if (value !== 'all') query.set(key, value);
    }
    const examDetails = [
      row.academic_year && `ปี ${row.academic_year}`,
      row.semester && `ภาคเรียน${data.semesterLabel(row.semester)}`,
      periodLabel(row.exam_period)
    ].filter(Boolean).map(label => `<span>${e(label)}</span>`).join('');
    return `<article class="document-card">
      <div class="document-main">
        <div class="badges"><span class="course-badge">${e(course.code)}</span><span class="type-badge">สรุป PDF</span>${examDetails}</div>
        <h2>${e(row.title)}</h2>
        <div class="document-bottom"><span>แบ่งปันโดย ${e(row.owner.display_name)}</span></div>
      </div>
      <a class="view-button" href="read-summary.html?${e(query.toString())}">ดูเอกสาร <span aria-hidden="true">→</span></a>
    </article>`;
  }

  function renderPagination(total) {
    const pages = Math.ceil(total / PAGE_SIZE);
    const nav = $('#pagination');
    nav.hidden = pages <= 1;
    if (pages <= 1) { nav.innerHTML = ''; return; }
    const buttons = [];
    buttons.push(`<button type="button" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>‹ ก่อนหน้า</button>`);
    // Keep the page control bounded even when the data set grows.
    const visible = [...new Set([1, ...Array.from({length: 5}, (_, i) => page - 2 + i).filter(n => n >= 1 && n <= pages), pages])].sort((a, b) => a - b);
    visible.forEach((n, index) => {
      if (index && n - visible[index - 1] > 1) buttons.push('<span class="ellipsis">…</span>');
      buttons.push(`<button type="button" class="page-number ${n === page ? 'current' : ''}" data-page="${n}" ${n === page ? 'aria-current="page"' : ''}>${n}</button>`);
    });
    buttons.push(`<button type="button" data-page="${page + 1}" ${page === pages ? 'disabled' : ''}>ถัดไป ›</button>`);
    nav.innerHTML = buttons.join('');
  }

  function render() {
    const summaries = activeType === 'summaries';
    $('#filters').hidden = !course;
    $('#clearFilters').disabled = summaries && rowsLoading;
    for (const id of Object.values(filterIds)) $(id).disabled = summaries && rowsLoading;
    $('#resultToolbar').hidden = !course;
    const tabs = [...document.querySelectorAll('[data-tab]')];
    tabs.forEach(tab => {
      const active = tab.dataset.tab === activeType;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    $('#documentPanel').setAttribute('aria-labelledby', activeType === 'guides' ? 'guides-tab' : 'summaries-tab');
    const matching = course && !rowsLoading
      ? sortDocuments(summaries ? matchingSummaries() : rows, $('#sortFilter').value) : [];
    if (course && !rowsLoading) page = Math.max(1, Math.min(page, Math.ceil(matching.length / PAGE_SIZE) || 1));
    if (!rowsLoading) updateUrl();
    $('#resultCount').textContent = rowsLoading ? (summaries ? 'กำลังโหลดรายการสรุป…' : 'กำลังโหลดรายการแนวข้อสอบ…') : `พบ ${matching.length} เอกสาร`;
    $('#documentList').innerHTML = matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
      .map(summaries ? summaryCard : documentCard).join('');
    $('#documentList').hidden = matching.length === 0;
    let title = '', detail = '', clear = false;
    if (courseLoading) { title = 'กำลังโหลดข้อมูลรายวิชา…'; detail = ''; }
    else if (courseError && ![404, 422].includes(courseErrorStatus)) { title = 'โหลดข้อมูลไม่สำเร็จ'; detail = courseError; }
    else if (!course) { title = courseError ? 'ไม่พบวิชาในระบบ' : (params.has('course') || params.has('courseId') ? 'ไม่พบวิชาในระบบ' : 'กรุณาเลือกรายวิชา'); detail = courseError || 'กลับไปเลือกวิชาจากหน้าค้นหารายวิชา'; }
    else if (rowsLoading) { title = summaries ? 'กำลังโหลดสรุป…' : 'กำลังโหลดแนวข้อสอบ…'; }
    else if (loadError) { title = 'โหลดข้อมูลไม่สำเร็จ'; detail = loadError; }
    else if (summaries && !rows.length) { title = 'ไม่พบสรุปในรายวิชานี้'; }
    else if (!rows.length && Object.values(filterState()).every(value => value === 'all')) { title = 'ยังไม่มีแนวข้อสอบสำหรับวิชานี้'; detail = 'ยังไม่มีเนื้อหาในรายวิชานี้'; }
    else if (!matching.length) {
      title = summaries ? 'ไม่พบสรุปที่ตรงกับตัวกรอง' : 'ไม่พบแนวข้อสอบที่ตรงกับที่กรอง';
      detail = 'ลองเปลี่ยนเงื่อนไข หรือล้างตัวกรองเพื่อดูเอกสารทั้งหมด';
      clear = true;
    }
    $('#emptyState').hidden = !title;
    $('#emptyTitle').textContent = title;
    $('#emptyDescription').textContent = detail;
    $('#emptyClear').hidden = !clear;
    $('#backToSearch').hidden = Boolean(course);
    $('#retryCourse').hidden = !(loadError || courseError) || (courseError && [401, 404, 422].includes(courseErrorStatus));
    renderChips();
    renderPagination(matching.length);
  }

  function applyFilters() {
    page = 1;
    if (activeType === 'summaries') render();
    else loadFilteredRows();
  }

  function clearFilters() {
    for (const id of Object.values(filterIds)) $(id).value = 'all';
    applyFilters();
  }

  async function resolveCourse() {
    const courseId = params.get('courseId');
    if (courseId !== null) {
      const detail = await window.CourseApi.getCourse(courseId);
      const expectedCode = params.get('course');
      if (expectedCode && expectedCode.toUpperCase() !== detail.code.toUpperCase()) {
        throw new window.CourseApi.CourseApiError('รหัสรายวิชาไม่ตรงกับรายการที่เลือก', 404);
      }
      return detail;
    }
    const legacyCode = params.get('course');
    if (!legacyCode) return null;
    const matches = await window.CourseApi.searchCourses(legacyCode);
    const match = matches.find(item => item.code.toUpperCase() === legacyCode.trim().toUpperCase());
    if (!match) throw new window.CourseApi.CourseApiError('ไม่พบรายวิชานี้ในระบบ', 404);
    return window.CourseApi.getCourse(match.id);
  }

  async function loadSelectedCourse(selection) {
    ++rowLoadVersion;
    rows = [];
    course = null;
    courseLoading = true;
    courseError = '';
    courseErrorStatus = 0;
    $('#courseHeading').textContent = 'กำลังโหลดข้อมูลรายวิชา…';
    $('#courseName').textContent = '';
    render();
    try {
      course = await resolveCourse();
    } catch (error) {
      if (error.status !== 401) {
        courseError = error.message || 'โหลดข้อมูลรายวิชาไม่สำเร็จ';
        courseErrorStatus = error.status;
      }
    }
    courseLoading = false;
    $('#courseHeading').textContent = course ? `ชีตสรุปและแนวข้อสอบ ${course.code}` : 'เลือกรายวิชา';
    $('#courseName').textContent = course ? `${course.code} ${course.name}` : '';
    document.title = course ? `${course.code} | เลือกแนวข้อสอบ` : 'เลือกรายวิชา';
    await loadFilteredRows({loadOptions: true, selection});
  }

  async function start() {
    $('#filters').hidden = true;
    $('#resultToolbar').hidden = true;
    if (['latest', 'oldest', 'title'].includes(params.get('sort'))) $('#sortFilter').value = params.get('sort');
    const savedPage = Number(params.get('page')); page = Number.isSafeInteger(savedPage) && savedPage > 0 ? savedPage : 1;
    const selection = Object.fromEntries(Object.keys(filterIds).map(key => [key, params.get(key)]));
    await loadSelectedCourse(selection);
    for (const id of Object.values(filterIds)) $(id).addEventListener('change', applyFilters);
    $('#sortFilter').addEventListener('change', () => { page = 1; render(); });
    $('#clearFilters').addEventListener('click', clearFilters);
    $('#emptyClear').addEventListener('click', clearFilters);
    $('#retryCourse').addEventListener('click', () => loadSelectedCourse());
    $('#activeFilters').addEventListener('click', event => {
      const button = event.target.closest('[data-clear-filter]'); if (!button) return;
      const id = filterIds[button.dataset.clearFilter];
      if (id) { $(id).value = 'all'; applyFilters(); }
    });
    const tabs = [...document.querySelectorAll('[data-tab]')];
    function selectTab(tab) {
      if (activeType === tab.dataset.tab) return;
      tabFilters[activeType] = filterState();
      activeType = tab.dataset.tab;
      page = 1;
      loadFilteredRows({loadOptions: true, selection: tabFilters[activeType] || {}});
    }
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => selectTab(tab));
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : 1 - index;
        selectTab(tabs[next]);
        tabs[next].focus();
      });
    });
    $('#pagination').addEventListener('click', event => {
      const button = event.target.closest('[data-page]');
      if (!button || button.disabled) return;
      page = Number(button.dataset.page); render(); $('#resultCount').focus();
    });
  }
  start();
})();
