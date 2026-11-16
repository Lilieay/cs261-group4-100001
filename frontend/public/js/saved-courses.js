(() => {
  'use strict';

  const {escapeHtml: e} = window.UiUtils;
  const $ = selector => document.querySelector(selector);
  const list = $('#saved-list');
  const search = $('#saved-search');
  const typeFilter = $('#saved-type');
  const count = $('#saved-count');
  const status = $('#saved-status');
  let rows = [];
  let loading = true;
  let failure = '';
  let version = 0;
  let removing = false;

  function card(row) {
    const guide = row.item_type === 'guide';
    const typeLabel = guide ? 'แนวข้อสอบ' : 'สรุปเนื้อหา';
    const params = guide
      ? {guide: row.item_id, course: row.course.course_code, courseId: row.course.id, source: 'api', returnTo: 'saved-courses.html'}
      : {summary: row.item_id, source: 'saved'};
    const path = `${guide ? 'read-courses.html' : 'read-summary.html'}?${new URLSearchParams(params)}`;
    return `<article class="saved-card">
      <div class="saved-card-labels">
        <span class="saved-code">${e(row.course.course_code)}</span>
        <span class="saved-document-type">${typeLabel}</span>
      </div>
      <h3>${e(row.title)}</h3>
      <div class="saved-card-footer">
        <div class="compact-review-score" data-review-score-id="${e(row.item_id)}" data-review-score-type="${e(row.item_type)}" hidden></div>
        <div class="saved-card-actions">
          <a class="saved-open" href="${e(path)}" aria-label="เปิดอ่าน${typeLabel} ${e(row.title)}">เปิดอ่าน <span aria-hidden="true">→</span></a>
          <button class="saved-button saved-remove" type="button" data-unsave="${e(row.item_id)}" data-item-type="${e(row.item_type)}"
            aria-disabled="${removing}" aria-label="นำ ${e(row.title)} ออกจากรายการที่บันทึก">นำออก</button>
        </div>
      </div>
    </article>`;
  }

  function render() {
    list.setAttribute('aria-busy', String(loading || removing));
    if (loading || failure) count.textContent = '';
    if (loading) { list.innerHTML = '<p role="status">กำลังโหลดรายการที่บันทึก…</p>'; return; }
    if (failure) {
      list.innerHTML = `<div class="reading-empty saved-empty" role="alert"><h2>โหลดรายการไม่สำเร็จ</h2><p>${e(failure)}</p><button type="button" class="saved-button" id="saved-retry">ลองอีกครั้ง</button></div>`;
      return;
    }
    const query = search.value.trim().toLocaleLowerCase();
    const type = typeFilter.value;
    const visibleRows = rows.filter(({course, title, item_type}) =>
      (!type || item_type === type)
      && `${course.course_code} ${course.course_name} ${title}`.toLocaleLowerCase().includes(query));
    count.textContent = visibleRows.length === rows.length
      ? `บันทึกไว้ ${rows.length} รายการ`
      : `แสดง ${visibleRows.length} จาก ${rows.length} รายการ`;
    const courses = new Map();
    for (const row of visibleRows) {
      const {course} = row;
      if (!courses.has(course.id)) courses.set(course.id, {course, items: []});
      courses.get(course.id).items.push(row);
    }
    list.innerHTML = courses.size ? [...courses.values()].map(({course, items}) => {
      const url = new URLSearchParams({course: course.course_code, courseId: course.id});
      return `<section class="saved-course-group" aria-labelledby="saved-course-${e(course.id)}">
        <h2 id="saved-course-${e(course.id)}"><a href="choose-courses.html?${e(url.toString())}">${e(course.course_name)} <span aria-hidden="true">→</span></a></h2>
        ${items.map(card).join('')}
      </section>`;
    }).join('') : `<div class="reading-empty saved-empty">
      <h2>${rows.length ? 'ไม่พบรายการที่ตรงกับการค้นหา' : 'ยังไม่มีรายการที่บันทึก'}</h2>
      <p>${rows.length ? 'ลองเปลี่ยนคำค้นหาหรือล้างตัวกรอง' : 'เปิดอ่านแนวข้อสอบหรือสรุปเนื้อหา แล้วกดบันทึกเพื่อกลับมาอ่านภายหลัง'}</p>
      ${rows.length ? '<button class="saved-button" id="saved-clear" type="button">ล้างตัวกรอง</button>' : '<a class="saved-button" href="courses.html">ค้นหารายวิชา</a>'}
    </div>`;
    window.Reviews?.connectScores(list);
  }

  async function load() {
    if (removing) return;
    const current = ++version;
    loading = true;
    failure = '';
    render();
    try {
      const result = await window.SavedItems.list();
      if (current !== version) return;
      rows = result;
    } catch (error) {
      if (current !== version) return;
      failure = error.message || 'ติดต่อเซิร์ฟเวอร์ไม่ได้';
    }
    if (current !== version) return;
    loading = false;
    render();
  }

  search.addEventListener('input', render);
  typeFilter.addEventListener('change', render);
  $('#saved-search-form').addEventListener('submit', event => { event.preventDefault(); render(); });
  list.addEventListener('click', async event => {
    if (event.target.closest('#saved-retry')) { load(); return; }
    if (event.target.closest('#saved-clear')) {
      search.value = '';
      typeFilter.value = '';
      render();
      search.focus();
      return;
    }
    const button = event.target.closest('[data-unsave]');
    if (!button || removing || loading) return;
    const {unsave: id, itemType} = button.dataset;
    removing = true;
    list.setAttribute('aria-busy', 'true');
    // Keep the initiating button mounted and focusable while the request runs.
    list.querySelectorAll('[data-unsave]').forEach(control => control.setAttribute('aria-disabled', 'true'));
    status.textContent = 'กำลังนำรายการออก…';
    status.dataset.kind = '';
    let refreshList = false;
    try {
      await window.SavedItems.state(itemType, id, false);
      rows = rows.filter(row => row.item_type !== itemType || String(row.item_id) !== id);
      status.textContent = 'นำรายการออกแล้ว';
    } catch (error) {
      status.textContent = error.message || 'นำรายการออกไม่สำเร็จ';
      status.dataset.kind = 'error';
      refreshList = !error.status || error.status >= 500;
    } finally {
      const restoreFocus = document.activeElement === button;
      removing = false;
      const reload = refreshList ? load() : null;
      if (!reload) render();
      if (restoreFocus) search.focus();
      if (reload) await reload;
    }
  });
  load();
  // Browser Back can restore this page without rerunning the initial load.
  window.addEventListener('pageshow', event => {
    if (event.persisted) return load();
  });
  window.addEventListener('focus', load);
})();
