(() => {
  'use strict';

  const {escapeHtml: e} = window.UiUtils;
  const $ = selector => document.querySelector(selector);
  const list = $('#saved-list');
  const search = $('#saved-search');
  const status = $('#saved-status');
  let rows = [];
  let loading = true;
  let failure = '';
  let version = 0;
  let removing = false;

  function card(row) {
    const guide = row.item_type === 'guide';
    const params = guide
      ? {guide: row.item_id, course: row.course.course_code, courseId: row.course.id, source: 'api', returnTo: 'saved-courses.html'}
      : {summary: row.item_id, source: 'saved'};
    const path = `${guide ? 'read-courses.html' : 'read-summary.html'}?${new URLSearchParams(params)}`;
    return `<article class="saved-card">
      <div class="saved-card-copy">
        <span class="saved-code">${guide ? 'แนวข้อสอบ' : 'สรุปเนื้อหา'}</span>
        <h3>${e(row.title)}</h3>
      </div>
      <div class="saved-card-actions">
        <div class="compact-review-score" data-review-score-id="${e(row.item_id)}" data-review-score-type="${e(row.item_type)}" hidden></div>
        <a href="${e(path)}">เปิดอ่าน${guide ? 'แนวข้อสอบ' : 'สรุปเนื้อหา'} →</a>
        <button type="button" data-unsave="${e(row.item_id)}" data-item-type="${e(row.item_type)}"
          ${removing ? 'disabled' : ''} aria-label="นำ ${e(row.title)} ออกจากรายการที่บันทึก">นำออก</button>
      </div>
    </article>`;
  }

  function render() {
    list.setAttribute('aria-busy', String(loading || removing));
    $('#saved-count').textContent = loading || failure ? '' : `บันทึกไว้ ${rows.length} รายการ`;
    if (loading) { list.innerHTML = '<p role="status">กำลังโหลดรายการที่บันทึก…</p>'; return; }
    if (failure) {
      list.innerHTML = `<div class="reading-empty" role="alert"><h2>โหลดรายการไม่สำเร็จ</h2><p>${e(failure)}</p><button type="button" id="saved-retry">ลองอีกครั้ง</button></div>`;
      return;
    }
    const query = search.value.trim().toLocaleLowerCase();
    const type = $('#saved-type').value;
    const courses = new Map();
    for (const row of rows) {
      const {course} = row;
      if (type && row.item_type !== type) continue;
      if (!`${course.course_code} ${course.course_name} ${row.title}`.toLocaleLowerCase().includes(query)) continue;
      if (!courses.has(course.id)) courses.set(course.id, {course, items: []});
      courses.get(course.id).items.push(row);
    }
    list.innerHTML = courses.size ? [...courses.values()].map(({course, items}) => {
      const url = new URLSearchParams({course: course.course_code, courseId: course.id});
      return `<section class="saved-course-group" aria-labelledby="saved-course-${e(course.id)}">
        <h2 id="saved-course-${e(course.id)}"><a href="choose-courses.html?${e(url.toString())}">${e(course.course_code)} · ${e(course.course_name)}</a></h2>
        ${items.map(card).join('')}
      </section>`;
    }).join('') : `<div class="reading-empty"><h2>${rows.length ? 'ไม่พบรายการที่ตรงกับการค้นหา' : 'ยังไม่มีรายการที่บันทึก'}</h2><p>${rows.length ? 'ลองเปลี่ยนคำค้นหาหรือล้างตัวกรอง' : 'เปิดอ่านแนวข้อสอบหรือสรุปเนื้อหา แล้วกดบันทึกเพื่อกลับมาอ่านภายหลัง'}</p>${rows.length ? '<button id="saved-clear" type="button">ล้างตัวกรอง</button>' : '<a class="reading-back-button" href="courses.html">ค้นหารายวิชา</a>'}</div>`;
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
  $('#saved-type').addEventListener('change', render);
  $('#saved-search-form').addEventListener('submit', event => { event.preventDefault(); render(); });
  list.addEventListener('click', async event => {
    if (event.target.closest('#saved-retry')) { load(); return; }
    if (event.target.closest('#saved-clear')) {
      search.value = '';
      $('#saved-type').value = '';
      render();
      search.focus();
      return;
    }
    const button = event.target.closest('[data-unsave]');
    if (!button || removing || loading) return;
    const {unsave: id, itemType} = button.dataset;
    removing = true;
    render();
    status.textContent = 'กำลังนำรายการออก…';
    status.dataset.kind = '';
    try {
      await window.SavedItems.state(itemType, id, false);
      rows = rows.filter(row => row.item_type !== itemType || String(row.item_id) !== id);
      status.textContent = 'นำรายการออกแล้ว';
    } catch (error) {
      status.textContent = error.message || 'นำรายการออกไม่สำเร็จ';
      status.dataset.kind = 'error';
      if (!error.status || error.status >= 500) {
        removing = false;
        await load();
      }
    } finally {
      removing = false;
      render();
      search.focus();
    }
  });
  load();
  // Browser Back can restore this page without rerunning the initial load.
  window.addEventListener('pageshow', event => {
    if (event.persisted) return load();
  });
  window.addEventListener('focus', load);
})();
