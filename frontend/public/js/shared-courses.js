(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const {escapeHtml} = window.UiUtils;
  let rows = [];
  let loading = false;
  let deleting = false;
  let loadVersion = 0;
  let loadError = '';

  function questionCount(value) {
    return value == null ? 'ไม่ระบุ' : `${value} ข้อ`;
  }

  function card(row) {
    const e = escapeHtml;
    return `<article class="exam-card"><div><div class="badges"><span class="badge code">${e(row.course_code)}</span><span class="badge">ปีการศึกษา ${e(row.year)}</span><span class="badge semester">ภาคเรียนที่ ${e(row.semester)}</span><span class="badge period">● ${e(row.period)}</span></div><h3 class="exam-card-title" title="${e(row.title)}">${e(row.title)}</h3><p class="description">รายวิชา ${e(row.course_name)}<br>หัวข้อ: ${e(row.topics || 'ไม่ระบุ')}${row.notes.trim() ? `<br>${e(row.notes)}` : ''}</p><div class="metadata"><div><span>รูปแบบข้อสอบ:</span><b>${e(row.formats.join(' / '))}</b></div><div><span>อัตนัย:</span><b>${e(questionCount(row.essay_count))}</b></div><div><span>ปรนัย:</span><b>${e(questionCount(row.objective_count))}</b></div></div></div><aside class="card-side"><div class="card-actions"><button class="open" data-action="read" data-id="${e(row.id)}">${icon('book')}เปิดอ่านแนวข้อสอบ</button><button data-action="edit" data-id="${e(row.id)}">${icon('edit')}แก้ไขข้อมูล</button><button class="delete" data-action="delete" data-id="${e(row.id)}" aria-label="ลบแนวข้อสอบ">${icon('trash')}ลบแนวข้อสอบ</button></div></aside></article>`;
  }

  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;

  function render() {
    const list = $('#exam-list');
    if (loading) {
      list.innerHTML = '<p role="status">กำลังโหลดรายการแนวข้อสอบ…</p>';
      return;
    }
    if (loadError) {
      list.innerHTML = `<div class="empty" role="alert"><h3>โหลดรายการไม่สำเร็จ</h3><p>${escapeHtml(loadError)}</p><button class="primary" id="retry-load" type="button">ลองอีกครั้ง</button></div>`;
      return;
    }
    const query = $('#search').value.trim().toLocaleLowerCase();
    const course = $('#course-filter').value;
    const year = $('#year-filter').value;
    const filtered = rows.filter(row => (!course || row.course_code === course)
      && (!year || row.year === year)
      && `${row.course_code} ${row.course_name} ${row.title} ${row.year}`.toLocaleLowerCase().includes(query));
    list.innerHTML = filtered.length
      ? filtered.map(card).join('')
      : `<div class="empty"><h3>${rows.length ? 'ไม่พบแนวข้อสอบที่ตรงกับการค้นหา' : 'คุณยังไม่ได้เผยแพร่แนวข้อสอบ'}</h3><p>${rows.length ? 'ลองเปลี่ยนคำค้นหาหรือล้างตัวกรอง' : 'เริ่มแบ่งปันแนวข้อสอบให้เพื่อนในรายวิชา'}</p>${rows.length ? '<button id="clear-filters" class="primary" type="button">ล้างตัวกรอง</button>' : '<a href="upload.html" class="primary">เผยแพร่แนวข้อสอบ</a>'}</div>`;
    $('#chips').innerHTML = [course && ['course', course], year && ['year', year]].filter(Boolean)
      .map(([type, value]) => `<button data-clear="${type}" aria-label="ล้างตัวกรอง ${escapeHtml(value)}">${escapeHtml(value)} ×</button>`).join('');
  }

  function refreshOptions() {
    const selectedCourse = $('#course-filter').value;
    const selectedYear = $('#year-filter').value;
    const courses = [...new Map(rows.map(row => [row.course_code, row.course_name])).entries()];
    $('#course-filter').innerHTML = '<option value="">ทุกรายวิชา</option>' + courses
      .map(([code, name]) => `<option value="${escapeHtml(code)}">${escapeHtml(code + ' ' + name)}</option>`).join('');
    $('#year-filter').innerHTML = '<option value="">ทุกปีการศึกษา</option>' + [...new Set(rows.map(row => row.year))]
      .sort().reverse().map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
    if (courses.some(([code]) => code === selectedCourse)) $('#course-filter').value = selectedCourse;
    if (rows.some(row => row.year === selectedYear)) $('#year-filter').value = selectedYear;
  }

  async function loadMyGuides() {
    const version = ++loadVersion;
    loading = true;
    loadError = '';
    rows = [];
    render();
    try {
      const user = await window.currentUserReady;
      if (!user) {
        window.location.replace('login.html');
        return;
      }
      const result = await window.GuideApi.mine();
      if (version !== loadVersion) return;
      rows = result;
      refreshOptions();
    } catch (error) {
      if (version !== loadVersion) return;
      loadError = error.message || 'กรุณาตรวจการเชื่อมต่อแล้วลองใหม่';
    } finally {
      if (version === loadVersion) {
        loading = false;
        render();
      }
    }
  }

  function setFiltersOpen(open) {
    $('#filters').hidden = !open;
    $('#filter-toggle').setAttribute('aria-expanded', String(open));
  }

  $('#exam-list').addEventListener('click', event => {
    if (event.target.closest('#retry-load')) { loadMyGuides(); return; }
    if (event.target.closest('#clear-filters')) {
      $('#search').value = '';
      $('#course-filter').value = '';
      $('#year-filter').value = '';
      render();
      return;
    }
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const row = rows.find(item => item.id === button.dataset.id);
    if (!row) return;
    if (button.dataset.action === 'edit') {
      window.GuideEditor.open(row, async () => {
        $('#search').value = '';
        $('#course-filter').value = '';
        $('#year-filter').value = '';
        $('#edit-status').textContent = 'บันทึกการแก้ไขแล้ว';
        await loadMyGuides();
      });
      return;
    }
    if (button.dataset.action === 'delete') {
      if (deleting) return;
      $('#delete-guide-title').textContent = row.title;
      $('#delete-guide-course').textContent = `${row.course_code} ${row.course_name}`;
      const dialog = $('#delete-confirm');
      dialog.dataset.guideId = row.id;
      dialog.returnValue = '';
      dialog.showModal();
      return;
    }
    const params = new URLSearchParams({
      course: row.course_code, courseId: String(row.course_id), guide: row.id,
      source: 'api', returnTo: 'shared-courses.html'
    });
    window.location.assign(`read-courses.html?${params}`);
  });
  $('#delete-confirm').addEventListener('close', async () => {
    if ($('#delete-confirm').returnValue !== 'delete') return;
    const id = $('#delete-confirm').dataset.guideId;
    if (deleting || !rows.some(row => row.id === id)) return;
    deleting = true;
    const button = $('#confirm-delete');
    button.disabled = true;
    try {
      await window.GuideApi.remove(id);
      $('#edit-status').textContent = 'ลบแนวข้อสอบแล้ว';
      await loadMyGuides();
    } catch (error) {
      $('#edit-status').textContent = error.uncertain
        ? 'ยืนยันผลการลบไม่ได้ กรุณาโหลดรายการใหม่เพื่อตรวจสอบก่อนลองอีกครั้ง'
        : error.status === 404
          ? 'ไม่พบรายการหรือไม่มีสิทธิ์ลบ รายการถูกโหลดใหม่แล้ว'
          : error.message || 'ลบแนวข้อสอบไม่สำเร็จ';
      await loadMyGuides();
    } finally {
      deleting = false;
      button.disabled = false;
      $('#delete-confirm').dataset.guideId = '';
    }
  });
  $('#search-form').addEventListener('submit', event => { event.preventDefault(); render(); });
  $('#search').addEventListener('input', render);
  $('#filter-toggle').addEventListener('click', () => setFiltersOpen($('#filters').hidden));
  for (const selector of ['#course-filter', '#year-filter']) {
    $(selector).addEventListener('change', () => { render(); setFiltersOpen(false); $('#filter-toggle').focus(); });
  }
  $('#chips').addEventListener('click', event => {
    const button = event.target.closest('[data-clear]');
    if (!button) return;
    $(button.dataset.clear === 'course' ? '#course-filter' : '#year-filter').value = '';
    render();
  });
  const tabs = [$('#exams-tab'), $('#summaries-tab')];
  let guidesStarted = false;
  function selectTab(selected) {
    tabs.forEach((tab, index) => {
      const active = index === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
    });
    if (selected === 1) window.MySummaries?.load();
    else if (!guidesStarted) {
      guidesStarted = true;
      loadMyGuides();
    }
  }
  function switchTab(selected) {
    if (tabs[selected].getAttribute('aria-selected') === 'true') return;
    selectTab(selected);
    const url = new URL(window.location.href);
    if (selected === 1) url.searchParams.set('type', 'summaries');
    else url.searchParams.delete('type');
    window.history.replaceState(null, '', url);
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => switchTab(index));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index;
      switchTab(next);
      tabs[next].focus();
    });
  });
  selectTab(new URLSearchParams(window.location.search).get('type') === 'summaries' ? 1 : 0);
})();
